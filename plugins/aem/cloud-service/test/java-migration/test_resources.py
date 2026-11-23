import json
import re
import subprocess
import sys
import unittest

from test_poms import SKILL


class ResourceTests(unittest.TestCase):
    def test_relative_resource_links_resolve(self):
        for document in SKILL.rglob("*.md"):
            for link in re.findall(r"\]\(([^)]+)\)", document.read_text()):
                if "://" not in link:
                    self.assertTrue((document.parent / link.split("#", 1)[0]).is_file(), f"{document}: {link}")

    def test_beta_markers_and_license(self):
        text = (SKILL / "SKILL.md").read_text()
        self.assertIn("license: Apache-2.0", text)
        self.assertIn("metadata:\n  status: beta", text)
        self.assertIn("[BETA]", text)
        self.assertIn("This skill is in beta. Verify all outputs before applying them to production projects.", text)
        self.assertIn("> **Beta Skill**: This skill is in beta and under active development.", text)

    def test_every_script_has_a_non_destructive_cli_or_is_shared(self):
        for script in (SKILL / "scripts").glob("*.py"):
            if script.name == "pom_support.py":
                continue
            result = subprocess.run([sys.executable, str(script), "--help"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("--target", result.stdout)

    def test_target_pins_and_resources_are_explicit(self):
        targets = json.loads((SKILL / "configs" / "targets.json").read_text())
        target = targets["25"]
        self.assertEqual(target["availability"], "evaluation-only")
        self.assertTrue((SKILL / "configs" / target["plugin_config"]).is_file())
        self.assertEqual(target["source_versions"], [8, 11, 17, 21])
        for key in ("rewrite_plugin", "java_artifact", "mockito_artifact"):
            self.assertNotIn("RELEASE", target[key])
            self.assertNotIn("LATEST", target[key])


if __name__ == "__main__":
    unittest.main()
