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

FIXTURE = Path(__file__).resolve().parents[3] / "test/repo-modernize/fixtures/archetype-templates"


def _fixture() -> dict:
    """The templates of archetype TESTED_ARCHETYPE (the test fixture)."""
    return {rel: (FIXTURE / rel).read_text(encoding="utf-8") for rel in AT.TEMPLATE_FILES}


FIXTURE_SDK = AT.pins(_fixture()["pom.xml"])["aem.sdk.api"]


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
    for rel, text in (templates or _fixture()).items():
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
    def test_round_trip_gives_the_fixture_templates(self):
        project = _generated_project()
        self.assertIn("zqartifactid.core", (project / "all/pom.xml").read_text())
        self.assertEqual(AT.templatize(project), _fixture())

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
        templates = _fixture()
        self.assertIn(old, templates[rel])
        templates[rel] = templates[rel].replace(old, new, 1)
        return AT.validate(templates)

    def _assert_problem(self, problems, *words):
        self.assertTrue(any(all(w in p for w in words) for p in problems), problems)

    def test_fixture_templates_fit(self):
        self.assertEqual(AT.validate(_fixture()), [])

    def test_uber_jar(self):
        self._assert_problem(self._problems("ui.apps/pom.xml", "<artifactId>aem-sdk-api</artifactId>",
                                            "<artifactId>uber-jar</artifactId>"), "uber-jar")

    def test_wrong_package_type(self):
        self._assert_problem(self._problems("ui.apps/pom.xml", "<packageType>application</packageType>",
                                            "<packageType>mixed</packageType>"), "packageType")

    def test_structure_without_filters(self):
        templates = _fixture()
        rel = "ui.apps.structure/pom.xml"
        templates[rel] = re.sub(r"<filters>.*?</filters>|<filters\s*/>", "", templates[rel], flags=re.S)
        self._assert_problem(AT.validate(templates), "ui.apps.structure", "<filters>")

    def test_missing_embed(self):
        templates = _fixture()
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

    def test_reference_to_a_module_the_skill_does_not_create(self):
        self._assert_problem(self._problems("ui.apps/pom.xml", "</project>",
                                            "<!-- {{artifactId}}.core -->\n</project>"),
                             "doesn't create", "{{artifactId}}.core")

    def test_parent_must_be_the_project_reactor(self):
        self._assert_problem(self._problems("ui.config/pom.xml", "<artifactId>{{artifactId}}</artifactId>",
                                            "<artifactId>acme</artifactId>"), "<parent>")

    def test_module_artifact_id(self):
        self._assert_problem(self._problems("ui.config/pom.xml", "<artifactId>{{artifactId}}.ui.config</artifactId>",
                                            "<artifactId>acme.ui.config</artifactId>"),
                             "ui.config/pom.xml", "{{artifactId}}.ui.config")

    def test_dependency_without_a_version(self):
        self._assert_problem(self._problems(
            "all/pom.xml", "</dependencies>",
            "<dependency><groupId>com.adobe.cq</groupId><artifactId>x.ui.apps</artifactId>"
            "<type>zip</type></dependency></dependencies>"), "com.adobe.cq:x.ui.apps", "no version")

    def test_unknown_placeholder(self):
        self._assert_problem(self._problems("ui.content/pom.xml", "</project>",
                                            "<!-- {{packageName}} -->\n</project>"), "placeholder")

    def test_all_filter_without_the_packages_root(self):
        self._assert_problem(self._problems(AT.ALL_FILTER, '<filter root="/apps/{{appId}}-packages"/>', ""),
                             "-packages")

    def test_reactor_without_sdk_pin(self):
        templates = _fixture()
        templates["pom.xml"] = re.sub(r"\s*<aem\.sdk\.api>[^<]*</aem\.sdk\.api>", "", templates["pom.xml"])
        self._assert_problem(AT.validate(templates), "aem.sdk.api")

    def test_not_well_formed(self):
        templates = _fixture()
        templates["ui.config/pom.xml"] = templates["ui.config/pom.xml"][:200]
        self._assert_problem(AT.validate(templates), "ui.config/pom.xml", "well-formed")


