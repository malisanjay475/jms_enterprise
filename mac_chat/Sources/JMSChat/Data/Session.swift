import Foundation
import Security

enum AppConfig {
    /** The MAIN server. JMS_CHAT_BASE_URL overrides it for local testing. */
    static let baseURL: String = {
        let env = ProcessInfo.processInfo.environment["JMS_CHAT_BASE_URL"] ?? ""
        return (env.isEmpty ? "https://jmsocean.cloud" : env).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }()

    static var version: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
    }
}

/**
 * The signed-in user and their chat session token (sent as "Authorization: Bearer").
 * Kept in the login Keychain, device-only, so a copied home folder cannot replay it.
 */
enum Session {
    private static let lock = NSLock()
    private static var _token: String?
    private static var _username: String?

    private static let service = "com.jmsocean.chat.mac"
    private static let account = "session"

    static var token: String? { lock.lock(); defer { lock.unlock() }; return _token }
    static var username: String? { lock.lock(); defer { lock.unlock() }; return _username }
    static var signedIn: Bool { token != nil }

    static func load() {
        guard let data = keychainRead(),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let u = obj["u"], let t = obj["t"] else { return }
        lock.lock(); _username = u; _token = t; lock.unlock()
    }

    static func save(username u: String, token t: String) {
        if let data = try? JSONSerialization.data(withJSONObject: ["u": u, "t": t]) { keychainWrite(data) }
        lock.lock(); _username = u; _token = t; lock.unlock()
    }

    static func clear() {
        keychainDelete()
        lock.lock(); _username = nil; _token = nil; lock.unlock()
    }

    static func isMe(_ name: String?) -> Bool {
        guard let name, let me = username else { return false }
        return name.caseInsensitiveCompare(me) == .orderedSame
    }

    // MARK: Keychain

    private static var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    private static func keychainRead() -> Data? {
        var q = baseQuery
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    private static func keychainWrite(_ data: Data) {
        keychainDelete()
        var q = baseQuery
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    private static func keychainDelete() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
