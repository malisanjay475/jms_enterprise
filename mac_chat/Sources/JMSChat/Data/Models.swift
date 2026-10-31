import Foundation

// Shapes of the /api/chat/* answers (BACKEND/src/modules/chat/registerChatRoutes.js).
// Unknown fields are ignored, missing ones fall back to the defaults — same rules as
// android_chat/.../data/Models.kt. Each decoder lives in an extension so the
// memberwise init stays available for local (pending) values.

struct JK: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
    init(_ s: String) { stringValue = s }
}

extension KeyedDecodingContainer where Key == JK {
    func v<T: Decodable>(_ key: String, _ fallback: T) -> T {
        (try? decodeIfPresent(T.self, forKey: JK(key))) ?? fallback
    }

    func o<T: Decodable>(_ key: String) -> T? {
        try? decodeIfPresent(T.self, forKey: JK(key))
    }

    /** A string the server may send as a number. */
    func s(_ key: String) -> String? {
        if let x: String = o(key) { return x }
        if let x: Int = o(key) { return String(x) }
        if let x: Double = o(key) { return String(x) }
        return nil
    }
}

struct LoginReply: Decodable {
    var ok = false
    var error: String?
    var username: String?
    var token: String?
}

extension LoginReply {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        ok = c.v("ok", false); error = c.o("error"); username = c.o("username"); token = c.o("token")
    }
}

struct ChatUser: Decodable, Identifiable, Hashable {
    var username: String
    var displayName = ""
    var role = ""
    var line = ""
    var online = false
    var about = ""
    var photoV: String?
    var lastSeenAt: String?
    var id: String { username }
}

extension ChatUser {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        username = c.v("username", ""); displayName = c.v("display_name", "")
        role = c.v("role", ""); line = c.v("line", ""); online = c.v("online", false)
        about = c.v("about", ""); photoV = c.s("photo_v"); lastSeenAt = c.o("last_seen_at")
    }
}

struct Conversation: Decodable, Identifiable, Hashable {
    var syncId: String
    var type = "direct"
    var title: String?
    var members: [String] = []
    var myRole: String?
    var mutedUntil: String?
    var online = false
    var lastMessageAt: String?
    var lastBody: String?
    var lastSender: String?
    var unread = 0
    var pinned = false
    var archived = false
    var peer: String?
    var photoV: String?
    var lastSeenAt: String?

    var id: String { syncId }
    var isGroup: Bool { type == "group" }
    var name: String { title ?? "Chat" }
    var isMuted: Bool { mutedUntil.map { ($0.parsedDate ?? .distantFuture) > Date() } ?? false }
}

extension Conversation {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        syncId = c.v("sync_id", "")
        type = c.v("type", "direct"); title = c.o("title"); members = c.v("members", [])
        myRole = c.o("my_role"); mutedUntil = c.o("muted_until"); online = c.v("online", false)
        lastMessageAt = c.o("last_message_at"); lastBody = c.o("last_body"); lastSender = c.o("last_sender")
        unread = c.v("unread", 0); pinned = c.v("pinned", false); archived = c.v("archived", false)
        peer = c.o("peer"); photoV = c.s("photo_v"); lastSeenAt = c.o("last_seen_at")
    }
}

struct Attachment: Decodable, Equatable {
    var syncId: String
    var kind = ""
    var mime = ""
    var fileName = ""
    var size: Int64 = 0
}

extension Attachment {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        syncId = c.v("sync_id", ""); kind = c.v("kind", ""); mime = c.v("mime", "")
        fileName = c.v("file_name", ""); size = c.v("size", Int64(0))
    }
}

struct ReplyQuote: Decodable, Equatable {
    var syncId = ""
    var sender = ""
    var kind = "text"
    var text = ""
    var deleted = false
    var image: String?
}

extension ReplyQuote {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        syncId = c.v("sync_id", ""); sender = c.v("sender", ""); kind = c.v("kind", "text")
        text = c.v("text", ""); deleted = c.v("deleted", false); image = c.o("image")
    }

    init(of m: Message) {
        self.init(syncId: m.syncId, sender: m.sender, kind: m.attachment?.kind ?? m.kind, text: m.body, deleted: m.deleted, image: nil)
    }
}

struct Reaction: Decodable, Equatable, Hashable {
    var emoji: String
    var users: [String] = []
}

extension Reaction {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        emoji = c.v("emoji", ""); users = c.v("users", [])
    }
}

