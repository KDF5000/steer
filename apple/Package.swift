// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "SteerCore", platforms: [.macOS(.v13)], products: [.library(name: "SteerCore", targets: ["SteerCore"])], targets: [
    .target(name: "SteerCore", path: "Shared", exclude: ["Pairing.swift", "SecureStore.swift", "PhoneSpeech.swift", "LocalSpeech.swift", "ModernPhoneSpeech.swift", "TaskModel.swift", "ResultSpeech.swift"], sources: ["API.swift", "Models.swift", "VoiceUpload.swift", "SpeechEndpoint.swift", "RemoteSpeech.swift", "SpeechVocabulary.swift", "MessageFormatting.swift"]),
    .testTarget(name: "SteerCoreTests", dependencies: ["SteerCore"], path: "Tests")
])
