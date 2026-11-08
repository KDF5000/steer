#if canImport(SteerLocalASR)
import Foundation
import AVFoundation
import SteerLocalASR

final class LocalSpeechCancellation: @unchecked Sendable {
    let pointer = steer_asr_cancellation_create()!
    func cancel() { steer_asr_cancel(pointer) }
    deinit { steer_asr_cancellation_free(pointer) }
}
struct LocalSpeechResult: Sendable {
    let text: String
    let seconds: Double
    let loadMilliseconds: Double
    let recognitionMilliseconds: Double
    // Process lifetime high-water mark, not just the model allocation.
    let peakProcessMB: Double
}
actor LocalSpeech {
    static let shared = LocalSpeech()
    static var available: Bool { Bundle.main.url(forResource: "ggml-base-q5_1", withExtension: "bin") != nil }
    func recognize(url: URL, cancellation: LocalSpeechCancellation, modelName: String = "base-q5_1") throws -> LocalSpeechResult {
        guard ["tiny-q5_1", "base-q5_1"].contains(modelName),
              let model = Bundle.main.url(forResource: "ggml-" + modelName, withExtension: "bin") else { throw APIError(message: "本地语音模型未安装") }
        let file = try AVAudioFile(forReading: url)
        let source = file.processingFormat
        guard file.length > 0, Double(file.length) / source.sampleRate <= 30,
              let input = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: AVAudioFrameCount(file.length)) else { throw APIError(message: "语音为空或过长，请再说一次") }
        try file.read(into: input)
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
        guard let converter = AVAudioConverter(from: source, to: format),
              let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(ceil(Double(input.frameLength) * 16_000 / source.sampleRate) + 1024)) else { throw APIError(message: "无法读取语音") }
        var supplied = false
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, state in
            if supplied { state.pointee = .endOfStream; return nil }
            supplied = true; state.pointee = .haveData; return input
        }
        if let conversionError { throw conversionError }
        guard status != .error, output.frameLength > 0, let samples = output.floatChannelData?[0] else { throw APIError(message: "无法解码语音") }
        var text = [CChar](repeating: 0, count: 8192)
        var metrics = SteerASRMetrics()
        let seconds = Double(output.frameLength) / 16_000
        let locale = Locale.current.language.languageCode?.identifier ?? "zh"
        let language = locale == "zh" ? "zh" : "auto"
        let code = model.path.withCString { path in
            language.withCString { lang in
                steer_asr_transcribe(path, samples, Int32(output.frameLength), lang, 2, 0, &text, text.count, &metrics, cancellation.pointer)
            }
        }
        guard code == 0 else { throw APIError(message: code == 4 ? "语音识别已取消或超时，请重新开始" : "没有听清，请重新开始（\(code)）") }
        let transcript = String(cString: text).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !transcript.isEmpty else { throw APIError(message: "没有听清，请再说一次") }
        return LocalSpeechResult(text: transcript, seconds: seconds, loadMilliseconds: metrics.load_ms,
                                 recognitionMilliseconds: metrics.recognition_ms, peakProcessMB: metrics.peak_process_mb)
    }
    #if DEBUG
    func diagnostic(url: URL) async {
        let output = url.deletingLastPathComponent().appendingPathComponent("SteerLocalSpeechDiagnostic.json")
        var runs: [[String: Any]] = []
        for name in ["tiny-q5_1", "base-q5_1"] {
            do {
                let result = try recognize(url: url, cancellation: LocalSpeechCancellation(), modelName: name)
                runs.append(["text": result.text, "audioSeconds": result.seconds, "loadMilliseconds": result.loadMilliseconds,
                             "recognitionMilliseconds": result.recognitionMilliseconds, "peakProcessMB": result.peakProcessMB, "model": name])
            } catch { runs.append(["error": error.localizedDescription, "model": name]) }
        }
        #if os(watchOS)
        let platform = "watchOS"
        #else
        let platform = "iOS"
        #endif
        let report: [String: Any] = ["platform": platform, "runs": runs]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: .prettyPrinted) { try? data.write(to: output, options: .atomic) }
    }
    #endif
}
#endif
