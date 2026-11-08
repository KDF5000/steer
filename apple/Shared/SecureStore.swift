import Foundation
import Security

// Credentials and drafts stay in Keychain, never in UserDefaults or source.
enum SecureStore {
    static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "SteerApple", kSecAttrAccount as String: key]
    }
    static func read<T: Decodable>(_ key: String, as type: T.Type = T.self) -> T? {
        var q = query(key); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
    static func write<T: Encodable>(_ value: T, key: String) throws {
        let data = try JSONEncoder().encode(value)
        let status = SecItemUpdate(query(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var q = query(key); q[kSecValueData as String] = data
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let created = SecItemAdd(q as CFDictionary, nil)
            guard created == errSecSuccess else { throw APIError(message: "无法安全保存配置（\(created)）") }
        } else if status != errSecSuccess { throw APIError(message: "无法安全保存配置（\(status)）") }
    }
    static func delete(_ key: String) { SecItemDelete(query(key) as CFDictionary) }
}
