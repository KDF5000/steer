import SwiftUI
import WatchKit

@main struct SteerWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchPushDelegate.self) private var pushDelegate
    @StateObject private var notifications = WatchNotifications.shared
    @StateObject private var pairing = Pairing()
    @StateObject private var model = WatchModel()
    @Environment(\.scenePhase) private var phase
    @State private var completion: Conversation?
    @State private var showCompletion = false
    @State private var openCompletion = false
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                WatchHome()
                    .alert(completion?.status == "failed" ? "任务执行失败" : "任务已完成", isPresented: $showCompletion) {
                        Button("查看结果") { openCompletion = true }
                        Button("稍后查看", role: .cancel) {}
                    } message: { Text(completion?.title ?? "") }
                    .navigationDestination(isPresented: $openCompletion) {
                        if let completion { WatchDetail(id: completion.id, autoDictate: notifications.continueByVoice) }
                    }
            }.environmentObject(model).environmentObject(pairing).environmentObject(notifications)
            .tint(.mint)
            .onChange(of: model.items) { previous, current in
                guard phase == .active, !model.sending, !showCompletion, !openCompletion else { return }
                if let item = current.first(where: { item in
                    guard let task = item.taskID else { return false }
                    return ["succeeded", "failed"].contains(item.status) && !notifications.claimed(task) && previous.contains(where: { $0.id == item.id && $0.taskID == task && $0.running })
                }), let task = item.taskID {
                    _ = notifications.claim(task); notifications.continueByVoice = false; completion = item; showCompletion = true
                    WKInterfaceDevice.current().play(.notification)
                }
            }
            .onChange(of: notifications.openItem, initial: true) { _, item in
                guard let item else { return }
                model.configure(pairing.connection)
                if !model.items.contains(where: { $0.id == item.id }) { model.items.insert(item, at: 0) }
                completion = item; openCompletion = true
            }
            .onChange(of: pairing.connection, initial: true) { _, value in
                model.configure(value)
                if phase == .active { Task { await notifications.configure(value); await model.refresh() } }
            }
            .task(id: phase) {
                guard phase == .active else { return }
                #if DEBUG
                await pairing.runStoredWatchSpeechDiagnostic()
                #endif
                await notifications.configure(pairing.connection)
                while !Task.isCancelled {
                    await model.refresh()
                    try? await Task.sleep(for: .seconds(15))
                }
            }
        }
    }
}
struct WatchHome: View {
    #if DEBUG
    @AppStorage("steer.localSpeechTest") private var localSpeechTest = false
    @AppStorage("steer.localSpeechModel") private var localSpeechModel = "base-q5_1"
    #endif
    @EnvironmentObject var notifications: WatchNotifications
    @EnvironmentObject var model: WatchModel
    @EnvironmentObject var pairing: Pairing
    private var running: [Conversation] { model.items.filter { $0.running && $0.taskID != nil } }
    private var recent: [Conversation] { Array(model.items.filter { $0.taskID != nil && ["succeeded", "failed", "cancelled"].contains($0.status) }.prefix(8)) }
    var body: some View {
        Group {
            if model.connection == nil {
                ScrollView { VStack(spacing: 12) {
                    Image(systemName: "applewatch").font(.title2).foregroundStyle(.mint)
                    Text("跟踪 Steer 任务").font(.headline)
                    Text("在配对 iPhone 上填写 Steer 连接信息并同步，即可在手表接收任务动态、语音续聊。").font(.footnote).foregroundStyle(.secondary)
                    if !pairing.status.isEmpty { Text(pairing.status).font(.footnote) }
                }.padding(.horizontal, 8) }
            } else {
                List {
                    if let error = model.error {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("暂未同步").foregroundStyle(.orange)
                            if let date = model.syncedAt { Text("上次同步 \(date.formatted(date: .omitted, time: .shortened))").foregroundStyle(.secondary) }
                            Text(error).foregroundStyle(.secondary).lineLimit(2)
                        }.font(.caption2).listRowBackground(Color.clear)
                    }
                    Section("正在进行 · \(running.count)") {
                        if running.isEmpty { Text(model.refreshing && model.items.isEmpty ? "正在同步…" : "当前没有执行中的任务").font(.footnote).foregroundStyle(.secondary) }
                        ForEach(running) { item in taskRow(item) }
                    }
                    if !recent.isEmpty { Section("最近动态") { ForEach(recent) { item in taskRow(item) } } }
                    if !notifications.status.isEmpty { Text(notifications.status).font(.caption2).foregroundStyle(.secondary).listRowBackground(Color.clear) }
                    Button { Task { await model.refresh() } } label: { Label("同步状态", systemImage: "arrow.clockwise") }.font(.footnote).disabled(model.refreshing)
                    #if DEBUG
                    Section("语音验证") {
                        Toggle("本地识别测试", isOn: $localSpeechTest).font(.footnote)
                        if localSpeechTest {
                            Picker("测试模型", selection: $localSpeechModel) {
                                Text("Base · 57 MB").tag("base-q5_1")
                                Text("Tiny · 31 MB").tag("tiny-q5_1")
                            }.font(.footnote)
                        }
                        Text(localSpeechTest ? "手表独立识别，不传手机；中文准确率待验证。" : "使用配对 iPhone 识别。").font(.caption2).foregroundStyle(.secondary)
                    }
                    #endif
                }.listStyle(.carousel)
            }
        }.navigationTitle("任务动态")
    }
    private func taskRow(_ item: Conversation) -> some View {
        NavigationLink { WatchDetail(id: item.id) } label: {
            HStack(spacing: 7) {
                Image(systemName: item.running ? "clock" : item.status == "failed" ? "exclamationmark.circle" : "checkmark.circle")
                    .foregroundStyle(item.running ? Color.cyan : item.status == "failed" ? .orange : .mint)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title).font(.system(.footnote, weight: .semibold)).lineLimit(2)
                    Text("\(item.projectName) · \(item.agentName)").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    Text(item.label).font(.caption2).foregroundStyle(item.running ? .cyan : .secondary)
                }
            }
        }
    }
}
struct WatchDetail: View {
    let id: String
    var autoDictate = false
    @State private var autoStarted = false
    @EnvironmentObject var model: WatchModel
    @StateObject private var dictation = Dictation()
    @State private var confirmingStop = false
    @State private var cancelling = false
    @State private var compose = false
    @State private var fullResult = false
    @State private var message: String?
    private var item: Conversation? { model.items.first { $0.id == id } }
    var body: some View {
        Group {
            if let item {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(item.projectName) · \(item.agentName)").font(.caption2).foregroundStyle(.secondary)
                        Text(item.title).font(.headline).lineLimit(3)
                        Label(item.label, systemImage: item.running ? "clock" : item.status == "failed" ? "exclamationmark.circle" : "checkmark.circle")
                            .font(.footnote).foregroundStyle(item.running ? .cyan : item.status == "failed" ? .orange : .mint)
                        if let error = model.error { Text("暂未同步：\(error)").font(.caption2).foregroundStyle(.orange) }
                        if item.running {
                            Text("Agent 正在执行。完成后可以查看结果并语音继续。").font(.footnote).foregroundStyle(.secondary)
                        } else {
                            Text(item.summary.isEmpty ? "任务已结束，暂未返回正文。" : item.summary).font(.footnote).lineLimit(8)
                            if item.summary.count > 180 { Button("展开结果") { fullResult = true }.font(.caption) }
                        }
                        if let message {
                            Text(message).font(.caption2).foregroundStyle(.orange)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 3)
                }
                .safeAreaInset(edge: .bottom) {
                    if !item.running {
                        Button { Task { await continueConversation(item) } } label: {
                            Label(model.draft(id).attempted ? "确认发送" : "语音", systemImage: "mic.fill")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }.buttonStyle(.borderedProminent).disabled(dictation.active).padding(.horizontal, 3).background(.black)
                    }
                }
                .toolbar {
                    if item.running { ToolbarItem(placement: .topBarTrailing) { Button(role: .destructive) { confirmingStop = true } label: { Image(systemName: "stop.circle") }.disabled(cancelling).accessibilityLabel("停止任务") } }
                }
                .navigationDestination(isPresented: $compose) { WatchCompose(item: item) }
                .sheet(isPresented: $fullResult) { ScrollView { Text(item.summary).font(.footnote).padding(.horizontal, 8) }.navigationTitle("任务结果") }
                .confirmationDialog("停止当前任务？已有改动不会撤销。", isPresented: $confirmingStop, titleVisibility: .visible) {
                    Button("停止任务", role: .destructive) { Task { cancelling = true; defer { cancelling = false }; do { if let task = item.taskID { try await model.cancel(task) } } catch { message = error.localizedDescription } } }
                }
            } else { Text("任务已不在当前列表，请返回同步").font(.footnote) }
        }.navigationTitle("任务状态")
        .sheet(isPresented: Binding(get: { dictation.active }, set: { if !$0 { dictation.cancel() } })) { VoiceListening(dictation: dictation) }
        .onChange(of: model.account) { _, _ in dictation.cancel() }
        .task {
            await model.refreshTask(id)
            if autoDictate, !autoStarted, let item, !item.running {
                autoStarted = true; await continueConversation(item)
            }
        }
    }
    @MainActor private func continueConversation(_ item: Conversation) async {
        // Preserve an uncertain send's idempotency key; every new voice input
        // otherwise starts fresh rather than reopening an old recording.
        if model.draft(id).attempted { compose = true; return }
        let account = model.account
        model.discardDraft(id, account: account)
        message = nil
        do {
            guard let text = try await dictation.capture(context: account + ":" + id, rerecord: true) else { return }
            guard account == model.account else { throw APIError(message: "连接配置已变化，请返回任务列表") }
            try model.saveDraft(Draft(text: text), id: id)
            dictation.discardRecording(context: account + ":" + id)
            message = nil; compose = true
        } catch { dictation.discardRecording(context: account + ":" + id); message = error.localizedDescription }
    }
}
struct WatchCompose: View {
    let item: Conversation
    @EnvironmentObject var model: WatchModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft = Draft(text: "")
    @State private var loaded = false
    @State private var error: String?
    @State private var sent = false
    @State private var sourceAccount = ""
    private var canSend: Bool {
        !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.sending
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(item.projectName) · \(item.agentName)").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    Text(item.title).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                if sent {
                    Label("已发送", systemImage: "checkmark.circle").foregroundStyle(.mint)
                    Text("任务已提交，可以返回跟踪状态。").font(.footnote)
                    Button { dismiss() } label: { primaryLabel("返回任务") }
                        .buttonStyle(.plain)
                } else {
                    Text(draft.text.isEmpty ? "还没有识别到文字" : draft.text).font(.footnote)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.gray.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
                    if draft.attempted { Text("发送结果待确认，重试不会重复创建任务。").font(.caption2).foregroundStyle(.secondary) }
                    if let error { Text(error).font(.caption2).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
                    Button { Task { await send() } } label: {
                        primaryLabel(model.sending ? "发送中…" : draft.attempted ? "重试发送" : "发送")
                    }.buttonStyle(.plain).disabled(!canSend).opacity(canSend ? 1 : 0.4)
                    Button(role: .cancel) { cancelDraft() } label: { secondaryLabel("取消") }
                        .buttonStyle(.plain).disabled(model.sending)
                }
            }.padding(.horizontal, 2).padding(.bottom, 8)
        }.navigationTitle(sent ? "完成" : "确认发送")
        .onChange(of: model.account) { _, _ in cancelDraft() }
        .onAppear { if !loaded { draft = model.draft(item.id); sourceAccount = model.account; loaded = true } }
        .onDisappear { if loaded, !sent, !draft.attempted, !model.sending { model.discardDraft(item.id, account: sourceAccount) } }
    }
    private func primaryLabel(_ title: String) -> some View {
        Text(title).font(.system(.footnote, weight: .semibold))
            .foregroundStyle(.black).padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(Color.mint, in: Capsule()).contentShape(Capsule())
    }
    private func secondaryLabel(_ title: String) -> some View {
        Text(title).font(.footnote).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
    }
    @MainActor private func cancelDraft() {
        model.discardDraft(item.id, account: sourceAccount)
        draft = Draft(text: "")
        dismiss()
    }
    @MainActor private func send() async {
        guard sourceAccount == model.account else { error = "连接配置已变化，请返回列表重新选择任务"; return }
        draft.attempted = true
        do { try model.saveDraft(draft, id: item.id); try await model.send(item, draft: draft); sent = true; error = nil }
        catch {
            if let rejection = error as? APIError, let status = rejection.statusCode, (400...499).contains(status) {
                draft.attempted = false; draft.idempotencyKey = UUID().uuidString
                try? model.saveDraft(draft, id: item.id)
            }
            self.error = "尚未确认发送 · 草稿已保留\n\(error.localizedDescription)"
        }
    }
}
