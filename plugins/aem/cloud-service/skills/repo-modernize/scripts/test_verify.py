# scripts/test_verify.py
import contextlib
import io
import tempfile
import unittest
from pathlib import Path

import rm_common as C
import verify as VF


def _config():
    return {"schemaVersion": 1, "projectShape": "SINGLE", "groupId": "com.x", "artifactId": "acme",
            "appId": "acme", "appTitle": "ACME", "version": "1.0.0-SNAPSHOT",
            "targetModules": {"all": "all", "uiApps": "ui.apps", "uiAppsStructure": "ui.apps.structure",
                               "uiConfig": "ui.config", "uiContent": "ui.content"},
            "bundles": [], "testBundles": [], "contentPackages": [], "runModeDecisions": {}}


def _write_pkg(root, mod, pkg_type, cmt, filter_root):
    pom = root / mod / "pom.xml"
    pom.parent.mkdir(parents=True, exist_ok=True)
    pom.write_text(
        '<project xmlns="http://maven.apache.org/POM/4.0.0">'
        f'<artifactId>acme.{mod}</artifactId>'
        '<build><plugins><plugin><configuration>'
        f'<packageType>{pkg_type}</packageType>'
        f'<cloudManagerTarget>{cmt}</cloudManagerTarget>'
        '</configuration></plugin></plugins></build></project>')
    fx = root / mod / "src/main/content/META-INF/vault/filter.xml"
    fx.parent.mkdir(parents=True, exist_ok=True)
    fx.write_text(f'<workspaceFilter version="1.0"><filter root="{filter_root}"/></workspaceFilter>')


def _write_all(root, embeds):
    pom = root / "all" / "pom.xml"
    pom.parent.mkdir(parents=True, exist_ok=True)
    emb = "".join(f"<embedded><artifactId>{a}</artifactId></embedded>" for a in embeds)
    pom.write_text(
        '<project xmlns="http://maven.apache.org/POM/4.0.0">'
        '<artifactId>acme.all</artifactId>'
        '<build><plugins><plugin><configuration>'
        '<packageType>container</packageType>'
        f'<embeddeds>{emb}</embeddeds>'
        '</configuration></plugin></plugins></build></project>')


def _build_project():
    """A well-formed, already-restructured Phase-2 project: pom-shape (packageType +
    cloudManagerTarget=none) AND embeds satisfied on top of Phase-1's structural invariants,
    plus an on-disk config.json + empty inventory.json -- exactly what structural_gate needs."""
    d = Path(tempfile.mkdtemp())
    _write_pkg(d, "ui.apps", "application", "none", "/apps/acme")
    _write_pkg(d, "ui.content", "content", "none", "/content/acme")
    _write_pkg(d, "ui.config", "container", "none", "/apps/acme/osgiconfig")
    _write_all(d, ["acme.ui.apps", "acme.ui.content", "acme.ui.config"])
    cfg = d / ".modernize/config.json"
    C.save_json(cfg, _config())
    inv = d / ".modernize/inventory.json"
    C.save_json(inv, {"files": []})
    return d, cfg, inv


