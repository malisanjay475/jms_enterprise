# JMS Chat — native macOS app

The Mac twin of the Android app (`android_chat/`): SwiftUI, macOS 13 Ventura or newer,
Apple silicon and Intel. Talks to the MAIN server (`https://jmsocean.cloud/`) with the same
chat-only sign-in (`POST /api/chat-app/login` → Bearer token, works only on `/api/chat/*`).
No server changes were needed.

## Features
- Sign in with any active JMS username and password; the session token is kept in the
  macOS Keychain (this Mac only). Sign out from the profile menu or **Chat → Sign Out**.
- Chat list (sidebar): unread badges, last message, online dot, profile photos, search,
  All / Unread / Groups filter, pin, archive (Archived section), mute 8 h / 1 week / always.
- Chats and groups: bubbles, date chips, sent / delivered / read ticks, replies (with
  jump to the quoted message), reactions, copy, star, forward, message info, edit (15 min)
  and delete for everyone, "typing…", online / last seen, live updates
  (`/api/chat/stream`), retry of failed sends, load older messages.
- Files: 📎 or **drag and drop** photos, PDF, Excel, audio and MP4 (max 10 MB, up to 10 at
  a time); ⌘⇧V pastes a screenshot. HEIC / TIFF / big pictures are sent as JPEG. Click a
  file to open it (Preview, QuickTime, Excel…), right-click → Save As….
- Link cards for shared JMS pages with Open / In progress / Done.
- New chat (⌘N), new group (⌘⇧N), group info (rename, add / remove members, leave),
  contact info, my profile (photo, About), starred messages (⌘⇧S).
- macOS notifications while the app runs (also with the window closed — the app keeps
  running like WhatsApp): one per message with **Reply** and **Mark as read**, a click
  opens the chat, muted chats stay quiet. Unread count on the Dock icon.

Not in the Mac app yet: voice calls (Android only for now) and push while the app is
quit (the Mac has no FCM; it needs APNs and a paid Apple developer account).

## Install (users)
1. GitHub → Actions → **Build JMS Chat macOS app** → latest run → download
   `jms-chat-mac` and unzip it to get `JMS-Chat-<version>.dmg`.
2. Open the .dmg and drag **JMS Chat** onto **Applications**.
3. First start: the app is not notarised by Apple, so macOS blocks a plain double-click.
   Right-click **JMS Chat** in Applications → **Open** → **Open**. On macOS 15 Sequoia:
   double-click once, then System Settings → Privacy & Security → **Open Anyway**.
   (Or in Terminal: `xattr -dr com.apple.quarantine "/Applications/JMS Chat.app"`.)
4. Allow notifications when asked.

## Build (developers)
On a Mac with Xcode 15+ (or the Command Line Tools):

```bash
cd mac_chat
swift run                      # quick run from the terminal (no notifications: not a bundle)
./scripts/build-app.sh         # dist/JMS Chat.app + dist/JMS-Chat-<version>.dmg
open Package.swift             # or work in Xcode
```

`JMS_CHAT_BASE_URL=http://localhost:3000 swift run` points it at a local backend.
The version is in `VERSION`; CI sets the build number. `SIGN_IDENTITY="Developer ID
Application: …"` signs with a real certificate (then it can be notarised with
`xcrun notarytool`) instead of the default ad-hoc signature.

## Layout
- `Sources/JMSChat/Data` — `Api` (all `/api/chat/*` calls), `Models`, `Session`
  (Keychain), `Live` (server-sent events with back-off), `AppState`, `Notifier`, `Media`.
- `Sources/JMSChat/UI` — Login, chat list, conversation, message bubbles, sheets.
- `packaging/` — Info.plist and the 1024 px icon; `scripts/build-app.sh` packages them.
