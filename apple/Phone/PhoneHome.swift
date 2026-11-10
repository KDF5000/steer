import SwiftUI

private enum PhoneRoute: Hashable {
    case project(WatchProject)
    case conversation(String)
}
struct PhoneHome: View {
    @ObservedObject var pairing: Pairing
    @EnvironmentObject var model: WatchModel
    @Environment(\.scenePhase) private var phase
    @State private var path: [PhoneRoute] = []
    @State private var showSettings = false
    @State private var search = ""
    private var visible: [Conversation] {
        search.isEmpty ? model.items : (model.projectItems["__search__"] ?? []).filter { "\($0.title) \($0.projectName) \($0.agentName)".localizedCaseInsensitiveContains(search) }
    }
    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if model.connection == nil {
                    ContentUnavailableView {
                        Label("连接 Steer", systemImage: "applewatch")
                    } actions: {
                        Button("连接工作空间") { showSettings = true }.buttonStyle(.borderedProminent)
                    }
                } else {
                    List {
                        let active = visible.filter { $0.running }
                        if !active.isEmpty {
                            Section("进行中 · \(active.count)") { ForEach(active) { row($0) } }
                        }
                        Section("项目") {
                            ForEach(model.projects.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }) { project in
                                NavigationLink(value: PhoneRoute.project(project)) {
                                    HStack(spacing: 12) {
                                        Image(systemName: "folder").foregroundStyle(.secondary)
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(project.name).font(.headline)
                                            Text("\(project.conversations) 个会话").font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        if project.activeTasks > 0 {
                                            Text("\(project.activeTasks) 进行中").font(.caption).foregroundStyle(.mint)
                                        }
                                    }.padding(.vertical, 8)
                                }
                            }
                        }
                        if !search.isEmpty {
                            Section("会话") { ForEach(visible.filter { !$0.running }) { row($0) } }
                            if model.loadingProjects.contains("__search__") { ProgressView() }
                            if let error = model.projectErrors["__search__"] { Text(error).font(.footnote).foregroundStyle(.secondary) }
                            if model.projectHasMore["__search__"] == true {
                                Button("加载更多搜索结果") { Task { await model.searchConversations(search, more: true) } }
                                    .disabled(model.loadingProjects.contains("__search__"))
                            }
                        }
                        if let error = model.projectsError {
                            Section { Text(error).font(.footnote).foregroundStyle(.secondary)
                                Button("重试") { Task { await model.refreshProjects() } }
                            }
                        }
                        if let error = model.error {
                            Section { Label(error, systemImage: "wifi.exclamationmark").font(.footnote).foregroundStyle(.secondary) }
                        }
                    }
                    .listStyle(.plain)
                    .searchable(text: $search, prompt: "搜索任务或项目")
                    .refreshable { await model.refresh() }
                    .task(id: "\(model.account):\(search)") {
                        do { try await Task.sleep(for: .milliseconds(300)); await model.searchConversations(search) }
                        catch {}
                    }
                    .overlay {
                        if !search.isEmpty, visible.isEmpty,
                           !model.projects.contains(where: { $0.name.localizedCaseInsensitiveContains(search) }),
                           !model.loadingProjects.contains("__search__"), model.projectErrors["__search__"] == nil {
                            ContentUnavailableView.search(text: search)
                        } else if model.projects.isEmpty && visible.isEmpty && model.error == nil && model.projectsError == nil {
                            if model.refreshing && model.items.isEmpty { ProgressView("加载任务") }
                            else if !search.isEmpty { ContentUnavailableView.search(text: search) }
                            else { ContentUnavailableView("暂无任务", systemImage: "tray") }
                        }
                    }
                }
            }
            .navigationTitle("任务")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("设置")
                }
            }
            .navigationDestination(for: PhoneRoute.self) { route in
                switch route {
                case .project(let project): PhoneProject(project: project).id(model.account + ":" + project.id)
                case .conversation(let id): PhoneConversation(id: id).id(model.account + ":" + id)
                }
            }
            .sheet(isPresented: $showSettings) { PhoneSetup(pairing: pairing) }
            .onChange(of: pairing.connection, initial: true) { _, value in
                model.configure(value)
                if phase == .active { Task { await model.refresh() } }
            }
            .onChange(of: model.account) { _, _ in path = [] }
            .task(id: phase) {
                guard phase == .active else { return }
                while !Task.isCancelled {
                    await model.refresh()
                    try? await Task.sleep(for: .seconds(15))
                }
            }
        }.tint(.mint)
    }
    private func row(_ item: Conversation) -> some View {
        NavigationLink(value: PhoneRoute.conversation(item.id)) {
            VStack(alignment: .leading, spacing: 8) {
                Text(item.title).font(.headline).lineLimit(2).foregroundStyle(.primary)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(item.projectName) / \(item.agentName)").lineLimit(1)
                    Spacer(minLength: 8)
                    PhoneTaskStatus(item: item, grouped: true)
                }.font(.caption).foregroundStyle(.secondary)
            }.padding(.vertical, 12)
        }
    }
}

