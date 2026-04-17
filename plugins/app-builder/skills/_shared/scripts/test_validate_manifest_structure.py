import importlib.util
import io
import tempfile
import unittest
from contextlib import nullcontext, redirect_stdout
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("validate_manifest_structure.py")
MODULE_SPEC = importlib.util.spec_from_file_location(
    "validate_manifest_structure", MODULE_PATH
)
validator = importlib.util.module_from_spec(MODULE_SPEC)
assert MODULE_SPEC.loader is not None
MODULE_SPEC.loader.exec_module(validator)


class RaisingYaml:
    @staticmethod
    def safe_load(_text):
        raise ValueError("invalid yaml")


class ValidateManifestStructureTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.root = Path(self.tempdir.name)

    def write_file(self, relative_path, content=""):
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    def run_validate(self, config_path, yaml_override=Ellipsis):
        output = io.StringIO()
        context = (
            patch.object(validator, "yaml", yaml_override)
            if yaml_override is not Ellipsis
            else nullcontext()
        )
        with context:
            with redirect_stdout(output):
                result = validator.validate(config_path)
        return result, output.getvalue()

    def test_validate_accepts_application_runtime_manifest(self):
        config = self.write_file(
            "app.config.yaml",
            "application:\n  runtimeManifest:\n    packages:\n      sample: {}\n",
        )
        result, output = self.run_validate(config)
        self.assertEqual(result, 0)
        self.assertIn("application.runtimeManifest found", output)
        self.assertIn("Result: VALID", output)

    def test_validate_accepts_extensions_with_include(self):
        config = self.write_file(
            "app.config.yaml",
            "extensions:\n  dx/excshell/1:\n    $include: src/dx-excshell-1/ext.config.yaml\n",
        )
        self.write_file(
            "src/dx-excshell-1/ext.config.yaml",
            "runtimeManifest:\n  packages:\n    sample:\n      actions:\n        hello:\n          function: actions/hello/index.js\n",
        )
        self.write_file("src/dx-excshell-1/actions/hello/index.js", "exports.main = () => ({});\n")
        result, output = self.run_validate(config)
        self.assertEqual(result, 0)
        self.assertIn("extensions section found", output)
        self.assertIn("$include resolves", output)
        self.assertIn("Action 'hello' entry point exists", output)

    def test_validate_rejects_root_level_runtime_manifest(self):
        config = self.write_file(
            "app.config.yaml",
            "runtimeManifest:\n  packages:\n    sample: {}\n",
        )
        result, output = self.run_validate(config)
        self.assertEqual(result, 1)
        self.assertIn("Root-level runtimeManifest found", output)
        self.assertIn("Result: INVALID", output)

    def test_validate_rejects_missing_manifest_sections(self):
        config = self.write_file("app.config.yaml", "application:\n  name: sample\n")
        result, output = self.run_validate(config)
        self.assertEqual(result, 1)
        self.assertIn("No application.runtimeManifest and no extensions section found", output)

    def test_validate_rejects_missing_config_file(self):
        config = self.root / "missing-app.config.yaml"
        result, output = self.run_validate(config)
        self.assertEqual(result, 1)
        self.assertIn("does not exist", output)

    def test_validate_rejects_invalid_yaml(self):
        config = self.write_file("app.config.yaml", "application: [\n")
        result, output = self.run_validate(config, yaml_override=RaisingYaml)
        self.assertEqual(result, 1)
        self.assertIn("Cannot parse", output)
        self.assertIn("invalid yaml", output)

    def test_validate_rejects_unresolved_include_path(self):
        config = self.write_file(
            "app.config.yaml",
            "extensions:\n  dx/excshell/1:\n    $include: src/dx-excshell-1/ext.config.yaml\n",
        )
        result, output = self.run_validate(config)
        self.assertEqual(result, 1)
        self.assertIn("$include path does not exist", output)

    def test_fallback_parser_accepts_application_runtime_manifest(self):
        config = self.write_file(
            "app.config.yaml",
            "application:\n  runtimeManifest:\n    packages:\n      sample: {}\n",
        )
        result, output = self.run_validate(config, yaml_override=None)
        self.assertEqual(result, 0)
        self.assertIn("application.runtimeManifest found", output)

    def test_fallback_parser_accepts_extensions_with_include(self):
        config = self.write_file(
            "app.config.yaml",
            "extensions:\n  dx/excshell/1:\n    $include: src/dx-excshell-1/ext.config.yaml\n",
        )
        self.write_file("src/dx-excshell-1/ext.config.yaml", "runtimeManifest:\n  packages: {}\n")
        result, output = self.run_validate(config, yaml_override=None)
        self.assertEqual(result, 0)
        self.assertIn("extensions section found", output)
        self.assertIn("$include resolves", output)

    def test_fallback_parser_rejects_root_level_runtime_manifest(self):
        config = self.write_file(
            "app.config.yaml",
            "runtimeManifest:\n  packages:\n    sample: {}\n",
        )
        result, output = self.run_validate(config, yaml_override=None)
        self.assertEqual(result, 1)
        self.assertIn("Root-level runtimeManifest found", output)

    def test_fallback_parser_rejects_missing_manifest_sections(self):
        config = self.write_file("app.config.yaml", "application:\n  name: sample\n")
        result, output = self.run_validate(config, yaml_override=None)
        self.assertEqual(result, 1)
        self.assertIn("No application.runtimeManifest and no extensions section found", output)


if __name__ == "__main__":
    unittest.main()