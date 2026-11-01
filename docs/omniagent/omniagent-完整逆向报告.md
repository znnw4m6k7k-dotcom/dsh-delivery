# OmniAgent 完整逆向报告

> 对象：`/Applications/OmniAgent.app` v0.6.2-beta.202610241（macOS arm64）
> 方法：只读静态分析，没有运行程序，没有联网。
> - 后端 `omniagent-server` 是 Go 1.24.4 编译的，**没有去掉符号表**，所以能用 `go tool nm` 和 `go version -m` 读出完整的包名、源文件名、函数名和依赖列表；
> - 长字符串（提示词、SQL、JSON Schema）在二进制里是连续存放的，可以直接提取原文；
> - 前端 `app.asar` 解包后读界面文案和调用逻辑。
>
> 配套文件：[提示词原文摘录](omniagent-提示词原文摘录.md) · [工具参数原文](omniagent-工具参数原文.txt) · [深度学习笔记](omniagent-深度学习笔记.md) · [功能概览](omniagent-功能分析.md)
> 日期：2026-11-01

---

## 1. 身份

| 项 | 值 |
|---|---|
| 产品名 | OmniAgent（Bundle ID `com.sopro.omniagent`，公司推测是 SoPro / sopro-omni.com） |
| 源码仓库 | `github.com/DWang-SoPro/OmniAgent`（私有，Go module 路径里写的） |
| 主 Agent 代号 | **Orcus** |
| 内部运行时代号 | **Fanxing**（"繁星"），固定配置叫 `fanxing-flash-production-v1`，旧版本号 `0.6.0-fanxing-alpha` |
| 定位 | "FDE 数字交付团队"。源码注释里反复出现 "M1/M2/M4 FDE-team redesign"，FDE = Forward Deployed Engineer（驻场交付工程师），目标客户是政务、医疗、法务等行业的交付团队 |
| 构建 | Go 1.24.4，CGO 开启，`-trimpath`；前端 Electron + React 18 + Vite，pnpm 9 |

## 2. 进程架构

```
OmniAgent.app (Electron 主进程, out/main/main.js)
 ├─ 启动/守护 backend/omniagent-server  (Go, 127.0.0.1:8080, HTTP + SSE + WebSocket)
 │    ├─ SQLite: omniagent.db  (modernc 纯 Go 驱动, goose 迁移)
 │    ├─ 配置: omniagent.toml, servers.toml (MCP), .env
 │    ├─ 子进程: bash / 测试命令 (沙箱), MCP servers, whisper.cpp, LSP (pyright 等)
 │    ├─ crafts/office-docgen (独立 Go 二进制, 生成 docx)
 │    └─ 出站: 模型 API, 搜索 API, 云网关 (OMNIAGENT_CLOUD_GATEWAY)
 ├─ backend/omniagent-updater  (OTA, ed25519 验签)
 └─ 渲染进程 (React)  ⇄ 本地后端，带 X-Local-Token 鉴权（只发给回环地址）
```

Electron 主进程只暴露很少的 IPC：启动/停止后端、取本地 token、选文件夹、更新器、诊断开关、提交反馈。**所有业务都在 Go 后端里**，前端只是界面。

主要 Go 依赖：chi（路由）、viper + go-toml（配置）、goose（迁移）、modernc sqlite、santhosh-tekuri/jsonschema（工具参数校验）、mvdan.cc/sh（**解析 bash 语法树做安全检查**）、goquery + html-to-markdown（网页抓取）、ledongthuc/pdf、docxgo（Word）、fsnotify。

## 3. 后端模块地图

从符号表还原，括号里是该包能看到的函数数量。

