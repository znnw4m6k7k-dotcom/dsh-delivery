#!/usr/bin/env python3
"""从 claude-skill/delivery-contract 生成 Codex 版或 Agent Skills 通用版。

只改和运行环境有关的段落（提问、计划、独立 QA、经验包位置、守卫），流程规则和脚本完全共用。
每条替换都断言原文存在：Claude 版改了措辞而这里没跟上时，构建直接失败，不会悄悄漏改。
用法：python3 codex-skill/build.py        # 重新生成
      python3 codex-skill/build.py --check # 只检查生成结果是否最新（测试用）
      python3 codex-skill/build.py --generic [--check] # Agent Skills 通用版
"""
import argparse
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "claude-skill", "delivery-contract")
OUT = os.path.join(HERE, "delivery-contract")
GENERIC_OUT = os.path.join(HERE, "..", "agent-skill", "delivery-contract")

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
        ("# 交付合同工作法（Claude 版）", "# 交付合同工作法（Codex 版）"),
        ("交付协议用在 Claude 里。", "交付协议用在 Codex 里。"),
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
    "scripts/lessons.py": [
        ("经验包目录建议：Claude Code 用 ~/.claude/skills/industry-<行业>-<细分场景>/；\nclaude.ai 在输出目录建同名文件夹，合并后 package 成 zip 让用户上传。",
         "经验包目录建议：Codex 用 ~/.codex/skills/industry-<行业>-<细分场景>/；\nClaude Code 用 ~/.claude/skills/ 下的同名文件夹；claude.ai 用 package 打成 zip 上传。"),
    ],
}

OPENAI_YAML = """interface:
  display_name: "交付合同工作法"
  short_description: "访谈定验收合同 → 计划 → 实现 → 冻结 → 独立验收 → 诚实报告 → 复盘沉淀行业经验"
  default_prompt: "Use $delivery-contract to deliver this project: interview me first, confirm acceptance criteria, then plan, build, freeze, run independent QA and write an honest report."
"""

GENERIC_ENV_TABLE = """| 能力 | 使用方式 |
|---|---|
| 工作目录 | 可读写文件时，在项目根目录下用 `.delivery/`；只有对话时，把合同与验收记录留在对话或可导出的文档里 |
| 提问与计划 | 优先用宿主的提问和计划工具；没有时在对话里列出编号选项与推荐，有文件权限时同时把计划写到 `.delivery/plan.md` |
| 独立 QA | 有授权的独立 Agent 或隔离会话时使用第 6 步的模板；只能由当前 Agent 核对时，在结论与报告中明确标注"非独立验收" |
| 行业经验 | 从宿主能发现的技能目录或用户提供的经验包读取；复盘时优先写到已确认的可写目录，否则导出给用户 |
| 脚本 | 有终端和 Python 3 时使用本技能的脚本；缺少任一能力时手工核对并说明未执行的检查 |"""

GENERIC_DESCRIPTION = (
    "交付合同工作法。适用于软件、商业方案、咨询报告、财务测算和调研等交付任务，"
    "以及确认验收标准、项目复盘、沉淀或复用行业经验。 "
    "Use to deliver a project through intake, confirmed acceptance criteria, implementation, "
    "verification and reporting, or to run a retrospective and reuse industry lessons."
)

GENERIC_GUARD = """## 交付状态核对
- QA 返回后运行 `delivery.py verify-hash`；文件变化时，这一轮验收作废并重新冻结。
- 写报告前运行 `delivery.py status` 确认是 `report_allowed`，写完运行 `check-report`。
- 有脚本权限时，通过 `lessons.py merge` / `score` 更新经验包。
- 环境无法运行脚本时，记录可人工核对的结果，将缺少执行证据的条目标记为未验收。需要执行冻结测试的工作只有拿到对应证据后才能判通过。

"""

