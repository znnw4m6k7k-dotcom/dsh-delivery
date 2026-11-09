#!/usr/bin/env python3
"""delivery-contract 交付守卫：Claude Code PreToolUse hook（可选）。

只在项目里存在 .delivery/ 目录时生效，对其他会话没有影响。
  R1 冻结后等待验收期间，冻结清单里的文件禁止修改（Write/Edit/MultiEdit；Bash 做简单识别）
  R2 freeze.json：版本号只能递增；已有 QA 结论的版本不能覆盖；不能预填 QA 结论
  R3 .delivery/qa/*.json 只能由子 Agent（QA）写（Claude Code 在 hook 输入里提供 agent_id 时生效）
  R4 当前冻结版本还没有 QA 结论时，不能写 report.md（除非写明"未验收"及原因）
  R5 行业经验包的 lessons.jsonl 只能通过 lessons.py merge/score 写入

被拦截：退出码 2，原因写到 stderr（Claude 会看到）。守卫自身出错时放行，不阻断工作。
"""
import json
import os
import re
import sys

QA_KEYS = ["qa", "release_status", "requirements", "verdict", "qa_result", "qa_status"]
WRITE_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit"}
# 判断 bash 命令会不会写文件：先去掉引号内容和 heredoc 正文，只看 shell 层的重定向和写命令，
# 避免把 node -e '…=>…'、cp=require(…) 这类脚本代码误当成写操作；脚本里的写文件调用另用 CODE_WRITE 识别。
SHELL_WRITE = re.compile(r"(?:^|[\s;&|(])(?:\d?>>?(?![&>])(?!\s*/dev/null)|&>)|\btee\b|\bsed\s+(?:-[a-zA-Z]*\s+)*-i|\bmv\b|\bcp\b|\brm\b|\btruncate\b|\bdd\b|\bln\b|\binstall\b|\bperl\s+-[a-z]*i")
CODE_WRITE = re.compile(r"\b(?:writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream|renameSync|unlinkSync|rmSync|copyFileSync|cpSync|write_text|write_bytes|shutil\.(?:copy\w*|move|rmtree)|os\.(?:remove|unlink|rename|replace))\b|\bopen\([^)]*,\s*['\"][wax]")
PWSH_WRITE = re.compile(r"\b(?:Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Clear-Content|Tee-Object|Expand-Archive)\b|\[(?:System\.)?IO\.File\]::(?:Write|Append|Copy|Move|Delete|Replace)|(?:^|[\s;|(])(?:ni|ri|del|erase|rd|rmdir|mi|move|copy|cpi|ren|sc|ac|clc)\s", re.I)
SHELL_TOOLS = {"Bash", "PowerShell"}  # Windows 版 Claude Code 可能用 PowerShell 工具跑命令
HEREDOC = re.compile(r"(<<-?\s*(['\"]?)([A-Za-z_]\w*)\2[^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)")


def shell_skeleton(cmd):
    s = HEREDOC.sub(r"\1", str(cmd or ""))
    s = re.sub(r"'[^']*'", "''", s)
    s = re.sub(r'"(?:\\.|[^"\\])*"', '""', s)
    return s


def looks_write(cmd):
    skel = shell_skeleton(cmd)
    return bool(SHELL_WRITE.search(skel) or PWSH_WRITE.search(skel) or CODE_WRITE.search(str(cmd or "")))


