# scripts/test_scaffold_modules.py  (integrity section)
import re, tempfile, unittest
from pathlib import Path
import scaffold_modules as S
TPL = Path(__file__).resolve().parent.parent / "assets/archetype-pom-templates"

CONFIG = {"schemaVersion": 1, "projectShape": "SINGLE", "groupId": "com.x", "artifactId": "acme",
          "appId": "acme", "appTitle": "ACME", "version": "1.0.0-SNAPSHOT",
          "targetModules": {"all": "all", "uiApps": "ui.apps", "uiAppsStructure": "ui.apps.structure",
                             "uiConfig": "ui.config", "uiContent": "ui.content"},
          "bundles": [{"path": "core", "artifactIdSuffix": "core", "isTest": False}],
          "testBundles": [], "contentPackages": [], "runModeDecisions": {}}

class TemplateIntegrity(unittest.TestCase):
    def test_expected_packagetypes(self):
        want = {"all": "container", "ui.apps": "application", "ui.content": "content", "ui.config": "container"}
        for mod, pkg in want.items():
            self.assertIn(f"<packageType>{pkg}</packageType>", (TPL / mod / "pom.xml").read_text())

    def test_cloud_manager_target_none(self):
        for mod in ["ui.apps", "ui.content", "ui.config", "ui.apps.structure"]:
            self.assertIn("<cloudManagerTarget>none</cloudManagerTarget>", (TPL / mod / "pom.xml").read_text())

    def test_only_known_placeholders(self):
        allowed = {"{{groupId}}", "{{artifactId}}", "{{appId}}", "{{appTitle}}", "{{version}}"}
        for p in TPL.rglob("pom.xml"):
            found = set(re.findall(r"\{\{[a-zA-Z]+\}\}", p.read_text()))
            self.assertTrue(found <= allowed, f"{p} has unexpected placeholders: {found - allowed}")

    def test_no_ui_frontend_dep_in_ui_apps(self):
        self.assertNotIn("ui.frontend", (TPL / "ui.apps" / "pom.xml").read_text())


class Render(unittest.TestCase):
    def test_render_substitutes_all_placeholders(self):
        out = S.render("<a>{{groupId}}</a><b>{{artifactId}}.ui.apps</b>", CONFIG)
        self.assertEqual(out, "<a>com.x</a><b>acme.ui.apps</b>")

    def test_render_leaves_unknown_placeholders_untouched(self):
        out = S.render("<a>{{groupId}}</a><b>{{notAKnownKey}}</b>", CONFIG)
        self.assertEqual(out, "<a>com.x</a><b>{{notAKnownKey}}</b>")


class Scaffold(unittest.TestCase):
    def test_scaffolded_module_poms_carry_config_version_not_literal_snapshot(self):
        # Contract fix: config["version"] must be applied to every scaffolded module's
        # own <version> and its <parent><version> — otherwise the scaffolded modules
        # keep a hardcoded 1.0.0-SNAPSHOT that won't match the real reactor version.
        cfg = dict(CONFIG, version="9.9.9")
        d = Path(tempfile.mkdtemp())
        S.scaffold(str(d), cfg, str(TPL))
        for mod in ["all", "ui.apps", "ui.apps.structure", "ui.config", "ui.content"]:
            text = (d / mod / "pom.xml").read_text()
            self.assertIn("9.9.9", text, f"{mod}/pom.xml should carry config version 9.9.9")
            self.assertNotIn("1.0.0-SNAPSHOT", text, f"{mod}/pom.xml should not keep the literal default version")
            self.assertNotIn("{{version}}", text, f"{mod}/pom.xml should not leave {{{{version}}}} unsubstituted")

    def test_creates_target_modules_with_substitution(self):
        d = Path(tempfile.mkdtemp())
        S.scaffold(str(d), CONFIG, str(TPL))
        self.assertTrue((d / "ui.apps/pom.xml").exists())
        self.assertIn("<artifactId>acme.ui.apps</artifactId>", (d / "ui.apps/pom.xml").read_text())
        self.assertNotIn("{{", (d / "all/pom.xml").read_text())

    def test_creates_exactly_five_target_modules_not_parent(self):
        d = Path(tempfile.mkdtemp())
        created = S.scaffold(str(d), CONFIG, str(TPL))
        self.assertEqual(
            set(created),
            {"all/pom.xml", "ui.apps/pom.xml", "ui.apps.structure/pom.xml",
             "ui.config/pom.xml", "ui.content/pom.xml"},
        )
        # the archetype's own parent pom.xml (templates_dir root) is NOT instantiated in Phase 1
        self.assertFalse((d / "pom.xml").exists())

    def test_idempotent_does_not_clobber_existing(self):
        d = Path(tempfile.mkdtemp())
        S.scaffold(str(d), CONFIG, str(TPL))
        (d / "ui.apps/pom.xml").write_text("HAND-EDITED")
        second = S.scaffold(str(d), CONFIG, str(TPL))
        self.assertEqual((d / "ui.apps/pom.xml").read_text(), "HAND-EDITED")
        self.assertNotIn("ui.apps/pom.xml", second)  # skipped, not (re)created


if __name__ == "__main__":
    unittest.main(verbosity=2)
