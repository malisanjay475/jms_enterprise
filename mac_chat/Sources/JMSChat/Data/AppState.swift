import AppKit
import Combine
import Foundation

/** Window-level sheets (also opened from the menu bar). */
enum AppSheet: String, Identifiable {
    case newChat, newGroup, profile, starred
    var id: String { rawValue }
}

/** Who is signed in, the chat list and the open chat. */
@MainActor
final class AppState: ObservableObject {
    @Published var username: String?
    @Published var sheet: AppSheet?
    @Published var conversations: [Conversation] = []
    @Published var selection: String?
    @Published var listError: String?
    @Published var loadingList = false
    @Published var showArchived = false

    private var cancellables = Set<AnyCancellable>()
    private var reloadTask: Task<Void, Never>?

    init() {
        Session.load()
        username = Session.username
        NotificationCenter.default.publisher(for: .jmsSignedOut)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.didSignOut() }
            .store(in: &cancellables)
        Live.shared.events
            .sink { [weak self] ev in self?.onEvent(ev) }
            .store(in: &cancellables)
        NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
            .sink { [weak self] _ in self?.onActive() }
            .store(in: &cancellables)
        if username != nil { start() }
    }

    private func start() {
        Notifier.shared.setUp(self)
        loadingList = true
        loadConversations()
        Live.shared.start()
    }

    func signedIn(username u: String, token: String) {
        Session.save(username: u, token: token)
        username = u
        start()
    }

    func signOut() {
        let token = Session.token
        Task { await Api.logout(token: token) }
        Session.clear()
        didSignOut()
    }

    private func didSignOut() {
        Live.shared.stop()
        username = nil
        conversations = []
        selection = nil
        Notifier.shared.clearAll()
        Notifier.shared.setBadge(0)
    }

    func loadConversations() {
        Task {
            do {
                let list = try await Api.conversations()
                conversations = list
                listError = nil
                let unread = list.filter { !$0.isMuted }.reduce(0) { $0 + $1.unread }
                Notifier.shared.setBadge(unread)
                if list.allSatisfy({ $0.unread == 0 }) { Notifier.shared.clearAll() }
            } catch {
                listError = error.localizedDescription
            }
            loadingList = false
        }
    }

    /** Many events at once (a busy group) make one reload. */
    func reloadSoon() {
        if reloadTask != nil { return }
        reloadTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            reloadTask = nil
            loadConversations()
        }
    }

    func conversation(_ id: String?) -> Conversation? {
        guard let id else { return nil }
        return conversations.first { $0.syncId == id }
    }

    /** Opens (or creates) the direct chat with someone. */
    func openDirect(_ user: String) async throws {
        let c = try await Api.openDirect(user)
        if !conversations.contains(where: { $0.syncId == c.syncId }) { conversations.insert(c, at: 0) }
        selection = c.syncId
        reloadSoon()
    }

    func createGroup(_ title: String, _ members: [String]) async throws {
        let c = try await Api.createGroup(title, members)
        conversations.insert(c, at: 0)
        selection = c.syncId
        reloadSoon()
    }

    func pin(_ c: Conversation) {
        Task {
            do { try await Api.pin(c.syncId, !c.pinned); loadConversations() } catch { listError = error.localizedDescription }
        }
    }

    func archive(_ c: Conversation) {
        Task {
            do { try await Api.archive(c.syncId, !c.archived); loadConversations() } catch { listError = error.localizedDescription }
        }
    }

    func mute(_ convId: String, _ how: String) {
        Task {
            do { try await Api.mute(convId, how); loadConversations() } catch { listError = error.localizedDescription }
        }
    }

    private func onActive() {
        if let s = selection { Notifier.shared.clear(conv: s) }
    }

    private func onEvent(_ ev: LiveEvent) {
        switch ev.type {
        case "message":
            if let m = ev.message, !Session.isMe(m.sender) {
                let conv = conversation(m.conversationSyncId)
                let looking = NSApp.isActive && selection == m.conversationSyncId
                if !looking && !(conv?.isMuted ?? false) { Notifier.shared.notify(m, conv: conv) }
            }
            reloadSoon()
        case "message_update", "conversation", "reconnect":
            reloadSoon()
        case "receipt":
            // My own read on another device: the list's unread count changes.
            if Session.isMe(ev.username), ev.kind == "read" {
                if let c = ev.conversationSyncId { Notifier.shared.clear(conv: c) }
                reloadSoon()
            }
        default:
            break
        }
    }
}
