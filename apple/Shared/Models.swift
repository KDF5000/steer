import Foundation

struct Connection: Codable, Equatable {
    var server: String
    var apiKey: String
    var web: String
    var baseURL: URL? {
        guard let url = URL(string: server.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return nil }
        return url
    }
}
struct Conversation: Codable, Identifiable, Equatable {
    let id, title, agentID, agentName, projectName: String
    var taskID: String?
    var status, summary: String
    let updatedAt: String
    enum CodingKeys: String, CodingKey {
        case id, title, agentID = "agentId", agentName, projectName, taskID = "taskId", status, summary, updatedAt
    }
    var running: Bool { ["running", "queued", "pending", "starting"].contains(status) }
    var label: String {
        switch status { case "succeeded": return "已完成"; case "failed": return "执行失败"; case "cancelled": return "已停止"; case "idle": return "待开始"; default: return running ? "运行中" : status }
    }
}
struct TaskSnapshot: Decodable {
    struct Item: Decodable { let id, status: String; let result, error: String? }
    let task: Item
    let content: String?
}
struct TaskCreated: Decodable { let taskId: String }
struct ChatHistory: Decodable {
    struct Message: Decodable, Identifiable { let id, role, content: String }
    let messages: [Message]
}
struct Draft: Codable {
    var text: String
    var idempotencyKey: String = UUID().uuidString
    // A request timeout can happen after the server accepted a task. Retrying
    // must reuse both the same body and the same key.
    var attempted: Bool = false
}
struct CachedFeed: Codable { let account: String; let items: [Conversation]; let syncedAt: Date }
