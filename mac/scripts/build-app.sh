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

# 菜单栏图标（单色模板图）
if [ -f "$MAC_DIR/Resources/MenuBarIcon.svg" ]; then
  cp "$MAC_DIR/Resources/MenuBarIcon.svg" "$CONTENTS/Resources/MenuBarIcon.svg"
fi

# 应用图标：.icns 给 macOS 14、15；装了 Xcode 时再把分层的 Pigeon.icon 编进 Assets.car，
# macOS 26 起深色、着色、透明外观由系统按层生成
ICON_KEY=""
if [ -f "$MAC_DIR/Resources/AppIcon.icns" ]; then
  cp "$MAC_DIR/Resources/AppIcon.icns" "$CONTENTS/Resources/AppIcon.icns"
  ICON_KEY="    <key>CFBundleIconFile</key>
    <string>AppIcon</string>"
fi
if [ -d "$MAC_DIR/Resources/Pigeon.icon" ] && xcrun --find actool >/dev/null 2>&1; then
  PARTIAL="$(mktemp -t pigeon-icon).plist"
  if xcrun actool "$MAC_DIR/Resources/Pigeon.icon" --compile "$CONTENTS/Resources" --app-icon Pigeon \
      --platform macosx --target-device mac --minimum-deployment-target 14.0 \
      --output-partial-info-plist "$PARTIAL" --output-format human-readable-text >/dev/null; then
    ICON_KEY="$ICON_KEY
    <key>CFBundleIconName</key>
    <string>Pigeon</string>"
  else
    echo "警告：分层图标编译失败，只用 AppIcon.icns" >&2
  fi
  rm -f "$PARTIAL"
  # actool 会顺手生成一份 Pigeon.icns，旧系统有 AppIcon.icns 就够了
  rm -f "$CONTENTS/Resources/Pigeon.icns"
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
    <string>0.3.0</string>
    <key>CFBundleVersion</key>
    <string>3</string>
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
