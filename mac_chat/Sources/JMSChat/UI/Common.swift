import AppKit
import SwiftUI

// Colours of the Android app (android_chat/.../ui/Common.kt).
extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: 1)
    }

    static let jmsTeal = Color(hex: 0x075E54)
    static let accentGreen = Color(hex: 0x00A884)
    static let onlineGreen = Color(hex: 0x25D366)
    static let tick = Color(hex: 0x34B7F1)
    /** The JMS Chat logo gradient (BACKEND/PUBLIC/assets/brand/jms-chat-logo.svg). */
    static let brandGradient = LinearGradient(colors: [Color(hex: 0x00C29A), Color(hex: 0x008069), Color(hex: 0x054D44)],
                                              startPoint: .topLeading, endPoint: .bottomTrailing)

    static func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { a in
            let hex = a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(Color(hex: hex))
        })
    }

    static let bubbleOut = dyn(0xDCF8C6, 0x005C4B)
    static let bubbleIn = dyn(0xFFFFFF, 0x1F2C34)
    static let chatBg = dyn(0xECE5DD, 0x0B141A)
}

private let avatarHexes: [UInt32] = [0x00A884, 0x53BDEB, 0xFF8A65, 0xBA68C8, 0x4DB6AC, 0xF06292, 0x7986CB, 0xFFB74D]
private let avatarColors: [Color] = avatarHexes.map { Color(hex: $0) }

/** Stable colour per name (sender names in groups, avatar backgrounds). */
func colorFor(_ name: String) -> Color {
    var h: UInt32 = 0
    for u in name.lowercased().unicodeScalars { h = h &* 31 &+ u.value }
    return avatarColors[Int(h % UInt32(avatarColors.count))]
}

func initials(_ name: String) -> String {
    let parts = name.split(whereSeparator: { $0 == " " || $0 == "_" || $0 == "." }).prefix(2)
    let s = parts.compactMap { $0.first.map(String.init) }.joined()
    return (s.isEmpty ? String(name.prefix(1)) : s).uppercased()
}

/** An image that needs the session token (attachments, avatars). */
struct AuthImage: View {
    let path: String
    var contentMode: ContentMode = .fill
    @State private var image: NSImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else if failed {
                Image(systemName: "photo").foregroundStyle(.secondary)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .task(id: path) {
            image = await ImageCache.shared.image(path)
            failed = image == nil
        }
    }
}

struct Avatar: View {
    let name: String
    var photoV: String?
    var group = false
    var size: CGFloat = 40
    var online = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if !group, let path = Api.avatarPath(name, photoV) {
                    AuthImage(path: path)
                } else {
                    ZStack {
                        colorFor(name)
                        if group {
                            Image(systemName: "person.3.fill").font(.system(size: size * 0.38)).foregroundStyle(.white)
                        } else {
                            Text(initials(name)).font(.system(size: size * 0.4, weight: .semibold)).foregroundStyle(.white)
                        }
                    }
                }
            }
            .frame(width: size, height: size)
            .clipShape(Circle())
            if online {
                Circle().fill(Color.onlineGreen)
                    .frame(width: size * 0.28, height: size * 0.28)
                    .overlay(Circle().stroke(Color(nsColor: .windowBackgroundColor), lineWidth: 2))
            }
        }
    }
}

// MARK: Times

private let hm: DateFormatter = { let f = DateFormatter(); f.dateFormat = "h:mm a"; return f }()
private let weekday: DateFormatter = { let f = DateFormatter(); f.dateFormat = "EEEE"; return f }()
private let shortDate: DateFormatter = { let f = DateFormatter(); f.dateFormat = "dd/MM/yy"; return f }()
private let longDate: DateFormatter = { let f = DateFormatter(); f.dateFormat = "d MMMM yyyy"; return f }()

func timeOf(_ iso: String?) -> String {
    guard let d = iso?.parsedDate else { return "" }
    return hm.string(from: d).lowercased()
}

/** Chat list: time today, "Yesterday", weekday this week, else the date. */
func listTime(_ iso: String?) -> String {
    guard let d = iso?.parsedDate else { return "" }
    let cal = Calendar.current
    let days = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: Date())).day ?? 0
    switch days {
    case 0: return hm.string(from: d).lowercased()
    case 1: return "Yesterday"
    case 2..<7: return weekday.string(from: d)
    default: return shortDate.string(from: d)
    }
}

/** Date chip between days in a chat. */
func dayLabel(_ iso: String?) -> String {
    guard let d = iso?.parsedDate else { return "" }
    let cal = Calendar.current
    if cal.isDateInToday(d) { return "Today" }
    if cal.isDateInYesterday(d) { return "Yesterday" }
    return longDate.string(from: d)
}

func dayKey(_ iso: String?) -> String {
    guard let d = iso?.parsedDate else { return "" }
    let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
    return "\(c.year ?? 0)-\(c.month ?? 0)-\(c.day ?? 0)"
}

func lastSeenText(_ iso: String?) -> String {
    guard let d = iso?.parsedDate else { return "" }
    let cal = Calendar.current
    if cal.isDateInToday(d) { return "last seen today at " + hm.string(from: d).lowercased() }
    if cal.isDateInYesterday(d) { return "last seen yesterday at " + hm.string(from: d).lowercased() }
    return "last seen " + shortDate.string(from: d)
}

/** A small banner for errors at the top of a pane. */
struct ErrorBanner: View {
    let text: String
    var onClose: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text(text).font(.callout).lineLimit(2)
            Spacer()
            Button(action: onClose) { Image(systemName: "xmark") }.buttonStyle(.borderless)
        }
        .padding(8)
        .background(.orange.opacity(0.12))
    }
}
