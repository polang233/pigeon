#!/usr/bin/env bash
# 构建 build/Pigeon.app（release + ad-hoc 签名）。可重复运行。
set -euo pipefail

MAC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$MAC_DIR/.." && pwd)"
APP="$ROOT_DIR/build/Pigeon.app"
CONTENTS="$APP/Contents"

cd "$MAC_DIR"
swift build -c release
BIN_DIR="$(swift build -c release --show-bin-path)"

rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"
cp "$BIN_DIR/Pigeon" "$CONTENTS/MacOS/Pigeon"

if [ -d "$ROOT_DIR/web" ]; then
  rsync -a --delete --exclude '.DS_Store' --exclude '/test/' --exclude '/README.md' --exclude '/art/local/' "$ROOT_DIR/web/" "$CONTENTS/Resources/web/"
else
  echo "警告：没有找到 $ROOT_DIR/web，应用里不会带网页文件" >&2
  mkdir -p "$CONTENTS/Resources/web"
fi

# 应用自己派活要用的命令行脚本
if [ -d "$ROOT_DIR/plugin/scripts" ]; then
  mkdir -p "$CONTENTS/Resources/plugin"
  rsync -a --delete --exclude '.DS_Store' "$ROOT_DIR/plugin/scripts/" "$CONTENTS/Resources/plugin/scripts/"
else
  echo "警告：没有找到 $ROOT_DIR/plugin/scripts，应用里不能自己派活" >&2
fi

ICON_KEY=""
if [ -f "$MAC_DIR/Resources/AppIcon.icns" ]; then
  cp "$MAC_DIR/Resources/AppIcon.icns" "$CONTENTS/Resources/AppIcon.icns"
  ICON_KEY="    <key>CFBundleIconFile</key>
    <string>AppIcon</string>"
fi

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>zh_CN</string>
    <key>CFBundleExecutable</key>
    <string>Pigeon</string>
    <key>CFBundleIdentifier</key>
    <string>dev.polang.pigeon</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Pigeon</string>
    <key>CFBundleDisplayName</key>
    <string>Pigeon</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
$ICON_KEY
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.developer-tools</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key>
        <true/>
    </dict>
</dict>
</plist>
PLIST

plutil -lint "$CONTENTS/Info.plist" >/dev/null
codesign --force --deep -s - "$APP"
echo "已生成 $APP"
