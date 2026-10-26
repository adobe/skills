"""archetype_templates: an AEM project archetype turned into the module templates, and the
check that a template set fits what the transforms rely on."""
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import archetype as A
import archetype_templates as AT
import refactor_poms as RP

BUNDLED = Path(__file__).resolve().parent.parent / "assets/archetype-pom-templates"


def _bundled() -> dict:
    return {rel: (BUNDLED / rel).read_text(encoding="utf-8") for rel in AT.TEMPLATE_FILES}


def _with_core(text: str, tag: str) -> str:
    """Add a copy of the first <tag> block that names a project module, for the archetype's
    sample `core` bundle -- what the archetype itself has and templatize must drop."""
    for m in AT._BLOCK.finditer(text):
        block = m.group(0)
        if m.group(1) == tag and "zqartifactid." in block:
            core = re.sub(r"<artifactId>zqartifactid\.[^<]+</artifactId>",
                          "<artifactId>zqartifactid.core</artifactId>", block)
            core = re.sub(r"[ \t]*<type>zip</type>[ \t]*\n", "", core)
            return text[:m.start()] + core + text[m.start():]
    raise AssertionError(f"no <{tag}> block to copy")


def _generated_project(templates=None) -> Path:
    """What `generate` leaves on disk: sentinel coordinates instead of placeholders, plus the
    archetype's sample `core` bundle in all / ui.apps / ui.content."""
    root = Path(tempfile.mkdtemp()) / "zqartifactid"
    for rel, text in (templates or _bundled()).items():
        for _prop, sentinel, placeholder in AT._SENTINELS:
            if placeholder:
                text = text.replace(placeholder, sentinel)
        if rel == "all/pom.xml":
            text = _with_core(text, "embedded")
        elif rel in ("ui.apps/pom.xml", "ui.content/pom.xml"):
            text = _with_core(text, "dependency")
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text, encoding="utf-8")
    return root


class Templatize(unittest.TestCase):
    def test_round_trip_gives_the_bundled_templates(self):
        project = _generated_project()
        self.assertIn("zqartifactid.core", (project / "all/pom.xml").read_text())
        self.assertEqual(AT.templatize(project), _bundled())

    def test_a_value_it_cannot_express_is_refused(self):
        project = _generated_project()
        p = project / "ui.config/pom.xml"
        p.write_text(p.read_text().replace("</project>", "<!-- zqpackage.models -->\n</project>"))
        with self.assertRaises(AT.TemplatesDoNotFit) as cm:
            AT.templatize(project)
        self.assertIn("ui.config/pom.xml", str(cm.exception))

    def test_a_missing_module_is_refused(self):
        project = _generated_project()
        (project / "ui.config/pom.xml").unlink()
        with self.assertRaises(AT.TemplatesDoNotFit):
            AT.templatize(project)


class Validate(unittest.TestCase):
    def _problems(self, rel, old, new):
        templates = _bundled()
        self.assertIn(old, templates[rel])
        templates[rel] = templates[rel].replace(old, new, 1)
        return AT.validate(templates)

    def _assert_problem(self, problems, *words):
        self.assertTrue(any(all(w in p for w in words) for p in problems), problems)

    def test_bundled_templates_fit(self):
        self.assertEqual(AT.validate(_bundled()), [])

    def test_uber_jar(self):
        self._assert_problem(self._problems("ui.apps/pom.xml", "<artifactId>aem-sdk-api</artifactId>",
                                            "<artifactId>uber-jar</artifactId>"), "uber-jar")

    def test_wrong_package_type(self):
        self._assert_problem(self._problems("ui.apps/pom.xml", "<packageType>application</packageType>",
                                            "<packageType>mixed</packageType>"), "packageType")

    def test_structure_without_filters(self):
        templates = _bundled()
        rel = "ui.apps.structure/pom.xml"
        templates[rel] = re.sub(r"<filters>.*?</filters>|<filters\s*/>", "", templates[rel], flags=re.S)
        self._assert_problem(AT.validate(templates), "ui.apps.structure", "<filters>")

    def test_missing_embed(self):
        templates = _bundled()
        templates["all/pom.xml"] = AT._BLOCK.sub(
            lambda m: "" if m.group(1) == "embedded" and ".ui.config<" in m.group(0) else m.group(0),
            templates["all/pom.xml"])
        self._assert_problem(AT.validate(templates), "ui.config should be embedded")

    def test_unmanaged_unversioned_plugin(self):
        self._assert_problem(self._problems(
            "ui.config/pom.xml", "<plugins>",
            "<plugins><plugin><artifactId>exotic-maven-plugin</artifactId></plugin>"),
            "exotic-maven-plugin")

    def test_property_repo_modernize_does_not_set(self):
        self._assert_problem(self._problems(
            "ui.config/pom.xml", "<modelVersion>4.0.0</modelVersion>",
            "<modelVersion>4.0.0</modelVersion><url>${exotic.url}</url>"), "${exotic.url}")

    def test_property_only_inside_a_profile_is_fine(self):
        problems = self._problems("all/pom.xml", "<profile>",
                                  "<profile><properties><x>${exotic.url}</x></properties>")
        self.assertEqual(problems, [])

    def test_sample_bundle_left_behind(self):
        self._assert_problem(self._problems("ui.apps/pom.xml", "</project>",
                                            "<!-- {{artifactId}}.core -->\n</project>"), "sample bundle")

    def test_unknown_placeholder(self):
        self._assert_problem(self._problems("ui.content/pom.xml", "</project>",
                                            "<!-- {{packageName}} -->\n</project>"), "placeholder")

    def test_all_filter_without_the_packages_root(self):
        self._assert_problem(self._problems(AT.ALL_FILTER, '<filter root="/apps/{{appId}}-packages"/>', ""),
                             "-packages")

    def test_reactor_without_sdk_pin(self):
        templates = _bundled()
        templates["pom.xml"] = re.sub(r"\s*<aem\.sdk\.api>[^<]*</aem\.sdk\.api>", "", templates["pom.xml"])
        self._assert_problem(AT.validate(templates), "aem.sdk.api")

    def test_not_well_formed(self):
        templates = _bundled()
        templates["ui.config/pom.xml"] = templates["ui.config/pom.xml"][:200]
        self._assert_problem(AT.validate(templates), "ui.config/pom.xml", "well-formed")