class Pins(unittest.TestCase):
    def test_refactor_poms_defaults_match_the_tested_archetype(self):
        """A run takes these from the prepared templates; the defaults (direct calls in the
        tests) are the tested archetype's, so both paths write the same versions."""
        p = AT.pins(_fixture()["pom.xml"])
        self.assertEqual(p["aem.sdk.api"], RP._AEM_SDK_API_VERSION)
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
        self.assertIn("Name a version", str(cm.exception))

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
        templates, coords = AT.build("58", tempfile.mkdtemp(), FIXTURE_SDK, mvn="mvn", run=run)
        self.assertEqual([("-o" in argv) for argv, _ in calls], [True, False])
        self.assertEqual(coords, ("com.adobe.aem", "aem-project-archetype", "58"))
        self.assertEqual(templates, _fixture())

    def test_a_project_that_is_not_an_aem_archetype_is_refused(self):
        source = _generated_project()
        shutil.rmtree(source / "all")
        run, _ = _fake_maven(source)
        work = tempfile.mkdtemp()
        with self.assertRaises(AT.TemplatesDoNotFit) as cm:
            AT.build("org.example:quickstart:1", work, "1", mvn="mvn", run=run)
        self.assertIn("org.example:quickstart:1", str(cm.exception))
        self.assertIn("the generated project has no all/pom.xml", str(cm.exception))
        self.assertNotIn(work, str(cm.exception))

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


from xml.sax.saxutils import escape as _xml_escape


def _customer_project(values, extra_module_refs=True, properties=True) -> Path:
    """A project a customer generated from the archetype: the fixture rendered with their
    coordinates, plus a `core` module and the references the archetype adds to it."""
    root = Path(tempfile.mkdtemp()) / values["artifactId"]
    for rel, text in _fixture().items():
        for key in AT.PLACEHOLDERS:
            value = values[key]
            text = text.replace("{{" + key + "}}", _xml_escape(value) if key == "appTitle" else value)
        if extra_module_refs and rel in ("ui.apps/pom.xml", "ui.content/pom.xml"):
            text = text.replace("<dependencies>", "<dependencies>\n        <dependency>\n"
                                f"            <groupId>{values['groupId']}</groupId>\n"
                                f"            <artifactId>{values['artifactId']}.core</artifactId>\n"
                                "            <version>${project.version}</version>\n"
                                "        </dependency>", 1)
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text, encoding="utf-8")
    (root / "core").mkdir()
    (root / "core/pom.xml").write_text(
        '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>'
        f'<parent><groupId>{values["groupId"]}</groupId><artifactId>{values["artifactId"]}</artifactId>'
        f'<version>{values["version"]}</version></parent><artifactId>{values["artifactId"]}.core</artifactId>'
        '</project>')
    if properties:
        (root / "archetype.properties").write_text(
            "# Parameters used to generate this project with aem-project-archetype\n"
            + "".join(f"{k}={v}\n" for k, v in values.items()) + "aemVersion=cloud\n")
    return root


_VALUE_SETS = (
    {"groupId": "com.acme.portal", "artifactId": "acme-portal", "version": "2.3.0",
     "appId": "acme", "appTitle": "Acme Portal"},
    {"groupId": "com.adobe.aem.guides", "artifactId": "wknd", "version": "1.0.0-SNAPSHOT",
     "appId": "wknd", "appTitle": "wknd"},
    {"groupId": "org.example", "artifactId": "site", "version": "1.0", "appId": "site",
     "appTitle": "Sites & More"},
)


