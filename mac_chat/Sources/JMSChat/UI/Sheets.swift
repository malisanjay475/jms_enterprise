import AppKit
import SwiftUI
import UniformTypeIdentifiers

/** Title bar + Close button shared by the sheets. */
private struct SheetHeader: View {
    let title: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        HStack {
            Text(title).font(.title3.bold())
            Spacer()
            Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
        }
        .padding()
    }
}

/** Everyone you can chat with, online first. */
@MainActor
private final class UsersModel: ObservableObject {
    @Published var users: [ChatUser] = []
    @Published var loading = true
    @Published var error: String?

    func load() async {
        do {
            users = try await Api.users().sorted {
                if $0.online != $1.online { return $0.online }
                return $0.username.lowercased() < $1.username.lowercased()
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    func filtered(_ q: String) -> [ChatUser] {
        let q = q.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return users }
        return users.filter { $0.username.lowercased().contains(q) || $0.role.lowercased().contains(q) || $0.line.lowercased().contains(q) }
    }
}

private struct UserRow: View {
    let u: ChatUser
    var checked: Bool?

    var body: some View {
        HStack(spacing: 10) {
            Avatar(name: u.username, photoV: u.photoV, size: 34, online: u.online)
            VStack(alignment: .leading, spacing: 1) {
                Text(u.username).font(.body.weight(.medium))
                let sub = [u.about, u.role, u.line].filter { !$0.isEmpty }.prefix(2).joined(separator: " · ")
                if !sub.isEmpty { Text(sub).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer()
            if let checked {
                Image(systemName: checked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(checked ? Color.accentGreen : Color.secondary)
                    .font(.title3)
            }
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
    }
}

struct NewChatSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = UsersModel()
    @State private var query = ""
    @State private var busy = false

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: "New chat")
            TextField("Search people", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal)
            if let e = model.error { Text(e).foregroundStyle(.red).padding(.top, 6) }
            List(model.filtered(query)) { u in
                UserRow(u: u).onTapGesture { open(u.username) }
            }
            .overlay { if model.loading { ProgressView() } }
            Button("New group…") { app.sheet = .newGroup }.buttonStyle(.link).padding(10)
        }
        .frame(width: 420, height: 540)
        .disabled(busy)
        .task { await model.load() }
    }

    private func open(_ user: String) {
        busy = true
        Task {
            do { try await app.openDirect(user); dismiss() } catch { model.error = error.localizedDescription }
            busy = false
        }
    }
}

struct NewGroupSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = UsersModel()
    @State private var title = ""
    @State private var query = ""
    @State private var picked = Set<String>()
    @State private var busy = false

    var body: some View {
        VStack(spacing: 8) {
            SheetHeader(title: "New group")
            TextField("Group name", text: $title).textFieldStyle(.roundedBorder).padding(.horizontal)
            TextField("Search people", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal)
            if let e = model.error { Text(e).foregroundStyle(.red) }
            List(model.filtered(query)) { u in
                UserRow(u: u, checked: picked.contains(u.username)).onTapGesture {
                    if picked.contains(u.username) { picked.remove(u.username) } else { picked.insert(u.username) }
                }
            }
            .overlay { if model.loading { ProgressView() } }
            HStack {
                Text("\(picked.count) selected").foregroundStyle(.secondary)
                Spacer()
                Button("Create group", action: create)
                    .buttonStyle(.borderedProminent)
                    .tint(Color.accentGreen)
                    .disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty || picked.isEmpty)
            }
            .padding()
        }
        .frame(width: 440, height: 600)
        .task { await model.load() }
    }

    private func create() {
        busy = true
        Task {
            do {
                try await app.createGroup(title.trimmingCharacters(in: .whitespaces), picked.sorted())
                dismiss()
            } catch {
                model.error = error.localizedDescription
            }
            busy = false
        }
    }
}

