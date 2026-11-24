#!/bin/sh
# 在线安装（macOS / Linux），不需要 git：
#   curl -fsSL https://raw.githubusercontent.com/znnw4m6k7k-dotcom/dsh-delivery/main/install-online.sh | sh
# 选装：… | sh -s -- cursor（其他目标见下方 AGENT_TARGETS）
# 通用目录：… | sh -s -- generic
# 自定义目录：… | sh -s -- custom "/path/to/skills"
# 网络慢或打不开 GitHub：先在浏览器下载压缩包解压，再运行里面的 Install-Mac.command 或 kit/install.sh。
# 也可以用 DSH_KIT_URL 指定一个可访问的压缩包地址（.tar.gz）。
set -eu
TARGET="${1:-dsh}"
REPO="znnw4m6k7k-dotcom/dsh-delivery"
REF="${DSH_KIT_REF:-main}"
HELP="https://github.com/$REPO/blob/main/docs/安装问题排查.md"
die() { printf '\n安装失败：%s\n常见问题和解决办法：%s\n' "$*" "$HELP" >&2; exit 1; }

# all 包含各客户端的专用目录。通用目录和自定义目录由用户单独选择。
AGENT_TARGETS="claude codex cursor copilot gemini opencode windsurf devin"
case "$TARGET" in
  custom) [ "$#" -eq 2 ] && [ -n "$2" ] || die "请指定技能根目录：custom /path/to/skills" ;;
  *)
    supported=
    for agent in dsh $AGENT_TARGETS generic all; do
      if [ "$TARGET" = "$agent" ]; then supported=1; break; fi
    done
    [ -n "$supported" ] || die "不认识的参数：${TARGET}（可选 dsh $AGENT_TARGETS generic custom all）"
    [ "$#" -le 1 ] || die "只有 custom 目标接受技能目录参数。"
    ;;
esac
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

install_skill() {
  from="$SRC/agent-skill/delivery-contract"
  case "$1" in
    claude) from="$SRC/claude-skill/delivery-contract"; root="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills" ;;
    codex) from="$SRC/codex-skill/delivery-contract"; root="${CODEX_HOME:-$HOME/.codex}/skills" ;;
    cursor) root="$HOME/.cursor/skills" ;;
    copilot) root="$HOME/.copilot/skills" ;;
    gemini) root="$HOME/.gemini/skills" ;;
    opencode) root="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/skills" ;;
    windsurf) root="$HOME/.codeium/windsurf/skills" ;;
    devin) root="${XDG_CONFIG_HOME:-$HOME/.config}/devin/skills" ;;
    generic) root="$HOME/.agents/skills" ;;
    custom) root="$2" ;;
    *) die "不认识的技能安装目标：$1" ;;
  esac
  [ -f "$from/SKILL.md" ] || die "压缩包里缺少 $1 的技能文件，请下载对应版本的完整源码压缩包。"
  # 相对路径加上 ./，确保用户提供的目录名不会被命令当成选项。
  case "$root" in /*) ;; *) root="./$root" ;; esac
  to="$root/delivery-contract"
  mkdir -p "$root"
  stage=$(mktemp -d "$root/.delivery-contract.XXXXXX")
  if ! cp -R "$from" "$stage/delivery-contract" || ! rm -rf "$to" || ! mv "$stage/delivery-contract" "$to"; then
    rm -rf "$stage"
    die "无法安装 $1 技能到 ${to}。"
  fi
  rmdir "$stage"
  echo "已安装 $1 技能：${to}（重新加载技能或新开会话）"
}

case "$TARGET" in
  dsh) sh "$SRC/kit/install.sh" ;;
  all)
    sh "$SRC/kit/install.sh" || echo "（DSH 部分没装上，见上面的原因；继续安装其他技能）"
    for agent in $AGENT_TARGETS; do install_skill "$agent"; done
    ;;
  custom) install_skill "$TARGET" "$2" ;;
  *) install_skill "$TARGET" ;;
esac
