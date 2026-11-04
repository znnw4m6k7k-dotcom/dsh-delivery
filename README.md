# 交付模式（dsh-delivery）

让 AI 像靠谱的项目经理一样**交付成果**，而不是随手回答：先问清楚需求，和你确认验收标准，再计划、动手、交给一个独立的 QA 逐条验收，最后给你一份诚实的报告。项目结束后可以复盘，把**经你确认**的经验存进行业经验包，下一个同行业项目自动用上。

支持三种工具：

| 用在哪 | 装什么 | 系统 |
|---|---|---|
| DeepSeek Harness（DSH） | 交付模式组合包：交付预设 + 5 个技能 + 运行时守卫 + 交付工作台 | macOS、Windows |
| Claude（claude.ai、Claude App、Claude Code） | `omni-delivery` 技能 | 全部 |
| Codex | `omni-delivery` 技能（Codex 版） | 全部 |

不需要注册任何账号。在 DSH 里用，模型费用走你自己的 DeepSeek API Key。

---

## 安装（DSH）

先安装并**打开一次** DeepSeek Harness，然后任选一种方式：

**方式一：复制一行命令（推荐）**

Mac：打开“终端”，粘贴回车
```sh
curl -fsSL https://raw.githubusercontent.com/znnw4m6k7k-dotcom/dsh-delivery/main/install-online.sh | sh
```

Windows：打开“PowerShell”（开始菜单搜 PowerShell），粘贴回车
```powershell
irm https://raw.githubusercontent.com/znnw4m6k7k-dotcom/dsh-delivery/main/install-online.ps1 | iex
```

**方式二：下载后双击**

1. 到 [Releases](https://github.com/znnw4m6k7k-dotcom/dsh-delivery/releases) 下载 `dsh-delivery-kit.zip`（或本页绿色按钮 Code → Download ZIP）。
2. **全部解压**。
3. Mac 双击 `Install-Mac.command`（第一次提示无法打开时：右键 → 打开）；Windows 双击 `Install-Windows.bat`（弹出蓝色提示时：更多信息 → 仍要运行）。

**方式三：让 DSH 自己装**

在 DSH 新会话里粘贴：
```
请帮我安装“交付模式”插件：如果是 Mac，在终端运行 curl -fsSL https://raw.githubusercontent.com/znnw4m6k7k-dotcom/dsh-delivery/main/install-online.sh | sh ；如果是 Windows，在 PowerShell 运行 irm https://raw.githubusercontent.com/znnw4m6k7k-dotcom/dsh-delivery/main/install-online.ps1 | iex 。只运行这一条命令，不要自己修改 ~/.dsh 里的文件。把输出原样告诉我；如果最后提示“组合包没有注册成功”，就按提示用 plugin_manager 的 install_bundle 安装它给出的目录。
```

**装好以后**
1. 完全退出 DSH 再打开（Mac 按 Cmd+Q；Windows 在右下角托盘图标右键“退出”）。
2. 第一次用：欢迎页选“添加 API Key”，填你在 DeepSeek 开放平台充值后创建的 Key。
3. 新建会话，预设显示“交付”就装好了。也可以输入 `/delivery-doctor` 自检。

装不上？看 **[安装问题排查](docs/安装问题排查.md)**，里面按提示文字列了所有常见情况。

## 安装（Claude / Codex）

- **claude.ai / Claude App**：在 [Releases](https://github.com/znnw4m6k7k-dotcom/dsh-delivery/releases) 下载 `omni-delivery-claude.zip`，到 设置 → 功能 → 技能 → 上传。
- **Claude Code**：Mac `curl -fsSL https://raw.githubusercontent.com/znnw4m6k7k-dotcom/dsh-delivery/main/install-online.sh | sh -s -- claude`；Windows 先运行 `$env:DSH_KIT_TARGET='claude'`，再运行上面的 PowerShell 安装命令。
- **Codex**：同上，把 `claude` 换成 `codex`。

详细说明：[Claude 版](claude-skill/安装说明.md)、[Codex 版](codex-skill/安装说明.md)。

## 怎么用

- 直接说你要交付的成果：“帮我做一份 XX 行业的 XX 方案”“做一个 XX 小工具”。
- 它会先问几个业务问题，列出验收条目请你确认，确认后才开工。
- 做完会交给独立 QA 逐条验收。默认标准深度；你可以说“快速验收”（更快）或“深度验收”（更严）。
- 你认可交付后说“做复盘”。它会列出候选经验，**每条都要你确认**才写进行业经验包（`~/.agents/skills/industry-<行业>/`）。经验会去掉客户名称等可识别信息，旧经验只标记“已被取代”，不会删除。

## 更新和卸载

- 更新：再运行一次安装。
- 卸载 DSH 版：Mac `sh ~/.dsh-delivery-kit/uninstall.sh`；Windows `powershell -ExecutionPolicy Bypass -File "$HOME\.dsh-delivery-kit\uninstall.ps1"`。行业经验包会保留。

## 给开发者

- `kit/`：DSH 组合包。`kit/skills/` 是 5 个技能，`kit/bundle/index.js` 是守卫，`kit/install.*` 是安装脚本。
- `claude-skill/omni-delivery/`：Claude 技能；`codex-skill/omni-delivery/` 由 `codex-skill/build.py` 生成，不要手改。
- 测试：`node --test "kit/tests/*.test.mjs"`、`python3 -m unittest discover -s claude-skill/tests`、`python3 -m unittest discover -s codex-skill/tests`、`sh kit/tests/installer.test.sh`（Windows：`kit\tests\installer.test.ps1`）。每次提交都会在 GitHub Actions 的 macOS、Windows、Linux 上跑一遍。
- 发布：打 `v*` 标签后自动生成三个 zip 放到 Releases。
- 约束：不修改 DSH 源码，只用技能、预设和插件扩展。

## 声明

本项目是社区作品，与 DeepSeek 及 DeepSeek Harness 官方无关联，也不包含或修改 DSH 程序本身。“DeepSeek”是其所有者的商标，这里只用来说明兼容对象。代码以 [MIT 许可](LICENSE) 开源。
