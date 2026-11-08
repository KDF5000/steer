#if os(iOS)
import Foundation
import SwiftUI
import Speech
import AVFoundation
import UIKit

@MainActor final class PhoneSpeech: ObservableObject {
    static let shared = PhoneSpeech()
    @Published var status = ""
    private var upload: VoiceUpload?
    private var activeJob: SpeechJob?
    private var activeRequest: String?
    private var cancelledRequest: String?
    private var requestingPermission = false

    func authorize() async {
        guard !requestingPermission else { return }
        requestingPermission = true; defer { requestingPermission = false }
        let granted: SFSpeechRecognizerAuthorizationStatus
        if SFSpeechRecognizer.authorizationStatus() == .notDetermined {
            granted = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
            }
        } else { granted = SFSpeechRecognizer.authorizationStatus() }
        status = granted == .authorized ? "语音转写已就绪" : "语音识别未授权，请在系统设置中开启"
    }
    func receive(_ message: [String: Any], reply: @escaping ([String: Any]) -> Void) async {
        guard let action = message["voiceAction"] as? String else { reply(["error": "不支持此语音请求"]); return }
        if action == "capabilities" {
            reply(["version": 1, "authorized": SFSpeechRecognizer.authorizationStatus() == .authorized]); return
        }
        guard let id = message["requestId"] as? String else { reply(["error": "录音请求无效"]); return }
        do {
            switch action {
            case "begin":
                guard SFSpeechRecognizer.authorizationStatus() == .authorized else { throw APIError(message: "请在 iPhone Steer 中开启语音识别") }
                guard activeRequest == nil else { throw APIError(message: "上一段语音仍在转写，请稍后重试") }
                guard let count = message["totalBytes"] as? Int, let digest = message["digest"] as? String,
                      let locale = message["locale"] as? String else { throw APIError(message: "录音信息缺失") }
                upload = try VoiceUpload(id: id, totalBytes: count, digest: digest, locale: locale)
                reply(["ok": true])
            case "chunk":
                guard var current = upload, current.id == id, Date().timeIntervalSince(current.startedAt) < 120,
                      let sequence = message["sequence"] as? Int, let bytes = message["audio"] as? Data else { throw APIError(message: "录音传输已失效，请重试") }
                try current.append(bytes, sequence: sequence); upload = current; reply(["ok": true])
            case "finish":
                guard let current = upload, current.id == id, activeRequest == nil else { throw APIError(message: "录音尚未完整接收") }
                let bytes = try current.finish(); upload = nil
                activeRequest = id; cancelledRequest = nil
                defer { activeRequest = nil; cancelledRequest = nil; activeJob = nil }
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("steer-voice-\(UUID().uuidString).m4a")
                try bytes.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                defer { try? FileManager.default.removeItem(at: url) }
                status = "正在转写手表录音…"
                let text = try await recognize(url: url, locale: current.locale, id: id)
                status = "语音转写完成"; reply(["text": text, "requestId": id])
            case "abort":
                if upload?.id == id { upload = nil }
                if activeRequest == id { cancelledRequest = id; activeJob?.finish(.failure(APIError(message: "语音转写已取消"))) }
                reply(["ok": true])
            default: reply(["error": "请更新配对 iPhone 上的 Steer"])
            }
        } catch {
            if upload?.id == id { upload = nil }
            status = error.localizedDescription; reply(["error": error.localizedDescription, "requestId": id])
        }
    }
    #if DEBUG
    func runAudioDiagnostic() async {
        guard ProcessInfo.processInfo.environment["STEER_VOICE_SELF_TEST"] == "1" else { return }
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let input = cache.appendingPathComponent("steer-voice-self-test.m4a")
        let output = cache.appendingPathComponent("SteerVoiceDiagnostic.json")
        do {
            let bytes = try Data(contentsOf: input)
            let id = UUID().uuidString
            var response: [String: Any] = [:]
            await receive(["voiceAction": "begin", "requestId": id, "totalBytes": bytes.count, "digest": VoiceUpload.hash(bytes), "locale": "zh-CN"]) { response = $0 }
            if let error = response["error"] as? String { throw APIError(message: error) }
            var sequence = 0
            for offset in stride(from: 0, to: bytes.count, by: VoiceUpload.chunkBytes) {
                let chunk = bytes.subdata(in: offset..<min(offset + VoiceUpload.chunkBytes, bytes.count))
                await receive(["voiceAction": "chunk", "requestId": id, "sequence": sequence, "audio": chunk]) { response = $0 }
                if let error = response["error"] as? String { throw APIError(message: error) }
                sequence += 1
            }
            await receive(["voiceAction": "finish", "requestId": id]) { response = $0 }
            response["audioBytes"] = bytes.count; response["chunks"] = sequence
            let data = try JSONSerialization.data(withJSONObject: response)
            try data.write(to: output, options: .atomic)
        } catch {
            let data = try? JSONSerialization.data(withJSONObject: ["error": error.localizedDescription])
            try? data?.write(to: output, options: .atomic)
        }
    }
    #endif
    private func recognize(url: URL, locale: String, id: String) async throws -> String {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration).seconds
        guard cancelledRequest != id else { throw APIError(message: "语音转写已取消") }
        guard duration.isFinite, duration > 0, duration <= 65 else { throw APIError(message: "录音为空或超过一分钟，请重新录音") }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)) ?? SFSpeechRecognizer(),
              recognizer.isAvailable || recognizer.supportsOnDeviceRecognition else { throw APIError(message: "iPhone 语音识别暂不可用，请检查网络后重试") }
        let deadline = Date().addingTimeInterval(40)
        do { return try await recognizeOnce(url: url, recognizer: recognizer, onDevice: recognizer.supportsOnDeviceRecognition, deadline: deadline) }
        catch {
            // Some supported languages still lack a downloaded local model.
            // The user's Speech authorization also permits Apple's recognition
            // service; use it only after a local recognition-service error.
            guard recognizer.supportsOnDeviceRecognition, recognizer.isAvailable,
                  !(error is APIError), cancelledRequest != id else { throw error }
            return try await recognizeOnce(url: url, recognizer: recognizer, onDevice: false, deadline: deadline)
        }
    }
    private func recognizeOnce(url: URL, recognizer: SFSpeechRecognizer, onDevice: Bool, deadline: Date) async throws -> String {
        let remaining = deadline.timeIntervalSinceNow
        guard remaining > 0 else { throw APIError(message: "语音识别超时，请重新开始") }
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false; request.taskHint = .dictation
        request.requiresOnDeviceRecognition = onDevice
        return try await withCheckedThrowingContinuation { continuation in
            let job = SpeechJob(continuation: continuation); activeJob = job
            job.background = UIApplication.shared.beginBackgroundTask(withName: "SteerVoiceTranscription") {
                Task { @MainActor in job.finish(.failure(APIError(message: "iPhone 后台转写时间不足，请打开 Steer 后重试"))) }
            }
            job.deadline = Task { @MainActor in
                do { try await Task.sleep(for: .seconds(remaining)) } catch { return }
                job.finish(.failure(APIError(message: "语音识别超时，请重新开始")))
            }
            job.task = recognizer.recognitionTask(with: request) { result, error in
                Task { @MainActor in
                    if let result, result.isFinal {
                        let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                        job.finish(text.isEmpty ? .failure(APIError(message: "未识别到语音，请重新录音")) : .success(text))
                    } else if let error { job.finish(.failure(error)) }
                }
            }
        }
    }
}
@MainActor private final class SpeechJob {
    var task: SFSpeechRecognitionTask?
    var deadline: Task<Void, Never>?
    var background = UIBackgroundTaskIdentifier.invalid
    private var continuation: CheckedContinuation<String, Error>?
    init(continuation: CheckedContinuation<String, Error>) { self.continuation = continuation }
    func finish(_ result: Result<String, Error>) {
        guard let continuation else { return }; self.continuation = nil
        deadline?.cancel(); deadline = nil; task?.cancel(); task = nil
        if background != .invalid { UIApplication.shared.endBackgroundTask(background); background = .invalid }
        continuation.resume(with: result)
    }
}
#endif
