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
    private var modernTask: Task<String, Error>?
    @Published private(set) var preparingModel = false

    func prepareLocalModel() async {
        guard !preparingModel else { return }
        guard #available(iOS 26.0, *) else { status = "当前系统使用标准本地识别"; return }
        preparingModel = true
        defer { preparingModel = false }
        let config: Connection? = SecureStore.read("connection")
        status = "正在准备增强本地识别模型，首次可能需要下载…"
        do {
            let module = try await ModernPhoneSpeech.module(locale: config?.recognitionLocale ?? "zh-CN", install: true)
            status = module != nil ? "增强本地识别已就绪，录音在 iPhone 处理" : "此设备或语言暂不支持增强模型，继续使用标准识别"
        } catch { status = "增强模型准备失败，可继续使用标准识别：\(error.localizedDescription)" }
    }

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
                      message["locale"] is String else { throw APIError(message: "录音信息缺失") }
                // Older Watches send Locale.current (often en_US even for
                // Chinese speech). The saved explicit speech language wins.
                let config: Connection? = SecureStore.read("connection")
                let recognitionLocale = config?.recognitionLocale ?? "zh-CN"
                upload = try VoiceUpload(id: id, totalBytes: count, digest: digest, locale: recognitionLocale)
                reply(["ok": true, "locale": recognitionLocale])
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
                let result = try await recognize(url: url, locale: current.locale, id: id)
                guard cancelledRequest != id else { throw APIError(message: "语音转写已取消") }
                status = "\(result.source)识别完成"
                reply(["text": result.text, "requestId": id, "source": result.source, "locale": current.locale])
            case "abort":
                if upload?.id == id { upload = nil }
                if activeRequest == id { cancelledRequest = id; modernTask?.cancel(); activeJob?.finish(.failure(APIError(message: "语音转写已取消"))) }
                reply(["ok": true])
            default: reply(["error": "请更新配对 iPhone 上的 Steer"])
            }
        } catch {
            if upload?.id == id { upload = nil }
            status = error.localizedDescription; reply(["error": error.localizedDescription, "requestId": id])
        }
    }
    #if DEBUG
    func runEnhancedDiagnostic() async {
        guard ProcessInfo.processInfo.environment["STEER_ENHANCED_SPEECH_SELF_TEST"] == "1" else { return }
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let output = cache.appendingPathComponent("SteerEnhancedSpeechDiagnostic.json")
        var report: [String: Any] = ["platform": "iOS", "runs": []]
        func write() {
            if let data = try? JSONSerialization.data(withJSONObject: report, options: .prettyPrinted) {
                try? data.write(to: output, options: .atomic)
            }
        }
        guard #available(iOS 26.0, *) else { report["error"] = "需要 iOS 26"; write(); return }
        report["available"] = SpeechTranscriber.isAvailable
        report["stage"] = "preparing"; write()
        do {
            guard try await ModernPhoneSpeech.module(locale: "zh-CN", install: true) != nil else { throw APIError(message: "中文增强模型不可用") }
            report["stage"] = "testing"; write()
            let data = try Data(contentsOf: cache.appendingPathComponent("SteerSpeechFixtures.json"))
            let fixtures = try JSONSerialization.jsonObject(with: data) as! [[String: String]]
            var runs: [[String: Any]] = []
            for fixture in fixtures {
                guard let name = fixture["file"], name == (name as NSString).lastPathComponent else { continue }
                let url = cache.appendingPathComponent(name)
                for engine in ["legacy", "enhanced"] {
                    var run: [String: Any] = ["file": name, "expected": fixture["text"] ?? "", "engine": engine, "onDevice": true]
                    let start = ContinuousClock.now
                    do {
                        if engine == "legacy" {
                            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN")), recognizer.supportsOnDeviceRecognition else { throw APIError(message: "标准本地模型不可用") }
                            run["text"] = try await recognizeOnce(url: url, recognizer: recognizer, onDevice: true, deadline: Date().addingTimeInterval(40))
                        } else {
                            guard let transcriber = try await ModernPhoneSpeech.module(locale: "zh-CN", install: false) else { throw APIError(message: "增强模型未安装") }
                            run["text"] = try await ModernPhoneSpeech.transcribe(url: url, transcriber: transcriber)
                        }
                    } catch { run["error"] = error.localizedDescription }
                    let time = start.duration(to: .now).components
                    run["milliseconds"] = time.seconds * 1000 + time.attoseconds / 1_000_000_000_000_000
                    runs.append(run); report["runs"] = runs; write()
                }
            }
            if let name = fixtures.last?["file"], let transcriber = try await ModernPhoneSpeech.module(locale: "zh-CN", install: false) {
                let task = Task { try await ModernPhoneSpeech.transcribe(url: cache.appendingPathComponent(name), transcriber: transcriber) }
                try await Task.sleep(for: .milliseconds(10))
                task.cancel()
                do { _ = try await task.value; report["cancellation"] = "completed-before-cancel" }
                catch { report["cancellation"] = error is CancellationError ? "cancelled" : error.localizedDescription }
                if let next = try await ModernPhoneSpeech.module(locale: "zh-CN", install: false) {
                    report["afterCancellation"] = try await ModernPhoneSpeech.transcribe(url: cache.appendingPathComponent(name), transcriber: next)
                }
            }
            report["stage"] = "complete"
        } catch { report["error"] = error.localizedDescription; report["stage"] = "failed" }
        write()
    }
    func runAudioDiagnostic() async {
        guard ProcessInfo.processInfo.environment["STEER_VOICE_SELF_TEST"] == "1" else { return }
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let input = cache.appendingPathComponent("steer-voice-self-test.m4a")
        let output = cache.appendingPathComponent("SteerVoiceDiagnostic.json")
        do {
            let bytes = try Data(contentsOf: input)
            let id = UUID().uuidString
            var response: [String: Any] = [:]
            let requestedLocale = ProcessInfo.processInfo.environment["STEER_VOICE_TEST_LOCALE"] ?? "en-US"
            await receive(["voiceAction": "begin", "requestId": id, "totalBytes": bytes.count, "digest": VoiceUpload.hash(bytes), "locale": requestedLocale]) { response = $0 }
            if let error = response["error"] as? String { throw APIError(message: error) }
            var sequence = 0
            for offset in stride(from: 0, to: bytes.count, by: VoiceUpload.chunkBytes) {
                let chunk = bytes.subdata(in: offset..<min(offset + VoiceUpload.chunkBytes, bytes.count))
                await receive(["voiceAction": "chunk", "requestId": id, "sequence": sequence, "audio": chunk]) { response = $0 }
                if let error = response["error"] as? String { throw APIError(message: error) }
                sequence += 1
            }
            await receive(["voiceAction": "finish", "requestId": id]) { response = $0 }
            response["audioBytes"] = bytes.count; response["chunks"] = sequence; response["requestedLocale"] = requestedLocale
            let data = try JSONSerialization.data(withJSONObject: response)
            try data.write(to: output, options: .atomic)
        } catch {
            let data = try? JSONSerialization.data(withJSONObject: ["error": error.localizedDescription])
            try? data?.write(to: output, options: .atomic)
        }
    }
    func runLanguageComparison() async {
        guard ProcessInfo.processInfo.environment["STEER_SPEECH_LANGUAGE_COMPARISON"] == "1" else { return }
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let url = cache.appendingPathComponent("steer-voice-self-test.m4a")
        var runs: [[String: Any]] = []
        for locale in ["en-US", "zh-CN"] {
            var run: [String: Any] = ["locale": locale, "onDevice": true]
            do {
                guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.supportsOnDeviceRecognition else { throw APIError(message: "本地语言模型不可用") }
                run["text"] = try await recognizeOnce(url: url, recognizer: recognizer, onDevice: true, deadline: Date().addingTimeInterval(40))
            } catch { run["error"] = error.localizedDescription }
            runs.append(run)
        }
        if let data = try? JSONSerialization.data(withJSONObject: runs, options: .prettyPrinted) {
            try? data.write(to: cache.appendingPathComponent("SteerSpeechLanguageComparison.json"), options: .atomic)
        }
    }
    #endif
    private func recognize(url: URL, locale: String, id: String) async throws -> (text: String, source: String) {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration).seconds
        guard cancelledRequest != id else { throw APIError(message: "语音转写已取消") }
        guard duration.isFinite, duration > 0, duration <= 65 else { throw APIError(message: "录音为空或超过一分钟，请重新录音") }
        let deadline = Date().addingTimeInterval(40)
        let config: Connection? = SecureStore.read("connection")
        if config?.prefersEnhancedSpeech != false, #available(iOS 26.0, *), let transcriber = try? await ModernPhoneSpeech.module(locale: locale, install: false) {
            guard cancelledRequest != id else { throw APIError(message: "语音转写已取消") }
            let job = Task { try await ModernPhoneSpeech.transcribe(url: url, transcriber: transcriber) }
            modernTask = job
            let background = UIApplication.shared.beginBackgroundTask(withName: "SteerEnhancedTranscription") { job.cancel() }
            defer {
                modernTask = nil
                if background != .invalid { UIApplication.shared.endBackgroundTask(background) }
            }
            do {
                let text = try await job.value
                guard cancelledRequest != id else { throw APIError(message: "语音转写已取消") }
                return (text, "iPhone 本地 · 增强")
            }
            catch {
                guard cancelledRequest != id, !(error is CancellationError) else { throw APIError(message: "语音转写已取消") }
                // Retry the same audio/language with the compatible system recognizer.
            }
        }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)),
              recognizer.isAvailable || recognizer.supportsOnDeviceRecognition else { throw APIError(message: "iPhone 语音识别暂不可用，请检查网络后重试") }
        do {
            let onDevice = recognizer.supportsOnDeviceRecognition
            let text = try await recognizeOnce(url: url, recognizer: recognizer, onDevice: onDevice, deadline: deadline)
            return (text, onDevice ? "iPhone 本地" : "Apple 云端")
        }
        catch {
            // Some supported languages still lack a downloaded local model.
            // The user's Speech authorization also permits Apple's recognition
            // service; use it only after a local recognition-service error.
            guard recognizer.supportsOnDeviceRecognition, recognizer.isAvailable,
                  !(error is APIError), cancelledRequest != id else { throw error }
            return (try await recognizeOnce(url: url, recognizer: recognizer, onDevice: false, deadline: deadline), "Apple 云端")
        }
    }
    private func recognizeOnce(url: URL, recognizer: SFSpeechRecognizer, onDevice: Bool, deadline: Date) async throws -> String {
        let remaining = deadline.timeIntervalSinceNow
        guard remaining > 0 else { throw APIError(message: "语音识别超时，请重新开始") }
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false; request.taskHint = .dictation
        request.contextualStrings = SpeechVocabulary.terms
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