class TemplatizeProject(unittest.TestCase):
    """--archetype <path> to a project the customer generated: no Maven, same templates."""

    def test_gives_the_same_templates_as_the_archetype(self):
        for values in _VALUE_SETS:
            with self.subTest(values=values):
                templates, kind = AT.from_path(_customer_project(values))
                self.assertEqual(kind, "project generated from an archetype")
                self.assertEqual(templates, _fixture())

    def test_without_archetype_properties_the_values_are_inferred(self):
        values = _VALUE_SETS[0]
        root = _customer_project(values, properties=False)
        reactor = root / "pom.xml"
        reactor.write_text(reactor.read_text().replace(f"<name>{values['appTitle']}</name>",
                                                       f"<name>{values['appTitle']}</name>", 1))
        self.assertEqual(AT.project_values(root), values)
        self.assertEqual(AT.from_path(root)[0], _fixture())

    def test_a_templates_folder_is_used_as_it_is(self):
        templates, kind = AT.from_path(FIXTURE)
        self.assertEqual((templates, kind), (_fixture(), "templates folder"))

    def test_not_a_cloud_project(self):
        root = _customer_project(_VALUE_SETS[0])
        p = root / "ui.apps/pom.xml"
        p.write_text(p.read_text().replace("<artifactId>aem-sdk-api</artifactId>",
                                           "<artifactId>uber-jar</artifactId>"))
        with self.assertRaises(AT.TemplatesDoNotFit) as cm:
            AT.from_path(root)
        self.assertIn("uber-jar", str(cm.exception))

    def test_folder_without_a_pom(self):
        with self.assertRaises(AT.TemplatesDoNotFit) as cm:
            AT.from_path(tempfile.mkdtemp())
        self.assertIn("no pom.xml", str(cm.exception))

    def test_managed_versions_are_inlined(self):
        """A dependency the archetype's reactor manages (e.g. its example content) gets that
        version: the project's own reactor doesn't manage it."""
        root = _customer_project(_VALUE_SETS[0], extra_module_refs=False)
        all_pom = root / "all/pom.xml"
        all_pom.write_text(all_pom.read_text().replace(
            "</dependencies>", "    <dependency>\n            <groupId>com.adobe.cq</groupId>\n"
            "            <artifactId>core.wcm.components.examples.ui.apps</artifactId>\n"
            "            <type>zip</type>\n        </dependency>\n    </dependencies>", 1))
        reactor = root / "pom.xml"
        reactor.write_text(re.sub(
            r"(<dependencyManagement>\s*<dependencies>)",
            lambda m: m.group(1) + "\n      <dependency><groupId>com.adobe.cq</groupId>"
            "<artifactId>core.wcm.components.examples.ui.apps</artifactId>"
            "<version>${core.wcm.components.version}</version><type>zip</type></dependency>",
            reactor.read_text(), count=1))
        templates, _ = AT.from_path(root)
        self.assertRegex(templates["all/pom.xml"],
                         r"core\.wcm\.components\.examples\.ui\.apps</artifactId>\n\s*<version>2\.28\.0</version>")


class Sources(unittest.TestCase):
    def test_as_path(self):
        self.assertIsNone(AT.as_path("latest"))
        self.assertIsNone(AT.as_path("58"))
        self.assertIsNone(AT.as_path("com.acme:archetype:3"))
        for spec in ("./project", "../x", "~/ref", "/abs/path", "C:\\work\\ref"):
            self.assertIsNotNone(AT.as_path(spec), spec)

    def test_with_sdk(self):
        templates = AT.with_sdk(_fixture(), "2099.1.1")
        self.assertEqual(AT.pins(templates["pom.xml"])["aem.sdk.api"], "2099.1.1")
        self.assertEqual({k: v for k, v in templates.items() if k != "pom.xml"},
                         {k: v for k, v in _fixture().items() if k != "pom.xml"})

    def test_resolve_sdk(self):
        self.assertEqual(AT.resolve_sdk("2099.1.1"), ("2099.1.1", ""))
        with mock.patch.object(A, "resolve_latest_sdk_api", return_value="2099.2.2"):
            self.assertEqual(AT.resolve_sdk("latest"), ("2099.2.2", ""))
        with mock.patch.object(A, "resolve_latest_sdk_api", return_value=None):
            with self.assertRaises(AT.ArchetypeError) as cm:
                AT.resolve_sdk("latest")
            self.assertIn("--sdk-version", str(cm.exception))
            version, note = AT.resolve_sdk("latest", "2099.3.3", "the one before")
            self.assertEqual(version, "2099.3.3")
            self.assertIn("can't be found", note)
            self.assertIn("the one before", note)
        with mock.patch.object(A, "resolve_latest_sdk_api", return_value="1 & calc"), \
             self.assertRaises(AT.ArchetypeError):
            AT.resolve_sdk("latest")                  # an odd value from the network is not used
        with self.assertRaises(AT.ArchetypeError):
            AT.resolve_sdk("1 & calc")

    def test_set_sdk(self):
        templates, note = AT.set_sdk(_fixture(), "2099.1.1")
        self.assertEqual((AT.pins(templates["pom.xml"])["aem.sdk.api"], note), ("2099.1.1", ""))
        with mock.patch.object(A, "resolve_latest_sdk_api", return_value=None):
            templates, note = AT.set_sdk(_fixture(), "latest")
        self.assertEqual(templates, _fixture())                 # offline: keeps its own
        self.assertIn("already use", note)

    def test_tested_sdk_is_the_fixtures(self):
        self.assertEqual(A.TESTED_SDK, FIXTURE_SDK)


