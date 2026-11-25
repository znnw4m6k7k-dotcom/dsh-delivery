## 给桌面 Agent 的「交付模式」

用 AI 做工具、写方案或做调研时，可以先和它确认什么算交付，再让它开工。做完后，用同一份验收清单逐条核对，并记录执行过的检查和待确认项。

> 这是**兜底模板**：nightly 构建，或正式版没在 `docs/releases/<tag>.md` 写说明时使用。
> 正式发版请在 `docs/releases/<tag>.md` 按版本写一份，发布流程会优先用它。

## 选择安装包

| 文件 | 使用方式 |
|---|---|
| `dsh-delivery-kit.zip` | DeepSeek Harness。全部解压后，在 macOS 双击 `Install-Mac.command`，Windows 双击 `Install-Windows.bat`。重启 DSH 后使用“交付”预设。 |
| `delivery-contract-claude.zip` | Claude 网页或 App 可在技能设置中上传。Claude Code 用户解压到 `~/.claude/skills/`。 |
| `delivery-contract-codex.zip` | Codex。解压到客户端扫描的技能目录，例如项目的 `.agents/skills/`。 |
| `delivery-contract-generic.zip` | Cursor、Copilot、Gemini CLI、OpenCode、Windsurf、Devin Local 和其他支持 Agent Skills 的客户端。解压到客户端的技能根目录，保留完整的 `delivery-contract/`。 |
| `delivery-contract.md` | 单文件版。上传到任意会读取附件的 AI 工具，或把全文粘贴进对话或自定义指令。 |

有终端和文件权限的 Agent 可直接下载通用 ZIP，读取 `delivery-contract/SKILL.md` 并运行脚本。加载技能或单文件后，输入“请使用 delivery-contract，先帮我确认这项任务的验收标准”。[按工具能力选择用法](https://github.com/znnw4m6k7k-dotcom/dsh-delivery/blob/main/docs/纯对话快速开始.md)

[完整安装指南](https://github.com/znnw4m6k7k-dotcom/dsh-delivery#选一个版本) · [English quick start](https://github.com/znnw4m6k7k-dotcom/dsh-delivery/blob/main/README.en.md) · [安装排查](https://github.com/znnw4m6k7k-dotcom/dsh-delivery/blob/main/docs/安装问题排查.md)