### 3.1 `internal/core/agent`（393）：Agent 主循环
| 文件 | 作用 |
|---|---|
| `loop*.go` | 主循环：调模型 → 解析工具调用 → 执行 → 回填结果 |
| `router.go`, `routing_prompt.go` | 按任务选路由和模型 |
| `architect.go` | 架构师模式：先产出 JSON 计划，再逐步执行 |
| `subagent*.go`, `subtask_scheduler*.go` | 子 Agent 派发、依赖调度、**Git worktree 隔离执行** |
| `subagent_patch_apply_tool.go` | 把隔离子任务的补丁预览/应用/回滚到主仓库 |
| `convergence.go`, `repetition.go` | 检测"不收敛""重复调用"，注入纠偏提示 |
| `finalization.go`, `completion_recovery.go` | 收尾模式（禁止再调工具）、没正常结束时的恢复 |
| `protocol_recovery.go` | 模型输出的工具调用格式坏了时的修复 |
| `harness_middleware.go`, `verification_warning.go` | 验证纪律：没验证就不能宣称完成 |
| `task_contract.go` | 编码任务合同（目标文件、禁止文件） |
| `questionnaire.go` | 向用户发问卷 |
| `memory_remember.go`, `recall_injection.go` | "记住…"即时保存、把相关记忆注入提示词 |
| `replay_context.go`, `runtime_journal.go` | 断点续跑时重建上下文 |
| `pause.go`, `user_stop.go`, `permission_decline.go` | 暂停、用户停止、权限被拒后的行为 |
| `formation_shadow.go` | "编队影子运行"：对比实际运行和声明的配置是否一致 |
| `hooks.go` | 调用 Hook 系统 |
| `work_efficiency.go` | 统计耗时、工具次数 |
| `worker_prompt.go` | 子 Agent 提示词模板 |

### 3.2 `internal/core/delivery`（187）：交付流水线（核心卖点）
| 文件 | 作用 |
|---|---|
| `pipeline.go`, `phases.go` | 阶段：planning → research → build → integration → testing → report |
| `execution*.go` | 执行生命周期、控制（暂停/继续/停止）、就绪检查、主 Agent 提示词 |
| `execution_tools.go` | 主 Agent 专用工具 `delivery_*` |
| `acceptance*.go` | 验收基线、验收管线 |
| `qa_suites.go`, `qa_review*.go`, `qa_history.go`, `qa_retry_progress.go`, `qa_command_changes.go` | 独立 QA：冻结套件、审查证据、重试必须说明理由、测试命令变更审计 |
| `file_scope.go`, `scope_commands.go`, `sensitive_files.go` | 文件范围冻结、敏感文件（密钥等）排除 |
| `artifact_baseline.go`, `artifact_consent.go` | 纯文档交付只做文件检查时，必须征得用户同意 |
| `release_gaps.go` | "已通过但上线前仍有待办" |
| `research_allowance.go` | 调研预算（唯一有上限的部分） |
| `armory_records.go` | 本次用了/沉淀了哪些锦囊 |
| `runtime_state.go`, `verification_state.go`, `worker_runtime_facts.go` | 运行状态和给子 Agent 的事实 |
| `workbench.go` | 前端"交付工作台"的数据 |
| `efficiency.go` | 各 Agent 耗时、费用估算 |

### 3.3 `internal/core/contract`（53）：交付合同
`interview.go`（需求访谈）、`acceptance_draft.go`（验收标准草案）、`research_budget.go`、`title.go`（自动起标题）、`service.go`（状态流转）。

### 3.4 `internal/core/tool`（526）：工具实现
见第 5 节。另有：`bash_parser.go`（用 mvdan/sh 解析命令做安全检查）、`workspace_guard.go`（工作区边界）、`ignored_backup*.go`（改 .gitignore 里的文件前先备份）、`test_command_preflight.go` / `test_observation.go`（测试命令预检、解析测试输出数通过数）、`verification_evidence.go`（证据 id）、`web_doh_*.go`（网页抓取走 DoH 解析并拦截内网地址，防 SSRF）、`package_registry_probe.go`（探测 npm/pip 源速度决定是否用国内镜像）。

