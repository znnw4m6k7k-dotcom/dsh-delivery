"""Exercise the online installers against local source archives."""
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest
import zipfile


REPO = Path(__file__).resolve().parents[2]
POWERSHELL = os.environ.get("DELIVERY_TEST_POWERSHELL") or ("powershell" if os.name == "nt" else None)
TARGET_ROOTS = {
    "claude": "claude-config/skills",
    "codex": "codex-config/skills",
    "cursor": ".cursor/skills",
    "copilot": ".copilot/skills",
    "gemini": ".gemini/skills",
    "opencode": "xdg-config/opencode/skills",
    "windsurf": ".codeium/windsurf/skills",
    "devin": "xdg-config/devin/skills",
}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class AgentInstall(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(temp.cleanup)
        root = Path(temp.name)
        archive = root / ("source.zip" if POWERSHELL else "source.tar.gz")
        sources = {}
        for edition in ("agent-skill", "claude-skill", "codex-skill"):
            skill = REPO / edition / "delivery-contract"
            for path in skill.rglob("*"):
                if path.is_file() and "__pycache__" not in path.parts:
                    sources[f"repo/{path.relative_to(REPO).as_posix()}"] = path
        dsh = root / "dsh-stub"
        dsh.write_text("exit 1\n", encoding="utf-8")
        sources["repo/kit/install.ps1" if POWERSHELL else "repo/kit/install.sh"] = dsh
        if POWERSHELL:
            with zipfile.ZipFile(archive, "w") as bundle:
                for name, path in sources.items():
                    bundle.write(path, name)
        else:
            with tarfile.open(archive, "w:gz") as bundle:
                for name, path in sources.items():
                    bundle.add(path, name)

        handler = functools.partial(QuietHandler, directory=root)
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.addClassCleanup(server.server_close)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        cls.addClassCleanup(server.shutdown)
        cls.url = f"http://127.0.0.1:{server.server_port}/{archive.name}"

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.work = Path(temp.name)
        self.home = self.work / "home"
        self.home.mkdir()

    def run_installer(self, target, custom=None):
        env = {
            **os.environ,
            "HOME": str(self.home),
            "CLAUDE_CONFIG_DIR": str(self.home / "claude-config"),
            "CODEX_HOME": str(self.home / "codex-config"),
            "XDG_CONFIG_HOME": str(self.home / "xdg-config"),
            "DSH_KIT_URL": self.url,
            "DSH_KIT_TARGET": target,
            "DSH_KIT_SKILLS_DIR": custom or "",
        }
        if POWERSHELL:
            command = [
                POWERSHELL, "-NoProfile", "-Command",
                "Set-Variable -Name HOME -Value $env:HOME -Force; "
                "Get-Content -Raw -Encoding UTF8 install-online.ps1 | Invoke-Expression",
            ]
            cwd = REPO
        else:
            command = ["sh", str(REPO / "install-online.sh"), target]
            if custom is not None:
                command.append(custom)
            cwd = self.work
        return subprocess.run(command, cwd=cwd, env=env, capture_output=True, timeout=45)

    def assert_installed(self, root, edition):
        installed = root / "delivery-contract"
        expected = REPO / edition / "delivery-contract"
        for path in expected.rglob("*"):
            if path.is_file() and "__pycache__" not in path.parts:
                self.assertEqual((installed / path.relative_to(expected)).read_bytes(), path.read_bytes())

    def test_targets_and_native_editions(self):
        # On Windows and POSIX sh, cover the all path including an unavailable DSH.
        # PowerShell on Linux has no Windows PowerShell executable to run DSH.
        if os.name == "nt" or not POWERSHELL:
            run = self.run_installer("all")
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            for root in TARGET_ROOTS.values():
                skill = self.home / root / "delivery-contract" / "SKILL.md"
                self.assertTrue(skill.is_file(), f"Missing {skill}\n{(run.stdout + run.stderr).decode('utf-8', 'replace')}")
        for target, root in TARGET_ROOTS.items():
            with self.subTest(target=target):
                run = self.run_installer(target)
                self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
                edition = f"{target}-skill" if target in ("claude", "codex") else "agent-skill"
                self.assert_installed(self.home / root, edition)
        self.assertFalse((self.home / ".agents").exists())

    def test_generic_and_custom_update(self):
        run = self.run_installer("generic")
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assert_installed(self.home / ".agents/skills", "agent-skill")
        self.assertFalse((self.home / ".cursor").exists())

        root = self.work / "我的 skills [test]"
        for attempt in range(2):
            run = self.run_installer("custom", str(root))
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            self.assert_installed(root, "agent-skill")
            stale = root / "delivery-contract" / "stale"
            if attempt == 0:
                stale.touch()
            else:
                self.assertFalse(stale.exists())
        script = root / "delivery-contract/scripts/delivery.py"
        result = subprocess.run([sys.executable, str(script), "init"], cwd=self.work, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.work / ".delivery").is_dir())

    def test_invalid_target_and_missing_custom_path(self):
        for target in ("cursor copilot", "custom"):
            with self.subTest(target=target):
                result = self.run_installer(target)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
