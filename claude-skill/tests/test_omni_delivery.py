"""omni-delivery 技能脚本的端到端测试：python3 -m unittest discover -s claude-skill/tests"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

SKILL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "omni-delivery")
DELIVERY = os.path.join(SKILL, "scripts", "delivery.py")
LESSONS = os.path.join(SKILL, "scripts", "lessons.py")
GUARD = os.path.join(SKILL, "hooks", "guard.py")


def run(args, cwd, stdin=None):
    return subprocess.run([sys.executable, *args], cwd=cwd, input=stdin, capture_output=True, text=True)


class DeliveryFlow(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.d, "tests"))
        with open(os.path.join(self.d, "calc.py"), "w") as f:
            f.write("def add(a, b):\n    return a + b\n")
        with open(os.path.join(self.d, "tests", "__init__.py"), "w"):
            pass
        with open(os.path.join(self.d, "tests", "test_calc.py"), "w") as f:
            f.write("import unittest, calc\nclass T(unittest.TestCase):\n"
                    "    def test_add(self):\n        self.assertEqual(calc.add(2, 3), 5)\n")
        self.assertEqual(run([DELIVERY, "init"], self.d).returncode, 0)
        self.contract = {"goal": "加法工具", "industry": "retail/coffee-shop", "deliverables": ["calc.py"],
                         "acceptance": [{"id": "requirement-1", "statement": "add(2,3)=5", "source": "request"}],
                         "assumptions": [], "verification": "independent", "confirmed_by_user": False}
        self.write(".delivery/contract.json", self.contract)

    def tearDown(self):
        shutil.rmtree(self.d)

    def write(self, rel, obj):
        with open(os.path.join(self.d, rel), "w", encoding="utf-8") as f:
            f.write(obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False))

    def confirm(self):
        self.contract.update(confirmed_by_user=True, confirmation_quote="可以")
        self.write(".delivery/contract.json", self.contract)

    def freeze(self):
        return run([DELIVERY, "freeze", "calc.py", "tests", "--test", "python3 -m unittest discover -s tests -t ."], self.d)

    def guard(self, tool, ti, **extra):
        return run([GUARD], self.d, json.dumps({"tool_name": tool, "tool_input": ti, "cwd": self.d, **extra}))

    def test_unconfirmed_contract_blocks_freeze(self):
        self.assertEqual(run([DELIVERY, "check-contract"], self.d).returncode, 1)
        self.assertEqual(self.freeze().returncode, 1)

    def test_fake_test_command_rejected(self):
        self.confirm()
        r = run([DELIVERY, "freeze", "calc.py", "--test", "echo ok"], self.d)
        self.assertEqual(r.returncode, 1)
        self.assertIn("不合格", r.stdout)

    def test_full_flow(self):
        self.confirm()
        self.assertEqual(self.freeze().returncode, 0)
        # 冻结后守卫拦截修改
        self.assertEqual(self.guard("Edit", {"file_path": "calc.py", "old_string": "+", "new_string": "-"}).returncode, 2)
        self.assertEqual(self.guard("PowerShell", {"command": "Set-Content -Path .\\calc.py -Value x"}).returncode, 2)
        self.assertEqual(self.guard("Write", {"file_path": ".delivery/report.md", "content": "完成"}).returncode, 2)
        self.assertEqual(self.guard("Write", {"file_path": ".delivery/qa/v1.json", "content": "{}"}, agent_id="").returncode, 2)
        self.assertEqual(self.guard("Write", {"file_path": ".delivery/qa/v1.json", "content": "{}"}, agent_id="qa1").returncode, 0)
        # 正式测试取证；同版本同命令不得原样重跑
        r = run([DELIVERY, "run-test"], self.d)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("ev-1", r.stdout)
        self.assertEqual(run([DELIVERY, "run-test"], self.d).returncode, 1)
        # 诊断证据不能支撑 passed
        run([DELIVERY, "run-test", "--purpose", "diagnostic", "--question", "能导入吗", "--cmd", "python3 -c 'import calc'"], self.d)
        qa = {"freeze_version": "v1", "requirements": [{"requirement_id": "requirement-1", "status": "passed", "evidence": "ev-2"}],
              "must_fix": [], "release_status": "ready"}
        self.write(".delivery/qa/v1.json", qa)
        self.assertEqual(run([DELIVERY, "check-qa"], self.d).returncode, 1)
        qa["requirements"][0]["evidence"] = "ev-1 test_add"
        self.write(".delivery/qa/v1.json", qa)
        self.assertEqual(run([DELIVERY, "check-qa"], self.d).returncode, 0)
        self.assertIn("report_allowed", run([DELIVERY, "status"], self.d).stdout)
        # 验收后改文件 → 需要重新冻结
        self.write("calc.py", "def add(a, b):\n    return b + a\n")
        self.assertIn("revision_changed", run([DELIVERY, "status"], self.d).stdout)
        self.assertEqual(self.freeze().returncode, 0)
        self.assertIn('"v2"', run([DELIVERY, "status"], self.d).stdout)
        self.write(".delivery/report.md", "# 报告\n目标 复用 结果 验证 风险 假设 未完成\n")
        self.assertEqual(run([DELIVERY, "check-report"], self.d).returncode, 1)  # v2 未验收


class GuardWriteDetect(unittest.TestCase):
    def test_quoted_script_is_not_write(self):
        sys.path.insert(0, os.path.dirname(GUARD))
        import guard as g
        qa_read = """node -e '
