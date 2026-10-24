package com.jmsocean.chat.data

import kotlinx.serialization.Serializable

// Shapes of the /api/chat/* answers (src/modules/chat/registerChatRoutes.js). Unknown
// fields are ignored, missing ones fall back to the defaults.

@Serializable
data class LoginReply(val ok: Boolean = false, val error: String? = null, val username: String? = null, val token: String? = null)

@Serializable
data class Me(val ok: Boolean = false, val username: String = "", val isSuperadmin: Boolean = false)

@Serializable
data class ChatUser(
    val username: String,
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
    val unread: Int = 0,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val peer: String? = null,
    val photo_v: String? = null,
    val last_seen_at: String? = null
) {
    val isGroup get() = type == "group"
    val name get() = title ?: "Chat"
}

@Serializable
data class ConversationsReply(val conversations: List<Conversation> = emptyList())

@Serializable
data class ConversationReply(val conversation: Conversation? = null)

@Serializable
data class Attachment(val sync_id: String, val kind: String = "", val mime: String = "", val file_name: String = "", val size: Long = 0)

@Serializable
data class ReplyQuote(val sync_id: String = "", val sender: String = "", val kind: String = "text", val text: String = "", val deleted: Boolean = false, val image: String? = null)

@Serializable
data class Message(
    val sync_id: String,
    val conversation_sync_id: String,
    val sender: String = "",
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
data class Member(val username: String, val role: String? = null, val online: Boolean = false, val last_seen_at: String? = null, val photo_v: String? = null)

@Serializable
data class Profile(
    val username: String = "",
    val role: String = "",
    val line: String = "",
    val about: String = "",
    val photo_v: String? = null,
    val last_seen_at: String? = null,
    val online: Boolean = false
)

@Serializable
data class ProfileReply(val profile: Profile? = null)

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