struct PhoneProject: View {
    let project: WatchProject
    @EnvironmentObject var model: WatchModel
    @Environment(\.scenePhase) private var phase
    private var items: [Conversation] {
        (model.projectItems[project.id] ?? []).compactMap { entry in model.items.first { $0.id == entry.id } ?? entry }
    }
    var body: some View {
        List {
            let active = items.filter { $0.running }
            let recent = items.filter { !$0.running }
            if !active.isEmpty { Section("进行中") { ForEach(active) { row($0) } } }
            if !recent.isEmpty { Section("会话") { ForEach(recent) { row($0) } } }
            if let error = model.projectErrors[project.id] {
                Section { Text(error).font(.footnote).foregroundStyle(.secondary)
                    Button("重试") { Task { await model.refreshProject(project.id) } }
                }
            }
            if model.projectHasMore[project.id] == true {
                Button(model.loadingProjects.contains(project.id) ? "加载中…" : "加载更多会话") {
                    Task { await model.refreshProject(project.id, more: true) }
                }.disabled(model.loadingProjects.contains(project.id))
            }
        }.listStyle(.plain)
            .navigationTitle(project.name).navigationBarTitleDisplayMode(.inline)
            .refreshable { await model.refreshProject(project.id) }
            .overlay {
                if items.isEmpty && model.projectErrors[project.id] == nil {
                    if model.loadingProjects.contains(project.id) { ProgressView() }
                    else { ContentUnavailableView("暂无会话", systemImage: "bubble.left") }
                }
            }
            .task(id: "\(model.account):\(phase)") {
                guard phase == .active else { return }
                while !Task.isCancelled {
                    await model.refreshProject(project.id)
                    try? await Task.sleep(for: .seconds(15))
                }
            }
    }
    private func row(_ item: Conversation) -> some View {
        NavigationLink(value: PhoneRoute.conversation(item.id)) {
            VStack(alignment: .leading, spacing: 8) {
                Text(item.title).font(.headline).lineLimit(2)
                HStack {
                    Text(item.agentName).lineLimit(1)
                    Spacer()
                    PhoneTaskStatus(item: item, grouped: true)
                }.font(.caption).foregroundStyle(.secondary)
            }.padding(.vertical, 12)
        }
    }
}

private struct PhoneTaskStatus: View {
    let item: Conversation
    var grouped = false
    var body: some View {
        HStack(spacing: 4) {
            if !grouped && item.running { Circle().fill(.mint).frame(width: 4, height: 4) }
            if !grouped || !["running", "succeeded"].contains(item.status) { Text(item.label) }
            if item.executing {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    if let elapsed = item.elapsed(at: context.date) { Text(elapsed).monospacedDigit() }
                }
            }
        }.fixedSize(horizontal: true, vertical: false)
    }
}

