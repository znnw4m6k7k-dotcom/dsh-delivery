# 使用行业经验

行业分两级：`行业/细分场景`，经验包技能名为 `industry-<行业>-<细分场景>`。

## 1. 识别行业
根据需求判断 `行业/细分场景`，例如 `gov/data-platform`、`gov/oa-integration`、`medical/his-integration`、`legal/contract-review`。
在可用技能列表中找 `industry-<行业>-<细分场景>`；没有完全匹配就找同行业的其他细分场景，并告诉用户"只有相近场景的经验"。都没有就说明"这是该行业第一个项目，结束后复盘会建立经验包"，然后跳过这一步。
识别结果不确定时，问用户一次（给 2–3 个选项）。

## 2. 加载
先读经验包的 SKILL.md（前 10 条，Codex 会在技能触发时自动加载），再按需读 `references/lessons.md`、`intake-questions.md`、`acceptance.md`、`checklists/`、`templates/`。只用 `status: active` 的经验；`needs_review` 的只能作为提醒，并告诉用户它有争议。

## 3. 使用规则（来自 OmniAgent 锦囊复用规则）
- **只沿用方法，不照搬业务数据。** 经验来自别的客户，本项目的业务差异仍需重新确认。
- 经验和用户本次的明确要求冲突时，以用户为准，并在 usage 里记为可能 harmful。
- 推荐的访谈问题、验收条目要标明来源经验 id，用户同意后才进入合同。
- 不因为经验包里有某条，就跳过本项目应有的验证。

## 4. 在哪里用
| 环节 | 怎么用 |
|---|---|
| 需求访谈 | 从 intake 类经验和 `intake-questions.md` 挑出相关问题 |
| 验收草案 | 把 acceptance 类经验作为"建议补充"条目 |
| 计划 | practice 类作为做法参考，pitfall 类写进风险和缓冲时间 |
| 产出 | 用 template 类和 `templates/` 的结构 |
| QA | compliance 类和 `checklists/` 交给 QA 逐项核对 |

## 5. 记录使用
每用一条经验，就在项目的 `.delivery/industry-usage.jsonl` 追加一行：
```json
{"id":"gov-data-platform-004","stage":"intake|acceptance|plan|output|qa","how":"怎么用的","verdict":null}
```
`verdict` 留空，复盘时再判断。在交付报告的"实际复用"部分列出用过的经验 id。

## 6. 不能做的事
- 不直接修改经验包里的任何文件（`lessons.jsonl` 只能由 `lessons.py merge` 在用户逐条确认后写入）。
- 不在本项目里引用 `status: superseded` 的经验；它们只保留作历史。
- 额外加载与当前行业无关的经验包前，先问用户。
