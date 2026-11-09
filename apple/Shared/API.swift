import Foundation

struct APIError: LocalizedError {
    let message: String
    var statusCode: Int? = nil
    var errorDescription: String? { message }
}
struct SteerAPI {
    let connection: Connection
    var session: URLSession = .shared
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
        let (data, response) = try await fetch(req)
        guard let http = response as? HTTPURLResponse else { throw APIError(message: "服务器未返回有效响应") }
        guard (200...299).contains(http.statusCode) else {
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw APIError(message: object?["error"] as? String ?? "请求失败（\(http.statusCode)）", statusCode: http.statusCode)
        }
        return try JSONDecoder().decode(T.self, from: data)
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
    func conversations(limit: Int = 50, offset: Int = 0) async throws -> [Conversation] {
        try await request("watch/conversations", query: [URLQueryItem(name: "limit", value: String(limit)), URLQueryItem(name: "offset", value: String(offset))])
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
