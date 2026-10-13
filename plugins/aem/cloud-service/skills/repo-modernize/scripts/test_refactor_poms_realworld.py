"""Regression tests for the refactor_poms fixes that a genuine legacy (AMS/6.5)
project -- unlike the archetype-shaped wknd fixture -- exposes: a commented-out
`ui.content` module, a legacy reactor pluginManagement whose FileVault plugin has
no `extensions=true`, a pre-existing bundle losing its API surface when uber-jar
is dropped, and a stale module parent version.

Deliberately fixture-FREE (no WKND_FIXTURE): each test drives one small helper on
a minimal hand-built pom (with the real Maven namespace, so the helpers' inserted
fragments match) and asserts against the serialized output -- so it runs anywhere
the lxml venv does. End-to-end behaviour on real poms is covered by the
acme-portal pipeline run in the task report; these lock in the individual rules.
"""
import tempfile
import unittest
from pathlib import Path

import pom_engine as E
import refactor_poms as RP

_NS = 'xmlns="http://maven.apache.org/POM/4.0.0"'

_CONFIG = {
    "groupId": "com.example.acme", "artifactId": "acme-portal", "version": "3.2.69-SNAPSHOT",
    "targetModules": {"all": "all", "uiApps": "ui.apps", "uiAppsStructure": "ui.apps.structure",
                       "uiConfig": "ui.config", "uiContent": "ui.content"},
}


def _apply(text, fn):
    """Write `text` to a temp pom, load it, run `fn(root)`, save, return the
    serialized result."""
    p = Path(tempfile.mkdtemp()) / "pom.xml"
    p.write_text(text)
    tree, original = E.load(p)
    fn(tree.getroot())
    E.save(tree, p, original)
    return p.read_text()


class EnsureRequiredModules(unittest.TestCase):
    def test_adds_content_modules_incl_commented_ui_content_without_duplicating(self):
        # ui.apps active; ui.content COMMENTED OUT (exactly the acme-portal shape).
        out = _apply(
            f"<project {_NS}><modules>\n"
            "  <module>core</module>\n"
            "  <module>ui.apps</module>\n"
            "  <!--module>ui.content</module-->\n"
            "</modules></project>\n",
            lambda root: RP._ensure_required_modules(root, _CONFIG))
        for expected in ("<module>all</module>", "<module>ui.apps.structure</module>",
                         "<module>ui.config</module>", "<module>ui.content</module>"):
            self.assertIn(expected, out)
        # ui.apps present exactly once as a LIVE module (not duplicated)
        self.assertEqual(out.count("<module>ui.apps</module>"), 1)
        self.assertEqual(out.count("<module>ui.content</module>"), 1)  # live one, not the comment


class FilevaultExtensionsBinding(unittest.TestCase):
    def test_adds_extensions_true_to_existing_entry_preserving_version(self):
        # legacy reactor: filevault 1.0.3 in pluginManagement, NO extensions=true.
        out = _apply(
            f"<project {_NS}><build><pluginManagement><plugins>\n"
            "  <plugin>\n"
            "    <groupId>org.apache.jackrabbit</groupId>\n"
            "    <artifactId>filevault-package-maven-plugin</artifactId>\n"
            "    <version>1.0.3</version>\n"
            "  </plugin>\n"
            "</plugins></pluginManagement></build></project>\n",
            RP._ensure_filevault_extensions_binding)
        self.assertIn("<extensions>true</extensions>", out)   # binding added
        self.assertIn("<version>1.0.3</version>", out)        # own version preserved
        self.assertEqual(out.count("filevault-package-maven-plugin"), 1)  # not duplicated

    def test_installs_minimal_entry_when_filevault_absent(self):
        out = _apply(
            f"<project {_NS}><build><pluginManagement><plugins>\n"
            "  <plugin><groupId>x</groupId><artifactId>other</artifactId></plugin>\n"
            "</plugins></pluginManagement></build></project>\n",
            RP._ensure_filevault_extensions_binding)
        self.assertIn("filevault-package-maven-plugin", out)
        self.assertIn("<extensions>true</extensions>", out)

    def test_noop_when_no_plugin_management(self):
        out = _apply(f"<project {_NS}><build><plugins/></build></project>\n",
                     RP._ensure_filevault_extensions_binding)  # must not raise
        self.assertNotIn("filevault-package-maven-plugin", out)


