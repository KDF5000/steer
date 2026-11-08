import SwiftUI

@main struct SteerPhoneApp: App {
    @StateObject private var pairing = Pairing()
    var body: some Scene { WindowGroup { PhoneSetup(pairing: pairing) } }
}
struct PhoneSetup: View {
    @ObservedObject var pairing: Pairing
    @StateObject private var speech = PhoneSpeech.shared
    @State private var server = ""
    @State private var key = ""
    @State private var message = ""
    @State private var checking = false
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
                    Text(speech.status.isEmpty ? "手表录音由配对 iPhone 转为文字，支持时在本机识别。" : speech.status).font(.footnote)
                    Button("允许语音识别") { Task { await speech.authorize() } }
                }
                Section("真机连接") { Text("手表必须能访问服务器。localhost 指向手表自身；本地部署请使用可访问的局域网主机名或 HTTPS 地址。手表通过麦克风录音，由配对 iPhone 转写，发送前需要确认文字。").font(.footnote).foregroundStyle(.secondary) }
            }.navigationTitle("Steer Watch")
            .onAppear { if let c = pairing.connection { server = c.server; key = c.apiKey } }
            .task {
                #if DEBUG
                // Local model validation requires neither Speech permission
                // nor a microphone; don't wait for a permission dialog first.
                await pairing.runWatchSpeechDiagnostic()
                #endif
                await speech.authorize()
                #if DEBUG
                await speech.runAudioDiagnostic()
                #endif
            }

        }
    }
    @MainActor private func connect() async {
        let c = Connection(server: server.trimmingCharacters(in: .whitespacesAndNewlines), apiKey: key.trimmingCharacters(in: .whitespacesAndNewlines), web: "")
        guard c.baseURL != nil, !c.apiKey.isEmpty else { message = "请填写有效的服务器地址与 API Key"; return }
        checking = true; defer { checking = false }
        do { let items = try await SteerAPI(connection: c).conversations(); try pairing.save(c); message = "连接成功 · 找到 \(items.count) 个会话。请打开手表确认收到配置。" }
        catch { message = error.localizedDescription }
    }
}