def read_json(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def vnum(v):
    m = re.search(r"\d+", str(v if v is not None else ""))
    return int(m.group(0)) if m else None


def find_root(start):
    d = os.path.abspath(start)
    for _ in range(60):
        if os.path.isdir(os.path.join(d, ".delivery")):
            return d
        up = os.path.dirname(d)
        if up == d:
            return None
        d = up
    return None


def state(root):
    fz = read_json(os.path.join(root, ".delivery", "freeze.json")) or {}
    ver = fz.get("version")
    qa_dir = os.path.join(root, ".delivery", "qa")
    qa_exists = bool(ver) and any(os.path.exists(os.path.join(qa_dir, n)) for n in (f"{ver}.json", f"qa-{ver}.json"))
    files = []
    for f in fz.get("files", []) or []:
        p = f.get("path") if isinstance(f, dict) else f
        if isinstance(p, str):
            files.append(os.path.normpath(os.path.join(root, p)))
    return ver, qa_exists, files


def after_edit(path, tool, ti):
    if tool == "Write":
        return str(ti.get("content", ""))
    try:
        cur = open(path, encoding="utf-8").read()
    except Exception:
        cur = ""
    edits = ti.get("edits") if tool == "MultiEdit" else [ti]
    for e in edits or []:
        old, new = str(e.get("old_string", "")), str(e.get("new_string", ""))
        if not old:
            cur = new
        elif e.get("replace_all"):
            cur = cur.replace(old, new)
        else:
            cur = cur.replace(old, new, 1)
    return cur


def evaluate(tool, ti, cwd, is_root):
    if tool in SHELL_TOOLS:
        return evaluate_bash(ti, cwd)
    if tool not in WRITE_TOOLS:
        return None
    raw = ti.get("file_path") or ti.get("notebook_path") or ti.get("path")
    if not isinstance(raw, str):
        return None
    target = os.path.normpath(os.path.join(cwd or "/", os.path.expanduser(raw)))
    base = os.path.basename(target)

    if base == "lessons.jsonl" and re.search(r"[\\/]industry-[^\\/]+[\\/]", target):
        return "行业经验只能经用户逐条确认后，用 `python3 <delivery-contract>/scripts/lessons.py merge` 写入，不能直接编辑 lessons.jsonl。"

    root = find_root(os.path.dirname(target))
    if not root:
        return None
    ddir = os.path.join(root, ".delivery")
    rel = os.path.relpath(target, ddir)
    ver, qa_exists, files = state(root)

    if rel == "freeze.json":
        try:
            nxt = json.loads(after_edit(target, tool, ti))
        except Exception:
            return "freeze.json 必须是合法 JSON。建议用 `delivery.py freeze` 生成，不要手写。"
        pre = [k for k in QA_KEYS if k in nxt]
        if pre:
            return f"freeze.json 只记录版本、文件、哈希和测试命令，不能包含验收结论字段（{', '.join(pre)}）。验收结论由 QA 写入 .delivery/qa/<版本>.json。"
        if nxt.get("version") is None:
            return "freeze.json 缺少 version 字段。"
        a, b = vnum(nxt.get("version")), vnum(ver)
        if a is not None and b is not None:
            if a < b:
                return f"版本号只能递增：当前已冻结 {ver}，不能改成更小的 {nxt.get('version')}。"
            if a == b and qa_exists:
                return f"版本 {ver} 已有 QA 结论，不能覆盖。改了文件就用 `delivery.py freeze` 冻结为新版本。"
        if os.path.exists(os.path.join(ddir, "qa", f"{nxt.get('version')}.json")):
            return f"版本 {nxt.get('version')} 已经验收过，请使用新的版本号。"
        return None

    if rel.startswith("qa" + os.sep) and rel.endswith(".json"):
        if is_root is True:
            return "QA 结论只能由独立 QA 子 Agent 写入，主 Agent 不能写或修改 .delivery/qa/ 下的文件。"
        return None

    if rel == "report.md" and ver and not qa_exists:
        if "未验收" not in after_edit(target, tool, ti):
            return f"当前冻结版本 {ver} 还没有独立 QA 结论（.delivery/qa/{ver}.json）。先等 QA 返回再写报告；确实无法验收时，在报告里写明“未验收”及原因。"
        return None

    if ver and not qa_exists and target in files:
        return f"{os.path.relpath(target, root)} 属于已冻结的版本 {ver}，正在等待独立验收，不能修改。等 QA 结果出来再改；或先重新 freeze 为新版本（这会作废当前这轮验收）。"
    return None


def evaluate_bash(ti, cwd):
    cmd = str(ti.get("command", ""))
    if "lessons.jsonl" in cmd and looks_write(cmd) and "lessons.py" not in cmd:
        return "行业经验只能用 `lessons.py merge` 写入，不能用 shell 直接改 lessons.jsonl。"
    if not cwd:
        return None
    root = find_root(cwd)
    if not root:
        return None
    ver, qa_exists, files = state(root)
    if not ver or qa_exists or not looks_write(cmd):
        return None
    for f in files:
        rel = os.path.relpath(f, root)
        c = cmd.replace("\\", "/")
        if rel and (rel in cmd or f in cmd or rel.replace("\\", "/") in c or f.replace("\\", "/") in c):
            return f"命令看起来会修改已冻结的 {rel}（版本 {ver} 正在等待验收）。等 QA 结果出来再改，或先重新 freeze。"
    return None



def _utf8_console():
    # Windows 控制台默认编码（cp1252/GBK）打不出部分中文和符号，统一用 UTF-8 输出
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def main():
    _utf8_console()
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace"))
        tool = data.get("tool_name", "")
        ti = data.get("tool_input") or {}
        cwd = data.get("cwd") or os.getcwd()
        if "agent_id" in data:
            is_root = not bool(data.get("agent_id"))
        else:
            is_root = None
        reason = evaluate(tool, ti, cwd, is_root)
    except Exception:
        sys.exit(0)
    if reason:
        print(f"[交付守卫] {reason}", file=sys.stderr)
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
