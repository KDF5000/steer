import XCTest
#if SWIFT_PACKAGE
@testable import SteerCore
#endif

final class RemoteSpeechTests: XCTestCase {
    func client(_ server: String = "https://speech.example.com") -> RemoteSpeech {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RequestStub.self]
        return RemoteSpeech(service: SpeechService(server: server, apiKey: "speech-only-key"), session: URLSession(configuration: config))
    }
    func testLegacyPairingStillDecodesAndSpeechConfigRoundTrips() throws {
        let legacy = try JSONDecoder().decode(Connection.self, from: Data(#"{"server":"https://steer.example.com","apiKey":"workspace-key","web":""}"#.utf8))
        XCTAssertNil(legacy.speech)
        XCTAssertEqual(legacy.recognitionLocale, "zh-CN")
        XCTAssertTrue(legacy.prefersEnhancedSpeech)
        var updated = legacy
        updated.speech = SpeechService(server: "https://speech.example.com", apiKey: "speech-only-key")
        updated.phoneSpeechEngine = "standard"
        let restored = try JSONDecoder().decode(Connection.self, from: JSONEncoder().encode(updated))
        XCTAssertEqual(restored, updated)
        XCTAssertFalse(restored.prefersEnhancedSpeech)
    }
    func testExplicitSpeechLanguageSurvivesPairingAndDefaultsToChinese() throws {
        var config = Connection(server: "https://steer.example.com", apiKey: "key", web: "")
        config.phoneSpeechLocale = "en-US"
        let decoded = try JSONDecoder().decode(Connection.self, from: JSONEncoder().encode(config))
        XCTAssertEqual(decoded.recognitionLocale, "en-US")
        config.phoneSpeechLocale = "en_US" // Unknown/legacy values cannot silently select English.
        XCTAssertEqual(config.recognitionLocale, "zh-CN")
        config.phoneSpeechLocale = nil
        XCTAssertEqual(config.recognitionLocale, "zh-CN")
    }
    func testAudioGoesOnlyToSelectedServiceWithItsOwnKey() async throws {
        let audio = Data([1, 2, 3, 4])
        RequestStub.handler = { request in
            XCTAssertEqual(request.url?.host, "speech.example.com")
            XCTAssertEqual(request.url?.path, "/v1/audio/transcriptions")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer speech-only-key")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "audio/mp4")
            XCTAssertEqual(request.httpBody ?? APITests.body(request), audio)
            return (200, Data(#"{"text":" 继续执行 ","request_id":"asr-1"}"#.utf8))
        }
        let text = try await client().transcribe(audio)
        XCTAssertEqual(text, "继续执行")
    }
    func testServiceFailureDoesNotRetryOrFallBack() async throws {
        var calls = 0
        RequestStub.handler = { _ in
            calls += 1
            return (503, Data(#"{"error":"语音服务忙碌"}"#.utf8))
        }
        do { _ = try await client().transcribe(Data([1])); XCTFail("Expected rejection") }
        catch { XCTAssertEqual(error.localizedDescription, "语音服务忙碌") }
        XCTAssertEqual(calls, 1)
    }
    func testHealthAndInvalidAudio() async throws {
        RequestStub.handler = { request in
            XCTAssertEqual(request.url?.path, "/healthz")
            return (200, Data(#"{"ready":true}"#.utf8))
        }
        try await client().check()
        RequestStub.handler = { _ in XCTFail("Invalid audio must not leave device"); return (500, Data()) }
        do { _ = try await client().transcribe(Data()); XCTFail("Expected rejection") } catch {}
        do { _ = try await client().transcribe(Data(repeating: 0, count: 2 * 1024 * 1024 + 1)); XCTFail("Expected rejection") } catch {}
    }
    func testCaddyPrefixIsPreservedForHealthAndAudio() async throws {
        RequestStub.handler = { request in
            if request.httpMethod == "GET" {
                XCTAssertEqual(request.url?.path, "/speech/healthz")
                return (200, Data(#"{"ready":true}"#.utf8))
            }
            XCTAssertEqual(request.url?.path, "/speech/v1/audio/transcriptions")
            return (200, Data(#"{"text":"继续","request_id":"prefix-test"}"#.utf8))
        }
        let api = client("https://speech.example.com/speech/")
        try await api.check()
        let text = try await api.transcribe(Data([1]))
        XCTAssertEqual(text, "继续")
    }
}
