#if os(iOS)
import Foundation
import Speech
import AVFoundation

/// Entirely on-device. Model downloads are preparation, never audio uploads.
@available(iOS 26.0, *)
enum ModernPhoneSpeech {
    static func module(locale: String, install: Bool) async throws -> SpeechTranscriber? {
        guard SpeechTranscriber.isAvailable,
              let supported = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: locale)) else { return nil }
        let transcriber = SpeechTranscriber(locale: supported, preset: .transcription)
        if await AssetInventory.status(forModules: [transcriber]) != .installed {
            guard install else { return nil }
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                try await request.downloadAndInstall()
            }
        }
        guard await AssetInventory.status(forModules: [transcriber]) == .installed else { return nil }
        return transcriber
    }

    static func transcribe(url: URL, transcriber: SpeechTranscriber, timeout: Double = 20) async throws -> String {
        let analyzer = SpeechAnalyzer(modules: [transcriber], options: .init(priority: .userInitiated, modelRetention: .lingering))
        let context = AnalysisContext()
        context.contextualStrings[.general] = SpeechVocabulary.terms
        try await analyzer.setContext(context)
        return try await withTaskCancellationHandler {
            try await withThrowingTaskGroup(of: String.self) { group in
                group.addTask {
                    async let transcript: String = collect(transcriber)
                    do {
                        let file = try AVAudioFile(forReading: url)
                        let end = try await analyzer.analyzeSequence(from: file)
                        if let end { try await analyzer.finalizeAndFinish(through: end) }
                        else { await analyzer.cancelAndFinishNow() }
                        let text = try await transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                        try Task.checkCancellation()
                        guard !text.isEmpty else { throw APIError(message: "没有听清，请重新录音") }
                        return text
                    } catch {
                        await analyzer.cancelAndFinishNow()
                        throw error
                    }
                }
                group.addTask {
                    try await Task.sleep(for: .seconds(timeout))
                    await analyzer.cancelAndFinishNow()
                    throw APIError(message: "增强本地识别超时，请重试")
                }
                defer { group.cancelAll() }
                do {
                    guard let text = try await group.next() else { throw CancellationError() }
                    return text
                } catch {
                    await analyzer.cancelAndFinishNow()
                    throw error
                }
            }
        } onCancel: {
            Task { await analyzer.cancelAndFinishNow() }
        }
    }

    private static func collect(_ transcriber: SpeechTranscriber) async throws -> String {
        var text = ""
        for try await result in transcriber.results {
            try Task.checkCancellation()
            // The transcription preset emits final results, not volatile revisions.
            text += String(result.text.characters)
        }
        return text
    }
}
#endif