### 3.5 其他核心包
| 包 | 作用 |
|---|---|
| `permission`（89） | 权限检查：规则、自主等级、会话级记忆、递归删除检测、git 元数据保护、锦囊保存授权 |
| `workspace`（84） | **改动记录**：在工作区建隐藏 git 记录每次改动（`.omniagent-recording-*`），支持撤销重做；敏感文件不进记录 |
| `session`（60） | 会话、历史、待处理权限、任务投影 |
| `formation`（46） | "编队"：一组模型 + 工具 + 角色绑定的不可变配置，算摘要做对比审计 |
| `hook`（42） | Hook 系统（见 9.4） |
| `guardrail`（34） | 输入输出护栏：提示注入检测、PII（个人信息）检测、长度限制、语义检测 |
| `armory`（33） | 锦囊：加载器、叠加层、缓存、composer（把锦囊提示词拼进系统提示） |
| `repomap`（32） | 仓库地图（类 Aider 的 repo map，按 token 预算排序重要文件） |
| `craft`（25+13） | Craft：本地 hub、内置 craft、**A2A 协议客户端**（可调用远程 Agent） |
| `lsp`（21） | LSP 客户端（重命名符号、诊断、code action） |
| `checkpoint`（20） | 检查点、diff、恢复 |
| `billing`（20） | 许可证：激活/停用/校验/套餐等级/过期 |
| `compress`（18） | 上下文压缩：自适应阈值、熔断、分类、摘要提示词 |
| `memory`（17） | 记忆提取（LLM）、事实库、生命周期、画像、敏感信息过滤、触发器 |
| `intent`（12） | 意图分类、对话路由 |
| `skill`（12） | 技能加载（目录 `.omniagent/skills`） |
| `modelrouting`（10） | Orcus 路由表、模型档案 |
| `cost` | 价格表、每次运行用量 |

### 3.6 基础设施
`llm/*`（OpenAI 兼容、Anthropic、Gemini、Ollama、Qwen 特殊处理、重试、降级、强制模型、用量回执）、`modeladapter`（统一 OpenAI/Anthropic 编解码、SSE、工具参数校验）、`modelcap`（模型能力注册表）、`llmfactory`、`netproxy`（读 macOS 系统代理）、`sandbox`（受权限保护的本地执行、凭据隔离、输出截获、包镜像、验证环境、内存/进程数限制）、`speech`（whisper 下载与进程管理）、`cloudbridge`（云网关：准入、传输、暂停原因）、`store`（SQLite 各表存储，sqlc 生成查询）。

### 3.7 `cmd/omniagent-server`（main 包）
`delivery_dispatcher.go`（派发子 Agent）、`delivery_worker_policy.go`（子 Agent 权限）、`delivery_model_bundle.go`（交付用模型组合）、`delivery_recovery_check.go`、`delivery_run_receipt.go`（运行回执）、`browser_runtime.go`（真实 Chromium 探测）、`cloud_models.go`、`benchmark_model_compare.go`（模型对比评测）、`usage_recording.go`、`vision_tools.go`、`product_scope.go`。

---

## 4. 交付流水线（状态机）

### 4.1 一个任务的完整流程

```
用户需求
  │
  ▼
[需求访谈] interview：LLM 生成 1–3 个业务问题/批（goal|scale|data|compliance|deliverables）
  │            用户回答（可跳过，用默认假设）
  ▼
[验收标准草案] acceptance_draft：每条带原文引用，用户在预览里确认
  │
  ▼
[交付合同] contracts 表：goal, acceptance_criteria, deliverables, compliance_class(互联网/政务云/涉密内网), budget_tokens, armory_ids
  │
  ▼
[Orcus 主 Agent 执行]  ── 工具：delivery_plan / delivery_delegate / delivery_decision /
  │                          delivery_integrate / delivery_test / delivery_complete / armory_manage
  │   planning   → delivery_plan(reason, research=needed|skip, verification=independent|artifact, steps, assumptions, test_commands)
  │   research   → 委派 research 子 Agent（最多 3 个并行，唯一有预算上限）
  │   build      → 自己做，或委派 develop/design/document（写文件串行）
  │   ↕ delivery_decision(ask/read/wait)：业务问题，不倒计时，不代答
  │   integration→ delivery_integrate：冻结当前版本（文件哈希 + 范围）
  │   testing    → 后端自动按 test_commands 逐个派独立 QA
  │                QA 用 delivery_verify_suite / verify_run(purpose=delivery)
  │                QA 交 delivery_review：每条验收 {requirement_id, status, evidence}
  │                + must_fix + suggestions + release_status(ready|blocked|not_assessed) + release_gaps
  │   失败 → 修 → 重新 integrate（同版本同命令不得原样重派）
  │   report     → delivery_complete：目标、复用、结果、验证范围、风险、假设、未完成项
  ▼
[用户验收] 批准整体交付 / 提交修改反馈 → 新一轮返工
```

