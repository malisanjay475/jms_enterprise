# JMS Chat — Android app

WhatsApp-style JMS Chat for phones. It opens the MAIN server's `chat_app.html`
(`https://jmsocean.cloud/`) full screen.

**Everyone talks on MAIN.** Any active JMS user signs in with their username and
password, from anywhere — no geofence, no global access needed. That sign-in
(`/api/chat-app/login`) only works for chat (`/api/chat/*`); the rest of JMS on MAIN
stays global-only.

- Chats, groups, photos/PDF/Excel/audio, replies, ticks, typing, @mentions — the same
  chat as the website, live while the app is open.
- Notifications while closed: the app checks for unread messages every 15 minutes
  (the Android minimum for background checks) and shows "N new messages".
- Back closes an open chat or photo, then sends the app to the background.

## iPhone
No build needed: open `https://jmsocean.cloud/chat_app.html` in Safari →
Share → **Add to Home Screen**. It runs full screen like an app (Web Push
notifications need iOS 16.4+). A native `.ipa` would need a Mac with Xcode and an
Apple Developer account.

## Build
GitHub Actions (`android-chat-apk.yml`) builds a debug APK on every push to this
folder, and a signed release APK when the keystore secrets are set.
Local build (JDK 17 + Android SDK): `gradle assembleDebug` in this folder.
