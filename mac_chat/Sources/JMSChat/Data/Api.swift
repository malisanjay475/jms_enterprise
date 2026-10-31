import Foundation
import UniformTypeIdentifiers

struct ApiError: LocalizedError {
    let message: String
    var status = 0
    var errorDescription: String? { message }
}

extension Notification.Name {
    /** The server said the session is gone (401): the app shows Login. */
    static let jmsSignedOut = Notification.Name("jmsSignedOut")
}

/** The MAIN server's chat API (same calls as android_chat/.../data/Api.kt). */
enum Api {
    static var base: String { AppConfig.baseURL }

    static let urlSession: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 60
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    /** For the live stream: the server sends a heartbeat every 20 s, so 75 s of silence means it is gone. */
    static let streamSession: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 75
        c.timeoutIntervalForResource = 7 * 24 * 3600
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    static func makeRequest(_ method: String, _ path: String, token: String? = Session.token) -> URLRequest {
        var r = URLRequest(url: URL(string: base + path)!)
        r.httpMethod = method
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        r.setValue("JMSChatApp/\(AppConfig.version) (macOS)", forHTTPHeaderField: "User-Agent")
        return r
    }

    static func signedOutByServer() {
        guard Session.signedIn else { return }
        Session.clear()
        DispatchQueue.main.async { NotificationCenter.default.post(name: .jmsSignedOut, object: nil) }
    }

    @discardableResult
    static func call(_ method: String, _ path: String, json: [String: Any]? = nil,
                     body: Data? = nil, contentType: String? = nil, token: String? = Session.token) async throws -> Data {
        var r = makeRequest(method, path, token: token)
        if let json {
            r.httpBody = try JSONSerialization.data(withJSONObject: json)
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        } else if let body {
            r.httpBody = body
            if let contentType { r.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        }
        let (data, resp) = try await urlSession.data(for: r)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 { signedOutByServer() }
        guard (200..<300).contains(code) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw ApiError(message: msg ?? "Server error (\(code))", status: code)
        }
        return data
    }

