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
    @EnvironmentObject var model: WatchModel
    @EnvironmentObject var pairing: Pairing
    private var activeCount: Int { model.overview?.activeTasks ?? model.items.filter { $0.running && $0.taskID != nil }.count }
    private var totalCount: Int { model.overview?.totalTasks ?? model.items.filter { $0.taskID != nil }.count }
    var body: some View {
        Group {
            if model.connection == nil {
                VStack(spacing: 12) {
                    Image(systemName: "iphone.and.arrow.forward").font(.title2).foregroundStyle(.mint)
                    Text("在 iPhone 连接 Steer").font(.footnote)
                }
            } else {
                ViewThatFits(in: .vertical) {
                    dashboard(compact: false)
                    dashboard(compact: true)
                    ScrollView { dashboard(compact: true) }
                        .scrollIndicators(.hidden)
                }
            }
        }.navigationTitle("").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { WatchSettings() } label: {
                        Image(systemName: "slider.horizontal.3")
                            .font(.system(size: 16, weight: .regular))
                            .foregroundStyle(Color(white: 0.65))
                            .frame(width: 36, height: 36)
                            .background(Color(white: 24.0 / 255.0), in: Circle())
                            .overlay { Circle().strokeBorder(Color(white: 49.0 / 255.0), lineWidth: 1) }
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityLabel("设置")
                }
            }
    }
    private func dashboard(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 8 : 12) {
            HStack(alignment: .top, spacing: 12) {
                NavigationLink { WatchActiveTasks() } label: {
                    countLabel(activeCount, title: "进行中", accent: true, compact: compact)
                }.accessibilityLabel("进行中 \(activeCount) 个任务")
                NavigationLink { WatchTaskList() } label: {
                    countLabel(totalCount, title: "所有任务", accent: false, compact: compact)
                }.accessibilityLabel("所有任务 \(totalCount) 个")
            }.buttonStyle(.plain)
            Divider()
            HStack(alignment: .top, spacing: 8) {
                metric("累计消息", value: WatchOverview.countText(model.overview?.messageCount), compact: compact)
                metric("已记录 Token", value: WatchOverview.countText(model.overview?.tokenCount), compact: compact)
            }
            if model.error != nil || model.overviewError != nil {
                Text("未同步").font(.caption2).foregroundStyle(.orange)
            }
        }.frame(maxWidth: .infinity, alignment: .topLeading)
            .padding(.horizontal, 4).padding(.vertical, 4)
    }
    private func countLabel(_ count: Int, title: String, accent: Bool, compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(String(count)).font(.system(compact ? .title : .largeTitle, design: .rounded, weight: .semibold))
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                .foregroundStyle(accent ? Color.mint : Color.primary)
            HStack(spacing: 4) {
                Text(title)
                Image(systemName: "chevron.right").font(.caption2)
            }.font(.caption2).foregroundStyle(.primary)
        }.frame(maxWidth: .infinity, minHeight: 64, alignment: .leading).contentShape(Rectangle())
    }
    private func metric(_ title: String, value: String, compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(compact ? .headline : .title3).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(title).font(.caption2).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
    }
}
struct WatchActiveTasks: View {
    @EnvironmentObject var model: WatchModel
    @EnvironmentObject var pairing: Pairing
    @State private var selectedPage = ""
    @State private var order: [String] = []
    @State private var initialized = false
    private var active: [Conversation] { model.items.filter { $0.running && $0.taskID != nil } }
    private var pages: [Conversation] { order.compactMap { id in active.first { $0.id == id } } }
    var body: some View {
        Group {
            if model.connection == nil {
                VStack(spacing: 12) {
                    Image(systemName: "iphone.and.arrow.forward").font(.title2).foregroundStyle(.mint)
                    Text("在 iPhone 连接 Steer").font(.footnote)
                    if !pairing.status.isEmpty { Text(pairing.status).font(.caption2).foregroundStyle(.secondary) }
                }
            } else if active.isEmpty {
                VStack(spacing: 12) {
                    Text("0").font(.largeTitle).monospacedDigit().foregroundStyle(.secondary)
                    Text("暂无进行中的任务").font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                TabView(selection: $selectedPage) {
                    ForEach(pages) { item in WatchRunningPage(item: item).tag(item.id) }
                }.tabViewStyle(.page(indexDisplayMode: pages.count > 1 ? .automatic : .never))
                .onAppear { reconcile() }
                .onChange(of: active.map(\.id)) { _, _ in reconcile() }
            }
        }.onAppear { reconcile() }
        .navigationTitle("进行中 · \(active.count)")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: model.account) { _, _ in selectedPage = ""; order = []; initialized = false; reconcile() }
    }
    private func reconcile() {
        let ids = active.map(\.id)
        order = order.filter { ids.contains($0) } + ids.filter { !order.contains($0) }
        if !initialized, let first = order.first { selectedPage = first; initialized = true }
        if !selectedPage.isEmpty, !order.contains(selectedPage) { selectedPage = order.first ?? "" }
    }
}
struct WatchRunningPage: View {
    let item: Conversation
    @EnvironmentObject var model: WatchModel
    @State private var fullMessage = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(item.title).font(.headline).lineLimit(2)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(item.projectName) / \(item.agentName)").lineLimit(1)
                    Spacer(minLength: 2)
                    if item.executing {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            if let elapsed = item.elapsed(at: context.date) {
                                Text(elapsed).monospacedDigit().accessibilityLabel("运行时长 \(elapsed)")
                            }
                        }
                    } else { Text(item.label) }
                }.font(.caption2).foregroundStyle(.secondary)
                if let prompt = item.lastUserMessage, !prompt.isEmpty {
                    Button { fullMessage = true } label: {
                        Text(prompt).font(.footnote).foregroundStyle(.primary).lineLimit(5)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }.buttonStyle(.plain).accessibilityLabel("查看最近发给 Agent 的消息：\(prompt)")
                } else if let error = model.historyErrors[item.id] {
                    Text(error).font(.caption2).foregroundStyle(.orange)
                    Button("重试") { Task { await model.loadHistory(item.id) } }.font(.caption2)
                }
                if model.error != nil {
                    Text(model.syncedAt.map { "未同步 · \($0.formatted(date: .omitted, time: .shortened))" } ?? "未同步")
                        .font(.caption2).foregroundStyle(.orange)
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4).padding(.bottom, 20)
        }.scrollIndicators(.hidden)
        .task(id: item.taskID) { await model.refreshTask(item.id); await model.loadHistory(item.id) }
        .sheet(isPresented: $fullMessage) {
            ScrollView { Text(item.lastUserMessage ?? "").font(.footnote).padding(.horizontal, 8) }
                .scrollIndicators(.hidden)
                .navigationTitle("最近指令")
        }
    }
}
struct WatchTaskList: View {
    @EnvironmentObject var model: WatchModel
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(model.projects) { project in
                    NavigationLink { WatchProjectTasks(project: project) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(project.name).font(.headline).foregroundStyle(.primary)
                            HStack(spacing: 8) {
                                Text("\(project.conversations) 个会话").foregroundStyle(.secondary)
                                if project.activeTasks > 0 { Text("\(project.activeTasks) 进行中").foregroundStyle(.mint) }
                            }.font(.caption2)
                        }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).padding(.vertical, 8).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                    Divider()
                }
                if let error = model.projectsError {
                    Text(error).font(.caption2).foregroundStyle(.orange).padding(.vertical, 8)
                    Button("重试") { Task { await model.refreshProjects() } }.buttonStyle(.plain)
                } else if model.projects.isEmpty {
                    if model.refreshing { ProgressView().frame(maxWidth: .infinity) }
                    else { Text("暂无任务").font(.footnote).foregroundStyle(.secondary) }
                }
            }.padding(.horizontal, 4)
        }.scrollIndicators(.hidden).navigationTitle("所有任务").navigationBarTitleDisplayMode(.inline)
            .task { await model.refreshProjects() }
    }
}
struct WatchProjectTasks: View {
    let project: WatchProject
    @Environment(\.scenePhase) private var phase
    private var items: [Conversation] { (model.projectItems[project.id] ?? []).map { entry in model.items.first { $0.id == entry.id } ?? entry } }
    @EnvironmentObject var model: WatchModel
    private var active: [Conversation] { items.filter { $0.running && $0.taskID != nil } }
    private var recent: [Conversation] { items.filter { !$0.running } }
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if model.loadingProjects.contains(project.id), items.isEmpty { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 12) }
                if let error = model.projectErrors[project.id] { Text(error).font(.caption2).foregroundStyle(.orange).padding(.vertical, 8) }
                if !active.isEmpty {
                    heading("进行中")
                    ForEach(active) { row($0) }
                }
                if !recent.isEmpty {
                    heading("最近结束")
                    ForEach(recent) { row($0) }
                }
                if !model.loadingProjects.contains(project.id), active.isEmpty, recent.isEmpty {
                    Text("暂无任务").font(.footnote).foregroundStyle(.secondary).padding(.vertical, 12)
                }
                if model.projectHasMore[project.id] == true {
                    Button { Task { await model.refreshProject(project.id, more: true) } } label: {
                        Text(model.loadingProjects.contains(project.id) ? "加载中…" : "加载更多").font(.footnote).frame(maxWidth: .infinity, minHeight: 44)
                    }.buttonStyle(.plain).disabled(model.loadingProjects.contains(project.id))
                }
            }.padding(.horizontal, 4)
        }.scrollIndicators(.hidden)
            .navigationTitle(project.name).navigationBarTitleDisplayMode(.inline)
            .task(id: "\(model.account):\(phase)") {
                guard phase == .active else { return }
                while !Task.isCancelled {
                    await model.refreshProject(project.id)
                    try? await Task.sleep(for: .seconds(15))
                }
            }
    }
    private func heading(_ title: String) -> some View {
        Text(title).font(.caption2).foregroundStyle(.secondary).padding(.vertical, 8)
    }
    private func row(_ item: Conversation) -> some View {
        VStack(spacing: 0) {
            NavigationLink { WatchDetail(id: item.id) } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title).font(.footnote).lineLimit(2).foregroundStyle(.primary)
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(item.agentName).lineLimit(1)
                        Spacer(minLength: 2)
                        if !["running", "succeeded"].contains(item.status) { Text(item.label) }
                        if item.executing {
                            TimelineView(.periodic(from: .now, by: 1)) { context in
                                if let elapsed = item.elapsed(at: context.date) { Text(elapsed).monospacedDigit() }
                            }
                        }
                    }.font(.caption2).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).padding(.vertical, 8).contentShape(Rectangle())
            }.buttonStyle(.plain)
            Divider()
        }
    }
}
struct WatchSettings: View {
    @EnvironmentObject var notifications: WatchNotifications
    @EnvironmentObject var pairing: Pairing
    #if DEBUG
    @AppStorage("steer.localSpeechTest") private var localSpeechTest = false
    #endif
    private var notificationStatus: String {
        switch notifications.status {
        case "": return pairing.connection == nil ? "未连接服务" : "正在检查"
        case "后台通知待配置": return "服务端未启用"
        case "任务完成通知已开启": return "已开启"
        default: return notifications.status
        }
    }
    private var speechSource: String {
        if pairing.connection?.speech != nil { return "自托管服务" }
        #if DEBUG
        if localSpeechTest && LocalSpeech.available { return "手表本地测试" }
        #endif
        return "iPhone 转写"
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                statusRow("后台通知", value: notificationStatus)
                Divider()
                statusRow("语音转写", value: pairing.connection == nil ? "未配置" : speechSource)
                #if DEBUG
                Divider()
                NavigationLink { WatchSpeechValidation() } label: {
                    HStack {
                        Text("语音验证").font(.footnote)
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
                    }.frame(minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain)
                #endif
            }.padding(.horizontal, 4)
        }.scrollIndicators(.hidden).navigationTitle("设置")
    }
    private func statusRow(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.footnote)
            Text(value).font(.caption2).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.vertical, 8).accessibilityElement(children: .combine)
    }
}
#if DEBUG
struct WatchSpeechValidation: View {
    @AppStorage("steer.localSpeechTest") private var localSpeechTest = false
    @AppStorage("steer.localSpeechModel") private var localSpeechModel = "base-q5_1"
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Toggle("手表本地识别", isOn: $localSpeechTest).font(.footnote)
                if localSpeechTest {
                    Divider()
                    Picker("模型", selection: $localSpeechModel) {
                        Text("Base").tag("base-q5_1")
                        Text("Tiny").tag("tiny-q5_1")
                    }
                }
            }.padding(.horizontal, 4)
        }.scrollIndicators(.hidden).navigationTitle("语音验证")
    }
}
#endif
struct WatchDetail: View {
    let id: String
    var autoDictate = false
    @State private var autoStarted = false
    @EnvironmentObject var model: WatchModel
    @StateObject private var resultSpeech = ResultSpeech()
    @Environment(\.scenePhase) private var scenePhase
    @State private var confirmingStop = false
    @State private var cancelling = false
    @State private var voicePresented = false
    @State private var message: String?
    private var item: Conversation? { model.items.first { $0.id == id } }
    var body: some View {
        Group {
            if let item {
                ZStack(alignment: .bottom) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(alignment: .firstTextBaseline, spacing: 4) {
                                Text("\(item.projectName) / \(item.agentName)").lineLimit(1)
                                Spacer(minLength: 2)
                                if item.executing {
                                    TimelineView(.periodic(from: .now, by: 1)) { context in
                                        if let elapsed = item.elapsed(at: context.date) { Text(elapsed).monospacedDigit() }
                                    }
                                } else if !["running", "succeeded"].contains(item.status) { Text(item.label).fixedSize() }
                            }.font(.caption2).foregroundStyle(.secondary)
                            Text(item.title).font(.headline).lineLimit(2)
                            if let error = model.error { Text("暂未同步：\(error)").font(.caption2).foregroundStyle(.orange) }
                            if item.running {
                                if let prompt = item.lastUserMessage { Text(prompt).font(.footnote) }
                            } else {
                                if item.summary.isEmpty { Text("暂未返回结果").font(.footnote).foregroundStyle(.secondary) }
                                else { WatchResultText(text: item.summary) }
                                if let error = resultSpeech.error { Text(error).font(.caption2).foregroundStyle(.orange) }
                            }
                            if let message {
                                Text(message).font(.caption2).foregroundStyle(.orange)
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 3)
                            .padding(.bottom, item.canContinue || model.draft(id).attempted ? 60 : 0)
                    }
                    .scrollIndicators(.hidden)
                    if item.canContinue || model.draft(id).attempted {
                        Button { resultSpeech.stop(); message = nil; voicePresented = true } label: {
                            Image(systemName: model.draft(id).attempted ? "arrow.up" : "mic.fill")
                                .font(.system(size: 18, weight: .medium)).foregroundStyle(.black)
                                .frame(width: 36, height: 36).background(Color.mint, in: Circle())
                                .frame(width: 44, height: 44).contentShape(Rectangle())
                        }.buttonStyle(.plain).disabled(voicePresented || model.sending)
                            .accessibilityLabel(model.draft(id).attempted ? "确认发送" : "语音继续")
                            .padding(.bottom, 8)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .ignoresSafeArea(.container, edges: item.canContinue || model.draft(id).attempted ? .bottom : [])
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        if item.running {
                            Button(role: .destructive) { confirmingStop = true } label: { Image(systemName: "stop.circle") }
                                .disabled(cancelling).accessibilityLabel("停止任务")
                        } else if !item.summary.isEmpty {
                            Button {
                                if resultSpeech.speaking { resultSpeech.stop() }
                                else { resultSpeech.play(item.summary, locale: model.connection?.recognitionLocale ?? "zh-CN") }
                            } label: { Image(systemName: resultSpeech.speaking ? "stop.fill" : "speaker.wave.2") }
                                .buttonStyle(.plain).accessibilityLabel(resultSpeech.speaking ? "停止朗读" : "朗读结果")
                        }
                    }
                }
                .confirmationDialog("停止当前任务？已有改动不会撤销。", isPresented: $confirmingStop, titleVisibility: .visible) {
                    Button("停止任务", role: .destructive) { Task { cancelling = true; defer { cancelling = false }; do { if let task = item.taskID { try await model.cancel(task) } } catch { message = error.localizedDescription } } }
                }
            } else { Text("任务已不在当前列表，请返回同步").font(.footnote) }
        }.navigationTitle(item?.running == true ? "任务" : "任务结果")
        .sheet(isPresented: $voicePresented) {
            NavigationStack { WatchVoiceFlow(id: id) }
        }
        .onChange(of: model.account) { _, _ in voicePresented = false }
        .onChange(of: model.connection) { _, _ in voicePresented = false; resultSpeech.stop() }
        .onChange(of: scenePhase) { _, phase in if phase != .active { resultSpeech.stop() } }
        .onDisappear { resultSpeech.stop() }
        .task {
            if autoDictate, !autoStarted, let item, item.canContinue {
                resultSpeech.stop(); autoStarted = true; voicePresented = true
            }
            await model.refreshTask(id)
        }
    }
}

