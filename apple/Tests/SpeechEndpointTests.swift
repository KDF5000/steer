import XCTest
#if SWIFT_PACKAGE
@testable import SteerCore
#endif
final class SpeechEndpointTests: XCTestCase {
    func testSilenceNeverBecomesAnUtterance() {
        var endpoint = SpeechEndpoint()
        for tick in 1..<200 { XCTAssertEqual(endpoint.update(power: -60, time: Double(tick) / 10), .listening) }
        XCTAssertEqual(endpoint.update(power: -60, time: 20), .noSpeech)
    }
    func testPausesWaitForTheUserToFinish() {
        var endpoint = SpeechEndpoint()
        for tick in 1...10 { _ = endpoint.update(power: -20, time: Double(tick) / 10) }
        for tick in 11...20 { XCTAssertEqual(endpoint.update(power: -60, time: Double(tick) / 10), .listening) }
        for tick in 21...30 { _ = endpoint.update(power: -20, time: Double(tick) / 10) }
        for tick in 31...43 { XCTAssertEqual(endpoint.update(power: -60, time: Double(tick) / 10), .listening) }
        XCTAssertEqual(endpoint.update(power: -60, time: 4.5), .listening)
        XCTAssertEqual(endpoint.update(power: -60, time: 4.6, finished: true), .complete)
    }
    func testSingleClickAndMaximumDuration() {
        var endpoint = SpeechEndpoint()
        _ = endpoint.update(power: -10, time: 0.1)
        for tick in 2...80 { _ = endpoint.update(power: -60, time: Double(tick) / 10) }
        XCTAssertFalse(endpoint.hasSpeech)
        XCTAssertEqual(endpoint.update(power: -60, time: 8.1, finished: true), .noSpeech)
        var long = SpeechEndpoint()
        for tick in 1..<200 { XCTAssertEqual(long.update(power: -20, time: Double(tick) / 10), .listening) }
        XCTAssertEqual(long.update(power: -20, time: 20), .complete)
    }
}