GENERIC_REPLACEMENTS = {
    "SKILL.md": [
        ("# 交付合同工作法（Claude 版）", "# 交付合同工作法"),
        ("交付协议用在 Claude 里。", "交付协议用于当前 Agent。"),
        (ENV_TABLE_OLD, GENERIC_ENV_TABLE),
        ("下文 `$SKILL` 指本技能所在目录", "下文命令里的 `$SKILL` 需替换成本技能所在目录的完整路径"),
        ("（含 `SKILL.md` 的那个目录）。", "（含 `SKILL.md` 的那个目录）。若通过附件或粘贴加载而无法访问引用文件，请用户提供相关参考资料，保持当前步骤的验收条件。"),
        ("简单任务自己做；复杂任务按独立模块委派子 Agent", "简单任务自己做；宿主支持且允许委派时，复杂任务按独立模块委派子 Agent"),
        (QA_STEP_OLD, "- 代码/应用：`independent`。宿主允许且能启动隔离上下文时，把 [references/independent-qa.md](references/independent-qa.md) 的模板交给**一个**独立 QA Agent。"),
        ("没有子 Agent 的环境", "无法启动独立 QA 的环境"),
        ("写报告前：所有派出的子 Agent 已返回，且 `python3 $SKILL/scripts/delivery.py status` 显示 `report_allowed`（最新冻结版本有 `release_status: ready` 的 QA 结论）。",
         "写报告前，等待所有已派出的 QA 返回。能运行脚本时，先运行 `python3 $SKILL/scripts/delivery.py status` 核对交付状态。没有执行环境时，根据已有证据标出手工核对和未验收的条目。"),
    ],
    "references/independent-qa.md": [
        (QA_DISPATCH_OLD, "通过宿主允许的子 Agent 工具或独立会话，把下面整段填好发送给一个可访问冻结工件并运行测试的 QA。仅共享本轮合同、冻结版本、工件路径与必要证据，保留上下文隔离，优先使用只读产品文件权限。没有可用执行环境时，记录未执行的验收项。"),
        (QA_AFTER_OLD, "收到结果后，主 Agent 依次运行 `delivery.py verify-hash`、`check-qa`、`status`，独立核对当前文件、QA 结论和交付状态。哈希不符时重新冻结并重新验收。"),
    ],
    "references/intake.md": [
        ("""### A4. 在 Claude 里怎么问
- Claude Code：用 `AskUserQuestion` 工具，一次最多 4 题，每题 2–4 个选项，推荐项放第一个并在标签后加"（推荐）"；`why` 写进选项说明。一轮超过 4 题就分两次调用。
- claude.ai：在一条消息里用编号列出本轮问题，每题列出选项并标出推荐，最后提示"可以只回编号，也可以回'按你的推荐'"。""",
         """### A4. 怎么问
- 宿主提供提问工具时，用它列出选项、推荐和一句影响说明。
- 直接对话时，给本轮问题和选项编号，用户可以回编号，比如 1A 2C，或明确说"按你的推荐"。"""),
    ],
    "references/delegation.md": [
        ("只在 Claude Code 等有子 Agent 工具（`Task`/`Agent`）的环境使用；claude.ai 没有子 Agent，就由主 Agent 按同样的分工顺序自己做。", "只有宿主支持且允许委派时才派子 Agent；其他情况下由主 Agent 按同样的分工顺序完成，并如实标注验收独立性。"),
        ("Claude Code 的 Agent 工具可以按任务指定模型，没有把握时沿用默认。", "宿主允许给独立任务指定模型时，拿不准就沿用默认模型。"),
    ],
    "references/project-retro.md": [
        ("""- Claude Code：`~/.claude/skills/industry-<行业>-<细分场景>/`（个人级，所有项目可用）；
- claude.ai：技能目录只读，在输出目录建 `industry-<行业>-<细分场景>/`，合并后运行 `lessons.py package <目录>` 打成 zip，请用户在 设置 → 技能 里上传（已上传过的旧版先删掉再传新版）。下次复盘前，请用户把旧 zip 或 `references/lessons.jsonl` 发回来，解压到输出目录再合并，否则会丢历史。""",
         """- 可以写入宿主的技能目录时，在用户确认的技能根目录下创建或更新 `industry-<行业>-<细分场景>/`。
- 技能目录只读时，在可写的输出目录合并，再运行 `lessons.py package <目录>` 导出 ZIP，由用户按宿主的方式导入。缺少旧包时请用户先提供旧 ZIP 或 `references/lessons.jsonl`，以保留历史。
- 只有对话时，输出已逐条确认的经验供用户保存，说明实际保存状态。"""),
    ],
    "references/industry-learning.md": [
        ("（前 10 条，Claude 会在技能触发时自动加载）", "（包含前 10 条经验）"),
    ],
    "scripts/lessons.py": [
        ("打成 zip，用于在 claude.ai 设置里上传", "打成 zip，可交给用户导入"),
        ("经验包目录建议：Claude Code 用 ~/.claude/skills/industry-<行业>-<细分场景>/；\nclaude.ai 在输出目录建同名文件夹，合并后 package 成 zip 让用户上传。",
         "经验包存放在宿主支持的技能目录，或在输出目录打成 zip 交给用户导入。"),
        ("（在 claude.ai 设置 → 技能 里上传；先删除旧版本）", "（按宿主的技能导入方式使用）"),
    ],
}


