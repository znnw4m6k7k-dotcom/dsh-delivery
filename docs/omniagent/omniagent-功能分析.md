# OmniAgent 功能分析

> 分析对象：本机 `/Applications/OmniAgent.app`，版本 `0.6.2-beta.202610241`（Bundle ID `com.sopro.omniagent`，Apple Silicon）
> 方法：只读拆包。前端 `app.asar`（Electron）解出界面代码和多语言文案；后端 `omniagent-server`（Go 1.24 编译）提取字符串；外加内置的 agents / armories / crafts 目录。没有运行程序，也没有联网。
> 日期：2026-10-31

## 一句话定位

OmniAgent 是一个**桌面版"数字交付团队"**：你给一个需求，主 Agent（代号 **Orcus**）把它拆成"调研 → 设计 → 开发 → 集成 → 独立测试 → 交付报告"的流水线，派子 Agent 去做，最后让你像甲方一样"验收 / 提返工"。它主打编程，也能做文档、调研，并带有政务、医疗、法务等行业能力包。和 RedBeacon 不同，它**不是小红书工具**，是通用的 Agent 工作台。

## 架构

| 层 | 内容 |
|---|---|
| 桌面壳 | Electron + React + Tailwind，中/繁/日/英四语 |
| 本地后端 | `omniagent-server`（Go），监听 `127.0.0.1:8080`，HTTP + SSE，SQLite 存储 |
| 更新器 | `omniagent-updater`，OTA 走 `https://43.142.4.194/omniagent`（beta 通道，ed25519 签名校验），镜像 `download.sopro-omni.com` |
| 账号/计费 | `https://43.142.4.194/accounts`，含诊断上报 `/accounts/diagnostics/v1/events` |
| 文档生成 | `crafts/office-docgen` 独立二进制，生成 .docx |

## 核心功能

### 1. 交付流水线（"交付合同"）
- 先做**需求澄清（intake）**：目标、交付物、验收标准、合规环境（互联网 / 政务云 / 涉密内网）。
- 主 Agent 制定**执行计划和待办清单**，阶段依次为：分析需求 → 调研 → 设计与实现 → 统一集成 → **独立测试** → 交付报告。
- 界面有"数字团队"看板：调研组 / 方案组 / 工程组 / 质检组 / 交付组，以及任务流图（React Flow）。
- 支持**暂停 / 继续 / 停止 / 基于已有成果继续**，中断后产物保留。
- 执行中会弹出**业务决策问题**和**问卷**让你回答，不会倒计时自动替你选。
- 完成后进入**验收**：你可以"批准整体交付"或"提出修改反馈"发起返工，返工后重新测试再验收。
- 对项目提问时会区分"修改反馈"和"只读讨论"。

### 2. 内置子 Agent（`backend/agents/`）
| Agent | 用途 | 工具 |
|---|---|---|
| develop | 写代码、调试、测试 | 读写/补丁文件、repo_map、代码检查、git、todo、`verify_run`、`harness_check`、Bash |
| plan | 只读架构分析 | 读文件、repo_map、引用查找、git |
| reviewer | 代码审查 | 同上，只读 |
| research | 联网调研 | web_search、web_fetch、读文件 |
| document | PDF / Word 读写 | doc_read、doc_write |
| vision | 看图分析 | image_analyze |

后端对"验证"管得很严：会识别 `npm test / pytest / go test` 等测试命令，测试没跑或数量对不上就不允许标记"已验证"；同一失败命令不改代码直接重跑会被拦截。

### 3. 锦囊（Armory）能力包
行业/场景人设包，挂在主 Agent Orcus 上，可启用/停用，也能**把这次交付经验沉淀为新锦囊**（默认停用，由你审核后启用）。内置 6 个：

| 锦囊 | 说明 |
|---|---|
| office | 办公写作、邮件、会议纪要，调用 office-docgen 出 Word |
| research | 深度调研、信源核验、文献综述 |
| gov | 政务 FDE：等保 / 信创 / 生成式 AI / 数据安全合规、公文格式 |
| medical | 医疗 FDE：HIS/EMR/LIS/PACS 集成、医疗数据法规，明确"不做诊断" |
| legal-advisor | 合同审阅、合规检查、风险评估 |
| legal-review | 合规审查，要求引用法规名+条号、风险分级 |

