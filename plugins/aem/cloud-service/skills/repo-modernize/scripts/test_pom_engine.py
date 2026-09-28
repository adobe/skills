"""Tests for pom_engine.py (Phase-2 Task B1).

Run under the lxml venv from the skill dir:
    .venv/bin/python scripts/test_pom_engine.py -v

Requires WKND_FIXTURE to point at the read-only wknd legacy fixture; the
git-diff-locality harness (`_git_init_copy` + `git diff --numstat`) is
reused from the Phase-0 prototype tests.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pom_engine as E  # noqa: E402

FIXTURE = Path(os.environ["WKND_FIXTURE"])
POM_RELPATHS = ["pom.xml", "core/pom.xml", "all/pom.xml", "ui.apps/pom.xml"]

NS = "http://maven.apache.org/POM/4.0.0"


def _q(local):
    return f"{{{NS}}}{local}"


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


class RoundTripTests(unittest.TestCase):
    """The make-or-break test: an unedited load->save must be byte-identical
    across all four target POMs. The spike FAILED this (1-5 line churn per
    pom, from prolog/root-tag re-serialization and self-close spacing) --
    the normalization layer in pom_engine.save exists specifically to fix
    it."""

    def test_roundtrip_is_clean(self):
        proj = _git_init_copy(FIXTURE)
        try:
            for rel in POM_RELPATHS:
                p = proj / rel
                tree, original = E.load(p)
                E.save(tree, p, original)
            changed = _numstat(proj)
            self.assertEqual(changed, "", f"round-trip mutated files:\n{changed}")
        finally:
            shutil.rmtree(proj.parent, ignore_errors=True)

    def test_roundtrip_is_byte_identical(self):
        # Belt-and-suspenders on top of the git-diff check: compare bytes
        # directly, so a change that diff's context lines might mask (e.g.
        # a no-op reordering) can't slip through.
        proj = _git_init_copy(FIXTURE)
        try:
            for rel in POM_RELPATHS:
                p = proj / rel
                before = p.read_bytes()
                tree, original = E.load(p)
                E.save(tree, p, original)
                after = p.read_bytes()
                self.assertEqual(before, after, f"{rel} changed on unedited round-trip")
        finally:
            shutil.rmtree(proj.parent, ignore_errors=True)


class SelfClosingSpacingTests(unittest.TestCase):
    def test_self_closing_spacing_preserved(self):
        proj = _git_init_copy(FIXTURE)
        try:
            p = proj / "all" / "pom.xml"
            tree, original = E.load(p)
            E.save(tree, p, original)
            data = p.read_bytes()
            self.assertIn(b"<activation />", data)
            self.assertNotIn(b"<activation/>", data)
        finally:
            shutil.rmtree(proj.parent, ignore_errors=True)

    def test_self_close_scanner_ignores_content_and_comments(self):
        # A regex-only fix risks mangling a '/>' -like substring that shows
        # up in text/attribute content rather than as a real tag close.
        # This pins that the markup-aware scanner does NOT do that.
        xml = (
            b'<?xml version="1.0" encoding="UTF-8"?>\n'
            b'<project xmlns="http://maven.apache.org/POM/4.0.0">\n'
            b"  <!-- a comment mentioning <foo/> and a/>b -->\n"
            b"  <description>3/4&gt;5 and a/&gt;b</description>\n"
            b"  <empty/>\n"
            b"</project>\n"
        )
        d = Path(tempfile.mkdtemp())
        p = d / "pom.xml"
        p.write_bytes(xml)
        tree, original = E.load(p)
        E.save(tree, p, original)
        out = p.read_bytes()
        self.assertIn(b"<empty />", out)
        self.assertIn(b"a comment mentioning <foo/> and a/>b -->", out)
        self.assertIn(b"3/4&gt;5 and a/&gt;b", out)
        shutil.rmtree(d, ignore_errors=True)


class ComparableVersionTests(unittest.TestCase):
    def test_comparable_version_mixed_alnum(self):
        self.assertTrue(E.ComparableVersion("1.0.0") < E.ComparableVersion("1.0.1"))
        self.assertTrue(E.ComparableVersion("2.0-alpha") < E.ComparableVersion("2.0"))

    def test_no_type_error_on_mixed_alnum_segments(self):
        # The spike's `_comparable()` mapped digit segments to int and
        # everything else to str in the SAME list, e.g.
        # _comparable("1.0.a") == [1, 0, "a"] vs _comparable("1.0.5") ==
        # [1, 0, 5] -- comparing those raises `TypeError: '<' not supported
        # between instances of 'str' and 'int'`. Pin that ComparableVersion
        # never does that, on several mixed-segment pairs.
        pairs = [
            ("1.0.a", "1.0.5"),
            ("1.a.0", "1.0.0"),
            ("2.0-rc1", "2.0-rc2"),
            ("1.0-SNAPSHOT", "1.0.0"),
        ]
        for left, right in pairs:
            try:
                E.ComparableVersion(left) < E.ComparableVersion(right)
                E.ComparableVersion(left) > E.ComparableVersion(right)
                E.ComparableVersion(left) == E.ComparableVersion(right)
            except TypeError:
                self.fail(f"TypeError comparing {left!r} vs {right!r}")

    def test_ordering_is_sane(self):
        self.assertTrue(E.ComparableVersion("1.0-SNAPSHOT") < E.ComparableVersion("1.0"))
        self.assertTrue(E.ComparableVersion("1.9") < E.ComparableVersion("1.10"))
        self.assertTrue(E.ComparableVersion("2.0-alpha") < E.ComparableVersion("2.0-beta"))
        self.assertEqual(E.ComparableVersion("1.0"), E.ComparableVersion("1.0"))
        self.assertTrue(E.ComparableVersion("1.0") <= E.ComparableVersion("1.0"))
        # Missing trailing segments pad with the "release" qualifier key
        # (needed so 2.0-alpha < 2.0, above) rather than a numeric zero, so
        # a real numeric segment (bucket 0) always outranks-as-lesser a
        # qualifier segment (bucket 1) at the same tie-broken position --
        # e.g. "1.0.0"'s 3rd segment is numeric 0, but "1.0"'s padded 3rd
        # segment is the release-qualifier key, so "1.0.0" < "1.0-SNAPSHOT"
        # < "1.0" here. This is a pragmatic, self-consistent total order,
        # not full Maven trailing-zero-stripping semantics (not required by
        # the brief's pinned tests).
        versions = ["1.0.1", "1.0-SNAPSHOT", "1.0.0", "2.0-alpha", "1.0"]
        ordered = sorted(E.ComparableVersion(v) for v in versions)
        self.assertEqual([str(v) for v in ordered],
                          ["1.0.0", "1.0.1", "1.0-SNAPSHOT", "1.0", "2.0-alpha"])


class AddEmbeddedTests(unittest.TestCase):
    def setUp(self):
        self.proj = _git_init_copy(FIXTURE)

    def tearDown(self):
        shutil.rmtree(self.proj.parent, ignore_errors=True)

    def test_add_embedded_does_not_reflow_siblings(self):
        p = self.proj / "all" / "pom.xml"
        before = p.read_text()
        tree, original = E.load(p)
        E.add_embedded(
            tree, "com.adobe.aem.guides", "aem-guides-wknd.ui.config",
            "/apps/wknd-packages/application/install",
        )
        E.save(tree, p, original)

        diff = _diff(self.proj, "all/pom.xml")
        removed = [l for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")]
        added = [l for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++")]
        self.assertEqual(removed, [], f"existing content was reflowed:\n{diff}")
        self.assertTrue(any("ui.config" in l for l in added))

        # Every pre-existing <embedded> block's lines are byte-identical.
        after = p.read_text()
        for marker_block in [
            "<artifactId>aem-guides-wknd.ui.apps</artifactId>",
            "<artifactId>aem-guides-wknd.ui.content</artifactId>",
            "<artifactId>aem-guides-wknd.oak-indexes</artifactId>",
            "<artifactId>aem-guides-wknd.core</artifactId>",
        ]:
            self.assertIn(marker_block, before)
            self.assertIn(marker_block, after)
        for line in before.splitlines():
            if any(m in line for m in ["aem-guides-wknd.ui.apps", "aem-guides-wknd.ui.content",
                                        "aem-guides-wknd.oak-indexes", "aem-guides-wknd.core",
                                        "groupId", "type>zip", "target>/apps"]):
                self.assertIn(line, after.splitlines(), f"sibling line mutated: {line!r}")

    def test_add_embedded_is_pretty_printed_not_dense(self):
        p = self.proj / "all" / "pom.xml"
        tree, original = E.load(p)
        E.add_embedded(
            tree, "com.adobe.aem.guides", "aem-guides-wknd.ui.config",
            "/apps/wknd-packages/application/install",
        )
        E.save(tree, p, original)
        text = p.read_text()
        self.assertNotIn(
            "<embedded><groupId>com.adobe.aem.guides</groupId>", text,
            "new <embedded> serialized as a dense one-liner",
        )
        self.assertIn("            <embedded>\n              <groupId>com.adobe.aem.guides</groupId>",
                       text)


class DropDependencyTests(unittest.TestCase):
    def setUp(self):
        self.proj = _git_init_copy(FIXTURE)

    def tearDown(self):
        shutil.rmtree(self.proj.parent, ignore_errors=True)

    def test_drop_uber_jar_from_core(self):
        p = self.proj / "core" / "pom.xml"
        tree, original = E.load(p)
        self.assertTrue(E.drop_dependency(tree, "com.adobe.aem", "uber-jar"))
        E.save(tree, p, original)

        diff = _diff(self.proj, "core/pom.xml")
        added = [l for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++")]
        removed = [l for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")]
        self.assertEqual(added, [], "dropping a dependency should only remove lines")
        self.assertTrue(any("uber-jar" in l for l in removed))

    def test_drop_dependency_not_found_returns_false(self):
        p = self.proj / "core" / "pom.xml"
        tree, original = E.load(p)
        self.assertFalse(E.drop_dependency(tree, "no.such", "thing"))


class SetChildTextTests(unittest.TestCase):
    def setUp(self):
        self.proj = _git_init_copy(FIXTURE)

    def tearDown(self):
        shutil.rmtree(self.proj.parent, ignore_errors=True)

    def test_set_child_text_updates_existing_child_only(self):
        p = self.proj / "bundle2" / "pom.xml"
        tree, original = E.load(p)
        root = tree.getroot()
        self.assertTrue(E.set_child_text(root, "artifactId", "aem-guides-wknd.bundle2-renamed"))
        self.assertTrue(E.set_child_text(root, "name", "WKND - bundle2 renamed"))
        E.save(tree, p, original)
        diff = _diff(self.proj, "bundle2/pom.xml")
        self.assertIn("bundle2-renamed", diff)
        self.assertIn("WKND - bundle2 renamed", diff)

    def test_set_child_text_missing_child_is_noop(self):
        p = self.proj / "bundle2" / "pom.xml"
        tree, original = E.load(p)
        root = tree.getroot()
        self.assertFalse(E.set_child_text(root, "noSuchElement", "x"))


class FindFirstTests(unittest.TestCase):
    def test_find_first_is_namespace_agnostic_and_finds_descendant(self):
        p = FIXTURE / "core" / "pom.xml"
        tree, _ = E.load(p)
        # "First in document order" -- core/pom.xml's very first <artifactId>
        # is the inherited <parent>'s, not the module's own (which comes
        # later); this also proves find_first descends into <parent>, not
        # just root's direct children.
        el = E.find_first(tree, "artifactId")
        self.assertIsNotNone(el)
        self.assertEqual(el.text, "aem-guides-wknd")
        # The module's own artifactId is reachable too, just not first.
        all_artifact_ids = [e.text for e in tree.getroot().iter() if E._local(e.tag) == "artifactId"]
        self.assertIn("aem-guides-wknd.core", all_artifact_ids)

    def test_find_first_returns_none_when_absent(self):
        p = FIXTURE / "core" / "pom.xml"
        tree, _ = E.load(p)
        self.assertIsNone(E.find_first(tree, "thisTagDoesNotExist"))


class MergeDependenciesTests(unittest.TestCase):
    def setUp(self):
        self.proj = _git_init_copy(FIXTURE)

    def tearDown(self):
        shutil.rmtree(self.proj.parent, ignore_errors=True)

    def test_real_fixture_dedup_and_uber_jar_denylist(self):
        # bundle2's <dependencies> is identical to core's minus uber-jar:
        # merging core -> bundle2 should add nothing (everything's already
        # present) and must never carry uber-jar forward.
        src_tree, _ = E.load(self.proj / "core" / "pom.xml")
        dst_path = self.proj / "bundle2" / "pom.xml"
        dst_tree, dst_original = E.load(dst_path)
        notes = E.merge_dependencies(dst_tree, src_tree, provided_prefixes=())
        self.assertEqual(notes, [])
        E.save(dst_tree, dst_path, dst_original)
        diff = _numstat(self.proj)
        self.assertEqual(diff, "", f"no-op merge should not touch bundle2/pom.xml:\n{diff}")

    def _crafted_tree(self, xml):
        from lxml import etree
        return etree.ElementTree(etree.fromstring(xml.encode("utf-8")))

    def test_crafted_add_bump_and_denylist(self):
        dst_xml = f"""<project xmlns="{NS}">
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>kept</artifactId>
      <version>1.0.0</version>
    </dependency>
  </dependencies>
