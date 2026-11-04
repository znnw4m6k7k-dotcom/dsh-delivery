#!/usr/bin/env python3
"""从 claude-skill/omni-delivery 生成 Codex 版技能 codex-skill/omni-delivery。

只改和运行环境有关的段落（提问、计划、独立 QA、经验包位置、守卫），流程规则和脚本完全共用。
每条替换都断言原文存在：Claude 版改了措辞而这里没跟上时，构建直接失败，不会悄悄漏改。
用法：python3 codex-skill/build.py        # 重新生成
      python3 codex-skill/build.py --check # 只检查生成结果是否最新（测试用）
"""
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "claude-skill", "omni-delivery")
OUT = os.path.join(HERE, "omni-delivery")

ENV_TABLE_OLD = """| 能力 | Claude Code | claude.ai（开了代码执行） | 都没有时 |
|---|---|---|---|
| 工作目录 | 项目根目录下 `.delivery/` | 当前工作目录（如 `/mnt/user-data/outputs`）下 `.delivery/` | 在对话里维护同样的 JSON |
| 提问 | `AskUserQuestion` 工具 | 直接在对话里问，给选项和推荐 | 同左 |
| 计划 | `TodoWrite` / 任务工具 | 对话里列 todo，并写入 `.delivery/plan.md` | 同左 |
| 独立 QA | `Task`/`Agent` 工具派子 Agent | 无子 Agent：做一次"角色切换式 QA"，报告里**必须写明非独立** | 同左 |
| 行业经验包位置 | `~/.claude/skills/industry-<行业>-<场景>/` | 生成到输出目录，打包成 zip 由用户上传 | 输出 Markdown 让用户保存 |
| 脚本 | `python3 <本技能目录>/scripts/…` | 同左 | 手工按规则检查 |"""
ENV_TABLE_NEW = """| 能力 | Codex（CLI / App / IDE 插件） |
|---|---|
| 工作目录 | 项目根目录下 `.delivery/` |
| 提问 | 直接在对话里问：一轮的问题用编号列出，每题给编号选项并标出推荐，用户可以只回数字或"按你的推荐" |
| 计划 | `update_plan` 工具，同时写入 `.delivery/plan.md` |
| 独立 QA | 用 `codex exec` 另起一个独立的 Codex 进程做验收（见第 6 步）；起不来时做"角色切换式 QA"，报告里**必须写明非独立** |
| 行业经验包位置 | `~/.codex/skills/industry-<行业>-<场景>/`（Codex 会把它当技能自动发现） |
| 脚本 | `python3 <本技能目录>/scripts/…` |
| 改文件 | 用 `apply_patch`；冻结期间不要改冻结清单里的文件 |"""

QA_STEP_OLD = "- 代码/应用：`independent`。派**一个** QA 子 Agent，任务说明用 [references/independent-qa.md](references/independent-qa.md) 里的模板。"
QA_STEP_NEW = "- 代码/应用：`independent`。用 `codex exec` 起**一个**独立的 Codex 进程做 QA，命令和任务说明见 [references/independent-qa.md](references/independent-qa.md) 末尾。它和你不共享上下文，只读冻结文件和合同，所以算独立验收。"

GUARD_OLD_HEAD = "## 可选：Claude Code 运行时守卫"
GUARD_NEW = """## 自查代替运行时守卫
Codex 没有可以拦截工具调用的 hook，所以"冻结后不许改、版本不许倒退、freeze.json 不许预填结论、主 Agent 不许写 QA 结论、没 QA 不许写报告、经验包不许直接改"这几条靠你自己守，靠脚本事后核对：
- QA 返回后先跑 `delivery.py verify-hash`：文件被动过就说明这轮验收作废，重新冻结。
- 写报告前跑 `delivery.py status`，必须是 `report_allowed`；写完跑 `check-report`。
- 经验包只用 `lessons.py merge` / `score` 写，不用 `apply_patch` 改 `lessons.jsonl`。

"""

QA_DISPATCH_OLD = "Claude Code 里用 `Task`/`Agent` 工具派一个子 Agent（如有只读型 agent，如 `general-purpose` 以外的审查型，优先用；它仍需要能运行命令）。把下面整段填好作为 prompt："
QA_DISPATCH_NEW = """在 Codex 里用 `codex exec` 另起一个 Codex 进程当 QA。先把下面整段填好，写到 `.delivery/qa/prompt-<vN>.md`，再在项目根目录运行：

```bash
codex exec -s workspace-write -C "<项目根目录>" -o ".delivery/qa/<vN>.last.txt" "$(cat .delivery/qa/prompt-<vN>.md)"
```

- `codex exec` 要联网调用模型，在沙箱里通常会被拦住。第一次运行时 Codex 会请求在沙箱外执行，请用户批准；用户不批准或命令起不来，就改做角色切换式验收（结论加 `"independence": "self"`，报告写明"非独立验收"）。
- QA 进程有写权限，是为了能运行测试和写证据。它是否改了产品文件，由你事后用 `verify-hash` 核对，不靠它自觉。
- 同一冻结版本同时只起一个 QA 进程。

任务说明："""

