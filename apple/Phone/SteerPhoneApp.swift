import SwiftUI

@main struct SteerPhoneApp: App {
    @StateObject private var pairing = Pairing()
    @StateObject private var model = WatchModel(source: "iphone")
    var body: some Scene { WindowGroup { PhoneHome(pairing: pairing).environmentObject(model) } }
}
struct PhoneSetup: View {
    @ObservedObject var pairing: Pairing
    @Environment(\.dismiss) private var dismiss
    @StateObject private var speech = PhoneSpeech.shared
    @State private var server = ""
    @State private var key = ""
    @State private var message = ""
    @State private var checking = false
    @State private var useSpeechService = false
    @State private var speechServer = ""
    @State private var speechKey = ""
    @State private var phoneSpeechLocale = "zh-CN"
    @State private var phoneSpeechEngine = "enhanced"
    private enum Page: Hashable { case connection, watch, speech }
    @State private var path: [Page] = []
    private var serverSummary: String { pairing.connection?.baseURL?.host ?? "未连接" }
    private var voiceSummary: String {
        guard let c = pairing.connection else { return "未配置" }
        return c.speech == nil ? (c.prefersEnhancedSpeech ? "iPhone · 增强转写" : "iPhone · 标准听写") : "自托管服务"
    }
    private var watchSummary: String {
        if !pairing.watchPaired { return "未配对" }
        if !pairing.watchAppInstalled { return "待安装" }
        return pairing.status == "手表已确认收到配置" ? "配置已同步" : "已配对"
    }
    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    NavigationLink(value: Page.connection) {
                        settingsRow("Steer 连接", icon: "network", value: serverSummary)
                    }
                    NavigationLink(value: Page.watch) {
                        settingsRow("Apple Watch", icon: "applewatch", value: watchSummary)
                    }
                }
                Section {
                    NavigationLink(value: Page.speech) {
                        settingsRow("语音输入", icon: "waveform", value: voiceSummary)
                    }
                }
            }.navigationTitle("设置").navigationBarTitleDisplayMode(.large)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("完成") { dismiss() } } }
                .navigationDestination(for: Page.self) { page in
                    Group {
                        switch page {
                        case .connection: connectionEditor
                        case .watch: watchEditor
                        case .speech: speechEditor
                        }
                    }.navigationBarTitleDisplayMode(.inline)
                }
            .onChange(of: path) { _, _ in message = "" }
            .onAppear { if let c = pairing.connection {
                server = c.server; key = c.apiKey
                useSpeechService = c.speech != nil; speechServer = c.speech?.server ?? ""; speechKey = c.speech?.apiKey ?? ""
                phoneSpeechLocale = c.recognitionLocale
                phoneSpeechEngine = c.prefersEnhancedSpeech ? "enhanced" : "standard"
            } }
            .task {
                #if DEBUG
                // Local model validation requires neither Speech permission
                // nor a microphone; don't wait for a permission dialog first.
                await pairing.runWatchSpeechDiagnostic()
                await pairing.runRemoteSpeechDiagnostic()
                if let c = pairing.connection {
                    useSpeechService = c.speech != nil; speechServer = c.speech?.server ?? ""; speechKey = c.speech?.apiKey ?? ""
                    phoneSpeechLocale = c.recognitionLocale
                    phoneSpeechEngine = c.prefersEnhancedSpeech ? "enhanced" : "standard"
                }
                #endif
                #if DEBUG
                await speech.runAudioDiagnostic()
                await speech.runLanguageComparison()
                await speech.runEnhancedDiagnostic()
                #endif
            }

        }
    }
    private func settingsRow(_ title: String, icon: String, value: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).foregroundStyle(.secondary).frame(width: 24)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.body)
                Text(value).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }.padding(.vertical, 8)
    }
    private var connectionEditor: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("服务器地址").font(.caption).foregroundStyle(.secondary)
                    TextField("https://steer.example.com", text: $server)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                }.padding(.vertical, 4)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Workspace API Key").font(.caption).foregroundStyle(.secondary)
                    SecureField("输入密钥", text: $key).textInputAutocapitalization(.never).autocorrectionDisabled()
                }.padding(.vertical, 4)
            }
            Section {
                Button(checking ? "正在验证…" : "验证并保存") { Task { await connect() } }.disabled(checking)
                if !message.isEmpty { Text(message).font(.footnote).foregroundStyle(.secondary) }
            }
            Section {
                DisclosureGroup("获取 API Key") {
                    Text("在 Steer 网页的 Settings → API access 创建密钥，选择 tasks:read、tasks:write、tasks:cancel 权限。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }.navigationTitle("Steer 连接")
    }
    private var watchEditor: some View {
        Form {
            Section {
                LabeledContent("配对", value: pairing.watchPaired ? "已配对" : "未配对")
                LabeledContent("Steer 应用", value: pairing.watchAppInstalled ? "已安装" : "未安装")
            }
            Section {
                Button("重新同步配置") { pairing.flush() }.disabled(pairing.connection == nil)
            } footer: {
                Text(pairing.status.isEmpty ? "打开手表上的 Steer 接收配置。" : pairing.status)
            }
        }.navigationTitle("Apple Watch")
    }
    private var speechEditor: some View {
        Form {
            Section {
                Toggle("自托管语音服务", isOn: Binding(get: { useSpeechService }, set: setSpeechServiceEnabled)).disabled(checking)
            }
            if useSpeechService {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("服务地址").font(.caption).foregroundStyle(.secondary)
                        TextField("https://speech.example.com", text: $speechServer)
                            .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("语音服务密钥").font(.caption).foregroundStyle(.secondary)
                        SecureField("输入密钥", text: $speechKey).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                }
            } else {
                Section {
                    Picker("语言", selection: $phoneSpeechLocale) {
                        Text("中文（普通话）").tag("zh-CN")
                        Text("English").tag("en-US")
                    }
                    if #available(iOS 26.0, *) {
                        Picker("识别模式", selection: $phoneSpeechEngine) {
                            Text("增强转写").tag("enhanced")
                            Text("标准听写").tag("standard")
                        }
                    }
                }
                Section {
                    Button("检查语音权限") { Task { await speech.authorize() } }
                    if #available(iOS 26.0, *) {
                        Button(speech.preparingModel ? "正在准备模型…" : "准备增强识别模型") {
                            Task { await speech.prepareLocalModel() }
                        }.disabled(speech.preparingModel)
                    }
                } footer: {
                    if !speech.status.isEmpty { Text(speech.status) }
                }
            }
            Section {
                Button(checking ? "正在保存…" : "保存并同步") { Task { await saveSpeech() } }
                    .disabled(checking || pairing.connection == nil)
                if !message.isEmpty { Text(message).font(.footnote).foregroundStyle(.secondary) }
            }
        }.navigationTitle("语音输入")
    }
    @MainActor private func saveSpeech() async {
        guard var config = pairing.connection else { return }
        checking = true; defer { checking = false }
        config.phoneSpeechLocale = phoneSpeechLocale
        config.phoneSpeechEngine = phoneSpeechEngine
        do {
            if useSpeechService {
                let service = SpeechService(server: speechServer.trimmingCharacters(in: .whitespacesAndNewlines), apiKey: speechKey.trimmingCharacters(in: .whitespacesAndNewlines))
                guard service.baseURL != nil, !service.apiKey.isEmpty else { message = "请填写有效的语音服务地址与密钥"; return }
                try await RemoteSpeech(service: service).check()
                config.speech = service
            } else { config.speech = nil }
            try pairing.save(config)
            message = "已保存，等待手表确认配置。"
        } catch { message = error.localizedDescription }
    }
    @MainActor private func setSpeechServiceEnabled(_ enabled: Bool) {
        useSpeechService = enabled
        guard !enabled, var config = pairing.connection, config.speech != nil else { return }
        config.speech = nil
        config.phoneSpeechLocale = phoneSpeechLocale
        config.phoneSpeechEngine = phoneSpeechEngine
        do {
            try pairing.save(config)
            message = "已保存关闭设置，等待手表确认收到配置。"
        } catch {
            useSpeechService = true
            message = "关闭未保存：\(error.localizedDescription)"
        }
    }
    @MainActor private func connect() async {
        var c = Connection(server: server.trimmingCharacters(in: .whitespacesAndNewlines), apiKey: key.trimmingCharacters(in: .whitespacesAndNewlines), web: "")
        c.phoneSpeechLocale = phoneSpeechLocale
        c.phoneSpeechEngine = phoneSpeechEngine
        if useSpeechService {
            let service = SpeechService(server: speechServer.trimmingCharacters(in: .whitespacesAndNewlines), apiKey: speechKey.trimmingCharacters(in: .whitespacesAndNewlines))
            guard service.baseURL != nil, !service.apiKey.isEmpty else { message = "请填写有效的语音服务地址与密钥"; return }
            c.speech = service
        }
        guard c.baseURL != nil, !c.apiKey.isEmpty else { message = "请填写有效的服务器地址与 API Key"; return }
        checking = true; defer { checking = false }
        do {
            _ = try await SteerAPI(connection: c).conversations()
            _ = try await SteerAPI(connection: c).projectDirectory()
            if let service = c.speech { try await RemoteSpeech(service: service).check() }
            try pairing.save(c); message = "连接已验证，配置已保存。"
        }
        catch { message = error.localizedDescription }
    }
}
