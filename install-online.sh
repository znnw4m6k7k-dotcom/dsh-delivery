#!/bin/sh
# 在线安装（macOS / Linux），不需要 git：
#   curl -fsSL https://raw.githubusercontent.com/znnw4m6k7k-dotcom/dsh-delivery/main/install-online.sh | sh
# 装到别的工具：
#   … | sh -s -- claude    装 Claude Code 技能（~/.claude/skills/omni-delivery）
#   … | sh -s -- codex     装 Codex 技能（~/.codex/skills/omni-delivery）
#   … | sh -s -- all       三个都装（DSH 没装时自动跳过）
# 网络慢或打不开 GitHub：先在浏览器下载压缩包解压，再运行里面的 Install-Mac.command 或 kit/install.sh。
# 也可以用 DSH_KIT_URL 指定一个可访问的压缩包地址（.tar.gz）。
set -eu
TARGET="${1:-dsh}"
REPO="znnw4m6k7k-dotcom/dsh-delivery"
REF="${DSH_KIT_REF:-main}"
HELP="https://github.com/$REPO/blob/main/docs/安装问题排查.md"
die() { printf '\n安装失败：%s\n常见问题和解决办法：%s\n' "$*" "$HELP" >&2; exit 1; }

case "$TARGET" in dsh|claude|codex|all) ;; *) die "不认识的参数：$TARGET（可选 dsh / claude / codex / all）" ;; esac
command -v tar >/dev/null 2>&1 || die "缺少 tar 命令。"

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t dshkit)
trap 'rm -rf "$TMP"' EXIT INT TERM

URLS="${DSH_KIT_URL:-} https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF https://github.com/$REPO/archive/refs/heads/$REF.tar.gz"
got=""
for u in $URLS; do
  [ -n "$u" ] || continue
  echo "下载 $u ..."
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 --connect-timeout 15 -o "$TMP/kit.tar.gz" "$u" && got=1 && break
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$TMP/kit.tar.gz" "$u" && got=1 && break
  else
    die "缺少 curl 或 wget，无法下载。"
  fi
done
[ -n "$got" ] || die "下载失败，可能是网络连不上 GitHub。可以：
  1) 换个网络或开代理后重试；
  2) 在浏览器打开 https://github.com/$REPO ，点 Code → Download ZIP，解压后双击 Install-Mac.command。"

tar xzf "$TMP/kit.tar.gz" -C "$TMP" || die "压缩包解压失败，可能下载不完整，请重试。"
SRC=$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n 1)
[ -f "$SRC/kit/install.sh" ] || die "下载的内容不完整，请重试。"

copy_skill() { # $1=源目录 $2=目标技能目录 $3=名称
  mkdir -p "$(dirname "$2")"
  rm -rf "$2.new"; cp -R "$1" "$2.new"; rm -rf "$2"; mv "$2.new" "$2"
  echo "已安装 $3 技能：$2（新开一个会话即可使用）"
}

case "$TARGET" in
  dsh) sh "$SRC/kit/install.sh" ;;
  claude) copy_skill "$SRC/claude-skill/omni-delivery" "$HOME/.claude/skills/omni-delivery" "Claude Code" ;;
  codex) copy_skill "$SRC/codex-skill/omni-delivery" "${CODEX_HOME:-$HOME/.codex}/skills/omni-delivery" "Codex" ;;
  all)
    sh "$SRC/kit/install.sh" || echo "（DSH 部分没装上，见上面的原因；继续安装 Claude / Codex 技能）"
    copy_skill "$SRC/claude-skill/omni-delivery" "$HOME/.claude/skills/omni-delivery" "Claude Code"
    copy_skill "$SRC/codex-skill/omni-delivery" "${CODEX_HOME:-$HOME/.codex}/skills/omni-delivery" "Codex"
    ;;
esac