QA_AFTER_OLD = "收到结果后，主 Agent 自己再运行一次 `delivery.py check-qa` 和 `delivery.py status`，不要只信子 Agent 的自述。"
QA_AFTER_NEW = "QA 进程结束后，主 Agent 自己依次运行 `delivery.py verify-hash`、`delivery.py check-qa` 和 `delivery.py status`，不要只信 QA 的自述。`verify-hash` 不通过说明 QA 改了冻结文件，这轮验收作废，要撤回改动、重新冻结、重新验收。"

REPLACEMENTS = {
    "SKILL.md": [
        ("# OmniAgent 交付工作法（Claude 版）", "# OmniAgent 交付工作法（Codex 版）"),
        ("协作协议移植到 Claude。", "协作协议移植到 Codex。"),
        (ENV_TABLE_OLD, ENV_TABLE_NEW),
        (QA_STEP_OLD, QA_STEP_NEW),
        ("- 没有子 Agent 的环境：按同一份 QA 规则做角色切换式验收", "- `codex exec` 起不来时：按同一份 QA 规则做角色切换式验收"),
        ("- [references/delegation.md](references/delegation.md)：子 Agent 角色、任务模板、模型选择", "- [references/delegation.md](references/delegation.md)：分工角色、任务模板（Codex 里由你按顺序自己做，或用 codex exec 另起进程）"),
    ],
    "references/independent-qa.md": [
        (QA_DISPATCH_OLD, QA_DISPATCH_NEW),
        ("角色：独立 QA。仅完成本次验收，不再派发子 Agent。", "角色：独立 QA。仅完成本次验收，不再启动其他 Codex 进程或子 Agent。"),
        (QA_AFTER_OLD, QA_AFTER_NEW),
    ],
    "references/intake.md": [
        ("""### A4. 在 Claude 里怎么问
- Claude Code：用 `AskUserQuestion` 工具，一次最多 4 题，每题 2–4 个选项，推荐项放第一个并在标签后加"（推荐）"；`why` 写进选项说明。一轮超过 4 题就分两次调用。
- claude.ai：在一条消息里用编号列出本轮问题，每题列出选项并标出推荐，最后提示"可以只回编号，也可以回'按你的推荐'"。""",
         """### A4. 在 Codex 里怎么问
- 在一条消息里用编号列出本轮问题（1、2、3…），每题列出编号选项（A/B/C）并标出推荐，`why` 用一句话写在题目下面。
- 结尾提示"可以只回编号，比如 1A 2C；也可以回'按你的推荐'"。用户只回了部分题目时，没回的题按推荐项记成假设并告诉用户。"""),
    ],
    "references/delegation.md": [
        ("只在 Claude Code 等有子 Agent 工具（`Task`/`Agent`）的环境使用；claude.ai 没有子 Agent，就由主 Agent 按同样的分工顺序自己做。",
         "Codex 里没有常驻的子 Agent 工具：一般由你按同样的分工**顺序**自己做；确实需要隔离上下文时（主要是独立 QA，或大块独立调研），用 `codex exec` 另起一个 Codex 进程，把下面的任务说明作为它的提示词，用 `-o` 把它的最终回复写到文件里再读。"),
        ("Claude Code 的 Agent 工具可以按任务指定模型，没有把握时沿用默认。", "`codex exec` 可以用 `-m` 指定模型，没有把握时沿用默认。"),
    ],
    "references/project-retro.md": [
        ("""- Claude Code：`~/.claude/skills/industry-<行业>-<细分场景>/`（个人级，所有项目可用）；
- claude.ai：技能目录只读，在输出目录建 `industry-<行业>-<细分场景>/`，合并后运行 `lessons.py package <目录>` 打成 zip，请用户在 设置 → 技能 里上传（已上传过的旧版先删掉再传新版）。下次复盘前，请用户把旧 zip 或 `references/lessons.jsonl` 发回来，解压到输出目录再合并，否则会丢历史。""",
         """- Codex：`~/.codex/skills/industry-<行业>-<细分场景>/`（个人级，所有项目可用；新建后要重启 Codex 才会被发现）。
- 也想在 Claude 里用：合并后运行 `lessons.py package <目录>` 打成 zip，用户可以上传到 Claude 网页版的技能设置，或解压到 `~/.claude/skills/`。"""),
    ],
    "references/industry-learning.md": [
        ("（前 10 条，Claude 会在技能触发时自动加载）", "（前 10 条，Codex 会在技能触发时自动加载）"),
    ],
    "references/omniagent-origins.md": [
        ("Claude 没有它的后端，所以\"后端那一半\"改由本技能的脚本和可选 hook 承担。", "Codex 没有它的后端，所以\"后端那一半\"改由本技能的脚本承担，并在关键节点由你主动运行核对。"),
        ("| `delivery.py verify-hash`；hook R1 |", "| `delivery.py verify-hash`（QA 返回后必跑） |"),
        ("| 第 7 步；`delivery.py check-report`；hook R4 |", "| 第 7 步；`delivery.py check-report` |"),
    ],
    "scripts/lessons.py": [
        ("经验包目录建议：Claude Code 用 ~/.claude/skills/industry-<行业>-<细分场景>/；\nclaude.ai 在输出目录建同名文件夹，合并后 package 成 zip 让用户上传。",
         "经验包目录建议：Codex 用 ~/.codex/skills/industry-<行业>-<细分场景>/；\nClaude Code 用 ~/.claude/skills/ 下的同名文件夹；claude.ai 用 package 打成 zip 上传。"),
    ],
}

