import Foundation
import WatchConnectivity
import SwiftUI
#if os(watchOS)
import WatchKit
#endif

final class Pairing: NSObject, ObservableObject, WCSessionDelegate {
    @Published var connection: Connection? = SecureStore.read("connection")
    @Published var status = ""
    @Published var watchPaired = false
    @Published var watchAppInstalled = false
    private var pending: [String: Any]?
    #if DEBUG
    private var speechDiagnosticRunning = false
    #endif
    override init() {
        super.init()
        if WCSession.isSupported() { WCSession.default.delegate = self; WCSession.default.activate() }
    }
    @MainActor func save(_ value: Connection) throws {
        try SecureStore.write(value, key: "connection")
        connection = value
        pending = ["connection": try JSONEncoder().encode(value)]
        flush()
    }
    @MainActor func flush() {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else {
            status = "配置已保存，等待配对连接就绪"; return
        }
        do {
            #if os(iOS)
            refreshWatchState()
            guard watchPaired else { status = "请先配对 Apple Watch"; return }
            guard watchAppInstalled else { status = "手表已配对，请在 iPhone 的 Watch App 中安装 Steer"; return }
            #endif
            let payload = try pending ?? connection.map { ["connection": try JSONEncoder().encode($0)] }
            guard let payload else { return }
            try WCSession.default.updateApplicationContext(payload)
            pending = nil; status = "配置已交给配对连接，请在手表确认收到"
        } catch { status = error.localizedDescription }
    }
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in if let error { self.status = error.localizedDescription } else {
            #if os(iOS)
            self.flush()
            #endif
        } }
    }
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String : Any]) {
        guard let data = applicationContext["connection"] as? Data, let config = try? JSONDecoder().decode(Connection.self, from: data) else { return }
        Task { @MainActor in
            do {
                try SecureStore.write(config, key: "connection"); self.connection = config; self.status = "已收到 iPhone 配置"
                #if os(watchOS)
                session.transferUserInfo(["configurationAck": config.speech?.server ?? "phone",
                                          "build": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown"])
                #endif
            }
            catch { self.status = error.localizedDescription }
        }
    }
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        #if os(iOS)
        guard let endpoint = userInfo["configurationAck"] as? String else { return }
        Task { @MainActor in
            guard endpoint == (self.connection?.speech?.server ?? "phone") else { return }
            self.status = "手表已确认收到配置"
            #if DEBUG
            if let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
               let data = try? JSONSerialization.data(withJSONObject: ["speechEndpoint": endpoint,
                   "watchBuild": userInfo["build"] as? String ?? "unknown",
                   "acknowledgedAt": ISO8601DateFormatter().string(from: Date())]) {
                try? data.write(to: cache.appendingPathComponent("SteerWatchConfigurationAck.json"), options: .atomic)
            }
            #endif
        }
        #endif
    }
    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        #if os(iOS)
        Task { @MainActor in await PhoneSpeech.shared.receive(message, reply: replyHandler) }
        #else
        replyHandler(["error": "此设备无法进行语音转写"])
        #endif
    }
    #if DEBUG
    // Only developer-triggered synthetic clips use this transport. Live local
    // recognition never sends the user's recording back to the phone.
    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        guard let kind = file.metadata?["steerSpeechDiagnostic"] as? String,
              let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        #if os(watchOS)
        guard kind == "input" else { return }
        let input = cache.appendingPathComponent("steer-voice-self-test.m4a")
        do {
            try? FileManager.default.removeItem(at: input)
            try FileManager.default.copyItem(at: file.fileURL, to: input)
        } catch { return }
        Task { @MainActor in await self.runStoredWatchSpeechDiagnostic() }
        #else
        guard kind == "result" else { return }
        let output = cache.appendingPathComponent("SteerWatchSpeechDiagnostic.json")
        try? FileManager.default.removeItem(at: output)
        try? FileManager.default.copyItem(at: file.fileURL, to: output)
        #endif
    }
    #if os(watchOS)
    @MainActor func runStoredWatchSpeechDiagnostic() async {
        guard !speechDiagnosticRunning, WKApplication.shared().applicationState == .active,
              let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let input = cache.appendingPathComponent("steer-voice-self-test.m4a")
        guard FileManager.default.fileExists(atPath: input.path) else { return }
        speechDiagnosticRunning = true; defer { speechDiagnosticRunning = false }
        await LocalSpeech.shared.diagnostic(url: input)
        let output = cache.appendingPathComponent("SteerLocalSpeechDiagnostic.json")
        if FileManager.default.fileExists(atPath: output.path) {
            WCSession.default.transferFile(output, metadata: ["steerSpeechDiagnostic": "result"])
            try? FileManager.default.removeItem(at: input)
        }
    }
    #endif
    #if os(iOS)
    @MainActor func runRemoteSpeechDiagnostic() async {
        guard ProcessInfo.processInfo.environment["STEER_REMOTE_SPEECH_SELF_TEST"] == "1",
              let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let configFile = cache.appendingPathComponent("SteerSpeechService.json")
        let output = cache.appendingPathComponent("SteerRemoteSpeechDiagnostic.json")
        var report: [String: Any] = ["platform": "iOS"]
        defer {
            try? FileManager.default.removeItem(at: configFile)
            if let data = try? JSONSerialization.data(withJSONObject: report, options: .prettyPrinted) {
                try? data.write(to: output, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
        }
        do {
            let service = try JSONDecoder().decode(SpeechService.self, from: Data(contentsOf: configFile))
            let client = RemoteSpeech(service: service)
            try await client.check()
            let audio = try Data(contentsOf: cache.appendingPathComponent("steer-voice-self-test.m4a"))
            let started = ContinuousClock.now
            report["text"] = try await client.transcribe(audio)
            let elapsed = started.duration(to: .now).components
            report["elapsedMilliseconds"] = elapsed.seconds * 1000 + elapsed.attoseconds / 1_000_000_000_000_000
            report["endpoint"] = service.server
            guard var config = connection else { throw APIError(message: "请先配置 Steer 连接") }
            config.speech = service
            try save(config)
            report["configurationSaved"] = true
            report["watchPaired"] = WCSession.default.isPaired
            report["watchAppInstalled"] = WCSession.default.isWatchAppInstalled
            report["watchReachable"] = WCSession.default.isReachable
            report["syncStatus"] = status
        } catch { report["error"] = error.localizedDescription }
    }
    @MainActor func runWatchSpeechDiagnostic() async {
        guard ProcessInfo.processInfo.environment["STEER_LOCAL_SPEECH_SELF_TEST"] == "1",
              let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let input = cache.appendingPathComponent("steer-voice-self-test.m4a")
        guard FileManager.default.fileExists(atPath: input.path) else { return }
        print("Steer local speech diagnostic started (synthetic audio)")
        await LocalSpeech.shared.diagnostic(url: input)
        print("Steer local speech diagnostic finished")
        for _ in 0..<20 {
            if WCSession.default.activationState == .activated { break }
            try? await Task.sleep(for: .milliseconds(500))
        }
        guard WCSession.default.activationState == .activated, WCSession.default.isPaired, WCSession.default.isWatchAppInstalled else { return }
        WCSession.default.transferFile(input, metadata: ["steerSpeechDiagnostic": "input"])
    }
    #endif
    #endif
    #if os(iOS)
    @MainActor private func refreshWatchState() {
        watchPaired = WCSession.default.isPaired
        watchAppInstalled = WCSession.default.isWatchAppInstalled
        #if DEBUG
        if ProcessInfo.processInfo.environment["STEER_PAIRING_DIAGNOSTICS"] == "1" {
            let values: [String: Any] = ["paired": watchPaired, "watchAppInstalled": watchAppInstalled,
                "reachable": WCSession.default.isReachable, "activationState": WCSession.default.activationState.rawValue]
            if let data = try? JSONSerialization.data(withJSONObject: values),
               let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first {
                try? data.write(to: cache.appendingPathComponent("SteerPairing.json"), options: .atomic)
            }
        }
        #endif
    }
    func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in self.flush() }
    }
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }
    #endif
}