struct TaskStatus: Decodable, Equatable {
    var status = "open"
    var by: String?
}

extension TaskStatus {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        status = c.v("status", "open"); by = c.o("by")
    }
}

/** A shared JMS page (kind = link). */
struct LinkInfo: Decodable, Equatable {
    var title: String?
    var url: String?
    var excerpt: String?
    var factoryName: String?
    var priority: String?
}

extension LinkInfo {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        title = c.s("title"); url = c.s("url"); excerpt = c.s("excerpt")
        factoryName = c.s("factory_name"); priority = c.s("priority")
    }
}

struct Message: Decodable, Identifiable, Equatable {
    var syncId: String
    var conversationSyncId: String
    var sender = ""
    var body = ""
    var kind = "text"
    var serverTs: String?
    var editedAt: String?
    var deleted = false
    var purged = false
    var replyToSyncId: String?
    var replyTo: ReplyQuote?
    var attachment: Attachment?
    var deliveredTo: [String]?
    var readBy: [String]?
    var forwarded = false
    var reactions: [Reaction]?
    var starred = false
    var link: LinkInfo?
    var task: TaskStatus?
    // local only: sending / failed
    var pending = false
    var failed = false
    /** A file that failed to send, so it can be retried. */
    var localFile: URL?

    var id: String { syncId }
}

extension Message {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        syncId = c.v("sync_id", ""); conversationSyncId = c.v("conversation_sync_id", "")
        sender = c.v("sender", ""); body = c.v("body", ""); kind = c.v("kind", "text")
        serverTs = c.o("server_ts"); editedAt = c.o("edited_at")
        deleted = c.v("deleted", false); purged = c.v("purged", false)
        replyToSyncId = c.o("reply_to_sync_id"); replyTo = c.o("reply_to"); attachment = c.o("attachment")
        deliveredTo = c.o("delivered_to"); readBy = c.o("read_by")
        forwarded = c.v("forwarded", false); reactions = c.o("reactions"); starred = c.v("starred", false)
        link = c.o("link"); task = c.o("task")
    }
}

struct Receipt: Decodable, Identifiable {
    var username: String
    var at: String?
    var id: String { username }
}

extension Receipt {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        username = c.v("username", ""); at = c.o("at")
    }
}

struct MessageInfo: Decodable {
    var sentAt: String?
    var read: [Receipt] = []
    var delivered: [Receipt] = []
    var pending: [Receipt] = []
}

extension MessageInfo {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        sentAt = c.o("sent_at"); read = c.v("read", []); delivered = c.v("delivered", []); pending = c.v("pending", [])
    }
}

struct FoundMessage: Decodable, Identifiable {
    var message: Message
    var conversationTitle = ""
    var id: String { message.syncId }
}

extension FoundMessage {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        message = try c.decode(Message.self, forKey: JK("message"))
        conversationTitle = c.v("conversation_title", "")
    }
}

struct Member: Decodable, Identifiable {
    var username: String
    var displayName = ""
    var role: String?
    var online = false
    var lastSeenAt: String?
    var photoV: String?
    var id: String { username }
}

extension Member {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        username = c.v("username", ""); displayName = c.v("display_name", ""); role = c.o("role"); online = c.v("online", false)
        lastSeenAt = c.o("last_seen_at"); photoV = c.s("photo_v")
    }
}

struct MessagesReply: Decodable {
    var messages: [Message] = []
    var hasMore = false
    var type = "direct"
    var title: String?
    var members: [String] = []
    var memberRoles: [Member] = []
}

extension MessagesReply {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        messages = c.v("messages", []); hasMore = c.v("has_more", false); type = c.v("type", "direct")
        title = c.o("title"); members = c.v("members", []); memberRoles = c.v("member_roles", [])
    }
}

struct Profile: Decodable {
    var username = ""
    var role = ""
    var line = ""
    var about = ""
    var photoV: String?
    var lastSeenAt: String?
    var online = false
    /** Name others see (approved); the login name until one is approved. */
    var displayName = ""
    /** Waiting for an admin (only for me and admins). */
    var pendingName: String?
    /** Why my last request was rejected. */
    var nameNote: String?
    /** Earlier names (admins only). */
    var nameHistory: [NameChange] = []
    var adminView = false
    var canApproveNames = false
    var nameRequests = 0
    var shownName: String { displayName.isEmpty ? username : displayName }
}

