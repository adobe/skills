"""Fixture-free regression tests for the Phase-3 NESTED sub-project discovery in
inspect_project.py (discover_subprojects / subproject_status / _declared_module_dirs)
and the missing-root-pom precondition guard in main().

Deliberately WKND_FIXTURE-free: each test builds a minimal reactor tree in a tmpdir,
so it runs anywhere the venv does. The real globex-parent NESTED project is exercised
end-to-end in the task report; these lock in the individual rules.
"""
import contextlib
import io
import tempfile
import unittest
from pathlib import Path

import inspect_project as I


def _pom(packaging="jar", modules=None, artifact="m"):
    mods = "".join(f"<module>{m}</module>" for m in (modules or []))
    mod_block = f"<modules>{mods}</modules>" if modules else ""
    return (f'<project xmlns="http://maven.apache.org/POM/4.0.0">'
            f"<modelVersion>4.0.0</modelVersion>"
            f"<groupId>g</groupId><artifactId>{artifact}</artifactId>"
            f"<version>1.0</version><packaging>{packaging}</packaging>{mod_block}</project>\n")


def _write(d: Path, rel: str, text: str):
    p = d / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
    return p


def _bundle(d: Path, name: str):
    _write(d, f"{name}/pom.xml", _pom("bundle", artifact=name))
    (d / name / "src").mkdir(parents=True, exist_ok=True)  # a real bundle has src/


def _content(d: Path, name: str):
    _write(d, f"{name}/pom.xml", _pom("content-package", artifact=name))


class DeclaredModuleDirs(unittest.TestCase):
    def test_reads_modules_in_order_deduped(self):
        d = Path(tempfile.mkdtemp())
        _write(d, "pom.xml", _pom("pom", modules=["a", "b", "a"]))
        self.assertEqual(I._declared_module_dirs(d), ["a", "b"])

    def test_empty_when_no_pom(self):
        self.assertEqual(I._declared_module_dirs(Path(tempfile.mkdtemp())), [])


class SubprojectStatus(unittest.TestCase):
    def test_legacy_has_code_but_no_modern_modules(self):
        d = Path(tempfile.mkdtemp())
        _write(d, "pom.xml", _pom("pom", modules=["core", "ui.apps"]))
        _bundle(d, "core")
        _content(d, "ui.apps")
        self.assertEqual(I.subproject_status(d), "legacy")

    def test_modern_has_all_uiappsstructure_uiconfig(self):
        d = Path(tempfile.mkdtemp())
        _write(d, "pom.xml", _pom("pom", modules=["all", "ui.apps.structure", "ui.config", "core"]))
        for m in ("all", "ui.apps.structure", "ui.config"):
            _content(d, m)
        _bundle(d, "core")
        self.assertEqual(I.subproject_status(d), "modern")

    def test_empty_aggregator_no_code(self):
        d = Path(tempfile.mkdtemp())
        _write(d, "pom.xml", _pom("pom", modules=["sub"]))
        _write(d, "sub/pom.xml", _pom("pom"))  # a nested aggregator, no bundle/content
        self.assertEqual(I.subproject_status(d), "empty")


class DiscoverSubprojects(unittest.TestCase):
    def test_nested_parent_classifies_each_subreactor(self):
        # Mirrors globex-parent: one legacy sub-project + one already-modern.
        d = Path(tempfile.mkdtemp())
        _write(d, "pom.xml", _pom("pom", modules=["legacyapp", "modernapp"]))
        # legacyapp: sub-reactor with code, no modern modules
        _write(d, "legacyapp/pom.xml", _pom("pom", modules=["core", "ui.apps"]))
        _bundle(d / "legacyapp", "core")
        _content(d / "legacyapp", "ui.apps")
        # modernapp: sub-reactor already carrying the Cloud module set
        _write(d, "modernapp/pom.xml", _pom("pom", modules=["all", "ui.apps.structure", "ui.config"]))
        for m in ("all", "ui.apps.structure", "ui.config"):
            _content(d / "modernapp", m)

        subs = I.discover_subprojects(d)
        self.assertEqual(subs, [
            {"path": "legacyapp", "status": "legacy"},
            {"path": "modernapp", "status": "modern"},
        ])

    def test_direct_bundle_module_is_not_a_subproject(self):
        # A NESTED parent that (unusually) lists a direct bundle alongside sub-reactors:
        # only the pom-packaged sub-reactors are sub-projects.
        d = Path(tempfile.mkdtemp())
        _write(d, "pom.xml", _pom("pom", modules=["somebundle", "app"]))
        _bundle(d, "somebundle")
        _write(d, "app/pom.xml", _pom("pom", modules=["core"]))
        _bundle(d / "app", "core")
        paths = [s["path"] for s in I.discover_subprojects(d)]
        self.assertEqual(paths, ["app"])  # somebundle excluded (not a sub-reactor)


