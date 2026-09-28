# scripts/test_inspect.py
import os, shutil, tempfile, unittest
from pathlib import Path
# NOTE: named inspect_project.py, not inspect.py — the latter collides with the stdlib
# `inspect` module that `dataclasses` (imported transitively by `unittest`) needs; see
# the docstring in inspect_project.py for the exact failure this caused.
import inspect_project as I

FIX = Path(os.environ["WKND_FIXTURE"])


class Classify(unittest.TestCase):
    def test_core_is_bundle(self):
        self.assertEqual(I.classify_module(FIX / "core"), "bundle")

    def test_it_tests_is_test_bundle(self):
        self.assertEqual(I.classify_module(FIX / "it.tests"), "test-bundle")

    def test_ui_apps_is_content_package(self):
        self.assertEqual(I.classify_module(FIX / "ui.apps"), "content-package")

    def test_docx4j_wrapper_is_wrapper_or_misc(self):
        self.assertIn(I.classify_module(FIX / "docx4j11-dependencies"), ("wrapper", "misc"))


class Shape(unittest.TestCase):
    def test_wknd_is_single(self):
        mods = {p.name: I.classify_module(p) for p in FIX.iterdir() if (p / "pom.xml").exists()}
        self.assertEqual(I.detect_shape(FIX, mods), "SINGLE")


class AppId(unittest.TestCase):
    def test_app_id_from_all_embeds(self):
        self.assertEqual(I.derive_app_id(FIX), "wknd")  # from /apps/wknd-packages/... target


class Config(unittest.TestCase):
    def test_build_config_lists_bundles_and_content(self):
        cfg = I.build_config(FIX)
        self.assertEqual(cfg["projectShape"], "SINGLE")
        self.assertEqual(cfg["appId"], "wknd")
        paths = {b["path"] for b in cfg["bundles"]}
        self.assertIn("core", paths); self.assertIn("bundle2", paths)
        self.assertNotIn("it.tests", paths)
        self.assertIn("it.tests", {b["path"] for b in cfg["testBundles"]})
        content_paths = {c["path"] for c in cfg["contentPackages"]}
        self.assertIn("ui.apps", content_paths)
        self.assertIn("ui.content", content_paths)
        self.assertIn("oak-indexes", content_paths)

    def test_build_config_identity_via_pom_coord(self):
        # Ruling 1: groupId/artifactId/version come from C.pom_coord (parent-safe), not
        # pom_text — the fixture root pom declares groupId com.adobe.aem.guides directly.
        cfg = I.build_config(FIX)
        self.assertEqual(cfg["groupId"], "com.adobe.aem.guides")
        self.assertEqual(cfg["artifactId"], "aem-guides-wknd")
        self.assertEqual(cfg["version"], "1.0-SNAPSHOT")
        # Root pom has no own <name>; appTitle falls back to appId.
        self.assertEqual(cfg["appTitle"], cfg["appId"])

    def test_build_config_excludes_container_aggregator_from_content_packages(self):
        # Container-exclusion ruling: `all` has <packageType>container</packageType> — it's
        # the aggregator, not a source content package to split, so it must NOT appear here.
        cfg = I.build_config(FIX)
        self.assertNotIn("all", {c["path"] for c in cfg["contentPackages"]})


