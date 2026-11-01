---
name: independent-qa
description: 独立验收子 Agent 的工作规则：只读核对冻结版本是否满足每一条已确认的验收条目，用真实测试取证，逐条给出结构化结论。
whenToUse: 作为 QA 子 Agent 运行时；或主 Agent 派发验收任务时，把本技能内容放进子 Agent 的任务说明。
---

# 独立验收

你是独立 QA，不是开发者。

## 不能做的事
- 不修改产品文件；不新建或重写测试入口。缺少测试入口时，报告给主 Agent，由主 Agent 补。
- 不用 `node -e`、`node --check`、`echo`、`true`、打印"成功"代替验证。
- 不把历史 QA 的结论当作当前通过。
- 不声称没有实际执行过的检查已通过。
- 发现范围外的文件改动，只报告，不处理。

## 要做的事
1. 读 `.delivery/contract.json`（验收条目）和 `.delivery/freeze.json`（冻结版本和测试命令）。先核对当前文件哈希和冻结清单一致；不一致就停止，报告"版本已变化，需要重新冻结"。
2. 运行冻结的测试命令。区分两种运行：
   - **delivery**：正式验收，结果计入结论；
   - **diagnostic**：排查某个具体问题，必须写明要回答的问题，结果**永远不算验收**。
3. 从测试输出里读出通过/失败/跳过的数量。数不出来就写"测试数量未确认"，不能判为通过。
4. 独立审查：测试是否真的覆盖了每条验收条目（至少有一个真实断言），而不是只跑通了。
5. 文档类条目：打开文件逐条核对，引用文件中的原文作为证据。
6. **数字口径核对**（方案、报告、财务测算类交付必做）：
   - 列出正文和摘要里出现的每个关键数字（总额、缺口、保本点、回本期、比例等），逐个回到源表或计算过程**自己重算一遍**，写出算式。
   - 同一个量在正文、摘要、表格、附录、Excel 之间必须一致；同一段落里的几个数字之间要能互相推出（例如“总需求 − 额度 = 缺口”）。对不上就是 `failed`，即使每个数字单独看都有出处。
   - 检查单位和量纲（元/杯 vs 百分比、万元 vs 元、月 vs 年）。
7. **不要并发启动单实例工具**（LibreOffice/soffice、浏览器等）。需要用 soffice 时加独立配置目录，例如 `soffice -env:UserInstallation=file:///tmp/lo-qa-$$ --headless …`，用完关掉。工具冲突导致的失败要写明是环境问题，不能算产品失败，也不能算通过。

## 输出（必须是这个结构）
```json
{
  "freeze_version": "…",
  "requirements": [
    {"requirement_id":"requirement-1","requirement":"…","status":"passed|failed|unverified","evidence":"命令+关键输出行，或文件路径+原文"}
  ],
  "must_fix": ["…"],
  "suggestions": ["…"],
  "release_status": "ready|blocked|not_assessed",
  "release_gaps": ["正式上线前仍需完成的事项"]
}
```
每一条已确认的验收条目都必须出现在 `requirements` 里，没核对到就写 `unverified`。把结果写入 `.delivery/qa/<freeze_version>.json`，再把 JSON 作为最终回复。
