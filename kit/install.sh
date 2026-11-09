#!/bin/sh
# 交付模式一键安装（macOS / Linux）
# 用法：在终端里运行  sh install.sh
# 作用：
#   1. 把交付技能和组合包复制到 ~/.dsh-delivery-kit
#   2. 通过 DSH 自带的命令行把组合包装进你正在用的 profile（自动识别 desktop / web）
#   3. 新会话默认使用“交付”预设
# 不需要注册账号；模型费用走你自己的 DeepSeek API Key。
# 可选环境变量：
#   DSH_APP            DSH 应用位置（默认自动查找 /Applications、~/Applications）
#   DSH_CLI            直接指定 dsh 命令行
#   DSH_PROFILE_NAME   只装进这个 profile（默认装进所有已存在的 profile）
#   DSH_HOME           DSH 数据目录（默认 ~/.dsh）
#   DSH_DELIVERY_HOME  工具包安装目录（默认 ~/.dsh-delivery-kit）
set -eu

KIT_DIR="${DSH_DELIVERY_HOME:-$HOME/.dsh-delivery-kit}"
DSH_DATA="${DSH_HOME:-$HOME/.dsh}"
SRC_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
HELP="https://github.com/znnw4m6k7k-dotcom/dsh-delivery/blob/main/docs/安装问题排查.md"

say() { printf '%s\n' "$*"; }
die() {
  printf '\n安装失败：%s\n\n常见问题和解决办法：%s\n' "$*" "$HELP" >&2
  exit 1
}

say "== 交付模式安装 =="

# ---------- 1. 检查环境 ----------
OS=$(uname -s)
case "$OS" in
  Darwin|Linux) ;;
  *) die "这个脚本用于 macOS / Linux。Windows 请运行 install.ps1（或双击 Install-Windows.bat）。" ;;
esac

if [ "$(id -u)" = "0" ] && [ -z "${DSH_ALLOW_ROOT:-}" ]; then
  die "请不要用 sudo 运行。去掉 sudo，直接运行 sh install.sh（用 sudo 会装到管理员账户下，你自己的 DSH 看不到）。"
fi

[ -f "$SRC_DIR/bundle/cordis.patch.yml.in" ] || die "安装包不完整：缺少 bundle/cordis.patch.yml.in。请重新下载完整的压缩包并解压后再运行（不要只复制 install.sh）。"
[ -d "$SRC_DIR/skills/delivery-protocol" ] || die "安装包不完整：缺少 skills/。请重新下载完整的压缩包并解压后再运行。"
case "$KIT_DIR" in *"'"*) die "安装目录里不能有单引号：$KIT_DIR。请用 DSH_DELIVERY_HOME 指定一个没有单引号的目录。" ;; esac

# 找 DSH 命令行
CLI="${DSH_CLI:-}"
APP=""
if [ -z "$CLI" ]; then
  if [ -n "${DSH_APP:-}" ]; then
    APP="$DSH_APP"
  elif [ "$OS" = "Darwin" ]; then
    for a in "/Applications/DeepSeek Harness.app" "$HOME/Applications/DeepSeek Harness.app"; do
      [ -d "$a" ] && { APP="$a"; break; }
    done
    if [ -z "$APP" ] && command -v mdfind >/dev/null 2>&1; then
      APP=$(mdfind "kMDItemContentType == 'com.apple.application-bundle' && kMDItemFSName == 'DeepSeek Harness*.app'" 2>/dev/null | head -n 1 || true)
    fi
  fi
  if [ -n "$APP" ] && [ -x "$APP/Contents/Resources/runtime/cli/bin/dsh" ]; then
    CLI="$APP/Contents/Resources/runtime/cli/bin/dsh"
  elif command -v dsh >/dev/null 2>&1; then
    CLI=$(command -v dsh)
  fi
fi

if [ -z "$CLI" ]; then
  if [ -n "$APP" ] && [ -d "$APP" ]; then
    die "找到了 DeepSeek Harness（$APP），但它没有自带命令行。请把 DSH 升级到 0.2.1 或更新版本后再运行。"
  fi
  die "没找到 DeepSeek Harness。
请先从官方渠道下载安装 DeepSeek Harness，并打开一次（让它完成初始化）后再运行本脚本。
如果装在别的位置，可以这样指定：DSH_APP=\"/你的路径/DeepSeek Harness.app\" sh install.sh"
fi
[ -x "$CLI" ] || die "DSH 命令行不可执行：$CLI"
say "DSH 命令行：$CLI"

if [ -n "$APP" ] && [ -f "$APP/Contents/Info.plist" ] && [ -x /usr/libexec/PlistBuddy ]; then
  VER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo unknown)
  say "DeepSeek Harness 版本：$VER"
  case "$VER" in 0.2.*) ;; *) say "提示：本组合包按 0.2.1 制作，你的版本是 ${VER}。装好后请新建会话确认“交付”预设能正常使用。" ;; esac
fi

# 选 profile：指定了就用指定的；否则装进所有已存在的 profile（DSH 桌面版常见 desktop 或 web）
if [ -n "${DSH_PROFILE_NAME:-}" ]; then
  PROFILES="$DSH_PROFILE_NAME"
