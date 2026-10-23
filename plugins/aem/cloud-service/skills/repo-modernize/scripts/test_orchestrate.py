# scripts/test_orchestrate.py
"""The plan/apply review gate of orchestrate.py: nothing is restructured before the plan is
reviewed, and a reviewed plan is used as-is (never re-inspected)."""
import contextlib
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import orchestrate as O


def _pom(packaging="jar", modules=None, artifact="m"):
    mods = "".join(f"<module>{m}</module>" for m in (modules or []))
    block = f"<modules>{mods}</modules>" if modules else ""
    return (f'<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>'
            f"<groupId>g</groupId><artifactId>{artifact}</artifactId><version>1.0</version>"
            f"<packaging>{packaging}</packaging>{block}</project>\n")


def _legacy_single(d: Path) -> Path:
    (d / "core/src").mkdir(parents=True)
    (d / "pom.xml").write_text(_pom("pom", ["core", "ui.apps"]))
    (d / "core/pom.xml").write_text(_pom("bundle", artifact="core"))
    (d / "ui.apps").mkdir()
    (d / "ui.apps/pom.xml").write_text(_pom("content-package", artifact="ui.apps"))
    return d


def _quiet(fn, *a, **kw):
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return fn(*a, **kw)


def _git(d, *args):
    subprocess.run(["git", *args], cwd=d, check=True, capture_output=True)


def _commit_all(d):
    _git(d, "init", "-q")
    _git(d, "add", "-A")
    _git(d, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base")


class PlanApplyGate(unittest.TestCase):
    def test_plan_only_inspects(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        planned = []
        with mock.patch.object(O, "_plan_unit", side_effect=lambda u: planned.append(u) or
                               {"ok": True, "error": None, "config": "c"}), \
             mock.patch.object(O, "_run_unit_pipeline", side_effect=AssertionError("applied")):
            out = _quiet(O.orchestrate, str(d), mode="plan")
        self.assertEqual(planned, [str(d)])
        self.assertEqual((out["mode"], out["rc"]), ("plan", 0))

    def test_apply_never_reinspects(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        with mock.patch.object(O.I, "main", side_effect=AssertionError("re-inspected")), \
             mock.patch.object(O, "_run_unit_pipeline",
                               return_value={"ok": True, "failed_stage": None, "findings": 0}) as run:
            out = _quiet(O.orchestrate, str(d), mode="apply", use_git=False)
        run.assert_called_once()
        self.assertEqual(out["rc"], 0)

    def test_apply_without_plan_fails_with_instruction(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        out = _quiet(O.orchestrate, str(d), mode="apply", use_git=False)
        unit = out["units"][0]
        self.assertEqual((unit["ok"], unit["failed_stage"], out["rc"]), (False, "plan", 2))
        self.assertIn("--plan", unit["error"])
        self.assertFalse((d / "ui.config").exists())          # nothing was restructured

    def test_cli_without_a_step_only_plans(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        with mock.patch.object(O, "_run_unit_pipeline", side_effect=AssertionError("applied")):
            rc = _quiet(O.main, [str(d)])
        self.assertEqual(rc, 0)
        self.assertTrue((d / ".modernize/config.json").is_file())
        self.assertFalse((d / "ui.config").exists())

    def test_reviewed_plan_is_kept(self):
        """The real stages read the edited config.json, not a fresh inspection."""
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _quiet(O.main, [str(d), "--plan"])
        cfg_path = d / ".modernize/config.json"
        cfg = O.C.load_json(cfg_path)
        cfg["appId"] = "reviewed-app"
        O.C.save_json(cfg_path, cfg)
        _quiet(O.main, [str(d), "--apply"])
        self.assertEqual(O.C.load_json(cfg_path)["appId"], "reviewed-app")
        self.assertTrue((d / "ui.config/src/main/content/META-INF/vault/filter.xml").is_file())
        self.assertIn("/apps/reviewed-app/osgiconfig",
                      (d / "ui.config/src/main/content/META-INF/vault/filter.xml").read_text())


class Preflight(unittest.TestCase):
    def test_dirty_tree_refused_but_modernize_dir_ignored(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _commit_all(d)
        (d / ".modernize").mkdir()
        (d / ".modernize/config.json").write_text("{}")
        self.assertIsNone(O.git_problem(str(d)))              # only .modernize/ is untracked
        (d / "core/pom.xml").write_text(_pom("bundle", artifact="core-edited"))
        problem = O.git_problem(str(d))
        self.assertIn("uncommitted", problem)
        self.assertIn("core/pom.xml", problem)
        rc = _quiet(O.main, [str(d), "--apply", "--git"])
        self.assertEqual(rc, 2)
        self.assertFalse((d / "ui.config").exists())

    def test_not_a_git_repo(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        self.assertIn("not inside a git repository", O.git_problem(str(d)))

    def test_missing_lxml_gives_install_command(self):
        with mock.patch.dict(sys.modules, {"lxml": None}):
            msg = O.lxml_problem()
        self.assertIn("pip install -r", msg)
        self.assertIn("requirements.txt", msg)
        self.assertIsNone(O.lxml_problem())


if __name__ == "__main__":
    unittest.main()