### 4.2 前端可见的状态
- 执行状态：`running / completed / pending / failed / cancelled / interrupted / pausing / paused / stopping / stopped / blocked / awaiting_decision`
- 项目卡片状态：`working / needs_input / plan_approval / review / accepted / failed / idle`，细分 `stage_planning … stage_report`、`decision`、`permission`、`recommendation`
- 验收缺口（后端给出 next_action）：`plan_required`、`integration_required`、`tests_required`、`test_counts_required`、`revision_changed`、`decision_required`、`artifact_review_required`、`qa_requires_attention`、`report_required`、`report_recorded`

### 4.3 关键的"硬规则"（后端强制，不靠模型自觉）
- 正式测试入口不能放在 `.omniagent-tmp/`；
- `node -e`、`node --check`、`kind=custom` 不算验收；
- 测试数量数不出来 → `test_count_unknown`，不能标通过（连 pytest 的 xfail 都单独处理）；
- 冻结后文件变了 → `test_revision_changed`，必须重新 integrate；
- 重跑失败的 QA 必须给 `retry_reason`，且"理由文字本身不能授权重复"；
- 改测试命令必须说明变更（`test_command_change_reason_required`）；
- QA 改了范围外的文件 → 由主 Agent 撤回，QA 只报告；
- 需求或反馈变了 → 需要重新确认验收方式（`artifact_consent_required`）；
- 进程执行环境不可用 → `execution_runtime_blocked`，不能靠改命令或静态审查绕过。

---

## 5. 工具全表（32 个）

参数后面带 `*` 表示必填。完整参数说明见 [工具参数原文](omniagent-工具参数原文.txt)。

### 5.1 主 Agent 交付工具（`delivery.executionTool`）
| 工具 | 参数 | 说明 |
|---|---|---|
| `delivery_plan` | reason*, research*(needed/skip), verification*(independent/artifact), steps*, assumptions, test_commands | 保存/更新执行计划 |
| `delivery_delegate` | tasks*[ {id*, role*(research/design/develop/document), task*, complexity(normal/high), depends_on} ]，最多 3 个 | 派子 Agent；high 走 Kimi K3 |
| `delivery_decision` | action*(ask/read/wait), id, question, reason, options, recommended, before_tasks, required | 业务决策提问 |
| `delivery_integrate` | — | 冻结版本，自动派 QA，返回验收状态 |
| `delivery_test` | task*, command*, retry_reason | 补派某个领域的 QA |
| `delivery_complete` | report* | 提交交付报告 |
| `delivery_status` | — | 查看状态 |
| `delivery_review`（QA 用） | requirements*[{requirement_id, requirement*, status*(passed/failed/unverified), evidence*}], must_fix*, suggestions*, release_status*, release_gaps* | QA 结构化审查 |
| `delivery_verify_suite`（QA 用） | suite_id | 运行冻结的测试套件 |

