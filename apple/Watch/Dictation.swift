import SwiftUI
import WatchKit
import WatchConnectivity
import CryptoKit
import AVFoundation

@MainActor final class Dictation: ObservableObject {
    @Published private(set) var active = false
    @Published private(set) var phase = ""
    @Published private(set) var listening = false
    @Published private(set) var level: Float = 0
    @Published private(set) var recognitionSource = ""
    private var cancelled = false
    private var finishRequested = false
    private var localCancellation: LocalSpeechCancellation?
    private var pendingReply: VoiceReply?
    private var phoneRequest: String?
    private var remoteTask: Task<String, Error>?
    static var usesLocalSpeech: Bool {
        #if DEBUG
        return UserDefaults.standard.bool(forKey: "steer.localSpeechTest") && LocalSpeech.available
        #else
        return false // Enable only after physical Watch accuracy/latency validation.
        #endif
    }
    func finishSpeaking() { finishRequested = true }
    func cancel() {
        cancelled = true; localCancellation?.cancel()
        remoteTask?.cancel()
        pendingReply?.finish(.failure(CancellationError()))
        if let phoneRequest {
            WCSession.default.sendMessage(["voiceAction": "abort", "requestId": phoneRequest], replyHandler: nil, errorHandler: nil)
        }
    }
    private func recordingURL(_ context: String) -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("VoiceDrafts", isDirectory: true)
        return root.appendingPathComponent(VoiceUpload.hash(Data(context.utf8)) + ".m4a")
    }
    func discardRecording(context: String) { try? FileManager.default.removeItem(at: recordingURL(context)) }
    func hasRecording(for context: String) -> Bool { FileManager.default.fileExists(atPath: recordingURL(context).path) }
    func capture(context: String, rerecord: Bool = false, service: SpeechService? = nil, locale: String = "zh-CN") async throws -> String? {
        guard !active else { return nil }
        cancelled = false; finishRequested = false; recognitionSource = ""
        active = true; phase = "准备聆听…"
        defer {
            if cancelled { discardRecording(context: context) }
            active = false; phase = ""; listening = false; level = 0; localCancellation = nil; phoneRequest = nil; remoteTask = nil
        }
        let local = service == nil && Self.usesLocalSpeech
        let session = WCSession.default
        if !local && service == nil {
            phase = "连接 iPhone…"
            guard session.activationState == .activated, session.isReachable else { throw APIError(message: "无法连接配对 iPhone，请打开手机 Steer 后重试") }
            let capabilities: [String: Any]
            do { capabilities = try await exchange(["voiceAction": "capabilities"], timeout: 15) }
            catch { if cancelled { return nil }; throw error }
            guard capabilities["version"] as? Int == 1 else { throw APIError(message: "请更新配对 iPhone 上的 Steer") }
            guard capabilities["authorized"] as? Bool == true else { throw APIError(message: "请在 iPhone Steer 中允许语音识别，再开始录音") }
        }
        guard !cancelled else { return nil }
        let url = recordingURL(context)
        if rerecord { try? FileManager.default.removeItem(at: url) }
        if !FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let saved: Bool
            do { saved = try await record(url: url) }
            catch { try? FileManager.default.removeItem(at: url); throw error }
            guard saved else { try? FileManager.default.removeItem(at: url); return nil }
        }
        guard !cancelled else { return nil }
        phase = "请稍候"
        if let service {
            phase = "正在识别…"
            let audio = try Data(contentsOf: url)
            let task = Task { try await RemoteSpeech(service: service).transcribe(audio) }
            remoteTask = task
            do {
                let text = try await task.value
                guard !cancelled else { return nil }
                recognitionSource = "自托管服务"
                return text
            } catch {
                if cancelled { return nil }
                throw error
            }
        }
        if local {
            let cancellation = LocalSpeechCancellation(); localCancellation = cancellation
            let name = UserDefaults.standard.string(forKey: "steer.localSpeechModel") ?? "base-q5_1"
            let result: LocalSpeechResult
            do { result = try await LocalSpeech.shared.recognize(url: url, cancellation: cancellation, modelName: name) }
            catch { if cancelled { return nil }; throw error }
            guard !cancelled else { return nil }
            recognitionSource = "手表本地"
            return result.text
        }
        let audio = try Data(contentsOf: url)
        guard !audio.isEmpty, audio.count <= VoiceUpload.maximumBytes else { throw APIError(message: "录音为空或文件过大，请重新录音") }
        phase = "发送录音…"
        let id = UUID().uuidString
        phoneRequest = id
        do {
            _ = try await exchange(["voiceAction": "begin", "requestId": id, "totalBytes": audio.count,
                "digest": VoiceUpload.hash(audio), "locale": locale], timeout: 15)
            var sequence = 0
            for offset in stride(from: 0, to: audio.count, by: VoiceUpload.chunkBytes) {
                guard !cancelled else { throw CancellationError() }
                let chunk = audio.subdata(in: offset..<min(offset + VoiceUpload.chunkBytes, audio.count))
                _ = try await exchange(["voiceAction": "chunk", "requestId": id, "sequence": sequence, "audio": chunk], timeout: 15)
                sequence += 1
            }
            phase = "正在识别…"
            let reply = try await exchange(["voiceAction": "finish", "requestId": id], timeout: 50)
            guard !cancelled else { return nil }
            guard reply["requestId"] as? String == id, let text = reply["text"] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw APIError(message: "没有听清，请重新开始") }
            recognitionSource = reply["source"] as? String ?? "iPhone 识别"
            return text
        } catch {
            session.sendMessage(["voiceAction": "abort", "requestId": id], replyHandler: nil, errorHandler: nil)
            if cancelled { return nil }
            throw error
        }
    }
    private func record(url: URL) async throws -> Bool {
        phase = "开启麦克风…"
        let granted = await AVAudioApplication.requestRecordPermission()
        guard granted else { throw APIError(message: "请在手表设置中允许 Steer 使用麦克风") }
        guard !cancelled else { return false }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
        defer { try? session.setActive(false); listening = false; level = 0 }
        let recorder = try AVAudioRecorder(url: url, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 32_000,
        ])
        recorder.isMeteringEnabled = true
        guard recorder.record() else { throw APIError(message: "麦克风暂不可用，请重试") }
        defer { recorder.stop() }
        listening = true; phase = "正在听…"
        WKInterfaceDevice.current().play(.start)
        var endpoint = SpeechEndpoint()
        while true {
            try await Task.sleep(for: .milliseconds(100))
            if cancelled { return false }
            guard recorder.isRecording else { throw APIError(message: "聆听被中断，请再说一次") }
            recorder.updateMeters()
            let power = recorder.averagePower(forChannel: 0)
            level = max(0, min(1, (power + 55) / 40))
            let decision = endpoint.update(power: power, time: recorder.currentTime, finished: finishRequested)
            if decision == .noSpeech {
                throw APIError(message: "没有听到说话，请再试一次")
            }
            if decision == .complete {
                recorder.stop(); WKInterfaceDevice.current().play(.stop)
                return true
            }
        }
    }
    private func exchange(_ message: [String: Any], timeout: Double) async throws -> [String: Any] {
        guard !cancelled else { throw CancellationError() }
        defer { pendingReply = nil }
        return try await withCheckedThrowingContinuation { continuation in
            let reply = VoiceReply(continuation)
            pendingReply = reply
            let deadline = DispatchWorkItem { reply.finish(.failure(APIError(message: "无法完成语音传输，请打开 iPhone Steer 后重试"))) }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: deadline)
            WCSession.default.sendMessage(message, replyHandler: { value in
                deadline.cancel()
                if let error = value["error"] as? String { reply.finish(.failure(APIError(message: error))) }
                else { reply.finish(.success(value)) }
            }, errorHandler: { error in deadline.cancel(); reply.finish(.failure(APIError(message: "录音传输失败：\(error.localizedDescription)"))) })
        }
    }
}
private final class VoiceReply: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<[String: Any], Error>?
    init(_ continuation: CheckedContinuation<[String: Any], Error>) { self.continuation = continuation }
    func finish(_ result: Result<[String: Any], Error>) {
        lock.lock(); let pending = continuation; continuation = nil; lock.unlock()
        pending?.resume(with: result)
    }
}
