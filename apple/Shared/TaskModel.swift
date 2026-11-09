import SwiftUI
import CryptoKit

@MainActor final class WatchModel: ObservableObject {
    @Published var items: [Conversation] = []
    @Published var syncedAt: Date?
    @Published var error: String?
    @Published var refreshing = false
    @Published var sending = false
    @Published var histories: [String: [ChatHistory.Message]] = [:]
    @Published var historyErrors: [String: String] = [:]
    @Published var overview: WatchOverview?
    @Published var overviewError: String?
    @Published var hasMoreTasks = false
    private var requestedFeedSize = 50
    private var loadingOverview = false
    private var loadingHistory: Set<String> = []
    private let source: String
    init(source: String = "apple-watch") { self.source = source }
    var connection: Connection?
    private var generation = UUID()
    var account: String { guard let c = connection else { return "" }; return SHA256.hash(data: Data((c.server + "\n" + c.apiKey).utf8)).map { String(format: "%02x", $0) }.joined() }
    func configure(_ config: Connection?) {
        guard config != connection else { return }
        connection = config; generation = UUID(); items = []; syncedAt = nil; error = nil; refreshing = false; histories = [:]; historyErrors = [:]; loadingHistory = []
        overview = nil; overviewError = nil; requestedFeedSize = 50; hasMoreTasks = false; loadingOverview = false
        if let cache: CachedOverview = SecureStore.read("watch-overview"), cache.account == account { overview = cache.overview }
        if let cache: CachedFeed = SecureStore.read("feed"), cache.account == account {
            items = cache.items; syncedAt = cache.syncedAt
            requestedFeedSize = max(50, ((items.count + 49) / 50) * 50)
            hasMoreTasks = items.count >= 50
        }
    }
    func refresh() async {
        guard let connection, !refreshing else { return }
        let revision = generation
        refreshing = true
        defer { if revision == generation { refreshing = false } }
        do {
            var feed: [Conversation] = []
            var more = false
            var seen = Set<String>()
            for offset in stride(from: 0, to: requestedFeedSize, by: 50) {
                try Task.checkCancellation()
                let page = try await SteerAPI(connection: connection).conversations(limit: 50, offset: offset)
                guard revision == generation else { return }
                feed += page.filter { seen.insert($0.id).inserted }
                more = page.count == 50
                if !more { break }
            }
            hasMoreTasks = more
            guard revision == generation else { return }
            // Old servers omit these fields; keep detail-derived metadata for
            // the same run across polling, never carry it into a new run.
            items = feed.map { entry in
                var entry = entry
                if let previous = items.first(where: { $0.id == entry.id && $0.taskID == entry.taskID }) {
                    entry.lastUserMessage = entry.lastUserMessage ?? previous.lastUserMessage
                    entry.startedAt = entry.startedAt ?? previous.startedAt
                }
                return entry
            }; syncedAt = Date(); error = nil
            // Keep Relay status current even when no web page is open. Bound
            // concurrent requests to four while the watch app is foregrounded.
            let active = feed.filter { $0.running && $0.taskID != nil }
            for offset in stride(from: 0, to: active.count, by: 4) {
                if Task.isCancelled { return }
                let batch = Array(active[offset..<min(offset + 4, active.count)])
                let results = await withTaskGroup(of: (String, TaskSnapshot?, String?).self) { group in
                    for item in batch { group.addTask {
                        do { return (item.id, try await SteerAPI(connection: connection).task(item.taskID!), nil) }
                        catch { return (item.id, nil, error.localizedDescription) }
                    } }
                    var results: [(String, TaskSnapshot?, String?)] = []
                    for await result in group { results.append(result) }
                    return results
                }
                guard revision == generation else { return }
                for (id, snapshot, failure) in results {
                    if let failure { error = failure }
                    if let snapshot, let index = items.firstIndex(where: { $0.id == id && $0.taskID == snapshot.task.id }) {
                        items[index].status = snapshot.task.status
                        items[index].summary = snapshot.task.result ?? snapshot.task.error ?? snapshot.content ?? items[index].summary
                        items[index].startedAt = snapshot.task.startedAt ?? items[index].startedAt
                    }
                }
            }
            if source == "apple-watch" { await refreshOverview() }
            guard revision == generation else { return }
            try SecureStore.write(CachedFeed(account: account, items: items, syncedAt: syncedAt!), key: "feed")
        } catch { if revision == generation { self.error = error.localizedDescription } }
    }
    func loadMoreTasks() async {
        guard !refreshing, hasMoreTasks else { return }
        requestedFeedSize += 50
        await refresh()
    }
    func refreshOverview() async {
        guard let connection, !loadingOverview else { return }
        let revision = generation
        loadingOverview = true
        defer { if revision == generation { loadingOverview = false } }
        do {
            let value = try await SteerAPI(connection: connection).overview()
            guard revision == generation else { return }
            overview = value; overviewError = nil
            try SecureStore.write(CachedOverview(account: account, overview: value), key: "watch-overview")
        } catch { if revision == generation { overviewError = error.localizedDescription } }
    }
    func refreshTask(_ id: String) async {
        guard let connection, let item = items.first(where: { $0.id == id }), let taskID = item.taskID else { return }
        let revision = generation
        do {
            let snapshot = try await SteerAPI(connection: connection).task(taskID)
            guard revision == generation, let index = items.firstIndex(where: { $0.id == id }), items[index].taskID == taskID else { return }
            items[index].status = snapshot.task.status
            items[index].summary = snapshot.task.result ?? snapshot.task.error ?? snapshot.content ?? items[index].summary
            items[index].startedAt = snapshot.task.startedAt ?? items[index].startedAt
            error = nil; syncedAt = Date()
        } catch { if revision == generation { self.error = error.localizedDescription } }
    }
    func loadHistory(_ id: String) async {
        guard let connection, !loadingHistory.contains(id) else { return }
        let revision = generation
        let taskID = items.first(where: { $0.id == id })?.taskID
        loadingHistory.insert(id)
        defer { if revision == generation { loadingHistory.remove(id) } }
        do {
            let history = try await SteerAPI(connection: connection).history(id)
            guard revision == generation, items.first(where: { $0.id == id })?.taskID == taskID else { return }
            histories[id] = history.messages; historyErrors[id] = nil
            if let text = history.messages.last(where: { $0.role == "user" })?.content,
               let index = items.firstIndex(where: { $0.id == id }) {
                items[index].lastUserMessage = text
            }
        } catch { if revision == generation { historyErrors[id] = error.localizedDescription } }
    }
    func continuationTarget(_ id: String, taskID: String?) async throws -> Conversation {
        guard let connection, let taskID else { throw APIError(message: "只有已完成任务可以继续", statusCode: 409) }
        let revision = generation
        let snapshot = try await SteerAPI(connection: connection).task(taskID)
        guard revision == generation else { throw APIError(message: "连接配置已变化，请重新打开任务") }
        guard let index = items.firstIndex(where: { $0.id == id && $0.taskID == taskID }) else {
            throw APIError(message: "任务状态已变化，请重新打开任务", statusCode: 409)
        }
        items[index].status = snapshot.task.status
        items[index].summary = snapshot.task.result ?? snapshot.task.error ?? snapshot.content ?? items[index].summary
        items[index].startedAt = snapshot.task.startedAt ?? items[index].startedAt
        guard items[index].canContinue else { throw APIError(message: "任务尚未完成，暂时不能继续", statusCode: 409) }
        return items[index]
    }
    func draftKey(_ id: String) -> String { "draft.\(account).\(id)" }
    func draft(_ id: String) -> Draft { SecureStore.read(draftKey(id)) ?? Draft(text: "") }
    func saveDraft(_ value: Draft, id: String) throws { try SecureStore.write(value, key: draftKey(id)) }
    func discardDraft(_ id: String, account: String) { SecureStore.delete("draft.\(account).\(id)") }
    func send(_ item: Conversation, draft: Draft, resuming: Bool = false) async throws {
        guard let connection, !sending else { throw APIError(message: "当前无法发送") }
        let revision = generation
        sending = true; defer { sending = false }
        if !resuming {
            guard let taskID = item.taskID else { throw APIError(message: "只有已完成任务可以继续", statusCode: 409) }
            let snapshot = try await SteerAPI(connection: connection).task(taskID)
            guard revision == generation else { throw APIError(message: "连接配置已变化") }
            guard snapshot.task.status == "succeeded",
                  let current = items.first(where: { $0.id == item.id }), current.taskID == taskID, current.canContinue else {
                throw APIError(message: "任务状态已变化，完成后才能继续", statusCode: 409)
            }
        }
        let created = try await SteerAPI(connection: connection).send(item, draft: draft, source: source)
        guard revision == generation else { throw APIError(message: "连接配置已变化，原请求结果需确认") }
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index].status = "pending"; items[index].taskID = created.taskId; items[index].summary = "任务已提交，等待执行"
            items[index].lastUserMessage = draft.text; items[index].startedAt = nil
        }
        SecureStore.delete(draftKey(item.id))
        await refresh()
    }
    func cancel(_ id: String) async throws {
        guard let connection else { throw APIError(message: "请先连接 Steer") }
        _ = try await SteerAPI(connection: connection).cancel(id)
        if let index = items.firstIndex(where: { $0.taskID == id }) {
            await refreshTask(items[index].id)
        }
        await refresh()
    }
}
