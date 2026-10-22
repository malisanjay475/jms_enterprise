import AppKit
import UserNotifications

/**
 * macOS notifications for new messages while the app runs (the Mac has no FCM): one
 * thread per chat, sender + text, Reply and Mark as read from the banner, a click opens
 * the chat. The Dock icon shows the unread count.
 */
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifier()

    weak var app: AppState?
    private var ready = false

    /** Notifications need a real app bundle; `swift run` has none. */
    private var center: UNUserNotificationCenter? {
        Bundle.main.bundleIdentifier == nil ? nil : UNUserNotificationCenter.current()
    }

    func setUp(_ app: AppState) {
        self.app = app
        guard !ready, let c = center else { return }
        ready = true
        c.delegate = self
        let reply = UNTextInputNotificationAction(identifier: "REPLY", title: "Reply", options: [],
                                                  textInputButtonTitle: "Send", textInputPlaceholder: "Message")
        let read = UNNotificationAction(identifier: "READ", title: "Mark as read", options: [])
        c.setNotificationCategories([UNNotificationCategory(identifier: "MSG", actions: [reply, read], intentIdentifiers: [], options: [])])
        c.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    func notify(_ m: Message, conv: Conversation?) {
        guard let c = center else { return }
        let content = UNMutableNotificationContent()
        if let conv, conv.isGroup {
            content.title = conv.name
            content.subtitle = m.sender
        } else {
            content.title = m.sender
        }
        content.body = previewText(m)
        content.sound = .default
        content.categoryIdentifier = "MSG"
        content.threadIdentifier = m.conversationSyncId
        content.userInfo = ["conv": m.conversationSyncId]
        c.add(UNNotificationRequest(identifier: m.syncId, content: content, trigger: nil))
    }

    /** The chat was read (here or elsewhere): drop its banners. */
    func clear(conv: String) {
        guard let c = center else { return }
        c.getDeliveredNotifications { list in
            let ids = list.filter { $0.request.content.threadIdentifier == conv }.map { $0.request.identifier }
            if !ids.isEmpty { c.removeDeliveredNotifications(withIdentifiers: ids) }
        }
    }

    func clearAll() {
        center?.removeAllDeliveredNotifications()
    }

    func setBadge(_ unread: Int) {
        NSApp.dockTile.badgeLabel = unread > 0 ? String(unread) : nil
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let conv = response.notification.request.content.userInfo["conv"] as? String ?? ""
        let action = response.actionIdentifier
        let text = (response as? UNTextInputNotificationResponse)?.userText.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        Task { @MainActor in
            switch action {
            case "REPLY":
                if !text.isEmpty, !conv.isEmpty {
                    _ = try? await Api.sendText(conv, text, replyTo: nil, syncId: UUID().uuidString.lowercased())
                }
                await Api.markRead(conv)
            case "READ":
                await Api.markRead(conv)
            default:
                NSApp.activate(ignoringOtherApps: true)
                NSApp.windows.first { $0.canBecomeMain }?.makeKeyAndOrderFront(nil)
                if !conv.isEmpty { self.app?.selection = conv }
            }
            self.app?.reloadSoon()
            completionHandler()
        }
    }
}

/** One line for a message: its text, or what was sent. */
func previewText(_ m: Message) -> String {
    if m.deleted { return "This message was deleted" }
    if let a = m.attachment {
        let caption = m.body.trimmingCharacters(in: .whitespacesAndNewlines)
        let label: String
        switch a.kind {
        case "image": label = "📷 Photo"
        case "video": label = "🎥 Video"
        case "audio": label = "🎤 Voice message"
        case "pdf": label = "📄 " + a.fileName
        case "xlsx": label = "📊 " + a.fileName
        default: label = "📎 " + a.fileName
        }
        return caption.isEmpty || caption.hasPrefix("🎤") || caption.hasPrefix("🎥") ? label : label + " · " + caption
    }
    if m.kind == "link", let t = m.link?.title { return "🔗 " + t }
    return m.body
}
