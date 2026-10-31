package com.jmsocean.chat.data

import kotlinx.serialization.Serializable

// Shapes of the /api/chat/* answers (src/modules/chat/registerChatRoutes.js). Unknown
// fields are ignored, missing ones fall back to the defaults.

@Serializable
data class LoginReply(
    val ok: Boolean = false,
    val error: String? = null,
    val username: String? = null,
    val token: String? = null,
    /** Approved through sign-up and no password yet: ask for one (chatSignup.js). */
    val set_password: Boolean = false,
    /** set-password: this phone has no request token, ask for the request's mobile number. */
    val need_mobile: Boolean = false
)

/** POST /api/chat-app/signup: the token stays on this phone to follow the request. */
@Serializable
data class SignupReply(val ok: Boolean = false, val error: String? = null, val token: String? = null)

/** GET /api/chat-app/signup/status: pending / approved / rejected / unknown. */
@Serializable
data class SignupStatus(
    val ok: Boolean = false,
    val status: String = "unknown",
    val name: String? = null,
    val username: String? = null,
    val password_set: Boolean = false
)

@Serializable
data class Me(val ok: Boolean = false, val username: String = "", val isSuperadmin: Boolean = false)

@Serializable
data class ChatUser(
    val username: String,
    val display_name: String = "",
    val role: String = "",
    val line: String = "",
    val online: Boolean = false,
    val about: String = "",
    val photo_v: String? = null,
    val last_seen_at: String? = null
)

@Serializable
data class UsersReply(val users: List<ChatUser> = emptyList())

@Serializable
data class Conversation(
    val sync_id: String,
    val type: String = "direct",
    val title: String? = null,
    val members: List<String> = emptyList(),
    val my_role: String? = null,
    val muted_until: String? = null,
    val online: Boolean = false,
    val last_message_at: String? = null,
    val last_body: String? = null,
    val last_sender: String? = null,
    val last_sender_name: String? = null,
    val unread: Int = 0,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val peer: String? = null,
    val photo_v: String? = null,
    val last_seen_at: String? = null,
    val disappear_seconds: Int = 0,
    val protected: Boolean = false
) {
    val isGroup get() = type == "group"
    val name get() = title ?: "Chat"
}

@Serializable
data class Device(
    val id: String, val name: String? = null, val platform: String? = null, val approved: Boolean = true,
    val signed_in: Boolean = false, val last_seen_at: String? = null, val current: Boolean = false
)

@Serializable
data class DevicesReply(val devices: List<Device> = emptyList())

@Serializable
data class SignOutReply(val signed_out: Int = 0)

@Serializable
data class ChatFolder(val id: String, val name: String = "", val conversations: List<String> = emptyList())

@Serializable
data class FoldersReply(val folders: List<ChatFolder> = emptyList())

@Serializable
data class ConversationsReply(val conversations: List<Conversation> = emptyList())

@Serializable
data class ConversationReply(val conversation: Conversation? = null)

@Serializable
data class Attachment(val sync_id: String, val kind: String = "", val mime: String = "", val file_name: String = "", val size: Long = 0)

@Serializable
data class ReplyQuote(val sync_id: String = "", val sender: String = "", val kind: String = "text", val text: String = "", val deleted: Boolean = false, val image: String? = null, val sender_name: String = "")

@Serializable
data class Message(
    val sync_id: String,
    val conversation_sync_id: String,
    val sender: String = "",
    /** Approved display name of the sender (login name until one is approved). */
    val sender_name: String = "",
    val body: String = "",
    val kind: String = "text",
    val server_ts: String? = null,
    val edited_at: String? = null,
    val deleted: Boolean = false,
    val purged: Boolean = false,
    val reply_to_sync_id: String? = null,
    val reply_to: ReplyQuote? = null,
    val attachment: Attachment? = null,
    val delivered_to: List<String>? = null,
    val read_by: List<String>? = null,
    val forwarded: Boolean = false,
    val urgent: Boolean = false,
    val announcement: Boolean = false,
    val scheduled: Boolean = false,
    val poll: Poll? = null,
    val bot: Boolean = false,
    /** 📻 walkie-talkie clip: plays by itself */
    val ptt: Boolean = false,
    val alert: AlertInfo? = null,
    val reactions: List<Reaction>? = null,
    val starred: Boolean = false,
    /** Shared JMS page (kind = link): title, url, excerpt, factory_name, priority. */
    val link: kotlinx.serialization.json.JsonObject? = null,
    /** Work status of a shared link: open / in_progress / done. */
    val task: TaskStatus? = null,
    // local only: sending / failed
    val pending: Boolean = false,
    val failed: Boolean = false
)

