# 交付模式 · Delivery Contract

[下载完整工具 ZIP](https://github.com/znnw4m6k7k-dotcom/dsh-delivery/releases/latest/download/delivery-contract-generic.zip) · [下载单文件 Agent](delivery-contract.md) · [使用说明](docs/纯对话快速开始.md) · [English quick start](README.en.md)

让 AI Agent 在开工前和你确认需求与验收标准，做完后逐条核对并提交报告。适合开发小工具、写业务方案、做调研和财务测算。你也可以在交付后复盘，把逐条确认过的经验留给下次使用。

**有终端或文件权限的 Agent** 可以下载完整 ZIP，让 Agent 读取 `delivery-contract/SKILL.md` 并运行仓库脚本。**只有聊天功能的 AI 工具**可以上传单文件版或粘贴全文来走同一套交付流程。支持 Agent Skills 的客户端可一次导入完整包，以后直接调用。[按工具能力选择用法](docs/纯对话快速开始.md)

> 第一次试用可以说：“请使用 delivery-contract（交付模式）帮我做一个销售对账工具。先问我用哪些字段匹配、怎么算金额差异、异常输出成什么样。等我确认验收标准再开工。”

**用 WorkBuddy 或豆包？** 如果你的客户端提供自定义技能导入，可以用通用包试装。两款客户端均待实机验证。只有聊天入口时，可以直接复制纯对话模板。[查看试装步骤和兼容状态](docs/国内桌面Agent试装.md)

## 选一个版本

在 [GitHub Releases](https://github.com/znnw4m6k7k-dotcom/dsh-delivery/releases/latest) 展开 **Assets** 查看安装包。若下载受阻，可以直接使用下面的源码安装方式。

| 你使用的工具 | 安装方式 | 系统或条件 |
|---|---|---|
| WorkBuddy、豆包及国内桌面 Agent | [桌面客户端试装](docs/国内桌面Agent试装.md) · `delivery-contract-generic.zip` | 客户端需支持自定义 Agent Skills 导入。当前待实机验证 |
| Claude 网页、Claude App、Claude Code | [Claude 技能](#安装-claude-或-codex) · `delivery-contract-claude.zip` | 网页和 App 需要开放技能上传。Claude Code 可安装到技能目录 |
| Codex | [Codex 技能](#安装-claude-或-codex) · `delivery-contract-codex.zip` | CLI、App 或 IDE。安装到 Codex 扫描的目录 |
| Cursor、Copilot、Gemini CLI、OpenCode、Windsurf、Devin Local 等 | [通用 Agent Skills 技能](#安装其他-agent) · `delivery-contract-generic.zip` | macOS、Windows、Linux，取决于客户端是否支持 `SKILL.md` |
| DeepSeek Harness | [DSH 组合包](#安装-deepseek-harness) · `dsh-delivery-kit.zip` | macOS、Windows。含交付预设、技能、运行时守卫和工作台 |
| 没有技能安装入口，但能读文件并运行命令的 Agent | [直接运行仓库工具](docs/纯对话快速开始.md#能访问文件并运行命令) · `delivery-contract-generic.zip` | Python 3、终端和工作区文件权限 |
| 聊天、上传附件或设置自定义指令的 AI 工具 | [单文件 Agent](delivery-contract.md) · `delivery-contract.md` | 上传或粘贴即可启动工作流。执行测试需要实际运行环境 |

安装技能无需为本项目注册账号。模型使用你在客户端已有的账号或 API Key。脚本验收需要 Python 3、终端和项目文件权限。独立 QA 需要客户端支持独立 Agent 或隔离会话。

## 安装 DeepSeek Harness

1. 安装并打开一次 DeepSeek Harness。
2. 下载 `dsh-delivery-kit.zip`，完整解压。macOS 双击 `Install-Mac.command`，Windows 双击 `Install-Windows.bat`。也可用下方在线命令选择 `dsh`。
3. 完全退出 DSH 并重新打开。初次使用时按 DSH 提示设置 DeepSeek API Key。
4. 新建会话，看到“交付”预设后输入 `/delivery-doctor`，查看技能、守卫和工作目录的检测结果。

## 安装 Claude 或 Codex

- **Claude 网页或 App**：下载 `delivery-contract-claude.zip`，在设置的“功能 / 技能”中上传 ZIP。首次使用脚本时，按 Claude 提示开启代码执行。[Claude 安装说明](claude-skill/安装说明.md)
- **Claude Code**：在线命令选择 `claude`，或把 Claude ZIP 解压到 `~/.claude/skills/`。如果配置了 `CLAUDE_CONFIG_DIR`，在线脚本会使用该目录下的 `skills/`。
- **Codex**：在线命令选择 `codex`，或把 Codex ZIP 解压到 Codex 扫描的技能目录。项目级安装可把技能放到 `.agents/skills/`。若使用 `CODEX_HOME`，在线脚本会安装到该目录下的 `skills/`。[Codex 安装说明](codex-skill/安装说明.md)

安装后重新加载技能或新开会话，再按下面的示例验证。

## 安装其他 Agent

通用包使用 [Agent Skills 格式](https://agentskills.io/specification)。任选一种方式安装。

1. **离线安装**：下载通用 ZIP 并解压到客户端的技能根目录。支持 ZIP 导入的客户端也可直接上传。
2. **从源码安装**：在仓库首页点 **Code → Download ZIP**，完整解压。将 [`agent-skill/delivery-contract/`](agent-skill/delivery-contract/) 整个目录复制到客户端的技能根目录。
3. **在线安装**：在下方命令中填入表中的目标。

无论哪种方式，文件路径都应是 **`<技能根目录>/delivery-contract/SKILL.md`**。请把同目录的 `references/`、`scripts/` 和 `assets/` 一起保留。

| 目标 | 客户端 | 默认技能根目录 |
|---|---|---|
| `cursor` | [Cursor](https://cursor.com/docs/skills) | `~/.cursor/skills/` |
| `copilot` | [GitHub Copilot（VS Code）](https://code.visualstudio.com/docs/agent-customization/agent-skills) | `~/.copilot/skills/` |
| `gemini` | [Gemini CLI](https://geminicli.com/docs/cli/skills/) | `~/.gemini/skills/` |
| `opencode` | [OpenCode](https://opencode.ai/docs/skills/) | `~/.config/opencode/skills/` |
| `windsurf` | Windsurf Cascade | `~/.codeium/windsurf/skills/` |
| `devin` | [Devin Local](https://docs.devin.ai/desktop/devin-local/customizations) | `~/.config/devin/skills/` |
| `generic` | 读取共享目录的客户端 | `~/.agents/skills/` |
| `custom` | 自定义 Agent、项目级安装或其他目录配置 | 客户端实际扫描的技能根目录，例如 Copilot 项目下的 `.github/skills/` |

### 在线命令

也可将 `cursor` 换成 `dsh`、`claude`、`codex` 或上表里的其他目标。`all` 会尝试安装 DSH 和各客户端专用版本。一般只需安装你当前使用的客户端版本。

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/znnw4m6k7k-dotcom/dsh-delivery/main/install-online.sh | sh -s -- cursor
```

指定目录时，把 `cursor` 换成 `custom "/实际路径/skills"`。

**Windows PowerShell**

```powershell
$env:DSH_KIT_TARGET = 'cursor'
irm https://raw.githubusercontent.com/znnw4m6k7k-dotcom/dsh-delivery/main/install-online.ps1 | iex
```

指定目录时，将目标设为 `custom`，再设 `$env:DSH_KIT_SKILLS_DIR = 'C:\实际路径\skills'` 后运行第二行。可以先查看 [Shell 脚本](install-online.sh) 或 [PowerShell 脚本](install-online.ps1)，也可以选离线安装。

## 第一次怎么用

1. 重新加载技能或新建会话。客户端有技能列表时，先确认能看到 `delivery-contract`。DSH 用户在“交付”预设下继续。
2. 复制下面的示例。能读技能的客户端会使用技能。只有聊天功能时，先上传或粘贴 [单文件 Agent](delivery-contract.md)。
3. 预期第一轮收到的是需求问题。你明确确认验收条目后，Agent 才开始实现。

> 请使用 delivery-contract，帮我做一个 CSV 销售汇总工具。开始前先问清楚输入、输出和异常数据怎么处理，再给我确认验收条目。做完说明实际执行了哪些检查，还有哪些待确认。

有独立验收能力时，流程会交给独立 Agent 核对冻结版本。只有当前 Agent 可用时，报告会说明哪些检查是自查，哪些仍缺执行证据。你认可交付后可以说“做复盘”，候选经验逐条确认后才会写入或导出。

## 更新、卸载和反馈

- **更新**：用原来的安装方式装新版。文件版会替换原有的 `delivery-contract/`，网页或应用端可在技能设置中替换。
- **迁移旧版**：如果还装着 `omni-delivery`，在确认新技能可用后移除旧技能，避免重复触发。
- **卸载**：从客户端技能设置移除，或删除安装时的 `delivery-contract/`。DSH 用安装目录里的 `uninstall.sh` 或 `uninstall.ps1`。单独保存的经验包按需保留。
- **反馈**：先查 [安装问题排查](docs/安装问题排查.md)。提交 Issue 时请写上客户端及版本、系统、安装目标和报错，删去 API Key、个人路径及客户数据。[提交安装问题](https://github.com/znnw4m6k7k-dotcom/dsh-delivery/issues/new/choose)

## 开发与许可

DSH 组合包在 `kit/`。Claude 技能是源码，Codex 版和通用版由 `codex-skill/build.py` 生成。测试、同步和发布流程见 [贡献指南](CONTRIBUTING.md)。

本项目是社区作品，与 DeepSeek 或 DeepSeek Harness 官方无关联。采用 [MIT 许可](LICENSE)，第三方声明见 [NOTICE](NOTICE.md)，安装写入范围和安全反馈见 [安全说明](SECURITY.md)。