### 5.2 编码工具
| 工具 | 参数 | 亮点 |
|---|---|---|
| `file_read` | path*, offset, limit | |
| `file_write` | path*, content*, overwrite_dirty | 默认不许覆盖有未提交改动的文件 |
| `file_patch` | path*, old_text*, new_text*, expected_replacements, file_sha256_before, old_text_sha256, anchor_text, anchor_sha256, symbol_name, symbol_kind | **用 SHA-256 防止改过期文件**；可限定在某个函数范围内替换 |
| `file_list` | path*, pattern, recursive | |
| `repo_map` | path*, token_budget(默认 4000), focus, include_tests | 按任务焦点排序的仓库地图 |
| `code_inspect` | path*, mode(overview/diagnostics/symbols/references), backend(auto/lsp/static), query | |
| `find_references` | path*, file, query, line, column, backend | |
| `rename_symbol` | path*, …, new_name*, apply | LSP 重命名 |
| `code_action` | path*, file*, line…, kind, apply | LSP quickfix / organizeImports |
| `workspace_diagnostics` | path*, backend | |
| `git_inspect` | path*, operation*(status/diff/log), file, staged, limit | 只读 git |
| `edit_contract` | path*, task_hint, target_files, target_symbols, allowed_files, forbidden_files, related_tests, verification_commands, proposed_edits | **改代码前先锁定改动范围**（TS/JS 任务要求先调用） |
| `verify_plan` | path*, changed_files, task_hint | 推荐验证命令（只读，不能当测试回执） |
| `verify_run` | command*, kind*(test/build/lint/typecheck/custom), reason*, purpose(delivery/diagnostic), diagnostic_question, readiness{implementation_complete, static_review, files[{path, status(edited/not_needed)}]}, cwd, timeout | **核心**：跑验证并生成证据 id；delivery 前必须声明实现已完成并做过静态审查 |
| `harness_check` | summary*, change_status(changed/not_needed/blocked), verification*[{evidence_id, kind, status, output_summary}], remaining_risks | 收尾声明，必须附证据 |
| `todo_write` | items*[{id*, content*, status*, kind(investigation/implementation/verification/other)}] | kind 用于交付就绪检查 |
| `Bash` | command*, background, timeout(默认 30s), cwd | 后台模式返回进程句柄 |
| `process_read` / `process_cancel` | process_id*, offset, wait_ms | 长任务输出 |
| `output_read` | id*, offset, limit | 读被截断的长输出 |

### 5.3 其他工具
| 工具 | 参数 |
|---|---|
| `web_search` | query*, max_results(≤20)；后端博查 / 必应 / DuckDuckGo / SearXNG |
| `web_fetch` | url*, format(text/markdown/html)；DoH 解析 + 内网地址拦截 |
| `doc_read` / `doc_write` | path*, content*（Markdown 风格转 docx） |
| `image_analyze` | path*, prompt*；每次上传外部视觉服务都要用户确认 |
| `capability_read` | kind*(skill/armory/craft), id |
| `armory_manage` | action*(use/save), id*, name, description, instructions, evidence, skills, crafts |
| `craft_execute` | craft_id*, input* |
| `mcp_list_tools` / `mcp_call` | server / name*, arguments* |
| `subagent_dispatch` | max_parallel(默认 2), subtasks*[{id*, agent_name*, task*, route, depends_on, isolated}] |
| `subagent_patch_apply` | patch_path*, base_ref, allow_base_mismatch, action(preview/apply/rollback) |
| `echo` | 调试用 |

`subagent_dispatch` 的 `route` 可选值就是完整的路由表：`coding.complex, model.router, coding.default, coding.implement, coding.edit, coding.mcp-heavy, coding.fast-fix, coding.long-context, coding.review, coding.test-repair, coding.repo-wide-refactor, coding.budget, repo.scan, planning.decompose, summary.memory, repo-wide, benchmark, vision.analyze`。

---

## 6. Agent 主循环内部机制

1. **意图分类**（可选 `router.enabled`）：把输入分成 execute / explore / clarify / refuse / defer / chunk / handoff，同时判断要不要规划、能否并行、会不会改文件。
2. **架构师模式**（`architect.enabled`）：先让模型输出 `{objective, steps[]}`，再逐步执行（"You are executing one plan step"）。
3. **上下文管理**：`agent.context_max_messages` 上限；`compression.*` 自适应压缩，带熔断；摘要器提示词 "Output ONLY the <summary> block"；DeepSeek 的推理内容（reasoning_content）会单独存档用于回放（迁移 00013）。
4. **纠偏注入**（都是运行时自动插进对话的提示）：
   - 重复调用：参数、结果、工作区版本都没变 → 提示换方法；
   - 验证不收敛：同一命令失败多次 → 要么改代码，要么报告阻塞；
   - 只看不改：反复 file_list/repo_map → 强制停止；
   - 验证通过后：提示立刻 harness_check 并停止，不要再跑。
