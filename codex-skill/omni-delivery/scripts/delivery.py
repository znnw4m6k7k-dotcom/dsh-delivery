#!/usr/bin/env python3
"""交付流程状态工具（omni-delivery 技能）。替代 OmniAgent 后端的硬检查。

用法（在项目根目录或其子目录运行；也可用 --root 指定）：
  delivery.py init
  delivery.py check-contract
  delivery.py freeze <文件或目录…> --test "python3 -m unittest discover tests" [--test …] [--retry-reason …]
  delivery.py verify-hash
  delivery.py run-test [--purpose delivery|diagnostic] [--question …] [--cmd …] [--retry-reason …] [--timeout 900]
  delivery.py check-qa [qa文件]
  delivery.py status
  delivery.py check-report

退出码：0 通过；1 检查不通过（原因打印在输出里）；2 用法错误。
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys

D = ".delivery"
STATUSES = {"passed", "failed", "unverified"}
RELEASE = {"ready", "blocked", "not_assessed"}
VERIFICATIONS = {"independent", "artifact"}
COMPLIANCE = {"internet", "gov-cloud", "classified", "not-assessed"}
SKIP_DIRS = {".git", ".delivery", "node_modules", "__pycache__", ".venv", "venv", ".pytest_cache", "dist", "build"}
FAKE_TEST = [
    (r"^\s*(echo|printf|true|:)(\s|$)", "echo/printf/true 只是打印，不是测试"),
    (r"\bnode\s+(-e|--eval|-p|--print|-c|--check)\b", "node -e / node --check 只能用于诊断"),
    (r"\b(?:python3?|py)\s+-c\b", "python -c 一行脚本不是测试入口"),
    (r"\|\|\s*true\b|;\s*true\s*$|;\s*exit\s+0\s*$", "命令吞掉了失败退出码"),
]


def now():
    return dt.datetime.now().isoformat(timespec="seconds")


def fail(msg, code=1):
    print(f"✗ {msg}")
    sys.exit(code)


def ok(msg):
    print(f"✓ {msg}")


def find_root(start):
    d = os.path.abspath(start)
    while True:
        if os.path.isdir(os.path.join(d, D)):
            return d
        up = os.path.dirname(d)
        if up == d:
            return None
        d = up


def read_json(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as e:
        fail(f"{p} 不是合法 JSON：{e}")


def write_json(p, obj):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, p)


def read_jsonl(p):
    out = []
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    return out


def vnum(v):
    m = re.search(r"\d+", str(v or ""))
    return int(m.group(0)) if m else 0


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


class Ctx:
    def __init__(self, root):
        self.root = root
        self.d = os.path.join(root, D)

    def p(self, *a):
        return os.path.join(self.d, *a)

    def contract(self):
        return read_json(self.p("contract.json"))

    def freeze(self):
        return read_json(self.p("freeze.json"))

    def evidence(self):
        return read_jsonl(self.p("evidence.jsonl"))

    def used_versions(self):
        nums = set()
        for sub in ("freezes", "qa"):
            d = self.p(sub)
            if os.path.isdir(d):
                for n in os.listdir(d):
                    if n.endswith(".json"):
                        nums.add(vnum(n))
        fz = self.freeze()
        if fz:
            nums.add(vnum(fz.get("version")))
        return nums


def ctx_from(args, create=False):
    if create:
        return Ctx(os.path.abspath(args.root or os.getcwd()))
    root = find_root(args.root or os.getcwd())
    if not root:
        fail("没找到 .delivery/ 目录。先在项目根目录运行 `delivery.py init`。")
    return Ctx(root)


# ---------- contract ----------
def contract_problems(c):
    if c is None:
        return ["没有 .delivery/contract.json"]
    errs = []
    if not str(c.get("goal", "")).strip():
        errs.append("缺少 goal")
    acc = c.get("acceptance")
    if not isinstance(acc, list):
        errs.append("acceptance 必须是列表")
        acc = []
    if not acc and not str(c.get("no_criteria_reason", "")).strip():
        errs.append("acceptance 为空；确实没有验收标准时写 no_criteria_reason 说明原因")
    seen = set()
    for i, a in enumerate(acc, 1):
        rid = a.get("id")
        if not rid:
            errs.append(f"第 {i} 条验收缺少 id")
        elif rid in seen:
            errs.append(f"验收 id 重复：{rid}")
        seen.add(rid)
        if not str(a.get("statement", "")).strip():
            errs.append(f"{rid or i}: 缺少 statement")
        src = str(a.get("source", ""))
        if not re.match(r"^(request|discussion|answer:\S+|industry:\S+)$", src):
            errs.append(f"{rid or i}: source 必须是 request / discussion / answer:<问题id> / industry:<经验id>")
    ind = c.get("industry")
    if ind and not re.match(r"^[a-z0-9-]+/[a-z0-9-]+$", str(ind)):
        errs.append("industry 必须是两级：行业/细分场景，小写字母数字和连字符，如 gov/data-platform")
    if c.get("verification", "independent") not in VERIFICATIONS:
        errs.append("verification 必须是 independent 或 artifact")
    if c.get("compliance") and c["compliance"] not in COMPLIANCE:
        errs.append(f"compliance 必须是 {sorted(COMPLIANCE)} 之一")
    if c.get("confirmed_by_user") is not True:
        errs.append("合同还没经用户确认（confirmed_by_user 不是 true）")
    elif not str(c.get("confirmation_quote", "")).strip():
        errs.append("confirmed_by_user 为 true 但没有 confirmation_quote（用户确认时的原话）")
    return errs


def cmd_init(a):
    c = ctx_from(a, create=True)
    for sub in ("", "qa", "freezes", "retro"):
        os.makedirs(c.p(sub), exist_ok=True)
    readme = c.p("README.md")
    if not os.path.exists(readme):
        with open(readme, "w", encoding="utf-8") as f:
            f.write("# 交付记录（omni-delivery）\n\n"
                    "- contract.json：经用户确认的交付合同\n- freeze.json：当前冻结版本（只记录文件、哈希、测试命令）\n"
                    "- freezes/：历次冻结\n- evidence.jsonl：测试证据（run-test 自动写入）\n"
                    "- qa/<版本>.json：独立验收结论\n- report.md：交付报告\n- interview.jsonl：访谈问答\n"
                    "- industry-usage.jsonl：本次用过的行业经验\n- retro/：复盘候选\n")
    ok(f"已初始化 {c.d}")


def cmd_check_contract(a):
    c = ctx_from(a)
    errs = contract_problems(c.contract())
    for e in errs:
        print("✗", e)
    if errs:
        sys.exit(1)
    ok(f"合同有效：{len(c.contract().get('acceptance', []))} 条验收条目")


# ---------- freeze ----------
def fake_reason(cmd):
    for pat, why in FAKE_TEST:
        if re.search(pat, cmd):
            return why
    return None


def expand(root, paths):
    out = []
    for raw in paths:
        p = os.path.abspath(os.path.join(root, raw))
        rel = os.path.relpath(p, root)
        if rel.startswith(".."):
            fail(f"{raw} 不在项目目录 {root} 里")
        if rel.split(os.sep)[0] == D:
            fail(".delivery/ 下的文件不能冻结")
        if os.path.isdir(p):
            for dp, dns, fns in os.walk(p):
                dns[:] = sorted(d for d in dns if d not in SKIP_DIRS)
                for fn in sorted(fns):
                    out.append(os.path.relpath(os.path.join(dp, fn), root))
        elif os.path.isfile(p):
            out.append(rel)
        else:
            fail(f"文件不存在：{raw}")
    return sorted(set(out))


def cmd_freeze(a):
    c = ctx_from(a)
    errs = contract_problems(c.contract())
    if errs:
        fail("合同未就绪，不能冻结：" + "；".join(errs))
    con = c.contract()
    tests = [t.strip() for t in (a.test or []) if t.strip()]
    for t in tests:
        why = fake_reason(t)
        if why:
            fail(f"测试命令不合格：`{t}`（{why}）。请准备含真实断言的测试入口。")
    if con.get("verification", "independent") == "independent" and not tests:
        fail("verification=independent 需要至少一条真实测试命令（--test）。纯文档要用 artifact 方式，须先征得用户同意并写进合同。")
    old = c.freeze()
    if old and old.get("test_commands") and old.get("test_commands") != tests and not a.change_reason:
        fail("测试命令和上一版不同，需要用 --change-reason 说明为什么改测试命令。")
    files = expand(c.root, a.files)
    if not files:
        fail("没有要冻结的文件")
    ver = f"v{max(c.used_versions() | {0}) + 1}"
    fz = {"version": ver, "frozen_at": now(),
          "files": [{"path": f, "sha256": sha256(os.path.join(c.root, f))} for f in files],
          "test_commands": tests}
    if a.change_reason:
        fz["test_command_change_reason"] = a.change_reason
    if old:
        fz["previous"] = old.get("version")
    write_json(c.p("freezes", f"{ver}.json"), fz)
    write_json(c.p("freeze.json"), fz)
    ok(f"已冻结 {ver}：{len(files)} 个文件，{len(tests)} 条测试命令。现在派独立 QA；冻结期间不要再改这些文件。")


def hash_diff(c, fz):
    changed = []
    for f in fz.get("files", []):
        p = os.path.join(c.root, f["path"])
        if not os.path.exists(p):
            changed.append(f"{f['path']}（已删除）")
        elif sha256(p) != f["sha256"]:
            changed.append(f["path"])
    return changed


def cmd_verify_hash(a):
    c = ctx_from(a)
    fz = c.freeze()
    if not fz:
        fail("还没有冻结版本")
    changed = hash_diff(c, fz)
    if changed:
        fail(f"版本 {fz['version']} 已变化，需要重新冻结：" + "、".join(changed))
    ok(f"文件与冻结版本 {fz['version']} 一致（{len(fz['files'])} 个）")


# ---------- run-test ----------
def parse_counts(out):
    """返回 (passed, failed, skipped) 或 None（数不出来）。"""
    t = re.sub(r"\x1b\[[0-9;]*m", "", out)
    # jest / vitest
    m = re.findall(r"^\s*Tests?:?\s+(.*?)$", t, re.M)
    for line in reversed(m):
        nums = dict((k, int(v)) for v, k in re.findall(r"(\d+)\s+(passed|failed|skipped|todo|total)", line))
        if "passed" in nums or "failed" in nums:
            return nums.get("passed", 0), nums.get("failed", 0), nums.get("skipped", 0) + nums.get("todo", 0)
    # pytest summary
    m = re.findall(r"^=+ (.*?) in [\d.]+s.*=+$", t, re.M)
    for line in reversed(m):
        nums = {}
        for v, k in re.findall(r"(\d+) (passed|failed|errors?|skipped|xfailed|xpassed|deselected)", line):
            nums[k] = nums.get(k, 0) + int(v)
        if nums:
            failed = nums.get("failed", 0) + nums.get("error", 0) + nums.get("errors", 0) + nums.get("xpassed", 0)
            return nums.get("passed", 0), failed, nums.get("skipped", 0) + nums.get("xfailed", 0)
    # unittest
    m = re.search(r"^Ran (\d+) tests? in", t, re.M)
    if m:
        total = int(m.group(1))
        f = re.search(r"^FAILED \((.*?)\)", t, re.M)
        okm = re.search(r"^OK(?: \((.*?)\))?\s*$", t, re.M)
        detail = (f.group(1) if f else (okm.group(1) if okm and okm.group(1) else "")) or ""
        nums = dict((k, int(v)) for k, v in re.findall(r"(\w+)=(\d+)", detail))
        failed = nums.get("failures", 0) + nums.get("errors", 0) + nums.get("unexpected_successes", 0)
        skipped = nums.get("skipped", 0) + nums.get("expected_failures", 0)
        if f or okm:
            return total - failed - skipped, failed, skipped
    # node --test (TAP 或 spec reporter)
    p = re.search(r"^(?:#|ℹ)\s*pass\s+(\d+)", t, re.M)
    fl = re.search(r"^(?:#|ℹ)\s*fail\s+(\d+)", t, re.M)
    if p and fl:
        sk = re.search(r"^(?:#|ℹ)\s*skipped\s+(\d+)", t, re.M)
        return int(p.group(1)), int(fl.group(1)), int(sk.group(1)) if sk else 0
    # go test -v
    gp, gf, gs = (len(re.findall(rf"^\s*--- {k}:", t, re.M)) for k in ("PASS", "FAIL", "SKIP"))
    if gp or gf or gs:
        return gp, gf, gs
    return None


def judge(code, counts):
    if counts is None:
        return "failed" if code != 0 else "count_unknown"
    passed, failed, _ = counts
    if code != 0 or failed > 0:
        return "failed"
    if passed == 0:
        return "count_unknown"
    return "passed"


def run_one(c, cmd, timeout):
    try:
        r = subprocess.run(cmd, shell=True, cwd=c.root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
        out, code = (r.stdout or "") + "\n" + (r.stderr or ""), r.returncode
    except subprocess.TimeoutExpired as e:
        out = f"{e.stdout or ''}\n{e.stderr or ''}\n[超时 {timeout}s]"
        code = 124
    return out, code


def append_evidence(c, rec):
    ev = c.evidence()
    rec = {"id": f"ev-{len(ev) + 1}", "ts": now(), **rec}
    with open(c.p("evidence.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return rec


def cmd_run_test(a):
    c = ctx_from(a)
    fz = c.freeze()
    if not fz:
        fail("还没有冻结版本；先 freeze。")
    changed = hash_diff(c, fz)
    if changed:
        fail(f"版本 {fz['version']} 已变化（{'、'.join(changed)}），先重新冻结再测试。")
    if a.purpose == "diagnostic":
        if not a.question or not a.cmd:
            fail("diagnostic 运行必须同时给 --question（要回答的问题）和 --cmd。")
        cmds = [a.cmd]
    else:
        if a.cmd and a.cmd not in fz.get("test_commands", []):
            fail("delivery 运行只能跑 freeze.json 里的测试命令；要排查别的命令请用 --purpose diagnostic。")
        cmds = [a.cmd] if a.cmd else fz.get("test_commands", [])
        if not cmds:
            fail("冻结版本没有测试命令（artifact 验收不需要 run-test，逐条核对文件原文即可）。")
        prev = [e for e in c.evidence() if e.get("version") == fz["version"] and e.get("purpose") == "delivery"]
        for cmd in cmds:
            if any(e.get("command") == cmd for e in prev) and not a.retry_reason:
                fail(f"版本 {fz['version']} 已经正式跑过 `{cmd}`。同版本同命令不得原样重跑；"
                     "要么改代码重新冻结，要么只在修了环境/测试方式时加 --retry-reason 说明。")
    worst = 0
    for cmd in cmds:
        out, code = run_one(c, cmd, a.timeout)
        counts = parse_counts(out)
        status = judge(code, counts)
        rec = append_evidence(c, {
            "version": fz["version"], "purpose": a.purpose, "command": cmd, "exit_code": code,
            "counts": dict(zip(("passed", "failed", "skipped"), counts)) if counts else None,
            "status": status, "question": a.question, "retry_reason": a.retry_reason,
            "output_tail": out[-2000:],
        })
        cnt = "测试数量未确认" if counts is None else f"通过 {counts[0]} / 失败 {counts[1]} / 跳过 {counts[2]}"
        tag = "（诊断，不算验收）" if a.purpose == "diagnostic" else ""
        print(f"[{rec['id']}] {status} · {cnt} · 退出码 {code} · `{cmd}`{tag}")
        if status != "passed" and (a.purpose == "delivery" or code != 0):
            worst = 1
            print("    输出末尾：\n" + "\n".join("    " + l for l in out.strip().splitlines()[-15:]))
    sys.exit(worst)


# ---------- QA ----------
def qa_problems(c, qa, fz):
    errs = []
    con = c.contract() or {}
    if qa.get("freeze_version") != fz.get("version"):
        errs.append(f"freeze_version 是 {qa.get('freeze_version')}，但当前冻结版本是 {fz.get('version')}；历史 QA 不算当前通过")
    reqs = qa.get("requirements") or []
    ids = [r.get("requirement_id") for r in reqs]
    want = [x.get("id") for x in con.get("acceptance", [])]
    missing = [i for i in want if i not in ids]
    extra = [i for i in ids if i not in want]
    if missing:
        errs.append("缺少这些验收条目的结论：" + "、".join(missing))
    if extra:
        errs.append("出现合同里没有的条目：" + "、".join(map(str, extra)))
    evid = {e["id"]: e for e in c.evidence() if e.get("version") == fz.get("version")}
    for r in reqs:
        rid = r.get("requirement_id")
        st = r.get("status")
        if st not in STATUSES:
            errs.append(f"{rid}: status 必须是 passed/failed/unverified")
        if st == "passed":
            ev = str(r.get("evidence", "")).strip()
            if not ev:
                errs.append(f"{rid}: passed 但没有证据")
            for eid in re.findall(r"\bev-\d+\b", ev):
                e = evid.get(eid)
                if not e:
                    errs.append(f"{rid}: 证据 {eid} 不存在或不属于当前版本")
                elif e.get("purpose") != "delivery":
                    errs.append(f"{rid}: {eid} 是诊断运行，不能作为验收证据")
                elif e.get("status") != "passed":
                    errs.append(f"{rid}: {eid} 的结果是 {e.get('status')}，不能支撑 passed")
    rs = qa.get("release_status")
    if rs not in RELEASE:
        errs.append("release_status 必须是 ready/blocked/not_assessed")
    if rs == "ready":
        if any(r.get("status") != "passed" for r in reqs) or missing:
            errs.append("还有未通过或未核对的条目，release_status 不能是 ready")
        if qa.get("must_fix"):
            errs.append("must_fix 不为空，release_status 不能是 ready")
        if con.get("verification", "independent") == "independent":
            good = [e for e in evid.values() if e.get("purpose") == "delivery" and e.get("status") == "passed"]
            bad = [e for e in evid.values() if e.get("purpose") == "delivery" and e.get("status") != "passed"
                   and not any(g.get("command") == e.get("command") and vnum(g["id"]) > vnum(e["id"]) for g in good)]
            if not good:
                errs.append("independent 验收但当前版本没有任何通过的正式测试证据（run-test）")
            if bad:
                errs.append("当前版本仍有未通过的正式测试：" + "、".join(e["id"] for e in bad))
    for k in ("must_fix", "suggestions", "release_gaps"):
        if k in qa and not isinstance(qa[k], list):
            errs.append(f"{k} 必须是列表")
    return errs


def cmd_check_qa(a):
    c = ctx_from(a)
    fz = c.freeze()
    if not fz:
        fail("还没有冻结版本")
    path = a.file or c.p("qa", f"{fz['version']}.json")
    qa = read_json(path)
    if qa is None:
        fail(f"没有 QA 结论文件：{path}")
    errs = qa_problems(c, qa, fz)
    for e in errs:
        print("✗", e)
    if errs:
        sys.exit(1)
    self_qa = "（非独立：角色切换式验收）" if qa.get("independence") == "self" else ""
    ok(f"QA 结论有效：{fz['version']} release_status={qa['release_status']}{self_qa}")


# ---------- status / report ----------
def compute_status(c):
    con = c.contract()
    errs = contract_problems(con)
    if errs:
        return "contract_required", errs
    fz = c.freeze()
    if not fz:
        return "integration_required", ["实现完成后运行 freeze 冻结版本"]
    changed = hash_diff(c, fz)
    qa = read_json(c.p("qa", f"{fz['version']}.json"))
    if changed and not qa:
        return "revision_changed", [f"{fz['version']} 冻结后又改了：" + "、".join(changed) + "；重新 freeze"]
    if not qa:
        return "qa_required", [f"派一个独立 QA 验收 {fz['version']}"]
    qerrs = qa_problems(c, qa, fz)
    if qerrs:
        return "qa_invalid", qerrs
    if qa.get("release_status") != "ready":
        return "qa_requires_attention", [f"{fz['version']} 未通过：按 must_fix 修改 → 重新 freeze → 再验收"] + \
            [f"must_fix: {m}" for m in qa.get("must_fix", [])]
    if changed:
        return "revision_changed", [f"{fz['version']} 验收后又改了：" + "、".join(changed) + "；重新 freeze 并验收"]
    if not os.path.exists(c.p("report.md")):
        return "report_allowed", ["可以写 .delivery/report.md"]
    return "report_recorded", ["报告已写；运行 check-report 自查，然后请用户验收"]


def cmd_status(a):
    c = ctx_from(a)
    fz = c.freeze()
    state, notes = compute_status(c)
    print(json.dumps({"root": c.root, "version": fz.get("version") if fz else None,
                      "next_action": state, "notes": notes}, ensure_ascii=False, indent=2))


SECTIONS = [("目标", "goal"), ("复用", "reuse"), ("结果", "result"), ("验证", "verif"),
            ("风险", "risk"), ("假设", "assum"), ("未完成", "open")]


def cmd_check_report(a):
    c = ctx_from(a)
    p = c.p("report.md")
    if not os.path.exists(p):
        fail("没有 .delivery/report.md")
    text = open(p, encoding="utf-8").read()
    low = text.lower()
    errs = [f"缺少「{zh}」部分" for zh, en in SECTIONS if zh not in text and en not in low]
    state, notes = compute_status(c)
    if state not in ("report_allowed", "report_recorded"):
        if "未验收" not in text and "not accepted" not in low:
            errs.append(f"当前状态是 {state}（{'；'.join(notes[:2])}），报告必须写明「未验收」及原因")
    fz = c.freeze() or {}
    qa = read_json(c.p("qa", f"{fz.get('version')}.json")) if fz else None
    if qa and qa.get("independence") == "self" and "非独立" not in text and "not independent" not in low:
        errs.append("本次是角色切换式验收，报告里必须写明「非独立验收」")
    for e in errs:
        print("✗", e)
    if errs:
        sys.exit(1)
    ok("报告结构完整，状态声明与验收结论一致")



def _utf8_console():
    # Windows 控制台默认编码（cp1252/GBK）打不出部分中文和符号，统一用 UTF-8 输出
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def main():
    _utf8_console()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", help="项目根目录（默认从当前目录向上找 .delivery/）")
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("init").set_defaults(f=cmd_init)
    sp.add_parser("check-contract").set_defaults(f=cmd_check_contract)
    f = sp.add_parser("freeze")
    f.add_argument("files", nargs="+")
    f.add_argument("--test", action="append")
    f.add_argument("--change-reason")
    f.set_defaults(f=cmd_freeze)
    sp.add_parser("verify-hash").set_defaults(f=cmd_verify_hash)
    r = sp.add_parser("run-test")
    r.add_argument("--purpose", choices=["delivery", "diagnostic"], default="delivery")
    r.add_argument("--question")
    r.add_argument("--cmd")
    r.add_argument("--retry-reason")
    r.add_argument("--timeout", type=int, default=900)
    r.set_defaults(f=cmd_run_test)
    q = sp.add_parser("check-qa")
    q.add_argument("file", nargs="?")
    q.set_defaults(f=cmd_check_qa)
    sp.add_parser("status").set_defaults(f=cmd_status)
    sp.add_parser("check-report").set_defaults(f=cmd_check_report)
    a = ap.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
