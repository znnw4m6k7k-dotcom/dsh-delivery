# 在 DeepSeek Harness 里复刻 OmniAgent 的交付方式：需要什么

> 依据：只读拆包了你本机的 `/Applications/DeepSeek Harness.app`（`com.deepseek.dsh` v0.2.1-rc.5，nightly 通道），读了里面 35 个官方插件包的 README 和内置的插件开发 skill。对照对象是 [OmniAgent 深度学习笔记](omniagent-深度学习笔记.md)。
> 日期：2026-11-01

## 结论先说

**DeepSeek Harness（下文简称 DSH）的底座比 OmniAgent 更开放，大部分零件已经现成，不需要改它的源码。** 它整个就是一个 Cordis 插件组合：子 Agent、工作流脚本、长期目标、计划模式、技能、MCP、权限预设、防重复提醒都是独立插件，而且官方给了写插件的接口（工具拦截、注入提示词、注入上下文）。

OmniAgent 那套东西拆成三层，在 DSH 里分别这样落地：

| 层 | OmniAgent 怎么做 | DSH 里用什么做 | 工作量 |
|---|---|---|---|
| 提示词层 | Orcus 协作协议、访谈员、QA 提示词 | **Skill（SKILL.md）+ AGENTS.md + Agent 预设** | 只写文字，1–2 天 |
| 编排层 | 计划 → 委派 → 集成 → 独立 QA → 报告 | **workflow 工作流脚本 + subagent + goal** | 写一个 JS 编排脚本，2–3 天 |
| 运行时拦截层 | 后端代码强制：数测试数、拦重复、冻结版本 | **自写一个 Host 插件**（`ctx.tools.guard` / `tools/pre-execute` / `tools/result`） | 要写 TypeScript，约 1 周 |

只做前两层就能得到 OmniAgent 七成的效果；第三层是"不信任模型"的关键，想要真正可靠再做。

---

## 一、DSH 里已经有的零件

| OmniAgent 机制 | DSH 现成插件 | 状态 |
|---|---|---|
| 子 Agent 派活 | `dsh-subagent` + `dsh-tool-subagent`（提供方：本地 spawn/fork、ACP、**Codex**、Claude Code） | 默认开 |
| 子 Agent 不能再派代理 | subagent 设置 `maxDepth`（默认 1，只允许直接子代理） | 默认就是 |
| 计划 → 分阶段执行 | `dsh-workflow` + `dsh-tool-workflow`：用 JS 写 `agent()`、`parallel()`、`pipeline()`、`phase()`，`agent()` 可带 **JSON schema 校验输出** | 默认开 |
| 主 Agent 持续到完成 | `dsh-goal` + `goal-round-driver`：每会话一个持久目标，自动续行，上限 256 轮，可 block | 有 |
| 先出方案再执行 | `dsh-plan-mode`：`/plan` 进入，`exit_plan_mode` 交你批准 | 有 |
| 向用户提业务问题 | `dsh-tool-ask-user` / user-questions | 有 |
| 待办清单 | `dsh-tool-todo` | 有 |
| 锦囊（能力包） | Skill：`~/.agents/skills/<名字>/SKILL.md` 或项目 `.agents/skills/`，热加载，不用重启 | 有 |
| 行业人设 | Agent 预设 `dsh-agent-preset`（一个预设 = 一组插件 + 提示词），会话里可切换 | 有 |
| 项目规则 | `AGENTS.md` / `CLAUDE.md`（全局 `~/.dsh/AGENTS.md`、`~/.agents/AGENTS.md`，项目从根到子目录逐层加载） | 默认开 |
| 防重复调用 | `dsh-repeat-tool-reminder`：同参数重复 3/5/8 次时提醒 | 默认开，但**只提醒不拦截** |
| 安全档位 | `dsh-permission-presets`（沙箱 + 审批）、实验性 `auto-review`（每次工具调用前让模型审一遍） | 有 |
| 多 Agent 团队看板 | 实验性 `agent-team`：具名队友、私信、共享任务板 | 默认关 |
| 循环执行 | 实验性 Ralph | 默认关 |
| MCP | `dsh-mcp-client` | 有 |
| 插件市场/安装 | `plugin_manager` 工具 `install_bundle`，侧边栏插件页 | 有 |

**DSH 没有、需要你补的：**
1. "交付合同"的数据结构（目标、验收标准、冻结版本）；
2. 独立 QA 的强制规则（QA 不能改文件、必须用真实测试、按条目给证据）；
3. 运行时硬拦截（数测试通过数、同版本同命令不许重跑、未验证不许宣称完成）；
4. 需求访谈 → 验收标准草案的流程；
5. 交付报告格式。

---

## 二、具体要做的东西（按优先级）

### 第 1 步：一个"交付协议" Skill（纯文字，最快见效）

放在 `~/.agents/skills/delivery-protocol/SKILL.md`。内容就是把 OmniAgent 的协作协议翻成你的版本：

