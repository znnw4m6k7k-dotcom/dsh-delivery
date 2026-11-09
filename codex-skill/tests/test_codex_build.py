"""Codex 版生成检查：python3 -m unittest discover -s codex-skill/tests"""
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")


class CodexBuild(unittest.TestCase):
    def test_generated_is_up_to_date(self):
        r = subprocess.run([sys.executable, os.path.join(ROOT, "build.py"), "--check"], capture_output=True, text=True, encoding="utf-8", errors="replace")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_scripts_shared_and_runnable(self):
        d = os.path.join(ROOT, "delivery-contract", "scripts", "delivery.py")
        r = subprocess.run([sys.executable, d, "--help"], capture_output=True, text=True, encoding="utf-8", errors="replace")
        self.assertEqual(r.returncode, 0)
        skill = open(os.path.join(ROOT, "delivery-contract", "SKILL.md"), encoding="utf-8").read()
        self.assertTrue(skill.startswith("---\nname: delivery-contract\n"))
        self.assertIn("codex exec", skill)
        self.assertTrue(os.path.exists(os.path.join(ROOT, "delivery-contract", "agents", "openai.yaml")))


if __name__ == "__main__":
    unittest.main()
