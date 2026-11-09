import Foundation

struct Connection: Codable, Equatable {
    var server: String
    var apiKey: String
    var web: String
    var speech: SpeechService? = nil
    var phoneSpeechLocale: String? = nil
    var phoneSpeechEngine: String? = nil
    var prefersEnhancedSpeech: Bool { phoneSpeechEngine != "standard" }
    // UI/system region is not the language of the recorded speech.
    var recognitionLocale: String { phoneSpeechLocale == "en-US" ? "en-US" : "zh-CN" }
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
    var lastUserMessage: String? = nil
    var startedAt: String? = nil
    enum CodingKeys: String, CodingKey {
        case id, title, agentID = "agentId", agentName, projectName, taskID = "taskId", status, summary, updatedAt, lastUserMessage, startedAt
    }
    var running: Bool { ["running", "queued", "pending", "starting"].contains(status) }
    var canContinue: Bool { status == "succeeded" && taskID != nil }
    var executing: Bool { ["running", "starting"].contains(status) }
    var startDate: Date? {
        guard let startedAt else { return nil }
        return Self.timestamp(startedAt)
    }
    static func timestamp(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    func elapsed(at date: Date) -> String? {
        guard executing, let startDate else { return nil }
        let seconds = max(0, Int(date.timeIntervalSince(startDate)))
        if seconds >= 3600 { return String(format: "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60) }
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
    var label: String {
        switch status { case "succeeded": return "已完成"; case "failed": return "执行失败"; case "cancelled": return "已停止"; case "idle": return "待开始"; case "pending", "queued": return "等待执行"; case "starting": return "启动中"; default: return running ? "进行中" : status }
    }
}
struct TaskSnapshot: Decodable {
    struct Item: Decodable { let id, status: String; let result, error: String?; var startedAt: String? = nil }
    let task: Item
    let content: String?
}
struct TaskCreated: Decodable { let taskId: String }
struct ChatHistory: Decodable {
    struct Message: Decodable, Identifiable {
        struct Context: Decodable {
            struct Reference: Decodable { var agentName: String? = nil; let content: String }
            var agentName: String? = nil
            var model: String? = nil
            var reference: Reference? = nil
        }
        let id, role, content: String
        var status: String? = nil
        var error: String? = nil
        var createdAt: String? = nil
        var context: Context? = nil
        var isUser: Bool { role == "user" }
    }
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

struct WatchOverview: Codable, Equatable {
    let activeTasks, totalTasks, completedTasks, failedTasks: Int
    let userMessages, agentMessages: Int64
    let tokenCount: Int64?
    let tokenCoverage, totalRuns: Int
    let updatedAt: String
    var messageCount: Int64 { userMessages + agentMessages }
    static func countText(_ count: Int64?) -> String {
        guard let count else { return "—" }
        if count >= 100_000_000 { return String(format: "%.1f亿", Double(count) / 100_000_000) }
        if count >= 10_000 { return String(format: "%.1f万", Double(count) / 10_000) }
        return String(count)
    }
}
struct CachedOverview: Codable { let account: String; let overview: WatchOverview }