/// A single presentation owns the complete voice interaction. Never dismiss a
/// recording sheet and push confirmation in the same SwiftUI update.
struct WatchVoiceFlow: View {
    let id: String
    @EnvironmentObject var model: WatchModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var dictation = Dictation()
    @State private var reviewing: Conversation?
    @State private var failure: String?
    @State private var checking = true
    @State private var attempt = UUID()
    var body: some View {
        Group {
            if let reviewing { WatchCompose(item: reviewing) }
            else if let failure {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("语音未完成").font(.headline)
                        Text(failure).font(.footnote).foregroundStyle(.secondary)
                        Button("重试") { self.failure = nil; checking = true; attempt = UUID() }.buttonStyle(.borderedProminent)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 8)
                }.scrollIndicators(.hidden).navigationTitle("")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button(role: .cancel) { dismiss() } label: {
                                Image(systemName: "xmark").foregroundStyle(.secondary)
                            }.buttonStyle(.plain).accessibilityLabel("关闭语音输入")
                        }
                    }
            } else if checking {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("检查任务状态").font(.footnote).foregroundStyle(.secondary)
                    Button("取消") { dismiss() }.buttonStyle(.plain)
                }.navigationTitle("语音")
            } else { VoiceListening(dictation: dictation, onCancel: { dismiss() }) }
        }
        .interactiveDismissDisabled(reviewing == nil && failure == nil)
        .task(id: attempt) { await capture() }
        .onDisappear { dictation.cancel() }
    }
    @MainActor private func capture() async {
        guard reviewing == nil else { return }
        guard let item = model.items.first(where: { $0.id == id }) else { failure = "任务已不在列表，请返回刷新"; return }
        if model.draft(id).attempted { checking = false; reviewing = item; return }
        let account = model.account
        let connection = model.connection
        let context = account + ":" + id
        do {
            let current = try await model.continuationTarget(id, taskID: item.taskID)
            try Task.checkCancellation()
            guard connection == model.connection else { throw APIError(message: "连接配置已变化，请重新输入") }
            model.discardDraft(id, account: account)
            checking = false
            guard let text = try await dictation.capture(context: context, rerecord: true, service: connection?.speech, locale: connection?.recognitionLocale ?? "zh-CN") else { dismiss(); return }
            try Task.checkCancellation()
            guard account == model.account, connection == model.connection else { throw APIError(message: "连接配置已变化，请重新输入") }
            try model.saveDraft(Draft(text: text), id: id)
            dictation.discardRecording(context: context)
            guard let latest = model.items.first(where: { $0.id == id }), latest.taskID == current.taskID, latest.canContinue else {
                throw APIError(message: "任务状态已变化，草稿已保留")
            }
            reviewing = latest
        } catch is CancellationError { dictation.cancel() }
        catch {
            dictation.discardRecording(context: context)
            failure = error.localizedDescription
        }
    }
}