const fs=require("fs"),cp=require("crypto");
for (const f of JSON.parse(fs.readFileSync(".delivery/freeze.json","utf8")).files) console.log(f.path, 1 > 0)
'"""
        self.assertFalse(g.looks_write(qa_read))
        self.assertFalse(g.looks_write("node --test 2>&1 | tail -5"))
        self.assertFalse(g.looks_write("python3 - <<'EOF'\nprint(1 > 0)\nEOF"))
        self.assertTrue(g.looks_write("echo x >> calc.py"))
        self.assertTrue(g.looks_write("sed -i '' 's/a/b/' calc.py"))
        self.assertTrue(g.looks_write("python3 - <<'EOF'\nopen('calc.py','w').write('x')\nEOF"))
        self.assertTrue(g.looks_write("""node -e 'require("fs").writeFileSync("calc.py","")'"""))
        # Windows：PowerShell 写文件命令
        self.assertTrue(g.looks_write("Set-Content -Path calc.py -Value 'x'"))
        self.assertTrue(g.looks_write("Remove-Item .\\calc.py"))
        self.assertFalse(g.looks_write("Get-Content calc.py"))


class ParseCounts(unittest.TestCase):
    def test_runners(self):
        sys.path.insert(0, os.path.dirname(DELIVERY))
        import delivery as d
        self.assertEqual(d.parse_counts("==== 1 failed, 2 passed, 1 skipped in 0.1s ===="), (2, 1, 1))
        self.assertEqual(d.parse_counts("Ran 4 tests in 0.0s\n\nOK (skipped=1)"), (3, 0, 1))
        self.assertEqual(d.parse_counts("# pass 3\n# fail 0"), (3, 0, 0))
        self.assertEqual(d.parse_counts("Tests:       1 failed, 3 passed, 4 total"), (3, 1, 0))
        self.assertIsNone(d.parse_counts("ok  \tpkg\t0.1s"))
        self.assertEqual(d.judge(0, (0, 0, 0)), "count_unknown")


class Lessons(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.pack = os.path.join(self.d, "industry-retail-coffee-shop")
        r = run([LESSONS, "new-pack", self.pack, "--industry", "retail", "--scenario", "coffee-shop", "--title", "咖啡店"], self.d)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def tearDown(self):
        shutil.rmtree(self.d)

    def cands(self, rows):
        p = os.path.join(self.d, "c.jsonl")
        with open(p, "w", encoding="utf-8") as f:
            f.write("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
        return p

    def lessons(self):
        with open(os.path.join(self.pack, "references", "lessons.jsonl"), encoding="utf-8") as f:
            return [json.loads(l) for l in f if l.strip()]

    def test_deidentify_confirm_supersede(self):
        ev = [{"ref": "feedback:1", "quote": "预算没问"}]
        terms = os.path.join(self.d, "t.txt")
        with open(terms, "w") as f:
            f.write("某品牌\n")
        bad = self.cands([{"id": "c1", "type": "pitfall", "statement": "某品牌旁租金 3万元", "evidence": ev, "review": "approved"}])
        self.assertEqual(run([LESSONS, "merge", self.pack, bad, "--project", "P-1", "--terms", terms], self.d).returncode, 1)
        good = self.cands([
            {"id": "c1", "type": "intake", "statement": "第一轮问清预算上限", "evidence": ev, "review": "approved"},
            {"id": "c2", "type": "practice", "statement": "未确认", "evidence": ev, "review": "pending"}])
        self.assertEqual(run([LESSONS, "merge", self.pack, good, "--project", "P-1"], self.d).returncode, 0)
        self.assertEqual(len(self.lessons()), 1)  # 未确认的不入库
        sup = self.cands([{"id": "c1", "type": "intake", "statement": "问清预算和是否贷款", "evidence": ev,
                           "supersedes": "retail-coffee-shop-001", "review": "edited"}])
        run([LESSONS, "merge", self.pack, sup, "--project", "P-2"], self.d)
        ls = {l["id"]: l for l in self.lessons()}
        self.assertEqual(ls["retail-coffee-shop-001"]["status"], "superseded")  # 保留不删
        self.assertEqual(ls["retail-coffee-shop-002"]["status"], "active")
        r = run([LESSONS, "package", self.pack, "--out", self.d], self.d)
        self.assertEqual(r.returncode, 0)

    def test_bad_industry_name(self):
        r = run([LESSONS, "new-pack", os.path.join(self.d, "x"), "--industry", "Gov", "--scenario", "a b", "--title", "x"], self.d)
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(os.path.join(self.d, "x")))


if __name__ == "__main__":
    unittest.main()