def _versioned_maven(fitting: set):
    """Fake Maven: generates the fixture project with the requested AEM SDK (as the archetype
    does), broken (no all/) for versions not in `fitting`."""
    calls = []

    def run(argv, cwd=None, **_kw):
        calls.append(argv)
        version = next(a.split("=", 1)[1] for a in argv if a.startswith("-DarchetypeVersion="))
        sdk = next(a.split("=", 1)[1] for a in argv if a.startswith("-DsdkVersion="))
        source = _generated_project(AT.with_sdk(_fixture(), sdk))
        if version not in fitting:
            shutil.rmtree(source / "all")
        shutil.copytree(source, Path(cwd) / "zqartifactid")
        return subprocess.CompletedProcess(argv, 0, "", "")
    return run, calls


class Prepare(unittest.TestCase):
    def test_latest_from_maven_central(self):
        run, calls = _versioned_maven({"58"})
        with mock.patch.object(A, "latest", return_value=("58", "Maven Central")), \
             mock.patch.object(A, "resolve_latest_sdk_api", return_value=FIXTURE_SDK):
            templates, info = AT.prepare(mvn="mvn", run=run)
        self.assertEqual(templates, _fixture())
        self.assertEqual(info, {"archetype": "com.adobe.aem:aem-project-archetype:58",
                                "source": "latest, from Maven Central", "aemSdkApi": FIXTURE_SDK})
        self.assertIn(f"-DsdkVersion={FIXTURE_SDK}", calls[0])

    def test_latest_that_does_not_fit_falls_back_to_the_tested_version(self):
        run, calls = _versioned_maven({A.TESTED_ARCHETYPE})
        with mock.patch.object(A, "latest", return_value=("99", "Maven Central")), \
             mock.patch.object(A, "resolve_latest_sdk_api", return_value=FIXTURE_SDK):
            templates, info = AT.prepare("latest", mvn="mvn", run=run)
        self.assertEqual(templates, _fixture())
        self.assertEqual(info["archetype"], f"com.adobe.aem:aem-project-archetype:{A.TESTED_ARCHETYPE}")
        self.assertIn("archetype 99 doesn't fit", info["note"])

    def test_a_named_version_that_does_not_fit_is_refused(self):
        run, _ = _versioned_maven({A.TESTED_ARCHETYPE})
        with mock.patch.object(A, "resolve_latest_sdk_api", return_value=FIXTURE_SDK), \
             self.assertRaises(AT.TemplatesDoNotFit):
            AT.prepare("99", mvn="mvn", run=run)

    def test_latest_unknown(self):
        with mock.patch.object(A, "latest", return_value=(None, "")), \
             self.assertRaises(AT.ArchetypeError) as cm:
            AT.prepare("latest", mvn="mvn", run=None)
        self.assertIn("--archetype 58", str(cm.exception))

    def test_path_keeps_its_sdk_unless_one_is_given(self):
        root = _customer_project(_VALUE_SETS[0])
        _, info = AT.prepare(str(root))
        self.assertEqual((info["source"], info["aemSdkApi"]),
                         ("project generated from an archetype", FIXTURE_SDK))
        templates, info = AT.prepare(str(root), "2099.3.3")
        self.assertEqual(AT.pins(templates["pom.xml"])["aem.sdk.api"], "2099.3.3")
        with mock.patch.object(A, "resolve_latest_sdk_api", return_value=None):
            _, info = AT.prepare(str(root), "latest")
        self.assertEqual(info["aemSdkApi"], FIXTURE_SDK)          # offline: keeps its own
        self.assertIn("already use", info["sdkNote"])

    def test_offline_without_a_cached_sdk(self):
        """The plan never downloads aem-sdk-api, so offline the local Maven repository can
        hold the archetype but no SDK: the previous plan's version is used, else the tested
        one, and the plan says so."""
        run, calls = _versioned_maven({"58"})
        with mock.patch.object(A, "latest", return_value=("58", "local Maven repository")), \
             mock.patch.object(A, "resolve_latest_sdk_api", return_value=None):
            _, info = AT.prepare(mvn="mvn", run=run)
            self.assertEqual(info["aemSdkApi"], A.TESTED_SDK)
            self.assertIn(f"-DsdkVersion={A.TESTED_SDK}", calls[-1])
            self.assertIn("tested with", info["sdkNote"])
            _, info = AT.prepare(mvn="mvn", run=run, fallback_sdk="2099.4.4")
            self.assertEqual(info["aemSdkApi"], "2099.4.4")
            self.assertIn("previous plan", info["sdkNote"])
            _, info = AT.prepare(mvn="mvn", run=run, fallback_sdk="1 & calc")
            self.assertEqual(info["aemSdkApi"], A.TESTED_SDK)    # an odd record is ignored
        self.assertNotIn("sdkNote", AT.prepare(str(FIXTURE))[1])


