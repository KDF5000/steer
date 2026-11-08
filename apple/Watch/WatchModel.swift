import SwiftUI
import CryptoKit

@MainActor final class WatchModel: ObservableObject {
    @Published var items: [Conversation] = []
    @Published var syncedAt: Date?
    @Published var error: String?
    @Published var refreshing = false
    @Published var sending = false
    var connection: Connection?
    private var generation = UUID()
    var account: String { guard let c = connection else { return "" }; return SHA256.hash(data: Data((c.server + "\n" + c.apiKey).utf8)).map { String(format: "%02x", $0) }.joined() }
    func configure(_ config: Connection?) {
        guard config != connection else { return }
        connection = config; generation = UUID(); items = []; syncedAt = nil; error = nil; refreshing = false
        if let cache: CachedFeed = SecureStore.read("feed"), cache.account == account { items = cache.items; syncedAt = cache.syncedAt }
    }
    func refresh() async {
        guard let connection, !refreshing else { return }
        let revision = generation
        refreshing = true
        defer { if revision == generation { refreshing = false } }
        do {
            let feed = try await SteerAPI(connection: connection).conversations()
            guard revision == generation else { return }
            items = feed; syncedAt = Date(); error = nil
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
                    if let snapshot, let index = items.firstIndex(where: { $0.id == id }) {
                        items[index].status = snapshot.task.status
                        items[index].summary = snapshot.task.result ?? snapshot.task.error ?? snapshot.content ?? items[index].summary
                    }
                }
            }
            try SecureStore.write(CachedFeed(account: account, items: items, syncedAt: syncedAt!), key: "feed")
        } catch { if revision == generation { self.error = error.localizedDescription } }
    }
    func refreshTask(_ id: String) async {
        guard let connection, let item = items.first(where: { $0.id == id }), let taskID = item.taskID else { return }
        let revision = generation
        do {
            let snapshot = try await SteerAPI(connection: connection).task(taskID)
            guard revision == generation, let index = items.firstIndex(where: { $0.id == id }), items[index].taskID == taskID else { return }
            items[index].status = snapshot.task.status
            items[index].summary = snapshot.task.result ?? snapshot.task.error ?? snapshot.content ?? items[index].summary
            error = nil; syncedAt = Date()
        } catch { if revision == generation { self.error = error.localizedDescription } }
    }
    func draftKey(_ id: String) -> String { "draft.\(account).\(id)" }
    func draft(_ id: String) -> Draft { SecureStore.read(draftKey(id)) ?? Draft(text: "") }
    func saveDraft(_ value: Draft, id: String) throws { try SecureStore.write(value, key: draftKey(id)) }
    func discardDraft(_ id: String, account: String) { SecureStore.delete("draft.\(account).\(id)") }
    func send(_ item: Conversation, draft: Draft) async throws {
        guard let connection, !sending else { throw APIError(message: "当前无法发送") }
        sending = true; defer { sending = false }
        let created = try await SteerAPI(connection: connection).send(item, draft: draft)
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index].status = "pending"; items[index].taskID = created.taskId; items[index].summary = "任务已提交，等待执行"
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