else
  PROFILES=""
  if [ -d "$DSH_DATA/profiles" ]; then
    for p in "$DSH_DATA/profiles"/*; do
      [ -d "$p" ] || continue
      n=$(basename "$p")
      case "$n" in *" "*|.*) continue ;; esac
      PROFILES="$PROFILES $n"
    done
  fi
  if [ -z "$PROFILES" ]; then
    if [ ! -d "$DSH_DATA" ]; then
      say "提示：没找到 $DSH_DATA，看起来 DSH 还没打开过。建议先打开一次 DSH 再安装；现在先按默认 profile（desktop）安装。"
    fi
    PROFILES="desktop"
  fi
fi
say "安装到 profile：$PROFILES"

PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info[0] >= 3 else 1)' >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  if [ "$OS" = "Darwin" ]; then
    say "提示：没检测到可用的 python3。复盘时整理行业经验需要它，可运行 xcode-select --install 安装（不影响现在的安装）。"
  else
    say "提示：没检测到可用的 python3。复盘时整理行业经验需要它，请用系统的包管理器安装 python3（不影响现在的安装）。"
  fi
fi

# ---------- 2. 复制文件 ----------
say "复制文件到 $KIT_DIR ..."
mkdir -p "$KIT_DIR" 2>/dev/null || die "无法创建 $KIT_DIR（没有写权限）。"
[ -w "$KIT_DIR" ] || die "没有 $KIT_DIR 的写权限。如果以前用 sudo 装过，请先运行：sudo rm -rf \"$KIT_DIR\"，再重新安装。"
rm -rf "$KIT_DIR/bundle.new" "$KIT_DIR/skills.new"
cp -R "$SRC_DIR/bundle" "$KIT_DIR/bundle.new"
cp -R "$SRC_DIR/skills" "$KIT_DIR/skills.new"
esc=$(printf '%s' "$KIT_DIR" | sed 's/[\\&|]/\\&/g')
sed "s|__KIT_DIR__|$esc|g" "$KIT_DIR/bundle.new/cordis.patch.yml.in" > "$KIT_DIR/bundle.new/cordis.patch.yml"
rm -f "$KIT_DIR/bundle.new/cordis.patch.yml.in"
rm -rf "$KIT_DIR/bundle" "$KIT_DIR/skills"
mv "$KIT_DIR/bundle.new" "$KIT_DIR/bundle"
mv "$KIT_DIR/skills.new" "$KIT_DIR/skills"
chmod +x "$KIT_DIR/skills/project-retro/scripts/lessons.py" 2>/dev/null || true
cp "$SRC_DIR/uninstall.sh" "$KIT_DIR/uninstall.sh" 2>/dev/null || true
# 从网上下载的文件在 macOS 上带“隔离”标记，去掉以免 DSH 读取时被拦
if [ "$OS" = "Darwin" ] && command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$KIT_DIR" 2>/dev/null || true
fi

# ---------- 3. 装进 DSH ----------
registered() { [ -f "$1" ] && grep -q '"@local/delivery-kit"' "$1"; }
OK=""
FAILED=""
for PROFILE in $PROFILES; do
  PKG="$DSH_DATA/profiles/$PROFILE/package.json"
  was=""
  registered "$PKG" && was=1
  say "把组合包装进 DeepSeek Harness（profile: ${PROFILE}）..."
  if "$CLI" plugin --profile "$PROFILE" add "$KIT_DIR/bundle"; then :; else
    if [ -n "$was" ]; then
      say "（以前装过，这次是更新：文件已替换，注册信息沿用。）"
    else
      say "这个 profile 安装失败，上面是 DSH 的原始报错。"
    fi
  fi
  # 核对是否真的注册进了 profile（命令行偶尔会无报错退出却没装上）
  if registered "$PKG"; then
    say "已核对：$PKG 里有 @local/delivery-kit。"
    OK="$OK $PROFILE"
  else
    FAILED="$FAILED $PROFILE"
  fi
done

if [ -z "$OK" ]; then
  die "组合包没有注册成功（profile:$FAILED）。
请改用应用内安装：在 DSH 里新建会话，发送
  用 plugin_manager 的 install_bundle 安装 $KIT_DIR/bundle
并在弹出的批准提示里点同意。"
fi
[ -z "$FAILED" ] || say "提示：profile$FAILED 没装上，已装好的是$OK。只要你平时用的那个装上了就行。"

RUNNING=""
if [ "$OS" = "Darwin" ] && pgrep -f "DeepSeek Harness" >/dev/null 2>&1; then RUNNING=1; fi

# ---------- 4. 收尾说明 ----------
cat <<EOF

安装完成。接下来：
  1. 完全退出 DeepSeek Harness 后重新打开$( [ -n "$RUNNING" ] && printf '（它现在正开着，请按 Cmd+Q 退出，只关窗口不够）' )。
  2. 首次使用：欢迎页选“添加 API Key”，填入你在 DeepSeek 开放平台充值后创建的 API Key。不需要注册 DSH 账号。
  3. 新建会话，确认智能体预设显示为“交付”。如果你以前在设置里手动选过默认预设，请在设置里改成“交付”。
  4. 直接说你要交付的成果，例如“帮我做一份政务数据平台的建设方案”。项目验收后说“做复盘”，它会整理经验并逐条请你确认。
  5. 想确认装好了：在会话里输入 /delivery-doctor 。

行业经验包保存在 ~/.agents/skills/industry-<行业>/，卸载交付模式不会删除它们。
更新：重新运行一次安装即可。
卸载：sh "$KIT_DIR/uninstall.sh"
EOF
