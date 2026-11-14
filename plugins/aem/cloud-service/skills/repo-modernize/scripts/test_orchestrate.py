# scripts/test_orchestrate.py
"""The plan/apply review gate of orchestrate.py: nothing is restructured before the plan is
reviewed, and a reviewed plan is used as-is (never re-inspected)."""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import orchestrate as O

FIX = Path(os.environ.get("WKND_FIXTURE") or
           Path(__file__).resolve().parents[3] / "test/repo-modernize/fixtures/wknd-legacy")
SKILL = Path(__file__).resolve().parent.parent
# The archetype templates the tests plan with (a templates folder: no Maven, no network).
TEMPLATES = Path(__file__).resolve().parents[3] / "test/repo-modernize/fixtures/archetype-templates"


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
            rc = _quiet(O.main, [str(d), "--archetype", str(TEMPLATES)])
        self.assertEqual(rc, 0)
        self.assertTrue((d / ".modernize/config.json").is_file())
        self.assertFalse((d / "ui.config").exists())

    def test_reviewed_plan_is_kept(self):
        """The real stages read the edited config.json, not a fresh inspection."""
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _quiet(O.main, [str(d), "--plan", "--archetype", str(TEMPLATES)])
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
    def test_plan_folder_ignores_itself(self):
        """.modernize/ never shows up in git status or a commit (like code-assessment's .autofix/)."""
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _commit_all(d)
        _quiet(O.main, [str(d), "--plan", "--archetype", str(TEMPLATES)])
        self.assertTrue((d / ".modernize/config.json").is_file())
        self.assertTrue((d / ".modernize/archetype-templates/pom.xml").is_file())
        self.assertIn("*", (d / ".modernize/.gitignore").read_text().splitlines())
        status = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=d,
                                capture_output=True, text=True, check=True).stdout
        self.assertEqual(status, "")

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
        self.assertIn(str(O.C.SKILL_DIR / ".venv"), msg)   # never a .venv inside the project
        self.assertIsNone(O.lxml_problem())

    def test_in_project_skill_install_is_not_a_change(self):
        """A project-scope `npx skills add` leaves this skill (and any sibling skills) under
        `.agents/skills/` plus `skills-lock.json`, untracked. They are not project changes;
        a real uncommitted change still blocks."""
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _commit_all(d)
        for rel in (".agents/skills/repo-modernize/SKILL.md", ".agents/skills/other/SKILL.md",
                    "skills-lock.json"):
            (d / rel).parent.mkdir(parents=True, exist_ok=True)
            (d / rel).write_text("x")
        (d / ".claude/skills").mkdir(parents=True)
        os.symlink("../../.agents/skills/repo-modernize", d / ".claude/skills/repo-modernize")
        with mock.patch.object(O.C, "SKILL_DIR", (d / ".agents/skills/repo-modernize").resolve()):
            self.assertIsNone(O.git_problem(str(d)))
            (d / "notes.txt").write_text("user work")
            problem = O.git_problem(str(d))
        self.assertIn("notes.txt", problem)
        self.assertNotIn(".agents", problem)
        self.assertNotIn(".claude", problem)
        self.assertNotIn("skills-lock.json", problem)

    def test_skill_outside_a_skills_folder_excludes_only_itself(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _commit_all(d)
        (d / "tools/repo-modernize").mkdir(parents=True)
        (d / "tools/repo-modernize/SKILL.md").write_text("x")
        (d / "tools/other.txt").write_text("x")
        with mock.patch.object(O.C, "SKILL_DIR", (d / "tools/repo-modernize").resolve()):
            problem = O.git_problem(str(d))
        self.assertIn("tools/other.txt", problem)
        self.assertNotIn("tools/repo-modernize", problem)

    def test_inventory_skips_an_in_project_skill_install(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        (d / ".agents/skills/repo-modernize").mkdir(parents=True)
        (d / ".agents/skills/repo-modernize/SKILL.md").write_text("x")
        (d / "skills-lock.json").write_text("{}")
        with mock.patch.object(O.C, "SKILL_DIR", (d / ".agents/skills/repo-modernize").resolve()):
            paths = [f["path"] for f in O.I.capture_inventory(d)["files"]]
        self.assertIn("pom.xml", paths)
        self.assertEqual([p for p in paths if p.startswith(".agents") or p == "skills-lock.json"], [])


class Archetype(unittest.TestCase):
    """The plan prepares the archetype templates (default: the latest Adobe archetype) and
    apply uses them; templates that can't be prepared or don't fit change nothing."""

    def _custom_templates(self) -> Path:
        d = Path(tempfile.mkdtemp()) / "templates"
        shutil.copytree(TEMPLATES, d)
        all_pom = d / "all/pom.xml"
        all_pom.write_text(all_pom.read_text().replace(
            "<modelVersion>", "<!-- from the customer's archetype -->\n    <modelVersion>", 1))
        return d

    def test_plan_prepares_the_templates(self):
        import archetype_templates as AT
        d = _legacy_single(Path(tempfile.mkdtemp()))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = O.main([str(d), "--plan", "--archetype", str(TEMPLATES)])
        self.assertEqual(rc, 0)
        self.assertEqual(AT.load_dir(d / ".modernize/archetype-templates"), AT.load_dir(TEMPLATES))
        info = O.C.load_json(d / ".modernize/archetype.json")
        self.assertEqual((info["archetype"], info["source"]), (str(TEMPLATES), "templates folder"))
        self.assertEqual(O.C.load_json(d / ".modernize/orchestration.json")["archetype"]["archetype"],
                         str(TEMPLATES))
        self.assertIn("archetype: " + str(TEMPLATES), out.getvalue())

    def test_plan_defaults_to_the_latest_archetype(self):
        import archetype_templates as AT
        d = _legacy_single(Path(tempfile.mkdtemp()))
        info = {"archetype": "com.adobe.aem:aem-project-archetype:58",
                "source": "latest, from Maven Central", "aemSdkApi": "2099.1.1"}
        with mock.patch.object(AT, "prepare", return_value=(AT.load_dir(TEMPLATES), dict(info))) as prep:
            rc = _quiet(O.main, [str(d), "--plan"])
        self.assertEqual(rc, 0)
        prep.assert_called_once_with(None, None, fallback_sdk=None)   # AT.prepare's default: latest
        self.assertEqual(O.C.load_json(d / ".modernize/archetype.json")["source"],
                         "latest, from Maven Central")

    def test_plan_reports_an_archetype_it_cannot_prepare(self):
        import archetype_templates as AT
        d = _legacy_single(Path(tempfile.mkdtemp()))
        err = io.StringIO()
        with mock.patch.object(AT, "prepare", side_effect=AT.ArchetypeError("Maven (mvn) and a JDK are needed")), \
             contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            rc = O.main([str(d), "--plan"])
        self.assertEqual(rc, 2)
        self.assertIn("Maven (mvn) and a JDK are needed", err.getvalue())
        self.assertIn("Apply needs them", err.getvalue())
        self.assertTrue((d / ".modernize/config.json").is_file())   # the plan itself is written
        self.assertFalse((d / ".modernize/archetype-templates").exists())

    def test_a_failed_plan_leaves_no_templates_for_apply(self):
        """Re-planning with an archetype that fails must not leave the previous plan's
        templates for apply to use without notice."""
        import archetype_templates as AT
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _quiet(O.main, [str(d), "--plan", "--archetype", str(TEMPLATES)])
        with mock.patch.object(AT, "prepare", side_effect=AT.ArchetypeError("could not generate")):
            rc = _quiet(O.main, [str(d), "--plan", "--archetype", "com.acme:acme-archetype:3"])
        self.assertEqual(rc, 2)
        self.assertFalse((d / ".modernize/archetype-templates").exists())
        self.assertFalse((d / ".modernize/archetype.json").exists())
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(O.main([str(d), "--apply"]), 2)
        self.assertIn("run --plan first", err.getvalue())
        self.assertFalse((d / "ui.config").exists())

    def test_planning_again_offers_the_previous_sdk_as_the_offline_fallback(self):
        import archetype_templates as AT
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _quiet(O.main, [str(d), "--plan", "--archetype", str(TEMPLATES), "--sdk-version", "2099.7.7"])
        info = {"archetype": "com.adobe.aem:aem-project-archetype:58",
                "source": "latest, from local Maven repository", "aemSdkApi": "2099.7.7"}
        with mock.patch.object(AT, "prepare", return_value=(AT.load_dir(TEMPLATES), dict(info))) as prep:
            _quiet(O.main, [str(d), "--plan"])
        prep.assert_called_once_with(None, None, fallback_sdk="2099.7.7")

    def test_planning_again_from_the_prepared_templates_keeps_them(self):
        import archetype_templates as AT
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _quiet(O.main, [str(d), "--plan", "--archetype", str(TEMPLATES)])
        rc = _quiet(O.main, [str(d), "--plan", "--archetype", str(d / ".modernize/archetype-templates")])
        self.assertEqual(rc, 0)
        self.assertEqual(AT.load_dir(d / ".modernize/archetype-templates"), AT.load_dir(TEMPLATES))

    def test_a_plan_that_does_not_finish_leaves_no_templates(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _quiet(O.main, [str(d), "--plan", "--archetype", str(TEMPLATES)])
        with mock.patch.object(O, "_plan_unit", side_effect=KeyboardInterrupt), \
             self.assertRaises(KeyboardInterrupt):
            _quiet(O.main, [str(d), "--plan"])
        self.assertFalse((d / ".modernize/archetype-templates").exists())
        self.assertFalse((d / ".modernize/archetype.json").exists())

    def test_apply_uses_the_templates_the_plan_prepared(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        custom = self._custom_templates()
        _quiet(O.main, [str(d), "--plan", "--archetype", str(custom)])
        rc = _quiet(O.main, [str(d), "--apply"])
        self.assertEqual(rc, 0)
        self.assertIn("from the customer's archetype", (d / "all/pom.xml").read_text())
        self.assertEqual(O.C.load_json(d / ".modernize/orchestration.json")["archetype"]["archetype"],
                         str(custom.resolve()))

    def test_apply_without_prepared_templates_changes_nothing(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _quiet(O.main, [str(d), "--plan", "--archetype", str(TEMPLATES)])
        shutil.rmtree(d / ".modernize/archetype-templates")
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            rc = O.main([str(d), "--apply"])
        self.assertEqual(rc, 2)
        self.assertIn("run --plan first", err.getvalue())
        self.assertFalse((d / "ui.config").exists())

    def test_apply_with_archetype_prepares_them_again(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _quiet(O.main, [str(d), "--plan", "--archetype", str(TEMPLATES)])
        rc = _quiet(O.main, [str(d), "--apply", "--archetype", str(self._custom_templates())])
        self.assertEqual(rc, 0)
        self.assertIn("from the customer's archetype", (d / "all/pom.xml").read_text())

    def test_apply_shows_the_archetype_it_uses(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _quiet(O.main, [str(d), "--plan", "--archetype", str(TEMPLATES)])
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(O.main([str(d), "--apply"]), 0)
        self.assertIn(f"archetype: {TEMPLATES} (templates folder); AEM SDK ", out.getvalue())

    def test_apply_with_sdk_version_keeps_the_plans_archetype(self):
        """--sdk-version alone changes only the SDK of the plan's templates: the reviewed
        archetype stays, and nothing is generated (no Maven needed)."""
        import archetype_templates as AT
        d = _legacy_single(Path(tempfile.mkdtemp()))
        custom = self._custom_templates()
        _quiet(O.main, [str(d), "--plan", "--archetype", str(custom)])
        with mock.patch.object(AT, "prepare", side_effect=AssertionError("prepared again")):
            rc = _quiet(O.main, [str(d), "--apply", "--sdk-version", "2099.5.5"])
        self.assertEqual(rc, 0)
        self.assertIn("from the customer's archetype", (d / "all/pom.xml").read_text())
        info = O.C.load_json(d / ".modernize/archetype.json")
        self.assertEqual((info["archetype"], info["aemSdkApi"]), (str(custom.resolve()), "2099.5.5"))
        self.assertIn("<aem.sdk.api>2099.5.5</aem.sdk.api>",
                      (d / ".modernize/archetype-templates/pom.xml").read_text())

    def test_apply_with_archetype_keeps_the_plans_sdk(self):
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _quiet(O.main, [str(d), "--plan", "--archetype", str(TEMPLATES), "--sdk-version", "2099.6.6"])
        custom = self._custom_templates()
        rc = _quiet(O.main, [str(d), "--apply", "--archetype", str(custom)])
        self.assertEqual(rc, 0)
        self.assertIn("from the customer's archetype", (d / "all/pom.xml").read_text())
        info = O.C.load_json(d / ".modernize/archetype.json")
        self.assertEqual((info["archetype"], info["aemSdkApi"]), (str(custom.resolve()), "2099.6.6"))

    def test_nothing_to_restructure_needs_no_templates(self):
        d = Path(tempfile.mkdtemp())
        (d / "pom.xml").write_text(_pom("pom", ["app"]))
        (d / "app").mkdir()
        (d / "app/pom.xml").write_text(_pom("pom", ["all", "ui.apps.structure", "ui.config"]))
        for m in ("all", "ui.apps.structure", "ui.config"):
            (d / "app" / m).mkdir()
            (d / "app" / m / "pom.xml").write_text(_pom("content-package", artifact=m))
        self.assertEqual(_quiet(O.main, [str(d), "--plan"]), 0)
        self.assertFalse((d / ".modernize/archetype-templates").exists())
        self.assertEqual(_quiet(O.main, [str(d), "--apply"]), 0)

    def test_unusable_templates_change_nothing(self):
        import archetype_templates as AT
        d = _legacy_single(Path(tempfile.mkdtemp()))
        _quiet(O.main, [str(d), "--plan", "--archetype", str(TEMPLATES)])
        err = io.StringIO()
        with mock.patch.object(AT, "prepare", side_effect=AT.TemplatesDoNotFit(
                "ui.apps/pom.xml: no filevault-package-maven-plugin <configuration>")), \
             contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            rc = O.main([str(d), "--apply", "--archetype", "58"])
        self.assertEqual(rc, 2)
        self.assertIn("ui.apps/pom.xml", err.getvalue())
        self.assertIn("Nothing was changed", err.getvalue())
        self.assertFalse((d / "ui.config").exists())

    def test_prepare_templates_writes_them_into_modernize(self):
        import archetype_templates as AT
        d = Path(tempfile.mkdtemp())
        templates = AT.load_dir(TEMPLATES)
        info = {"archetype": "com.acme:acme-archetype:3", "source": "requested", "aemSdkApi": "1"}
        with mock.patch.object(AT, "prepare", return_value=(templates, dict(info))) as prep:
            out = _quiet(O.prepare_templates, str(d), "com.acme:acme-archetype:3", "2099.1.1")
        prep.assert_called_once_with("com.acme:acme-archetype:3", "2099.1.1", fallback_sdk=None)
        self.assertEqual(Path(out["templates"]), d / ".modernize/archetype-templates")
        self.assertEqual(AT.load_dir(out["templates"]), templates)
        self.assertTrue((d / ".modernize/.gitignore").is_file())


@unittest.skipUnless(FIX.is_dir(), f"test fixture not found at {FIX} (set WKND_FIXTURE)")
class InProjectInstall(unittest.TestCase):
    """End to end, as a user gets it from `npx skills add <skill-url> -y` (project scope): the
    skill is copied into the project and run from there; plan and apply must work without
    committing or stashing the install."""

    def _run(self, script, *args):
        env = {**os.environ, "REPO_MODERNIZE_NO_VERSION_CHECK": "1"}
        return subprocess.run([sys.executable, str(script), *args],
                              capture_output=True, text=True, env=env)

    @staticmethod
    def _digest(folder: Path) -> dict:
        return {str(p.relative_to(folder)): O.C.sha256_file(p) for p in sorted(folder.rglob("*"))
                if p.is_file() and "__pycache__" not in p.parts and ".venv" not in p.parts}

    def test_plan_and_apply_from_an_in_project_copy(self):
        d = Path(tempfile.mkdtemp()) / "proj"
        shutil.copytree(FIX, d)
        _commit_all(d)
        installed = d / ".agents/skills/repo-modernize"
        shutil.copytree(SKILL, installed, ignore=shutil.ignore_patterns("__pycache__", ".venv"))
        (d / ".agents/skills/other-skill").mkdir()
        (d / ".agents/skills/other-skill/SKILL.md").write_text("x")
        (d / ".claude/skills").mkdir(parents=True)
        os.symlink("../../.agents/skills/repo-modernize", d / ".claude/skills/repo-modernize")
        (d / "skills-lock.json").write_text("{}\n")
        before = self._digest(installed)
        script = d / ".claude/skills/repo-modernize/scripts/orchestrate.py"

        plan = self._run(script, str(d), "--plan", "--archetype", str(TEMPLATES))
        self.assertEqual(plan.returncode, 0, plan.stdout + plan.stderr)
        inventory = json.loads((d / ".modernize/inventory.json").read_text())["files"]
        self.assertEqual([f["path"] for f in inventory
                          if f["path"].startswith(".agents") or f["path"] == "skills-lock.json"], [])

        applied = self._run(script, str(d), "--apply", "--git", "--verify")
        self.assertEqual(applied.returncode, 0, applied.stdout + applied.stderr)
        self.assertIn("structural PASS", applied.stdout)
        self.assertTrue((d / "ui.config/pom.xml").is_file())
        install_status = subprocess.run(
            ["git", "status", "--porcelain", "--", ".agents", ".claude", "skills-lock.json"],
            cwd=d, capture_output=True, text=True, check=True).stdout.splitlines()
        self.assertTrue(install_status)
        self.assertTrue(all(line.startswith("??") for line in install_status), install_status)
        self.assertEqual(self._digest(installed), before)     # the skill's own files untouched


if __name__ == "__main__":
    unittest.main()