5. **收尾模式**：`agent.finalization_reserve_messages` 预留几轮，进入后 "do not call tools"。
6. **完成恢复**：模型没正常收尾时，检查缺哪一步，只提示缺的那一步；"重复同样的完成方式仍会失败"。
7. **子任务隔离**：`isolated=true` 时子 Agent 在独立 git worktree 里跑，产出补丁文件，主 Agent 预览后再合并。

---

## 7. 模型层

| 路由/角色 | 模型 | 备注 |
|---|---|---|
| 默认 / 普通任务 | DeepSeek V4 Flash（`DEEPSEEK_V4_FLASH_API_KEY`） | 设置页唯一开放 |
| 编码实现、MCP 密集、全仓重构 | DeepSeek V4 Pro | 各有一段 Route policy |
| 复杂子任务（complexity=high） | Kimi K3 | |
| 备用（非编码、长上下文） | Kimi K2.6 | 仅主路由不可用时 |
| 基准观察 | Kimi K2.7 Code | "未稳定前不进生产" |
| 看图 | DeepSeek V4.1 Flash / Qwen3 VL Flash | 置信度 + `[?]` |
| 语音 | 本地 whisper.cpp、qwen3-asr | |
| 代码里有适配但未开放 | Qwen 3.6/3.7 Plus（DashScope）、OpenAI、Anthropic（含 Moonshot 的 Anthropic 兼容接口）、Gemini、Ollama | |

"编队"（formation）概念：把"哪个角色用哪个模型、哪些工具"打包成不可变配置并计算摘要，运行时做影子对比，记录不一致（`MismatchRecorder`），用于防止配置漂移、做 A/B 评测。

推理强度可配：`delivery_reasoning` 只能 low 或 high；有 `effort-low / effort-max` 测试标记。

---

## 8. 记忆系统（三代并存）

| 代 | 表 | 说明 |
|---|---|---|
| 第一代（已弃用迹象） | `memories`, `memory_links`, `dream_cycles`, `entities`, `entity_links` | "Dream consolidation"：周期性整理记忆，阶段 orient → gather → consolidate → precompute → prune；还有图记忆（人/项目/技术/概念）和向量 embedding |
| 当前 L1 | `memory_facts`, `memory_jobs`, `memory_policies`, `memory_revisions`, `memory_suppressed`, `memory_usage` | 结构化事实，类型 decision/preference/pitfall/param/artifact；带内容哈希、置信度、来源、修订号；状态 pending → active/applied/rejected |
| 当前 L2 | `message_search_index`（SQLite FTS5） | 全文检索历史消息，用于召回 |

流程：任务结束 / 决策记录 / 合同变更 / 用户纠正 → 写入 `memory_jobs` 队列 → LLM 提取引擎对比已有事实输出 ADD/UPDATE/DELETE → 用户确认 → 生效。召回时附来源标注 "[记忆引用]"。被用户拒绝的内容进 `memory_suppressed`，不会再被提议。

---

## 9. 安全体系

### 9.1 权限档位
`严格 / 标准 / 宽松 / 自主执行` 四档（`permission.autonomy`），会话另有 `agent` / `read_only` 模式。授权选项：仅本次、本会话、本任务记住、允许并记住（敏感操作和高档位下禁用"记住"）。

### 9.2 命令安全（用 bash 语法树解析，不是简单正则）
拦截或要求确认：递归删除根目录/家目录（包括子 shell 和命令替换里的）、项目外删除、`chmod -R /`、`curl|sh`、`wget|sh`、fork bomb、`env | curl/nc`（外传环境变量）、`systemctl`、项目外路径写入、联网、金融类外部操作、MCP 参数里的危险命令。