class MainPrecondition(unittest.TestCase):
    def test_missing_root_pom_and_no_subprojects_returns_2(self):
        d = Path(tempfile.mkdtemp())  # no pom.xml, no child projects
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            rc = I.main([str(d)])
        self.assertEqual(rc, 2)
        self.assertIn("no root pom.xml", buf.getvalue())

    def test_nested_root_emits_subprojects_json_and_guidance(self):
        d = Path(tempfile.mkdtemp())
        _write(d, "pom.xml", _pom("pom", modules=["legacyapp"]))
        _write(d, "legacyapp/pom.xml", _pom("pom", modules=["core", "ui.apps"]))
        _bundle(d / "legacyapp", "core")
        _content(d / "legacyapp", "ui.apps")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = I.main([str(d)])
        out = buf.getvalue()
        self.assertEqual(rc, 0)
        self.assertIn("NESTED", out)
        self.assertIn("legacyapp", out)
        self.assertTrue((d / ".modernize" / "subprojects.json").exists())
        self.assertTrue((d / ".modernize" / "units.json").exists())


def _single_project(d: Path):
    """A minimal SINGLE-shaped project at `d`: reactor + core bundle + ui.apps content."""
    _write(d, "pom.xml", _pom("pom", modules=["core", "ui.apps"], artifact=d.name))
    _bundle(d, "core")
    _content(d, "ui.apps")


class DetectShape(unittest.TestCase):
    def test_single(self):
        d = Path(tempfile.mkdtemp()); _single_project(d)
        mods = {p.name: I.classify_module(d / p.name) for p in d.iterdir() if (p / "pom.xml").exists()}
        self.assertEqual(I.detect_shape(d, mods), "SINGLE")

    def test_single_with_bare_pom_module_is_still_single(self):
        # a config/aggregator module (packaging=pom, NO modules, e.g. dispatcher) must
        # NOT make the project MONOLITHIC.
        d = Path(tempfile.mkdtemp()); _single_project(d)
        _write(d, "dispatcher/pom.xml", _pom("pom", artifact="disp"))  # 0 modules
        mods = {p.name: I.classify_module(d / p.name) for p in d.iterdir() if (p / "pom.xml").exists()}
        self.assertEqual(I.detect_shape(d, mods), "SINGLE")

    def test_nested(self):
        d = Path(tempfile.mkdtemp())
        _write(d, "pom.xml", _pom("pom", modules=["appA"]))
        _single_project(d / "appA")
        mods = {p.name: I.classify_module(d / p.name) for p in d.iterdir() if (p / "pom.xml").exists()}
        self.assertEqual(I.detect_shape(d, mods), "NESTED")

    def test_monolithic(self):
        # reactor + OWN code (core/ui.apps) AND a sub-project (appA)
        d = Path(tempfile.mkdtemp())
        _write(d, "pom.xml", _pom("pom", modules=["core", "ui.apps", "appA"]))
        _bundle(d, "core"); _content(d, "ui.apps")
        _single_project(d / "appA")
        mods = {p.name: I.classify_module(d / p.name) for p in d.iterdir() if (p / "pom.xml").exists()}
        self.assertEqual(I.detect_shape(d, mods), "MONOLITHIC")

    def test_multi(self):
        # no root pom; two independent SINGLE-shaped child projects
        d = Path(tempfile.mkdtemp())
        _single_project(d / "appA"); _single_project(d / "appB")
        self.assertEqual(I.detect_shape(d, {}), "MULTI")


