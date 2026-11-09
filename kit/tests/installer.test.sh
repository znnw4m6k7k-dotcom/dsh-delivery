#!/bin/sh
# 安装脚本测试（macOS / Linux）：用假的 DSH 命令行跑一遍安装、重装、卸载。
# 运行：sh kit/tests/installer.test.sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
KIT=$(dirname "$HERE")
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home" DSH_HOME="$T/home/.dsh" DSH_CLI="$HERE/fake-dsh/dsh" DSH_ALLOW_ROOT=1
export DSH_DELIVERY_HOME="$T/home/我的 工具包"
mkdir -p "$DSH_HOME/profiles/desktop" "$DSH_HOME/profiles/web"
fail() { echo "FAIL: $*"; exit 1; }

sh "$KIT/install.sh" > "$T/out1" 2>&1 || { cat "$T/out1"; fail "首次安装"; }
for p in desktop web; do grep -q '"@local/delivery-kit"' "$DSH_HOME/profiles/$p/package.json" || fail "profile $p 没注册"; done
grep -q "$DSH_DELIVERY_HOME/skills" "$DSH_DELIVERY_HOME/bundle/cordis.patch.yml" || fail "技能目录没替换"
grep -q '__KIT_DIR__' "$DSH_DELIVERY_HOME/bundle/cordis.patch.yml" && fail "还有占位符"
[ -f "$DSH_DELIVERY_HOME/skills/delivery-protocol/SKILL.md" ] || fail "技能没复制"

# 重装（命令行报“已安装”也算成功）
FAKE_DSH_FAIL_IF_EXISTS=1 sh "$KIT/install.sh" > "$T/out2" 2>&1 || { cat "$T/out2"; fail "重装"; }
grep -q '更新' "$T/out2" || fail "重装没提示更新"

# 指定 profile
DSH_PROFILE_NAME=only sh "$KIT/install.sh" > "$T/out3" 2>&1 || { cat "$T/out3"; fail "指定 profile"; }
grep -q '"@local/delivery-kit"' "$DSH_HOME/profiles/only/package.json" || fail "指定 profile 没注册"

# 找不到 DSH 时给出清楚的提示
( unset DSH_CLI; PATH=/usr/bin:/bin; export DSH_APP="$T/nope.app"; sh "$KIT/install.sh" ) > "$T/out4" 2>&1 && fail "没有 DSH 也成功了"
grep -q '没找到 DeepSeek Harness' "$T/out4" || { cat "$T/out4"; fail "缺少找不到 DSH 的提示"; }

# 卸载
sh "$DSH_DELIVERY_HOME/uninstall.sh" > "$T/out5" 2>&1 || { cat "$T/out5"; fail "卸载"; }
for p in desktop web only; do grep -q '"@local/delivery-kit"' "$DSH_HOME/profiles/$p/package.json" && fail "profile $p 没移除"; done
[ -d "$DSH_DELIVERY_HOME/bundle" ] && fail "卸载后文件还在"
echo "installer tests: ok"
