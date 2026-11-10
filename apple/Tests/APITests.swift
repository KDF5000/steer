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
    func testProjectDirectoryAndFilteredPagination() async throws {
        RequestStub.handler = { req in
            if req.url?.path == "/api/v1/watch/projects" {
                return (200, Data(#"[{"id":"project-a","name":"Steer","conversations":72,"activeTasks":2}]"#.utf8))
            }
            let query = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)!.queryItems!
            XCTAssertEqual(query.first { $0.name == "projectId" }?.value, "project-a")
            XCTAssertEqual(query.first { $0.name == "offset" }?.value, "50")
            XCTAssertEqual(query.first { $0.name == "q" }?.value, "语音 & Watch")
            return (200, Data("[]".utf8))
        }
        let projects = try await api().projects()
        XCTAssertEqual(projects.first?.conversations, 72)
        _ = try await api().conversations(offset: 50, projectID: "project-a", search: "语音 & Watch")
    }
    func testLegacyDirectoryUsesAuthorizedFeedAndIncludesLaterProjects() async throws {
        let feed = (0..<51).map { index in
            Conversation(id: "session-\(index)", title: "Task", agentID: "a", agentName: "Agent", projectName: index < 50 ? "Steer" : "Relay", taskID: "task-\(index)", status: index == 0 ? "running" : "succeeded", summary: "", updatedAt: "")
        }
        for unsupported in [403, 404] {
            var offsets: [Int] = []
            RequestStub.handler = { req in
                if req.url?.path == "/api/v1/watch/projects" { return (unsupported, Data(#"{"error":"API key does not have permission for this operation."}"#.utf8)) }
                XCTAssertEqual(req.url?.path, "/api/v1/watch/conversations")
                let query = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)!.queryItems!
                let offset = Int(query.first { $0.name == "offset" }!.value!)!
                offsets.append(offset)
                return (200, try JSONEncoder().encode(Array(feed.dropFirst(offset).prefix(50))))
            }
            let directory = try await api().projectDirectory()
            XCTAssertEqual(offsets, [0, 50])
            XCTAssertEqual(directory.legacyFeed?.count, 51)
            XCTAssertEqual(directory.projects.map(\.id), ["legacy:Steer", "legacy:Relay"])
            XCTAssertEqual(directory.projects.map(\.conversations), [50, 1])
            XCTAssertEqual(directory.projects.first?.activeTasks, 1)
        }
    }
    func testDirectoryDoesNotHideInvalidCredentialsOrServerOutages() async throws {
        for status in [401, 503] {
            var calls = 0
            var client = api(); client.retryDelay = { _ in }
            RequestStub.handler = { req in
                calls += 1; XCTAssertEqual(req.url?.path, "/api/v1/watch/projects")
                return (status, Data(#"{"error":"Unavailable"}"#.utf8))
            }
            do { _ = try await client.projectDirectory(); XCTFail("Expected failure") }
            catch { XCTAssertEqual((error as? APIError)?.statusCode, status) }
            XCTAssertEqual(calls, status == 401 ? 1 : 3)
        }
    }
    func testLegacyDirectoryStopsWhenOldServerIgnoresPagination() async throws {
        let item = Conversation(id: "s", title: "Task", agentID: "a", agentName: "Agent", projectName: "Steer", taskID: "t", status: "succeeded", summary: "", updatedAt: "")
        var calls = 0
        RequestStub.handler = { req in
            calls += 1
            if req.url?.path == "/api/v1/watch/projects" { return (403, Data(#"{"error":"Unsupported route"}"#.utf8)) }
            return (200, try JSONEncoder().encode(Array(repeating: item, count: 50)))
        }
        do { _ = try await api().projectDirectory(); XCTFail("Expected pagination error") }
        catch { XCTAssertEqual(error.localizedDescription, "服务端版本不支持会话分页，请更新 Steer Server") }
        XCTAssertEqual(calls, 3)
    }
    func testReadRecoversFromNetworkAndServerFailures() async throws {
        var calls = 0
        var delays: [Double] = []
        var client = api()
        client.retryDelay = { delays.append($0) }
        RequestStub.handler = { _ in
            calls += 1
            if calls == 1 { throw URLError(.networkConnectionLost) }
            if calls == 2 { return (503, Data(#"{"error":"Temporarily unavailable"}"#.utf8)) }
            return (200, Data("[]".utf8))
        }
        let items = try await client.conversations()
        XCTAssertTrue(items.isEmpty)
        XCTAssertEqual(calls, 3)
        XCTAssertEqual(delays, [1, 2])
    }
    func testReadReportsFinalFailureAfterThreeAttempts() async throws {
        var calls = 0
        var client = api()
        client.retryDelay = { _ in }
        RequestStub.handler = { _ in calls += 1; throw URLError(.timedOut) }
        do { _ = try await client.conversations(); XCTFail("Expected final failure") }
        catch { XCTAssertEqual((error as? URLError)?.code, .timedOut) }
        XCTAssertEqual(calls, 3)
    }
    func testPermanentFailuresDoNotRetry() async throws {
        var calls = 0
        var client = api()
        client.retryDelay = { _ in XCTFail("Permanent failure should not retry") }
        for status in [401, 403, 404] {
            RequestStub.handler = { _ in calls += 1; return (status, Data(#"{"error":"Rejected"}"#.utf8)) }
            do { _ = try await client.conversations(); XCTFail("Expected rejection") }
            catch { XCTAssertEqual((error as? APIError)?.statusCode, status) }
        }
        RequestStub.handler = { _ in calls += 1; return (200, Data("invalid JSON".utf8)) }
        do { _ = try await client.conversations(); XCTFail("Expected decoding failure") }
        catch { XCTAssertTrue(error is DecodingError) }
        XCTAssertEqual(calls, 4)
    }
    func testCancellationStopsReadsWithoutRetry() async throws {
        var calls = 0
        var client = api()
        client.retryDelay = { _ in XCTFail("Cancelled request should not retry") }
        RequestStub.handler = { _ in calls += 1; throw URLError(.cancelled) }
        do { _ = try await client.conversations(); XCTFail("Expected cancellation") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(calls, 1)
    }
    func testCancellationDuringBackoffStopsFurtherRequests() async throws {
        var calls = 0
        var client = api()
        let delaying = expectation(description: "Waiting to retry")
        client.retryDelay = { _ in
            delaying.fulfill()
            try await Task.sleep(for: .seconds(30))
        }
        RequestStub.handler = { _ in calls += 1; throw URLError(.timedOut) }
        let request = Task { try await client.conversations() }
        await fulfillment(of: [delaying], timeout: 2)
        request.cancel()
        do { _ = try await request.value; XCTFail("Expected cancellation") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(calls, 1)
    }
}