class _FakeProc:
    def __init__(self, returncode, stdout, stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


CLEAN_LOG = """[INFO] Scanning for projects...
[INFO] ------------------------------------------------------------------------
[INFO] Reactor Summary for ACME Parent 1.0.0-SNAPSHOT:
[INFO]
[INFO] ACME Parent ........................................ SUCCESS [  0.400 s]
[INFO] core ................................................ SUCCESS [  3.200 s]
[INFO] ui.apps ............................................. SUCCESS [  1.100 s]
[INFO] ------------------------------------------------------------------------
[INFO] BUILD SUCCESS
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  12.345 s
"""

ANALYSER_ERROR_LOG = """[INFO] Scanning for projects...
[INFO] --- aemanalyser-maven-plugin:1.5.0:analyse (default) @ all ---
[ERROR] aemanalyser: RuleCategory RULE_JSON_SLING_CONTENT_PROPERTIES: unable to resolve \
filter root /apps/acme/foo
[INFO] ------------------------------------------------------------------------
[INFO] BUILD FAILURE
[INFO] ------------------------------------------------------------------------
"""

COMPILE_ERROR_LOG = """[INFO] Scanning for projects...
[INFO] ------------------------------------------------------------------------
[INFO] Building core 1.0.0-SNAPSHOT                                     [2/7]
[INFO] ------------------------------------------------------------------------
[INFO] --- maven-compiler-plugin:3.11.0:compile (default-compile) @ core ---
[INFO] -------------------------------------------------------------
[ERROR] COMPILATION ERROR :
[INFO] -------------------------------------------------------------
[ERROR] /work/core/src/main/java/com/acme/core/Foo.java:[12,8] package \
org.apache.felix.scr.annotations does not exist
[INFO] 1 error
[INFO] -------------------------------------------------------------
[INFO] ------------------------------------------------------------------------
[INFO] Reactor Summary for ACME Parent 1.0.0-SNAPSHOT:
[INFO]
[INFO] ACME Parent ........................................ SUCCESS [  0.400 s]
[INFO] core ................................................ FAILURE [  3.200 s]
[INFO] ui.apps ............................................. SKIPPED
[INFO] ------------------------------------------------------------------------
[INFO] BUILD FAILURE
[INFO] ------------------------------------------------------------------------
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.11.0:compile \
(default-compile) on project core: Compilation failure
[ERROR] After correcting the problems, you can resume the build with the command
[ERROR]   mvn <args> -rf :core
"""

POM_MODEL_ERROR_LOG = """[INFO] Scanning for projects...
[ERROR] [ERROR] Some problems were encountered while processing the POMs:
[ERROR] Unknown packaging: content-package @ line 12, column 14
[ERROR] The build could not read 1 project -> [Help 1]
[ERROR]   The project acme:acme.ui.config:1.0.0-SNAPSHOT (/work/ui.config/pom.xml) has 1 error
[ERROR]     Unknown packaging: content-package @ line 12, column 14
"""


class StructuralGate(unittest.TestCase):
    def test_passes_on_well_formed_restructured_project(self):
        d, cfg, inv = _build_project()
        self.assertEqual(VF.structural_gate(str(d), str(cfg), str(inv)), 0)

    def test_passes_without_an_inventory(self):
        d, cfg, _ = _build_project()
        self.assertEqual(VF.structural_gate(str(d), str(cfg)), 0)

    def test_fails_on_broken_pom_shape_value(self):
        d, cfg, inv = _build_project()
        p = d / "ui.apps/pom.xml"
        p.write_text(p.read_text().replace(
            "<packageType>application</packageType>", "<packageType>content</packageType>"))
        self.assertEqual(VF.structural_gate(str(d), str(cfg), str(inv)), 1)

    def test_fails_when_not_embedded_in_all(self):
        d, cfg, inv = _build_project()
        p = d / "all/pom.xml"
        p.write_text(p.read_text().replace("acme.ui.config", "acme.NOPE"))
        self.assertEqual(VF.structural_gate(str(d), str(cfg), str(inv)), 1)

    def test_fails_on_malformed_config_like_phase1_oracle(self):
        d, cfg, _ = _build_project()
        cfg.write_text("{ not json")
        self.assertEqual(VF.structural_gate(str(d), str(cfg)), 2)


class MavenGateParsing(unittest.TestCase):
    def test_clean_build_success_is_ok_with_no_errors_or_module(self):
        result = VF.maven_gate("/proj", ["install"], run=lambda argv, **kw: _FakeProc(0, CLEAN_LOG))
        self.assertEqual(result, {"ok": True, "analyser_errors": [], "compile_failed_module": None,
                                   "pom_model_errors": [], "returncode": 0})

    def test_analyser_error_line_is_captured_and_not_ok(self):
        result = VF.maven_gate("/proj", ["install"],
                                run=lambda argv, **kw: _FakeProc(1, ANALYSER_ERROR_LOG))
        self.assertFalse(result["ok"])
        self.assertEqual(len(result["analyser_errors"]), 1)
        self.assertIn("aemanalyser", result["analyser_errors"][0])
        self.assertIsNone(result["compile_failed_module"])

    def test_core_compilation_error_reports_module_and_not_ok(self):
        result = VF.maven_gate("/proj", ["install"],
                                run=lambda argv, **kw: _FakeProc(1, COMPILE_ERROR_LOG))
        self.assertFalse(result["ok"])
        self.assertEqual(result["compile_failed_module"], "core")
        self.assertEqual(result["analyser_errors"], [])
        self.assertEqual(result["returncode"], 1)

    def test_build_argv_includes_pl_flag_when_modules_given(self):
        captured = {}

        def fake_run(argv, **kwargs):
            captured["argv"] = argv
            captured["kwargs"] = kwargs
            return _FakeProc(0, CLEAN_LOG)

        VF.maven_gate("/some/root", ["package"], modules=["ui.apps", "ui.content"], run=fake_run)
        self.assertEqual(captured["argv"], ["mvn", "package", "-pl", "ui.apps,ui.content"])
        self.assertEqual(captured["kwargs"].get("cwd"), "/some/root")

    def test_build_argv_omits_pl_flag_when_no_modules(self):
        captured = {}

        def fake_run(argv, **kwargs):
            captured["argv"] = argv
            return _FakeProc(0, CLEAN_LOG)

        VF.maven_gate("/some/root", ["install"], run=fake_run)
        self.assertEqual(captured["argv"], ["mvn", "install"])

    def test_build_failure_without_compilation_error_marker_has_no_module(self):
        # a BUILD FAILURE alone (e.g. a test failure) is not a *compile* failure -- only the
        # COMPILATION ERROR marker should attribute a compile_failed_module.
        log = ("[INFO] BUILD FAILURE\n"
               "[ERROR] Failed to execute goal ... on project ui.content: some other failure\n")
        result = VF.maven_gate("/proj", ["install"], run=lambda argv, **kw: _FakeProc(1, log))
        self.assertIsNone(result["compile_failed_module"])

    def test_ok_false_when_returncode_zero_but_analyser_error_present(self):
        # Maven doesn't always exit non-zero for an aemanalyser ERROR -- it depends on how
        # the plugin is bound to the lifecycle. ok must still be False whenever a real
        # ERROR-level analyser finding is present, regardless of returncode.
        result = VF.maven_gate("/proj", ["install"],
                                run=lambda argv, **kw: _FakeProc(0, ANALYSER_ERROR_LOG))
        self.assertFalse(result["ok"])
        self.assertEqual(result["returncode"], 0)
        self.assertEqual(len(result["analyser_errors"]), 1)


class Main(unittest.TestCase):
    def _run_main(self, argv, run=None):
        buf = io.StringIO()
        kwargs = {} if run is None else {"run": run}
        with contextlib.redirect_stdout(buf):
            rc = VF.main(argv, **kwargs) if run is not None else VF.main(argv)
        return rc, buf.getvalue()

    def test_structural_failure_returns_nonzero_and_never_calls_mvn(self):
        d, cfg, inv = _build_project()
        p = d / "ui.apps/pom.xml"
        p.write_text(p.read_text().replace(
            "<packageType>application</packageType>", "<packageType>content</packageType>"))
        calls = []
        rc, out = self._run_main(
            [str(d), "--config", str(cfg), "--inventory", str(inv), "--mvn"],
            run=lambda argv, **kw: calls.append(argv) or _FakeProc(0, CLEAN_LOG))
        self.assertEqual(rc, 1)
        self.assertEqual(calls, [])  # structural failure short-circuits before any mvn call
        self.assertIn("structural FAIL", out)

    def test_structural_pass_without_mvn_flag_never_calls_mvn_and_returns_zero(self):
        d, cfg, inv = _build_project()
        calls = []
        rc, out = self._run_main(
            [str(d), "--config", str(cfg), "--inventory", str(inv)],
            run=lambda argv, **kw: calls.append(argv) or _FakeProc(0, CLEAN_LOG))
        self.assertEqual(rc, 0)
        self.assertEqual(calls, [])

    def test_structural_pass_with_clean_mvn_is_full_success(self):
        d, cfg, inv = _build_project()
        rc, out = self._run_main(
            [str(d), "--config", str(cfg), "--inventory", str(inv), "--mvn"],
            run=lambda argv, **kw: _FakeProc(0, CLEAN_LOG))
        self.assertEqual(rc, 0)
        self.assertIn("full Phase-2 success", out)

    def test_structural_pass_with_core_compile_failure_is_handoff_not_failure(self):
        # The key Phase-2 distinction: structural PASS + a legacy-core Java compile break is a
        # code-assessment hand-off, NOT a Phase-2 failure -- main must still return 0 and the
        # printed verdict must name the hand-off (and the failing module).
        d, cfg, inv = _build_project()
        calls = []
        rc, out = self._run_main(
            [str(d), "--config", str(cfg), "--inventory", str(inv), "--mvn"],
            run=lambda argv, **kw: calls.append(argv) or _FakeProc(1, COMPILE_ERROR_LOG))
        self.assertEqual(rc, 0)
        self.assertIn("code-assessment", out)
        self.assertIn("core", out)
        self.assertNotIn("full Phase-2 success", out)
        self.assertGreaterEqual(len(calls), 1)  # mvn WAS invoked (content-packages + install)

    def test_structural_pass_with_real_analyser_error_returns_three_not_handoff(self):
        # A genuine (non-compile) aemanalyser ERROR is a real Cloud-validity failure (spec
        # Sec 3 anti-gaming: analyser must stay green) -- distinct nonzero exit code 3, NOT
        # the compile-break hand-off's 0, and NOT reported as success. A CI caller checking
        # $? must see this as a failure.
        d, cfg, inv = _build_project()
        rc, out = self._run_main(
            [str(d), "--config", str(cfg), "--inventory", str(inv), "--mvn"],
            run=lambda argv, **kw: _FakeProc(1, ANALYSER_ERROR_LOG))
        self.assertEqual(rc, 3)
        self.assertNotIn("full Phase-2 success", out)
        # the verdict must explicitly disclaim the hand-off (not just omit it) and must
        # never print the hand-off phrasing used for a genuine compile-break verdict
        self.assertIn("NOT a code-assessment hand-off", out)
        self.assertNotIn("hand this compile break off", out)
        self.assertIn("aemanalyser", out)
        self.assertIn("Phase-2 FAILURE", out)

    def test_structural_pass_with_modernized_module_pom_error_is_phase2_failure(self):
        # #6: a POM-model error in the CONTENT-modules build (which covers only
        # modernized/reactor modules, never legacy core) means the restructuring
        # produced a module Maven can't even read -- a real Phase-2 FAILURE (exit 4),
        # NOT a code-assessment hand-off. Only the -pl content build carries the error
        # here; the full install is clean.
        d, cfg, inv = _build_project()

        def run(argv, **kw):
            return _FakeProc(1, POM_MODEL_ERROR_LOG) if "-pl" in argv else _FakeProc(0, CLEAN_LOG)
        rc, out = self._run_main(
            [str(d), "--config", str(cfg), "--inventory", str(inv), "--mvn"], run=run)
        self.assertEqual(rc, 4)
        self.assertIn("MODERNIZED content module", out)
        self.assertIn("Unknown packaging", out)
        self.assertIn("Phase-2 FAILURE", out)
        self.assertNotIn("full Phase-2 success", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
