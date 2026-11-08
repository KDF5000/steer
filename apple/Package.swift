// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "SteerCore", platforms: [.macOS(.v13)], products: [.library(name: "SteerCore", targets: ["SteerCore"])], targets: [
    .target(name: "SteerCore", path: "Shared", exclude: ["Pairing.swift", "SecureStore.swift", "PhoneSpeech.swift", "LocalSpeech.swift"], sources: ["API.swift", "Models.swift", "VoiceUpload.swift", "SpeechEndpoint.swift"]),
    .testTarget(name: "SteerCoreTests", dependencies: ["SteerCore"], path: "Tests")
])
