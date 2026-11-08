import Foundation

struct APIError: LocalizedError {
    let message: String
    var statusCode: Int? = nil
    var errorDescription: String? { message }
}
struct SteerAPI {
    let connection: Connection
    var session: URLSession = .shared
    func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil, key: String? = nil) async throws -> T {
        guard var url = connection.baseURL else { throw APIError(message: "服务器地址无效") }
        // Accept server origin or an API base ending in /api/v1.
        if !url.path.hasSuffix("/api/v1") { url.append(path: "api/v1") }
        url.append(path: path)
        var req = URLRequest(url: url)
        req.httpMethod = method; req.httpBody = body; req.timeoutInterval = 25
        req.setValue("Bearer \(connection.apiKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let key { req.setValue(key, forHTTPHeaderField: "Idempotency-Key") }
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError(message: "服务器未返回有效响应") }
        guard (200...299).contains(http.statusCode) else {
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw APIError(message: object?["error"] as? String ?? "请求失败（\(http.statusCode)）", statusCode: http.statusCode)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    func conversations() async throws -> [Conversation] { try await request("watch/conversations") }
    func task(_ id: String) async throws -> TaskSnapshot { try await request("tasks/\(id)") }
    func history(_ id: String) async throws -> ChatHistory { try await request("watch/conversations/\(id)") }
    func send(_ item: Conversation, draft: Draft) async throws -> TaskCreated {
        let body = try JSONSerialization.data(withJSONObject: ["agentId": item.agentID, "prompt": draft.text, "metadata": ["source": "apple-watch"]])
        return try await request("conversations/\(item.id)/tasks", method: "POST", body: body, key: draft.idempotencyKey)
    }
    struct Cancelled: Decodable { let id, status: String }
    func cancel(_ id: String) async throws -> Cancelled { try await request("tasks/\(id)/cancel", method: "POST") }
}
