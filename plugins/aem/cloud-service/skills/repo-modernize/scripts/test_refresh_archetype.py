"""refresh_archetype.py: the maintainer refresh of the bundled templates."""
import contextlib
import io
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import archetype as A
import archetype_templates as AT
import refresh_archetype as R

SCRIPTS = Path(__file__).resolve().parent
BUNDLED = SCRIPTS.parent / "assets/archetype-pom-templates"
NEW = {"archetype": "59", "aem.sdk.api": "2099.1.1.T1-1", "aemanalyser.version": "9.9.9",
       "filevault": "9.8.7", "content-package": "9.7.6"}


class _TempPins(unittest.TestCase):
    """Copies of the two files holding pins, so the real ones are never touched."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.files = {}
        constants = {}
        for real, names in R._PIN_CONSTANTS.items():
            copy = self.dir / real.name
            shutil.copy(real, copy)
            self.files[real.name] = copy
            constants[copy] = names
        patcher = mock.patch.object(R, "_PIN_CONSTANTS", constants)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(shutil.rmtree, self.dir, True)


class RewritePins(_TempPins):
    def test_each_constant_is_rewritten_once(self):
        changes = R.rewrite_pins(NEW)
        self.assertEqual(len(changes), 7)
        arch = self.files["archetype.py"].read_text()
        self.assertIn('PINNED_ARCHETYPE = "59"', arch)
        self.assertIn('PINNED_SDK_API = "2099.1.1.T1-1"', arch)
        refactor = self.files["refactor_poms.py"].read_text()
        self.assertIn('_ARCHETYPE_FILEVAULT_VERSION = "9.8.7"', refactor)
        self.assertIn('_ARCHETYPE_CONTENT_PACKAGE_VERSION = "9.7.6"', refactor)
        self.assertEqual(R.rewrite_pins(NEW), [])                # idempotent

    def test_a_missing_constant_is_an_error(self):
        f = self.files["archetype.py"]
        f.write_text(f.read_text().replace("PINNED_AEMANALYSER =", "OTHER ="))
        with self.assertRaises(RuntimeError):
            R.rewrite_pins(NEW)


class Update(_TempPins):
    def setUp(self):
        super().setUp()
        self.templates_dir = self.dir / "templates"
        patcher = mock.patch.object(R, "_TEMPLATES", self.templates_dir)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _quiet(self, fn, *a):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return fn(*a)

    def test_writes_templates_and_pins(self):
        templates = {rel: (BUNDLED / rel).read_text() for rel in AT.TEMPLATE_FILES}
        templates["pom.xml"] = templates["pom.xml"].replace(A.PINNED_SDK_API, NEW["aem.sdk.api"])
        with mock.patch.object(AT, "build", return_value=(templates, ("com.adobe.aem", "x", "59"))) as b:
            rc = self._quiet(R.update, "59", NEW["aem.sdk.api"])
        self.assertEqual(rc, 0)
        self.assertEqual(b.call_args.args[0], "59")
        for rel in AT.TEMPLATE_FILES:
            self.assertEqual((self.templates_dir / rel).read_text(), templates[rel])
        arch = self.files["archetype.py"].read_text()
        self.assertIn('PINNED_ARCHETYPE = "59"', arch)
        self.assertIn(f'PINNED_SDK_API = "{NEW["aem.sdk.api"]}"', arch)

    def test_exit_codes(self):
        for error, rc in ((AT.TemplatesDoNotFit("x"), 1), (AT.ArchetypeError("no Maven"), 2)):
            with self.subTest(error=type(error).__name__), \
                 mock.patch.object(AT, "build", side_effect=error):
                self.assertEqual(self._quiet(R.update, "59", "1"), rc)
        self.assertFalse(self.templates_dir.exists())             # nothing written on failure


class Check(unittest.TestCase):
    def _main(self, arch, sdk, argv=()):
        out = io.StringIO()
        with mock.patch.object(A, "resolve_latest_archetype", return_value=arch), \
             mock.patch.object(A, "resolve_latest_sdk_api", return_value=sdk), \
             contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            rc = R.main(list(argv))
        return rc, out.getvalue()

    def test_reports_without_changing_anything(self):
        with mock.patch.object(R, "update") as update:
            rc, out = self._main("99", "2099.1")
        update.assert_not_called()
        self.assertEqual(rc, 0)
        self.assertIn(f"pinned : archetype-{A.PINNED_ARCHETYPE}", out)
        self.assertIn("--update", out)

    def test_offline(self):
        self.assertEqual(self._main(None, None)[0], 2)
        self.assertEqual(self._main(None, None, ["--update"])[0], 2)

    def test_update_resolves_latest(self):
        with mock.patch.object(R, "update", return_value=0) as update:
            rc, _ = self._main("99", "2099.1", ["--update"])
        self.assertEqual(rc, 0)
        update.assert_called_once_with("99", "2099.1")


if __name__ == "__main__":
    unittest.main()