class Pins(unittest.TestCase):
    def test_skill_pins_match_the_bundled_reactor(self):
        """refresh_archetype rewrites these from the regenerated reactor; they must agree."""
        p = AT.pins(_bundled()["pom.xml"])
        self.assertEqual(p["aem.sdk.api"], A.PINNED_SDK_API)
        self.assertEqual(p["aem.sdk.api"], RP._AEM_SDK_API_VERSION)
        self.assertEqual(p["aemanalyser.version"], A.PINNED_AEMANALYSER)
        self.assertEqual(p["aemanalyser.version"], RP._AEMANALYSER_VERSION)
        self.assertEqual(p["filevault"], RP._ARCHETYPE_FILEVAULT_VERSION)
        self.assertEqual(p["content-package"], RP._ARCHETYPE_CONTENT_PACKAGE_VERSION)


class ParseSpec(unittest.TestCase):
    def test_forms(self):
        self.assertEqual(AT.parse_spec("58"), ("com.adobe.aem", "aem-project-archetype", "58"))
        self.assertEqual(AT.parse_spec("com.acme:acme-archetype:3.1"),
                         ("com.acme", "acme-archetype", "3.1"))
        self.assertEqual(AT.parse_spec("latest", lambda: "59"),
                         ("com.adobe.aem", "aem-project-archetype", "59"))

    def test_latest_offline(self):
        with self.assertRaises(AT.ArchetypeError) as cm:
            AT.parse_spec("latest", lambda: None)
        self.assertIn("name a version", str(cm.exception))

    def test_rejected(self):
        for bad in ("", "58 -DinteractiveMode=true", "com.acme:archetype", "a:b:c:d", "../x:y:z"):
            with self.subTest(bad=bad), self.assertRaises(AT.ArchetypeError):
                AT.parse_spec(bad)


def _fake_maven(source=None, fail_offline=False, rc=0, output=""):
    """A stand-in for subprocess.run(mvn ...): records each command line and leaves `source`
    (a generated project) where Maven would."""
    calls = []

    def run(argv, cwd=None, **_kw):
        calls.append((argv, cwd))
        if fail_offline and "-o" in argv:
            return subprocess.CompletedProcess(argv, 1, "[ERROR] not in the local repository", "")
        if rc == 0:
            target = Path(cwd) / "zqartifactid"
            if source is not None:
                shutil.copytree(source, target)
            else:
                target.mkdir()
                (target / "pom.xml").write_text("<project/>")
        return subprocess.CompletedProcess(argv, rc, output, "")
    return run, calls


