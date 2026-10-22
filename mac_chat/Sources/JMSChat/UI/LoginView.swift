import AppKit
import SwiftUI

/** Any active JMS user signs in with their JMS username and password (chat-only session). */
struct LoginView: View {
    @EnvironmentObject private var app: AppState
    @State private var username = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?

    private enum Field { case user, pass }

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color.jmsTeal, Color(hex: 0x128C7E)], startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()
            VStack(spacing: 18) {
                Image(nsImage: NSApp.applicationIconImage)
                    .resizable()
                    .frame(width: 96, height: 96)
                Text("JMS Chat").font(.largeTitle.bold())
                Text("Sign in with your JMS username and password")
                    .foregroundStyle(.secondary)
                VStack(spacing: 10) {
                    TextField("Username", text: $username)
                        .textContentType(.username)
                        .focused($focus, equals: .user)
                        .onSubmit { focus = .pass }
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .pass)
                        .onSubmit(signIn)
                }
                .textFieldStyle(.roundedBorder)
                .controlSize(.large)
                .frame(width: 300)
                if let error {
                    Text(error).foregroundStyle(.red).font(.callout).multilineTextAlignment(.center).frame(width: 300)
                }
                Button(action: signIn) {
                    HStack {
                        if busy { ProgressView().controlSize(.small) }
                        Text(busy ? "Signing in…" : "Sign in").frame(maxWidth: .infinity)
                    }
                    .frame(width: 276)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentGreen)
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)
                .disabled(busy || username.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty)
                Text("Version \(AppConfig.version)").font(.caption).foregroundStyle(.tertiary)
            }
            .padding(36)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
            .shadow(radius: 20)
        }
        .onAppear { focus = .user }
    }

    private func signIn() {
        let u = username.trimmingCharacters(in: .whitespaces)
        guard !u.isEmpty, !password.isEmpty, !busy else { return }
        busy = true
        error = nil
        Task {
            let r = await Api.login(u, password)
            busy = false
            if r.ok, let token = r.token {
                password = ""
                app.signedIn(username: r.username ?? u, token: token)
            } else {
                error = r.error ?? "Could not sign in."
            }
        }
    }
}
