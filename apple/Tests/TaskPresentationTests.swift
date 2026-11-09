import XCTest
#if SWIFT_PACKAGE
@testable import SteerCore
#endif

final class TaskPresentationTests: XCTestCase {
    func item(_ status: String, start: String? = nil) -> Conversation {
        Conversation(id: "c", title: "Task", agentID: "a", agentName: "Codex", projectName: "Steer", taskID: "t", status: status, summary: "", updatedAt: "", startedAt: start)
    }
    func testOnlySucceededTasksAllowNewInput() {
        for status in ["running", "starting", "queued", "pending", "failed", "cancelled", "idle"] {
            XCTAssertFalse(item(status).canContinue, status)
        }
        XCTAssertTrue(item("succeeded").canContinue)
        var missingTask = item("succeeded"); missingTask.taskID = nil
        XCTAssertFalse(missingTask.canContinue)
    }
    func testElapsedUsesThisRunStartAndDoesNotCountQueuedTime() throws {
        let now = try XCTUnwrap(Conversation.timestamp("2026-11-08T12:04:28Z"))
        for start in ["2026-11-08T12:00:00Z", "2026-11-08T12:00:00.000000Z"] {
            XCTAssertEqual(item("running", start: start).elapsed(at: now), "4:28")
            XCTAssertNil(item("queued", start: start).elapsed(at: now))
            XCTAssertNil(item("succeeded", start: start).elapsed(at: now))
        }
        XCTAssertNil(item("running").elapsed(at: now))
        XCTAssertEqual(item("running", start: "2026-11-08T12:05:00Z").elapsed(at: now), "0:00")
        XCTAssertEqual(item("running", start: "2026-11-08T10:00:00Z").elapsed(at: now), "2:04:28")
    }
    func testOldFeedAndCacheRemainDecodable() throws {
        let payload = #"{"id":"c","title":"Task","agentId":"a","agentName":"Codex","projectName":"Steer","taskId":"t","status":"running","summary":"","updatedAt":"2026-11-08T12:00:00Z"}"#
        let old = try JSONDecoder().decode(Conversation.self, from: Data(payload.utf8))
        XCTAssertNil(old.lastUserMessage); XCTAssertNil(old.startedAt)
        var enriched = old; enriched.lastUserMessage = "检查锁屏提醒"; enriched.startedAt = "2026-11-08T12:00:00Z"
        let restored = try JSONDecoder().decode(Conversation.self, from: JSONEncoder().encode(enriched))
        XCTAssertEqual(restored, enriched)
    }
}
