import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SKILL = HERE.parents[1] / "skills" / "java-migration"
sys.path.insert(0, str(SKILL / "scripts"))

import migrate_dependency_versions
import migrate_filevault
import migrate_plugins
import pom_support
from pom_support import MigrationError, Pom, compiler_nodes, reactor, source_version, write_changes


class PomTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name) / "project"
        shutil.copytree(HERE / "fixtures" / "reactor", self.project)

    def apply(self):
        poms = reactor(self.project)
        migrate_plugins.plan(poms, 25)
        migrate_dependency_versions.plan(poms, 25)
        migrate_filevault.plan(poms, 25)
        return write_changes(poms)

    def content(self):
        return {str(path.relative_to(self.project)): path.read_bytes()
                for path in self.project.rglob("pom.xml")}

    def test_compiler_settings_across_modules_and_profiles(self):
        self.assertEqual(source_version(reactor(self.project)), 8)
        self.assertEqual(len(self.apply()), 2)
        poms = reactor(self.project)
        self.assertEqual(source_version(poms), 25)
        for pom in poms.values():
            for node in compiler_nodes(pom):
                self.assertEqual(node.data.strip(), "25")

    def test_scoped_plugins_and_shared_property_preservation(self):
        self.apply()
        pom = Pom(self.project / "pom.xml")
        compiler = next(node for node in pom.root.walk("plugin") if node.value("artifactId") == "maven-compiler-plugin")
        self.assertEqual(compiler.value("version"), "3.15.0")
        self.assertEqual(next(compiler.walk("dependency")).value("version"), "1.2.3")
        self.assertEqual(pom.root.child("properties").value("compiler.plugin"), "3.8.1")
        untouched = next(node for node in pom.root.walk("plugin") if node.value("artifactId") == "unrelated-plugin")
        self.assertEqual(untouched.value("version"), "2.3")
        self.assertEqual(untouched.child("configuration").value("source"), "leave me")
        dep = next(node for node in pom.root.walk("dependency") if node.value("artifactId") == "untouched")
        self.assertEqual(dep.value("version"), "${asm.version}")
        self.assertEqual(dep.value("classifier"), "jdk11")
        self.assertEqual(pom.root.child("properties").value("asm.version"), "9.2")
        asm = next(node for node in pom.root.walk("dependency") if node.value("artifactId") == "asm")
        self.assertEqual(asm.value("version"), "9.8")

    def test_cdata_comments_escaping_append_and_filevault_preserved(self):
        before = (self.project / "pom.xml").read_text()
        self.apply()
        after = (self.project / "pom.xml").read_text()
        for value in ('<![CDATA[@{argLine} -Dmessage="a & b" -javaagent:custom.jar]]>',
                      '<systemPropertyVariables combine.children="append"><message>a &amp; b</message>',
                      '<argLine combine.children="append">-Dhello=world</argLine>',
                      '<javaVersion>custom metadata</javaVersion>',
                      '<failOnDependencyErrors>true</failOnDependencyErrors>',
                      '<!-- This is a deterministic XML fixture, not an accepted AEM integration project. -->'):
            self.assertIn(value, before)
            self.assertIn(value, after)
        filevault = next(node for node in Pom(self.project / "pom.xml").root.walk("plugin")
                         if node.value("artifactId") == "filevault-package-maven-plugin")
        self.assertEqual(filevault.value("version"), "1.4.0")
        ET.fromstring(after)

    def test_classifiers_scoped_and_repeat_run_byte_identical(self):
        self.apply()
        child = Pom(self.project / "core" / "pom.xml")
        dep = next(child.root.walk("dependency"))
        self.assertIsNone(dep.child("classifier"))
        first = self.content()
        self.assertEqual(self.apply(), [])
        self.assertEqual(first, self.content())

    def test_higher_versions_not_downgraded(self):
        path = self.project / "pom.xml"
        path.write_text(path.read_text().replace("<version>3.1.2</version>", "<version>3.99.0</version>"))
        self.apply()
        self.assertIn("<version>3.99.0</version>", path.read_text())

    def test_inherited_higher_plugin_version_not_overridden(self):
        parent = self.project / "pom.xml"
        parent.write_text(parent.read_text().replace("${compiler.plugin}", "3.99.0"))
        self.apply()
        compiler = next(node for node in Pom(self.project / "core" / "pom.xml").root.walk("plugin")
                        if node.value("artifactId") == "maven-compiler-plugin")
        self.assertIsNone(compiler.child("version"))
        self.assertIn("<version>3.99.0</version>", parent.read_text())

    def test_mixed_higher_compiler_version_not_downgraded(self):
        path = self.project / "core" / "pom.xml"
        path.write_text(path.read_text().replace("<maven.compiler.release>8</maven.compiler.release>",
                                                "<maven.compiler.release>26</maven.compiler.release>"))
        before = self.content()
        with self.assertRaisesRegex(MigrationError, "refusing downgrade"):
            self.apply()
        self.assertEqual(before, self.content())

    def test_prefixed_namespace_empty_tag_and_escaping(self):
        path = self.project / "standalone.xml"
        path.write_text('<m:project xmlns:m="http://maven.apache.org/POM/4.0.0"><m:properties/></m:project>')
        pom = Pom(path)
        pom.append(pom.root.child("properties"), "message", "a & b < c")
        write_changes({path: pom})
        text = path.read_text()
        self.assertIn("<m:message>a &amp; b &lt; c</m:message>", text)
        ET.fromstring(text)

    def test_targeted_cdata_text_and_empty_text(self):
        path = self.project / "standalone.xml"
        path.write_text("<project><properties><level><![CDATA[11]]></level><empty /></properties></project>")
        pom = Pom(path)
        pom.set_text(pom.root.child("properties").child("level"), "25")
        pom.set_text(pom.root.child("properties").child("empty"), "a & b")
        write_changes({path: pom})
        self.assertIn("<![CDATA[25]]>", path.read_text())
        self.assertIn("a &amp; b", path.read_text())
        ET.fromstring(path.read_text())

    def test_malformed_reactor_no_partial_rewrites(self):
        before = (self.project / "pom.xml").read_bytes()
        (self.project / "core" / "pom.xml").write_text("<project>")
        with self.assertRaises(MigrationError):
            self.apply()
        self.assertEqual(before, (self.project / "pom.xml").read_bytes())

    def test_entities_are_rejected(self):
        path = self.project / "unsafe.xml"
        path.write_text('<!DOCTYPE project [<!ENTITY x SYSTEM "file:///etc/passwd">]><project>&x;</project>')
        with self.assertRaisesRegex(MigrationError, "DTD/entity"):
            Pom(path)

    def test_escaping_module_and_symlink_are_rejected(self):
        path = self.project / "pom.xml"
        path.write_text(path.read_text().replace("<module>core</module>", "<module>../../elsewhere</module>"))
        with self.assertRaisesRegex(MigrationError, "boundary"):
            reactor(self.project)

    def test_shared_compiler_reference_does_not_change_other_consumers(self):
        path = self.project / "core" / "pom.xml"
        path.write_text(path.read_text().replace("<source>1.8</source>", "<source>${compiler.level}</source>"))
        self.apply()
        self.assertIn("<compiler.level>11</compiler.level>", (self.project / "pom.xml").read_text())
        self.assertIn("<source>25</source>", path.read_text())

    def test_profile_local_property_backed_compiler(self):
        path = self.project / "core" / "pom.xml"
        path.write_text(path.read_text().replace(
            "<maven.compiler.release>17</maven.compiler.release>",
            "<profile.level>17</profile.level><maven.compiler.release>${profile.level}</maven.compiler.release>",
        ))
        self.apply()
        self.assertIn("<profile.level>17</profile.level>", path.read_text())
        self.assertEqual(source_version(reactor(self.project)), 25)

    def test_unverified_classifier_version_stops_before_writes(self):
        path = self.project / "core" / "pom.xml"
        path.write_text(path.read_text().replace("<version>3.5.0</version>", "<version>3.4.0</version>"))
        before = self.content()
        with self.assertRaisesRegex(MigrationError, "Unverified unclassified"):
            self.apply()
        self.assertEqual(before, self.content())

    def test_profile_and_execution_plugin_configuration(self):
        path = self.project / "core" / "pom.xml"
        path.write_text(path.read_text().replace(
            "<configuration><source>1.8</source><target>1.8</target></configuration>",
            "<configuration><source>1.8</source><target>1.8</target></configuration>"
            "<executions><execution><id>custom-compile</id><configuration><release>17</release>"
            "</configuration></execution></executions>",
        ))
        self.apply()
        self.assertIn("<id>custom-compile</id>", path.read_text())
        self.assertEqual(source_version(reactor(self.project)), 25)

    def test_explicit_test_compiler_settings_updated(self):
        path = self.project / "core" / "pom.xml"
        path.write_text(path.read_text().replace("<target>1.8</target>",
                                                "<target>1.8</target><testSource>11</testSource><testTarget>11</testTarget><testRelease>11</testRelease>"))
        self.apply()
        for name in ("testSource", "testTarget", "testRelease"):
            self.assertIn(f"<{name}>25</{name}>", path.read_text())

    def test_unresolved_property_stops_all_edits(self):
        path = self.project / "pom.xml"
        path.write_text(path.read_text().replace("${compiler.plugin}", "${missing.version}"))
        before = self.content()
        with self.assertRaisesRegex(MigrationError, "Unresolved"):
            self.apply()
        self.assertEqual(before, self.content())

    def test_missing_config_is_explicit(self):
        with patch.object(pom_support, "SKILL", self.project):
            with self.assertRaisesRegex(MigrationError, "Cannot load config"):
                pom_support.load_config("absent.json")

    def test_changed_disk_not_overwritten(self):
        poms = reactor(self.project)
        migrate_plugins.plan(poms, 25)
        path = self.project / "core" / "pom.xml"
        path.write_text(path.read_text() + "\n<!-- user edit -->")
        with self.assertRaisesRegex(MigrationError, "changed during"):
            write_changes(poms)
        self.assertIn("<!-- user edit -->", path.read_text())

    def test_cli_target_required_and_unknown_target_no_write(self):
        before = self.content()
        for arguments in ([], ["--target", "21"]):
            result = subprocess.run(
                [sys.executable, str(SKILL / "scripts" / "migrate_plugins.py"), str(self.project), *arguments],
                capture_output=True, text=True,
            )
            self.assertNotEqual(result.returncode, 0)
        self.assertEqual(before, self.content())

    def test_recipe_wrapper_has_one_chain_and_no_serial_repetition(self):
        text = (SKILL / "recipes" / "java_upgrade.yml").read_text()
        self.assertEqual(text.count("org.openrewrite.java.migrate.UpgradeToJava25"), 1)
        self.assertNotIn("UpgradeToJava21", text)
        self.assertNotIn("AddSerial", text)
        self.assertNotIn("javax.servlet", text)
        targets = json.loads((SKILL / "configs" / "targets.json").read_text())
        self.assertEqual(list(targets), ["25"])


if __name__ == "__main__":
    unittest.main()
