# Changelog

All notable changes to JMS Enterprise are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are grouped by change type. Under `[Unreleased]`, add your change in the right group as
part of your PR. On release, the `[Unreleased]` items move under the new version heading.

> Note: historical machine-readable release data also lives in `RELEASE_MANIFEST.json` and the
> per-release changelog used by the deploy tooling. This file is the human-readable summary.

## [Unreleased]

### Added
- NPD Tracker (npd.html, v1.154.0): stage editing by role (Admin / Superadmin all columns; Tool Room, Moulding, Planning, QC and Packing roles only their own columns), only Superadmin deletes, child moulds under each product with the same columns, completion date shown on Complete stages, and a mandatory remark on every stage change.
- Page smoke test (v1.153.4): new BACKEND/scripts/smoke-pages.js opens every PUBLIC/*.html page in a real browser (playwright-core, or the copy bundled with the global @playwright/cli) and reports JS errors, console errors, failed / 4xx-5xx same-origin requests and login redirects; read-only, exit code 1 on any FAIL. Options --base, --state (logged-in storage state), --only, --shots.

### Fixed
- Purchase > Vendors (purchase_vendors.html, v1.153.4): the page's whole script failed to parse ("Invalid or unexpected token") because the vendor-login alert had real line breaks inside a quoted string, so nothing on the page worked; it now uses \n escapes.
- Raw Material Jobwise (raw_material_jobwise.html, v1.153.4): every call went to /api/api/rm/... (404 "API route not found") because api.request already adds /api; the five calls now pass /rm/... .
- Barcode Printer (barcode_printer.html, v1.153.4): Bootstrap 5.3.0 CSS and JsBarcode 3.11.5 were referenced under /assets/vendor/jsdelivr/.../dist/ but never committed (the root .gitignore drops every dist/ folder; 404 served as HTML), so the page had no styling and could not draw barcodes; both files are now vendored outside dist/ (bootstrap@5.3.0/bootstrap.min.css, jsbarcode@3.11.5/JsBarcode.all.min.js).
- DPR Daily Report (dpr_daily_report.html, v1.153.4): the chartjs-plugin-datalabels vendor file had no .js extension and was served as application/octet-stream, which the browser refused to run; moved to chartjs-plugin-datalabels@2.0.0/chartjs-plugin-datalabels.min.js.
- Job Summary (job_summary.html, v1.153.4): the order search box and mould list called /api/planning/element-view and /details, which never existed (404). New routes in registerLegacyRoutes.js: GET /api/planning/element-view (order numbers from mould_planning_summary + plan_board, factory-scoped, max 5000) and GET /api/planning/element-view/details?or_jr_no= (that order's moulds). Read-only.

### Added
- JMS Chat phase D (v1.151.0): new src/modules/chat/chatSecure.js - chat_conv_settings (disappear_seconds, protected; PUT /api/chat/conversations/:id/security; one-worker purge every minute of messages sent since it was turned on), protected chats block download / forward server-side and set FLAG_SECURE in the app, chat_devices (chat-app login registers a device; JWT did claim; auth.js setChatTokenCheck refuses signed-out / blocked devices; GET /api/chat/devices, POST /:id/signout, /signout-others incl. old tokens via chat_signout; admin GET/POST /api/chat/admin/devices, superadmin PUT /api/chat/admin/device-approval = CHAT_DEVICE_APPROVAL), FCM tokens tied to the device and dropped on sign-out, chat_folders (GET/POST/PUT/DELETE /api/chat/folders). Web widget v=12 + app 3.3.0.
- JMS Chat phase C (v1.150.0): line/department groups, @team mentions, shift handover, check-in, translation, voice-to-text (app 3.2.0)
- JMS Chat phase B (v1.149.0): new src/modules/chat/chatBot.js - POST /api/chat/command (/dpr, /job, /order, /help; answer posted by 'JMS Bot', meta.bot), POST /api/chat/maintenance (same maintenance_tickets row, number and manager notifications via app.locals.jmsMaintenance set in the legacy module; status changes posted back to the chat by a one-worker job), GET /api/chat/approvals and POST /api/chat/approvals/:id/action (the existing job-card approval route called internally with a session for that user; only global-access or admin users), POST /api/chat/messages/:id/ack (chat_alert_acks), escalation of unacknowledged JMS Alerts holds / stops (meta.alert) to factory managers after 30 min and superadmins after 60 min, shift summary to each factory group at 08:05 / 20:05 IST. Messages carry bot and alert (acked_by, escalated). Web and app 3.1.0: '/' commands from the message box, ✋ I'm on it, Raise maintenance ticket, ✅ Approvals list.
- JMS Chat phase A (v1.148.0): new src/modules/chat/chatWork.js - polls (meta.poll, chat_poll_votes, POST /api/chat/messages/:id/vote, tallies in decorate), pinned messages (chat_pins, max 3, group admins / superadmin; GET /api/chat/conversations/:id/pins, POST|DELETE /api/chat/messages/:id/pin), tasks (chat_todos; POST /api/chat/todos, GET, POST /:id/done; system lines in the chat; push to the assignee; reminders every 4 h once due), scheduled messages (chat_scheduled; POST/GET/DELETE /api/chat/scheduled; sent by a one-worker job every 30 s), quiet hours (chat_user_settings, GET/PUT /api/chat/settings, IST). POST /api/chat/messages takes urgent / announcement (group admins) / poll into chat_messages.meta; messages carry urgent, announcement, scheduled, poll. Push: urgent passes mute and quiet hours and is titled '⚠ URGENT'; quiet hours drop pushes except @mentions. Web: ➕ menu (Poll, Announcement, Urgent, Schedule), poll cards, 📢 / ⚠ bubbles, pinned bar, Make task / Pin in the message menu, 📋 My tasks, 🌙 quiet hours. App 3.0.0: the same, urgent notification channel with alarm sound.
- JMS Chat look (v1.147.0): app 2.9.0 - dotted chat wallpaper drawn in code (chatWallpaper), softer raised bubbles with a hairline edge, slide/fade screen transitions, animated typing dots in the chat header, calmer typography; web full-window chat - teal gradient header bars, dotted chat background, softer bubble shadows, rounded search and message box, hover states, thin scrollbars (rules scoped to .jc-app, so the floating widget on other pages is unchanged); widget cache key v=11. No server changes.
- Planning > Create Plan > Colour Wise Mould Plan (v1.145.0): lists every mould of the family instead of hiding used ones; each used mould is badged Running on <machine> / Already Planned / In Queue / Dropped (active plans of the selected order matched by mould code). No API changes.

### Fixed
- Planning contrast (v1.153.4): planning.html `.btn.primary` now sets white text (it inherited the dark page colour) on #2563eb to #1d4ed8; Confirm button #3b82f6 to #2563eb; Complete Production Plan white on #15803d; text #94a3b8 to #5b6b80, #16a34a to #15803d, #0284c7 to #0369a1 (icons unchanged). All pairs pass WCAG AA 4.5:1.
- JMS Chat (v1.149.1): chatBot.runCommand parses '/cmd arg' without a backtracking regex and on a 200-character cap (CodeQL js/polynomial-redos, high, introduced in v1.149.0).
- JMS Chat on iPhone (chat_app.html): the screen shook / flashed when tapping the message box - the keyboard handler moved the chat and scrolled the page back on every scroll event, fighting Safari's own pan; it now follows the visible area once per animation frame and never scrolls the page. WhatsApp-style phone look in the app: green top bars with white icons, larger chat rows with avatars and dividers, rounded search, beige chat background, larger bubbles, rounded message box with round attach / send buttons; long-press a message opens its menu as a bottom sheet (own messages) or replies (others); no grey tap flash. No API changes.

### Fixed
- JMS Chat on iPhone (chat_app.html, Safari / Add to Home Screen): the login page's bare button / input / label styles leaked into the chat, so every chat button became full-width with big padding (broken headers, conversation pushed sideways); they are now scoped to the login form. The chat widget is loaded with the server version (/api/version) instead of a fixed ?v=1.133.0, which the service worker kept serving from cache, so home-screen apps ran an old chat; sw.js CACHE_VERSION bumped to drop it. The chat now follows the visible area (visualViewport) so the message box stays above the iPhone keyboard, keeps clear of the home indicator (safe-area insets), and fields are 16 px so Safari no longer zooms in. Status bar no longer translucent over the page; Safari shows an "Add to Home Screen" hint and the home-screen app a "Turn on notifications" button; a tapped push notification on iPhone opens the chat app instead of full JMS; the manifest lists real 192 / 512 / maskable icons. No API changes.

### Added
- JMS Chat app 2.8.0 (v1.143.0): app lock - AppLock (salted PBKDF2 hash of a 4-digit passcode, per phone), locks on cold start and when the app was in the background longer than the chosen time (default 1 minute; Immediately / 1 / 5 / 30 minutes), full-screen passcode pad over everything with fingerprint unlock (androidx.biometric, MainActivity is now a FragmentActivity), Profile > App lock (on / off, change passcode, auto-lock time, fingerprint), 'Forgot passcode? Sign out' and sign-out clears the lock. No server changes.
- JMS Chat (v1.142.0): superadmins are treated as admin of every group in groupFor (rename, add, remove, make / remove admin) even when not a member, and may delete any message (DELETE /api/chat/messages/:id; editing stays the author's own). New POST /api/chat/groups/:id/members/:username/admin { admin } for group admins and superadmins (system line in the group). Web: group info opens for superadmins on any group (also from All chats), ★ / ☆ make / remove admin, 'Delete for everyone (superadmin)' on others' messages, ⬇ Download under photos, videos, voice notes and PDFs (?download=1). App 2.7.0: Session.isSuperadmin from /api/chat/me; superadmin group tools and delete; Make / Remove group admin; ⬇ Download under photos, videos and voice notes.
- JMS Chat web parity (v1.141.0): JMS menu entry 'JMS Chat' (MENU_CONFIG, opens chat_app.html full window; with a JMS session no chat login is needed and ⌂ goes back to JMS). chat-widget.js: profile photos in avatars, last seen in the header, All / Unread / Groups chips, Archived section and right-click Pin / Archive, ⭐ starred view, message menu on every message with a reaction bar, Forward (up to 5 chats), Star, Info (read / delivered with times), reaction chips, 'Forwarded' label, and browser voice calls (WebRTC with the same /api/chat/calls set-up, ringing overlay, mute, hang up) shown for direct chats on MAIN. chatCalls.js tells an open web page about incoming / ended calls through the live stream (pg_notify t='call'). Wider list pane in full window; widget cache key v=10.
- JMS Chat for Mac: new mac_chat/ - a native SwiftUI macOS app (macOS 13+, universal Apple silicon + Intel), the twin of android_chat/. Same chat-only sign-in and Bearer token (kept in the Keychain), chat list with unread / pin / archive / mute / filters, conversations with ticks, replies, reactions, star, forward, info, edit / delete, typing, last seen, live updates over /api/chat/stream, photos and files by 📎 / drag and drop / paste (max 10 MB), link cards with work status, new chat / group, group admin, profile photo and About, starred messages, macOS notifications with Reply / Mark as read and a Dock unread badge. Built into an ad-hoc signed .dmg by .github/workflows/mac-chat-app.yml (macOS runner). No server changes; voice calls stay Android-only for now.

### Fixed
- Deploy (v1.136.3): the 21-Oct production deploy stopped with "no running db container found" because the FCM_SERVICE_ACCOUNT secret was the raw (multi-line) Firebase JSON, which broke .env so docker compose could not read it. scripts/vps-safe-deploy.sh now normalises the push keys before writing .env (normalize_push_keys): raw JSON is base64-encoded (chatFcm.js reads JSON or base64), wrapped base64 is joined, a lone "{" left in a broken .env is dropped with a warning, and VAPID keys lose line breaks. Rollback: revert the script; set the secret as one-line base64.

### Fixed
- JMS Chat push (v1.136.2): scripts/vps-safe-deploy.sh rewrote .env from a fixed list on every deploy, so FCM_SERVICE_ACCOUNT (and the VAPID Web Push keys) added on the VPS were dropped by the next deploy and push never reached phones. The deploy now writes FCM_SERVICE_ACCOUNT / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT, taken from GitHub secrets of the same names (publish-v1-app.yml, deploy-vps-docker-isolated.yml) or, when a secret is empty, kept from the current .env. FCM pushes carry the recipient's total unread (app badge); collapse_key dropped so no message is folded away. New GET /api/chat/fcm/status and POST /api/chat/fcm/test; startup logs whether app push is ON. Android app 2.2.0: Profile > Notifications checklist (app built with push, server push, phone registered, permission, battery exemption) with fix buttons and Send test notification; badge icon on message notifications; notifications cleared when nothing is unread.

### Added
- JMS Chat app 2.6.0 (v1.140.0): smaller APK (arm64-v8a + armeabi-v7a only; the x86 emulator builds of WebRTC/Media3 are dropped), core-splashscreen start-up screen, redesigned login (logo, icons, remembered last username, clearer errors, version), bottom tabs Chats / Calls with an unread-chats badge, call log from GET /api/chat/calls (in / out / missed, duration, tap to call back), All / Unread / Groups filter chips, swipe right to reply, jump-to-latest button with a new-message count, links and phone numbers in messages open the browser / dialler. No server changes.
- JMS Chat voice calls (v1.139.0): new src/modules/chat/chatCalls.js (MAIN only) - chat_calls (ringing / accepted / ended / declined / missed, 45 s ring timeout, busy check) and chat_call_signals (WebRTC offer / answer / ICE, read by polling GET /api/chat/calls/:id/signals?after=, so it works across PM2 workers and for a callee whose app was closed); POST /api/chat/calls, /:id/accept|decline|end|signal, GET /:id, GET /api/chat/calls (log); FCM data pushes 'call' (wakes the callee) and 'call_end'; ICE = Google STUN plus TURN with coturn REST credentials when TURN_URLS and TURN_SECRET are set; each call leaves a system line in the direct chat (duration, missed, declined). Android app 2.5.0: io.getstream stream-webrtc-android audio calls (CallEngine), full-screen CallActivity over the lock screen with answer / decline / mute / speaker / timer, insistent ringing notification with Answer / Decline, microphone foreground service with Hang up, 📞 in direct-chat headers.
- JMS Chat media (v1.138.0): attachmentType accepts MP4 with a video track as kind 'video' (video/mp4, same 10 MB limit, since factory LOCAL sync is capped at 10 MB); '🎥 Video' labels in push, bell, previews and the web widget, which plays videos inline and lets you pick video/mp4. Android app 2.4.0: 📎 opens Gallery / Camera / Document; Gallery picks up to 10 photos and videos (PickMultipleVisualMedia), photos shrunk as before, videos compressed to 480p H.264 ~1 Mbit/s with Media3 Transformer before upload (refused if still over 10 MB), video tile with play button and a full-screen ExoPlayer that streams with the chat session header.
- JMS Chat phase 7 (v1.137.0): new src/modules/chat/chatExtras.js - chat_reactions (one emoji per person per message, POST /api/chat/messages/:id/react, live 'reaction' events via pg_notify), chat_stars (POST /api/chat/messages/:id/star, GET /api/chat/starred), chat_user_prefs (POST /api/chat/conversations/:id/pin|archive; max 3 pinned; conversations carry pinned/archived and pinned sort first), GET /api/chat/messages/:id/info (read / delivered / pending with times), POST /api/chat/forward (text, links and files copied into up to 5 chats, meta.forwarded). Messages carry reactions, starred and forwarded; /api/chat/search takes ?conversation=. New src/modules/chat/chatAuto.js (MAIN, one worker by advisory lock, CHAT_AUTO_GROUPS=0 to switch off): one '<Factory> – All staff' group per active factory kept equal to the factory's active users every 10 min (superadmins as admins), and every minute new QC holds, QC releases, machine stops and restarts are posted there by 'JMS Alerts' (first run only records the position). Extras tables are not synced to LOCAL; auto groups and alert messages are (normal chat tables). Android app 2.3.0: reaction bar and chips, forward sheet, star, message info, link cards with Start work / Mark done, search in chat, starred screen, pin / archive with an Archived section, group admin (rename, add, remove, leave).
- JMS Chat profiles, presence and media (v1.136.0): new src/modules/chat/chatProfiles.js - chat_profiles (About line, profile photo sniffed as an image, max 5 MB, stored under the private chat upload folder avatars/) with GET/PUT /api/chat/profile, GET /api/chat/profile/:username, POST/DELETE /api/chat/profile/photo and GET /api/chat/avatars/:username; chat_presence.last_seen_at touched when a live stream opens, on its 20 s heartbeat and when it closes, so online = a stream on this worker OR a touch in the last 50 s (works across PM2 workers); /api/chat/users, /api/chat/conversations (peer, photo_v, last_seen_at) and message member_roles carry photo and last seen. FCM sends to all devices in parallel. attachmentType accepts phone voice notes recorded as plain MP4 when every track handler is a sound track (any video track is refused). Android app 2.1.0: profile screen (photo from camera or gallery, About, sign out), photos in avatars everywhere, last seen in chat headers, contact and group info screens, camera button, hold-to-record voice notes (Opus/Ogg on Android 10+, AAC/MP4 before) with a player, edit (15 min) and delete for everyone, mute 8 h / 1 week / always, photos shrunk to 1600 px JPEG before sending, sender photo on notifications. Profiles and presence are not synced to factory LOCAL servers. Rollback: redeploy the previous version; the two new tables can stay.
- JMS Chat native Android app (v1.134.0): android_chat/ rewritten from a WebView into a native Kotlin/Compose app (login, chat list with unread badges and search, conversations with WhatsApp-style bubbles, date chips, read ticks, replies, photos (Coil, Bearer auth) and files (DownloadManager), retry of failed sends, typing, new chat and new group, live updates over /api/chat/stream). Push: Firebase Cloud Messaging, initialised from BuildConfig (FCM_APP_ID / FCM_API_KEY / FCM_PROJECT_ID / FCM_SENDER_ID CI secrets; no google-services.json); data-only messages from the new src/modules/chat/chatFcm.js (HTTP v1, service-account key from FCM_SERVICE_ACCOUNT env, MAIN only, empty = off; tokens in chat_fcm_devices via POST /api/chat/fcm/register|unregister, dead tokens deleted); chatNotify sends each new message to Web Push and FCM (same mute / @mention rules); MessagingStyle notifications per chat with Reply and Mark as read. Self-update: new app=chat feed (/qc-app/chat/) on /api/qc-app/publish; the workflow auto-publishes on main once MAIN runs >= 1.134.0. /api/chat-app/login now also returns the token for the native Bearer header. Rollback: redeploy 1.133.0; chat_fcm_devices can stay.
- JMS Chat app (v1.133.0): everyone talks on MAIN. New chat-only sign-in POST /api/chat-app/login (src/modules/chat/chatAppAuth.js) for any active user: no MAIN geofence, no global access, same lockout. It issues a `typ: chat` session (cookie jms_chat_session) that auth.js accepts ONLY on /api/chat/*; everywhere else it counts as no session, so full JMS on MAIN stays global-only. New chat_app.html (full-screen chat, login, iPhone Add to Home Screen via chat-app.webmanifest); chat-widget.js app mode (always open, no floating buttons, ✕ = Sign out). New Android app android_chat/ (WebView of chat_app.html on https://jmsocean.cloud, file picker, downloads, Back, unread notifications every 15 min while closed) built by .github/workflows/android-chat-apk.yml.
- QC Hold release flow (v1.132.0): only Moulding Manager / Moulding Ass. Manager (and admin/superadmin) can Release a QC hold. A released hold then waits for Quality to Verify or Not verify; Not verified puts it back ON HOLD for Moulding with the QC reason. New "QC verify" filter and KPI on the Hold tab, verify columns in the Excel, new POST /api/qc/holds/:id/verify; release now checks the user's role on the server.
- Planning order popup (v1.131.0): completed plans now show their JC number (plan_board.job_card_no, else label print log by plan, else OR-JR report) with JC date, plan window, actual DPR run dates, rejects and planner; the JC opens the drill-down. /api/planning/orders/:orderNo/history returns the extra fields.

### Fixed
- DPR quick-action auto-fill (v1.132.1): with no single factory selected, /api/dpr/auto-fill-ongoing carried every unit's Mould Change / Maintenance hours forward but saved the fill-in rows as factory 1, so another unit's plan code landed on an unrelated factory-1 plan (e.g. Linea Dark Grey 0-qty rows under PLN-2627-7029). Fill-in rows now keep the factory of the entry they continue. Shifting availability (Manual Entry popup, machine board, manual shift check) also ignores DPR rows whose order differs from the plan's order.
- Shifting Manual Entry (v1.131.2): colour-wise Plan / Balance showed "—" because plan colour_details store the colour as `colourName`, which buildShiftColourSummary did not read (it fell back to item-code short names). It now reads colourName / colour_name / colorName, and planned colours not yet produced are listed too.
- Shifting Manual Entry (v1.131.1): the job popup now shows plan-wise quantities — a Plan vs Produced bar (balance to produce / excess), Plan and Balance columns per colour with a Total row, and the plan qty on each job tab. /api/shifting/machine-board jobs carry plan_qty.
- Chat (v1.130.2): a shared link opened the page with ?jmsChatTarget=<id> and the parameter stayed in the address bar, so every refresh showed the "Shared by …" banner again. The widget now removes it with history.replaceState once the link is handled (after any factory-switch reload); the page's own query and hash are kept. package-lock.json root version brought in line (was 1.126.0).

### Changed
- Joy AI (v1.130.1): the Joy AI chat box is temporarily hidden on every page (JOY_AI_ENABLED = false at the top of BACKEND/PUBLIC/assets/ai-chat.js). Set it back to true to restore it.

### Added
- Chat (v1.130.0): Share to chat and replies (src/modules/chat/chatShare.js). A 🔗 button next to the chat button (and right-click / long-press on rows, cards and tiles; Shift+right-click keeps the browser menu) enters mark mode: click the problem or share the whole page. The link records the page URL (same-origin relative only: no absolute, protocol-relative, javascript: or /api/ links; checked on the server), page title, active factory, a locator (id / data-* keys / CSS path / text / codes like M-07) and an excerpt. The compose sheet picks people and groups (POST /api/chat/share, up to 20 targets), a note and Normal/Urgent priority; it sends kind=link messages with chat_messages.meta. Link cards show page, factory, excerpt, status (Open / In progress / Done) and Urgent. Opening one switches factory on the main site when the user may see it (localStorage factory scope; denied or other-factory-server cases are explained), keeps the chat open, finds the marked element even if the page loads its data late, highlights it with a pulse and shows a banner with Start work / Mark done (POST /api/chat/tasks/:id, which posts a system line replying to the shared message). Status lives in chat_tasks (sync_id derived from the message, last write wins), replicated by the chat sync and pushed live as task events. Replies: reply_to_sync_id on text and file messages (must be in the same chat), quoted block in bubbles (tap to jump and flash, "Original message deleted"), ↩ on hover, Reply in the menu, swipe right on touch; a reply to your message notifies you even in a muted chat (bell, push and pop-up). Search also matches shared page titles; retention empties link meta; exports show shared links. Screenshots of the marked area are not included (no capture library in the app). Image viewer: tapping a chat photo opens it full screen over a dark backdrop (closes on backdrop click/tap, Esc, ✕ or the phone Back button via a pushed history entry); zoom 1x-5x with wheel, pinch, + / - / fit buttons and double-click/double-tap (fit <-> 2.5x); drag to pan when zoomed (a click that ends a drag, pinch or swipe never closes); header with sender, time and download; arrows / swipe / keyboard step through the chat's photos; spinner while loading; focus kept inside the viewer and returned on close.

### Added
- Chat (v1.129.0): JMS Chat, phase 6 - hardening and rollout. Kill switch and staged rollout (src/modules/chat/chatGate.js): CHAT_ENABLED (off = widget hidden, every /api/chat/* answers 404 CHAT_DISABLED, open streams close at the next heartbeat) and CHAT_FACTORIES ("all" or factory ids; users whose home or assigned factory is listed, everyone on a listed factory LOCAL; superadmins always, to test). Set in Settings > Chat (GET/PUT /api/admin/chat-settings, superadmin, MAIN only, audit-logged); env CHAT_ENABLED / CHAT_FACTORIES (passed in docker-compose.vps-v1-isolated.yml) override it; factory LOCALs follow MAIN through the chat sync pull. Load-test script BACKEND/scripts/chat-load-test.js (forked workers, SSE users, steady send rate, refuses port 5432). Live events keep working when a worker loses its LISTEN connection: a 2-second polling fallback from the last id snapshot, without duplicates.
### Changed
- Chat (v1.129.0): unread count reads chat by chat through the (conversation_sync_id, server_ts) index instead of scanning every message (54 ms -> 1 ms at 300k messages); superadmin list cached for 30 s for live events; no attachment lookup for text messages; superadmin copies of messages only refresh the open All-chats list (at most every 3 s) and log list_all at most once per 10 minutes. At 200 users / 1,000 messages a minute on 2 workers with 300k messages of history: send p95 949 ms -> 21 ms, pool queue peak 66 -> 4.
- nginx (v1.129.0): SSE locations for /api/chat/stream and /api/events (no buffering or gzip, 1 h timeouts, HTTP/1.1 keepalive); vps-blue-green.conf duplicate timeouts removed and client IP headers repeated in location /. Production uses Traefik, which does not buffer SSE.

### Added
- Chat (v1.128.0): JMS Chat, phase 5 - superadmin console and retention (src/modules/chat/chatAdmin.js). chat_admin.html (menu "Chat Console", superadmins only; every /api/chat/admin/* route checks superadmin): filter chats by person, site (main / factory, from the message factory_id), date range (IST days) and text; open any chat read-only with system lines; banner says views are logged. Export one chat or a filtered range to Excel or CSV (GET /api/chat/admin/export; text cells only, CSV formula cells made text, max 100,000 messages, a filter is required). Audit log viewer: chat_audit_views (new details JSONB with filters / row counts) for console views, searches, exports, file opens, the chat-panel superadmin views and retention changes. First-open notice in the chat panel: "Messages may be reviewed by administrators". Retention: server_config CHAT_RETENTION_DAYS (default 730, 30-3650, set in settings.html, MAIN only); a daily job on MAIN (one worker, advisory lock) soft-purges messages older than that (body emptied, purged_at set, row kept), which replicates to every LOCAL through the chat sync; each server then deletes its own copies of purged attachment files (file_removed_at, local bookkeeping); old CHAT bell lines are emptied. Purged messages show as "Removed after the retention period", cannot be edited, and their files return 410. Rollback: redeploy v1.127.0; columns and the setting can stay (purged text cannot be restored).

### Added
- Chat (v1.127.0): JMS Chat, phase 4 - notifications (src/modules/chat/chatNotify.js). Bell: trigger chat_message_notify keeps ONE row per user and chat in notifications (type CHAT, newest message, link /index.html?chat=<id>), flipped back to unread by each new message and marked read by POST /api/chat/read; its sync_id comes from user + chat, so MAIN and LOCAL copies are one row in the general sync. Mute: POST /api/chat/conversations/:id/mute (8h / 1w / always / off) on chat_members.muted_until (syncs with the chat); a muted chat makes no bell row, push, pop-up or sound unless the message @mentions you or says @all / @everyone (chat_mentions(), whole word). Web Push for closed tabs with web-push + VAPID, MAIN only (factory LOCALs are plain HTTP): keys from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (env only, passed in docker-compose.vps-v1-isolated.yml, documented in env.vps-v1.example; empty = push off); subscriptions in chat_push_subscriptions (MAIN-local, expired ones dropped on 404/410); one worker sends (advisory lock), so a message is pushed once, including messages synced in from a factory. Service worker: PUBLIC/sw-chat.js (push + notification click), imported by the existing /sw.js since one scope can hold one worker. Widget: 🔔 menu (turn on desktop notifications, sound on/off), mute menu, 🔕 in the chat list, @ autocomplete and highlighted mentions in groups, background-tab pop-ups (one per chat via tag), ?chat=<id> opens that chat. Rollback: redeploy v1.126.0; the new column, table and trigger can stay (drop trigger trg_chat_messages_bell to stop bell rows).
### Security
- Notifications page (v1.127.0): title, message, type and sender were inserted as HTML, so a notification carrying markup (now possible from chat text) could run script. They are escaped now.

### Added
- Chat (v1.126.0): JMS Chat, phase 3 - chat replicates between MAIN and every factory LOCAL in seconds (src/modules/chat/chatSync.js), separate from the 5-minute general sync. Every chat row carries sync_seq (one sequence, stamped by trigger) as a cursor that never ties or goes back; one LOCAL worker (advisory lock) pushes its changes to MAIN at once after a local write and pulls MAIN changes every 3 s (POST /api/sync/chat/push, GET /api/sync/chat/pull, sync key). Rows applied from MAIN get no sync_seq, so nothing echoes back. Upserts by sync_id: newer updated_at wins; last_read_at / last_message_at only move forward; receipt times keep the first value. Direct chats, members and receipts get a sync_id derived from their natural key so two servers creating the same chat agree; a one-time migration (chat_sync_state ids_v1) rewrites phase 1/2 rows, and a clash on the natural key adopts the incoming id. Attachment files: the LOCAL that received one pushes it to MAIN (POST /api/sync/chat/file, retried each cycle, tracked in chat_file_pushed); a server missing a file fetches it from MAIN when it is opened (else a 503 "still on its way"). Typing and online dots stay per server. Rollback: redeploy v1.125.0; the extra columns, triggers and tables can stay (the triggers only stamp sync_seq and send NOTIFY).
### Fixed
- Chat (v1.126.0): with PM2 in cluster mode, a live chat event only reached users whose stream sat on the same worker that handled the write. Live events now go through PostgreSQL NOTIFY (trigger chat_notify), and every worker relays them to its own streams, for local writes and synced rows alike. Chat schema creation is serialised with an advisory lock, so workers starting together no longer collide on CREATE EXTENSION / CREATE TABLE.

### Added
- Chat (v1.125.0): JMS Chat, phase 2. Group chats (create with the 👥 button, rename by any member, add / remove people by group admins, leave; when the last admin leaves the longest-standing member becomes admin; joins, renames and leaves show as system lines; sender names in group bubbles). Attachments via POST /api/chat/attachments (multer, 10 MB, kept in memory until checked): only images (JPEG/PNG/GIF/WebP), PDF, .xlsx (no macro workbooks) and audio (MP3/OGG/WAV/M4A/WebM voice), decided by the file's real bytes, never its name or MIME type; saved under PUBLIC/uploads/chat (on the uploads volume) but blocked for static serving, handed out only by GET /api/chat/files/:id after a membership check (superadmin opens are logged). Per-message delivered / read receipts in the new chat_receipts table (sent / delivered / read ticks; group ticks show who has read). Typing indicator over the existing SSE stream. Message search (GET /api/chat/search) with a pg_trgm GIN index (skipped with a warning if the extension cannot be created). Edit within 15 minutes and delete for everyone (soft delete: the row stays, its text and file are hidden). New tables chat_attachments / chat_receipts link by sync_id and carry factory_id like phase 1. Attachment files are not in the LOCAL<->MAIN upload sync yet (phase 3). Rollback: redeploy v1.124.0; the new tables and uploads/chat can stay.
- Chat (v1.124.0): JMS Chat, phase 1. A green chat button (bottom-right, above the AI assistant) on every page opens a WhatsApp-style panel: one-to-one chats with anyone in JMS, live delivery (SSE at /api/chat/stream), unread badge and tab-title count, toast + sound for new messages, sent / read ticks, date dividers, older-message paging, phone layout. Needs a login session. Superadmins get an "All chats (admin)" tab that is read-only; every such view is logged in chat_audit_views. New tables chat_conversations / chat_members / chat_messages / chat_audit_views are linked by sync_id and carry factory_id, ready for LOCAL<->MAIN sync in phase 3 (not synced yet: each server has its own chats for now). Rollback: remove the loader at the end of assets/app.js; the tables can stay.

### Changed
- Reports (v1.121.0): redesigned the Reports page. Report types are now grouped cards (Production, Planning, Machines & People, Stock) with a one-line description each; quick date presets (Today, Yesterday, This week, Last 7 days, This month, Last month); a loading state on Generate. Results get a title with factory / period / row count, summary KPI tiles, sticky table headers, right-aligned Indian-format numbers, a totals row (follows the search box), All-rows paging, and Excel / CSV / Print-PDF buttons (Excel keeps numbers as numbers and includes the totals; print shows every row in landscape). Machine dropdowns follow the standard Line-then-machine-number order. All report APIs and calculations are unchanged.
- Login (v1.120.2): redesigned sign-in page. One compact card with the logo header on every screen size, with a brand-coloured strip on top. Adds a Caps Lock warning, a spinner while signing in, a clear error box (empty fields are highlighted), password-manager friendly autocomplete, auto-focus on the right field, and keyboard/screen-reader labels. Login logic, Remember me, factory picker and redirects are unchanged.

### Fixed
- Reports (v1.121.0): default and Machine Date-Wise History dates were computed in UTC, so before 05:30 IST the page pre-filled yesterday as "today". Dates now use local time.
- NPD (v1.120.1): factory LOCAL servers did not receive NPD products created before v1.120.0 (a LOCAL pulls only rows changed since its last pull). MAIN now marks the existing NPD rows changed once (server_config NPD_SYNC_RESEND_V1), so every LOCAL pulls the full list on its next cycle.

### Added
- NPD (v1.120.0): NPD Tracker syncs both ways between MAIN and the factory LOCAL servers. Products, stages, status, remarks, trial reports and images added, edited or deleted on either side reach the other (LOCAL changes are pushed at once; MAIN changes arrive on the next pull, about 5 min). Rows are keyed by sync_id and files link to their product by product_sync_id. MAIN settles Sr No clashes (a product arriving with a number already in use gets the next free one, which syncs back). NPD trial reports (PDF / Word / Excel) may now travel in the upload sync, only in uploads/npd.

### Added
- NPD (v1.119.2): Export Excel button on the NPD Tracker. Downloads the products shown (status tile + search) with every stage colour coded like the page, real dates, status, remarks, trial report / image counts and last update; header frozen, filters on.

### Added
- NPD (v1.119.1): full screen viewer on the same page. Product images (thumbnail or gallery) open full size with zoom (buttons, mouse wheel, pinch, double-click), drag to move, rotate, fit / 1:1 and previous / next. PDF trial reports open inside the page; Word / Excel reports offer a download.

### Added
- NPD (v1.118.1): product image thumbnail in the Product column (latest photo after trial, placeholder when none; click opens the trial report / images window).

### Changed
- NPD (v1.117.1): Sr No is given automatically when a product is added (next number after the highest one); it is no longer typed in or edited.

### Fixed
- NPD (v1.115.1): NPD Tracker now shows the app sidebar and header like every other page.

### Added
- NPD (v1.115.0): new **NPD** menu with the NPD Tracker (`npd.html`), built from the NPD tracking sheet. One row per new
  product with every launch stage (mould received → trials → QC → packing / BOM / ERP → mass production → costing →
  launch). Stage cells are Pending (blue), In Progress (yellow), Complete (green) or N/A (red); planned job card
  start / completion, launch and dispatch are dates. Overall status dropdown (Hold / Launched / Delayed / On Schedule /
  Cancelled) with filter tiles, remarks, trial report upload and product images after trial. Everyone with access can
  view; only PPC Ass. Manager, PPC Manager and Sr. PPC Manager (and admins) can add, edit, upload or delete.

### Changed
- Docs (v1.112.3): CLAUDE.md documents the `production` environment approval step before the production deploy runs.

### Changed
- Planning (v1.112.1): deactivated moulds are no longer offered in the order mould list or the alternative-mould
  picker. Moulds that already have a plan still show. DPR follows automatically (its moulds come from plans).

### Added
- Mould Master (v1.112.0): Admin / Superadmin can deactivate (and re-activate) a mould with the toggle in the
  Actions column. Deactivated moulds are hidden from the Mould Master list for all other roles; admins still see
  them with an INACTIVE badge. Logged in mould history.

### Fixed
- Order Tracker (v1.110.2): consumption ratio from plan_board, then moulds master, then ERP BOM (JR/JGUI/2627/3903 showed
  ×240 and an end date in 2045); ratio mismatch / implausible ratio warnings; sets-per-day pace tiles; per-mould
  cycle / cavity / std / live / needed rate; machine advice capped to free machines; journey labels no longer overlap.

### Added
- Order Tracker (v1.110.0): verdict (on time / at risk / late), current process and per-job-card process stages from
  the OR-JR stage fields + shifted qty, suggestions from the live machine board, mould sequence cards with qty.
  Closed-short moulds detected; order/JC expected end only when every open mould is scheduled (else earliest end).

### Fixed
- VPS backup disk growth (v1.107.1): deploy safety dumps in `.deploy/backups` are pruned to the newest 5
  per environment (`KEEP_DEPLOY_BACKUPS`); `vps-cron-setup.sh` no longer installs the 02:05 uploads
  tarball job that duplicated the 6-hourly `scheduled-backup.yml` archive, and removes its leftovers;
  `KEEP_UPLOAD_TARS` default 4 → 2.

### Added
- Order Tracker (v1.109.0): dates for everything. Order journey band, All dates table (order / job cards / moulds /
  machine plans: planned, actual, expected, must-start, early/late), job card completion + forecast per mould
  (first in, first out by job card date), planned/actual/forecast timeline, job card x mould grid with dates.

### Added
- Order Tracker (v1.108.0): start plan per order: mould start sequence, started / expected start (from the machine queue),
  must-start-by (target minus hours needed), on-time state; timeline with must-start markers; page redesigned
  (full-page order view, fixes the cut-off drawer). Machine board is now buildMachineBoard() shared by both views.

### Added
- Order Tracker (v1.107.0): new order_tracker.html + /api/order-tracker/{orders,order,machines}. Order wise
  (complete sets via mould consumption ratio, bottleneck mould, job card wise sets, expected end
  from live rate) and machine wise (running job, queue, machine free time).

### Changed
- Planning (v1.103.1): the Planner role can now use Restore on the Complete Production Plan list
  (previously superadmin and PPC managers only).

### Fixed
- Scheduled backup (v1.101.5): every run since 28-Sep failed at the 60-min SSH timeout. The DB dump reached
  Google Drive each time, but the per-file uploads mirror (3.4 GB, throttled, no time limit) never
  finished. Carried over from #1675: each Drive step is time-boxed (DB 20m, daily archive 25m, files
  mirror 15m soft cutoff that continues next run), thumbnail folders are skipped, larger Drive chunks,
  fewer retries, real deletes instead of Drive trash, SSH timeout 90m. The run now fails (and emails)
  only when the DB dump misses Drive. The log warns while the shared rclone client ID is in use
  (fix: docs/OPS-SETUP.md section 1b). Rollback: revert this PR.

### Security
- Internal code maps no longer public (v1.101.3): `api-inventory.json` (every route with source file and
  line), `graphify-graph.json` (1 MB code graph) and their viewer `graph-view.html` moved from
  `BACKEND/PUBLIC` to `docs/code-map/` (`deploy_graphify_docker.ps1` updated). The server answers 404
  for those paths, because the LOCAL updater never deletes old files from factory servers.
  `analyze.html` and `joy.html` are real modules and stay. Rollback: revert this PR.

### Fixed
- Version 1.101.4: LOCAL servers no longer duplicate dpr_hourly rows on sync. When the incoming
  row's global_id is unknown but this server holds the same entry (natural key + identical
  created_at) under another global_id, sync re-keys that row instead of inserting a copy (copies
  doubled Produced and made Machine Timeline balances negative). New
  `BACKEND/scripts/cleanup-dpr-hourly-sync-duplicates.js` removes existing copies on a LOCAL
  (dry run by default; `--apply` backs up, verifies every removed row is unknown to MAIN, then
  deletes).

### Changed
- Version 1.101.2: unique version for the release carrying the Timeline Excel IST fix and the npm
  audit fix (both had been numbered 1.101.1).

### Security
- Dependencies (v1.101.1): `npm audit fix` — `proxy-addr` 2.0.8 (critical: IP spoofing through
  IPv4-mapped IPv6 trust subnets; matters for TRUST_PROXY, rate limit and login lockout keys),
  `brace-expansion` 1.1.21 / 2.1.7 / 5.0.12 (high), plus non-breaking patch bumps (e.g. sharp 0.35.5).
  Left: `sprintf-js` (moderate) via `mammoth` → `argparse` — only mammoth's CLI uses it; the fix needs a
  breaking `--force`. Rollback: revert this PR.

### Security
- Route guard bypass (v1.100.9): Express matched routes case-insensitively and answered HEAD with
  the GET handler, while the hard locks in `routeGuards.js` only matched lower-case GET paths. So
  `/API/admin/backup` (whole-DB download), `/API/admin/users/create` (new admin account),
  `/API/admin/restore` etc. ran with no login on MAIN, staging and factory servers. The guard now
  matches the lower-cased path and treats HEAD as GET, and `createApp` enables case-sensitive routing.
  Also guarded (no client calls them without a session): `GET /api/users`, `/api/activity/monitor`,
  `/api/hr/operators|history|download-operators` (login), `/api/admin/fix-sync-schema` (admin).
  Rollback: revert this PR.

### Changed
- QC late grace (v1.100.8): a 2-hour QC check is "late" only when saved more than 60 min after
  its slot ends (was 15) — DPR Compliance (Process QC) and `/api/qc/compliance` (QC app).


### Added
- Sync QC verifications (v1.100.7): `qc_verifications` joins sync (`sync_id` key). It and `qc_holds` get
  `dpr_global_id` (= `dpr_hourly.global_id`); trigger `qc_link_dpr_entry` re-points `dpr_entry_id` to the
  receiving server's own `dpr_hourly` row (ids differ between servers). The factory LOCAL backfills
  `dpr_global_id` for existing rows on boot. Reads match by entry id OR global id; the hour-level
  fallback is only for rows with neither. The no-entry unique index becomes `uq_qcv_slot_noentry2`.
  `dpr_hourly.global_id` is now created on a fresh DB too (same definition as existing servers).
  Rollback: remove `qc_verifications` from SYNC_ALL; the added columns/trigger are harmless.


### Fixed
- QC Compliance two jobs (v1.100.6): a slot QC checked under one job of a machine is no longer
  counted as Missed on the other job's row (one check per machine per slot).


### Changed
- QC check time (v1.100.5): DPR Compliance (Process QC) 2-hour check cells show the IST time
  the check was saved (`entered_at`) under OK / Not OK.


### Added
- Delete QC entries (v1.100.4): new `POST /api/qc/entry/delete` `{ kind: slot | setup | verify, id }`
  for roles quality (QC HOD), quality_ass__manager, quality_executive, admin, superadmin (checked
  server-side from the user's role). Delete buttons in the QC 2-hour check popup, the QC One-time
  Setup card (per half) and the DPR entry popup (QC verification). Slot / setup deletes sync through
  `sync_deletions`; verifications live on the factory server only. `/api/qc/summary-matrix` slots and
  `/api/dpr/summary-matrix` entries now include the row id (`id`, `qc_verify_id`).


### Changed
- QC Compliance job cell (v1.100.3): DPR Compliance (Process QC) Machine / Job cell matches
  Moulding: date + shift chips, MC / CC chips, OR | JC, client, mould name, Plan | Bal.
  `/api/qc/summary-matrix` `plans` now also cover orders QC checked in the range and carry
  `plan_qty`, `balance_qty`, `client_name`, `status`; `dprRunning` carries `cc` / `mc` counts.


### Fixed
- FPA per machine (v1.100.2, QC app 1.8.2): the QC app looked up FPA by plan on any machine,
  so a job moved to another machine showed the old machine's FPA as done while the DPR job
  details (machine-scoped) showed none. The app now checks the job's machine (`/api/qc/job-checks`
  `machine`), and says where the old FPA was when only another machine has one. The DPR job
  details panel shows that other-machine FPA, marked, instead of "No FPA images saved".


### Fixed
- QC app One-time Setup 2nd half (v1.100.1, QC app 1.8.1): the app never sent `setup_period`, so
  the server saved every setup as period 1 and a "2nd half" save overwrote the 1st half. The app
  now sends `setup_period`, loads `setups` per half, ticks saved halves, and defaults to 2nd half
  when only the 1st is saved. Setups already overwritten cannot be recovered.


### Added
- FPA follows a moved job (v1.100.0, QC app 1.8.0): `/api/planning/move` copies the plan's
  latest done FPA (`qc_job_checks`, matched by plan_id or order + mould) to the target machine
  as Pending (or resets the job's existing row there), sets new `fpa_transferred_from` /
  `fpa_transferred_from_id`, and notifies FPA approvers; honours the FPA auto-approve window.
  `/api/qc/fpa/list` and `/api/qc/fpa/status` return it; fpa.html and the QC app show
  "Job moved from M-x". Only adds columns; a failed copy never blocks the move.


### Added
- QC Compliance Summary setups + jobs (v1.99.0): DPR Compliance (Process QC) shows Setup 1 /
  Setup 2 (time, who, out-of-STD flags: weight 5%, cycle 10%, cavity exact) per job, one row
  per job card on the machine in the shift (each job owns its slots until the next starts), and
  "Not running" when the machine has no running plan, DPR entry or QC data.
  `/api/qc/summary-matrix` adds `dprRunning` (machines with DPR entries per date/shift).


### Added
- QC hold photos + per-entry QC marks (v1.98.0, QC app 1.7.0): `qc_holds` gains `image_urls`
  (JSONB) and `dpr_entry_id`; `POST /api/qc/hold` also takes multipart with up to 4 `hold_images`.
  `qc_verifications.status` can be `Rejected` or `Deviation` via `status_override` (the app sent
  Deviation before but the server saved Verified). `/api/dpr/summary-matrix` entries carry the
  entry's own hold + photos; the DPR Compliance cell shows hold / rejected / deviation / qty
  changed / verified marks. Quality holds list shows photos. Only adds columns; rollback = older
  code ignores them.


### Added
- QC verify per DPR entry (v1.97.0, QC app 1.6.0): an hour with a main + colour-change entry
  is verified entry by entry. `qc_verifications` is now unique per `dpr_entry_id` (the old
  one-per-hour key is dropped; rows with no entry keep a partial hour key). `/api/qc/verify/pending`
  returns `colour`, `entries_in_hour`, `entry_no`; `/api/qc/verify/submit` takes an optional
  `dpr_entry_id`; new `/api/qc/verify/submit-batch` ("Verify both"). DPR Compliance Summary and
  shifting availability read the entry's own verification. Rollback: older code keeps working on
  the new table except that its one-per-hour `ON CONFLICT` has no matching key; recreate
  `UNIQUE(machine, dpr_date, shift, hour_slot)` after deleting duplicate-hour rows to roll back.


### Fixed
- DPR Compliance Summary, multi-mould orders (v1.96.1): mould rows were de-duplicated by
  `order_no` alone, so a second mould of the same order on a machine/shift (e.g. TOP + HOOK of
  JR/JGUI/2627/3901, BODY + INNER BODY of JR/JGUI/2627/2703) was dropped and its hours hidden.
  Rows and hourly cells now match on order + plan (fallback: mould code, then name) through one
  shared `sameJob` / `rowOwnsEntry` rule; `/api/dpr/summary-matrix` entries now include `plan_id`.

### Added
- Job details show shifting everywhere (v1.96.0): `/api/shifting/availability` adds shifted
  qty per location (job + colour), the latest 15 entries, and lookup by `order_no` (+`machine`).
  New shared `assets/job-shifting-panel.js` ("Production · QC · Shifting") in the DPR / QC
  Compliance job-details modal (dpr.html) and the Shifting Supervisor job modal.

### Added
- Shifting: produced + QC-verified only (v1.95.0): `shiftingAvailabilityMap` (DPR good qty,
  QC-verified share per machine/date/shift/hour from `qc_verifications`, shifted, ready),
  `GET /api/shifting/availability?plan_id` (job info, party, totals, colour-wise, holds).
  `scan-entry` / `entry` refuse NOT PRODUCED and more than the verified-ready qty
  (verification enforced only where recent `qc_verifications` exist, i.e. factory LOCAL).
  `scan-label` returns colour produced/verified/ready + `block_code`/`block_message`;
  `/api/shifting/jobs` adds verified, not verified, ready, hold and client.

### Added
- Shifting v2 backend + web (v1.94.0):
  - `shifting_line_teams` (Shifting Supervisor + Incharge per line/date/shift) with
    `GET/POST /api/shifting/line-team`; replicates LOCAL -> MAIN like `qc_line_teams`
    (sync schema v10).
  - `unit_weight_kg` (Mould Master `std_wt_kg`, kg per piece) on `/api/shifting/scan-label`
    and `/api/shifting/jobs`; jobs fall back to the machine master line.
  - `POST /api/shifting/entry` saves an optional `weightKg`.
  - `GET /api/shifting/compliance?date&shift`: per line team, per machine pcs/kg per 2-hour
    slot with entries, DPR production per slot, running-job shop-floor balance.
  - DPR Compliance Summary: new Process "Shifting" (dpr-script-1.js).

### Fixed
- Shifting APK auto-publish (v1.93.2): `android-shifting-apk.yml` now waits (up to 25 min) for
  MAIN to report version >= 1.93.1 before publishing. On the 1.93.1 release the publish reached the
  old server first, which ignored `app=shifting` and overwrote the QC feed (restored by re-runs).

### Added
- Shifting app update feed (v1.93.1): `POST /api/qc-app/publish` takes `app=shifting` to publish
  the native Shifting APK to `PUBLIC/qc-app/shifting/` (`jms-shifting.apk` + `version.json`),
  inside the existing qc-app volume. Default `app=qc` keeps the QC feed unchanged.

### Performance
- Order Master (v1.91.2): `/api/masters/orders` builds the excluded OR/JR set once
  (`order_excluded` CTE) instead of two per-order NOT EXISTS scans, counts plans and required
  moulds once per order (LATERAL) instead of 5 correlated subqueries, and drops the unused
  `planned_details` JSON. Factory-1 local: 466 ms -> 94 ms, 3.4 MB -> 2.8 MB (156 KB gzip), same
  rows and plan status. Count cards filter the cached response instead of refetching.

### Changed
- Orders auto-complete (v1.91.0): when every OR-JR row of an order is Completed (or a mix of
  Completed/Cancelled), `syncOrderCompletionConfirmations` sets the order to `Completed` directly
  (history action `AUTO_COMPLETED`) instead of flagging it for confirmation. The planning gate
  (fully planned + job cards linked) no longer holds completed orders on the board. Orders
  already waiting for confirmation are completed on the next sync. The OR-JR fetch also skips
  `Complete` / `Canceled` / `Cancel` spellings. Order Master drops the Status Change and
  Confirmation columns, the hourglass, and Confirm All.
  Rollback: revert the PR; orders set Completed by `AUTO_COMPLETED` can be found in
  `order_completion_history`.

### Changed
- Order Master (v1.90.1): "Job card overdue" card replaced by "Job card not created" (orders with
  no job_card_no); the red "late" job card date highlight is removed.

### Added
- Order Master row detail drawer (v1.90.0): `GET /api/orders/detail?order_no=` returns the order's
  required moulds (mould_planning_summary), plans (plan_board) and DPR good/reject per plan
  (dpr_hourly), factory-scoped and read-only. The eye button opens it instead of the old modal.
- Order Master redesign (v1.89.0): count cards (open / not planned / partial / fully planned /
  job card overdue) that act as quick filters, a mould plan progress bar, red "Not Planned"
  status, and late job card dates highlighted. Client-side only; no API change.

### Fixed
- Order Master / OR-JR Status showed another plant's orders (JR/JP in Dungra) (v1.88.1). The ERP
  import trusted the ERP factoryID over the OR/JR plant code; the plant code now wins when it maps
  to a known factory. Both pages hide mis-filed rows (`?include_other_factory=1` shows them), and
  `BACKEND/scripts/fix_misfiled_factory_orders.js` moves existing rows (dry run by default, writes
  a backup JSON, `--rollback <file>` restores).
- Local servers missed new orders from MAIN (v1.76.9). A long MAIN transaction (ERP import)
  committed after the local pull watermark had passed its updated_at, so those rows were never
  pulled. Pulls now re-check the last 20 minutes (`SYNC_PULL_OVERLAP_MINUTES`); re-pulled rows
  are no-ops.

### Added
- Enterprise engineering docs: README, CONTRIBUTING, CODE_OF_CONDUCT, ARCHITECTURE, ROADMAP.
- `docs/` guides: GIT_WORKFLOW, GITHUB_SETTINGS, ENGINEERING_GUIDE, CODE_REVIEW_GUIDELINES,
  COMMIT_CONVENTION, JIRA_WORKFLOW, PROJECT_WORKFLOW, FOLDER_STRUCTURE, TESTING.
- GitHub issue templates (Bug, Feature, Task, Refactor, Documentation) + config.
- Quality tooling: `.editorconfig`, Prettier, ESLint (advisory, scoped), `.vscode` settings.
- `quality.yml` CI workflow (advisory format/lint on PRs).

### Changed
- (none)

### Fixed
- (none)

---

## [1.3.0] — Previous release

Baseline before the enterprise-workflow documentation effort. Backend at `1.3.0`
(`BACKEND/package.json`). See git history and `RELEASE_MANIFEST.json` for prior details.

[Unreleased]: https://github.com/malisanjay475/jms_enterprise/compare/main...develop