@Serializable
data class TextReply(val text: String = "")

@Serializable
data class AlertInfo(val kind: String = "", val acked_by: String? = null, val acked_at: String? = null, val escalated: Int = 0)

@Serializable
data class AckReply(val acked_by: String? = null, val acked_at: String? = null)

@Serializable
data class ApprovalItem(
    val id: Int,
    val plan_id: String? = null,
    val job_card_no: String? = null,
    val machine: String? = null,
    val order_no: String? = null,
    val item_name: String? = null,
    val product_name: String? = null,
    val approval_stage_label: String? = null,
    val can_approve: Boolean? = null
)

@Serializable
data class ApprovalsReply(val allowed: Boolean = false, val items: List<ApprovalItem> = emptyList())

@Serializable
data class TicketRef(val sync_id: String = "", val ticket_no: String = "")

@Serializable
data class TicketReply(val ticket: TicketRef? = null)

@Serializable
data class PollOption(val text: String, val votes: Int = 0, val voters: List<String> = emptyList())

@Serializable
data class Poll(val question: String = "", val multi: Boolean = false, val total: Int = 0, val mine: List<Int> = emptyList(), val options: List<PollOption> = emptyList())

@Serializable
data class Todo(
    val id: String,
    val conversation_sync_id: String,
    val title: String = "",
    val assignee: String = "",
    val created_by: String = "",
    val due_at: String? = null,
    val done_at: String? = null,
    val conv_title: String? = null
)

@Serializable
data class TodosReply(val todos: List<Todo> = emptyList())

@Serializable
data class PinsReply(val pins: List<Message> = emptyList())

@Serializable
data class ChatSettings(val quiet_from: String = "", val quiet_to: String = "")

@Serializable
data class Reaction(val emoji: String, val users: List<String> = emptyList())

@Serializable
data class TaskStatus(val status: String = "open", val by: String? = null)

@Serializable
data class Receipt(val username: String, val at: String? = null)

@Serializable
data class MessageInfo(
    val sent_at: String? = null,
    val read: List<Receipt> = emptyList(),
    val delivered: List<Receipt> = emptyList(),
    val pending: List<Receipt> = emptyList()
)

@Serializable
data class FoundMessage(val message: Message, val conversation_title: String = "")

@Serializable
data class FoundReply(val results: List<FoundMessage> = emptyList())

@Serializable
data class TaskReply(val task: TaskStatus? = null)

@Serializable
data class ReactReply(val reactions: List<Reaction> = emptyList())

@Serializable
data class ForwardReply(val messages: List<Message> = emptyList())

@Serializable
data class MessagesReply(
    val messages: List<Message> = emptyList(),
    val has_more: Boolean = false,
    val type: String = "direct",
    val title: String? = null,
    val members: List<String> = emptyList(),
    val my_role: String? = null,
    val member_roles: List<Member> = emptyList()
)

@Serializable
data class Member(val username: String, val display_name: String = "", val role: String? = null, val online: Boolean = false, val last_seen_at: String? = null, val photo_v: String? = null)

@Serializable
data class Profile(
    val username: String = "",
    val role: String = "",
    val line: String = "",
    val about: String = "",
    val photo_v: String? = null,
    val last_seen_at: String? = null,
    val online: Boolean = false,
    val designation: String = "",
    val department: String = "",
    /** From the chat sign-up form (only for me and admins). */
    val mobile: String? = null,
    /** Name others see (approved); the login name until one is approved. */
    val display_name: String = "",
    /** Waiting for an admin (only for me and admins). */
    val pending_name: String? = null,
    val pending_at: String? = null,
    /** Why my last request was rejected. */
    val name_note: String? = null,
    /** Earlier names (admins only). */
    val name_history: List<NameChange> = emptyList(),
    /** The viewer is an admin / superadmin (sees login and earlier names). */
    val admin_view: Boolean = false,
    val can_approve_names: Boolean = false,
    val name_requests: Int = 0
) {
    val shownName: String get() = display_name.ifBlank { username }
}