OPENAI_YAML = """interface:
  display_name: "OmniAgent 交付工作法"
  short_description: "访谈定验收合同 → 计划 → 实现 → 冻结 → 独立验收 → 诚实报告 → 复盘沉淀行业经验"
  default_prompt: "Use $omni-delivery to deliver this project: interview me first, confirm acceptance criteria, then plan, build, freeze, run independent QA and write an honest report."
"""


def build(dest):
    if os.path.exists(dest):
        shutil.rmtree(dest)
    shutil.copytree(SRC, dest, ignore=shutil.ignore_patterns("__pycache__", "hooks"))
    for rel, pairs in REPLACEMENTS.items():
        p = os.path.join(dest, rel)
        t = open(p, encoding="utf-8").read()
        for old, new in pairs:
            if old not in t:
                sys.exit(f"构建失败：{rel} 里找不到要替换的原文：\n{old[:120]}")
            t = t.replace(old, new)
        if rel == "SKILL.md":
            head, sep, rest = t.partition(GUARD_OLD_HEAD)
            if not sep:
                sys.exit("构建失败：SKILL.md 里找不到守卫段落")
            _, sep2, tail = rest.partition("## 文件索引")
            t = head + GUARD_NEW + sep2 + tail
            t = t.replace("- `scripts/lessons.py`", "- `agents/openai.yaml`：Codex 里显示的名称和默认提示\n- `scripts/lessons.py`")
        open(p, "w", encoding="utf-8").write(t)
    os.makedirs(os.path.join(dest, "agents"), exist_ok=True)
    open(os.path.join(dest, "agents", "openai.yaml"), "w", encoding="utf-8").write(OPENAI_YAML)
    for leftover in ("Claude Code", "claude.ai", "AskUserQuestion", "TodoWrite", "hooks/guard.py"):
        for dp, _, fns in os.walk(dest):
            for fn in fns:
                if fn.endswith((".md", ".yaml")):
                    if leftover in open(os.path.join(dp, fn), encoding="utf-8").read():
                        sys.exit(f"构建失败：{os.path.relpath(os.path.join(dp, fn), dest)} 里还留着 Claude 专属内容「{leftover}」")


def same_tree(a, b):
    # 按内容比较，忽略换行符差异（Windows 检出时 .md 是 CRLF、.py 是 LF，生成时统一按系统换行写）
    def files(root):
        out = {}
        for dp, dns, fns in os.walk(root):
            dns[:] = [d for d in dns if d != "__pycache__"]
            for fn in fns:
                out[os.path.relpath(os.path.join(dp, fn), root)] = os.path.join(dp, fn)
        return out
    fa, fb = files(a), files(b)
    if fa.keys() != fb.keys():
        return False
    for rel in fa:
        with open(fa[rel], "rb") as x, open(fb[rel], "rb") as y:
            if x.read().replace(b"\r\n", b"\n") != y.read().replace(b"\r\n", b"\n"):
                return False
    return True


if __name__ == "__main__":
    if "--check" in sys.argv:
        tmp = os.path.join(tempfile.mkdtemp(), "omni-delivery")
        build(tmp)
        if not os.path.isdir(OUT) or not same_tree(tmp, OUT):
            sys.exit("codex-skill/omni-delivery 不是最新的，运行 python3 codex-skill/build.py 重新生成")
        print("Codex 版是最新的")
    else:
        build(OUT)
        print(f"已生成 {os.path.relpath(OUT)}")