class Findings(unittest.TestCase):
    def test_third_party_mbassador_flagged_rm101(self):
        cfg = I.build_config(FIX)
        rm101 = [f for f in I.scan_findings(FIX, cfg) if f.code == "RM-101"]
        self.assertTrue(rm101, "expected at least one RM-101 finding")
        self.assertTrue(any("net.engio" in f.detail and "mbassador" in f.detail for f in rm101),
                         f"expected an RM-101 detail mentioning net.engio/mbassador, got: {rm101}")

    def test_provided_felix_and_sling_not_flagged_rm101(self):
        # Ruling 2: org.apache.felix / org.apache.sling are PROVIDED, not third-party — this
        # proves no false-positive flood from the corrected CAM blind spot (org.apache.* is
        # NOT blanket-provided; only the felix/sling/jackrabbit sub-trees are).
        cfg = I.build_config(FIX)
        rm101_details = [f.detail for f in I.scan_findings(FIX, cfg) if f.code == "RM-101"]
        self.assertFalse(any("org.apache.felix" in d for d in rm101_details), rm101_details)
        self.assertFalse(any("org.apache.sling" in d for d in rm101_details), rm101_details)

    def test_libs_content_flagged_rm107(self):
        cfg = I.build_config(FIX)
        details = [f.detail for f in I.scan_findings(FIX, cfg) if f.code == "RM-107"]
        self.assertTrue(any("/libs" in d for d in details))

    def test_oak_index_filter_gap_flagged_rm905_exactly_wknd_termination_date(self):
        # Positive case: the wknd fixture's oak-indexes/_oak_index/.content.xml
        # declares 3 oak:QueryIndexDefinition nodes (damAssetLucene, wkndId,
        # wkndTerminationDate) but its filter.xml only declares filter roots for the
        # first two -- see references/manual-followups.md §7. Exactly ONE RM-905
        # finding must fire, and it must name wkndTerminationDate specifically (not
        # the two covered indexes).
        cfg = I.build_config(FIX)
        rm905 = [f for f in I.scan_findings(FIX, cfg) if f.code == "RM-905"]
        self.assertEqual(len(rm905), 1, f"expected exactly one RM-905 finding, got: {rm905}")
        self.assertIn("wkndTerminationDate", rm905[0].detail)
        self.assertIn("/oak:index/wkndTerminationDate", rm905[0].detail)
        self.assertNotIn("damAssetLucene", rm905[0].detail)
        self.assertNotIn("wkndId", rm905[0].detail)
        self.assertEqual(rm905[0].priority, "HIGH")

    def test_oak_index_filter_gap_none_when_filter_covers_every_index_node(self):
        # Negative case: a filter.xml that DOES declare a root for every
        # oak:QueryIndexDefinition child must raise no RM-905 finding at all.
        d = Path(tempfile.mkdtemp())
        pkg = d / "oak-pkg"
        jcr_root = pkg / "src/main/content/jcr_root"
        (jcr_root / "_oak_index").mkdir(parents=True)
        (jcr_root / "_oak_index/.content.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:oak="http://jackrabbit.apache.org/oak/ns/1.0" '
            'jcr:primaryType="nt:unstructured">\n'
            '  <someIndex jcr:primaryType="oak:QueryIndexDefinition" type="property"/>\n'
            '  <otherIndex jcr:primaryType="oak:QueryIndexDefinition" type="property"/>\n'
            '</jcr:root>\n')
        vault = pkg / "src/main/content/META-INF/vault"
        vault.mkdir(parents=True)
        (vault / "filter.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<workspaceFilter version="1.0">\n'
            '    <filter root="/oak:index/someIndex"/>\n'
            '    <filter root="/oak:index/otherIndex"/>\n'
            '</workspaceFilter>\n')
        cfg = {
            "contentPackages": [{
                "path": "oak-pkg",
                "jcrRoot": "oak-pkg/src/main/content/jcr_root",
                "filterXml": "oak-pkg/src/main/content/META-INF/vault/filter.xml",
            }],
            "bundles": [], "targetModules": {"uiApps": "ui.apps"}, "groupId": "",
        }
        findings = I.scan_findings(d, cfg)
        self.assertFalse([f for f in findings if f.code == "RM-905"],
                          f"expected no RM-905 finding when every index node is covered, got: {findings}")

    def test_oak_index_filter_gap_none_when_broad_ancestor_root_covers_all(self):
        # Negative case (Phase-2 final-wave Fix 4): a single BROAD ancestor filter
        # root of "/oak:index" itself (not one per-index "/oak:index/<name>" root)
        # still covers every oak:QueryIndexDefinition node underneath it -- it must
        # not falsely flag every index node as an RM-905 gap.
        d = Path(tempfile.mkdtemp())
        pkg = d / "oak-pkg"
        jcr_root = pkg / "src/main/content/jcr_root"
        (jcr_root / "_oak_index").mkdir(parents=True)
        (jcr_root / "_oak_index/.content.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:oak="http://jackrabbit.apache.org/oak/ns/1.0" '
            'jcr:primaryType="nt:unstructured">\n'
            '  <someIndex jcr:primaryType="oak:QueryIndexDefinition" type="property"/>\n'
            '  <otherIndex jcr:primaryType="oak:QueryIndexDefinition" type="property"/>\n'
            '</jcr:root>\n')
        vault = pkg / "src/main/content/META-INF/vault"
        vault.mkdir(parents=True)
        (vault / "filter.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<workspaceFilter version="1.0">\n'
            '    <filter root="/oak:index"/>\n'
            '</workspaceFilter>\n')
        cfg = {
            "contentPackages": [{
                "path": "oak-pkg",
                "jcrRoot": "oak-pkg/src/main/content/jcr_root",
                "filterXml": "oak-pkg/src/main/content/META-INF/vault/filter.xml",
            }],
            "bundles": [], "targetModules": {"uiApps": "ui.apps"}, "groupId": "",
        }
        findings = I.scan_findings(d, cfg)
        self.assertFalse([f for f in findings if f.code == "RM-905"],
                          f"expected no RM-905 finding when a broad /oak:index root "
                          f"covers all index nodes, got: {findings}")

    def test_oak_index_filter_gap_no_content_package_no_finding(self):
        # A content package with no _oak_index directory at all must not raise RM-905
        # (nothing to flag) and must not error out.
        d = Path(tempfile.mkdtemp())
        pkg = d / "plain-pkg"
        (pkg / "src/main/content/jcr_root").mkdir(parents=True)
        cfg = {
            "contentPackages": [{
                "path": "plain-pkg",
                "jcrRoot": "plain-pkg/src/main/content/jcr_root",
                "filterXml": "plain-pkg/src/main/content/META-INF/vault/filter.xml",
            }],
            "bundles": [], "targetModules": {"uiApps": "ui.apps"}, "groupId": "",
        }
        findings = I.scan_findings(d, cfg)
        self.assertFalse([f for f in findings if f.code == "RM-905"], findings)

    def test_scan_findings_uses_configured_ui_apps_target_not_literal(self):
        # scan_findings must scan whatever module is configured as
        # targetModules.uiApps, not a hardcoded "ui.apps" literal -- so a content
        # package renamed away from "ui.apps" is still scanned for RM-101.
        d = Path(tempfile.mkdtemp())
        mod = d / "apps-renamed"
        mod.mkdir(parents=True)
        (mod / "pom.xml").write_text(
            '<project xmlns="http://maven.apache.org/POM/4.0.0">'
            '<artifactId>acme.apps-renamed</artifactId>'
            '<dependencies><dependency>'
            '<groupId>net.engio</groupId><artifactId>mbassador</artifactId>'
            '</dependency></dependencies></project>')
        cfg = {
            "groupId": "com.acme", "bundles": [],
            "contentPackages": [{"path": "apps-renamed",
                                  "filterXml": "apps-renamed/src/main/content/META-INF/vault/filter.xml"}],
            "targetModules": {"uiApps": "apps-renamed"},
        }
        findings = I.scan_findings(d, cfg)
        self.assertTrue(any(f.code == "RM-101" and "mbassador" in f.detail for f in findings),
                         f"expected the renamed uiApps target to be scanned, got: {findings}")


