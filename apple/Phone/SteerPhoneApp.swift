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
    var body: some View {
        NavigationStack {
            Form {
                Section("连接 Steer") {
                    TextField("服务器地址，如 https://steer.example.com", text: $server).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    SecureField("Workspace API Key", text: $key).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Text("在 Steer 网页 Settings → API access 创建 Key。需要 tasks:read、tasks:write、tasks:cancel 权限。").font(.footnote).foregroundStyle(.secondary)
                    Button(checking ? "正在验证…" : "验证并同步到手表") { Task { await connect() } }.disabled(checking)
                }
                if !message.isEmpty { Section { Text(message).font(.footnote) } }
                Section("手表配置") {
                    if pairing.watchPaired {
                        Label(pairing.watchAppInstalled ? "Watch 端已安装" : "手表已配对 · Watch 端尚未安装", systemImage: pairing.watchAppInstalled ? "checkmark.circle" : "applewatch")
                            .font(.footnote)
                    }
                    Text(pairing.status.isEmpty ? "请安装并打开配对手表上的 Steer App。" : pairing.status).font(.footnote)
                    Button("重新同步配置") { pairing.flush() }.disabled(pairing.connection == nil)
                }
                Section("语音转写") {
                    Toggle("使用自托管语音服务", isOn: Binding(get: { useSpeechService }, set: setSpeechServiceEnabled)).disabled(checking)
                    if useSpeechService {
                        TextField("语音服务地址，如 https://speech.example.com", text: $speechServer).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                        SecureField("语音服务密钥", text: $speechKey).textInputAutocapitalization(.never).autocorrectionDisabled()
                        Text("手表录音直接发送到此服务，识别后确认文字再提交任务。请使用独立语音密钥；公网使用 HTTPS。填写后点击上方验证并同步。").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Picker("iPhone 识别语言", selection: $phoneSpeechLocale) {
                            Text("中文（普通话）").tag("zh-CN")
                            Text("English").tag("en-US")
                        }
                        if #available(iOS 26.0, *) {
                            Picker("本地识别模式", selection: $phoneSpeechEngine) {
                                Text("增强转写").tag("enhanced")
                                Text("标准听写").tag("standard")
                            }
                        }
                        Text("语言不会跟随系统地区自动变化。修改语言或模式后点击上方验证并同步。").font(.footnote).foregroundStyle(.secondary)
                        Text(speech.status.isEmpty ? "手表录音由配对 iPhone 转为文字，支持时在本机识别，必要时使用 Apple 识别服务。" : speech.status).font(.footnote)
                        Button("允许语音识别") { Task { await speech.authorize() } }
                        if #available(iOS 26.0, *) {
                            Button(speech.preparingModel ? "正在准备模型…" : "准备增强本地识别") { Task { await speech.prepareLocalModel() } }.disabled(speech.preparingModel)
                        }
                    }
                }
            }.navigationTitle("设置").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("完成") { dismiss() } } }
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
            let items = try await SteerAPI(connection: c).conversations()
            if let service = c.speech { try await RemoteSpeech(service: service).check() }
            try pairing.save(c); message = "连接成功 · 找到 \(items.count) 个会话。请打开手表确认收到配置。"
        }
        catch { message = error.localizedDescription }
    }
}