struct ProfileSheet: View {
    @EnvironmentObject private var app: AppState
    @State private var profile = Profile()
    @State private var about = ""
    @State private var loading = true
    @State private var busy = false
    @State private var info: String?
    @State private var error: String?
    @State private var picking = false

    var body: some View {
        VStack(spacing: 14) {
            SheetHeader(title: "My profile")
            if loading {
                ProgressView().frame(maxHeight: .infinity)
            } else {
                Avatar(name: app.username ?? "", photoV: profile.photoV, size: 110)
                HStack {
                    Button("Change photo…") { picking = true }
                    if profile.photoV != nil { Button("Remove photo", role: .destructive, action: removePhoto) }
                }
                .disabled(busy)
                Text(app.username ?? "").font(.title2.bold())
                let sub = [profile.role, profile.line].filter { !$0.isEmpty }.joined(separator: " · ")
                if !sub.isEmpty { Text(sub).foregroundStyle(.secondary) }
                VStack(alignment: .leading, spacing: 4) {
                    Text("About").font(.caption).foregroundStyle(.secondary)
                    HStack {
                        TextField("Available", text: $about).textFieldStyle(.roundedBorder).onSubmit(saveAbout)
                        Button("Save", action: saveAbout).disabled(busy || about == profile.about)
                    }
                }
                .padding(.horizontal, 30)
                if let info { Text(info).foregroundStyle(Color.accentGreen).font(.callout) }
                if let error { Text(error).foregroundStyle(.red).font(.callout) }
                Spacer()
                HStack {
                    Text("JMS Chat for Mac \(AppConfig.version)").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Sign out", role: .destructive) { app.sheet = nil; app.signOut() }
                }
                .padding()
            }
        }
        .frame(width: 420, height: 540)
        .fileImporter(isPresented: $picking, allowedContentTypes: [.image]) { result in
            if case .success(let url) = result { uploadPhoto(url) }
        }
        .task {
            if let p = try? await Api.myProfile() { profile = p; about = p.about }
            loading = false
        }
    }

    private func run(_ ok: String, _ work: @escaping () async throws -> Profile) {
        busy = true
        info = nil
        error = nil
        Task {
            do { profile = try await work(); about = profile.about; info = ok } catch { self.error = error.localizedDescription }
            busy = false
        }
    }

    private func saveAbout() {
        let text = about.trimmingCharacters(in: .whitespacesAndNewlines)
        run("Saved") { try await Api.saveAbout(text) }
    }

    private func removePhoto() {
        run("Photo removed") { try await Api.removePhoto() }
    }

    private func uploadPhoto(_ url: URL) {
        run("Photo updated") {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let jpeg = Media.jpeg(from: try Data(contentsOf: url), maxSide: 640) else {
                throw ApiError(message: "Could not read that picture.")
            }
            return try await Api.uploadPhoto(jpeg, fileName: "photo.jpg", mime: "image/jpeg")
        }
    }
}

struct StarredSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var items: [FoundMessage] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: "Starred messages")
            if let error { Text(error).foregroundStyle(.red) }
            List(items) { f in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(Session.isMe(f.message.sender) ? "You" : f.message.sender).font(.callout.bold())
                        Text("· " + f.conversationTitle).font(.callout).foregroundStyle(.secondary)
                        Spacer()
                        Text(listTime(f.message.serverTs)).font(.caption).foregroundStyle(.secondary)
                    }
                    Text(previewText(f.message)).lineLimit(3)
                }
                .padding(.vertical, 3)
                .contentShape(Rectangle())
                .onTapGesture {
                    app.selection = f.message.conversationSyncId
                    dismiss()
                }
            }
            .overlay {
                if loading { ProgressView() } else if items.isEmpty { Text("No starred messages").foregroundStyle(.secondary) }
            }
        }
        .frame(width: 480, height: 540)
        .task {
            do { items = try await Api.starred() } catch { self.error = error.localizedDescription }
            loading = false
        }
    }
}

