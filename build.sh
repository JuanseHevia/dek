#!/bin/zsh
# Build Dek.app into dist/. Requires: Xcode Command Line Tools, node.
set -euo pipefail
cd "$(dirname "$0")"

echo "· bundling web shell + deck runtime"
(cd web && [ -d node_modules ] || npm install --no-fund --no-audit >/dev/null)
(cd web && node build.mjs)

APP=dist/Dek.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web/dist" "$APP/Contents/Resources/mcp" \
         "$APP/Contents/Resources/decks" "$APP/Contents/Resources/templates" "$APP/Contents/Resources/docs"

echo "· compiling swift shell (universal)"
SRC=(mac/Sources/AgentServer.swift mac/Sources/main.swift)
swiftc -O -target arm64-apple-macos12 "${SRC[@]}" -o /tmp/dek-arm64
swiftc -O -target x86_64-apple-macos12 "${SRC[@]}" -o /tmp/dek-x86_64
lipo -create /tmp/dek-arm64 /tmp/dek-x86_64 -output "$APP/Contents/MacOS/Dek"
rm -f /tmp/dek-arm64 /tmp/dek-x86_64

cp mac/Info.plist "$APP/Contents/Info.plist"
cp web/index.html web/presenter.html web/style.css "$APP/Contents/Resources/web/"
cp web/dist/app.js "$APP/Contents/Resources/web/dist/"
cp mcp/dek-mcp.js "$APP/Contents/Resources/mcp/"
cp decks/*.html "$APP/Contents/Resources/decks/"
cp templates/*.html "$APP/Contents/Resources/templates/"
cp docs/DECK_FORMAT.md "$APP/Contents/Resources/docs/"
[ -f mac/Dek.icns ] && cp mac/Dek.icns "$APP/Contents/Resources/"

codesign --force --sign - "$APP" 2>/dev/null || true

echo "✓ built $APP"
