#!/bin/sh
# macOS 双击安装。第一次双击如果提示“无法打开”，请右键（或按住 Control 点按）这个文件 → 打开 → 打开。
cd "$(dirname "$0")" || exit 1
sh ./kit/install.sh
code=$?
echo
if [ $code -eq 0 ]; then echo "完成，可以关闭这个窗口。"; else echo "没装上，请把上面的文字截图发到 Issues：https://github.com/znnw4m6k7k-dotcom/dsh-delivery/issues"; fi
printf '按回车键关闭…'; read _ || true
exit $code