struct PhoneConversation: View {
    let id: String
    @EnvironmentObject var model: WatchModel
    @StateObject private var speech = ResultSpeech()
    @Environment(\.scenePhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var draft = Draft(text: "")
    @State private var message: String?
    @State private var account = ""
    @State private var positioned = false
    @State private var showInfo = false
    @State private var confirmStop = false
    @State private var stopping = false
    @State private var spokenID: String?
    @State private var awayFromBottom = true
    @FocusState private var composing: Bool
    private var item: Conversation? { model.items.first { $0.id == id } }
    private var history: [ChatHistory.Message] { model.histories[id] ?? [] }
    private var currentModel: String? { history.last(where: { !$0.isUser && $0.context?.agentName == item?.agentName })?.context?.model }
    var body: some View {
        if let item {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 32) {
                        if history.isEmpty {
                            if let prompt = item.lastUserMessage, !prompt.isEmpty { PhoneUserMessage(text: prompt) }
                            if !item.summary.isEmpty && !item.running { assistant(item.summary, key: "result", context: nil, active: false, error: nil) }
                            if model.histories[id] == nil && model.historyErrors[id] == nil { ProgressView().frame(maxWidth: .infinity) }
                            if item.running { execution(item) }
                        } else {
                            ForEach(history) { entry in
                                Group {
                                    if entry.isUser { PhoneUserMessage(text: entry.content, reference: entry.context?.reference) }
                                    else {
                                        assistant(entry.content, key: entry.id, context: entry.context,
                                                  active: item.running && entry.id == history.last(where: { !$0.isUser })?.id,
                                                  error: entry.error)
                                    }
                                }.id(entry.id)
                            }
                            if item.running && history.last?.isUser == true { execution(item) }
                        }
                        if let error = model.historyErrors[id] {
                            Button { Task { await model.loadHistory(id) } } label: {
                                Label("对话加载失败，点击重试", systemImage: "arrow.clockwise").font(.footnote)
                            }.accessibilityHint(error)
                        }
                        if let error = model.error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                        Color.clear.frame(height: 1).id("conversation-bottom")
                            .onAppear { if #unavailable(iOS 18.0) { awayFromBottom = false } }
                            .onDisappear { if #unavailable(iOS 18.0) { awayFromBottom = true } }
                    }.frame(maxWidth: 680, alignment: .leading).frame(maxWidth: .infinity)
                        .padding(.horizontal, 16).padding(.vertical, 24)
                }
                .modifier(PhoneChatScrollTracking(awayFromBottom: $awayFromBottom))
                .overlay(alignment: .bottom) {
                    if awayFromBottom {
                        Button {
                            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.3)) { proxy.scrollTo("conversation-bottom", anchor: .bottom) }
                        } label: {
                            Image(systemName: "arrow.down").font(.body.weight(.medium)).frame(width: 40, height: 40)
                                .background(.regularMaterial, in: Circle())
                        }.buttonStyle(.plain).foregroundStyle(.primary).padding(.bottom, 12).accessibilityLabel("回到最新消息")
                    }
                }
                .scrollDismissesKeyboard(.interactively)
                .refreshable { await model.refreshTask(id); await model.loadHistory(id) }
                .onChange(of: history.map(\.id), initial: true) { old, ids in
                    guard !ids.isEmpty else { return }
                    if !positioned {
                        positioned = true
                        if history.count > 2 { proxy.scrollTo(history.last(where: { $0.isUser })?.id ?? ids.last!, anchor: .top) }
                    } else if old != ids && !awayFromBottom { proxy.scrollTo("conversation-bottom", anchor: .bottom) }
                }
                .onChange(of: composing) { _, focused in if focused { proxy.scrollTo("conversation-bottom", anchor: .bottom) } }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 2) {
                        Text(item.title.count > 60 ? "任务对话" : item.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                        Label(item.projectName, systemImage: "folder").labelStyle(.titleAndIcon).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("任务信息", systemImage: "info.circle") { showInfo = true }
                        Button("刷新对话", systemImage: "arrow.clockwise") { Task { await model.refreshTask(id); await model.loadHistory(id) } }
                        if item.running { Button("停止执行", systemImage: "stop", role: .destructive) { confirmStop = true } }
                    } label: { Image(systemName: "ellipsis") }.accessibilityLabel("会话操作")
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { composer(item) }
            .sheet(isPresented: $showInfo) {
                NavigationStack {
                    Form {
                        Section { Text(item.title).font(.body) }
                        Section {
                            LabeledContent("项目", value: item.projectName)
                            LabeledContent("Agent", value: item.agentName)
                            if let currentModel, !currentModel.isEmpty { LabeledContent("模型", value: currentModel) }
                            LabeledContent("状态", value: item.label)
                        }
                    }.navigationTitle("任务信息").navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("完成") { showInfo = false } } }
                }
            }
            .confirmationDialog("停止当前执行？", isPresented: $confirmStop, titleVisibility: .visible) {
                Button("停止执行", role: .destructive) { Task { await stop(item) } }
            }
            .task(id: "\(item.taskID ?? ""):\(item.status)") { await model.refreshTask(id); await model.loadHistory(id) }
            .onAppear { account = model.account; draft = model.draft(id) }
            .onChange(of: draft.text) { _, _ in if !draft.attempted { try? model.saveDraft(draft, id: id) } }
            .onChange(of: phase) { _, value in if value != .active { speech.stop() } }
            .onDisappear { speech.stop() }
        } else { ContentUnavailableView("任务已不在列表", systemImage: "tray") }
    }
    private func execution(_ item: Conversation) -> some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(item.executing ? "正在执行" : item.label)
            if item.executing {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    if let elapsed = item.elapsed(at: context.date) { Text(elapsed).monospacedDigit() }
                }
            }
        }.font(.caption).foregroundStyle(.secondary)
    }
    private func assistant(_ text: String, key: String, context: ChatHistory.Message.Context?, active: Bool, error: String?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let context, let name = context.agentName {
                Text([name, context.model].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
            }
            if active, let item { execution(item) }
            if !text.isEmpty { PhoneMarkdown(text: text) }
            if let error, !error.isEmpty { Text(error).font(.footnote).foregroundStyle(.red) }
            if !text.isEmpty {
                HStack(spacing: 0) {
                    PhoneCopyButton(text: text, label: "复制回复")
                    Button {
                        if speech.speaking && spokenID == key { speech.stop() }
                        else { spokenID = key; speech.play(text, locale: model.connection?.recognitionLocale ?? "zh-CN") }
                    } label: { Image(systemName: speech.speaking && spokenID == key ? "stop.fill" : "speaker.wave.2").frame(width: 40, height: 44).contentShape(Rectangle()) }
                        .accessibilityLabel(speech.speaking && spokenID == key ? "停止朗读" : "朗读回复")
                }.font(.footnote).buttonStyle(.plain).foregroundStyle(.secondary)
                if spokenID == key, let error = speech.error { Text(error).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }
    @ViewBuilder private func composer(_ item: Conversation) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let message { Text(message).font(.caption).foregroundStyle(.secondary) }
            if draft.attempted { Text("发送结果待确认").font(.caption).foregroundStyle(.secondary) }
            if item.canContinue || draft.attempted || item.running {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("提问或描述任务…", text: $draft.text, axis: .vertical)
                        .font(.body).lineLimit(1...5).focused($composing)
                        .disabled(draft.attempted || model.sending || !item.canContinue)
                        .accessibilityLabel("消息输入")
                    HStack(alignment: .center, spacing: 12) {
                        HStack(spacing: 4) {
                            Text(item.agentName)
                            if let currentModel, !currentModel.isEmpty { Text("·"); Text(currentModel) }
                        }.font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        Spacer(minLength: 8)
                        Button {
                            if item.running && !draft.attempted { confirmStop = true }
                            else { Task { await send(item) } }
                        } label: {
                            Group {
                                if model.sending || stopping { ProgressView().tint(.black) }
                                else { Image(systemName: item.running && !draft.attempted ? "stop.fill" : draft.attempted ? "arrow.clockwise" : "arrow.up").font(.body.weight(.semibold)) }
                            }.frame(width: 40, height: 40)
                                .foregroundStyle(actionEnabled ? Color.black : Color.secondary)
                                .background(actionEnabled ? Color.mint : Color.secondary.opacity(0.12), in: Circle())
                        }.buttonStyle(.plain).disabled(!actionEnabled)
                            .accessibilityLabel(item.running && !draft.attempted ? "停止执行" : draft.attempted ? "确认发送" : "发送回复")
                    }
                }.padding(12)
                    .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 24))
            }
        }.padding(.horizontal, 16).padding(.vertical, 8).background(Color(uiColor: .systemBackground))
    }
    private var actionEnabled: Bool {
        guard !model.sending, !stopping, let item else { return false }
        if item.running && !draft.attempted { return true }
        return (item.canContinue || draft.attempted) && !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    @MainActor private func stop(_ item: Conversation) async {
        guard account == model.account, let taskID = item.taskID else { return }
        stopping = true; defer { stopping = false }
        do { try await model.cancel(taskID); await model.loadHistory(id) }
        catch { message = error.localizedDescription }
    }
    @MainActor private func send(_ item: Conversation) async {
        guard account == model.account else { message = "连接配置已变化"; return }
        composing = false; message = nil
        let resuming = draft.attempted
        draft.attempted = true
        do {
            try model.saveDraft(draft, id: id)
            try await model.send(item, draft: draft, resuming: resuming)
            draft = Draft(text: ""); positioned = false
            await model.loadHistory(id)
        } catch {
            if let rejection = error as? APIError, let status = rejection.statusCode, (400...499).contains(status) {
                draft.attempted = false; draft.idempotencyKey = UUID().uuidString
                try? model.saveDraft(draft, id: id)
            }
            message = error.localizedDescription
        }
    }
}

