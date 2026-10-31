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
        return users.filter { $0.username.lowercased().contains(q) || $0.displayName.lowercased().contains(q) || $0.role.lowercased().contains(q) || $0.line.lowercased().contains(q) }
    }
}

private struct UserRow: View {
    let u: ChatUser
    var checked: Bool?

    var body: some View {
        HStack(spacing: 10) {
            Avatar(name: u.displayName.isEmpty ? u.username : u.displayName, photoV: u.photoV, size: 34, online: u.online)
            VStack(alignment: .leading, spacing: 1) {
                Text(u.displayName.isEmpty ? u.username : u.displayName).font(.body.weight(.medium))
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

/** My profile, like WhatsApp: photo, name (a new one waits for admin approval), About. */
struct ProfileSheet: View {
    @EnvironmentObject private var app: AppState
    @State private var profile = Profile()
    @State private var about = ""
    @State private var name = ""
    @State private var designation = ""
    @State private var department = ""
    @State private var loading = true
    @State private var busy = false
    @State private var info: String?
    @State private var error: String?
    @State private var picking = false
    @State private var reviewing = false

    private var cleanName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(spacing: 12) {
            SheetHeader(title: "My profile")
            if loading {
                ProgressView().frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(spacing: 12) {
                        Avatar(name: profile.shownName, photoV: profile.photoV, size: 110)
                        HStack {
                            Button("Change photo…") { picking = true }
                            if profile.photoV != nil { Button("Remove photo", role: .destructive, action: removePhoto) }
                        }
                        .disabled(busy)
                        VStack(spacing: 2) {
                            Text(profile.shownName).font(.title2.bold())
                            Text("@\(profile.username)").font(.callout).foregroundStyle(.secondary)
                        }
                        if let pending = profile.pendingName {
                            banner("hourglass", "\"\(pending)\" is waiting for admin approval. Others still see \"\(profile.shownName)\".",
                                   .orange, action: "Withdraw") { run("Request withdrawn") { try await Api.cancelName() } }
                        } else if let note = profile.nameNote {
                            banner("xmark.octagon", "Name change not approved: \(note)", .red, action: nil) {}
                        }
                        field("Name", hint: "A new name is shown after an admin approves it.") {
                            TextField("Your name", text: $name).textFieldStyle(.roundedBorder).onSubmit(saveName)
                            Button("Save", action: saveName)
                                .disabled(busy || cleanName.count < 2 || cleanName.count > 40 || cleanName == (profile.pendingName ?? profile.shownName))
                        }
                        field("About", hint: nil) {
                            TextField("Available", text: $about).textFieldStyle(.roundedBorder).onSubmit(saveAbout)
                            Button("Save", action: saveAbout).disabled(busy || about == profile.about)
                        }
                        field("Designation | Department", hint: "Shown on your contact info.") {
                            TextField("Designation", text: $designation).textFieldStyle(.roundedBorder)
                            TextField("Department", text: $department).textFieldStyle(.roundedBorder)
                            Button("Save", action: saveWork)
                                .disabled(busy || (designation == profile.designation && department == profile.department))
                        }
                        let sub = [profile.role.replacingOccurrences(of: "_", with: " "), profile.line].filter { !$0.isEmpty }.joined(separator: " · ")
                        if !sub.isEmpty { Text(sub).foregroundStyle(.secondary) }
                        if profile.canApproveNames {
                            Button { reviewing = true } label: {
                                HStack {
                                    Image(systemName: "person.badge.shield.checkmark")
                                    Text("Name requests")
                                    if profile.nameRequests > 0 {
                                        Text("\(profile.nameRequests)").font(.caption.bold()).foregroundStyle(.white)
                                            .padding(.horizontal, 7).padding(.vertical, 1).background(Capsule().fill(Color.accentGreen))
                                    }
                                }
                            }
                        }
                        if let info { Text(info).foregroundStyle(Color.accentGreen).font(.callout).multilineTextAlignment(.center) }
                        if let error { Text(error).foregroundStyle(.red).font(.callout) }
                    }
                    .padding(.horizontal, 30)
                }
                HStack {
                    Text("JMS Chat for Mac \(AppConfig.version)").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Sign out", role: .destructive) { app.sheet = nil; app.signOut() }
                }
                .padding()
            }
        }
        .frame(width: 440, height: 640)
        .fileImporter(isPresented: $picking, allowedContentTypes: [.image]) { result in
            if case .success(let url) = result { uploadPhoto(url) }
        }
        .sheet(isPresented: $reviewing, onDismiss: reload) { NameRequestsSheet() }
        .task { await load() }
    }

    private func load() async {
        if let p = try? await Api.myProfile() { apply(p) }
        loading = false
    }

    private func reload() { Task { await load() } }

    private func apply(_ p: Profile) {
        profile = p
        about = p.about
        name = p.pendingName ?? p.shownName
        designation = p.designation
        department = p.department
    }

    private func saveWork() {
        let des = designation.trimmingCharacters(in: .whitespaces), dep = department.trimmingCharacters(in: .whitespaces)
        run("Saved") { try await Api.saveWork(designation: des, department: dep) }
    }

    @ViewBuilder
    private func field<C: View>(_ label: String, hint: String?, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            HStack { content() }
            if let hint { Text(hint).font(.caption2).foregroundStyle(.secondary) }
        }
    }

    private func banner(_ icon: String, _ text: String, _ color: Color, action: String?, _ onAction: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).foregroundStyle(color)
            Text(text).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
            if let action { Button(action, action: onAction).disabled(busy) }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(color.opacity(0.12)))
    }

    private func saveName() {
        let text = cleanName
        guard text.count >= 2 else { return }
        busy = true
        info = nil
        error = nil
        Task {
            do {
                let r = try await Api.saveName(text)
                if let p = r.profile { apply(p) }
                info = r.message.isEmpty ? "Saved" : r.message
            } catch { self.error = error.localizedDescription }
            busy = false
        }
    }

    private func run(_ ok: String, _ work: @escaping () async throws -> Profile) {
        busy = true
        info = nil
        error = nil
        Task {
            do { apply(try await work()); info = ok } catch { self.error = error.localizedDescription }
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

/** Admins / superadmins: approve or reject the names people asked for. */
struct NameRequestsSheet: View {
    @State private var data = NameRequestsReply()
    @State private var loading = true
    @State private var busy: String?
    @State private var error: String?
    @State private var rejecting: NameRequest?
    @State private var note = ""

    var body: some View {
        VStack(spacing: 8) {
            SheetHeader(title: "Name requests")
            if let error { Text(error).foregroundStyle(.red) }
            if loading {
                ProgressView().frame(maxHeight: .infinity)
            } else {
                List {
                    Section("Waiting (\(data.requests.count))") {
                        if data.requests.isEmpty {
                            Text("🎉 No name changes waiting").foregroundStyle(.secondary)
                        }
                        ForEach(data.requests) { r in
                            HStack(spacing: 10) {
                                Avatar(name: r.currentName, photoV: r.photoV, size: 38)
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 6) {
                                        Text(r.currentName).strikethrough().foregroundStyle(.secondary)
                                        Image(systemName: "arrow.right").font(.caption).foregroundStyle(Color.accentGreen)
                                        Text(r.requestedName).bold().foregroundStyle(Color.accentGreen)
                                    }
                                    .lineLimit(1)
                                    Text((["@" + r.username, r.role.replacingOccurrences(of: "_", with: " "), r.line]).filter { !$0.isEmpty }.joined(separator: " · "))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("Reject", role: .destructive) { note = ""; rejecting = r }.disabled(busy != nil)
                                Button("Approve") { decide(r, approve: true) }
                                    .buttonStyle(.borderedProminent).tint(Color.accentGreen).disabled(busy != nil)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                    if !data.recent.isEmpty {
                        Section("Recent decisions") {
                            ForEach(Array(data.recent.enumerated()), id: \.offset) { _, h in
                                HStack {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text("\(h.oldName ?? h.username) → \(h.newName)").lineLimit(1)
                                        Text("@\(h.username)" + (h.reviewedBy.map { " · by \($0)" } ?? "") + (h.note.map { " · \($0)" } ?? ""))
                                            .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                    }
                                    Spacer()
                                    Text(h.status == "approved" ? "Approved" : "Rejected").font(.caption.bold())
                                        .foregroundStyle(h.status == "approved" ? Color.green : Color.red)
                                }
                            }
                        }
                    }
                }
            }
        }
        .frame(width: 560, height: 560)
        .task { await load() }
        .alert("Reject \"\(rejecting?.requestedName ?? "")\"?", isPresented: Binding(get: { rejecting != nil }, set: { if !$0 { rejecting = nil } })) {
            TextField("Reason (optional)", text: $note)
            Button("Reject", role: .destructive) { if let r = rejecting { decide(r, approve: false) }; rejecting = nil }
            Button("Cancel", role: .cancel) { rejecting = nil }
        }
    }

    private func load() async {
        do { data = try await Api.nameRequests(); error = nil } catch { self.error = error.localizedDescription }
        loading = false
    }

    private func decide(_ r: NameRequest, approve: Bool) {
        busy = r.username
        let reason = note.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do { try await Api.decideName(r.username, approve: approve, note: approve ? "" : reason) } catch { self.error = error.localizedDescription }
            await load()
            busy = nil
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

private struct ViewedImage: Identifiable {
    let path: String
    var id: String { path }
}

/** Contact info (direct chat) or group info with members and admin actions. */
struct ChatInfoSheet: View {
    @ObservedObject var model: ConversationModel
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var profile: Profile?
    @State private var shared: SharedReply?
    @State private var viewing: String?   // avatar or image path in the full-size viewer
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
        .frame(width: 460, height: 680)
        .disabled(busy)
        .sheet(isPresented: $adding) { AddMembersSheet(model: model) }
        .task {
            newTitle = model.title
            if !model.isGroup, let p = model.peer {
                profile = try? await Api.profileOf(p)
                shared = (try? await Api.shared(p)) ?? SharedReply()
            }
        }
    }

    /** Contact info like WhatsApp: photo (click = full size), name, designation | department, About, media, groups. */
    private var contact: some View {
        ScrollView {
            VStack(spacing: 12) {
                let photoV = profile?.photoV ?? model.peerPhoto
                Avatar(name: model.peer ?? model.title, photoV: photoV, size: 130)
                    .onTapGesture { if let peer = model.peer, let path = Api.avatarPath(peer, photoV) { viewing = path } }
                    .help(photoV == nil ? "" : "View photo")
                VStack(spacing: 3) {
                    Text(profile?.shownName ?? model.title).font(.title2.bold())
                    if let p = profile { Text("~ @\(p.username)").foregroundStyle(.secondary) }
                    if let p = profile {
                        let dd = [p.designation, p.department].filter { !$0.isEmpty }.joined(separator: "  |  ")
                        if !dd.isEmpty { Text(dd).font(.headline).foregroundStyle(Color.accentGreen) }
                    }
                    Text(model.online ? "online" : lastSeenText(model.lastSeen)).font(.caption).foregroundStyle(.secondary)
                }
                HStack(spacing: 10) {
                    tile("message.fill", "Message") { dismiss() }
                    tile("bell.slash.fill", "Mute 8 h") { act { try await Api.mute(model.convId, "8h") } }
                    tile("bell.fill", "Unmute") { act { try await Api.mute(model.convId, "off") } }
                }
                .padding(.horizontal)
                if let p = profile {
                    card("About") { Text(p.about.isEmpty ? "Hey there! I am using JMS Chat." : p.about).frame(maxWidth: .infinity, alignment: .leading) }
                }
                card("Media, links and docs") {
                    let media = shared?.media ?? []
                    if shared == nil {
                        ProgressView().controlSize(.small)
                    } else if media.isEmpty {
                        Text("None").foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(media.prefix(30), id: \.syncId) { a in
                                    Group {
                                        if a.kind == "image" {
                                            AuthImage(path: Api.filePath(a.syncId))
                                        } else {
                                            VStack(spacing: 2) {
                                                Image(systemName: a.kind == "pdf" ? "doc.richtext" : a.kind == "xlsx" ? "tablecells" : "doc").font(.title2)
                                                Text(a.fileName).font(.caption2).lineLimit(2).multilineTextAlignment(.center)
                                            }
                                            .padding(4)
                                        }
                                    }
                                    .frame(width: 76, height: 76)
                                    .background(Color(nsColor: .windowBackgroundColor))
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                    .onTapGesture {
                                        if a.kind == "image" { viewing = Api.filePath(a.syncId) } else { Task { try? await Media.open(a) } }
                                    }
                                    .help(a.fileName)
                                }
                            }
                        }
                    }
                }
                if let groups = shared?.groups, !groups.isEmpty {
                    card("\(groups.count) \(groups.count == 1 ? "group" : "groups") in common") {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(groups) { g in
                                HStack {
                                    Avatar(name: g.title ?? "Group", group: true, size: 32)
                                    VStack(alignment: .leading) {
                                        Text(g.title ?? "Group")
                                        Text("\(g.members) members").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }
                                .contentShape(Rectangle())
                                .onTapGesture { app.selection = g.syncId; dismiss() }
                            }
                        }
                    }
                }
                if let p = profile {
                    let roleLine = [p.role.replacingOccurrences(of: "_", with: " "), p.line].filter { !$0.isEmpty }.joined(separator: " · ")
                    if p.mobile != nil || !roleLine.isEmpty || p.adminView {
                        card("Details") {
                            VStack(alignment: .leading, spacing: 6) {
                                if let m = p.mobile { Label(m, systemImage: "iphone") }
                                if !roleLine.isEmpty { Label(roleLine, systemImage: "building.2") }
                                // Admins / superadmins see who this really is and every earlier name.
                                if p.adminView {
                                    Label("Login ID: \(p.username)", systemImage: "person.text.rectangle")
                                    if let pending = p.pendingName { Label("Requested name (waiting): \(pending)", systemImage: "hourglass").foregroundStyle(.orange) }
                                    let old = p.nameHistory.filter { $0.status == "approved" }.compactMap { $0.oldName }
                                        .reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
                                    if !old.isEmpty { Label("Earlier names: \(old.joined(separator: ", "))", systemImage: "clock.arrow.circlepath").foregroundStyle(.secondary) }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                card("Privacy") {
                    Text("Messages stay on the JMS server and may be reviewed by administrators.")
                        .font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.bottom, 16)
        }
        .sheet(item: Binding(get: { viewing.map { ViewedImage(path: $0) } }, set: { viewing = $0?.path })) { v in
            VStack(spacing: 0) {
                HStack {
                    Text(profile?.shownName ?? model.title).font(.headline)
                    Spacer()
                    Button("Close") { viewing = nil }.keyboardShortcut(.cancelAction)
                }
                .padding(12)
                AuthImage(path: v.path, contentMode: .fit)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black)
            }
            .frame(width: 640, height: 640)
        }
    }

    private func tile(_ icon: String, _ label: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.title3).foregroundStyle(Color.accentGreen)
                Text(label).font(.caption)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.secondary.opacity(0.12)))
        }
        .buttonStyle(.plain)
    }

    private func card<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            content()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.secondary.opacity(0.1)))
        .padding(.horizontal)
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
                    Text(Session.isMe(mem.username) ? "You" : (mem.displayName.isEmpty ? mem.username : mem.displayName))
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
