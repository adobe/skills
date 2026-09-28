# scripts/test_integration_phase2.py
"""Phase-2 integration milestone (Task C3): the FULL pipeline -- inspect_project ->
scaffold_modules -> split_content (--git) -> convert_osgi (--git) -> refactor_poms --
driven end to end (each script's own `main()`) against a REAL copy of the wknd-legacy
fixture, then gated by `verify.structural_gate` PASSING the inventory (Phase-1's
oracle with `--check-pom-shape`/`--check-embeds` turned on, plus `--inventory` so
`check_no_loss` runs too -- see verify.py's own module docstring).

Fixture-copy + git-init + config generation mirrors `test_integration_single.py`'s own
setUp pattern exactly, so this exercises the identical `.modernize/config.json` /
`.modernize/inventory.json` contract `inspect_project` produces -- Phase 2 is proven on
top of the same real project shape Phase 1 was, not a synthetic one.

This is the milestone the plan calls the "wknd success bar": every assertion below maps
to one of the concrete Cloud Service invariants B2-B6 (`refactor_poms.py`) and A1-A4
(`convert_osgi.py`) were built to satisfy -- this test's job is to PROVE them end to end
on the real fixture, not to re-derive them (see refactor_poms.py / convert_osgi.py's own
module docstrings for the transform rules being exercised here).

KNOWN SEAM this test's own gate exercises: `convert_osgi` re-encodes legacy OSGi config
files' bytes on their way into ui.config (xml/.config/.cfg -> a freshly-written
.cfg.json) -- see `validate.py`'s `_is_reencoded_osgi_config` for the narrow carve-out
that keeps `check_no_loss` from flagging that legitimate re-encoding as a false
"content-lost". This test's own `test_osgi_configs_land_under_cloud_valid_runmode_
folders_only` is the other half of that division of labor: it proves the CONVERTED
output actually exists and looks right, which is exactly what `check_no_loss`
deliberately does NOT re-verify once a file matches the carve-out's shape.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

import inspect_project as I
import scaffold_modules as SC
import split_content as SP
import convert_osgi as OSGI
import refactor_poms as RP
import verify as VF
import rm_common as C

FIX = Path(os.environ["WKND_FIXTURE"])
TPL = Path(__file__).resolve().parent.parent / "assets/archetype-pom-templates"

# Run-mode folder names the legacy wknd fixture ships that are NOT valid AEM as a
# Cloud Service run modes. Per CAM parity (cam-repo-modernizer-analysis.md §11 --
# "Run-mode handling is detect-only (RM-108) -- no user-directed rename/merge"),
# `convert_osgi.flag_noncloud_runmodes` PRESERVES each of these folders verbatim and
# raises an RM-108 finding for it -- it never renames/merges them (renaming/merging
# is a data-loss hazard and a separate, human-directed concern; see SKILL.md). So
# each of these literal folder names MUST survive Phase 2 (relocated under
# osgiconfig/), AND each must be reported via RM-108.
_UNSUPPORTED_RUNMODE_FOLDERS = ("config.qa", "config.staging", "config.prod.author")

# Fix round 1, Fix 5 (Minor): the DISTINCT OSGi config PIDs the wknd-legacy fixture's
# own legacy `config*` folders declare (verified against the fixture: 7 physical
# legacy config files -- 2 already `.cfg.json`, 4 legacy `.xml`, plus the repoinit
# `.xml` that stays unconverted -- resolve to exactly these 4 distinct PIDs once the
# per-run-mode `-wknd`/`~name` factory-config suffixes are set aside). Tightens
# `test_osgi_configs_land_under_cloud_valid_runmode_folders_only`'s own `.cfg.json`
# assertion from "at least one exists and parses" to "none of these four went
# missing" -- so a hypothetical convert_osgi regression that silently dropped ONE of
# several configs (while still emitting >=1 other `.cfg.json`) can't slip past
# unnoticed the way the looser assertion would have let it.
_EXPECTED_CONVERTED_PIDS = (
    "com.adobe.cq.wcm.core.components.internal.servlets.TableOfContentsFilter",
    "com.adobe.cq.dam.assetmetadatarestrictionprovider.impl.DefaultRestrictionProviderConfiguration",
    "com.day.cq.wcm.mobile.core.impl.MobileEmulatorProvider",
    "org.apache.sling.commons.log.LogManager.factory.config",
)


def _copy_and_init_git(fixture: Path) -> Path:
    """Mirrors test_integration_single.py's own helper exactly: a throwaway git repo
    per test run, so split_content/convert_osgi's `--git` history-preserving moves have
    a real repo to `git mv` inside."""
    d = Path(tempfile.mkdtemp()) / "proj"
    shutil.copytree(fixture, d)
    subprocess.run(["git", "init", "-q"], cwd=d, check=True)
    subprocess.run(["git", "add", "-A"], cwd=d, check=True)
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                     "commit", "-qm", "base"], cwd=d, check=True)
    return d


def _local(tag) -> str:
    """Namespace-agnostic local tag name -- mirrors the same small helper every other
    test/module in this skill already carries (validate.py, refactor_poms.py, ...)."""
    return tag.split("}", 1)[-1] if isinstance(tag, str) and "}" in tag else tag


def _direct_child_text(el, localname: str):
    for c in el:
        if isinstance(c.tag, str) and _local(c.tag) == localname:
            return (c.text or "").strip() if c.text else c.text
    return None


def _reactor_status(log_text: str, module_display_name: str):
    """Extract a module's Reactor Summary status word (SUCCESS/FAILURE/SKIPPED) from a
    FULL (non -q) Maven log, keyed by the module's own POM <name> -- that's the literal
    text Maven prints in the summary, not the artifactId. Returns None if the name
    never appears in a summary-shaped line (e.g. the log was captured with -q, which
    suppresses the whole Reactor Summary block)."""
    m = re.search(re.escape(module_display_name) + r"\s*\.{2,}\s*(SUCCESS|FAILURE|SKIPPED)",
                  log_text)
    return m.group(1) if m else None


def _run_full_pipeline(d: Path):
    """Run every Phase-1 + Phase-2 stage's own `main()`, in the one order
    `refactor_poms.main`'s own docstring documents as satisfying every stage's
    preconditions: inspect -> scaffold -> split (--git) -> convert_osgi (--git) ->
    refactor_poms. Returns `(config_path, inventory_path)` -- the same
    `.modernize/config.json` / `.modernize/inventory.json` pair `inspect_project.main`
    writes and every later stage/the oracle itself consumes."""
    cfg = str(d / ".modernize/config.json")
    inv = str(d / ".modernize/inventory.json")

    assert I.main([str(d)]) == 0, "inspect_project failed"
    assert SC.main([str(d), "--config", cfg, "--templates", str(TPL)]) == 0, "scaffold_modules failed"
    assert SP.main([str(d), "--config", cfg, "--git"]) == 0, "split_content failed"
    assert OSGI.main([str(d), "--config", cfg, "--git"]) == 0, "convert_osgi failed"
    assert RP.main([str(d), "--config", cfg]) == 0, "refactor_poms failed"

    return cfg, inv


class Phase2Integration(unittest.TestCase):
    """One fresh fixture copy + full pipeline run per test method (mirrors
    test_integration_single.py's own per-test isolation), so a failure in one
    assertion category never leaves stale state for another."""

    def _pipeline(self):
        d = _copy_and_init_git(FIX)
        cfg, inv = _run_full_pipeline(d)
        config = C.load_json(cfg)
        return d, cfg, inv, config

    # --- 1. structural_gate PASS, exercising immutable/mutable split, pom-shape,
    # embeds, AND no-content-loss (the KNOWN SEAM this milestone reconciles) all in
    # one oracle call -- see verify.structural_gate's own docstring. ---

    def test_structural_gate_passes_with_inventory(self):
        d, cfg, inv, _config = self._pipeline()
        rc = VF.structural_gate(str(d), cfg, inv)
        self.assertEqual(
            rc, 0,
            "Phase-2 structural gate (filter-immutability + pom-shape + embeds + "
            "no-content-loss) must be green on the real wknd fixture")

    # --- 2. OSGi -> ui.config: converted .cfg.json under Cloud-valid run-mode folders
    # only; repoinit stays .xml; no legacy config* folders survive under ui.apps. ---

    def test_osgi_configs_land_under_cloud_valid_runmode_folders_only(self):
        d, _cfg, _inv, config = self._pipeline()
        tm = config["targetModules"]
        app_id = config["appId"]
        osgiconfig_base = (d / tm["uiConfig"] / "src/main/content/jcr_root"
                           / "apps" / app_id / "osgiconfig")
        self.assertTrue(osgiconfig_base.is_dir(),
                        f"expected converted osgiconfig tree at {osgiconfig_base}")

        runmode_dirs = sorted(p.name for p in osgiconfig_base.iterdir() if p.is_dir())
        # CAM parity: unsupported run-mode folders are PRESERVED verbatim (relocated,
        # not renamed/merged), so each MUST still be present under osgiconfig/.
        for bad in _UNSUPPORTED_RUNMODE_FOLDERS:
            self.assertIn(bad, runmode_dirs,
                          f"unsupported run-mode folder {bad!r} should be preserved verbatim "
                          f"(CAM detect-only), not renamed/merged: {runmode_dirs}")

        # Real conversion happened: at least one valid .cfg.json, and every one parses.
        cfgjson_files = list(osgiconfig_base.rglob("*.cfg.json"))
        self.assertTrue(cfgjson_files, "expected at least one converted .cfg.json under osgiconfig")
        for f in cfgjson_files:
            data = json.loads(f.read_text())
            self.assertIsInstance(data, dict, f"{f} should decode to a JSON object")

        # Fix round 1, Fix 5: none of the fixture's own distinct OSGi config PIDs
        # went missing in the conversion -- a stronger claim than ">=1 parses" alone,
        # which a partial conversion (one-of-several configs silently dropped) could
        # still have satisfied.
        cfgjson_names = " ".join(f.name for f in cfgjson_files)
        for pid in _EXPECTED_CONVERTED_PIDS:
            self.assertIn(pid, cfgjson_names,
                          f"expected converted PID {pid!r} missing from converted "
                          f".cfg.json files: {sorted(f.name for f in cfgjson_files)}")

        # The repoinit config is relocated but deliberately left UNCONVERTED (.xml).
        repoinit_files = list(osgiconfig_base.rglob(
            "org.apache.sling.jcr.repoinit.RepositoryInitializer*"))
        self.assertTrue(repoinit_files, "expected the repoinit config to be relocated into osgiconfig")
        for f in repoinit_files:
            self.assertEqual(f.suffix, ".xml", f"repoinit config must remain .xml, not be converted: {f}")

        # And no config*/ source folder remains behind under the (modernized) ui.apps.
        ui_apps_apps_dir = d / tm["uiApps"] / "src/main/content/jcr_root/apps"
        leftover_cfg_dirs = [p for p in ui_apps_apps_dir.rglob("config*") if p.is_dir()]
        self.assertEqual(leftover_cfg_dirs, [],
                         f"OSGi config folders should have been moved out of ui.apps: {leftover_cfg_dirs}")

    # --- 3. Reactor: aem-sdk-api (provided) not uber-jar; aemanalyser-maven-plugin
    # present; <modules> includes all/ui.config/ui.apps.structure. ---

    def test_reactor_pom_declares_sdk_api_modules_and_analyser(self):
        d, _cfg, _inv, config = self._pipeline()
        text = (d / "pom.xml").read_text()

        self.assertNotIn("uber-jar", text, "reactor pom must not still declare com.adobe.aem:uber-jar")
        self.assertIn("<artifactId>aem-sdk-api</artifactId>", text)

        start = text.index("<artifactId>aem-sdk-api</artifactId>")
        dep_start = text.rindex("<dependency>", 0, start)
        dep_end = text.index("</dependency>", start) + len("</dependency>")
        dep_block = text[dep_start:dep_end]
        self.assertIn("<scope>provided</scope>", dep_block,
                     f"aem-sdk-api dependency must carry scope=provided:\n{dep_block}")

        modules_block = text[text.index("<modules>"):text.index("</modules>")]
        for mod in ("all", "ui.config", "ui.apps.structure"):
            self.assertIn(f"<module>{mod}</module>", modules_block,
                          f"reactor <modules> missing required <module>{mod}</module>")

        all_pom_text = (d / config["targetModules"]["all"] / "pom.xml").read_text()
        self.assertIn("<artifactId>aemanalyser-maven-plugin</artifactId>", all_pom_text,
                     "all/pom.xml must carry the aemanalyser-maven-plugin")

    # --- 4. ui.apps & ui.content: the two-plugin pattern (filevault-package-maven-
    # plugin with real config, plus a BARE content-package-maven-plugin with only
    # <extensions>true</extensions> -- no legacy embed). ---

    def test_content_modules_have_two_plugin_pattern(self):
        d, _cfg, _inv, config = self._pipeline()
        tm = config["targetModules"]

        for key in ("uiApps", "uiContent"):
            pom_path = d / tm[key] / "pom.xml"
            root = ET.parse(str(pom_path)).getroot()
            plugins = [e for e in root.iter() if _local(e.tag) == "plugin"]

            legacy = [p for p in plugins
                      if _direct_child_text(p, "groupId") == "com.day.jcr.vault"
                      and _direct_child_text(p, "artifactId") == "content-package-maven-plugin"]
            filevault = [p for p in plugins
                         if _direct_child_text(p, "groupId") == "org.apache.jackrabbit"
                         and _direct_child_text(p, "artifactId") == "filevault-package-maven-plugin"]

            self.assertEqual(len(legacy), 1,
                             f"{key}: expected exactly one bare legacy content-package-maven-plugin, "
                             f"found {len(legacy)}")
            self.assertEqual(len(filevault), 1,
                             f"{key}: expected exactly one filevault-package-maven-plugin, "
                             f"found {len(filevault)}")

            legacy_children = {_local(c.tag) for c in legacy[0]}
            self.assertIn("extensions", legacy_children,
                          f"{key}: legacy plugin must carry <extensions>true</extensions>")
            self.assertEqual(_direct_child_text(legacy[0], "extensions"), "true")
            self.assertNotIn("configuration", legacy_children,
                             f"{key}: legacy plugin must be bare (no legacy <configuration>/embed) "
                             f"-- only the <extensions>true</extensions> lifecycle binding")

            fv_config = next((c for c in filevault[0] if _local(c.tag) == "configuration"), None)
            self.assertIsNotNone(fv_config, f"{key}: filevault plugin must carry a <configuration>")
            self.assertIsNotNone(
                next((c for c in fv_config if _local(c.tag) == "packageType"), None),
                f"{key}: filevault plugin <configuration> must carry <packageType>")

    # --- 5. Findings: RM-902 (Felix->BND) and RM-905 (oak:index filter/content
    # coverage gap, Fix round 2) plus the Phase-1 RM-101/RM-107 preserved through the
    # merge in refactor_poms.main. RM-905 is raised at Stage 1 (inspect_project.py,
    # before any transform runs) and must survive unchanged all the way through the
    # rest of the pipeline, exactly like RM-101/RM-107 already do. ---

    def test_findings_include_rm902_rm905_and_preserve_phase1_findings(self):
        d, _cfg, _inv, _config = self._pipeline()
        findings = C.load_json(d / ".modernize/findings.json")["findings"]
        codes = {f["code"] for f in findings}

        self.assertIn("RM-902", codes, f"expected the Felix->BND finding RM-902, got codes={codes}")
        self.assertIn("RM-905", codes,
                      f"expected the oak:index filter/content coverage gap finding RM-905, got codes={codes}")
        self.assertIn("RM-101", codes, f"expected Phase-1 finding RM-101 to survive the merge, got codes={codes}")
        self.assertIn("RM-107", codes, f"expected Phase-1 finding RM-107 to survive the merge, got codes={codes}")

        rm101_details = [f["detail"] for f in findings if f["code"] == "RM-101"]
        self.assertTrue(any("net.engio" in det and "mbassador" in det for det in rm101_details),
                        f"expected an RM-101 detail mentioning net.engio/mbassador, got: {rm101_details}")

        rm107_details = [f["detail"] for f in findings if f["code"] == "RM-107"]
        self.assertTrue(any("/libs" in det for det in rm107_details),
                        f"expected an RM-107 detail mentioning /libs, got: {rm107_details}")

        rm905 = [f for f in findings if f["code"] == "RM-905"]
        self.assertEqual(len(rm905), 1, f"expected exactly one RM-905 finding, got: {rm905}")
        self.assertEqual(rm905[0]["priority"], "HIGH")
        self.assertIn("wkndTerminationDate", rm905[0]["detail"])
        self.assertIn("/oak:index/wkndTerminationDate", rm905[0]["detail"])

    # --- 6. Milestone proof (Fix round 2, converging Fix round 1's discovery): the
    # reshaped ui.apps.structure / ui.config content packages actually reach BUILD
    # SUCCESS -- impossible before refactor_content_pom's Fix 1 (declare the type=zip
    # dependency its own injected filevault <configuration> references) and Fix 2
    # (drop the vestigial <dependency> on the project's own bundle modules that
    # dragged un-compilable `core` into any -am reactor) both landed (fix round 1,
    # commit 29fef99). ui.apps and ui.content are EXPECTED to fail/be skipped on
    # THIS fixture: fix round 1 honestly surfaced a THIRD, pre-existing defect --
    # oak-indexes/_oak_index/.content.xml defines `wkndTerminationDate` but the
    # legacy oak-indexes/filter.xml never declares a filter root for it
    # (manual-followups.md §7, RM-905). RULING (authoritative, manual-followups.md
    # §7): this is a pre-existing customer-data gap, not a transform defect -- the
    # reference CAM tool copies filters verbatim too, so it would propagate the
    # identical gap -- so the tool detects+reports (RM-905) rather than
    # auto-adding the missing filter root. This test proves the coherent, honest
    # shape of that outcome end to end: fix round 1's dependency wiring holds, the
    # two oak-content-free modules build clean, and ui.apps's ONLY ERROR-severity
    # jackrabbit-filter violation is exactly the documented gap -- a code-assessment
    # hand-off, not a Phase-2 failure. Guarded on `shutil.which("mvn")` so the unit
    # suite still runs where mvn is absent -- but when mvn IS present, every
    # assertion below is a hard requirement.
    #
    # `-fae` (fail-at-end), not just `-q`: this reactor has NO dependency edge
    # between ui.config and ui.apps/ui.content (ui.config only depends on
    # ui.apps.structure -- see refactor_content_pom, transform-rules.md §11), so
    # without `-fae` Maven's default fail-fast reactor behaviour SKIPS ui.config
    # entirely once ui.apps fails earlier in build order -- verified by
    # reproduction: plain `mvn -pl <mods> -am clean package` (no `-fae`) marks
    # ui.config SKIPPED, never even attempted. `-fae` lets Maven actually build
    # every reactor project whose own dependencies succeeded, which is what proves
    # ui.config's "no un-buildable deps" claim rather than merely asserting it.
    # `-q` is dropped: it suppresses the INFO-level Reactor Summary this test reads
    # the per-module SUCCESS/FAILURE/SKIPPED lines from; the `[ERROR]`-tagged lines
    # the other two assertions key off of print at every verbosity level regardless.

    def test_four_module_build_proves_dependency_fix_and_hands_off_oak_gap(self):
        if not shutil.which("mvn"):
            self.skipTest("mvn not installed -- content-package Maven build not verified")

        d, _cfg, _inv, config = self._pipeline()
        tm = config["targetModules"]
        content_modules = [tm["uiAppsStructure"], tm["uiConfig"], tm["uiContent"], tm["uiApps"]]

        content = subprocess.run(
            ["mvn", "-fae", "-pl", ",".join(content_modules), "-am", "clean", "package"],
            cwd=str(d), capture_output=True, text=True)
        log = content.stdout + content.stderr

        # (i) Fix round 1 proof: the dependency-resolution error that blocked this
        # exact build before refactor_content_pom declared the type=zip dependency
        # its own injected filevault config references must be gone anywhere in the
        # log -- the build now gets PAST validate-files' dependency check into
        # filter validation.
        self.assertNotIn(
            "not found among the Maven dependencies", log,
            "fix round 1's dependency wiring regressed -- the 4-module build must "
            f"never fail on an unresolved Maven dependency:\n{log[-6000:]}")

        # (ii) ui.apps.structure and ui.config: BUILD SUCCESS. Neither has oak
        # content of its own and neither has an un-buildable dependency. Read each
        # module's reactor-summary status keyed by its OWN pom <name> (the literal
        # text Maven prints there), not a hardcoded literal.
        structure_name = C.pom_coord(d / tm["uiAppsStructure"] / "pom.xml", "name")
        config_name = C.pom_coord(d / tm["uiConfig"] / "pom.xml", "name")
        structure_status = _reactor_status(log, structure_name)
        config_status = _reactor_status(log, config_name)
        self.assertEqual(
            structure_status, "SUCCESS",
            f"expected {structure_name!r} reactor line to be BUILD SUCCESS "
            f"(no oak content, no un-buildable deps), got {structure_status!r}:\n{log[-6000:]}")
        self.assertEqual(
            config_status, "SUCCESS",
            f"expected {config_name!r} reactor line to be BUILD SUCCESS "
            f"(no oak content, no un-buildable deps), got {config_status!r}:\n{log[-6000:]}")

        # (iii) ui.apps's ONLY ERROR-severity jackrabbit-filter violation anywhere in
        # the log is the documented /oak:index/wkndTerminationDate coverage gap
        # (RM-905 / manual-followups.md §7) -- a code-assessment hand-off, not a
        # Phase-2 failure. ui.apps (and, transitively, ui.content, which depends on
        # ui.apps) are therefore expected to fail/be skipped on THIS fixture -- the
        # honest, documented outcome of a pre-existing customer-data gap; it would
        # be green on a customer repo without the legacy filter bug.
        filter_errors = re.findall(r"^\[ERROR\].*validator: jackrabbit-filter.*$", log, re.MULTILINE)
        self.assertEqual(
            len(filter_errors), 1,
            "expected exactly one ERROR-severity jackrabbit-filter violation (the "
            f"documented oak:index gap), got {len(filter_errors)}: {filter_errors}")
        self.assertIn(
            "/oak:index/wkndTerminationDate", filter_errors[0],
            f"the sole jackrabbit-filter ERROR must be the documented "
            f"/oak:index/wkndTerminationDate coverage gap, got: {filter_errors[0]}")
        self.assertIn("is not contained in any of the filter rules", filter_errors[0])

        # The full `clean install` stays the documented code-assessment hand-off
        # (SKILL.md Stage 8): it MAY fail at the legacy `core` bundle's own Java
        # compile (Felix SCR + a pre-Java-8 source level, on a modern JDK) -- NOT a
        # Phase-2 failure -- but a failure anywhere ELSE (an external provided
        # dependency, an aemanalyser ERROR, ...) is a genuine, different problem
        # this fix must not silently mask. Reuses `verify.maven_gate`'s own log
        # classification (`compile_failed_module` / `analyser_errors`) rather than
        # re-implementing it here.
        full = VF.maven_gate(str(d), ["clean", "install"])
        if full["returncode"] != 0:
            self.assertEqual(
                [], full["analyser_errors"],
                "aemanalyser reported ERROR-level findings on the full `clean "
                f"install` hand-off -- a genuine Phase-2 failure, not a hand-off: {full}")
            self.assertEqual(
                "aem-guides-wknd.core", full["compile_failed_module"],
                "the full `clean install` hand-off must fail (if at all) ONLY at "
                "the documented legacy `core` compile break -- a failure "
                "elsewhere (e.g. an external provided dependency) must not be "
                f"silently masked: {full}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
