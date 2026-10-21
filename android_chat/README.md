# JMS Chat — native Android app

WhatsApp-style JMS Chat (Kotlin + Jetpack Compose). Talks to the MAIN server
(`https://jmsocean.cloud/`).

**Everyone talks on MAIN.** Any active JMS user signs in with their username and
password, from anywhere — no geofence, no global access needed. That sign-in
(`/api/chat-app/login`) returns a chat-only token, sent as `Authorization: Bearer`;
it works only on `/api/chat/*`, so the rest of JMS on MAIN stays global-only.

## Features
- Chat list: unread badges, last message, online dot, search, pull to refresh.
- Chats and groups: bubbles, date chips, sent / delivered / read ticks, replies
  (long-press or double-tap), copy, photos (tap for full screen) and PDF / Excel /
  audio files (max 10 MB), retry of failed sends, "typing…", live updates.
- New chat (everyone, online first) and new group.
- Push notifications (Firebase): one per chat, sender + text, **Reply** and
  **Mark as read** from the notification; tapping opens the chat.
- Auto-update from MAIN's `/qc-app/chat/` feed, like the QC and Shifting apps.

## Push set-up (once)
1. Firebase console → create a project → add an **Android app** with package
   `com.jmsocean.chat`.
2. From that app's settings, add 4 GitHub secrets: `FCM_APP_ID` (mobilesdk app id,
   `1:…:android:…`), `FCM_API_KEY`, `FCM_PROJECT_ID`, `FCM_SENDER_ID` (project number).
3. Project settings → Service accounts → **Generate new private key**. Put it on the
   VPS in `.env` as `FCM_SERVICE_ACCOUNT=<base64 -w0 of the JSON>` and redeploy.
Without these the app works fully, it just gets no push while closed.

## Build
GitHub Actions (`android-chat-apk.yml`) builds a debug APK on every push, a signed
release with the keystore secrets, and on `main` publishes it to the feed (phones
self-update). Local build (JDK 17 + Android SDK): `gradle assembleDebug`.
