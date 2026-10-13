# scripts/test_refactor_poms.py
"""Tests for refactor_poms.py: bundle POM refactor (Phase-2 Task B2) --
drop `com.adobe.aem:uber-jar`, flag legacy Felix maven-scr-plugin/
maven-bundle-plugin for a BND migration hand-off, leave the Felix plugins
in place, and touch bundle identity only if it's actually mismatched -- and
content-package POM refactor (Task B3) -- reshape the legacy
`com.day.jcr.vault:content-package-maven-plugin` down to a bare
`<extensions>true</extensions>` (dropping its legacy `<configuration>`/
`<embeddeds>`, but keeping the plugin itself: `mvn package` needs SOME
plugin declaring `<extensions>true</extensions>` to build a
`content-package`-packaged module at all), ADD `org.apache.jackrabbit:
filevault-package-maven-plugin` as a separate plugin carrying the real
configuration, remove the now-dead `autoInstallPackage`/
`autoInstallPackagePublish` profiles, and flag surviving ACL authoring with
`accessControlHandling=merge_preserve`.

Run under the lxml venv from the skill dir, with WKND_FIXTURE pointing at
a read-only copy of the wknd legacy fixture
(the public aem-guides-wknd sample, in its legacy pre-Cloud shape):

    WKND_FIXTURE=<path> .venv/bin/python scripts/test_refactor_poms.py -v

The git-diff-locality harness (`_git_init_copy` / `_numstat` / `_diff`) is
reused verbatim from scripts/test_pom_engine.py (itself ported from
the Phase-0 prototype tests) -- a git-tracked
copy is the only way to prove an edit's diff is confined to the lines it
meant to touch, formatting elsewhere included.
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import inspect_project as I
import refactor_poms as R
import rm_common as C
import scaffold_modules as SC
import split_content as SP
import validate as V

FIXTURE = Path(os.environ["WKND_FIXTURE"])
NS = "http://maven.apache.org/POM/4.0.0"
TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "assets" / "archetype-pom-templates"


def _git_init_copy(src):
    d = Path(tempfile.mkdtemp())
    shutil.copytree(src, d / "proj")
    proj = d / "proj"
    subprocess.run(["git", "init", "-q"], cwd=proj, check=True)
    subprocess.run(["git", "add", "-A"], cwd=proj, check=True)
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"],
        cwd=proj, check=True,
    )
    return proj


def _numstat(proj):
    return subprocess.run(
        ["git", "diff", "--numstat"], cwd=proj, capture_output=True, text=True
    ).stdout.strip()


def _diff(proj, rel):
    return subprocess.run(
        ["git", "diff", "--unified=0", "--", rel], cwd=proj, capture_output=True, text=True
    ).stdout


class RefactorBundlePomOnFixtureTests(unittest.TestCase):
    """`core/pom.xml` in the real wknd-legacy fixture is exactly the
    'core-shaped' pom the brief describes: a `com.adobe.aem:uber-jar`
    dependency (last in <dependencies>) plus a `maven-scr-plugin` +
    `maven-bundle-plugin` pair (first two plugins under <build>/<plugins>),
    and an already-correct bundle identity
    (artifactId=aem-guides-wknd.core, parent artifactId=aem-guides-wknd)."""

    def setUp(self):
        self.proj = _git_init_copy(FIXTURE)
        self.pom = self.proj / "core" / "pom.xml"
        self.config = {"groupId": "com.adobe.aem.guides", "artifactId": "aem-guides-wknd",
                       "appId": "wknd"}

    def tearDown(self):
        shutil.rmtree(self.proj.parent, ignore_errors=True)

    def test_uber_jar_dependency_is_removed(self):
        R.refactor_bundle_pom(self.pom, self.config)
        text = self.pom.read_text()
        self.assertNotIn("uber-jar", text)

    def test_felix_to_bnd_high_finding_is_emitted(self):
        findings = R.refactor_bundle_pom(self.pom, self.config)
        self.assertEqual(len(findings), 1, f"expected exactly one finding, got: {findings}")
        f = findings[0]
        self.assertIsInstance(f, C.Finding)
        self.assertEqual(f.code, R.FELIX_TO_BND_FINDING_CODE)
        self.assertEqual(f.priority, "HIGH")
        self.assertIn("BND", f.detail)
        self.assertIn("maven-scr-plugin", f.detail)
        self.assertIn("code-assessment", f.detail)

    def test_felix_plugins_are_left_in_place(self):
        R.refactor_bundle_pom(self.pom, self.config)
        text = self.pom.read_text()
        self.assertIn("<artifactId>maven-scr-plugin</artifactId>", text)
        self.assertIn("<artifactId>maven-bundle-plugin</artifactId>", text)
        # The Felix plugin's real configuration content must survive too --
        # not just its identity tags.
        self.assertIn("Sling-Model-Packages", text)
        self.assertIn("Import-Package", text)

    def test_bundle_identity_is_a_noop_when_already_correct(self):
        before = self.pom.read_text()
        R.refactor_bundle_pom(self.pom, self.config)
        after = self.pom.read_text()
        # Every artifactId/name line the fixture started with is untouched;
        # the only permissible textual change is the uber-jar block going
        # away.
        for line in before.splitlines():
            if "artifactId>aem-guides-wknd.core" in line or "<name>wknd - Core" in line:
                self.assertIn(line, after.splitlines(), f"identity line mutated: {line!r}")

    def test_diff_drops_uber_jar_adds_sdk_api_and_leaves_felix_untouched(self):
        R.refactor_bundle_pom(self.pom, self.config)
        diff = _diff(self.proj, "core/pom.xml")

        added = [l for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++")]
        removed = [l for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")]

        # uber-jar dropped ...
        self.assertTrue(any("uber-jar" in l for l in removed), f"uber-jar not removed:\n{diff}")
        # ... and its Cloud replacement aem-sdk-api added (a PRE-EXISTING bundle,
        # edited in place, gets the bare replacement so it keeps an AEM API surface).
        self.assertTrue(any("aem-sdk-api" in l for l in added), f"aem-sdk-api not added:\n{diff}")

        # The Felix SCR/bundle plugin block is left in place (RM-902 hand-off) --
        # nothing from it may be touched.
        self.assertFalse(any("maven-scr-plugin" in l for l in removed), f"Felix plugin touched:\n{diff}")
        self.assertFalse(any("maven-bundle-plugin" in l for l in removed), f"Felix plugin touched:\n{diff}")
        self.assertFalse(any("Sling-Model-Packages" in l for l in removed), f"Felix config touched:\n{diff}")

        # Every REMOVED line belongs to the uber-jar <dependency> block -- its own
        # open/close tags or its own coordinates -- and nothing else was reflowed.
        for l in removed:
            body = l[1:].strip()
            self.assertTrue(
                body in ("<dependency>", "</dependency>") or "uber-jar" in l or "com.adobe.aem" in l,
                f"unexpected line removed outside the uber-jar block: {l!r}\nfull diff:\n{diff}",
            )

    def test_no_op_run_is_git_clean_besides_the_bundle_pom(self):
        # Belt-and-suspenders on top of the per-file diff check above: the
        # WHOLE copied project tree should show exactly one changed file (core/pom.xml).
        R.refactor_bundle_pom(self.pom, self.config)
        changed = _numstat(self.proj)
        lines = [l for l in changed.splitlines() if l.strip()]
        self.assertEqual(len(lines), 1, f"expected exactly one changed file:\n{changed}")
        self.assertIn("core/pom.xml", lines[0])


class RefactorBundlePomCraftedTests(unittest.TestCase):
    """Crafted (non-fixture) poms pin the edge cases the real fixture can't:
    no Felix plugin present (no finding), and an identity that is actually
    mismatched (gets rewritten)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write(self, moddir_name, xml):
        moddir = self.tmp / moddir_name
        moddir.mkdir(parents=True, exist_ok=True)
        p = moddir / "pom.xml"
        p.write_text(xml)
        return p

    def test_no_felix_plugin_means_no_finding(self):
        p = self._write("core", f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>com.example</groupId>
    <artifactId>example-parent</artifactId>
    <version>1.0</version>
  </parent>
  <artifactId>example-parent.core</artifactId>
  <packaging>bundle</packaging>
  <build>
    <plugins>
      <plugin>
        <groupId>biz.aQute.bnd</groupId>
        <artifactId>bnd-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>kept</artifactId>
    </dependency>
  </dependencies>
</project>
""")
        findings = R.refactor_bundle_pom(p, {"artifactId": "example-parent"})
        self.assertEqual(findings, [])

    def test_uber_jar_absent_is_not_an_error(self):
        p = self._write("core", f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>standalone</artifactId>
</project>
""")
        findings = R.refactor_bundle_pom(p, {})
        self.assertEqual(findings, [])

    def test_identity_is_rewritten_when_actually_mismatched(self):
        p = self._write("core", f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>com.example</groupId>
    <artifactId>example-parent</artifactId>
    <version>1.0</version>
  </parent>
  <artifactId>totally-wrong-name</artifactId>
  <name>Core</name>
  <packaging>bundle</packaging>
</project>
""")
        R.refactor_bundle_pom(p, {})
        text = p.read_text()
        self.assertIn("<artifactId>example-parent.core</artifactId>", text)
        self.assertNotIn("totally-wrong-name", text)
        # <name> has no formula to check against -- left alone.
        self.assertIn("<name>Core</name>", text)

    def test_identity_falls_back_to_config_artifact_id_when_parent_missing(self):
        p = self._write("core", f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>wrong</artifactId>
</project>
""")
        R.refactor_bundle_pom(p, {"artifactId": "example-parent"})
        text = p.read_text()
        self.assertIn("<artifactId>example-parent.core</artifactId>", text)


