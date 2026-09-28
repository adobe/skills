# scripts/test_integration_single.py
"""Phase-1 integration milestone: inspect -> scaffold -> split -> validate, driven end to
end (each script's own `main()`) against a REAL copy of the wknd-legacy fixture.

Gate: validate.py's DEFAULT oracle only — check_structural (filter-root immutability +
module-pom existence) + check_no_loss (every baseline file present by hash somewhere).
Deliberately does NOT pass --check-pom-shape or --check-embeds: those are Phase-2 gates
(see validate.py's module docstring). The fixture's ui.apps/ui.content packages are
literally named the same as their Cloud Service target modules, so idempotent
`scaffold_modules` retains their legacy content-package-maven-plugin pom shape (no
<packageType>, no cloudManagerTarget) through Phase 1 — rewriting that shape is
Phase-2 `refactor_poms` work, not this pipeline's. Gating this integration test on
pom-shape or all-embeds would fail a correct Phase-1 result on this real legacy project.
"""
import os
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

import inspect_project as I
import scaffold_modules as SC
import split_content as SP
import validate as V
import rm_common as C

FIX = Path(os.environ["WKND_FIXTURE"])
TPL = Path(__file__).resolve().parent.parent / "assets/archetype-pom-templates"


def _filter_roots(filter_xml: Path):
    """Read `<filter root="...">` attributes from a filter.xml, namespace-agnostic —
    a local, test-owned reader so this test doesn't reach into validate.py's private
    `_filter_roots` helper."""
    if not filter_xml.exists():
        return []
    return [e.attrib["root"] for e in ET.parse(str(filter_xml)).iter()
            if e.tag.split("}")[-1] == "filter" and "root" in e.attrib]


def _copy_and_init_git(fixture: Path) -> Path:
    d = Path(tempfile.mkdtemp()) / "proj"
    shutil.copytree(fixture, d)
    subprocess.run(["git", "init", "-q"], cwd=d, check=True)
    subprocess.run(["git", "add", "-A"], cwd=d, check=True)
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                     "commit", "-qm", "base"], cwd=d, check=True)
    return d


class IntegrationSingle(unittest.TestCase):
    def test_pipeline_passes_oracle(self):
        d = _copy_and_init_git(FIX)

        self.assertEqual(I.main([str(d)]), 0)
        cfg = str(d / ".modernize/config.json")
        self.assertEqual(SC.main([str(d), "--config", cfg, "--templates", str(TPL)]), 0)
        self.assertEqual(SP.main([str(d), "--config", cfg, "--git"]), 0)

        inv = str(d / ".modernize/inventory.json")
        self.assertEqual(V.main([str(d), "--config", cfg, "--inventory", inv]), 0,
                         "structural + no-loss oracle must be green after Phase-1 pipeline")

    def test_pipeline_produces_expected_filter_roots_and_modules(self):
        """Pin the green trace from the task brief: which top-level jcr_root dirs and
        filter roots land where, and that all 5 Cloud Service module poms exist."""
        d = _copy_and_init_git(FIX)
        cfg = str(d / ".modernize/config.json")

        self.assertEqual(I.main([str(d)]), 0)
        self.assertEqual(SC.main([str(d), "--config", cfg, "--templates", str(TPL)]), 0)
        self.assertEqual(SP.main([str(d), "--config", cfg, "--git"]), 0)

        apps_jcr = d / "ui.apps/src/main/content/jcr_root"
        content_jcr = d / "ui.content/src/main/content/jcr_root"
        self.assertEqual({p.name for p in apps_jcr.iterdir() if p.is_dir()},
                          {"apps", "libs", "_oak_index"})
        self.assertEqual({p.name for p in content_jcr.iterdir() if p.is_dir()},
                          {"content", "etc"})

        apps_roots = set(_filter_roots(d / "ui.apps/src/main/content/META-INF/vault/filter.xml"))
        self.assertEqual(apps_roots, {
            "/apps/wknd", "/apps/sling",
            "/libs/cq/core/content/nav/wknd",
            "/oak:index/damAssetLucene", "/oak:index/wkndId",
        })
        self.assertTrue(all(V.classify_filter_root(r) == "immutable" for r in apps_roots))

        content_roots = set(_filter_roots(d / "ui.content/src/main/content/META-INF/vault/filter.xml"))
        self.assertEqual(content_roots, {
            "/content/wknd", "/content/dam/wknd/asset.jpg",
            "/content/dam/wknd/rep:policy",
            "/etc/designs/wknd",
        })  # /content/dam/wknd/metadata is PRUNED -- no backing content on disk
            # (CAM parity: "could not be resolved to valid content")
        self.assertTrue(all(V.classify_filter_root(r) == "mutable" for r in content_roots))

        for mod in ("all", "ui.apps", "ui.content", "ui.config", "ui.apps.structure"):
            self.assertTrue((d / mod / "pom.xml").exists(), f"{mod}/pom.xml should exist")

    def test_findings_captured(self):
        d = Path(tempfile.mkdtemp()) / "proj"
        shutil.copytree(FIX, d)
        self.assertEqual(I.main([str(d)]), 0)

        findings = C.load_json(d / ".modernize/findings.json")["findings"]
        codes = {f["code"] for f in findings}
        self.assertIn("RM-101", codes)
        self.assertIn("RM-107", codes)

        rm101_details = [f["detail"] for f in findings if f["code"] == "RM-101"]
        self.assertTrue(
            any("net.engio" in det and "mbassador" in det for det in rm101_details),
            f"expected an RM-101 detail mentioning net.engio/mbassador, got: {rm101_details}")

        rm107_details = [f["detail"] for f in findings if f["code"] == "RM-107"]
        self.assertTrue(
            any("/libs" in det for det in rm107_details),
            f"expected an RM-107 detail mentioning /libs, got: {rm107_details}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