```markdown
---
name: delivery-protocol
description: 需要交付代码、应用或文档成果时使用。按 计划→实现→冻结→独立验收→报告 的流程执行。
---
1. 先用 todo 写计划：规模、是否需要调研、步骤、验证方式。简单任务自己做。
2. 业务问题用 ask_user 问，给选项和推荐；技术选择自己决定；不把沉默当同意。
3. 实现完成后，把文件清单和验收条目写进 .delivery/contract.json（冻结）。
4. 用 subagent 派一个独立 QA：只读、不许改产品文件、必须跑真实测试命令，按每条验收条目返回证据。
5. QA 没过就修，修完重新冻结、重新验收；不许删掉没过的条目。
6. 最后输出报告：目标、实际做了什么、验证范围、风险、假设、未完成项。没执行过的发布不能写成已完成。
```

再写两个配套 skill：
- `delivery-intake`：访谈员规则（每批只问 1–3 个阻挡开工的业务问题、给选项、技术不问用户），输出验收条目草案，每条带原文引用。
- `independent-qa`：给 QA 子 Agent 用的规则（照抄 OmniAgent 的"独立 QA"那段）。

在 `AGENTS.md` 里加一句"交付类任务先加载 delivery-protocol"。

### 第 2 步：一个"交付" Agent 预设

用 `dsh-agent-preset` 新建预设 `delivery`：启用 workflow、subagent、goal、todo、ask-user、plan-mode，把上面三个 skill 设为可用，`maxDepth: 1`。这样你在会话里切到"交付"预设就进入这套模式，平时不影响。

DSH 自带的 `editing-cordis-compositions` skill 会教 Agent 怎么改预设，你可以直接让 DSH 自己按这份文档改。

### 第 3 步：一个交付工作流脚本（编排层）

DSH 的 workflow 工具允许模型提交一段 JS 编排脚本。可以固定一个模板，让 Orcus 式的流程变成代码而不是靠模型自觉：

```js
phase('plan')
const plan = await agent('按 delivery-protocol 拆分任务……', { schema: PlanSchema })
phase('build')
const results = await pipeline(plan.tasks.map(t => () => agent(t.prompt)))   // 写文件串行
phase('qa')
const review = await agent('你是独立 QA，只读……逐条核对 contract.json', { schema: ReviewSchema })
return { plan, review }
```

`schema` 校验保证 QA 必须按条目返回 `{requirement_id, evidence, pass}`，不是一段自由文字。

### 第 4 步：一个 Host 插件做运行时拦截（真正"不信任模型"）

DSH 官方开放了这些扩展点（来自内置 `cordis-plugin-development` skill 的 practices.md）：

| 扩展点 | 用来实现 OmniAgent 的哪条规则 |
|---|---|
| `ctx.tools.guard()`（同步硬拒绝） | QA 子 Agent 禁止写文件；冻结后禁止改冻结清单里的文件 |
| `tools/pre-execute` 返回 `ask` | 同版本同命令第二次运行时要求你确认；危险命令 |
| `tools/result` 监听 | 解析测试输出里的 passed/failed 数，记进 `.delivery/evidence.jsonl`；数不出来就标"测试数量未确认" |
| `tools/post-execute` | 在测试失败的结果后面追加"不要原样重跑，先改代码"的提示 |
| `ctx.tools.restrict()` | 对 QA 这个 Agent 隐藏写文件类工具 |
| `ctx.systemPrompt.section()` | 注入协作协议常驻段落 |
| `agent.inject()` | 把当前冻结版本号、未通过条目注入下一步上下文 |
| `turn/end` 事件 | 结束时检查：有改动但没有通过的证据，就提醒不能宣称完成 |

写法：在一个工作目录里写插件包（`package.json` + `cordis.patch.yml` + `lib/`），然后让 DSH 用 `plugin_manager install_bundle` 装到当前 profile。DSH 自带的 `cordis-plugin-development` skill 有模板和步骤，可以让 DSH 自己帮你写。

建议的插件功能清单（照 OmniAgent 的后端规则）：
1. `delivery_freeze`：记录文件哈希，生成版本号；
2. `verify_run` 包装：区分 `delivery` 和 `diagnostic`，只认真实测试命令（拒绝 `node -e`、`echo`）；
3. 同版本 + 同命令 + 同结果 → 拦截；
4. 只看不改循环 → 在 `tools/post-execute` 追加提示；
5. `delivery_complete`：没有当前版本的通过证据就拒绝。

---

## 三、模型和成本要注意

- DSH 默认走 DeepSeek 账号或 DeepSeek API Key，会产生 DeepSeek 费用。
- 项目记忆里记着你只想用 GPT 月订阅。DSH 的子 Agent 支持 **Codex 提供方**，理论上可以让写代码和 QA 的子 Agent 走 Codex，主 Agent 走 DeepSeek。但 Codex/Claude Code 提供方是"执行一次"型，不能接后续消息，返工时得重新派。这一点还没实测。
- workflow 默认一次最多 1000 个子 Agent，跑交付流程前建议把 `maxTotalAgents` 调小（比如 20），防止烧钱。

## 四、建议顺序

1. **今天就能做**：写 `delivery-protocol`、`delivery-intake`、`independent-qa` 三个 skill，放进 `~/.agents/skills/`。
2. **这周**：建 `delivery` 预设 + 固定工作流模板，拿一个小项目试跑。
3. **试跑满意后**：写 Host 拦截插件，把"自觉"变成"强制"。

如果你要，我可以先把第 1 步的三个 skill 写好，直接放进你电脑的 `~/.agents/skills/`。