class RefactorContentPomOnFixtureTests(unittest.TestCase):
    """`ui.apps/pom.xml` and `ui.content/pom.xml` in the real wknd-legacy
    fixture are exactly the brief's ui.apps-shaped/ui.content-shaped poms:
    legacy `com.day.jcr.vault:content-package-maven-plugin` (with a
    `filterSource`, a `group`, and an `<embeddeds>` embedding `core` at
    `/apps/wknd/install`), plus `autoInstallPackage`/
    `autoInstallPackagePublish` profiles that reference that same plugin.

    `ui.content`'s own jcr_root also has REAL ACL authoring under
    `content/dam/wknd` (a `_rep_policy.xml` sidecar with
    `jcr:primaryType="rep:ACL"`, referenced inline via `<rep:policy/>`) --
    `ui.apps` has none -- so both branches of the ACL detector get real
    fixture coverage, not just a crafted one."""

    def setUp(self):
        self.proj = _git_init_copy(FIXTURE)
        # version matches the real fixture's own <parent><version> (verified
        # against ui.apps/pom.xml / ui.content/pom.xml) -- config-schema.md
        # guarantees this key is always present on a real config.json.
        # `bundles` matches config-schema.md's own WKND example verbatim
        # (identical to RefactorAllPomOnFixtureTests' own config below) --
        # needed by Fix round 1's Fix 2 (`_drop_project_bundle_dependencies`),
        # which reads `config["bundles"]` the same way `refactor_all_pom`
        # already does to compute each bundle's embedded artifactId.
        self.config = {"groupId": "com.adobe.aem.guides", "artifactId": "aem-guides-wknd",
                       "appId": "wknd", "version": "1.0-SNAPSHOT",
                       "bundles": [
                           {"path": "core", "artifactIdSuffix": "core", "isTest": False},
                           {"path": "bundle2", "artifactIdSuffix": "bundle2", "isTest": False},
                       ]}

    def tearDown(self):
        shutil.rmtree(self.proj.parent, ignore_errors=True)

    def _refactor(self, module_dir, module_key):
        pom = self.proj / module_dir / "pom.xml"
        findings = R.refactor_content_pom(pom, self.config, module_key)
        return pom.read_text(), findings

    def _assert_filevault_config_multiline(self, out):
        start = out.index("<artifactId>filevault-package-maven-plugin</artifactId>")
        config_start = out.index("<configuration>", start)
        config_end = out.index("</configuration>", config_start)
        block = out[config_start:config_end]
        self.assertGreater(block.count("\n"), 5, f"configuration serialized densely:\n{block}")
        self.assertRegex(out[start:], r"\n[ \t]+<packageType>")

    def _extract_plugin_block(self, out, artifact_id):
        """The `<plugin>...</plugin>` substring whose own `<artifactId>`
        text equals `artifact_id` (assumed globally unique in the
        document -- true for both plugins this task cares about: each
        pom has exactly one `content-package-maven-plugin` and exactly
        one `filevault-package-maven-plugin`). Lets a test assert on JUST
        one plugin's own children (e.g. "no <configuration> here")
        without a bare substring search elsewhere in the file -- e.g. the
        OTHER plugin's own <configuration> -- coincidentally satisfying
        it."""
        artifact_tag = f"<artifactId>{artifact_id}</artifactId>"
        artifact_idx = out.index(artifact_tag)
        start = out.rindex("<plugin>", 0, artifact_idx)
        end = out.index("</plugin>", artifact_idx) + len("</plugin>")
        return out[start:end]

    # --- ui.apps ---

    def test_ui_apps_converted_to_filevault_application(self):
        out, _ = self._refactor("ui.apps", "uiApps")
        self.assertIn("filevault-package-maven-plugin", out)
        self.assertIn("<packageType>application</packageType>", out)
        self.assertIn("<cloudManagerTarget>none</cloudManagerTarget>", out)
        self.assertNotIn("/apps/wknd/install", out)   # legacy core embed dropped

    def test_ui_apps_keeps_bare_content_package_plugin_for_extensions_binding(self):
        # CRITICAL regression pin (fix round 1): <packaging>content-package
        # </packaging> has no lifecycle mapping without SOME plugin
        # declaring <extensions>true</extensions> -- mvn package cannot
        # build the module otherwise. The archetype template keeps
        # com.day.jcr.vault:content-package-maven-plugin around for
        # exactly this, bare -- no <configuration> at all, which is what
        # carries the "legacy embed/filterSource/group dropped" guarantee
        # while still satisfying the lifecycle binding mvn needs.
        out, _ = self._refactor("ui.apps", "uiApps")
        self.assertIn("<groupId>com.day.jcr.vault</groupId>", out)
        self.assertIn("<artifactId>content-package-maven-plugin</artifactId>", out)
        self.assertIn("<extensions>true</extensions>", out)
        block = self._extract_plugin_block(out, "content-package-maven-plugin")
        self.assertIn("<extensions>true</extensions>", block)
        self.assertNotIn("<configuration>", block)
        self.assertNotIn("<embeddeds>", block)
        self.assertNotIn("<filterSource>", block)
        self.assertNotIn("/apps/wknd/install", block)

    def test_ui_apps_filevault_plugin_carries_no_extensions_tag(self):
        # Matches the archetype template exactly: the <extensions>true
        # binding lives SOLELY on the (bare) content-package-maven-plugin
        # above -- filevault-package-maven-plugin itself carries only the
        # <configuration>, never its own <extensions>.
        out, _ = self._refactor("ui.apps", "uiApps")
        block = self._extract_plugin_block(out, "filevault-package-maven-plugin")
        self.assertNotIn("<extensions>", block)

    def test_ui_apps_group_name_and_repository_structure_from_config(self):
        out, _ = self._refactor("ui.apps", "uiApps")
        self.assertIn("<group>com.adobe.aem.guides</group>", out)
        self.assertIn("<name>aem-guides-wknd.ui.apps</name>", out)
        self.assertIn("<artifactId>aem-guides-wknd.ui.apps.structure</artifactId>", out)

    def test_ui_apps_legacy_install_profiles_removed(self):
        out, _ = self._refactor("ui.apps", "uiApps")
        self.assertNotIn("<id>autoInstallPackage</id>", out)
        self.assertNotIn("<id>autoInstallPackagePublish</id>", out)

    def test_ui_apps_unrelated_content_untouched(self):
        # NOTE: `aem-guides-wknd.bundle2`/`aem-guides-wknd.core` are
        # DELIBERATELY not asserted here as "untouched" -- Fix round 1's
        # Fix 2 now drops those two vestigial project-bundle dependencies by
        # design (see test_ui_apps_drops_project_bundle_dependencies below);
        # this test now only pins genuinely-unrelated content (the resources
        # plugin execution, an external provided dependency).
        out, _ = self._refactor("ui.apps", "uiApps")
        self.assertIn("copy-metainf-vault-resources", out)
        self.assertIn("cq-wcm-taglib", out)

    def test_ui_apps_has_no_acl_finding(self):
        _, findings = self._refactor("ui.apps", "uiApps")
        self.assertEqual(findings, [])

    def test_ui_apps_injected_configuration_is_multiline_not_dense(self):
        out, _ = self._refactor("ui.apps", "uiApps")
        self._assert_filevault_config_multiline(out)

    def test_ui_apps_diff_does_not_touch_unrelated_sections(self):
        # `aem-guides-wknd.bundle2`/`aem-guides-wknd.core` are intentionally
        # NOT in this "must not be removed" list -- Fix round 1's Fix 2
        # removes exactly those two lines by design (see
        # test_ui_apps_drops_project_bundle_dependencies below); every other
        # marker here is genuinely unrelated and must survive untouched.
        R.refactor_content_pom(self.proj / "ui.apps" / "pom.xml", self.config, "uiApps")
        diff = _diff(self.proj, "ui.apps/pom.xml")
        removed = [l for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")]
        for marker in ("maven-resources-plugin", "copy-metainf-vault-resources",
                       "cq-wcm-taglib", "<artifactId>jcr</artifactId>", "servlet-api"):
            self.assertFalse(any(marker in l for l in removed),
                              f"unrelated content touched ({marker!r}):\n{diff}")

    def test_ui_apps_only_one_file_changes(self):
        R.refactor_content_pom(self.proj / "ui.apps" / "pom.xml", self.config, "uiApps")
        changed = [l for l in _numstat(self.proj).splitlines() if l.strip()]
        self.assertEqual(len(changed), 1, f"expected exactly one changed file:\n{changed}")
        self.assertIn("ui.apps/pom.xml", changed[0])

    def test_ui_apps_refactor_is_idempotent(self):
        pom = self.proj / "ui.apps" / "pom.xml"
        R.refactor_content_pom(pom, self.config, "uiApps")
        once = pom.read_text()
        findings2 = R.refactor_content_pom(pom, self.config, "uiApps")
        self.assertEqual(once, pom.read_text())
        self.assertEqual(findings2, [])

    # --- Fix round 1: the module's own <dependencies> must actually satisfy
    # the filevault config it was just given, and must not still depend on
    # the project's own bundle modules (confirmed unbuildable before this
    # fix by actually running `mvn -pl <content modules> -am clean package`
    # against the real fixture -- see refactor_poms.py's own module
    # docstring for the two captured failure classes). ---

    def test_ui_apps_declares_structure_dependency_matching_filevault_config(self):
        out, _ = self._refactor("ui.apps", "uiApps")
        # repositoryStructurePackages (already present pre-fix) references
        # this artifact once; the fix adds a SECOND, real, top-level
        # <dependency> occurrence -- without it, filevault-package-maven-
        # plugin:validate-files fails with "...was not found among the
        # Maven dependencies of this project" (reproduced against the real
        # fixture before this fix existed).
        self.assertEqual(
            out.count("<artifactId>aem-guides-wknd.ui.apps.structure</artifactId>"), 2,
            f"expected exactly 2 occurrences (repositoryStructurePackage + "
            f"the new top-level <dependency>):\n{out}")
        last = out.rindex("<artifactId>aem-guides-wknd.ui.apps.structure</artifactId>")
        dep_start = out.rindex("<dependency>", 0, last)
        dep_end = out.index("</dependency>", last) + len("</dependency>")
        dep_block = out[dep_start:dep_end]
        self.assertIn("<groupId>com.adobe.aem.guides</groupId>", dep_block)
        self.assertIn("<version>1.0-SNAPSHOT</version>", dep_block)
        self.assertIn("<type>zip</type>", dep_block)

    def test_ui_apps_drops_project_bundle_dependencies_keeps_external_deps(self):
        out, _ = self._refactor("ui.apps", "uiApps")
        self.assertNotIn("<artifactId>aem-guides-wknd.core</artifactId>", out)
        self.assertNotIn("<artifactId>aem-guides-wknd.bundle2</artifactId>", out)
        # external provided deps must survive untouched
        self.assertIn("<artifactId>aem-api</artifactId>", out)
        self.assertIn("<artifactId>jcr</artifactId>", out)
        self.assertIn("<artifactId>servlet-api</artifactId>", out)
        self.assertIn("<artifactId>cq-wcm-taglib</artifactId>", out)

    def test_ui_apps_dependency_fix_is_idempotent(self):
        pom = self.proj / "ui.apps" / "pom.xml"
        R.refactor_content_pom(pom, self.config, "uiApps")
        once = pom.read_text()
        R.refactor_content_pom(pom, self.config, "uiApps")
        twice = pom.read_text()
        self.assertEqual(once, twice)
        self.assertEqual(
            twice.count("<artifactId>aem-guides-wknd.ui.apps.structure</artifactId>"), 2,
            "a second run must not add a duplicate dependency")

    # --- ui.content ---

    def test_ui_content_converted_to_filevault_content(self):
        out, _ = self._refactor("ui.content", "uiContent")
        self.assertIn("filevault-package-maven-plugin", out)
        self.assertIn("<packageType>content</packageType>", out)
        self.assertIn("<cloudManagerTarget>none</cloudManagerTarget>", out)
        self.assertNotIn("/apps/wknd/install", out)   # legacy core embed dropped

    def test_ui_content_keeps_bare_content_package_plugin_for_extensions_binding(self):
        # Same CRITICAL regression pin as ui.apps -- see that test's own
        # comment for why this plugin must survive, bare, rather than being
        # renamed away.
        out, _ = self._refactor("ui.content", "uiContent")
        self.assertIn("<groupId>com.day.jcr.vault</groupId>", out)
        self.assertIn("<artifactId>content-package-maven-plugin</artifactId>", out)
        self.assertIn("<extensions>true</extensions>", out)
        block = self._extract_plugin_block(out, "content-package-maven-plugin")
        self.assertIn("<extensions>true</extensions>", block)
        self.assertNotIn("<configuration>", block)
        self.assertNotIn("<embeddeds>", block)
        self.assertNotIn("<filterSource>", block)
        self.assertNotIn("/apps/wknd/install", block)

    def test_ui_content_filevault_plugin_carries_no_extensions_tag(self):
        out, _ = self._refactor("ui.content", "uiContent")
        block = self._extract_plugin_block(out, "filevault-package-maven-plugin")
        self.assertNotIn("<extensions>", block)

    def test_ui_content_group_and_name_from_config(self):
        out, _ = self._refactor("ui.content", "uiContent")
        self.assertIn("<group>com.adobe.aem.guides</group>", out)
        self.assertIn("<name>aem-guides-wknd.ui.content</name>", out)

    def test_ui_content_dependency_on_ui_apps_from_config(self):
        out, _ = self._refactor("ui.content", "uiContent")
        # The filevault plugin's OWN <dependencies> (package-level -- not
        # Maven's top-level <dependencies>) references the customer's own
        # ui.apps package, substituted from config just like group/name --
        # INCLUDING its own <version> (only <groupId>/<artifactId> are
        # asserted above since "aem-guides-wknd.ui.apps" alone already
        # pins group+artifact; <version> gets its own dedicated assertion
        # in test_no_unsubstituted_template_placeholders_survive below,
        # since a real regression here left the raw "{{version}}" token in
        # the file rather than a wrong-but-present value).
        self.assertIn("<artifactId>aem-guides-wknd.ui.apps</artifactId>", out)

    def test_no_unsubstituted_template_placeholders_survive(self):
        # Caught during manual review, not by an earlier version of this
        # test: the ui.content template's inner <dependencies><dependency>
        # on ui.apps carries its OWN {{version}} token, easy to miss since
        # it's not one of the two placeholders the task brief's own example
        # calls out (only {{groupId}}/{{artifactId}}). A raw, unsubstituted
        # "{{...}}" token anywhere in the output would mean some template
        # placeholder wasn't substituted -- this is a general guard, not
        # just a {{version}}-specific one.
        for module_dir, module_key in (("ui.apps", "uiApps"), ("ui.content", "uiContent")):
            out, _ = self._refactor(module_dir, module_key)
            self.assertNotRegex(out, r"\{\{[a-zA-Z]+\}\}",
                                 f"{module_dir}: unsubstituted template placeholder survived")

    def test_ui_content_inner_dependency_version_is_substituted(self):
        out, _ = self._refactor("ui.content", "uiContent")
        self.assertNotIn("{{version}}", out)
        # The filevault plugin's own <dependencies><dependency> block on
        # ui.apps, specifically -- <version>1.0-SNAPSHOT</version> also
        # occurs elsewhere in this same file (e.g. the module's own
        # top-level <version>), so this pins the INNER block precisely by
        # anchoring on its neighboring <artifactId>, rather than a bare
        # assertIn that a coincidental match elsewhere could satisfy even
        # if this specific substitution were broken.
        start = out.index("<artifactId>aem-guides-wknd.ui.apps</artifactId>",
                           out.index("filevault-package-maven-plugin"))
        end = out.index("</dependency>", start)
        self.assertIn("<version>1.0-SNAPSHOT</version>", out[start:end])

    def test_ui_content_legacy_install_profiles_removed(self):
        out, _ = self._refactor("ui.content", "uiContent")
        self.assertNotIn("<id>autoInstallPackage</id>", out)
        self.assertNotIn("<id>autoInstallPackagePublish</id>", out)

    def test_ui_content_real_acl_authoring_triggers_merge_preserve(self):
        out, findings = self._refactor("ui.content", "uiContent")
        self.assertIn("<accessControlHandling>merge_preserve</accessControlHandling>", out)
        self.assertEqual(len(findings), 1, f"expected exactly one finding, got: {findings}")
        f = findings[0]
        self.assertIsInstance(f, C.Finding)
        self.assertEqual(f.code, R.ACL_HANDLING_FINDING_CODE)
        self.assertEqual(f.priority, "NORMAL")
        self.assertIn("ACL", f.detail)
        self.assertIn("merge_preserve", f.detail)

    def test_ui_content_injected_configuration_is_multiline_not_dense(self):
        out, _ = self._refactor("ui.content", "uiContent")
        self._assert_filevault_config_multiline(out)

    def test_ui_content_only_one_file_changes(self):
        R.refactor_content_pom(self.proj / "ui.content" / "pom.xml", self.config, "uiContent")
        changed = [l for l in _numstat(self.proj).splitlines() if l.strip()]
        self.assertEqual(len(changed), 1, f"expected exactly one changed file:\n{changed}")
        self.assertIn("ui.content/pom.xml", changed[0])

    # --- Fix round 1 (see the matching ui.apps section above for why this
    # matters -- identical failure class, just against ui.content's own
    # reference to `...ui.apps` rather than `...ui.apps.structure`). ---

    def test_ui_content_declares_ui_apps_dependency_matching_filevault_config(self):
        out, _ = self._refactor("ui.content", "uiContent")
        # The filevault plugin's own inner <configuration><dependencies>
        # <dependency> on ui.apps (already present pre-fix, no <type> of its
        # own) references this artifact once; the fix adds a SECOND, real,
        # top-level <dependency> occurrence -- WITH <type>zip</type> -- that
        # the plugin's own <configuration> needs to actually resolve at all.
        self.assertEqual(
            out.count("<artifactId>aem-guides-wknd.ui.apps</artifactId>"), 2,
            f"expected exactly 2 occurrences (the filevault plugin's own "
            f"inner package-dependency reference + the new top-level "
            f"<dependency>):\n{out}")
        last = out.rindex("<artifactId>aem-guides-wknd.ui.apps</artifactId>")
        dep_start = out.rindex("<dependency>", 0, last)
        dep_end = out.index("</dependency>", last) + len("</dependency>")
        dep_block = out[dep_start:dep_end]
        self.assertIn("<groupId>com.adobe.aem.guides</groupId>", dep_block)
        self.assertIn("<version>1.0-SNAPSHOT</version>", dep_block)
        self.assertIn("<type>zip</type>", dep_block)

    def test_ui_content_drops_project_bundle_dependency_keeps_external_deps(self):
        out, _ = self._refactor("ui.content", "uiContent")
        self.assertNotIn("<artifactId>aem-guides-wknd.core</artifactId>", out)
        # ui.content never depended on bundle2 to begin with (only ui.apps
        # did) -- confirm this fix doesn't fabricate a drop of something
        # that was never declared.
        self.assertNotIn("<artifactId>aem-guides-wknd.bundle2</artifactId>", out)
        self.assertIn("<artifactId>aem-api</artifactId>", out)

    def test_ui_content_dependency_fix_is_idempotent(self):
        # Unlike the ui.apps idempotency pin above, `findings` is NOT
        # expected to go empty on the second run: ui.content's real ACL
        # content (content/dam/wknd) is detected fresh from the filesystem
        # on every call, independent of pom state, so the ACL finding is
        # legitimately raised again -- see
        # test_ui_content_real_acl_authoring_triggers_merge_preserve. What
        # must stay idempotent is the FILE CONTENT: no duplicate dependency
        # on a second run.
        pom = self.proj / "ui.content" / "pom.xml"
        R.refactor_content_pom(pom, self.config, "uiContent")
        once = pom.read_text()
        R.refactor_content_pom(pom, self.config, "uiContent")
        twice = pom.read_text()
        self.assertEqual(once, twice)
        self.assertEqual(
            twice.count("<artifactId>aem-guides-wknd.ui.apps</artifactId>"), 2,
            "a second run must not add a duplicate dependency")


class RefactorContentPomCraftedTests(unittest.TestCase):
    """Crafted (non-fixture) poms pin edge cases the real fixture can't: an
    invalid `module_key`, a pom with NO existing content-package plugin at
    all (exercises `pom_engine.ensure_plugin`'s "insert new" path for BOTH
    plugins, rather than the fixture's "reshape existing plugin in place"
    path), a legacy plugin that's missing `<extensions>true</extensions>`
    to begin with (must still end up with it), and ACL detection by
    filename alone (a `_rep_policy.xml` whose own body doesn't mention
    `rep:ACL`/`rep:policy` as text -- proving the filename check is
    independent of the content-substring check, not just usually redundant
    with it)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.config = {"groupId": "com.example", "artifactId": "example-app", "appId": "example",
                       "version": "1.0.0-SNAPSHOT"}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write(self, moddir_name, xml):
        moddir = self.tmp / moddir_name
        moddir.mkdir(parents=True, exist_ok=True)
        p = moddir / "pom.xml"
        p.write_text(xml)
        return p

    def test_invalid_module_key_raises(self):
        p = self._write("ui.apps", f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>example-app.ui.apps</artifactId>
</project>
""")
        with self.assertRaises(ValueError):
            R.refactor_content_pom(p, self.config, "bogusKey")

    def test_inserts_filevault_plugin_when_no_legacy_plugin_present(self):
        p = self._write("ui.apps", f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>example-app.ui.apps</artifactId>
  <packaging>content-package</packaging>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-resources-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
""")
        findings = R.refactor_content_pom(p, self.config, "uiApps")
        text = p.read_text()
        self.assertIn("filevault-package-maven-plugin", text)
        self.assertIn("<packageType>application</packageType>", text)
        self.assertIn("<cloudManagerTarget>none</cloudManagerTarget>", text)
        self.assertIn("maven-resources-plugin", text)  # untouched sibling plugin
        # The legacy plugin didn't exist AT ALL on this input -- confirms
        # ensure_plugin's "insert new" path also produces the bare
        # extensions-true binding, not just its "reshape existing" path.
        self.assertIn("<groupId>com.day.jcr.vault</groupId>", text)
        self.assertIn("<artifactId>content-package-maven-plugin</artifactId>", text)
        self.assertIn("<extensions>true</extensions>", text)
        self.assertEqual(findings, [])

    def test_legacy_plugin_missing_extensions_gets_it_added(self):
        # The fixture's own legacy plugin already has <extensions>true
        # </extensions> (so that branch never gets exercised there) --
        # this pins the case the coordinator's fix explicitly called out:
        # a legacy plugin present WITH a <configuration> but WITHOUT
        # <extensions> must still end up with <extensions>true</extensions>
        # in the output (and lose its legacy <configuration> either way).
        p = self._write("ui.apps", f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>example-app.ui.apps</artifactId>
  <packaging>content-package</packaging>
  <build>
    <plugins>
      <plugin>
        <groupId>com.day.jcr.vault</groupId>
        <artifactId>content-package-maven-plugin</artifactId>
        <configuration>
          <verbose>true</verbose>
          <embeddeds>
            <embedded>
              <groupId>com.example</groupId>
              <artifactId>example-app.core</artifactId>
              <target>/apps/example/install</target>
            </embedded>
          </embeddeds>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
""")
        R.refactor_content_pom(p, self.config, "uiApps")
        text = p.read_text()
        self.assertIn("<extensions>true</extensions>", text)
        self.assertIn("filevault-package-maven-plugin", text)
        self.assertNotIn("/apps/example/install", text)
        block_start = text.rindex("<plugin>", 0, text.index("content-package-maven-plugin"))
        block_end = text.index("</plugin>", block_start) + len("</plugin>")
        legacy_block = text[block_start:block_end]
        self.assertNotIn("<configuration>", legacy_block)
        self.assertNotIn("<embeddeds>", legacy_block)

    def test_acl_detected_by_filename_alone(self):
        p = self._write("ui.content", f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>example-app.ui.content</artifactId>
  <packaging>content-package</packaging>
  <build>
    <plugins>
      <plugin>
        <groupId>com.day.jcr.vault</groupId>
        <artifactId>content-package-maven-plugin</artifactId>
        <extensions>true</extensions>
      </plugin>
    </plugins>
  </build>
</project>
""")
        jcr_root = p.parent / "src" / "main" / "content" / "jcr_root" / "content" / "example"
        jcr_root.mkdir(parents=True)
        # Deliberately does NOT contain "rep:ACL"/"rep:policy" as text --
        # only the filename itself should trigger detection here.
        (jcr_root / "_rep_policy.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0"/>\n'
        )
        findings = R.refactor_content_pom(p, self.config, "uiContent")
        text = p.read_text()
        self.assertIn("<accessControlHandling>merge_preserve</accessControlHandling>", text)
        self.assertEqual(len(findings), 1, f"expected exactly one finding, got: {findings}")
        self.assertEqual(findings[0].code, R.ACL_HANDLING_FINDING_CODE)
        self.assertEqual(findings[0].priority, "NORMAL")
        # This input's legacy plugin already had <extensions>true</extensions>
        # -- confirm the ACL-handling branch doesn't disturb that binding.
        self.assertIn("<extensions>true</extensions>", text)
        self.assertIn("filevault-package-maven-plugin", text)

    def test_no_acl_content_means_no_finding_and_no_access_control_handling(self):
        p = self._write("ui.apps", f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>example-app.ui.apps</artifactId>
  <packaging>content-package</packaging>
  <build>
    <plugins>
      <plugin>
        <groupId>com.day.jcr.vault</groupId>
        <artifactId>content-package-maven-plugin</artifactId>
        <extensions>true</extensions>
      </plugin>
    </plugins>
  </build>
</project>
""")
        findings = R.refactor_content_pom(p, self.config, "uiApps")
        text = p.read_text()
        self.assertNotIn("accessControlHandling", text)
        self.assertEqual(findings, [])
        self.assertIn("<extensions>true</extensions>", text)
        self.assertIn("filevault-package-maven-plugin", text)


