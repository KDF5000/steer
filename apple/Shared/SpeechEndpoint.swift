import Foundation

// Lightweight microphone endpointing, not semantic speech recognition.
// The user finishes explicitly; silence alone cannot create a transcript.
// A maximum duration protects the Watch microphone and local model budget.
struct SpeechEndpoint {
    enum Decision: Equatable { case listening, complete, noSpeech }
    private var noise: Float = -60
    private var voicedSeconds: Double = 0
    private var lastVoice: Double = 0
    private var previousTime: Double = 0
    private(set) var hasSpeech = false
    mutating func update(power: Float, time: Double, finished: Bool = false) -> Decision {
        let step = max(0, min(0.2, time - previousTime)); previousTime = time
        let threshold = max(-43, min(-24, noise + 12))
        if power.isFinite && power > threshold {
            if !hasSpeech && time - lastVoice > 0.25 { voicedSeconds = 0 }
            voicedSeconds += step; lastVoice = time
            hasSpeech = voicedSeconds >= 0.3
        } else if !hasSpeech && power.isFinite {
            noise = noise * 0.9 + power * 0.1
        }
        if finished || time >= 20 { return hasSpeech ? .complete : .noSpeech }
        return .listening
    }
}