class BundleSdkApiDependency(unittest.TestCase):
    def test_adds_bare_aem_sdk_api_and_is_idempotent(self):
        src = (f"<project {_NS}><dependencies>\n"
               "  <dependency><groupId>org.slf4j</groupId>"
               "<artifactId>slf4j-api</artifactId></dependency>\n"
               "</dependencies></project>\n")
        out = _apply(src, lambda root: (RP._ensure_bundle_sdk_api_dependency(root),
                                        RP._ensure_bundle_sdk_api_dependency(root)))  # idempotent
        self.assertIn("<artifactId>aem-sdk-api</artifactId>", out)
        self.assertEqual(out.count("<artifactId>aem-sdk-api</artifactId>"), 1)  # not duplicated

    def test_does_not_duplicate_pre_existing_sdk_api(self):
        out = _apply(
            f"<project {_NS}><dependencies>\n"
            "  <dependency><groupId>com.adobe.aem</groupId><artifactId>aem-sdk-api</artifactId>"
            "<scope>provided</scope></dependency>\n"
            "</dependencies></project>\n",
            RP._ensure_bundle_sdk_api_dependency)
        self.assertEqual(out.count("<artifactId>aem-sdk-api</artifactId>"), 1)


class ModuleVersionMatchesReactor(unittest.TestCase):
    def test_aligns_stale_parent_and_own_version(self):
        out = _apply(
            f"<project {_NS}>\n"
            "  <parent><groupId>com.example.acme</groupId>"
            "<artifactId>acme-portal</artifactId><version>0.0.1</version></parent>\n"
            "  <artifactId>acme-portal.ui.content</artifactId>\n"
            "  <version>0.0.1</version>\n"
            "</project>\n",
            lambda root: RP._ensure_module_version_matches_reactor(root, "3.2.69-SNAPSHOT"))
        self.assertNotIn("<version>0.0.1</version>", out)          # stale version gone
        self.assertEqual(out.count("<version>3.2.69-SNAPSHOT</version>"), 2)  # parent + own

    def test_noop_when_already_aligned_and_no_own_version(self):
        out = _apply(
            f"<project {_NS}>\n"
            "  <parent><groupId>g</groupId><artifactId>a</artifactId>"
            "<version>3.2.69-SNAPSHOT</version></parent>\n"
            "  <artifactId>a.ui.apps</artifactId>\n"
            "</project>\n",
            lambda root: RP._ensure_module_version_matches_reactor(root, "3.2.69-SNAPSHOT"))
        self.assertEqual(out.count("<version>3.2.69-SNAPSHOT</version>"), 1)  # no own <version> fabricated


class RemoveSupersededContentModules(unittest.TestCase):
    # A NESTED/real project whose legacy source content package is a DIFFERENTLY
    # named module (globex.ui.apps) that the split superseded -- must be dropped
    # from the reactor or it collides with the scaffolded ui.apps (same artifactId).
    _NESTED_CFG = {
        "groupId": "com.globex", "artifactId": "globex", "version": "1.0-SNAPSHOT",
        "targetModules": {"all": "all", "uiApps": "ui.apps",
                           "uiAppsStructure": "ui.apps.structure",
                           "uiConfig": "ui.config", "uiContent": "ui.content"},
        "contentPackages": [{"path": "globex.ui.apps",
                              "jcrRoot": "globex.ui.apps/src/main/content/jcr_root",
                              "filterXml": "globex.ui.apps/.../filter.xml"}],
    }

    def test_superseded_source_module_removed_targets_kept(self):
        out = _apply(
            f"<project {_NS}><modules>\n"
            "  <module>globex.core</module>\n"
            "  <module>globex.ui.apps</module>\n"
            "  <module>ui.apps</module>\n"
            "  <module>ui.content</module>\n"
            "</modules></project>\n",
            lambda root: RP._remove_superseded_content_modules(root, self._NESTED_CFG))
        self.assertNotIn("<module>globex.ui.apps</module>", out)  # superseded -> gone
        self.assertIn("<module>ui.apps</module>", out)             # target kept
        self.assertIn("<module>globex.core</module>", out)        # bundle kept

    def test_single_shape_source_equals_target_is_not_removed(self):
        # acme-portal/wknd: source content package name EQUALS the target (ui.apps),
        # so it IS the target and must NOT be removed.
        cfg = dict(self._NESTED_CFG)
        cfg["contentPackages"] = [{"path": "ui.apps",
                                    "jcrRoot": "ui.apps/src/main/content/jcr_root"}]
        out = _apply(
            f"<project {_NS}><modules>\n"
            "  <module>core</module>\n"
            "  <module>ui.apps</module>\n"
            "</modules></project>\n",
            lambda root: RP._remove_superseded_content_modules(root, cfg))
        self.assertIn("<module>ui.apps</module>", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
