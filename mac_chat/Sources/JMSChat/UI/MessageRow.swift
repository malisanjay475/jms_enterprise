import AppKit
import SwiftUI

/** One chat bubble: sender (groups), quote, attachment / link card, text, time and ticks, reactions. */
struct MessageRow: View {
    let m: Message
    let isGroup: Bool
    let memberCount: Int
    let showSender: Bool
    var onQuoteTap: (String) -> Void
    var onTask: (String) -> Void
    var onRetry: () -> Void

    @State private var openError: String?

    private var mine: Bool { Session.isMe(m.sender) }

    /** Voice notes / videos carry an emoji placeholder as their text: don't repeat it. */
    private var hideBody: Bool {
        guard let a = m.attachment else { return false }
        return (a.kind == "audio" && m.body.hasPrefix("🎤")) || (a.kind == "video" && m.body.hasPrefix("🎥"))
    }

    var body: some View {
        HStack(alignment: .bottom) {
            if mine { Spacer(minLength: 80) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
                bubble
                if let rx = m.reactions, !rx.isEmpty { ReactionsRow(reactions: rx) }
            }
            if !mine { Spacer(minLength: 80) }
        }
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 4) {
            if m.forwarded && !m.deleted {
                Label("Forwarded", systemImage: "arrowshape.turn.up.right")
                    .font(.caption.italic())
                    .foregroundStyle(.secondary)
            }
            if showSender && !mine {
                Text(m.sender).font(.caption.bold()).foregroundStyle(colorFor(m.sender))
            }
            if let q = m.replyTo, !m.deleted {
                QuoteView(q: q).onTapGesture { onQuoteTap(q.syncId) }
            }
            if m.deleted {
                Label(mine ? "You deleted this message" : "This message was deleted", systemImage: "nosign")
                    .font(.body.italic())
                    .foregroundStyle(.secondary)
            } else {
                if m.kind == "link", !m.purged, let link = m.link {
                    LinkCard(link: link, task: m.task, onTask: onTask)
                }
                if let a = m.attachment, !m.purged {
                    AttachmentView(a: a, onError: { openError = $0 })
                }
                if m.purged {
                    Text("File removed (older than the keep period)").font(.callout.italic()).foregroundStyle(.secondary)
                }
                if !m.body.isEmpty && !hideBody && !(m.kind == "link" && m.link != nil && m.body == m.link?.title) {
                    Text(m.body)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let e = openError {
                Text(e).font(.caption).foregroundStyle(.red)
            }
            footer
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 10).fill(mine ? Color.bubbleOut : Color.bubbleIn))
        .shadow(color: .black.opacity(0.06), radius: 0.5, y: 0.5)
        .frame(maxWidth: 520, alignment: mine ? .trailing : .leading)
    }

    private var footer: some View {
        HStack(spacing: 4) {
            Spacer(minLength: 0)
            if m.starred { Image(systemName: "star.fill").font(.system(size: 9)).foregroundStyle(.secondary) }
            if m.editedAt != nil && !m.deleted { Text("edited").font(.caption2).foregroundStyle(.secondary) }
            Text(timeOf(m.serverTs)).font(.caption2).foregroundStyle(.secondary)
            if mine && !m.deleted { Ticks(m: m, memberCount: memberCount, onRetry: onRetry) }
        }
    }
}

struct Ticks: View {
    let m: Message
    let memberCount: Int
    var onRetry: () -> Void

    var body: some View {
        let others = max(memberCount - 1, 1)
        let read = (m.readBy?.count ?? 0) >= others
        let delivered = (m.deliveredTo?.count ?? 0) >= others
        Group {
            if m.failed {
                Button(action: onRetry) {
                    Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
                }
                .buttonStyle(.plain)
                .help("Not sent — click to retry")
            } else if m.pending {
                Image(systemName: "clock").foregroundStyle(.secondary).help("Sending")
            } else if read {
                DoubleTick().foregroundStyle(Color.tick).help("Read")
            } else if delivered {
                DoubleTick().foregroundStyle(.secondary).help("Delivered")
            } else {
                Image(systemName: "checkmark").foregroundStyle(.secondary).help("Sent")
            }
        }
        .font(.system(size: 10, weight: .bold))
    }
}

private struct DoubleTick: View {
    var body: some View {
        HStack(spacing: -5) {
            Image(systemName: "checkmark")
            Image(systemName: "checkmark")
        }
    }
}

struct QuoteView: View {
    let q: ReplyQuote

