# JMS Shifting — native Android app

Shop-floor app for the Shifting department: scan a production label (phone camera
or hardware scanner), pick **Send To**, and shift the material. Talks to the same
`/api/shifting/*` endpoints as the web Shifting Supervisor page.

Login needs the **Shifting Supervisor App** access on the user.

## Screens
- **Scan & Shift** — scan box, Send To chips (remembers the last one), optional weight,
  Quick shift, QC HOLD / already-shifted blocks with an error buzz.
- **Jobs** — running + recent jobs (3/7/30 days), "On floor" filter, search.
- **Job detail** — totals, colours, recent shifts, and **Manual shift** for unlabelled material.
- **Recent** — latest shifting entries.
- **My Shift** — Day/Night shift summary by machine, supervisor and destination.

## Server
`BASE_URL` in `app/build.gradle.kts` (default: the factory LOCAL server
`http://192.168.1.173:3001/`).

## Build
No local Android tooling needed — GitHub Actions (`android-shifting-apk.yml`) builds
a debug APK on every push and, on `main` with the signing secrets, a signed release
that is auto-published to `/qc-app/shifting/`. Phones check
`/qc-app/shifting/version.json` and self-update.

Local build (JDK 17 + Android SDK): `gradle assembleDebug` in this folder.
