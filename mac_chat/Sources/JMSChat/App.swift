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

    var body: some View {
        if app.username == nil {
            LoginView()
        } else {
            MainView()
        }
    }
}