class RefactorAllPomOnFixtureTests(unittest.TestCase):
    """`all/pom.xml` in the real wknd-legacy fixture is exactly the brief's
    `all`-shaped pom: `filevault-package-maven-plugin` already carries
    `<packageType>container</packageType>` and an `<embeddeds>` embedding
    `ui.apps`, `ui.content`, `oak-indexes`, `core`, `bundle2`, and the
    3rd-party `net.engio:mbassador` -- but NOT `ui.config`. `bundles` in
    `self.config` matches `config-schema.md`'s own WKND example verbatim."""

    def setUp(self):
        self.proj = _git_init_copy(FIXTURE)
        self.pom = self.proj / "all" / "pom.xml"
        self.config = {
            "groupId": "com.adobe.aem.guides", "artifactId": "aem-guides-wknd",
            "appId": "wknd", "version": "1.0-SNAPSHOT",
            "targetModules": {
                "all": "all", "uiApps": "ui.apps", "uiAppsStructure": "ui.apps.structure",
                "uiConfig": "ui.config", "uiContent": "ui.content",
            },
            "bundles": [
                {"path": "core", "artifactIdSuffix": "core", "isTest": False},
                {"path": "bundle2", "artifactIdSuffix": "bundle2", "isTest": False},
            ],
        }

    def tearDown(self):
        shutil.rmtree(self.proj.parent, ignore_errors=True)

    def test_ui_config_embed_is_added(self):
        R.refactor_all_pom(self.pom, self.config)
        text = self.pom.read_text()
        self.assertIn("<artifactId>aem-guides-wknd.ui.config</artifactId>", text)
        start = text.index("<artifactId>aem-guides-wknd.ui.config</artifactId>")
        end = text.index("</embedded>", start)
        block = text[start:end]
        self.assertIn("<type>zip</type>", block)
        self.assertIn("/apps/wknd-packages/application/install", block)
        self.assertIn("<groupId>com.adobe.aem.guides</groupId>",
                       text[text.rindex("<embedded>", 0, start):end])

    def test_existing_embeds_including_mbassador_are_preserved(self):
        R.refactor_all_pom(self.pom, self.config)
        text = self.pom.read_text()
        for artifact in ("aem-guides-wknd.ui.apps", "aem-guides-wknd.ui.content",
                          "aem-guides-wknd.oak-indexes", "aem-guides-wknd.core",
                          "aem-guides-wknd.bundle2"):
            self.assertIn(f"<artifactId>{artifact}</artifactId>", text)
        self.assertIn("<groupId>net.engio</groupId>", text)
        self.assertIn("<artifactId>mbassador</artifactId>", text)
        # mbassador's own top-level Maven <dependency> (separate from its
        # <embedded>, and the only one of the two that carries a <version>)
        # survives too -- this function never calls drop_dependency, so
        # nothing here should ever remove it.
        self.assertIn("<version>1.3.2</version>", text)

    def test_no_duplicate_embeds(self):
        # Scoped to JUST the <embeddeds> block, not the whole document --
        # e.g. "aem-guides-wknd.ui.apps" legitimately appears a SECOND time
        # elsewhere in this fixture too, as `all`'s own top-level Maven
        # <dependency> on the ui.apps package (unrelated to embedding, and
        # not something this function touches) -- so a whole-file count
        # would over-count by design, not because of a real duplicate.
        R.refactor_all_pom(self.pom, self.config)
        text = self.pom.read_text()
        start = text.index("<embeddeds>")
        end = text.index("</embeddeds>")
        block = text[start:end]
        for artifact in ("aem-guides-wknd.ui.apps", "aem-guides-wknd.ui.content",
                          "aem-guides-wknd.oak-indexes", "aem-guides-wknd.core",
                          "aem-guides-wknd.bundle2", "aem-guides-wknd.ui.config"):
            self.assertEqual(block.count(f"<artifactId>{artifact}</artifactId>"), 1,
                              f"{artifact} embedded more than once:\n{block}")
        self.assertEqual(block.count("<artifactId>mbassador</artifactId>"), 1)

    def test_package_type_still_container(self):
        R.refactor_all_pom(self.pom, self.config)
        text = self.pom.read_text()
        self.assertEqual(text.count("<packageType>container</packageType>"), 1)

    def test_check_all_embeds_is_clean_after_refactor(self):
        R.refactor_all_pom(self.pom, self.config)
        violations = V.check_all_embeds(str(self.proj), self.config)
        self.assertEqual(violations, [], f"expected zero violations, got: {violations}")

    def test_third_party_embed_finding_is_emitted_for_mbassador(self):
        findings = R.refactor_all_pom(self.pom, self.config)
        self.assertEqual(len(findings), 1, f"expected exactly one finding, got: {findings}")
        f = findings[0]
        self.assertIsInstance(f, C.Finding)
        self.assertEqual(f.code, R.THIRD_PARTY_EMBED_FINDING_CODE)
        self.assertEqual(f.priority, "NORMAL")
        self.assertIn("net.engio", f.detail)
        self.assertIn("mbassador", f.detail)

    def test_refactor_is_idempotent(self):
        R.refactor_all_pom(self.pom, self.config)
        once = self.pom.read_text()
        findings2 = R.refactor_all_pom(self.pom, self.config)
        self.assertEqual(once, self.pom.read_text())
        # The mbassador note is state-based (re-derived from what's currently
        # embedded), not a first-run-only event -- same idempotency contract
        # refactor_content_pom's own ACL note already has -- so it still
        # fires exactly once per call, never accumulating and never vanishing.
        self.assertEqual(len(findings2), 1)

    def test_diff_adds_ui_config_only_no_removed_lines(self):
        R.refactor_all_pom(self.pom, self.config)
        diff = _diff(self.proj, "all/pom.xml")
        removed = [l for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")]
        added = [l for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++")]
        self.assertEqual(removed, [], f"existing content was reflowed/removed:\n{diff}")
        self.assertTrue(any("ui.config" in l for l in added), f"ui.config embed not added:\n{diff}")

    def test_only_one_file_changes(self):
        R.refactor_all_pom(self.pom, self.config)
        changed = [l for l in _numstat(self.proj).splitlines() if l.strip()]
        self.assertEqual(len(changed), 1, f"expected exactly one changed file:\n{changed}")
        self.assertIn("all/pom.xml", changed[0])


class RefactorAllPomCraftedTests(unittest.TestCase):
    """Crafted (non-fixture) poms pin edge cases the real fixture can't: a
    bundle listed in config that ISN'T embedded yet (the ADD path, not just
    the fixture's ADD-ui.config-only / no-op-bundles-already-there path), a
    wrong `<packageType>` value that must be CORRECTED (not just left
    alone if already right), and an `all` pom with zero bundles configured
    at all."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.config = {
            "groupId": "com.example", "artifactId": "example-app", "appId": "example",
            "targetModules": {"all": "all", "uiApps": "ui.apps", "uiContent": "ui.content",
                               "uiConfig": "ui.config"},
            "bundles": [
                {"path": "core", "artifactIdSuffix": "core", "isTest": False},
                {"path": "bundle3", "artifactIdSuffix": "bundle3", "isTest": False},
            ],
        }

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write(self, xml):
        moddir = self.tmp / "all"
        moddir.mkdir(parents=True, exist_ok=True)
        p = moddir / "pom.xml"
        p.write_text(xml)
        return p

    def test_missing_bundle_is_added_present_bundle_is_not_duplicated(self):
        p = self._write(f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>example-app.all</artifactId>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.jackrabbit</groupId>
        <artifactId>filevault-package-maven-plugin</artifactId>
        <extensions>true</extensions>
        <configuration>
          <packageType>container</packageType>
          <embeddeds>
            <embedded>
              <groupId>com.example</groupId>
              <artifactId>example-app.core</artifactId>
              <type>jar</type>
              <target>/apps/example-packages/application/install</target>
            </embedded>
          </embeddeds>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
""")
        findings = R.refactor_all_pom(p, self.config)
        text = p.read_text()
        self.assertEqual(text.count("<artifactId>example-app.core</artifactId>"), 1)
        self.assertIn("<artifactId>example-app.bundle3</artifactId>", text)
        self.assertIn("<artifactId>example-app.ui.config</artifactId>", text)
        self.assertEqual(findings, [])   # nothing 3rd-party present on this input

    def test_wrong_package_type_is_corrected_to_container(self):
        p = self._write(f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>example-app.all</artifactId>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.jackrabbit</groupId>
        <artifactId>filevault-package-maven-plugin</artifactId>
        <extensions>true</extensions>
        <configuration>
          <packageType>application</packageType>
          <embeddeds>
            <embedded>
              <groupId>com.example</groupId>
              <artifactId>example-app.core</artifactId>
              <type>jar</type>
              <target>/apps/example-packages/application/install</target>
            </embedded>
          </embeddeds>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
""")
        R.refactor_all_pom(p, self.config)
        text = p.read_text()
        self.assertIn("<packageType>container</packageType>", text)
        self.assertNotIn("<packageType>application</packageType>", text)

    def test_no_bundles_configured_still_adds_ui_config(self):
        p = self._write(f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>example-app.all</artifactId>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.jackrabbit</groupId>
        <artifactId>filevault-package-maven-plugin</artifactId>
        <extensions>true</extensions>
        <configuration>
          <packageType>container</packageType>
          <embeddeds>
            <embedded>
              <groupId>com.example</groupId>
              <artifactId>example-app.ui.apps</artifactId>
              <type>zip</type>
              <target>/apps/example-packages/application/install</target>
            </embedded>
          </embeddeds>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
""")
        config = dict(self.config)
        config["bundles"] = []
        findings = R.refactor_all_pom(p, config)
        text = p.read_text()
        self.assertIn("<artifactId>example-app.ui.config</artifactId>", text)
        self.assertEqual(findings, [])

    def test_de_dup_is_keyed_on_group_and_artifact_not_artifact_alone(self):
        # A 3rd-party embed that happens to share an artifactId with this
        # project's own groupId+bundle-name combo would be a coincidence,
        # not a real dup -- de-dup must key on the FULL (groupId,
        # artifactId) pair. Here the pre-existing embed has a DIFFERENT
        # groupId than config.groupId despite sharing config.bundles[0]'s
        # own artifact suffix, so it must NOT suppress the real
        # example-app:example-app.core add, and must itself surface as a
        # 3rd-party finding.
        p = self._write(f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>example-app.all</artifactId>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.jackrabbit</groupId>
        <artifactId>filevault-package-maven-plugin</artifactId>
        <extensions>true</extensions>
        <configuration>
          <packageType>container</packageType>
          <embeddeds>
            <embedded>
              <groupId>org.other.vendor</groupId>
              <artifactId>example-app.core</artifactId>
              <type>jar</type>
              <target>/apps/example-packages/application/install</target>
            </embedded>
          </embeddeds>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
""")
        findings = R.refactor_all_pom(p, self.config)
        text = p.read_text()
        self.assertEqual(text.count("<artifactId>example-app.core</artifactId>"), 2)
        blocks = text.split("<embedded>")
        self.assertTrue(any("com.example" in b and "example-app.core" in b for b in blocks),
                         f"expected a NEW com.example:example-app.core embed:\n{text}")
        self.assertEqual(len(findings), 1)
        self.assertIn("org.other.vendor", findings[0].detail)


# ---------------------------------------------------------------------------
# Task B5: reactor/parent pom -- uber-jar->SDK, modules, analyser, index
# ---------------------------------------------------------------------------

class RefactorReactorPomOnFixtureTests(unittest.TestCase):
    """The real wknd-legacy reactor `pom.xml` is exactly Task B5's own
    precondition pom: `com.adobe.aem:uber-jar` in `<dependencyManagement>`
    (and ONLY a `<dependencyManagement>` -- no top-level `<dependencies>` at
    all), `<modules>` missing `all`/`ui.config`/`ui.apps.structure`, and (per
    the brief) `has_oak_index=True` because the fixture's own `oak-indexes`
    module has real `/oak:index` content (`oak-indexes/src/main/content/
    jcr_root/_oak_index/`, per `manual-followups.md`). `all/pom.xml` ALREADY
    carries the `aemanalyser-maven-plugin` (with no `<version>` of its own --
    it inherits one from the archetype's root `pluginManagement` in a real
    Cloud Service project), so that side of the refactor must be a no-op on
    this fixture, per the brief's own note."""

    def setUp(self):
        self.proj = _git_init_copy(FIXTURE)
        self.pom = self.proj / "pom.xml"
        self.all_pom = self.proj / "all" / "pom.xml"
        self.config = {"groupId": "com.adobe.aem.guides", "artifactId": "aem-guides-wknd",
                       "appId": "wknd"}

    def tearDown(self):
        shutil.rmtree(self.proj.parent, ignore_errors=True)

    def test_uber_jar_replaced_with_aem_sdk_api_provided(self):
        R.refactor_reactor_pom(self.pom, self.config, has_oak_index=True)
        text = self.pom.read_text()
        self.assertNotIn("uber-jar", text)
        self.assertIn("<artifactId>aem-sdk-api</artifactId>", text)
        start = text.index("<artifactId>aem-sdk-api</artifactId>")
        dep_start = text.rindex("<dependency>", 0, start)
        dep_end = text.index("</dependency>", start)
        block = text[dep_start:dep_end]
        self.assertIn("<groupId>com.adobe.aem</groupId>", block)
        self.assertIn("<version>${aem.sdk.api}</version>", block)
        self.assertIn("<scope>provided</scope>", block)

    def test_aem_sdk_api_property_added_with_template_value(self):
        R.refactor_reactor_pom(self.pom, self.config, has_oak_index=True)
        text = self.pom.read_text()
        self.assertIn(
            "<aem.sdk.api>2026.4.25520.20260417T163942Z-260300</aem.sdk.api>", text)

    def test_required_modules_added_existing_preserved_no_dups(self):
        R.refactor_reactor_pom(self.pom, self.config, has_oak_index=True)
        text = self.pom.read_text()
        modules_block = text[text.index("<modules>"): text.index("</modules>")]
        for name in ("core", "bundle2", "ui.apps", "ui.content", "it.tests",
                     "it.launcher", "dispatcher", "all", "ui.config",
                     "ui.apps.structure"):
            self.assertEqual(modules_block.count(f"<module>{name}</module>"), 1,
                              f"{name} missing or duplicated:\n{modules_block}")

    def test_index_definition_settings_present_because_wknd_has_oak_index(self):
        R.refactor_reactor_pom(self.pom, self.config, has_oak_index=True)
        text = self.pom.read_text()
        self.assertIn("<allowIndexDefinitions>true</allowIndexDefinitions>", text)
        self.assertIn(
            "<immutableRootNodeNames>apps,libs,oak:index</immutableRootNodeNames>", text)
        self.assertIn(
            "<allowComplexFilterRulesInApplicationPackages>true"
            "</allowComplexFilterRulesInApplicationPackages>", text)

    def test_index_definition_settings_absent_when_flag_false(self):
        R.refactor_reactor_pom(self.pom, self.config, has_oak_index=False)
        text = self.pom.read_text()
        self.assertNotIn("allowIndexDefinitions", text)
        self.assertNotIn("immutableRootNodeNames", text)
        self.assertNotIn("allowComplexFilterRulesInApplicationPackages", text)

    def test_all_pom_analyser_is_a_noop_already_present(self):
        before = self.all_pom.read_text()
        R.refactor_reactor_pom(self.pom, self.config, has_oak_index=True)
        after = self.all_pom.read_text()
        self.assertEqual(before, after)

    def test_only_reactor_pom_changes_when_analyser_is_noop(self):
        R.refactor_reactor_pom(self.pom, self.config, has_oak_index=True)
        changed = [l for l in _numstat(self.proj).splitlines() if l.strip()]
        self.assertEqual(len(changed), 1, f"expected exactly one changed file:\n{changed}")
        self.assertIn("pom.xml", changed[0])
        self.assertNotIn("all/pom.xml", changed[0])


class RefactorReactorPomCraftedTests(unittest.TestCase):
    """Crafted reactor-shaped poms pin Task B5's own brief-described
    precondition shape directly (modules core/bundle2/ui.apps/ui.content/
    it.tests/dispatcher -- one module short of the real fixture's 7, which
    also has `it.launcher`; see RefactorReactorPomOnFixtureTests for that
    one) plus the edge cases the real fixture can't: an `aem.sdk.api`/
    `aemanalyser.version` property that's ALREADY present (must not
    duplicate), a `<modules>` that already lists one of the three required
    modules (must not duplicate that one either), an `all/pom.xml` that
    lacks the aemanalyser plugin entirely (the ADD path), and no `all`
    sibling at all (must not error)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.config = {"groupId": "com.example", "artifactId": "example-app", "appId": "example"}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _reactor_xml(self):
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>example-app</artifactId>
  <packaging>pom</packaging>
  <version>1.0-SNAPSHOT</version>

  <modules>
    <module>core</module>
    <module>bundle2</module>
    <module>ui.apps</module>
    <module>ui.content</module>
    <module>it.tests</module>
    <module>dispatcher</module>
  </modules>

  <properties>
    <sling.user>admin</sling.user>
  </properties>

  <build>
    <pluginManagement>
      <plugins>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-compiler-plugin</artifactId>
          <version>3.8.1</version>
        </plugin>
      </plugins>
    </pluginManagement>
  </build>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.adobe.aem</groupId>
        <artifactId>uber-jar</artifactId>
        <version>6.5.0</version>
        <scope>provided</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>
</project>
"""

    def _write_reactor(self, xml=None):
        p = self.tmp / "pom.xml"
        p.write_text(xml if xml is not None else self._reactor_xml())
        return p

    def test_uber_jar_replaced_with_aem_sdk_api_provided(self):
        p = self._write_reactor()
        R.refactor_reactor_pom(p, self.config, has_oak_index=False)
        text = p.read_text()
        self.assertNotIn("uber-jar", text)
        self.assertIn("<artifactId>aem-sdk-api</artifactId>", text)
        start = text.index("<artifactId>aem-sdk-api</artifactId>")
        dep_start = text.rindex("<dependency>", 0, start)
        dep_end = text.index("</dependency>", start)
        block = text[dep_start:dep_end]
        self.assertIn("<groupId>com.adobe.aem</groupId>", block)
        self.assertIn("<version>${aem.sdk.api}</version>", block)
        self.assertIn("<scope>provided</scope>", block)

    def test_aem_sdk_api_property_added(self):
        p = self._write_reactor()
        R.refactor_reactor_pom(p, self.config, has_oak_index=False)
        text = p.read_text()
        self.assertIn(
            "<aem.sdk.api>2026.4.25520.20260417T163942Z-260300</aem.sdk.api>", text)

    def test_aem_sdk_api_property_not_duplicated_if_already_present(self):
        xml = self._reactor_xml().replace(
            "<properties>\n    <sling.user>admin</sling.user>\n  </properties>",
            "<properties>\n    <sling.user>admin</sling.user>\n    "
            "<aem.sdk.api>9.9.9-already-here</aem.sdk.api>\n  </properties>")
        p = self._write_reactor(xml)
        R.refactor_reactor_pom(p, self.config, has_oak_index=False)
        text = p.read_text()
        self.assertEqual(text.count("<aem.sdk.api>"), 1)
        self.assertIn("<aem.sdk.api>9.9.9-already-here</aem.sdk.api>", text)

    def test_required_modules_added_existing_preserved_no_dups(self):
        p = self._write_reactor()
        R.refactor_reactor_pom(p, self.config, has_oak_index=False)
        text = p.read_text()
        modules_block = text[text.index("<modules>"): text.index("</modules>")]
        for name in ("core", "bundle2", "ui.apps", "ui.content", "it.tests",
                     "dispatcher", "all", "ui.config", "ui.apps.structure"):
            self.assertEqual(modules_block.count(f"<module>{name}</module>"), 1,
                              f"{name} not present exactly once:\n{modules_block}")

    def test_required_modules_no_duplicate_when_one_already_present(self):
        xml = self._reactor_xml().replace(
            "<module>dispatcher</module>",
            "<module>dispatcher</module>\n    <module>all</module>")
        p = self._write_reactor(xml)
        R.refactor_reactor_pom(p, self.config, has_oak_index=False)
        text = p.read_text()
        self.assertEqual(text.count("<module>all</module>"), 1)
        self.assertIn("<module>ui.config</module>", text)
        self.assertIn("<module>ui.apps.structure</module>", text)

    def test_index_definition_settings_appear_when_has_oak_index_true(self):
        p = self._write_reactor()
        R.refactor_reactor_pom(p, self.config, has_oak_index=True)
        text = p.read_text()
        self.assertIn("<allowIndexDefinitions>true</allowIndexDefinitions>", text)
        self.assertIn(
            "<immutableRootNodeNames>apps,libs,oak:index</immutableRootNodeNames>", text)
        self.assertIn(
            "<allowComplexFilterRulesInApplicationPackages>true"
            "</allowComplexFilterRulesInApplicationPackages>", text)

    def test_index_definition_settings_absent_when_has_oak_index_false(self):
        p = self._write_reactor()
        R.refactor_reactor_pom(p, self.config, has_oak_index=False)
        text = p.read_text()
        self.assertNotIn("allowIndexDefinitions", text)
        self.assertNotIn("immutableRootNodeNames", text)
        self.assertNotIn("allowComplexFilterRulesInApplicationPackages", text)
        self.assertNotIn("jackrabbit-packagetype", text)

    def test_analyser_added_to_all_pom_when_missing(self):
        p = self._write_reactor()
        all_dir = self.tmp / "all"
        all_dir.mkdir()
        all_pom = all_dir / "pom.xml"
        all_pom.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>com.example</groupId>
    <artifactId>example-app</artifactId>
    <version>1.0-SNAPSHOT</version>
  </parent>
  <artifactId>example-app.all</artifactId>
  <packaging>content-package</packaging>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.jackrabbit</groupId>
        <artifactId>filevault-package-maven-plugin</artifactId>
        <extensions>true</extensions>
      </plugin>
    </plugins>
  </build>
</project>
""")
        R.refactor_reactor_pom(p, self.config, has_oak_index=False)
        all_text = all_pom.read_text()
        self.assertIn("<artifactId>aemanalyser-maven-plugin</artifactId>", all_text)
        start = all_text.index("<artifactId>aemanalyser-maven-plugin</artifactId>")
        plugin_start = all_text.rindex("<plugin>", 0, start)
        plugin_end = all_text.index("</plugin>", start)
        block = all_text[plugin_start:plugin_end]
        self.assertIn("<groupId>com.adobe.aem</groupId>", block)
        # the reactor's own <properties> gained the version property that
        # governs the plugin it just added, since it wasn't there yet
        reactor_text = p.read_text()
        self.assertIn("<aemanalyser.version>1.6.6</aemanalyser.version>", reactor_text)

    def test_analyser_is_noop_when_already_present(self):
        p = self._write_reactor()
        all_dir = self.tmp / "all"
        all_dir.mkdir()
        all_pom = all_dir / "pom.xml"
        original_all_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="{NS}">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>com.example</groupId>
    <artifactId>example-app</artifactId>
    <version>1.0-SNAPSHOT</version>
  </parent>
  <artifactId>example-app.all</artifactId>
  <packaging>content-package</packaging>
  <build>
    <plugins>
      <plugin>
        <groupId>com.adobe.aem</groupId>
        <artifactId>aemanalyser-maven-plugin</artifactId>
        <executions>
          <execution>
            <id>aem-analyser</id>
            <goals>
              <goal>project-analyse</goal>
            </goals>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
"""
        all_pom.write_text(original_all_xml)
        R.refactor_reactor_pom(p, self.config, has_oak_index=False)
        # the all/pom.xml analyser plugin add is still a no-op (already present)
        self.assertEqual(all_pom.read_text(), original_all_xml)
        # ...but `aemanalyser.version` is now ALWAYS seeded on the reactor (idempotent),
        # not only when THIS run adds the plugin: a NESTED ancestor reactor can
        # reference ${aemanalyser.version} without defining it, so the property must
        # exist regardless of whether the sibling all/pom just gained the plugin.
        self.assertIn("aemanalyser.version", p.read_text())

    def test_no_all_pom_sibling_is_not_an_error(self):
        p = self._write_reactor()
        findings = R.refactor_reactor_pom(p, self.config, has_oak_index=False)
        self.assertEqual(findings, [])
        self.assertNotIn("uber-jar", p.read_text())


# ---------------------------------------------------------------------------
# Task B6: main() CLI orchestration + findings merge
# ---------------------------------------------------------------------------

class MainCliOrchestrationTests(unittest.TestCase):
    """`refactor_poms.main` end to end against a REAL Phase-1 output: the
    wknd-legacy fixture run through `inspect_project` -> `scaffold_modules`
    -> `split_content` first, exactly `test_integration_single.py`'s own
    recipe (`I.main` / `SC.main` / `SP.main`) -- so ui.apps/ui.content/
    core/bundle2/all/pom.xml and `.modernize/{config,findings}.json` are all
    genuine Phase-1 artifacts, not hand-built stand-ins.

    Phase-1's own `findings.json` on this fixture already has RM-101
    (`net.engio:mbassador` in `all`) and RM-107 (`/libs` in ui.apps) --
    proving `main`'s merge preserves both is the point of this class, not
    just that it runs without raising. And `split_content` merges the
    fixture's separate `oak-indexes` module's `/oak:index` filter roots
    into ui.apps' OWN filter.xml (verified in setUp below) -- exactly the
    precondition `_ui_apps_has_oak_index` needs to derive `True` on this
    project, so the reactor pom's index-definition-validator settings are
    also exercised here, not just skipped."""

    def setUp(self):
        self.proj = _git_init_copy(FIXTURE)
        self.cfg_path = self.proj / ".modernize" / "config.json"

        self.assertEqual(I.main([str(self.proj)]), 0)
        self.assertEqual(
            SC.main([str(self.proj), "--config", str(self.cfg_path),
                      "--templates", str(TEMPLATES_DIR)]), 0)
        self.assertEqual(
            SP.main([str(self.proj), "--config", str(self.cfg_path), "--git"]), 0)

        apps_filter_text = (self.proj / "ui.apps/src/main/content/META-INF/vault/filter.xml"
                             ).read_text()
        self.assertIn("/oak:index", apps_filter_text,
                       "precondition: ui.apps filter.xml must carry an /oak:index root "
                       "post-split for this class's has_oak_index=True assertions to mean "
                       "anything")

        seed = C.load_json(self.proj / ".modernize" / "findings.json")["findings"]
        self.assertTrue(any(f["code"] == "RM-101" for f in seed),
                         f"fixture precondition: expected a Phase-1 RM-101, got {seed}")
        self.assertTrue(any(f["code"] == "RM-107" for f in seed),
                         f"fixture precondition: expected a Phase-1 RM-107, got {seed}")

    def tearDown(self):
        shutil.rmtree(self.proj.parent, ignore_errors=True)

    def _run_main(self):
        return R.main([str(self.proj), "--config", str(self.cfg_path)])

    def test_main_returns_zero(self):
        self.assertEqual(self._run_main(), 0)

    def test_uber_jar_gone_from_core_and_reactor(self):
        self._run_main()
        self.assertNotIn("uber-jar", (self.proj / "core" / "pom.xml").read_text())
        self.assertNotIn("uber-jar", (self.proj / "pom.xml").read_text())

    def test_aem_sdk_api_present_in_reactor(self):
        self._run_main()
        text = (self.proj / "pom.xml").read_text()
        self.assertIn("<artifactId>aem-sdk-api</artifactId>", text)

    def test_ui_apps_and_ui_content_get_filevault_packagetype_and_extensions_binding(self):
        self._run_main()
        for mod, expected_type in (("ui.apps", "application"), ("ui.content", "content")):
            text = (self.proj / mod / "pom.xml").read_text()
            self.assertIn("<artifactId>filevault-package-maven-plugin</artifactId>", text,
                          f"{mod}: filevault plugin missing")
            self.assertIn(f"<packageType>{expected_type}</packageType>", text,
                          f"{mod}: packageType missing/wrong")

            start = text.index("<artifactId>content-package-maven-plugin</artifactId>")
            end = text.index("</plugin>", start)
            block = text[start:end]
            self.assertIn("<extensions>true</extensions>", block,
                          f"{mod}: legacy plugin must keep its extensions=true binding")
            self.assertNotIn("<filterSource>", block,
                             f"{mod}: legacy plugin's own config should have been stripped")
            self.assertNotIn("<embeddeds>", block,
                             f"{mod}: legacy embed should have been dropped")

    def test_all_pom_embeds_ui_config(self):
        self._run_main()
        text = (self.proj / "all" / "pom.xml").read_text()
        self.assertIn("<artifactId>aem-guides-wknd.ui.config</artifactId>", text)

    def test_reactor_index_definition_settings_present_for_oak_index(self):
        # has_oak_index must have been derived True from ui.apps' own
        # filter.xml (see setUp) -- so the reactor's index-validator
        # settings should actually be there, not skipped.
        self._run_main()
        text = (self.proj / "pom.xml").read_text()
        self.assertIn("allowIndexDefinitions", text)

    def test_findings_json_merges_phase1_and_new_findings_deduped(self):
        self._run_main()
        findings = C.load_json(self.proj / ".modernize" / "findings.json")["findings"]
        codes = [f["code"] for f in findings]

        # Phase-1's own findings survive the merge.
        self.assertIn("RM-101", codes)
        self.assertIn("RM-107", codes)
        # This run's own new Felix->BND finding (both core and bundle2 have
        # the legacy Felix maven-scr-plugin/maven-bundle-plugin pair).
        self.assertIn(R.FELIX_TO_BND_FINDING_CODE, codes)

        # No duplicate (code, priority, detail) triples -- dedup_findings'
        # contract. core and bundle2 both raise the SAME code but each
        # embeds its own pom_path in `detail`, so this is checking for
        # actual duplicates, not merely repeated codes.
        seen = set()
        for f in findings:
            key = (f["code"], f["priority"], f["detail"])
            self.assertNotIn(key, seen, f"duplicate finding entry: {f}")
            seen.add(key)

        # Re-running main() (e.g. a second orchestration pass) must not
        # grow the findings list -- the whole point of merge+dedup.
        self._run_main()
        findings_again = C.load_json(self.proj / ".modernize" / "findings.json")["findings"]
        self.assertEqual(len(findings_again), len(findings),
                         "re-running main() should not duplicate findings")


if __name__ == "__main__":
    unittest.main(verbosity=2)