class IsThirdPartyGuards(unittest.TestCase):
    """Direct unit tests of `_is_third_party`'s exemption guards that the
    fixture-driven `Findings` tests above don't isolate on their own."""

    def test_empty_own_group_does_not_exempt_everything(self):
        # `str.startswith("")` is True for ANY string, so `_is_third_party`'s own-group
        # check MUST short-circuit on a falsy own_group (`own_group and
        # group_id.startswith(own_group)`) -- otherwise an empty own_group (e.g. a
        # config with groupId "") would make every dependency look like it "starts
        # with" the project's own group and nothing would ever be flagged.
        # An ordinary third-party dep is still flagged despite own_group=="":
        self.assertTrue(I._is_third_party("net.engio", "mbassador", "", ""))
        # ...and a genuinely provided dep is still correctly exempted on its own
        # PROVIDED_PREFIXES merits (not spuriously via the empty own_group, and not
        # wrongly flagged either):
        self.assertFalse(I._is_third_party("com.adobe.aem", "aem-api", "", ""))

    def test_provided_scope_exempts_even_an_ordinary_groupid(self):
        # scope == "provided" must exempt a dependency regardless of groupId -- even
        # one that matches NONE of the other exemptions (not the project's own
        # group, not a PROVIDED_PREFIXES platform group, not a known test-lib group).
        self.assertFalse(I._is_third_party("com.example.vendor", "somelib", "provided", "com.acme"))


class InventoryCli(unittest.TestCase):
    def test_capture_inventory_shape(self):
        inv = I.capture_inventory(FIX)
        self.assertTrue(inv["capturedAt"].endswith("Z"))
        self.assertTrue(inv["files"])
        self.assertIn("path", inv["files"][0]); self.assertIn("sha256", inv["files"][0])

    def test_main_writes_manifest(self):
        d = Path(tempfile.mkdtemp()) / "proj"; shutil.copytree(FIX, d)
        self.assertEqual(I.main([str(d)]), 0)
        self.assertTrue((d / ".modernize/config.json").exists())
        self.assertTrue((d / ".modernize/inventory.json").exists())
        self.assertTrue((d / ".modernize/findings.json").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