def build(dest, generic=False):
    if os.path.exists(dest):
        shutil.rmtree(dest)
    shutil.copytree(SRC, dest, ignore=shutil.ignore_patterns("__pycache__", "hooks"))
    replacements = GENERIC_REPLACEMENTS if generic else REPLACEMENTS
    for rel, pairs in replacements.items():
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
            if not sep2:
                sys.exit("构建失败：SKILL.md 里找不到文件索引")
            t = head + (GENERIC_GUARD if generic else GUARD_NEW) + sep2 + tail
            if generic:
                before_description, separator, rest = t.partition("\ndescription: ")
                if not separator:
                    sys.exit("构建失败：SKILL.md 里找不到技能描述")
                _, _, after_description = rest.partition("\n")
                t = f"{before_description}{separator}{GENERIC_DESCRIPTION}\n{after_description}"
            else:
                t = t.replace("- `scripts/lessons.py`", "- `agents/openai.yaml`：Codex 里显示的名称和默认提示\n- `scripts/lessons.py`")
        if generic and rel.endswith(".md"):
            for script in ("delivery.py", "lessons.py"):
                t = t.replace(f"python3 $SKILL/scripts/{script}", f'python3 "$SKILL/scripts/{script}"')
        open(p, "w", encoding="utf-8").write(t)
    if not generic:
        os.makedirs(os.path.join(dest, "agents"), exist_ok=True)
        open(os.path.join(dest, "agents", "openai.yaml"), "w", encoding="utf-8").write(OPENAI_YAML)
    leftovers = ("Claude Code", "claude.ai", "AskUserQuestion", "TodoWrite", "hooks/guard.py")
    if generic:
        leftovers += ("codex exec", "update_plan", ".claude/skills", ".codex/skills", "DeepSeek Harness")
    for leftover in leftovers:
        for dp, _, fns in os.walk(dest):
            for fn in fns:
                if fn.endswith((".md", ".yaml")) or (generic and fn.endswith(".py")):
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
    for _s in (sys.stdout, sys.stderr):  # Windows 控制台默认编码打不出中文
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generic", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    output = GENERIC_OUT if args.generic else OUT
    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            generated = os.path.join(tmp, "delivery-contract")
            build(generated, args.generic)
            if not same_tree(generated, output):
                command = "python3 codex-skill/build.py" + (" --generic" if args.generic else "")
                sys.exit(f"{os.path.relpath(output)} 不是最新的，运行 {command} 重新生成")
        print(f"{os.path.relpath(output)} 是最新的")
    else:
        build(output, args.generic)
        print(f"已生成 {os.path.relpath(output)}")
