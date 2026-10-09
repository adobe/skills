# scripts/test_rm_common.py
import shutil, tempfile, unittest
from pathlib import Path
import rm_common as C

class Common(unittest.TestCase):
    def setUp(self):
        self._tmpdirs = []

    def tearDown(self):
        for d in self._tmpdirs:
            shutil.rmtree(d, ignore_errors=True)

    def mkdtemp(self):
        d = Path(tempfile.mkdtemp())
        self._tmpdirs.append(d)
        return d

    def test_save_and_load_json_roundtrip(self):
        d = self.mkdtemp()
        C.save_json(d / ".modernize/config.json", {"b": 1, "a": 2})
        self.assertEqual(C.load_json(d / ".modernize/config.json"), {"b": 1, "a": 2})
        # deterministic: sorted keys + trailing newline
        raw = (d / ".modernize/config.json").read_text()
        self.assertTrue(raw.endswith("\n"))
        self.assertLess(raw.index('"a"'), raw.index('"b"'))

    def test_sha256_stable(self):
        d = self.mkdtemp(); (d / "f").write_bytes(b"hello")
        self.assertEqual(C.sha256_file(d / "f"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")

    def test_pom_text_ignores_namespace(self):
        d = self.mkdtemp(); p = d / "pom.xml"
        p.write_text('<project xmlns="http://maven.apache.org/POM/4.0.0">'
                     '<artifactId>x.core</artifactId></project>')
        self.assertEqual(C.pom_text(p, "artifactId"), "x.core")

    def test_dedup_findings(self):
        f = C.Finding("RM-107", "CRITICAL", "same")
        self.assertEqual(len(C.dedup_findings([f, C.Finding("RM-107","CRITICAL","same")])), 1)

    def test_dedup_keeps_distinct_priorities(self):
        a = C.Finding("RM-102", "LOW", "x"); b = C.Finding("RM-102", "HIGH", "x")
        self.assertEqual(len(C.dedup_findings([a, b, a])), 2)

    def test_pom_coord_reads_own_artifactid_not_parent(self):
        d = self.mkdtemp(); p = d / "pom.xml"
        p.write_text('<project xmlns="http://maven.apache.org/POM/4.0.0">'
                     '<parent><groupId>com.corp</groupId><artifactId>corp-parent</artifactId><version>9</version></parent>'
                     '<artifactId>my-app</artifactId></project>')
        self.assertEqual(C.pom_coord(p, "artifactId"), "my-app")
        self.assertEqual(C.pom_coord(p, "groupId"), "com.corp")   # inherited from <parent>
        self.assertEqual(C.pom_coord(p, "version"), "9")          # inherited from <parent>

    def test_pom_coord_prefers_own_groupid(self):
        d = self.mkdtemp(); p = d / "pom.xml"
        p.write_text('<project xmlns="http://maven.apache.org/POM/4.0.0">'
                     '<parent><groupId>com.corp</groupId><artifactId>cp</artifactId><version>9</version></parent>'
                     '<groupId>com.own</groupId><artifactId>my-app</artifactId></project>')
        self.assertEqual(C.pom_coord(p, "groupId"), "com.own")

if __name__ == "__main__":
    unittest.main(verbosity=2)