class DiscoverUnits(unittest.TestCase):
    def test_single_yields_root_unit(self):
        d = Path(tempfile.mkdtemp()); _single_project(d)
        plan = I.discover_units(d)
        self.assertEqual(plan["shape"], "SINGLE")
        self.assertEqual([u["path"] for u in plan["units"]], ["."])

    def test_nested_yields_subprojects(self):
        d = Path(tempfile.mkdtemp())
        _write(d, "pom.xml", _pom("pom", modules=["appA", "appB"]))
        _single_project(d / "appA"); _single_project(d / "appB")
        plan = I.discover_units(d)
        self.assertEqual(plan["shape"], "NESTED")
        self.assertEqual(sorted(u["path"] for u in plan["units"]), ["appA", "appB"])

    def test_monolithic_yields_root_and_subprojects(self):
        d = Path(tempfile.mkdtemp())
        _write(d, "pom.xml", _pom("pom", modules=["core", "ui.apps", "appA"]))
        _bundle(d, "core"); _content(d, "ui.apps")
        _single_project(d / "appA")
        plan = I.discover_units(d)
        self.assertEqual(plan["shape"], "MONOLITHIC")
        self.assertIn(".", [u["path"] for u in plan["units"]])
        self.assertIn("appA", [u["path"] for u in plan["units"]])

    def test_multi_yields_child_projects(self):
        d = Path(tempfile.mkdtemp())
        _single_project(d / "appA"); _single_project(d / "appB")
        plan = I.discover_units(d)
        self.assertEqual(plan["shape"], "MULTI")
        self.assertEqual(sorted(u["path"] for u in plan["units"]), ["appA", "appB"])


class OrchestratorPlan(unittest.TestCase):
    """The orchestrator's unit selection + ordering, without running the real stages
    (each stage is stubbed) -- so this is fast and fixture-free but still proves the
    'sub-projects first, then main' ordering and the legacy-only filter."""

    def test_runs_legacy_units_skips_modern_and_empty(self):
        import orchestrate as O
        d = Path(tempfile.mkdtemp())
        _write(d, "pom.xml", _pom("pom", modules=["legacyA", "modernB", "emptyC"]))
        _single_project(d / "legacyA")
        # modernB already restructured
        _write(d, "modernB/pom.xml", _pom("pom", modules=["all", "ui.apps.structure", "ui.config"]))
        for m in ("all", "ui.apps.structure", "ui.config"):
            _content(d / "modernB", m)
        # emptyC: aggregator with a nested empty reactor (no code)
        _write(d, "emptyC/pom.xml", _pom("pom", modules=["x"]))
        _write(d, "emptyC/x/pom.xml", _pom("pom"))

        ran = []
        orig = O._run_unit_pipeline
        O._run_unit_pipeline = lambda unit_dir, use_git, sdk_version="pinned": (ran.append(unit_dir) or
                                                           {"ok": True, "failed_stage": None, "findings": 0})
        try:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                out = O.orchestrate(str(d), use_git=False)
        finally:
            O._run_unit_pipeline = orig
        # only legacyA ran; modernB/emptyC skipped
        self.assertEqual([Path(r).name for r in ran], ["legacyA"])
        self.assertEqual(out["shape"], "NESTED")
        self.assertEqual(out["rc"], 0)

    def test_monolithic_runs_subprojects_before_main(self):
        import orchestrate as O
        d = Path(tempfile.mkdtemp())
        _write(d, "pom.xml", _pom("pom", modules=["core", "ui.apps", "appA"]))
        _bundle(d, "core"); _content(d, "ui.apps")
        _single_project(d / "appA")
        ran = []
        orig = O._run_unit_pipeline
        O._run_unit_pipeline = lambda unit_dir, use_git, sdk_version="pinned": (ran.append(unit_dir) or
                                                          {"ok": True, "failed_stage": None, "findings": 0})
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                O.orchestrate(str(d), use_git=False)
        finally:
            O._run_unit_pipeline = orig
        # sub-project appA runs BEFORE the main root ('.')
        names = ["." if r == str(d) else Path(r).name for r in ran]
        self.assertEqual(names, ["appA", "."])


if __name__ == "__main__":
    unittest.main(verbosity=2)