class Cli(unittest.TestCase):
    def test_writes_the_templates(self):
        out = Path(tempfile.mkdtemp()) / "t"
        with mock.patch("sys.stdout"):
            rc = AT.main([str(FIXTURE), "--out", str(out)])
        self.assertEqual(rc, 0)
        self.assertEqual(AT.load_dir(out), _fixture())

    def test_exit_codes(self):
        with mock.patch("sys.stderr"):
            self.assertEqual(AT.main([tempfile.mkdtemp() + "/"]), 1)
            self.assertEqual(AT.main(["not a spec"]), 2)


@unittest.skipUnless(shutil.which("mvn"), "Maven is not on the PATH")
class RealArchetype(unittest.TestCase):
    """With Maven: the fixture is exactly what the tested archetype version generates, and
    a project generated from it with real coordinates gives the same templates."""

    def _generate(self, workdir, *args):
        coords = AT.parse_spec(A.TESTED_ARCHETYPE)
        argv = ["mvn", "-B", "-q", "-o", f"{AT.ARCHETYPE_PLUGIN}:generate",
                f"-DarchetypeGroupId={coords[0]}", f"-DarchetypeArtifactId={coords[1]}",
                f"-DarchetypeVersion={coords[2]}", f"-DsdkVersion={FIXTURE_SDK}", *args]
        for offline in (True, False):
            proc = subprocess.run(argv if offline else [a for a in argv if a != "-o"],
                                  cwd=workdir, capture_output=True, text=True, timeout=900)
            if proc.returncode == 0:
                return
        self.skipTest(f"cannot generate archetype {coords[2]} here")

    def test_fixture_is_what_the_tested_archetype_generates(self):
        work = tempfile.mkdtemp()
        try:
            try:
                templates = AT.build_from(AT.parse_spec(A.TESTED_ARCHETYPE), work, FIXTURE_SDK)
            except AT.ArchetypeError as e:
                self.skipTest(f"cannot generate the archetype here: {e}")
            self.assertEqual(templates, _fixture())
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def test_a_generated_customer_project_gives_the_same_templates(self):
        work = tempfile.mkdtemp()
        try:
            self._generate(work, "-DappTitle=WKND Sites", "-DappId=wknd", "-DgroupId=com.example.wknd",
                           "-DartifactId=wknd", "-Dversion=1.0.0-SNAPSHOT", "-Dpackage=com.example.wknd",
                           "-DaemVersion=cloud", "-DfrontendModule=general", "-DincludeDispatcherConfig=y",
                           "-DincludeExamples=n")
            templates, kind = AT.from_path(Path(work) / "wknd")
            self.assertEqual({k: v for k, v in templates.items() if k != "pom.xml"},
                             {k: v for k, v in _fixture().items() if k != "pom.xml"})
            self.assertEqual(AT.pins(templates["pom.xml"]), AT.pins(_fixture()["pom.xml"]))
        finally:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
