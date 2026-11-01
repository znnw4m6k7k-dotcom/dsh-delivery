#!/bin/sh
# 交付模式一键安装（macOS）
# 用法：在终端里运行  sh install.sh
# 作用：
#   1. 把交付技能和组合包复制到 ~/.dsh-delivery-kit
#   2. 通过 DSH 自带的命令行把组合包装进桌面版（profile: desktop）
#   3. 新会话默认使用“交付”预设
# 不需要注册账号；模型费用走你自己的 DeepSeek API Key。
set -eu

APP="${DSH_APP:-/Applications/DeepSeek Harness.app}"
CLI="$APP/Contents/Resources/runtime/cli/bin/dsh"
KIT_DIR="${DSH_DELIVERY_HOME:-$HOME/.dsh-delivery-kit}"
PROFILE="${DSH_PROFILE_NAME:-desktop}"
SRC_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

say() { printf '%s\n' "$*"; }
die() { printf '安装失败：%s\n' "$*" >&2; exit 1; }

say "== 交付模式安装 =="

# 1. 检查环境
[ "$(uname -s)" = "Darwin" ] || die "目前只支持 macOS。"
[ -d "$APP" ] || die "没找到 DeepSeek Harness：$APP
请先从官方渠道下载安装 DeepSeek Harness，打开一次后再运行本脚本。"
[ -x "$CLI" ] || die "这个版本的 DeepSeek Harness 没有自带命令行（${CLI}）。请升级到 0.2.1 或更新版本。"
[ -f "$SRC_DIR/bundle/cordis.patch.yml.in" ] || die "安装包不完整：缺少 bundle/cordis.patch.yml.in"
[ -d "$SRC_DIR/skills/delivery-protocol" ] || die "安装包不完整：缺少 skills/"
case "$KIT_DIR" in *"'"*) die "安装目录里不能有单引号：$KIT_DIR" ;; esac

VER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo unknown)
say "DeepSeek Harness 版本：$VER"
case "$VER" in 0.2.*) ;; *) say "提示：本组合包按 0.2.1 制作，你的版本是 ${VER}，装好后请新建会话确认“交付”预设能正常使用。" ;; esac

if ! command -v python3 >/dev/null 2>&1 || ! python3 -c 'import sys' >/dev/null 2>&1; then
  say "提示：没检测到可用的 python3。复盘时整理行业经验需要它，可运行 xcode-select --install 安装。"
fi

# 2. 复制文件
say "复制文件到 $KIT_DIR ..."
mkdir -p "$KIT_DIR"
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

# 3. 装进 DSH
say "把组合包装进 DeepSeek Harness（profile: ${PROFILE}）..."
if ! "$CLI" plugin --profile "$PROFILE" add "$KIT_DIR/bundle"; then
  die "DSH 命令行安装组合包失败。上面是它的原始报错。
也可以改用应用内安装：在 DSH 里新建会话，让它用 plugin_manager 的 install_bundle 安装目录 $KIT_DIR/bundle 。"
fi

# 3b. 核对是否真的注册进了 profile（命令行偶尔会无报错退出却没装上）
PROFILE_PKG="${DSH_HOME:-$HOME/.dsh}/profiles/$PROFILE/package.json"
if [ -f "$PROFILE_PKG" ] && grep -q '"@local/delivery-kit"' "$PROFILE_PKG"; then
  say "已核对：$PROFILE_PKG 里有 @local/delivery-kit。"
else
  die "命令行运行结束，但 $PROFILE_PKG 里没有 @local/delivery-kit，说明组合包没有注册成功。
请改用应用内安装：在 DSH 里新建会话，发送
  用 plugin_manager 的 install_bundle 安装 $KIT_DIR/bundle
并在弹出的批准提示里点同意。"
fi

# 4. 收尾说明
cat <<EOF

安装完成。接下来：
  1. 完全退出 DeepSeek Harness（Cmd+Q）后重新打开。
  2. 首次使用：欢迎页选“添加 API Key”，填入你在 DeepSeek 开放平台充值后创建的 API Key。不需要注册 DSH 账号。
  3. 新建会话，确认智能体预设显示为“交付”。如果你以前在设置里手动选过默认预设，请在设置里改成“交付”。
  4. 直接说你要交付的成果，例如“帮我做一份政务数据平台的建设方案”。项目验收后说“做复盘”，它会整理经验并逐条请你确认。

行业经验包保存在 ~/.agents/skills/industry-<行业>/，卸载交付模式不会删除它们。
卸载：sh "$KIT_DIR/uninstall.sh"
EOF