extension Profile {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        username = c.v("username", ""); role = c.v("role", ""); line = c.v("line", ""); about = c.v("about", "")
        photoV = c.s("photo_v"); lastSeenAt = c.o("last_seen_at"); online = c.v("online", false)
        displayName = c.v("display_name", ""); pendingName = c.o("pending_name"); nameNote = c.o("name_note")
        nameHistory = c.v("name_history", []); adminView = c.v("admin_view", false)
        canApproveNames = c.v("can_approve_names", false); nameRequests = c.v("name_requests", 0)
    }
}

struct NameChange: Decodable, Hashable {
    var username = ""
    var oldName: String?
    var newName = ""
    var status = ""
    var reviewedBy: String?
    var note: String?
    var at: String?
}

extension NameChange {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        username = c.v("username", ""); oldName = c.o("old_name"); newName = c.v("new_name", ""); status = c.v("status", "")
        reviewedBy = c.o("reviewed_by"); note = c.o("note"); at = c.o("at")
    }
}

struct NameRequest: Decodable, Identifiable {
    var username = ""
    var role = ""
    var line = ""
    var currentName = ""
    var requestedName = ""
    var photoV: String?
    var id: String { username }
}

extension NameRequest {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        username = c.v("username", ""); role = c.v("role", ""); line = c.v("line", "")
        currentName = c.v("current_name", ""); requestedName = c.v("requested_name", ""); photoV = c.s("photo_v")
    }
}

struct NameRequestsReply: Decodable {
    var requests: [NameRequest] = []
    var recent: [NameChange] = []
}

extension NameRequestsReply {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        requests = c.v("requests", []); recent = c.v("recent", [])
    }
}

/** One event from /api/chat/stream. */
struct LiveEvent: Decodable {
    var type = ""
    var message: Message?
    var conversationSyncId: String?
    var username: String?
    var kind: String?
    var messageSyncIds: [String]?
    var messageSyncId: String?
    var reactions: [Reaction]?
    var status: String?
    var by: String?
    var adminCopy = false
}

extension LiveEvent {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        type = c.v("type", ""); message = c.o("message"); conversationSyncId = c.o("conversation_sync_id")
        username = c.o("username"); kind = c.o("kind"); messageSyncIds = c.o("message_sync_ids")
        messageSyncId = c.o("message_sync_id"); reactions = c.o("reactions"); status = c.o("status")
        by = c.o("by"); adminCopy = c.v("adminCopy", false)
    }
}

// Small reply wrappers.
struct UsersReply: Decodable { var users: [ChatUser] }
extension UsersReply { init(from d: Decoder) throws { users = try d.container(keyedBy: JK.self).v("users", []) } }

struct ConversationsReply: Decodable { var conversations: [Conversation] }
extension ConversationsReply { init(from d: Decoder) throws { conversations = try d.container(keyedBy: JK.self).v("conversations", []) } }

struct ConversationReply: Decodable { var conversation: Conversation? }
extension ConversationReply { init(from d: Decoder) throws { conversation = try d.container(keyedBy: JK.self).o("conversation") } }

struct MessageReply: Decodable { var message: Message? }
extension MessageReply { init(from d: Decoder) throws { message = try d.container(keyedBy: JK.self).o("message") } }

struct FoundReply: Decodable { var results: [FoundMessage] }
extension FoundReply { init(from d: Decoder) throws { results = try d.container(keyedBy: JK.self).v("results", []) } }

struct ReactReply: Decodable { var reactions: [Reaction] }
extension ReactReply { init(from d: Decoder) throws { reactions = try d.container(keyedBy: JK.self).v("reactions", []) } }

struct ForwardReply: Decodable { var messages: [Message] }
extension ForwardReply { init(from d: Decoder) throws { messages = try d.container(keyedBy: JK.self).v("messages", []) } }

struct ProfileReply: Decodable { var profile: Profile?; var message = "" }
extension ProfileReply {
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: JK.self)
        profile = c.o("profile"); message = c.v("message", "")
    }
}

struct TaskReply: Decodable { var task: TaskStatus? }
extension TaskReply { init(from d: Decoder) throws { task = try d.container(keyedBy: JK.self).o("task") } }

// MARK: - Dates

private let isoFrac: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()
private let isoPlain = ISO8601DateFormatter()

extension String {
    /** Server timestamps are ISO-8601, usually with milliseconds. */
    var parsedDate: Date? { isoFrac.date(from: self) ?? isoPlain.date(from: self) }
}

extension Date {
    var isoString: String { isoFrac.string(from: self) }
}
