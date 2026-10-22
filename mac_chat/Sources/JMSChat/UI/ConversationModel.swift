import Combine
import Foundation

/** One open chat: its messages, live updates, sending (same flow as the Android ConversationViewModel). */
@MainActor
final class ConversationModel: ObservableObject {
    let convId: String

    @Published var messages: [Message] = []
    @Published var title = ""
    @Published var isGroup = false
    @Published var members: [String] = []
    @Published var memberRoles: [Member] = []
    @Published var typing: String?
    @Published var online = false
    @Published var lastSeen: String?
    @Published var peer: String?
    @Published var peerPhoto: String?
    @Published var loading = true
    @Published var loadingOlder = false
    @Published var error: String?
    @Published var replyTo: Message?
    @Published var editing: Message?
    @Published var draft = ""
    /** Bumped when the view should scroll to the newest message. */
    @Published var scrollToEnd = 0

    private var hasMore = false
    private var typingClear: Task<Void, Never>?
    private var lastTypingSent = Date.distantPast
    private var cancellables = Set<AnyCancellable>()

    init(_ convId: String) {
        self.convId = convId
        Live.shared.events
            .sink { [weak self] ev in self?.onEvent(ev) }
            .store(in: &cancellables)
        load()
    }

    var canLoadOlder: Bool { hasMore }

