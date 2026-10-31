// swift-tools-version:5.9
import PackageDescription

// JMS Chat for macOS — native SwiftUI twin of android_chat/. `scripts/build-app.sh`
// wraps the built binary into "JMS Chat.app" and a .dmg.
let package = Package(
    name: "JMSChat",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "JMSChat", path: "Sources/JMSChat")
    ]
)
