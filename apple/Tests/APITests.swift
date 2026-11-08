import XCTest
#if SWIFT_PACKAGE
@testable import SteerCore
#endif

final class RequestStub: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do { let (status, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
final class APITests: XCTestCase {
    func api(_ server: String = "https://steer.example.com") -> SteerAPI {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [RequestStub.self]
        return SteerAPI(connection: Connection(server: server, apiKey: "test-secret", web: ""), session: URLSession(configuration: config))
    }
    func testListUsesWorkspaceKeyAndDoesNotDuplicateBasePath() async throws {
        RequestStub.handler = { req in
            XCTAssertEqual(req.url?.path, "/api/v1/watch/conversations")
            XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer test-secret")
            return (200, Data("[]".utf8))
        }
        _ = try await api().conversations(); _ = try await api("https://steer.example.com/api/v1").conversations()
    }
    func testRetryPreservesRequestIdentityAfterLostResponse() async throws {
        let item = Conversation(id: "session-1", title: "Task", agentID: "agent-1", agentName: "Builder", projectName: "Steer", taskID: nil, status: "idle", summary: "", updatedAt: "")
        let draft = Draft(text: "继续执行，不要提交", idempotencyKey: "fixed-request", attempted: true)
        var calls = 0
        RequestStub.handler = { req in
            calls += 1
            XCTAssertEqual(req.url?.path, "/api/v1/conversations/session-1/tasks")
            XCTAssertEqual(req.value(forHTTPHeaderField: "Idempotency-Key"), "fixed-request")
            let object = try JSONSerialization.jsonObject(with: req.httpBody ?? Self.body(req)) as! [String: Any]
            XCTAssertEqual(object["agentId"] as? String, "agent-1")
            XCTAssertEqual(object["prompt"] as? String, draft.text)
            if calls == 1 { throw URLError(.timedOut) }
            return (200, Data(#"{"taskId":"existing-task"}"#.utf8))
        }
        do { _ = try await api().send(item, draft: draft); XCTFail("Expected timeout") } catch {}
        let retried = try await api().send(item, draft: draft)
        XCTAssertEqual(retried.taskId, "existing-task"); XCTAssertEqual(calls, 2)
        let recovered = try JSONDecoder().decode(Draft.self, from: JSONEncoder().encode(draft))
        XCTAssertEqual(recovered.idempotencyKey, draft.idempotencyKey); XCTAssertTrue(recovered.attempted)
    }
    static func body(_ req: URLRequest) -> Data {
        guard let stream = req.httpBodyStream else { return Data() }; stream.open(); defer { stream.close() }
        var bytes = [UInt8](repeating: 0, count: 1024), result = Data()
        while stream.hasBytesAvailable { let n = stream.read(&bytes, maxLength: bytes.count); if n <= 0 { break }; result.append(contentsOf: bytes.prefix(n)) }
        return result
    }
    func testServerErrorAndCancelShape() async throws {
        RequestStub.handler = { _ in (403, Data(#"{"error":"Missing tasks:write scope"}"#.utf8)) }
        do { _ = try await api().conversations(); XCTFail("Expected rejection") } catch { XCTAssertEqual(error.localizedDescription, "Missing tasks:write scope") }
        RequestStub.handler = { req in XCTAssertEqual(req.httpMethod, "POST"); return (200, Data(#"{"id":"run-1","status":"cancelled"}"#.utf8)) }
        let cancelled = try await api().cancel("task-1")
        XCTAssertEqual(cancelled.status, "cancelled")
    }
    func testConnectionValidation() {
        for url in ["", "file:///tmp/config", "https://user:secret@host", "https://host?token=secret"] { XCTAssertNil(Connection(server: url, apiKey: "", web: "").baseURL) }
        XCTAssertNotNil(Connection(server: "http://steer.local:8080", apiKey: "", web: "").baseURL)
    }
}