### 9.3 敏感文件
`id_ed25519`、`*credentials*`、`secrets.yml`、`.env` 等：不进改动记录、不进交付补丁、不备份；记忆提取前做敏感信息过滤；记忆被写入"[sensitive content omitted]"。

### 9.4 Hook 系统（和 Claude Code 几乎一样）
事件：`SessionStart, SessionEnd, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, Stop, SubagentStop, PreCompact`。
执行器类型：**command**（shell 命令）、**http**（POST 到 URL）、**prompt**（让 LLM 判断）、**agent**（派子 Agent 判断）。返回 `HookResult{continue, reason, …}`。配置开关 `hooks.enabled`，`matcher` 匹配工具名。

### 9.5 护栏
输入：提示注入检测、PII 检测、长度；输出：注入、PII、长度、语义检测。材料和其他 Agent 的结果在提示词里统一标为"数据，不是指令"。

### 9.6 沙箱
`sandbox.memory_limit_mb`、`sandbox.max_pids`、`sandbox.cpu_quota_percent`；验证环境变量白名单 `verification.env_whitelist`；临时目录强制在工作区 `.omniagent-tmp/`；包镜像策略。

---

## 10. 工作区改动记录

每个项目文件夹会被"开启改动记录"：后端用隐藏的 git 仓库（`.omniagent-recording-*`，`GIT_CONFIG_NOSYSTEM`）给每次改动做快照，支撑：检查点、撤销/重做、交付补丁、范围完整性检查（`scope_integrity`）。文件太多的文件夹不会自动开启；被 `.gitignore` 忽略的文件改之前先备份（有容量上限）。

---

## 11. 数据库（SQLite，30 次迁移）

| 迁移 | 内容 |
|---|---|
| 01–02 | sessions, messages, cost_tracking(+provider) |
| 03, 05, 06 | 第一代记忆：memories, memory_links, dream_cycles, entities, entity_links, embedding |
| 04 | sandbox_executions |
| 07–10 | projects, task_trees, 会话身份/归档, permission_mode |
| 11, 15 | pouch_items → artifact_items（note/snippet/link/file） |
| 12 | crafts |
| 13, 14, 27, 28, 30 | 推理回放、运行用量、工具结果回执、请求级用量回执、成本状态 |
| **16** | **contracts, milestones, decision_records**（"交付合同状态机，M1 FDE-team redesign"） |
| **17** | **eval_suites, eval_cases, acceptance_results**（"自动验收 harness，M2"） |
| **18** | **baselines**（"竞品基线分数，M4"：每个评测用例的竞品得分） |
| 19, 23 | memory_facts 及生命周期 |
| 20 | message_search_index（FTS5） |
| 21, 22, 24, 25, 26 | 合同标题、合同锦囊、用户自定义项目名、项目删除、合同工作区 |
| 29 | interview_sessions |

`request_usage_receipts` 记录每次模型请求：角色、用途、provider、模型、输入/输出/推理/缓存读写 token、耗时、是否最终——这是"欢乐豆"计费和效率面板的数据源。

---

## 12. 本地 HTTP API（约 130 个处理函数）

按领域归类（函数名即接口语义）：

