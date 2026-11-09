#!/bin/sh
# 卸载交付模式（macOS / Linux）。行业经验包（~/.agents/skills/industry-*）会保留。
set -eu
KIT_DIR="${DSH_DELIVERY_HOME:-$HOME/.dsh-delivery-kit}"
DSH_DATA="${DSH_HOME:-$HOME/.dsh}"

CLI="${DSH_CLI:-}"
if [ -z "$CLI" ]; then
  for a in "${DSH_APP:-}" "/Applications/DeepSeek Harness.app" "$HOME/Applications/DeepSeek Harness.app"; do
    [ -n "$a" ] && [ -x "$a/Contents/Resources/runtime/cli/bin/dsh" ] && { CLI="$a/Contents/Resources/runtime/cli/bin/dsh"; break; }
  done
fi
[ -n "$CLI" ] || CLI=$(command -v dsh 2>/dev/null || true)

if [ -n "${DSH_PROFILE_NAME:-}" ]; then
  PROFILES="$DSH_PROFILE_NAME"
else
  PROFILES=""
  for p in "$DSH_DATA/profiles"/*; do
    [ -f "$p/package.json" ] && grep -q '"@local/delivery-kit"' "$p/package.json" && PROFILES="$PROFILES $(basename "$p")"
  done
fi

if [ -z "$CLI" ]; then
  echo "提示：没找到 DeepSeek Harness 命令行，跳过从 DSH 移除这一步。"
elif [ -z "$PROFILES" ]; then
  echo "提示：DSH 里没有找到 @local/delivery-kit，可能已经卸载。"
else
  for PROFILE in $PROFILES; do
    "$CLI" plugin --profile "$PROFILE" remove @local/delivery-kit || echo "提示：profile $PROFILE 里移除失败，可在 DSH 设置的插件页手动移除 @local/delivery-kit。"
  done
fi
rm -rf "$KIT_DIR/bundle" "$KIT_DIR/skills" "$KIT_DIR/uninstall.sh" "$KIT_DIR/uninstall.ps1"
rmdir "$KIT_DIR" 2>/dev/null || true
echo "已卸载交付模式。请完全退出并重新打开 DeepSeek Harness。行业经验包仍在 ~/.agents/skills/ 下。"
