
# 项目复盘

**原则：每一条经验都必须由用户确认后才能进入经验包。** 你只能提出候选，不能直接写入 `references/lessons.jsonl`。

工具脚本：`$SKILL/scripts/lessons.py`，经验包模板：`$SKILL/assets/pack-template/`（`$SKILL` 是 omni-delivery 技能目录）。

## 1. 收集材料（只读）
- `.delivery/contract.json`：目标、行业、验收条目及来源
- 访谈问答（`.delivery/interview.jsonl`）和执行中向用户提问的决策记录
- `.delivery/qa/*.json`：哪些条目失败过、为什么
- 返工反馈（用户提的修改意见）
- `.delivery/report.md`：风险、假设、未完成项
- `.delivery/industry-usage.jsonl`：本次引用了哪些旧经验（由 industry-learning 记录）

## 2. 给旧经验打分
对 `industry-usage.jsonl` 里的每条旧经验判断：
- `helpful`：用了并且减少了返工、提前发现了问题、被用户采纳；
- `neutral`：用了但看不出影响；
- `harmful`：误导了方向、和本项目实际矛盾、导致返工。
每条写一句 `note` 说明依据。展示给用户确认后运行：
`python3 $SKILL/scripts/lessons.py score <经验包目录> .delivery/industry-usage.jsonl --project <项目编号>`

## 3. 提取候选经验
写入 `.delivery/retro/candidates.jsonl`，每行一条：
```json
{"id":"c1","type":"intake|acceptance|practice|pitfall|template|compliance",
 "statement":"一句话、可执行的经验","rationale":"为什么","applies_when":"适用条件和边界",
 "evidence":[{"ref":"qa:v2/requirement-3 或 decision:data-boundary 或 feedback:2","quote":"原文"}],
 "confidence":0.6,"updates":null,"supersedes":null,"review":"pending"}
```
只提取满足**全部**条件的经验：
1. 换一个同行业客户也大概率成立（不是这个客户的特殊情况）；
2. 有证据（返工、QA 失败、用户决策、明确反馈），不是你的推测；
3. 能改变下一次的做法（问什么、验收什么、怎么做、避开什么）。

优先从这些地方找：返工原因 → pitfall；QA 失败的条目 → acceptance；用户第一轮就追问的问题 → intake；一次通过且用户称赞的做法 → practice；最终交付物结构 → template。

和已有经验重复的：用 `updates` 指向旧经验 id，补充证据；与旧经验矛盾且本次证据更强的：用 `supersedes` 指向旧经验 id。

## 4. 脱敏
经验里**不得出现**：客户或单位名称、人名、金额、电话、邮箱、地址、IP、网址、账号密钥、内部系统名、项目代号。用"某区县级单位""某省级平台"这类说法替代。
把本项目的客户相关词写进 `.delivery/retro/client_terms.txt`（每行一个），然后运行：
`python3 $SKILL/scripts/lessons.py scan .delivery/retro/candidates.jsonl --terms .delivery/retro/client_terms.txt`
有问题就改，直到通过。

## 5. 用户逐条确认
用表格展示每条候选：类型、经验、适用条件、证据、是新增/更新/取代。让用户对每条选择：
- 确认 → `review: "approved"`
- 修改后确认 → 按用户意见改写，`review: "edited"`
- 拒绝 → `review: "rejected"`
不能替用户选，不能把没回答的当作确认。

## 6. 合并
经验包目录：
- Claude Code：`~/.claude/skills/industry-<行业>-<细分场景>/`（个人级，所有项目可用）；
- claude.ai：技能目录只读，在输出目录建 `industry-<行业>-<细分场景>/`，合并后运行 `lessons.py package <目录>` 打成 zip，请用户在 设置 → 技能 里上传（已上传过的旧版先删掉再传新版）。下次复盘前，请用户把旧 zip 或 `references/lessons.jsonl` 发回来，解压到输出目录再合并，否则会丢历史。

不存在就先创建：
`python3 $SKILL/scripts/lessons.py new-pack <目录> --industry <行业> --scenario <细分场景> --title <中文名>`
然后：
`python3 $SKILL/scripts/lessons.py merge <目录> .delivery/retro/candidates.jsonl --project <项目编号> --terms .delivery/retro/client_terms.txt`
脚本只合并 approved/edited 的条目，会再次做脱敏检查，并自动更新 `lessons.md`、SKILL.md 里的前 10 条和 `CHANGELOG.md`。

## 7. 汇报（多一条硬规则：没有用户逐条确认的候选，一条都不能合并）
告诉用户：经验包新版本号、新增/更新/取代各几条、旧经验打分结果、哪些候选被拒绝。项目编号用脱敏编号（如 `P-2026-003`），不要用客户名。