struct WatchResultText: View {
    let text: String
    static func preview(_ text: String) -> AttributedString {
        let source = MessageFormatting.blocks(text).map { block -> String in
            switch block {
            case .paragraph(let text), .heading(_, let text), .quote(let text): return text
            case .listItem(let marker, let text, _): return "\(marker) \(text)"
            case .code(_, let text): return text
            case .table(let rows): return rows.map { $0.joined(separator: " · ") }.joined(separator: "\n")
            case .divider: return ""
            }
        }.joined(separator: "\n\n")
        return (try? AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(source)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(MessageFormatting.blocks(text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .heading(_, let text): Text(Self.preview(text)).font(.headline)
                case .code(_, let text): ScrollView(.horizontal) { Text(verbatim: text).font(.system(.caption2, design: .monospaced)).fixedSize(horizontal: true, vertical: false) }
                default: Text(Self.previewText(block)).font(.footnote)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private static func previewText(_ block: MessageBlock) -> AttributedString {
        switch block {
        case .paragraph(let text), .quote(let text): return preview(text)
        case .listItem(let marker, let text, _): return preview("\(marker) \(text)")
        case .table(let rows): return preview(rows.map { $0.joined(separator: " · ") }.joined(separator: "\n"))
        default: return AttributedString("")
        }
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
        !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.sending && (draft.attempted || model.items.first(where: { $0.id == item.id })?.canContinue == true)
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if sent {
                    Label("已提交", systemImage: "checkmark.circle").foregroundStyle(.mint)
                    Text("等待执行").font(.footnote).foregroundStyle(.secondary)
                } else {
                    if draft.attempted, !model.sending {
                        Text(item.title).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Text(draft.text.isEmpty ? "还没有识别到文字" : draft.text).font(.footnote)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if draft.attempted { Text("发送结果待确认，重试不会重复创建任务。").font(.caption2).foregroundStyle(.secondary) }
                    if let error { Text(error).font(.caption2).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
                }
            }.padding(.horizontal, 2).padding(.bottom, 8)
        }.scrollIndicators(.hidden)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Group {
                if sent {
                    Button { dismiss() } label: { primaryLabel("返回任务") }
                        .buttonStyle(.plain)
                } else {
                    Button { Task { await send() } } label: {
                        primaryLabel(model.sending ? "发送中…" : draft.attempted ? "重试发送" : "发送")
                    }.buttonStyle(.plain).disabled(!canSend).opacity(canSend ? 1 : 0.4)
                }
            }.padding(.horizontal, 4).padding(.vertical, 4).background(.black)
        }
        .navigationTitle("").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(role: .cancel) {
                    if sent { dismiss() } else { cancelDraft() }
                } label: {
                    Image(systemName: "xmark").foregroundStyle(.secondary)
                }.buttonStyle(.plain).disabled(model.sending).accessibilityLabel("关闭语音输入")
            }
        }
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
    @MainActor private func cancelDraft() {
        if !draft.attempted {
            model.discardDraft(item.id, account: sourceAccount)
            draft = Draft(text: "")
        }
        dismiss()
    }
    @MainActor private func send() async {
        guard sourceAccount == model.account else { error = "连接配置已变化，请返回列表重新选择任务"; return }
        let resuming = draft.attempted
        draft.attempted = true
        do { try model.saveDraft(draft, id: item.id); try await model.send(item, draft: draft, resuming: resuming); sent = true; error = nil }
        catch {
            if let rejection = error as? APIError, let status = rejection.statusCode, (400...499).contains(status) {
                draft.attempted = false; draft.idempotencyKey = UUID().uuidString
                try? model.saveDraft(draft, id: item.id)
            }
            self.error = "尚未确认发送 · 草稿已保留\n\(error.localizedDescription)"
        }
    }
}