</project>
"""
        src_xml = f"""<project xmlns="{NS}">
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>kept</artifactId>
      <version>1.2.0</version>
    </dependency>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>brand-new</artifactId>
      <version>3.0.0</version>
    </dependency>
    <dependency>
      <groupId>com.adobe.aem</groupId>
      <artifactId>uber-jar</artifactId>
      <version>6.5.0</version>
    </dependency>
  </dependencies>
</project>
"""
        dst = self._crafted_tree(dst_xml)
        src = self._crafted_tree(src_xml)
        notes = E.merge_dependencies(dst, src, provided_prefixes=())
        self.assertIn("bump com.example:kept->1.2.0", notes)
        self.assertIn("add com.example:brand-new", notes)
        self.assertFalse(any("uber-jar" in n for n in notes))

        deps = E.find_first(dst, "dependencies")
        artifacts = [E._child_text(d, "artifactId") for d in deps]
        self.assertIn("brand-new", artifacts)
        self.assertNotIn("uber-jar", artifacts)
        kept = [d for d in deps if E._child_text(d, "artifactId") == "kept"][0]
        self.assertEqual(E._child_text(kept, "version"), "1.2.0")

    def test_provided_prefixes_marks_scope_on_newly_added(self):
        dst_xml = f"""<project xmlns="{NS}">
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>kept</artifactId>
      <version>1.0.0</version>
    </dependency>
  </dependencies>
