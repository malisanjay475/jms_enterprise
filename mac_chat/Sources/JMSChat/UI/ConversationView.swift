import AppKit
import SwiftUI
import UniformTypeIdentifiers

private enum ConvSheet: Identifiable {
    case forward(Message), info(Message), chatInfo
    var id: String {
        switch self {
        case .forward(let m): return "f" + m.syncId
        case .info(let m): return "i" + m.syncId
        case .chatInfo: return "chat"
        }
    }
}

struct ConversationView: View {
    @EnvironmentObject private var app: AppState
    @StateObject private var model: ConversationModel
    @State private var sheet: ConvSheet?
    @State private var importing = false
    @State private var dropping = false
    @State private var confirmDelete: Message?
    @FocusState private var composerFocused: Bool

    init(convId: String) {
        _model = StateObject(wrappedValue: ConversationModel(convId))
    }

    private var conv: Conversation? { app.conversation(model.convId) }

    private var subtitle: String {
        if model.isGroup {
            if let t = model.typing { return "\(t) is typing…" }
            return model.members.map { Session.isMe($0) ? "You" : $0 }.joined(separator: ", ")
        }
        if model.typing != nil { return "typing…" }
        if model.online { return "online" }
        return lastSeenText(model.lastSeen)
    }

    var body: some View {
        VStack(spacing: 0) {
            if let e = model.error {
                ErrorBanner(text: e) { model.error = nil }
            }
            messageList
            Divider()
            composer
        }
        .background(Color.chatBg)
        .overlay {
            if dropping {
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.accentGreen, style: StrokeStyle(lineWidth: 3, dash: [8]))
                    .background(Color.accentGreen.opacity(0.08))
                    .overlay(Text("Drop to send").font(.title3.bold()).foregroundStyle(Color.accentGreen))
                    .padding(8)
            }
        }
        .onDrop(of: [.fileURL], isTargeted: $dropping) { providers in
            loadDropped(providers)
            return true
        }
        .navigationTitle(model.title.isEmpty ? (conv?.name ?? "Chat") : model.title)
        .navigationSubtitle(subtitle)
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { sheet = .chatInfo } label: {
                    Avatar(name: model.isGroup ? model.title : (model.peer ?? model.title), photoV: model.isGroup ? nil : model.peerPhoto,
                           group: model.isGroup, size: 28, online: !model.isGroup && model.online)
                }
                .buttonStyle(.plain)
                .help(model.isGroup ? "Group info" : "Contact info")
            }
            ToolbarItem {
                Menu {
                    if conv?.isMuted == true {
                        Button("Unmute") { app.mute(model.convId, "off") }
                    } else {
                        Button("Mute 8 hours") { app.mute(model.convId, "8h") }
                        Button("Mute 1 week") { app.mute(model.convId, "1w") }
                        Button("Mute always") { app.mute(model.convId, "always") }
                    }
                } label: {
                    Image(systemName: conv?.isMuted == true ? "bell.slash" : "bell")
                }
                .help("Notifications for this chat")
            }
            ToolbarItem {
                Button { sheet = .chatInfo } label: { Image(systemName: "info.circle") }
                    .help(model.isGroup ? "Group info" : "Contact info")
            }
        }
        .sheet(item: $sheet) { s in
            switch s {
            case .forward(let m): ForwardSheet(message: m)
            case .info(let m): MessageInfoSheet(message: m)
            case .chatInfo: ChatInfoSheet(model: model)
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image, .pdf, .spreadsheet, .audio, .movie],
                      allowsMultipleSelection: true) { result in
            if case .success(let urls) = result, !urls.isEmpty { model.sendFiles(urls) }
        }
        .confirmationDialog("Delete this message for everyone?", isPresented: Binding(
            get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }
        )) {
            Button("Delete", role: .destructive) {
                if let m = confirmDelete { model.delete(m) }
                confirmDelete = nil
            }
        }
        .task {
            // Direct chat: the other person's online / last seen, every 30 s.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                await model.refreshPeer()
            }
        }
        .onAppear { composerFocused = true }
    }

    // MARK: Messages

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 2) {
                    if model.canLoadOlder {
                        Button(model.loadingOlder ? "Loading…" : "Load older messages") { model.loadOlder() }
                            .buttonStyle(.borderless)
                            .padding(8)
                            .onAppear { model.loadOlder() }
                    }
                    if model.loading && model.messages.isEmpty {
                        ProgressView().padding(40)
                    } else if model.messages.isEmpty {
                        Text("No messages yet. Say hello 👋")
                            .foregroundStyle(.secondary)
                            .padding(40)
                    }
                    ForEach(Array(model.messages.enumerated()), id: \.element.syncId) { i, m in
                        let prev = i > 0 ? model.messages[i - 1] : nil
                        if prev == nil || dayKey(prev?.serverTs) != dayKey(m.serverTs) {
                            DayChip(text: dayLabel(m.serverTs)).padding(.vertical, 6)
                        }
                        if m.kind == "system" {
                            SystemLine(text: m.body)
                        } else {
                            let firstOfRun = prev == nil || prev?.sender != m.sender || prev?.kind == "system"
                                || dayKey(prev?.serverTs) != dayKey(m.serverTs)
                            MessageRow(
                                m: m,
                                isGroup: model.isGroup,
                                memberCount: max(model.members.count, 2),
                                showSender: model.isGroup && firstOfRun,
                                onQuoteTap: { id in withAnimation { proxy.scrollTo(id, anchor: .center) } },
                                onTask: { model.setTask(m, $0) },
                                onRetry: { model.retry(m) }
                            )
                            .padding(.top, firstOfRun ? 6 : 0)
                            .id(m.syncId)
                            .contextMenu { messageMenu(m) }
                        }
                    }
                    if let t = model.typing {
                        HStack {
                            Text(model.isGroup ? "\(t) is typing…" : "typing…")
                                .font(.caption.italic())
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(Capsule().fill(Color.bubbleIn))
                            Spacer()
                        }
                        .padding(.top, 4)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .onChange(of: model.scrollToEnd) { _ in
                DispatchQueue.main.async { proxy.scrollTo("bottom", anchor: .bottom) }
            }
        }
    }

    @ViewBuilder
    private func messageMenu(_ m: Message) -> some View {
        let mine = Session.isMe(m.sender)
        if m.failed {
            Button("Retry") { model.retry(m) }
            Button("Remove", role: .destructive) { model.delete(m) }
        } else if !m.pending && !m.deleted {
            Button("Reply") { model.setReply(m); composerFocused = true }
            Menu("React") {
                ForEach(quickReactions, id: \.self) { e in Button(e) { model.react(m, e) } }
            }
            if !m.body.isEmpty {
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(m.body, forType: .string)
                }
            }
            if let a = m.attachment {
                Button("Open") { Task { do { try await Media.open(a) } catch { model.error = error.localizedDescription } } }
                Button("Save As…") { Task { do { try await Media.saveAs(a) } catch { model.error = error.localizedDescription } } }
            }
            Button(m.starred ? "Unstar" : "Star") { model.toggleStar(m) }
            Button("Forward…") { sheet = .forward(m) }
            if mine { Button("Info") { sheet = .info(m) } }
            if model.canEdit(m) { Button("Edit") { model.startEdit(m); composerFocused = true } }
            if mine {
                Divider()
                Button("Delete…", role: .destructive) { confirmDelete = m }
            }
        }
    }

    // MARK: Composer

    private var composer: some View {
        VStack(spacing: 0) {
            if let r = model.replyTo {
                ComposeBanner(title: Session.isMe(r.sender) ? "You" : r.sender, text: previewText(r), color: colorFor(r.sender)) {
                    model.cancelCompose()
                }
            } else if let e = model.editing {
                ComposeBanner(title: "Edit message", text: e.body, color: .accentGreen) { model.cancelCompose() }
            }
            HStack(alignment: .bottom, spacing: 10) {
                Menu {
                    Button("Photo or File…") { importing = true }
                    Button("Paste Image") { pasteImage() }
                        .keyboardShortcut("v", modifiers: [.command, .shift])
                } label: {
                    Image(systemName: "paperclip").font(.title3)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .help("Send photos, PDF, Excel, audio or video (max 10 MB). You can also drag files here.")

                TextField(model.editing != nil ? "Edit message" : "Type a message", text: $model.draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...8)
                    .focused($composerFocused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 18).fill(Color(nsColor: .textBackgroundColor)))
                    .onSubmit { model.send() }
                    .onChange(of: model.draft) { v in if !v.isEmpty && model.editing == nil { model.onTyping() } }
                    .onExitCommand { model.cancelCompose() }

                Button { model.send() } label: {
                    Image(systemName: model.editing != nil ? "checkmark.circle.fill" : "paperplane.circle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(Color.accentGreen)
                }
                .buttonStyle(.plain)
                .disabled(model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .help("Send (Return). Option-Return adds a new line.")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .background(.bar)
    }

    private func pasteImage() {
        if let url = Media.pastedImageFile() {
            model.sendFiles([url])
        } else {
            model.error = "There is no picture on the clipboard."
        }
    }

    private func loadDropped(_ providers: [NSItemProvider]) {
        let group = DispatchGroup()
        let box = DropBox()
        for (i, p) in providers.enumerated() {
            group.enter()
            _ = p.loadObject(ofClass: URL.self) { url, _ in
                if let url { box.put(i, url) }
                group.leave()
            }
        }
        group.notify(queue: .main) {
            let ordered = box.ordered()
            if !ordered.isEmpty { model.sendFiles(ordered) }
        }
    }
}

let quickReactions = ["👍", "❤️", "😂", "😮", "😢", "🙏"]

/** Dropped file URLs, filled from the item providers' background callbacks. */
private final class DropBox: @unchecked Sendable {
    private let lock = NSLock()
    private var urls: [Int: URL] = [:]

    func put(_ i: Int, _ url: URL) { lock.lock(); urls[i] = url; lock.unlock() }

    func ordered() -> [URL] {
        lock.lock(); defer { lock.unlock() }
        return urls.keys.sorted().compactMap { urls[$0] }
    }
}

private struct ComposeBanner: View {
    let title: String
    let text: String
    let color: Color
    var onClose: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Rectangle().fill(color).frame(width: 4)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption.bold()).foregroundStyle(color)
                Text(text).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Button(action: onClose) { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                .buttonStyle(.plain)
        }
        .frame(height: 40)
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }
}

private struct DayChip: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(Capsule().fill(Color.bubbleIn.opacity(0.9)))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
    }
}

private struct SystemLine: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.yellow.opacity(0.18)))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
    }
}