    var body: some View {
        HStack(spacing: 6) {
            Rectangle().fill(colorFor(q.sender)).frame(width: 3)
            VStack(alignment: .leading, spacing: 1) {
                Text(Session.isMe(q.sender) ? "You" : q.sender).font(.caption.bold()).foregroundStyle(colorFor(q.sender))
                Text(q.deleted ? "This message was deleted" : quoteText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .padding(.trailing, 6)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.06)))
        .contentShape(Rectangle())
    }

    private var quoteText: String {
        if !q.text.isEmpty { return q.text }
        switch q.kind {
        case "image": return "📷 Photo"
        case "video": return "🎥 Video"
        case "audio": return "🎤 Voice message"
        default: return "📎 File"
        }
    }
}

struct AttachmentView: View {
    let a: Attachment
    var onError: (String) -> Void
    @State private var busy = false

    var body: some View {
        if a.kind == "image" {
            AuthImage(path: Api.filePath(a.syncId))
                .frame(width: 260, height: 200)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .contentShape(Rectangle())
                .onTapGesture { open() }
                .help("Click to open")
        } else {
            Button(action: open) {
                HStack(spacing: 10) {
                    Image(systemName: icon).font(.title2).foregroundStyle(tint).frame(width: 30)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(a.fileName.isEmpty ? kindName : a.fileName).lineLimit(2).multilineTextAlignment(.leading)
                        Text("\(kindName) · \(Media.sizeText(a.size))").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    if busy { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.down.circle").foregroundStyle(.secondary) }
                }
                .padding(8)
                .frame(minWidth: 220, maxWidth: 320)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.06)))
            }
            .buttonStyle(.plain)
            .help("Click to open")
        }
    }

    private var icon: String {
        switch a.kind {
        case "pdf": return "doc.richtext.fill"
        case "xlsx": return "tablecells.fill"
        case "audio": return "waveform.circle.fill"
        case "video": return "play.rectangle.fill"
        default: return "doc.fill"
        }
    }

    private var tint: Color {
        switch a.kind {
        case "pdf": return .red
        case "xlsx": return .green
        case "audio": return .orange
        case "video": return .purple
        default: return .blue
        }
    }

    private var kindName: String {
        switch a.kind {
        case "pdf": return "PDF"
        case "xlsx": return "Excel"
        case "audio": return "Voice message"
        case "video": return "Video"
        default: return "File"
        }
    }

    private func open() {
        guard !busy else { return }
        busy = true
        Task {
            do { try await Media.open(a) } catch { onError(error.localizedDescription) }
            busy = false
        }
    }
}

/** A shared JMS page (job, plan, QC issue…) with its work status. */
struct LinkCard: View {
    let link: LinkInfo
    let task: TaskStatus?
    var onTask: (String) -> Void

    private var fullURL: URL? {
        guard let u = link.url, !u.isEmpty else { return nil }
        return URL(string: u.hasPrefix("/") ? Api.base + u : u)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: "link").foregroundStyle(Color.accentGreen)
                Text(link.title ?? "JMS link").font(.callout.bold()).lineLimit(2)
            }
            if let f = link.factoryName, !f.isEmpty {
                Text(f + (link.priority.map { " · priority " + $0 } ?? "")).font(.caption).foregroundStyle(.secondary)
            }
            if let e = link.excerpt, !e.isEmpty {
                Text(e).font(.caption).foregroundStyle(.secondary).lineLimit(3)
            }
            HStack {
                if let url = fullURL {
                    Button("Open in JMS") { NSWorkspace.shared.open(url) }.controlSize(.small)
                }
                Spacer()
                Menu(statusText) {
                    Button("Open") { onTask("open") }
                    Button("In progress") { onTask("in_progress") }
                    Button("Done") { onTask("done") }
                }
                .controlSize(.small)
                .fixedSize()
            }
        }
        .padding(8)
        .frame(minWidth: 240, maxWidth: 360, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.06)))
    }

    private var statusText: String {
        let s: String
        switch task?.status ?? "open" {
        case "in_progress": s = "🟡 In progress"
        case "done": s = "✅ Done"
        default: s = "⚪ Open"
        }
        if let by = task?.by, !by.isEmpty, task?.status != "open" { return s + " · " + by }
        return s
    }
}

struct ReactionsRow: View {
    let reactions: [Reaction]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(reactions, id: \.emoji) { r in
                HStack(spacing: 2) {
                    Text(r.emoji)
                    if r.users.count > 1 { Text(String(r.users.count)).font(.caption2) }
                }
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Capsule().fill(r.users.contains { Session.isMe($0) } ? Color.accentGreen.opacity(0.25) : Color.bubbleIn))
                .overlay(Capsule().stroke(Color.primary.opacity(0.08)))
                .help(r.users.joined(separator: ", "))
            }
        }
        .padding(.horizontal, 6)
    }
}