struct ForwardSheet: View {
    let message: Message
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var picked = Set<String>()
    @State private var query = ""
    @State private var busy = false
    @State private var error: String?

    private var chats: [Conversation] {
        let q = query.lowercased()
        return app.conversations.filter { q.isEmpty || $0.name.lowercased().contains(q) }
    }

    var body: some View {
        VStack(spacing: 8) {
            SheetHeader(title: "Forward to…")
            Text(previewText(message)).foregroundStyle(.secondary).lineLimit(2).padding(.horizontal)
            TextField("Search chats", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal)
            if let error { Text(error).foregroundStyle(.red) }
            List(chats) { c in
                HStack(spacing: 10) {
                    Avatar(name: c.isGroup ? c.name : (c.peer ?? c.name), photoV: c.photoV, group: c.isGroup, size: 32)
                    Text(c.name)
                    Spacer()
                    Image(systemName: picked.contains(c.syncId) ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(picked.contains(c.syncId) ? Color.accentGreen : Color.secondary)
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    if picked.contains(c.syncId) { picked.remove(c.syncId) } else { picked.insert(c.syncId) }
                }
            }
            HStack {
                Text("\(picked.count) selected").foregroundStyle(.secondary)
                Spacer()
                Button("Forward") {
                    busy = true
                    Task {
                        do { _ = try await Api.forward(message.syncId, to: Array(picked)); app.reloadSoon(); dismiss() }
                        catch { self.error = error.localizedDescription }
                        busy = false
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentGreen)
                .disabled(busy || picked.isEmpty)
            }
            .padding()
        }
        .frame(width: 420, height: 540)
    }
}

struct MessageInfoSheet: View {
    let message: Message
    @State private var info: MessageInfo?
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: "Message info")
            Text(previewText(message)).lineLimit(3).padding(.horizontal).frame(maxWidth: .infinity, alignment: .leading)
            if let error { Text(error).foregroundStyle(.red).padding() }
            if let info {
                List {
                    section("Read by", info.read, "checkmark.circle.fill", .tick)
                    section("Delivered to", info.delivered, "checkmark.circle", .secondary)
                    section("Not yet delivered", info.pending, "clock", .secondary)
                }
            } else if error == nil {
                ProgressView().frame(maxHeight: .infinity)
            }
        }
        .frame(width: 400, height: 460)
        .task {
            do { info = try await Api.messageInfo(message.syncId) } catch { self.error = error.localizedDescription }
        }
    }

    @ViewBuilder
    private func section(_ title: String, _ list: [Receipt], _ icon: String, _ color: Color) -> some View {
        if !list.isEmpty {
            Section(title) {
                ForEach(list) { r in
                    HStack {
                        Image(systemName: icon).foregroundStyle(color)
                        Text(r.username)
                        Spacer()
                        Text(listTime(r.at)).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

/** Contact info (direct chat) or group info with members and admin actions. */
struct ChatInfoSheet: View {
    @ObservedObject var model: ConversationModel
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var profile: Profile?
    @State private var newTitle = ""
    @State private var adding = false
    @State private var busy = false
    @State private var error: String?
    @State private var confirmLeave = false

    private var amAdmin: Bool {
        model.memberRoles.first { Session.isMe($0.username) }?.role == "admin" || app.conversation(model.convId)?.myRole == "admin"
    }

    var body: some View {
        VStack(spacing: 10) {
            SheetHeader(title: model.isGroup ? "Group info" : "Contact info")
            if let error { Text(error).foregroundStyle(.red) }
            if model.isGroup { group } else { contact }
        }
        .frame(width: 440, height: 580)
        .disabled(busy)
        .sheet(isPresented: $adding) { AddMembersSheet(model: model) }
        .task {
            newTitle = model.title
            if !model.isGroup, let p = model.peer { profile = try? await Api.profileOf(p) }
        }
    }

    private var contact: some View {
        VStack(spacing: 10) {
            Avatar(name: model.peer ?? model.title, photoV: profile?.photoV ?? model.peerPhoto, size: 120)
            Text(model.peer ?? model.title).font(.title2.bold())
            Text(model.online ? "online" : lastSeenText(model.lastSeen)).foregroundStyle(.secondary)
            if let p = profile {
                let sub = [p.role, p.line].filter { !$0.isEmpty }.joined(separator: " · ")
                if !sub.isEmpty { Text(sub).foregroundStyle(.secondary) }
                if !p.about.isEmpty {
                    GroupBox("About") { Text(p.about).frame(maxWidth: .infinity, alignment: .leading) }.padding(.horizontal)
                }
            }
            Spacer()
        }
    }

    private var group: some View {
        VStack(spacing: 8) {
            Avatar(name: model.title, group: true, size: 80)
            if amAdmin {
                HStack {
                    TextField("Group name", text: $newTitle).textFieldStyle(.roundedBorder)
                    Button("Rename") { act { try await Api.renameGroup(model.convId, newTitle.trimmingCharacters(in: .whitespaces)) } }
                        .disabled(newTitle.trimmingCharacters(in: .whitespaces).isEmpty || newTitle == model.title)
                }
                .padding(.horizontal)
            } else {
                Text(model.title).font(.title2.bold())
            }
            HStack {
                Text("\(model.members.count) members").font(.headline)
                Spacer()
                if amAdmin { Button("Add members…") { adding = true } }
            }
            .padding(.horizontal)
            List(memberList, id: \.username) { mem in
                HStack(spacing: 10) {
                    Avatar(name: mem.username, photoV: mem.photoV, size: 30, online: mem.online)
                    Text(Session.isMe(mem.username) ? "You" : mem.username)
                    if mem.role == "admin" {
                        Text("admin").font(.caption).padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Capsule().stroke(Color.accentGreen)).foregroundStyle(Color.accentGreen)
                    }
                    Spacer()
                    if amAdmin && !Session.isMe(mem.username) {
                        Button("Remove", role: .destructive) { act { try await Api.removeMember(model.convId, mem.username) } }
                            .buttonStyle(.borderless)
                    }
                }
            }
            Button("Leave group", role: .destructive) { confirmLeave = true }
                .padding(.bottom)
                .confirmationDialog("Leave \(model.title)?", isPresented: $confirmLeave) {
                    Button("Leave", role: .destructive) {
                        act {
                            try await Api.leaveGroup(model.convId)
                            app.selection = nil
                            dismiss()
                        }
                    }
                }
        }
    }

    private var memberList: [Member] {
        model.memberRoles.isEmpty ? model.members.map { Member(username: $0) } : model.memberRoles
    }

    private func act(_ work: @escaping () async throws -> Void) {
        busy = true
        error = nil
        Task {
            do { try await work(); app.reloadSoon() } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

private struct AddMembersSheet: View {
    @ObservedObject var model: ConversationModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var users = UsersModel()
    @State private var query = ""
    @State private var picked = Set<String>()
    @State private var busy = false

    var body: some View {
        VStack(spacing: 8) {
            SheetHeader(title: "Add members")
            TextField("Search people", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal)
            if let e = users.error { Text(e).foregroundStyle(.red) }
            List(users.filtered(query).filter { u in !model.members.contains { $0.caseInsensitiveCompare(u.username) == .orderedSame } }) { u in
                UserRow(u: u, checked: picked.contains(u.username)).onTapGesture {
                    if picked.contains(u.username) { picked.remove(u.username) } else { picked.insert(u.username) }
                }
            }
            HStack {
                Spacer()
                Button("Add \(picked.count)") {
                    busy = true
                    Task {
                        do { try await Api.addMembers(model.convId, picked.sorted()); dismiss() }
                        catch { users.error = error.localizedDescription }
                        busy = false
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentGreen)
                .disabled(busy || picked.isEmpty)
            }
            .padding()
        }
        .frame(width: 420, height: 520)
        .task { await users.load() }
    }
}
