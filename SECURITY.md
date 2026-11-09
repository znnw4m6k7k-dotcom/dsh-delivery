# 安全说明

## 报告漏洞
发现安全问题（例如守卫可以被绕过、安装脚本可能覆盖用户文件、经验包可能泄露客户信息），请通过 GitHub 的 **Security → Report a vulnerability** 私下报告，不要直接开公开 Issue。

## 这个项目会动你电脑上的哪些东西
- DSH 版：复制文件到 `~/.dsh-delivery-kit/`，再通过 DSH 自带的命令行把组合包注册进 `~/.dsh/profiles/desktop`。不改 DSH 程序本身。卸载脚本会撤销注册并删除 `~/.dsh-delivery-kit/`。
- Claude / Codex 版：只复制技能到 `~/.claude/skills/delivery-contract/` 或 `~/.codex/skills/delivery-contract/`。
- 行业经验包写在 `~/.agents/skills/industry-*/`（DSH）或对应工具的技能目录，只在你本机，卸载时保留。
- 不收集、不上传任何数据；模型调用走你自己在 DSH / Claude / Codex 里的账号和 Key。

## 关于“复制一行命令安装”
`curl … | sh` 和 `irm … | iex` 会直接运行网上下载的脚本。介意的话，先打开 `install-online.sh` / `install-online.ps1` 看一遍，或者从 Releases 下载 zip、解压后再双击安装。
