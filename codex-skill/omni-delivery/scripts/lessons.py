#!/usr/bin/env python3
"""行业经验包工具：脱敏检查、合并已确认经验、使用打分、渲染。

用法：
  lessons.py new-pack  <pack_dir> --industry gov --scenario data-platform --title 政务数据平台
  lessons.py scan      <candidates.jsonl> [--terms client_terms.txt]
  lessons.py merge     <pack_dir> <candidates.jsonl> --project P-2026-001 [--terms client_terms.txt]
  lessons.py score     <pack_dir> <usage.jsonl> --project P-2026-001
  lessons.py render    <pack_dir>
  lessons.py package   <pack_dir> [--out 目录]     # 打成 zip，用于在 claude.ai 设置里上传

经验包目录建议：Codex 用 ~/.codex/skills/industry-<行业>-<细分场景>/；
Claude Code 用 ~/.claude/skills/ 下的同名文件夹；claude.ai 用 package 打成 zip 上传。

只有 review 字段为 "approved" 的候选会被合并；"edited" 视为用户修改后批准。
"""
import argparse
import datetime as dt
import json
import os
import re
import shutil
import sys

TYPES = ["intake", "acceptance", "practice", "pitfall", "template", "compliance"]
TYPE_NAMES = {"intake": "需求模式", "acceptance": "验收条目", "practice": "有效做法",
              "pitfall": "踩坑", "template": "交付模板", "compliance": "合规"}
PATTERNS = [
    ("手机号", r"(?<!\d)1[3-9]\d{9}(?!\d)"),
    ("身份证号", r"(?<!\d)\d{17}[\dXx](?!\d)"),
    ("邮箱", r"[\w.+-]+@[\w-]+\.[\w.]+"),
    ("银行卡/长数字", r"(?<!\d)\d{15,19}(?!\d)"),
    ("金额", r"(?:¥|￥|人民币)\s*\d|\d+(?:\.\d+)?\s*(?:万元|亿元|元)"),
    ("IP 地址", r"(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)"),
    ("网址", r"https?://\S+"),
    ("密钥", r"(?i)(?:api[_-]?key|secret|token|password|passwd)\s*[:=]"),
]
MARK_BEGIN = "<!-- top-lessons:begin -->"
MARK_END = "<!-- top-lessons:end -->"


def today():
    return dt.date.today().isoformat()


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError as e:
                    sys.exit(f"{path}:{n}: JSON 无效: {e}")
    return out


def write_jsonl(path, rows):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def lessons_path(pack):
    return os.path.join(pack, "references", "lessons.jsonl")


def text_of(c):
    return " ".join(str(c.get(k, "")) for k in ("statement", "rationale", "applies_when")) + " " + \
        " ".join(str(e.get("quote", "")) for e in c.get("evidence", []))


def scan_rows(rows, terms):
    problems = []
    for i, c in enumerate(rows, 1):
        t = text_of(c)
        for name, pat in PATTERNS:
            for m in re.finditer(pat, t):
                problems.append((i, c.get("id", "?"), name, m.group(0)))
        for term in terms:
            if term and term in t:
                problems.append((i, c.get("id", "?"), "客户相关词", term))
    return problems


def load_terms(path):
    if not path:
        return []
    with open(path, encoding="utf-8") as f:
        return [l.strip() for l in f if l.strip() and not l.startswith("#")]


def validate(c):
    errs = []
    if c.get("type") not in TYPES:
        errs.append(f"type 必须是 {sorted(TYPES)}")
    if not str(c.get("statement", "")).strip():
        errs.append("缺少 statement")
    if not c.get("evidence"):
        errs.append("缺少 evidence（经验必须有来源）")
    conf = c.get("confidence", 0.5)
    if not isinstance(conf, (int, float)) or not 0 <= conf <= 1:
        errs.append("confidence 必须在 0–1 之间")
    return errs


