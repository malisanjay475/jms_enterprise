import SwiftUI

/** Sidebar (chat list) + the open chat. */
struct MainView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        NavigationSplitView {
            ChatListView()
                .navigationSplitViewColumnWidth(min: 280, ideal: 330, max: 440)
        } detail: {
            if let id = app.selection {
                ConversationView(convId: id).id(id)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 54)).foregroundStyle(.tertiary)
                    Text("JMS Chat").font(.title2.bold())
                    Text("Pick a chat on the left, or start a new one with ⌘N.").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.chatBg)
            }
        }
        .sheet(item: $app.sheet) { s in
            switch s {
            case .newChat: NewChatSheet()
            case .newGroup: NewGroupSheet()
            case .profile: ProfileSheet()
            case .starred: StarredSheet()
            }
        }
    }
}

private enum ListFilter: String, CaseIterable, Identifiable {
    case all = "All", unread = "Unread", groups = "Groups"
    var id: String { rawValue }
}

struct ChatListView: View {
    @EnvironmentObject private var app: AppState
    @ObservedObject private var live = Live.shared
    @State private var query = ""
    @State private var filter = ListFilter.all

    private var shown: [Conversation] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return app.conversations
            .filter { $0.archived == app.showArchived }
            .filter {
                switch filter {
                case .all: return true
                case .unread: return $0.unread > 0
                case .groups: return $0.isGroup
                }
            }
            .filter { q.isEmpty || $0.name.lowercased().contains(q) || ($0.lastBody ?? "").lowercased().contains(q) }
            .sorted {
                if $0.pinned != $1.pinned { return $0.pinned }
                return ($0.lastMessageAt ?? "") > ($1.lastMessageAt ?? "")
            }
    }

    private var archivedCount: Int { app.conversations.filter { $0.archived }.count }

    var body: some View {
        VStack(spacing: 0) {
            if !live.connected {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text("Connecting…").font(.caption)
                }
                .frame(maxWidth: .infinity)
                .padding(4)
                .background(.yellow.opacity(0.15))
            }
            if let e = app.listError {
                ErrorBanner(text: e) { app.listError = nil }
            }
            Picker("", selection: $filter) {
                ForEach(ListFilter.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 10)
            .padding(.vertical, 6)

            List(selection: $app.selection) {
                if app.showArchived {
                    Button { app.showArchived = false } label: {
                        Label("Back to chats", systemImage: "chevron.left")
                    }
                    .buttonStyle(.borderless)
                } else if archivedCount > 0 {
                    Button { app.showArchived = true } label: {
                        Label("Archived (\(archivedCount))", systemImage: "archivebox")
                    }
                    .buttonStyle(.borderless)
                }
                ForEach(shown) { c in
                    ChatRow(c: c)
                        .tag(c.syncId)
                        .contextMenu { menu(c) }
                }
            }
            .listStyle(.sidebar)
            .overlay {
                if app.loadingList && app.conversations.isEmpty {
                    ProgressView()
                } else if shown.isEmpty {
                    Text(query.isEmpty ? "No chats yet" : "No chats match").foregroundStyle(.secondary)
                }
            }
        }
        .searchable(text: $query, placement: .sidebar, prompt: "Search chats")
        .navigationTitle(app.showArchived ? "Archived" : "Chats")
        .toolbar {
            ToolbarItem {
                Menu {
                    Button("New Chat") { app.sheet = .newChat }
                    Button("New Group") { app.sheet = .newGroup }
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .help("New chat or group")
            }
            ToolbarItem {
                Menu {
                    Button("My Profile") { app.sheet = .profile }
                    Button("Starred Messages") { app.sheet = .starred }
                    Divider()
                    Button("Sign Out (\(app.username ?? ""))") { app.signOut() }
                } label: {
                    Image(systemName: "person.crop.circle")
                }
                .help("Profile and settings")
            }
        }
    }

    @ViewBuilder
    private func menu(_ c: Conversation) -> some View {
        Button(c.pinned ? "Unpin" : "Pin") { app.pin(c) }
        Button(c.archived ? "Unarchive" : "Archive") { app.archive(c) }
        if c.isMuted {
            Button("Unmute") { app.mute(c.syncId, "off") }
        } else {
            Menu("Mute") {
                Button("8 hours") { app.mute(c.syncId, "8h") }
                Button("1 week") { app.mute(c.syncId, "1w") }
                Button("Always") { app.mute(c.syncId, "always") }
            }
        }
    }
}

struct ChatRow: View {
    let c: Conversation

    var body: some View {
        HStack(spacing: 10) {
            Avatar(name: c.isGroup ? c.name : (c.peer ?? c.name), photoV: c.photoV, group: c.isGroup, size: 42, online: !c.isGroup && c.online)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(c.name).font(.body.weight(.semibold)).lineLimit(1)
                    Spacer(minLength: 4)
                    Text(listTime(c.lastMessageAt))
                        .font(.caption)
                        .foregroundStyle(c.unread > 0 ? Color.accentGreen : Color.secondary)
                }
                HStack(spacing: 4) {
                    Text(previewLine).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                    Spacer(minLength: 4)
                    if c.isMuted { Image(systemName: "bell.slash.fill").font(.caption2).foregroundStyle(.secondary) }
                    if c.pinned { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.secondary) }
                    if c.unread > 0 {
                        Text(c.unread > 99 ? "99+" : String(c.unread))
                            .font(.caption2.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(c.isMuted ? Color.gray : Color.accentGreen))
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var previewLine: String {
        guard let body = c.lastBody, !body.isEmpty else { return c.isGroup ? "\(c.members.count) members" : "" }
        if let s = c.lastSender, !s.isEmpty {
            if Session.isMe(s) { return "You: " + body }
            if c.isGroup { return s + ": " + body }
        }
        return body
    }
}