class Generate(unittest.TestCase):
    def test_command_line(self):
        run, calls = _fake_maven()
        work = tempfile.mkdtemp()
        out = AT.generate(("g", "a", "1"), work, "2026.1.1", offline=True, mvn="/opt/mvn", run=run)
        argv, cwd = calls[0]
        self.assertEqual((out, cwd), (Path(work) / "zqartifactid", work))
        self.assertEqual(argv[:4], ["/opt/mvn", "-B", "-q", "-o"])
        for arg in (f"{AT.ARCHETYPE_PLUGIN}:generate", "-DarchetypeGroupId=g",
                    "-DarchetypeArtifactId=a", "-DarchetypeVersion=1", "-DsdkVersion=2026.1.1",
                    "-DaemVersion=cloud", "-DfrontendModule=none", "-DappId=zqappid"):
            self.assertIn(arg, argv)

    def test_failure_shows_mavens_last_lines(self):
        run, _ = _fake_maven(rc=1, output="[ERROR] The desired archetype does not exist (g:a:1)\n")
        with self.assertRaises(AT.ArchetypeError) as cm:
            AT.generate(("g", "a", "1"), tempfile.mkdtemp(), "1", mvn="mvn", run=run)
        self.assertIn("does not exist", str(cm.exception))
        self.assertIn("mvn exit 1", str(cm.exception))

    def test_needs_maven(self):
        with mock.patch.object(AT.shutil, "which", return_value=None), \
             self.assertRaises(AT.ArchetypeError) as cm:
            AT.generate(("g", "a", "1"), tempfile.mkdtemp(), "1")
        self.assertIn("Maven", str(cm.exception))

    def test_odd_sdk_version_refused(self):
        with self.assertRaises(AT.ArchetypeError):
            AT.generate(("g", "a", "1"), tempfile.mkdtemp(), "1 & calc", mvn="mvn", run=None)


class Build(unittest.TestCase):
    def test_local_repository_first_then_network(self):
        run, calls = _fake_maven(_generated_project(), fail_offline=True)
        templates, coords = AT.build("58", tempfile.mkdtemp(), A.PINNED_SDK_API, mvn="mvn", run=run)
        self.assertEqual([("-o" in argv) for argv, _ in calls], [True, False])
        self.assertEqual(coords, ("com.adobe.aem", "aem-project-archetype", "58"))
        self.assertEqual(templates, _bundled())

    def test_a_project_that_is_not_an_aem_archetype_is_refused(self):
        source = _generated_project()
        shutil.rmtree(source / "all")
        run, _ = _fake_maven(source)
        with self.assertRaises(AT.TemplatesDoNotFit) as cm:
            AT.build("org.example:quickstart:1", tempfile.mkdtemp(), "1", mvn="mvn", run=run)
        self.assertIn("org.example:quickstart:1", str(cm.exception))
        self.assertIn("all/pom.xml", str(cm.exception))

    def test_maven_boilerplate_is_left_out_of_the_error(self):
        out = ("[ERROR] Failed to execute goal x: The desired archetype does not exist (g:a:1) -> [Help 1]\n"
               "[ERROR] \n[ERROR] To see the full stack trace of the errors, re-run Maven with the -e switch.\n"
               "[ERROR] Re-run Maven using the -X switch to enable full debug logging.\n"
               "[ERROR] [Help 1] http://cwiki.apache.org/confluence/display/MAVEN/MojoFailureException\n")
        run, _ = _fake_maven(rc=1, output=out)
        with self.assertRaises(AT.ArchetypeError) as cm:
            AT.generate(("g", "a", "1"), tempfile.mkdtemp(), "1", mvn="mvn", run=run)
        message = str(cm.exception)
        self.assertIn("does not exist (g:a:1)", message)
        for noise in ("[Help 1]", "full stack trace", "Re-run Maven", "cwiki"):
            self.assertNotIn(noise, message)

    def test_templates_that_dont_fit_are_refused(self):
        source = _generated_project()
        p = source / "ui.apps/pom.xml"
        p.write_text(p.read_text().replace("<packageType>application</packageType>",
                                           "<packageType>mixed</packageType>"))
        run, _ = _fake_maven(source)
        with self.assertRaises(AT.TemplatesDoNotFit) as cm:
            AT.build("com.acme:acme-archetype:3", tempfile.mkdtemp(), "1", mvn="mvn", run=run)
        self.assertIn("com.acme:acme-archetype:3", str(cm.exception))
        self.assertIn("packageType", str(cm.exception))


@unittest.skipUnless(shutil.which("mvn"), "Maven is not on the PATH")
class BundledTemplatesAreReproducible(unittest.TestCase):
    """The bundled templates are exactly what the refresh produces for the pinned archetype
    and SDK, so a refresh only ever changes what the archetype changed."""

    def test_regenerating_the_pinned_archetype_gives_the_bundled_templates(self):
        work = tempfile.mkdtemp()
        try:
            coords = AT.parse_spec(A.PINNED_ARCHETYPE)
            try:
                project = AT.generate(coords, work, A.PINNED_SDK_API, offline=True)
            except AT.ArchetypeError:
                try:
                    project = AT.generate(coords, work, A.PINNED_SDK_API)
                except AT.ArchetypeError as e:
                    self.skipTest(f"cannot generate the archetype here: {e}")
            self.assertEqual(AT.templatize(project), _bundled())
        finally:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