def cmd_new_pack(a):
    if os.path.exists(os.path.join(a.pack, "pack.json")):
        sys.exit(f"{a.pack} 已经是经验包")
    name = f"industry-{a.industry}-{a.scenario}"
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", name) or len(name) > 64:
        sys.exit(f"技能名 {name} 不合规：行业和细分场景只能用小写字母、数字和连字符，总长不超过 64")
    if os.path.basename(os.path.normpath(a.pack)) != name:
        print(f"提醒：经验包文件夹最好命名为 {name}，与技能名一致")
    tpl = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "pack-template")
    shutil.copytree(tpl, a.pack, dirs_exist_ok=True)
    skill = os.path.join(a.pack, "SKILL.md")
    os.replace(os.path.join(a.pack, "SKILL.md.tmpl"), skill)
    body = open(skill, encoding="utf-8").read()
    body = body.replace("industry-TEMPLATE", name).replace("{{TITLE}}", a.title)
    open(skill, "w", encoding="utf-8").write(body)
    meta = {"industry": a.industry, "scenario": a.scenario, "title": a.title,
            "version": 0, "created": today(), "projects": []}
    with open(os.path.join(a.pack, "pack.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    open(lessons_path(a.pack), "a").close()
    cmd_render(a)
    print(f"已创建经验包 {a.pack}（技能名 {name}）")


def cmd_scan(a):
    rows = read_jsonl(a.candidates)
    probs = scan_rows(rows, load_terms(a.terms))
    for i, cid, name, hit in probs:
        print(f"第 {i} 条 {cid}: 疑似{name}: {hit}")
    bad = 0
    for i, c in enumerate(rows, 1):
        for e in validate(c):
            print(f"第 {i} 条 {c.get('id', '?')}: {e}")
            bad += 1
    if probs or bad:
        sys.exit(1)
    print(f"{len(rows)} 条候选检查通过")


def cmd_merge(a):
    cands = read_jsonl(a.candidates)
    probs = scan_rows([c for c in cands if c.get("review") in ("approved", "edited")], load_terms(a.terms))
    if probs:
        for p in probs:
            print("脱敏未通过:", p)
        sys.exit("先修改或删除这些候选，再合并。")
    lessons = read_jsonl(lessons_path(a.pack))
    by_id = {l["id"]: l for l in lessons}
    meta_p = os.path.join(a.pack, "pack.json")
    meta = json.load(open(meta_p, encoding="utf-8"))
    prefix = f"{meta['industry']}-{meta['scenario']}"
    n_next = 1 + max([int(m.group(1)) for l in lessons
                      for m in [re.search(r"-(\d+)$", l["id"])] if m] or [0])
    added, changed, log = 0, 0, []
    for c in cands:
        if c.get("review") not in ("approved", "edited"):
            continue
        errs = validate(c)
        if errs:
            sys.exit(f"候选 {c.get('id')} 不合格: {errs}")
        ev = [dict(e, project=a.project) for e in c["evidence"]]
        target = c.get("supersedes") or c.get("updates")
        if c.get("updates") and target in by_id:
            l = by_id[target]
            l.update({k: c[k] for k in ("statement", "rationale", "applies_when", "confidence") if k in c})
            l["evidence"] = l.get("evidence", []) + ev
            l["updated"] = today()
            l["revision"] = l.get("revision", 1) + 1
            changed += 1
            log.append(f"- 更新 {target}：{l['statement']}")
            continue
        lid = f"{prefix}-{n_next:03d}"
        n_next += 1
        new = {"id": lid, "type": c["type"], "statement": c["statement"],
               "rationale": c.get("rationale", ""), "applies_when": c.get("applies_when", ""),
               "evidence": ev, "confidence": c.get("confidence", 0.5), "status": "active",
               "uses": 0, "helpful": 0, "harmful": 0, "revision": 1,
               "created": today(), "updated": today()}
        if c.get("supersedes") and target in by_id:
            by_id[target]["status"] = "superseded"
            by_id[target]["superseded_by"] = lid
            by_id[target]["updated"] = today()
            log.append(f"- {target} 被 {lid} 取代")
        lessons.append(new)
        by_id[lid] = new
        added += 1
        log.append(f"- 新增 {lid}（{TYPE_NAMES[new['type']]}）：{new['statement']}")
    write_jsonl(lessons_path(a.pack), lessons)
    meta["version"] += 1
    if a.project not in meta["projects"]:
        meta["projects"].append(a.project)
    json.dump(meta, open(meta_p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    with open(os.path.join(a.pack, "CHANGELOG.md"), "a", encoding="utf-8") as f:
        f.write(f"\n## v{meta['version']} · {today()} · 来自 {a.project}\n" + "\n".join(log) + "\n")
    cmd_render(a)
    print(f"合并完成：新增 {added} 条，更新 {changed} 条，经验包 v{meta['version']}")


def cmd_score(a):
    lessons = read_jsonl(lessons_path(a.pack))
    by_id = {l["id"]: l for l in lessons}
    for u in read_jsonl(a.usage):
        l = by_id.get(u.get("id"))
        if not l:
            print("未知经验:", u.get("id"))
            continue
        verdict = u.get("verdict")
        if verdict not in ("helpful", "neutral", "harmful"):
            sys.exit(f"{u.get('id')}: verdict 必须是 helpful/neutral/harmful")
        l["uses"] += 1
        if verdict == "helpful":
            l["helpful"] += 1
        elif verdict == "harmful":
            l["harmful"] += 1
        # 以入库时的置信度为先验，相当于 2 次虚拟使用
        prior = l.setdefault("prior", l["confidence"])
        l["confidence"] = round((l["helpful"] + 2 * prior) / (l["helpful"] + l["harmful"] + 2), 2)
        l.setdefault("usage_log", []).append({"project": a.project, "verdict": verdict,
                                               "note": u.get("note", ""), "date": today()})
        if l["harmful"] >= 2 and l["harmful"] > l["helpful"]:
            l["status"] = "needs_review"
        l["updated"] = today()
    write_jsonl(lessons_path(a.pack), lessons)
    cmd_render(a)
    print("打分完成")


def rank(l):
    return (l["confidence"], l["helpful"], l["uses"])


def cmd_render(a):
    lessons = read_jsonl(lessons_path(a.pack))
    active = [l for l in lessons if l.get("status") == "active"]
    lines = ["# 经验全集（自动生成，勿手改；改动请走复盘流程）\n"]
    for t in TYPES:
        group = sorted([l for l in active if l["type"] == t], key=rank, reverse=True)
        if not group:
            continue
        lines.append(f"\n## {TYPE_NAMES[t]}\n")
        for l in group:
            lines.append(f"- **{l['id']}** {l['statement']}（可信度 {l['confidence']}，用过 {l['uses']} 次，有用 {l['helpful']} 次）")
            if l.get("applies_when"):
                lines.append(f"  - 适用：{l['applies_when']}")
            if l.get("rationale"):
                lines.append(f"  - 原因：{l['rationale']}")
    others = [l for l in lessons if l.get("status") != "active"]
    if others:
        lines.append("\n## 已取代 / 待复查\n")
        for l in others:
            tail = f"→ {l['superseded_by']}" if l.get("superseded_by") else ""
            lines.append(f"- ~~{l['id']}~~ [{l['status']}] {l['statement']} {tail}")
    open(os.path.join(a.pack, "references", "lessons.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    skill = os.path.join(a.pack, "SKILL.md")
    if os.path.exists(skill):
        body = open(skill, encoding="utf-8").read()
        top = sorted(active, key=rank, reverse=True)[:10]
        block = "\n".join(f"{i}. [{l['id']}] {l['statement']}" for i, l in enumerate(top, 1)) or "（还没有经验）"
        if MARK_BEGIN in body and MARK_END in body:
            pre, rest = body.split(MARK_BEGIN, 1)
            _, post = rest.split(MARK_END, 1)
            body = f"{pre}{MARK_BEGIN}\n{block}\n{MARK_END}{post}"
            open(skill, "w", encoding="utf-8").write(body)


def cmd_package(a):
    import zipfile
    pack = os.path.normpath(a.pack)
    meta = json.load(open(os.path.join(pack, "pack.json"), encoding="utf-8"))
    name = f"industry-{meta['industry']}-{meta['scenario']}"
    out_dir = a.out or os.path.dirname(os.path.abspath(pack))
    out = os.path.join(out_dir, f"{name}-v{meta['version']}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, dns, fns in os.walk(pack):
            dns[:] = [d for d in dns if not d.startswith(".") or d == "."]
            for fn in fns:
                if fn.endswith(".tmp"):
                    continue
                full = os.path.join(dp, fn)
                z.write(full, os.path.join(name, os.path.relpath(full, pack)))
    print(f"已打包：{out}（在 claude.ai 设置 → 技能 里上传；先删除旧版本）")



def _utf8_console():
    # Windows 控制台默认编码（cp1252/GBK）打不出部分中文和符号，统一用 UTF-8 输出
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def main():
    _utf8_console()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    s = p.add_subparsers(dest="cmd", required=True)
    n = s.add_parser("new-pack"); n.add_argument("pack"); n.add_argument("--industry", required=True)
    n.add_argument("--scenario", required=True); n.add_argument("--title", required=True)
    n.set_defaults(f=cmd_new_pack)
    c = s.add_parser("scan"); c.add_argument("candidates"); c.add_argument("--terms"); c.set_defaults(f=cmd_scan)
    m = s.add_parser("merge"); m.add_argument("pack"); m.add_argument("candidates")
    m.add_argument("--project", required=True); m.add_argument("--terms"); m.set_defaults(f=cmd_merge)
    sc = s.add_parser("score"); sc.add_argument("pack"); sc.add_argument("usage")
    sc.add_argument("--project", required=True); sc.set_defaults(f=cmd_score)
    r = s.add_parser("render"); r.add_argument("pack"); r.set_defaults(f=cmd_render)
    pk = s.add_parser("package"); pk.add_argument("pack"); pk.add_argument("--out"); pk.set_defaults(f=cmd_package)
    a = p.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