private struct PhoneChatScrollTracking: ViewModifier {
    @Binding var awayFromBottom: Bool
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentSize.height - geometry.contentOffset.y - geometry.containerSize.height + geometry.contentInsets.bottom > 48
            } action: { _, away in awayFromBottom = away }
        } else { content }
    }
}

private struct PhoneUserMessage: View {
    let text: String
    var reference: ChatHistory.Message.Context.Reference? = nil
    @State private var expanded = false
    private var collapsible: Bool { text.count > 100 || text.components(separatedBy: "\n").count > 4 }
    var body: some View {
        HStack {
            Spacer(minLength: 80)
            VStack(alignment: .leading, spacing: 8) {
                if let reference {
                    VStack(alignment: .leading, spacing: 4) {
                        if let name = reference.agentName { Text(name).font(.caption.weight(.medium)) }
                        Text(reference.content).font(.caption).lineLimit(3)
                    }.foregroundStyle(.secondary).padding(.leading, 8)
                        .overlay(alignment: .leading) { Rectangle().fill(.secondary.opacity(0.3)).frame(width: 2) }
                }
                Text(text).font(.body).lineLimit(collapsible && !expanded ? 4 : nil).textSelection(.enabled)
                if collapsible { Button(expanded ? "收起" : "展开提问") { expanded.toggle() }.font(.caption) }
            }.padding(12)
                .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
                .contextMenu { Button("复制消息", systemImage: "doc.on.doc") { UIPasteboard.general.string = text } }
        }.frame(maxWidth: .infinity, alignment: .trailing)
    }
}

