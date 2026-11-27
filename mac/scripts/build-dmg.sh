#!/usr/bin/env bash
# 构建分发磁盘映像：build/Pigeon-<version>.dmg（含 Applications 拖入快捷方式）。
# 用法：mac/scripts/build-dmg.sh [--skip-build]
set -euo pipefail

MAC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$MAC_DIR/.." && pwd)"
APP="$ROOT_DIR/build/Pigeon.app"
SKIP_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help)
      echo "用法: mac/scripts/build-dmg.sh [--skip-build]"
      exit 0
      ;;
    *)
      echo "未知参数: $arg" >&2
      exit 64
      ;;
  esac
done

if [ "$SKIP_BUILD" -eq 0 ] || [ ! -d "$APP" ]; then
  bash "$MAC_DIR/scripts/build-app.sh"
fi

PLIST="$APP/Contents/Info.plist"
if [ ! -f "$PLIST" ]; then
  echo "没找到 $PLIST" >&2
  exit 1
fi

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST" 2>/dev/null || echo '0.3.0')"
DMG="$ROOT_DIR/build/Pigeon-$VERSION.dmg"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/pigeon-dmg.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

ditto "$APP" "$STAGE/Pigeon.app"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create -volname "Pigeon" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
hdiutil verify "$DMG" >/dev/null

SIZE="$(du -h "$DMG" | awk '{print $1}')"
SHA="$(shasum -a 256 "$DMG" | awk '{print $1}')"
echo "已生成 $DMG ($SIZE)"
echo "SHA256: $SHA"