    private func onEvent(_ ev: LiveEvent) {
        switch ev.type {
        case "message":
            guard let m = ev.message, m.conversationSyncId == convId else { return }
            upsert(m)
            if !Session.isMe(m.sender) {
                if typing == m.sender { typing = nil }
                Task { await Api.markRead(convId) }
            }
            scrollToEnd += 1
        case "message_update":
            if let m = ev.message, m.conversationSyncId == convId { upsert(m) }
        case "receipt":
            if ev.conversationSyncId == convId { applyReceipt(ev.username ?? "", ev.kind ?? "", ev.messageSyncIds ?? []) }
        case "typing":
            guard ev.conversationSyncId == convId, !Session.isMe(ev.username) else { return }
            typing = ev.username
            typingClear?.cancel()
            typingClear = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                if !Task.isCancelled { self?.typing = nil }
            }
        case "reaction":
            if ev.conversationSyncId == convId, let id = ev.messageSyncId { replace(id) { $0.reactions = ev.reactions } }
        case "task":
            if ev.conversationSyncId == convId, let id = ev.messageSyncId {
                replace(id) { $0.task = TaskStatus(status: ev.status ?? "open", by: ev.by) }
            }
        case "conversation", "reconnect":
            refresh()
        default:
            break
        }
    }

    private func load() {
        Task {
            do {
                let r = try await Api.messages(convId)
                messages = r.messages
                apply(r)
                error = nil
                scrollToEnd += 1
                await Api.markRead(convId)
                Notifier.shared.clear(conv: convId)
            } catch {
                self.error = error.localizedDescription
            }
            loading = false
        }
    }

    private func apply(_ r: MessagesReply) {
        hasMore = r.hasMore
        isGroup = r.type == "group"
        members = r.members
        memberRoles = r.memberRoles
        title = r.title ?? r.members.first { !Session.isMe($0) } ?? "Chat"
        if !isGroup, peer == nil, let p = r.members.first(where: { !Session.isMe($0) }) {
            peer = p
            Task { await refreshPeer() }
        }
    }

    /** Direct chat: the other person's photo, online / last seen. The view polls it every 30 s. */
    func refreshPeer() async {
        guard let p = peer, let pr = try? await Api.profileOf(p) else { return }
        online = pr.online
        lastSeen = pr.lastSeenAt
        peerPhoto = pr.photoV
    }

    /** After a reconnect or a change to the chat: fetch the newest page and merge it in. */
    private func refresh() {
        Task {
            guard let r = try? await Api.messages(convId) else { return }
            r.messages.forEach { upsert($0) }
            apply(r)
        }
    }

    func loadOlder() {
        guard hasMore, !loadingOlder, let oldest = messages.first(where: { !$0.pending })?.serverTs else { return }
        loadingOlder = true
        Task {
            if let r = try? await Api.messages(convId, before: oldest) {
                hasMore = r.hasMore
                let known = Set(messages.map { $0.syncId })
                messages = r.messages.filter { !known.contains($0.syncId) } + messages
            }
            loadingOlder = false
        }
    }

    func upsert(_ m: Message) {
        if let i = messages.firstIndex(where: { $0.syncId == m.syncId }) {
            // live copies carry no receipts: keep the ones we have
            var n = m
            n.deliveredTo = m.deliveredTo ?? messages[i].deliveredTo
            n.readBy = m.readBy ?? messages[i].readBy
            messages[i] = n
        } else {
            messages.append(m)
            messages.sort { ($0.serverTs ?? "9999") < ($1.serverTs ?? "9999") }
        }
    }

    private func replace(_ id: String, _ change: (inout Message) -> Void) {
        guard let i = messages.firstIndex(where: { $0.syncId == id }) else { return }
        change(&messages[i])
    }

    private func applyReceipt(_ user: String, _ kind: String, _ ids: [String]) {
        guard !ids.isEmpty else { return }
        let set = Set(ids)
        func adding(_ list: [String]?) -> [String] {
            let l = list ?? []
            return l.contains { $0.caseInsensitiveCompare(user) == .orderedSame } ? l : l + [user]
        }
        for i in messages.indices where set.contains(messages[i].syncId) {
            messages[i].deliveredTo = adding(messages[i].deliveredTo)
            if kind == "read" { messages[i].readBy = adding(messages[i].readBy) }
        }
    }

    func onTyping() {
        guard Date().timeIntervalSince(lastTypingSent) > 2.5 else { return }
        lastTypingSent = Date()
        Task { await Api.typing(convId) }
    }

    func setReply(_ m: Message?) { editing = nil; replyTo = m }

    func startEdit(_ m: Message) {
        replyTo = nil
        editing = m
        draft = m.body
    }

    func cancelCompose() {
        if editing != nil { draft = "" }
        editing = nil
        replyTo = nil
    }

    /** Own text messages can be edited within 15 minutes (the server's window). */
    func canEdit(_ m: Message) -> Bool {
        guard Session.isMe(m.sender), !m.deleted, m.kind == "text", m.attachment == nil, !m.pending, !m.failed,
              let t = m.serverTs?.parsedDate else { return false }
        return Date().timeIntervalSince(t) < 15 * 60
    }

    // MARK: Sending

    func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        if let e = editing {
            editing = nil
            Task {
                do { upsert(try await Api.editMessage(e.syncId, text)) } catch { self.error = error.localizedDescription }
            }
            return
        }
        let reply = replyTo
        replyTo = nil
        var local = Message(syncId: UUID().uuidString.lowercased(), conversationSyncId: convId,
                            sender: Session.username ?? "", body: text, serverTs: Date().isoString)
        local.replyToSyncId = reply?.syncId
        local.replyTo = reply.map { ReplyQuote(of: $0) }
        local.pending = true
        messages.append(local)
        scrollToEnd += 1
        deliver(local)
    }

    private func deliver(_ local: Message) {
        Task {
            do {
                let m = try await Api.sendText(convId, local.body, replyTo: local.replyToSyncId, syncId: local.syncId)
                messages.removeAll { $0.syncId == local.syncId && $0.pending }
                upsert(m)
            } catch {
                replace(local.syncId) { $0.pending = false; $0.failed = true }
                self.error = error.localizedDescription
            }
        }
    }

    func retry(_ m: Message) {
        guard m.failed else { return }
        if let url = m.localFile {
            messages.removeAll { $0.syncId == m.syncId }
            Task { await sendFile(url, caption: "", reply: nil) }
        } else {
            replace(m.syncId) { $0.failed = false; $0.pending = true }
            if let fresh = messages.first(where: { $0.syncId == m.syncId }) { deliver(fresh) }
        }
    }

    /** Files picked, dropped or pasted: sent one after another, in order (max 10). */
    func sendFiles(_ urls: [URL]) {
        let reply = replyTo
        replyTo = nil
        let caption = urls.count == 1 && editing == nil ? draft.trimmingCharacters(in: .whitespacesAndNewlines) : ""
        if !caption.isEmpty { draft = "" }
        let picked = Array(urls.prefix(10))
        Task {
            for url in picked { await sendFile(url, caption: caption, reply: reply) }
        }
    }

    private func sendFile(_ url: URL, caption: String, reply: Message?) async {
        let syncId = UUID().uuidString.lowercased()
        var local = Message(syncId: syncId, conversationSyncId: convId, sender: Session.username ?? "",
                            body: "📎 Sending " + url.lastPathComponent + "…", serverTs: Date().isoString)
        local.pending = true
        messages.append(local)
        scrollToEnd += 1
        do {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let f = try Media.prepare(url)
            let m = try await Api.sendFile(convId, data: f.data, fileName: f.name, mime: f.mime, caption: caption,
                                           replyTo: reply?.syncId, syncId: syncId)
            messages.removeAll { $0.syncId == syncId && $0.pending }
            upsert(m)
        } catch {
            replace(syncId) { $0.pending = false; $0.failed = true; $0.localFile = url; $0.body = "📎 " + url.lastPathComponent + " — not sent" }
            self.error = error.localizedDescription
        }
    }

    // MARK: Message actions

    func react(_ m: Message, _ emoji: String) {
        Task {
            do { let rx = try await Api.react(m.syncId, emoji); replace(m.syncId) { $0.reactions = rx } }
            catch { self.error = error.localizedDescription }
        }
    }

    func toggleStar(_ m: Message) {
        Task {
            do { try await Api.star(m.syncId, !m.starred); replace(m.syncId) { $0.starred = !m.starred } }
            catch { self.error = error.localizedDescription }
        }
    }

    func delete(_ m: Message) {
        if m.failed { messages.removeAll { $0.syncId == m.syncId }; return }
        Task {
            do { upsert(try await Api.deleteMessage(m.syncId)) } catch { self.error = error.localizedDescription }
        }
    }

    func setTask(_ m: Message, _ status: String) {
        Task {
            do { let t = try await Api.setTask(m.syncId, status); replace(m.syncId) { $0.task = t } }
            catch { self.error = error.localizedDescription }
        }
    }
}