政务、医疗、法务三个包还带合规基线检查清单。

### 4. 扩展生态
- **CraftHub**：Craft 智能体市场（搜索 / 推荐 / 安装 / 卸载）。
- **SkillPond**：技能市场（目录 / 安装 / 已安装）。
- **MCP 服务器**：可接入外部 MCP 工具。
- 项目级"能力"面板汇总已启用的 Armory、Craft、技能、MCP。

### 5. 项目记忆
按项目存储决策、偏好、经验教训、参数、产物等记忆。任务结束后自动整理出"系统建议"，**你确认后才生效**；也可以说"记住…"立即保存。支持查看来源、修改历史、回填历史记录。

### 6. 编码工作台细节
- 补丁审阅：隔离子任务产出补丁，可预览 / 应用 / 忽略 / 回滚。
- 检查点撤销 / 重做、工作区快照、Git 状态、诊断（错误/警告数）。
- 斜杠命令：生成 AGENT.md、清空上下文、压缩上下文、交接到新会话、切换模型/Provider、查看成本、记忆等。
- 产物预览：HTML 页面、图片、Markdown、Word；代码高亮、公式（KaTeX）。

### 7. 安全权限
四档：**严格**（每次读写/命令都问）、**标准**、**宽松**、**自主执行**（仅极高危操作确认）。授权弹窗显示风险等级和参数预览，可"仅本次 / 本会话 / 记住"。删除、联网、系统目录、项目外文件在宽松档仍要确认。另有沙箱执行和 CPU 配额。

### 8. 语音输入
Chromium Web Speech 或**本地 Whisper**；内置 Silero VAD 人声检测（onnx 本地跑）；后端也引用了 qwen3-asr。

### 9. 其他
- 依赖下载源：可强制国内镜像（npm/pnpm/yarn/pip/Go，goproxy.cn、hf-mirror）。
- 主题：深夜 / 极地 / 余烬 / 暮色 / 晨曦，可自定义并导入导出 JSON。
- 内置反馈、健康检查（后端/模型/执行/验证四项）。

## 模型与计费

- 设置页当前版本**只开放 DeepSeek**（主力 `DeepSeek V4 Flash`，另有 V4 Pro），API Key 存在本机。界面写着"其他服务商留待后续版本"。
- 后端代码里已经写好了更多适配：Kimi（k2.6 / k2.7-code / k3，含 Moonshot 的 Anthropic 兼容接口）、通义千问（qwen3.6/3.7-plus、qwen3-vl、DashScope）、OpenAI、Anthropic、Gemini、Ollama。搜索用博查 / 必应 / DuckDuckGo。
- 另有一套**平台计费**："欢乐豆"，1 元 = 1 豆，支付宝 / 微信充值，按任务预留、结算、返还，显示每次消费和 Token 用量。后端有 `OMNIAGENT_CLOUD_GATEWAY`，推测是走平台网关时扣豆，自带 Key 时不扣。这一点是从代码推断，没有实际验证。

## 值得注意的点

1. **服务器是裸 IP**（`43.142.4.194`，腾讯云段），OTA、账号、诊断都走它，且 `NSAllowsArbitraryLoads=true`。
2. 打包配置里 `diagnostics.internalTest = true`、`uploadsEnabled = true`：这是内测构建，诊断事件默认会上传。反馈说明里写明"不会自动附带对话或工作文件"。
3. 支付宝有"沙箱测试环境"文案，说明支付链路还在测试期。
4. 版本号带 beta，很多功能（多模态、其他服务商）标注"本期不可用"。

## 和本项目（RedBeacon / xhs-autopilot）的关系

OmniAgent 是通用 Agent 工作台，没有小红书相关功能。可借鉴的设计：
- **独立验收 + 返工**的交付流程，适合用在 xhs-autopilot 的"生成 → 审核 → 发布"环节；
- **锦囊沉淀**（把一次成功的经验存成可复用能力包）和你在 Codex 里用 skill 的思路一致；
- **记忆需人工确认后才生效**的机制。

如果只想用自己的订阅/Key 而不花平台点数，OmniAgent 目前看是支持自带 DeepSeek Key 的，但 GPT/Codex 还不能在设置里选。
