import SwiftUI
import WatchKit
import UserNotifications
import CryptoKit

struct PushIdentity: Codable {
    var id = UUID().uuidString
    var secret = UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: "")
}
struct PushServiceStatus: Decodable { let enabled: Bool; let topic: String? }

@MainActor final class WatchNotifications: ObservableObject {
    static let shared = WatchNotifications()
    @Published var status = ""
    @Published var openItem: Conversation?
    var continueByVoice = false
    var connection: Connection?
    var token: String?
    private var registering = false
    private var configuring = false
    private var configurationRequested = false
    private var previousConnections: [Connection] = []
    private var serviceEnabled = false
    private let identity: PushIdentity
    private var seen: [String] = []
    var account: String { guard let c = connection else { return "" }; return SHA256.hash(data: Data((c.server + "\n" + c.apiKey).utf8)).map { String(format: "%02x", $0) }.joined() }
    private init() {
        identity = SecureStore.read("push.identity") ?? PushIdentity()
        try? SecureStore.write(identity, key: "push.identity")
        connection = SecureStore.read("connection")
        seen = SecureStore.read("push.seen.\(account)") ?? []
    }
    func configure(_ c: Connection?) async {
        if c != connection {
            if let previous = connection { previousConnections.append(previous) }
            connection = c; serviceEnabled = false
            seen = SecureStore.read("push.seen.\(account)") ?? []
        }
        if configuring { configurationRequested = true; return }
        configuring = true
        repeat {
            configurationRequested = false
            await configureCurrent()
        } while configurationRequested
        configuring = false
    }
    private func configureCurrent() async {
        let previous = previousConnections
        previousConnections = []
        for c in previous {
            let body = try? JSONSerialization.data(withJSONObject: ["bindingSecret": identity.secret])
            let _: PushRemoved? = try? await SteerAPI(connection: c).request("watch/devices/\(identity.id)", method: "DELETE", body: body)
        }
        let c = connection
        guard let c else { status = ""; return }
        let revision = account
        do {
            let service: PushServiceStatus = try await SteerAPI(connection: c).request("watch/notifications")
            guard revision == account else { return }
            guard service.enabled else { status = "后台通知待配置"; return }
            guard service.topic == Bundle.main.bundleIdentifier else { status = "推送应用标识不匹配"; return }
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
            guard revision == account else { return }
            guard granted else { status = "通知未获授权"; return }
            serviceEnabled = true
            let voice = UNNotificationAction(identifier: "STEER_CONTINUE", title: "语音续聊", options: [.foreground])
            UNUserNotificationCenter.current().setNotificationCategories([UNNotificationCategory(identifier: "STEER_TASK", actions: [voice], intentIdentifiers: [])])
            WKApplication.shared().registerForRemoteNotifications()
            if token != nil { await register() }
        } catch { if revision == account { status = "后台通知暂不可用" } }
    }
    func register() async {
        guard serviceEnabled, let c = connection, let token, !registering else { return }
        let revision = account
        registering = true
        defer {
            registering = false
            if revision != account { Task { await self.register() } }
        }
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        do {
            let body = try JSONSerialization.data(withJSONObject: ["id": identity.id, "bindingSecret": identity.secret, "accountFingerprint": revision,
                "token": token, "topic": Bundle.main.bundleIdentifier ?? "", "environment": environment])
            let response: PushServiceStatus = try await SteerAPI(connection: c).request("watch/devices", method: "POST", body: body)
            if revision == account { status = response.enabled ? "任务完成通知已开启" : "后台通知待配置" }
        } catch { if revision == account { status = "通知注册未完成" } }
    }
    func claimed(_ task: String) -> Bool { seen.contains(task) }
    func claim(_ task: String) -> Bool {
        guard !seen.contains(task) else { return false }
        seen.append(task); seen = Array(seen.suffix(200))
        try? SecureStore.write(seen, key: "push.seen.\(account)")
        return true
    }
    func accepts(_ info: [AnyHashable: Any]) -> Bool { connection != nil && info["accountFingerprint"] as? String == account }
    func open(_ info: [AnyHashable: Any]) {
        guard accepts(info), let id = info["conversationId"] as? String, let task = info["taskId"] as? String,
              let agent = info["agentId"] as? String else { return }
        _ = claim(task)
        openItem = Conversation(id: id, title: info["title"] as? String ?? "任务结果", agentID: agent, agentName: info["agentName"] as? String ?? "Agent",
            projectName: info["projectName"] as? String ?? "", taskID: task, status: info["status"] as? String ?? "succeeded", summary: "正在同步任务结果…", updatedAt: "")
    }
    struct PushRemoved: Decodable { let removed: Bool }
}
final class WatchPushDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
    override init() { super.init(); UNUserNotificationCenter.current().delegate = self }
    func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
        Task { @MainActor in WatchNotifications.shared.token = deviceToken.map { String(format: "%02x", $0) }.joined(); await WatchNotifications.shared.register() }
    }
    func didFailToRegisterForRemoteNotificationsWithError(_ error: Error) {
        Task { @MainActor in WatchNotifications.shared.status = "Apple 推送注册未完成" }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        let info = notification.request.content.userInfo
        return await MainActor.run {
            guard WatchNotifications.shared.accepts(info), let task = info["taskId"] as? String, WatchNotifications.shared.claim(task) else { return [] }
            return [.banner, .sound]
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        await MainActor.run {
            WatchNotifications.shared.continueByVoice = response.actionIdentifier == "STEER_CONTINUE"
            WatchNotifications.shared.open(response.notification.request.content.userInfo)
        }
    }
}
