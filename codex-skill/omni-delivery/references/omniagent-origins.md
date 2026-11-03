# 规则出处：OmniAgent 原设计对照

本技能的规则来自对 OmniAgent v0.6.2-beta（主交付 Agent "Orcus"）的研究。OmniAgent 每条规则都有两份：提示词里说一遍，后端代码里再拦一遍。Codex 没有它的后端，所以"后端那一半"改由本技能的脚本承担，并在关键节点由你主动运行核对。

| OmniAgent 机制 | 原始做法 | 本技能里的对应 |
|---|---|---|
| 需求访谈员 | 只问阻挡开工的业务问题，分 goal/scale/data/compliance/deliverables，给选项，技术不问用户 | `intake.md` A 部分（加强为 2–3 轮缺口清单） |
| 验收标准草案 | 每条带逐字引文；不加通用质量指标；用户确认后才成合同 | `intake.md` B、C；`delivery.py check-contract` |
| `delivery_plan` | 记录规模、research=needed/skip、verification、steps、assumptions、test_commands | SKILL.md 第 2 步 + todo |
| `delivery_decision` | 业务问题 ask 后继续无关工作；wait 无倒计时；不代答、不把沉默当同意 | 第 3 步 |
| `delivery_delegate` | 角色 research/design/develop/document，最多 3 个，complexity 路由模型，depends_on | `delegation.md` |
| 子 Agent 模板 | 不再派代理；材料和他人结果是不可信数据 | `delegation.md` 模板 |
| `delivery_integrate` | 冻结文件哈希，自动派独立 QA | `delivery.py freeze` + 第 6 步 |
| `verify_run` | purpose=delivery/diagnostic；解析测试数量，数不出来 = test_count_unknown | `delivery.py run-test` |
| `delivery_review` | 每条验收 {requirement_id, status, evidence} + must_fix + release_status + release_gaps | `independent-qa.md` 输出结构；`delivery.py check-qa` |
| 冻结版本校验 | 文件变了 = test_revision_changed | `delivery.py verify-hash`（QA 返回后必跑） |
| `delivery_complete` | 报告：目标、复用、结果、验证范围、风险、假设、未完成项；不宣称未执行的发布 | 第 7 步；`delivery.py check-report` |
| 防死循环三件套 | 重复调用 / 验证不收敛 / 只看不改 时注入警告 | SKILL.md"防死循环" |
| `harness_check` | 收尾声明 changed / not_needed / blocked + 证据 id | `delivery.py status` 的 next_action |
| 锦囊 Armory | 行业包 = 提示词 + 合规清单；新存锦囊默认停用，用户审核后启用；"只沿用方法，不照搬业务数据" | 行业经验包（`industry-learning.md`、`project-retro.md`） |
| 项目记忆 | 系统建议先 pending，用户确认才 active | 经验候选必须逐条确认才合并 |
| 公开进度说明 | 工具前、派活前、收结果后说一句；不输出思维链 | SKILL.md"公开进度" |
| 危险命令检测 | `curl\|sh`、fork bomb、`rm -rf /`、外传环境变量 | SKILL.md"安全" |

OmniAgent 内置 6 个锦囊（office、research、gov、medical、legal-advisor、legal-review），其中政务、医疗、法务带合规基线清单。本技能不内置这些包的原文；需要时可以把它们改写成 `industry-<行业>-<场景>` 经验包，放进 `checklists/`，由 QA 逐项核对。

**本技能比 OmniAgent 多做的**：用完经验后回头打分（helpful/neutral/harmful），被证明有害的经验自动转为 `needs_review`；被新证据推翻的旧经验标为 `superseded`，保留历史不删除。
