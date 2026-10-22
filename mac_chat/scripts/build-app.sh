#!/usr/bin/env bash
# Builds "JMS Chat.app" (universal: Apple silicon + Intel) and a .dmg into mac_chat/dist/.
# Needs Xcode (or the Command Line Tools) on macOS 13+.
#   APP_BUILD      build number (CI passes the run number), default 1
#   SIGN_IDENTITY  "Developer ID Application: …" to sign for real; default "-" (ad-hoc)
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(tr -d '[:space:]' < VERSION)"
BUILD="${APP_BUILD:-1}"
IDENTITY="${SIGN_IDENTITY:--}"
ARCHS=(--arch arm64 --arch x86_64)

swift build -c release "${ARCHS[@]}"
BIN_DIR="$(swift build -c release "${ARCHS[@]}" --show-bin-path)"

APP="dist/JMS Chat.app"
rm -rf dist
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/JMSChat" "$APP/Contents/MacOS/JMSChat"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" packaging/Info.plist > "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# App icon from the 1024 px PNG.
ICONSET="dist/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" packaging/AppIcon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) packaging/AppIcon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET"

if [ "$IDENTITY" = "-" ]; then
  codesign --force --deep --sign - "$APP"
else
  codesign --force --deep --options runtime --timestamp --sign "$IDENTITY" "$APP"
fi
codesign --verify --verbose "$APP"

# Disk image: drag the app onto Applications.
STAGE="dist/dmg"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
DMG="dist/JMS-Chat-$VERSION.dmg"
hdiutil create -volname "JMS Chat" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

echo "Built: $APP"
echo "Built: $DMG"