</project>
"""
        src_xml = f"""<project xmlns="{NS}">
  <dependencies>
    <dependency>
      <groupId>com.adobe.aem</groupId>
      <artifactId>aem-sdk-api</artifactId>
      <version>2023.1.0</version>
    </dependency>
  </dependencies>
</project>
"""
        dst = self._crafted_tree(dst_xml)
        src = self._crafted_tree(src_xml)
        E.merge_dependencies(dst, src, provided_prefixes=("com.adobe.aem",))
        deps = E.find_first(dst, "dependencies")
        added = [d for d in deps if E._child_text(d, "artifactId") == "aem-sdk-api"][0]
        self.assertEqual(E._child_text(added, "scope"), "provided")


class EnsurePluginTests(unittest.TestCase):
    def setUp(self):
        self.proj = _git_init_copy(FIXTURE)

    def tearDown(self):
        shutil.rmtree(self.proj.parent, ignore_errors=True)

    def test_replace_existing_plugin_content(self):
        p = self.proj / "core" / "pom.xml"
        tree, original = E.load(p)
        build = E.find_first(tree, "build")
        plugin = E.ensure_plugin(
            build, "org.apache.felix", "maven-scr-plugin",
            "<version>1.26.4</version>",
        )
        self.assertEqual(E._child_text(plugin, "version"), "1.26.4")
        E.save(tree, p, original)

        diff = _diff(self.proj, "core/pom.xml")
        self.assertIn("1.26.4", diff)
        removed = [l for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")]
        # maven-scr-plugin had no other children to remove; the sibling
        # maven-bundle-plugin block must be untouched.
        self.assertFalse(any("maven-bundle-plugin" in l for l in removed))
        self.assertFalse(any("Sling-Model-Packages" in l for l in removed))

    def test_insert_new_plugin_does_not_reflow_existing(self):
        p = self.proj / "core" / "pom.xml"
        tree, original = E.load(p)
        build = E.find_first(tree, "build")
        E.ensure_plugin(
            build, "org.apache.jackrabbit", "filevault-package-maven-plugin",
            "<extensions>true</extensions><configuration><group>com.wknd</group></configuration>",
        )
        E.save(tree, p, original)

        diff = _diff(self.proj, "core/pom.xml")
        removed = [l for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")]
        self.assertEqual(removed, [], f"existing plugins were reflowed:\n{diff}")
        added = [l for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++")]
        self.assertTrue(any("filevault-package-maven-plugin" in l for l in added))

        text = p.read_text()
        # The existing maven-bundle-plugin's <configuration> is still intact.
        self.assertIn("com.adobe.aem.guides.core.core", text)

    def test_ensure_plugin_creates_plugins_block_when_missing(self):
        xml = f"""<project xmlns="{NS}">
  <build>
  </build>