    static func get<T: Decodable>(_ path: String) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await call("GET", path))
    }

    static func send<T: Decodable>(_ method: String, _ path: String, _ json: [String: Any] = [:]) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await call(method, path, json: json))
    }

    static func enc(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }

    // ---- sign-in ----
    static func login(_ username: String, _ password: String) async -> LoginReply {
        do {
            return try await send("POST", "/api/chat-app/login", ["username": username, "password": password])
        } catch {
            return LoginReply(ok: false, error: error.localizedDescription)
        }
    }

    static func logout(token: String?) async {
        _ = try? await call("POST", "/api/chat-app/logout", json: [:], token: token)
    }

    // ---- chat ----
    static func users() async throws -> [ChatUser] { (try await get("/api/chat/users") as UsersReply).users }
    static func conversations() async throws -> [Conversation] { (try await get("/api/chat/conversations") as ConversationsReply).conversations }

    static func messages(_ convId: String, before: String? = nil) async throws -> MessagesReply {
        try await get("/api/chat/conversations/\(convId)/messages" + (before.map { "?before=" + enc($0) } ?? ""))
    }

    static func openDirect(_ username: String) async throws -> Conversation {
        guard let c = (try await send("POST", "/api/chat/conversations", ["username": username]) as ConversationReply).conversation
        else { throw ApiError(message: "Could not open the chat.") }
        return c
    }

    static func createGroup(_ title: String, _ members: [String]) async throws -> Conversation {
        guard let c = (try await send("POST", "/api/chat/groups", ["title": title, "members": members]) as ConversationReply).conversation
        else { throw ApiError(message: "Could not create the group.") }
        return c
    }

    static func sendText(_ convId: String, _ text: String, replyTo: String?, syncId: String) async throws -> Message {
        var body: [String: Any] = ["conversation_sync_id": convId, "body": text, "sync_id": syncId, "client_ts": Date().isoString]
        if let replyTo { body["reply_to_sync_id"] = replyTo }
        guard let m = (try await send("POST", "/api/chat/messages", body) as MessageReply).message
        else { throw ApiError(message: "Message not sent.") }
        return m
    }

    static func sendFile(_ convId: String, data: Data, fileName: String, mime: String, caption: String,
                         replyTo: String?, syncId: String) async throws -> Message {
        var form = Multipart()
        form.field("conversation_sync_id", convId)
        form.field("sync_id", syncId)
        form.field("body", caption)
        if let replyTo { form.field("reply_to_sync_id", replyTo) }
        form.file("file", fileName, mime, data)
        let d = try await call("POST", "/api/chat/attachments", body: form.finish(), contentType: form.contentType)
        guard let m = try JSONDecoder().decode(MessageReply.self, from: d).message else { throw ApiError(message: "File not sent.") }
        return m
    }

    static func markRead(_ convId: String) async { _ = try? await call("POST", "/api/chat/read", json: ["conversation_sync_id": convId]) }
    static func typing(_ convId: String) async { _ = try? await call("POST", "/api/chat/typing", json: ["conversation_sync_id": convId]) }

    // ---- reactions, stars, info, forward, search ----
    static func react(_ id: String, _ emoji: String) async throws -> [Reaction] {
        (try await send("POST", "/api/chat/messages/\(id)/react", ["emoji": emoji]) as ReactReply).reactions
    }
    static func star(_ id: String, _ on: Bool) async throws { try await call("POST", "/api/chat/messages/\(id)/star", json: ["on": on]) }
    static func starred() async throws -> [FoundMessage] { (try await get("/api/chat/starred") as FoundReply).results }
    static func messageInfo(_ id: String) async throws -> MessageInfo { try await get("/api/chat/messages/\(id)/info") }
    static func forward(_ id: String, to: [String]) async throws -> [Message] {
        (try await send("POST", "/api/chat/forward", ["message_sync_id": id, "to": to]) as ForwardReply).messages
    }
    static func search(_ q: String, conversation: String? = nil) async throws -> [FoundMessage] {
        (try await get("/api/chat/search?q=" + enc(q) + (conversation.map { "&conversation=\($0)" } ?? "")) as FoundReply).results
    }

    // ---- pin / archive / mute ----
    static func pin(_ convId: String, _ on: Bool) async throws { try await call("POST", "/api/chat/conversations/\(convId)/pin", json: ["on": on]) }
    static func archive(_ convId: String, _ on: Bool) async throws { try await call("POST", "/api/chat/conversations/\(convId)/archive", json: ["on": on]) }
    /** how: 8h, 1w, always or off. */
    static func mute(_ convId: String, _ how: String) async throws { try await call("POST", "/api/chat/conversations/\(convId)/mute", json: ["for": how]) }

    // ---- groups ----
    static func renameGroup(_ convId: String, _ title: String) async throws { try await call("PATCH", "/api/chat/groups/\(convId)", json: ["title": title]) }
    static func addMembers(_ convId: String, _ users: [String]) async throws { try await call("POST", "/api/chat/groups/\(convId)/members", json: ["members": users]) }
    static func removeMember(_ convId: String, _ user: String) async throws { try await call("DELETE", "/api/chat/groups/\(convId)/members/" + enc(user)) }
    static func leaveGroup(_ convId: String) async throws { try await call("POST", "/api/chat/groups/\(convId)/leave", json: [:]) }

    // ---- shared JMS work (link cards) ----
    static func setTask(_ id: String, _ status: String) async throws -> TaskStatus {
        (try await send("POST", "/api/chat/tasks/\(id)", ["status": status]) as TaskReply).task ?? TaskStatus(status: status)
    }

    // ---- edit / delete ----
    static func editMessage(_ id: String, _ body: String) async throws -> Message {
        guard let m = (try await send("PATCH", "/api/chat/messages/\(id)", ["body": body]) as MessageReply).message
        else { throw ApiError(message: "Not edited.") }
        return m
    }

    static func deleteMessage(_ id: String) async throws -> Message {
        guard let m = try JSONDecoder().decode(MessageReply.self, from: try await call("DELETE", "/api/chat/messages/\(id)")).message
        else { throw ApiError(message: "Not deleted.") }
        return m
    }

    // ---- profiles ----
    static func myProfile() async throws -> Profile { (try await get("/api/chat/profile") as ProfileReply).profile ?? Profile() }
    static func profileOf(_ username: String) async throws -> Profile {
        (try await get("/api/chat/profile/" + enc(username)) as ProfileReply).profile ?? Profile(username: username)
    }
    static func saveAbout(_ about: String) async throws -> Profile {
        (try await send("PUT", "/api/chat/profile", ["about": about]) as ProfileReply).profile ?? Profile()
    }
    /** Ask for a new name; the reply carries the server's note (e.g. "Sent for approval"). */
    static func saveName(_ name: String) async throws -> ProfileReply {
        try await send("PUT", "/api/chat/profile", ["name": name])
    }
    static func shared(_ username: String) async throws -> SharedReply { try await get("/api/chat/profile/" + enc(username) + "/shared") }
    static func saveWork(designation: String, department: String) async throws -> Profile {
        (try await send("PUT", "/api/chat/profile", ["designation": designation, "department": department]) as ProfileReply).profile ?? Profile()
    }

    static func cancelName() async throws -> Profile {
        try JSONDecoder().decode(ProfileReply.self, from: try await call("DELETE", "/api/chat/profile/name")).profile ?? Profile()
    }

    // ---- name approvals (admin / superadmin) ----
    static func nameRequests() async throws -> NameRequestsReply { try await get("/api/chat/name-requests") }
    static func decideName(_ username: String, approve: Bool, note: String = "") async throws {
        try await call("POST", "/api/chat/name-requests/" + enc(username), json: ["action": approve ? "approve" : "reject", "note": note])
    }

    static func uploadPhoto(_ data: Data, fileName: String, mime: String) async throws -> Profile {
        var form = Multipart()
        form.file("photo", fileName, mime, data)
        let d = try await call("POST", "/api/chat/profile/photo", body: form.finish(), contentType: form.contentType)
        return try JSONDecoder().decode(ProfileReply.self, from: d).profile ?? Profile()
    }
    static func removePhoto() async throws -> Profile {
        try JSONDecoder().decode(ProfileReply.self, from: try await call("DELETE", "/api/chat/profile/photo")).profile ?? Profile()
    }

    // ---- files ----
    static func filePath(_ attachmentId: String) -> String { "/api/chat/files/\(attachmentId)" }

    /** Profile photo path; nil when the user has none. `v` changes with each new photo. */
    static func avatarPath(_ username: String, _ v: String?) -> String? {
        v.map { "/api/chat/avatars/\(enc(username))?v=\($0)" }
    }

    /** Bytes of a protected file (attachments, avatars) — they need the Bearer token. */
    static func data(_ path: String) async throws -> Data {
        try await call("GET", path)
    }
}

/** multipart/form-data body. */
struct Multipart {
    private let boundary = "JMSChat-" + UUID().uuidString
    private var body = Data()

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    mutating func field(_ name: String, _ value: String) {
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
    }

    mutating func file(_ name: String, _ fileName: String, _ mime: String, _ data: Data) {
        let safe = fileName.replacingOccurrences(of: "\"", with: "'").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(safe)\"\r\nContent-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n".data(using: .utf8)!)
    }

    func finish() -> Data {
        var out = body
        out.append("--\(boundary)--\r\n".data(using: .utf8)!)
        return out
    }
}

/** MIME type from a file name, as the server only trusts the bytes anyway. */
func mimeType(for fileName: String) -> String {
    let ext = (fileName as NSString).pathExtension
    return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
}