- **项目**：List/Create/Get/Update/Delete/OpenProject、GetProjectDiagnostics、GetProjectGitStatus、InitializeProjectGit、GetProjectExpertise
- **会话/消息**：List/Create/Get/Delete/Archive/Restore/RenameSession、GetSessionMessages、SendMessage、StopMessageRun、UpdateSessionAutonomy、UpdateSessionPermissionMode、SubscribeEvents（SSE）
- **合同**：List/Create/Get/Update/Delete/RenameContract、ApproveContract、TransitionContract、Start/Get/AnswerContractInterview、GetContractProposal、GetContractResearch、GetContractTeam、Add/List/AcceptContractMilestone、AppendContractDecision、ListContractDecisions、ListContractSubagents
- **交付执行**：Start/Get/Cancel/ControlDeliveryExecution、AnswerDeliveryDecision、AcceptExecution、SubmitExecutionFeedback、ListExecutionArtifacts、ReadExecutionArtifact(Image)、Start/ServeExecutionPreview（本地预览站点）
- **检查点**：Create/List/Restore/Undo/RedoCheckpoint、GetCheckpointDiff、GetTaskDiff、HandleSubagentPatchApply
- **权限/问卷**：RespondToPermission、Get/RespondToQuestionnaire
- **记忆**：List/Create/Update/DeleteMemoryFact、ReviewMemory、GetMemoryHistory/Source/Overview/Profile、UpdateMemoryPolicy、BackfillProjectMemory、RetryProjectMemory、TriggerMemoryExtract
- **能力**：ListSkills、ListInstalledSkills、SkillPond（Catalog/Install/Status）、Crafts（List/Install/Uninstall/Featured/Search/GetHubCraft）、Armories（List/Enable/Disable）、MCP（List/Start/Stop）、GetCapabilities
- **配置/模型**：Get/UpdateLLMConfig、Get/UpdateModelProfile、TestModelProfileConnection、PackageMirrorSettings、GetConfig
- **语音**：PrepareSpeech、SpeechStatus、CancelSpeechSetup、TranscribeSpeech
- **其他**：ClassifyIntent、RouteConversation、ExtractDocument、ImportAttachments、Health、RuntimeDiagnostics、RuntimeReconcile、许可证（Activate/Deactivate/Validate/GetLicenseStatus）、GetAuthToken、云钱包、更新准备、基准对比能力（benchmark compare，需授权）

---

## 13. 云端、计费、更新、遥测

- **云网关**（`cloudbridge`）：`OMNIAGENT_CLOUD_GATEWAY` / `OMNIAGENT_CLOUD_ORIGIN`，模型请求可以经云端转发，有"准入"（admission）检查和暂停原因（如余额不足）。走网关时用"欢乐豆"计费（1 元 = 1 豆，支付宝/微信，按任务预留→结算→返还）。自带 Key 时走直连。
- **许可证**（`billing`）：license_key 激活、套餐等级（PlanTier）、到期天数、本地缓存。
- **账号/诊断**：`https://43.142.4.194/accounts`，诊断上报 `/accounts/diagnostics/v1/events`；当前包 `internalTest=true, uploadsEnabled=true`。
- **更新**：`https://43.142.4.194/omniagent`（beta 通道），备用 `download.sopro-omni.com`，ed25519 签名；更新会等任务结束、无未发送输入时才安装重启。
- **遥测**：有 OpenTelemetry（`otel.endpoint`、`otel.sampling_ratio`）。

---

## 14. 开发线索（看出团队在做什么）

- 有完整的**评测基础设施**：eval_suites / eval_cases / baselines（竞品基线分数）/ benchmark_model_compare / 大量 "benchmark" 专用规则（基准任务里不改就过要用 `change_status=not_needed`）。说明他们在用 SWE-bench 类基准调教 Agent。
- 源码里引用了内部文档：`docs/audit/adapter-phase1b-switch-2026-10.md`、`design/multi-model-adapter-design-v0`，说明 2026 年 10 月在做多模型适配器切换（phase1b）。
- 多处 "legacy"（旧版会话身份、旧 LLM 适配器 `OMNIAGENT_LEGACY_LLM_ADAPTER`），产品迭代很快。
- 政务定制痕迹：`OMNIGOV` 环境变量可以覆盖 LLM 配置；合规分级里有"涉密内网"。

---

## 15. 没能确认的部分

- 云网关和自带 Key 的具体切换规则（只能从代码名推断）；
- 记忆提取引擎和部分提示词的后半段（被编译器拆散存放）；
- 各 HTTP 路由的精确路径（字符串被拼接，只还原了处理函数名）；
- 实际运行时行为（没有运行程序）。

如果需要，下一步可以在你电脑上实际启动它的后端，抓一次真实交付任务的 API 调用和 SSE 事件流，把上面这些空白补上。
