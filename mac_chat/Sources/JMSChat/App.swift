import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    /** Like WhatsApp: closing the window keeps the app (and its notifications) running. */
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

@main
struct JMSChatApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var app = AppState()

    var body: some Scene {
        Window("JMS Chat", id: "main") {
            RootView()
                .environmentObject(app)
                .frame(minWidth: 860, minHeight: 540)
        }
        .defaultSize(width: 1100, height: 720)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Chat") { app.sheet = .newChat }
                    .keyboardShortcut("n")
                    .disabled(app.username == nil)
                Button("New Group") { app.sheet = .newGroup }
                    .keyboardShortcut("n", modifiers: [.command, .shift])
                    .disabled(app.username == nil)
            }
            CommandMenu("Chat") {
                Button("Starred Messages") { app.sheet = .starred }
                    .keyboardShortcut("s", modifiers: [.command, .shift])
                    .disabled(app.username == nil)
                Button("My Profile") { app.sheet = .profile }
                    .keyboardShortcut(",", modifiers: [.command, .shift])
                    .disabled(app.username == nil)
                Divider()
                Button("Refresh") { app.loadConversations() }
                    .keyboardShortcut("r")
                    .disabled(app.username == nil)
                Divider()
                Button("Sign Out") { app.signOut() }
                    .disabled(app.username == nil)
            }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var app: AppState
    @State private var splash = true

    var body: some View {
        ZStack {
            if app.username == nil {
                LoginView()
            } else {
                MainView()
            }
            if splash {
                BrandSplash().transition(.opacity).zIndex(1)
            }
        }
        .task {
            try? await Task.sleep(nanoseconds: 1_300_000_000)
            withAnimation(.easeOut(duration: 0.35)) { splash = false }
        }
    }
}

/** Shown when the app opens: logo, "JMS Chat" and "from Joyo Plastics". */
struct BrandSplash: View {
    @State private var grown = false

    var body: some View {
        ZStack {
            Color.brandGradient.ignoresSafeArea()
            VStack(spacing: 14) {
                Image(nsImage: NSApp.applicationIconImage)
                    .resizable()
                    .frame(width: 150, height: 150)
                    .shadow(color: .black.opacity(0.25), radius: 18, y: 8)
                    .scaleEffect(grown ? 1 : 0.85)
                Text("JMS Chat").font(.system(size: 34, weight: .bold)).foregroundStyle(.white)
                Text("Work chat for the shop floor").foregroundStyle(.white.opacity(0.8))
            }
            VStack(spacing: 2) {
                Spacer()
                Text("from").font(.caption).foregroundStyle(.white.opacity(0.7))
                Text("Joyo Plastics").font(.title3.weight(.semibold)).tracking(1).foregroundStyle(.white)
            }
            .padding(.bottom, 36)
        }
        .onAppear { withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) { grown = true } }
    }
}
