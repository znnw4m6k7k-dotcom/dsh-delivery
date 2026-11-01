#!/bin/sh
# 卸载交付模式。行业经验包（~/.agents/skills/industry-*）会保留。
set -eu
APP="${DSH_APP:-/Applications/DeepSeek Harness.app}"
CLI="$APP/Contents/Resources/runtime/cli/bin/dsh"
KIT_DIR="${DSH_DELIVERY_HOME:-$HOME/.dsh-delivery-kit}"
PROFILE="${DSH_PROFILE_NAME:-desktop}"

if [ -x "$CLI" ]; then
  "$CLI" plugin --profile "$PROFILE" remove @local/delivery-kit || echo "提示：DSH 里没有找到 @local/delivery-kit，可能已经卸载。"
else
  echo "提示：没找到 DeepSeek Harness 命令行，跳过从 DSH 移除这一步。"
fi
rm -rf "$KIT_DIR/bundle" "$KIT_DIR/skills" "$KIT_DIR/uninstall.sh"
rmdir "$KIT_DIR" 2>/dev/null || true
echo "已卸载交付模式。请重启 DeepSeek Harness。行业经验包仍在 ~/.agents/skills/ 下。"
