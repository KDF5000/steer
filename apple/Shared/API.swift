import Foundation

struct APIError: LocalizedError {
    let message: String
    var statusCode: Int? = nil
    var errorDescription: String? { message }
}
struct SteerAPI {
    let connection: Connection
    var session: URLSession = .shared
    var retryDelay: (Double) async throws -> Void = { seconds in
        try await Task.sleep(for: .seconds(seconds))
    }
    func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil, key: String? = nil, query: [URLQueryItem] = []) async throws -> T {
        guard var url = connection.baseURL else { throw APIError(message: "服务器地址无效") }
        // Accept server origin or an API base ending in /api/v1.
        if !url.path.hasSuffix("/api/v1") { url.append(path: "api/v1") }
        url.append(path: path)
        if !query.isEmpty {
            guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { throw APIError(message: "服务器地址无效") }
            components.queryItems = query
            guard let queryURL = components.url else { throw APIError(message: "服务器地址无效") }
            url = queryURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = method; req.httpBody = body; req.timeoutInterval = 25
        req.setValue("Bearer \(connection.apiKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let key { req.setValue(key, forHTTPHeaderField: "Idempotency-Key") }
        // Only reads retry automatically. Writes retain their explicit
        // confirmation/idempotency flow when a response is lost.
        let attempts = method == "GET" ? 3 : 1
        for attempt in 0..<attempts {
            try Task.checkCancellation()
            do {
                let (data, response) = try await fetch(req)
                try Task.checkCancellation()
                guard let http = response as? HTTPURLResponse else { throw APIError(message: "服务器未返回有效响应") }
                guard (200...299).contains(http.statusCode) else {
                    let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                    throw APIError(message: object?["error"] as? String ?? "请求失败（\(http.statusCode)）", statusCode: http.statusCode)
                }
                return try JSONDecoder().decode(T.self, from: data)
            } catch {
                if Task.isCancelled || Self.isCancellation(error) { throw CancellationError() }
                guard attempt + 1 < attempts, Self.isRetryable(error) else { throw error }
                try await retryDelay(Double(attempt + 1))
            }
        }
        throw APIError(message: "请求失败")
    }
    static func isCancellation(_ error: Error) -> Bool {
        error is CancellationError || (error as? URLError)?.code == .cancelled
    }
    private static func isRetryable(_ error: Error) -> Bool {
        if let status = (error as? APIError)?.statusCode {
            return status == 408 || status == 429 || (500...599).contains(status)
        }
        guard let error = error as? URLError else { return false }
        return [.timedOut, .networkConnectionLost, .notConnectedToInternet,
                .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed,
                .resourceUnavailable].contains(error.code)
    }
    private func fetch(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            let result = try await session.data(for: request)
            recordDiagnostic(request, response: result.1, error: nil)
            return result
        } catch {
            recordDiagnostic(request, response: nil, error: error)
            throw error
        }
    }
    private func recordDiagnostic(_ request: URLRequest, response: URLResponse?, error: Error?) {
        #if DEBUG && os(iOS)
        guard ProcessInfo.processInfo.environment["STEER_NETWORK_DIAGNOSTICS"] == "1",
              let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        // Explicit developer diagnostic: never persist credentials, query,
        // request/response bodies, or task identifiers.
        var report: [String: Any] = [
            "build": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown",
            "scheme": request.url?.scheme ?? "",
            "host": request.url?.host ?? "",
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ]
        if let http = response as? HTTPURLResponse { report["httpStatus"] = http.statusCode }
        if let error {
            report["errorDomain"] = (error as NSError).domain
            report["errorCode"] = (error as NSError).code
        }
        if let data = try? JSONSerialization.data(withJSONObject: report, options: .prettyPrinted) {
            try? data.write(to: directory.appendingPathComponent("SteerNetworkDiagnostic.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        #endif
    }
    func conversations(limit: Int = 50, offset: Int = 0, projectID: String? = nil, search: String? = nil) async throws -> [Conversation] {
        var query = [URLQueryItem(name: "limit", value: String(limit)), URLQueryItem(name: "offset", value: String(offset))]
        if let projectID { query.append(URLQueryItem(name: "projectId", value: projectID)) }
        if let search { query.append(URLQueryItem(name: "q", value: search)) }
        return try await request("watch/conversations", query: query)
    }
    func projects() async throws -> [WatchProject] { try await request("watch/projects") }
    func projectDirectory() async throws -> (projects: [WatchProject], legacyFeed: [Conversation]?) {
        do { return (try await projects(), nil) }
        catch {
            guard let status = (error as? APIError)?.statusCode, status == 403 || status == 404 else { throw error }
            // Older servers reject unknown bearer-token routes with 403.
            // Read only through the already-authorized conversation endpoint.
            var feed: [Conversation] = []
            var seen = Set<String>()
            var offset = 0
            while true {
                let page = try await conversations(limit: 50, offset: offset)
                let fresh = page.filter { seen.insert($0.id).inserted }
                if !page.isEmpty, fresh.isEmpty {
                    throw APIError(message: "服务端版本不支持会话分页，请更新 Steer Server")
                }
                feed += fresh
                if page.count < 50 { break }
                offset += 50
            }
            let groups = Dictionary(grouping: feed, by: \.projectKey)
            var ordered = Set<String>()
            let projects = feed.compactMap { item -> WatchProject? in
                guard ordered.insert(item.projectKey).inserted, let entries = groups[item.projectKey] else { return nil }
                return WatchProject(id: item.projectKey, name: item.projectName, conversations: entries.count, activeTasks: entries.filter(\.running).count)
            }
            return (projects, feed)
        }
    }
    func overview() async throws -> WatchOverview { try await request("watch/overview") }
    func task(_ id: String) async throws -> TaskSnapshot { try await request("tasks/\(id)") }
    func history(_ id: String) async throws -> ChatHistory { try await request("watch/conversations/\(id)") }
    func send(_ item: Conversation, draft: Draft, source: String = "apple-watch") async throws -> TaskCreated {
        let body = try JSONSerialization.data(withJSONObject: ["agentId": item.agentID, "prompt": draft.text, "metadata": ["source": source]])
        return try await request("conversations/\(item.id)/tasks", method: "POST", body: body, key: draft.idempotencyKey)
    }
    struct Cancelled: Decodable { let id, status: String }
    func cancel(_ id: String) async throws -> Cancelled { try await request("tasks/\(id)/cancel", method: "POST") }
}