@Serializable
data class SharedFile(val sync_id: String, val kind: String = "", val mime: String = "", val file_name: String = "", val size: Long = 0)

@Serializable
data class CommonGroup(val sync_id: String, val title: String? = null, val members: Int = 0)

@Serializable
data class SharedLink(val sync_id: String, val title: String? = null, val url: String = "")

/** Contact info extras: media and shared JMS pages in our direct chat, groups in common. */
@Serializable
data class SharedReply(
    val media: List<SharedFile> = emptyList(),
    val links: List<SharedLink> = emptyList(),
    val groups: List<CommonGroup> = emptyList()
)

@Serializable
data class NameChange(
    val username: String = "",
    val old_name: String? = null,
    val new_name: String = "",
    val status: String = "",
    val reviewed_by: String? = null,
    val note: String? = null,
    val at: String? = null
)

@Serializable
data class NameRequest(
    val username: String,
    val role: String = "",
    val line: String = "",
    val current_name: String = "",
    val requested_name: String = "",
    val requested_at: String? = null,
    val photo_v: String? = null,
    /** Other people already shown with this name (warn before approving a look-alike). */
    val same_name: List<String> = emptyList()
)

@Serializable
data class NameRequestsReply(val requests: List<NameRequest> = emptyList(), val recent: List<NameChange> = emptyList())

@Serializable
data class ProfileReply(val profile: Profile? = null, val message: String = "")

@Serializable
data class MessageReply(val message: Message? = null)

@Serializable
data class UnreadReply(val unread: Int = 0)

@Serializable
data class PushDevice(val app_version: String? = null, val created_at: String? = null, val last_ok_at: String? = null, val failures: Int = 0)

@Serializable
data class PushStatus(val server: Boolean = false, val devices: List<PushDevice> = emptyList())

@Serializable
data class IceServerConfig(val urls: List<String> = emptyList(), val username: String? = null, val credential: String? = null)

@Serializable
data class CallInfo(
    val id: String,
    val caller: String = "",
    val callee: String = "",
    val status: String = "",
    val peer: String = "",
    val incoming: Boolean = false,
    val created_at: String? = null,
    val answered_at: String? = null,
    val ended_at: String? = null
)

@Serializable
data class CallLogReply(val calls: List<CallInfo> = emptyList())

@Serializable
data class CallReply(val call: CallInfo, val ice: List<IceServerConfig> = emptyList(), val ring_seconds: Int = 45)

@Serializable
data class CallSignal(val seq: Long, val kind: String, val data: String)

// ---- phase E: group calls ----
@Serializable
data class RoomInfo(val id: String, val conversation_sync_id: String = "", val title: String = "", val started_at: String? = null)

@Serializable
data class RoomPerson(val username: String, val joined_at: String = "")

@Serializable
data class GroupCallReply(
    val started: Boolean = false,
    val room: RoomInfo,
    val me: RoomPerson,
    val participants: List<RoomPerson> = emptyList(),
    val ice: List<IceServerConfig> = emptyList()
)

@Serializable
data class RoomSignal(val seq: Long, val from: String, val kind: String, val data: String)

@Serializable
data class RoomPoll(val status: String = "", val participants: List<RoomPerson> = emptyList(), val signals: List<RoomSignal> = emptyList())

@Serializable
data class ActiveRoom(val id: String, val conversation_sync_id: String, val started_by: String = "", val people: Int = 0, val joined: Boolean = false)

@Serializable
data class ActiveRoomsReply(val rooms: List<ActiveRoom> = emptyList())

@Serializable
data class CallSignalsReply(val status: String = "", val signals: List<CallSignal> = emptyList())

@Serializable
data class AppVersion(val versionCode: Int = 0, val versionName: String = "", val apk: String = "", val notes: String = "")

/** One event from /api/chat/stream. */
@Serializable
data class LiveEvent(
    val type: String = "",
    val message: Message? = null,
    val conversation_sync_id: String? = null,
    val username: String? = null,
    val kind: String? = null,
    val message_sync_ids: List<String>? = null,
    val message_sync_id: String? = null,
    val reactions: List<Reaction>? = null,
    val status: String? = null,
    val by: String? = null,
    val adminCopy: Boolean = false
)
