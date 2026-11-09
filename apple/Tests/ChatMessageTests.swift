import XCTest
#if SWIFT_PACKAGE
@testable import SteerCore
#endif

final class ChatMessageTests: XCTestCase {
    func testLegacyHistoryHasNoInventedAuthorOrModel() throws {
        let history = try JSONDecoder().decode(ChatHistory.self, from: Data(#"{"messages":[{"id":"u","role":"user","content":"检查状态"},{"id":"a","role":"agent","content":"完成"}]}"#.utf8))
        XCTAssertTrue(history.messages[0].isUser)
        XCTAssertFalse(history.messages[1].isUser)
        XCTAssertNil(history.messages[1].context)
        XCTAssertNil(history.messages[1].status)
    }
    func testHistoryPreservesPerTurnModelAndReference() throws {
        let payload = #"{"messages":[{"id":"a","role":"agent","content":"结果","status":"succeeded","createdAt":"2026-11-09T01:00:00Z","context":{"agentName":"Codex","model":"gpt-6","reference":{"agentName":"Trae","content":"保留当前 session"}}},{"id":"b","role":"assistant","content":"","status":"failed","error":"运行时断开","context":{"agentName":"Trae","model":"another-model"}}]}"#
        let history = try JSONDecoder().decode(ChatHistory.self, from: Data(payload.utf8))
        XCTAssertEqual(history.messages[0].context?.model, "gpt-6")
        XCTAssertEqual(history.messages[0].context?.reference?.content, "保留当前 session")
        XCTAssertEqual(history.messages[1].context?.agentName, "Trae")
        XCTAssertEqual(history.messages[1].error, "运行时断开")
        XCTAssertFalse(history.messages[1].isUser)
    }
}
