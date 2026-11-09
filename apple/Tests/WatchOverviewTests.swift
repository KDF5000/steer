import XCTest
#if SWIFT_PACKAGE
@testable import SteerCore
#endif
final class WatchOverviewTests: XCTestCase {
    func testMissingTokenUsageIsDifferentFromZero() throws {
        let payload = #"{"activeTasks":0,"totalTasks":64,"completedTasks":60,"failedTasks":4,"userMessages":120,"agentMessages":118,"tokenCount":null,"tokenCoverage":0,"totalRuns":60,"updatedAt":"2026-11-09T05:00:00Z"}"#
        let overview = try JSONDecoder().decode(WatchOverview.self, from: Data(payload.utf8))
        XCTAssertEqual(overview.messageCount, 238)
        XCTAssertNil(overview.tokenCount)
        XCTAssertEqual(WatchOverview.countText(overview.tokenCount), "—")
        XCTAssertEqual(WatchOverview.countText(0), "0")
        XCTAssertEqual(WatchOverview.countText(12_345), "1.2万")
        XCTAssertEqual(WatchOverview.countText(123_456_789), "1.2亿")
        XCTAssertEqual(overview.totalTasks, 64)
        let cached = CachedOverview(account: "workspace-account", overview: overview)
        let restored = try JSONDecoder().decode(CachedOverview.self, from: JSONEncoder().encode(cached))
        XCTAssertEqual(restored.account, cached.account)
        XCTAssertEqual(restored.overview, overview)
    }
}