</project>
"""
        from lxml import etree
        tree = etree.ElementTree(etree.fromstring(xml.encode("utf-8")))
        build = E.find_first(tree, "build")
        plugin = E.ensure_plugin(build, "com.example", "some-plugin", "<foo>bar</foo>")
        self.assertEqual(E._child_text(plugin, "groupId"), "com.example")
        self.assertEqual(E._child_text(plugin, "foo"), "bar")


class PrettyInsertLeafTests(unittest.TestCase):
    def test_pretty_insert_leaf_element_keeps_its_own_text(self):
        # Reproduces the corruption `refactor_poms._insert_leaf_element`
        # used to paper over (that capture/restore workaround has since
        # been retired now that this guard fixes it at the source):
        # `_apply_indentation_shape` unconditionally ran `new_elem.text =
        # template.text` before ever looking at whether `new_elem` has
        # children, so inserting a LEAF element (its own `.text` IS its
        # real scalar value, e.g. a <module> name) as the new last child
        # clobbered that value with the last existing same-tag sibling's
        # text. A composite element (one with children of its own) still
        # needs `_apply_indentation_shape` to set its `.text` to the
        # template's indentation whitespace -- only the childless/leaf
        # case must be exempted.
        from lxml import etree
        xml = f"""<project xmlns="{NS}">
  <modules>
    <module>core</module>
    <module>dispatcher</module>
  </modules>
</project>
"""
        tree = etree.ElementTree(etree.fromstring(xml.encode("utf-8")))
        modules_el = E.find_first(tree, "modules")
        new_module = etree.Element(_q("module"))
        new_module.text = "all"
        E.pretty_insert(modules_el, new_module)
        self.assertEqual(
            new_module.text, "all",
            "leaf element's own text was clobbered by a sibling's text",
        )
        # And it's still correctly appended/pretty-printed as a real sibling.
        modules = [c for c in modules_el if E._local(c.tag) == "module"]
        self.assertEqual([m.text for m in modules], ["core", "dispatcher", "all"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