private struct PhoneCopyButton: View {
    let text: String
    let label: String
    @State private var copied = false
    var body: some View {
        Button { UIPasteboard.general.string = text; copied = true } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc").frame(width: 40, height: 44).contentShape(Rectangle())
        }.accessibilityLabel(copied ? "已复制" : label)
            .task(id: copied) {
                guard copied else { return }
                try? await Task.sleep(for: .seconds(2))
                copied = false
            }
    }
}

private struct PhoneMarkdown: View {
    let text: String
    private func inline(_ text: String) -> Text {
        Text((try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(MessageFormatting.blocks(text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let text):
                    inline(text).font(.body).textSelection(.enabled)
                case .heading(let level, let text):
                    inline(text).font(level <= 2 ? .title3.weight(.semibold) : .headline).padding(.top, 8)
                case .listItem(let marker, let text, let indent):
                    HStack(alignment: .top, spacing: 8) {
                        Text(marker).foregroundStyle(.secondary).monospacedDigit()
                        inline(text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    }.font(.body).padding(.leading, CGFloat(indent * 12))
                case .quote(let text):
                    inline(text).foregroundStyle(.secondary).textSelection(.enabled).padding(.leading, 12)
                        .overlay(alignment: .leading) { Rectangle().fill(.secondary.opacity(0.24)).frame(width: 2) }
                case .code(let language, let code):
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            if !language.isEmpty { Text(language).font(.caption).foregroundStyle(.secondary) }
                            Spacer()
                            Button { UIPasteboard.general.string = code } label: { Image(systemName: "doc.on.doc") }
                                .accessibilityLabel("复制代码").font(.caption).foregroundStyle(.secondary)
                        }
                        ScrollView(.horizontal) { Text(verbatim: code).font(.system(.footnote, design: .monospaced)).textSelection(.enabled).fixedSize(horizontal: true, vertical: false) }
                    }.padding(12).background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                case .table(let rows):
                    ScrollView(.horizontal) {
                        Grid(alignment: .topLeading, horizontalSpacing: 16, verticalSpacing: 12) {
                            ForEach(Array(rows.enumerated()), id: \.offset) { index, cells in
                                GridRow { ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in inline(cell).font(index == 0 ? .subheadline.weight(.semibold) : .subheadline).textSelection(.enabled) } }
                                if index == 0 { Divider().gridCellColumns(rows.map(\.count).max() ?? 1) }
                            }
                        }.padding(12)
                    }.background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                case .divider: Divider().padding(.vertical, 8)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
