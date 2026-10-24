# scripts/test_split_content.py
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

import rm_common as C
import split_content as SP


def _config():
    return {"schemaVersion": 1, "projectShape": "SINGLE", "groupId": "com.x", "artifactId": "acme",
            "appId": "wknd", "appTitle": "WKND", "version": "1.0.0-SNAPSHOT",
            "targetModules": {"all": "all", "uiApps": "ui.apps", "uiAppsStructure": "ui.apps.structure",
                               "uiConfig": "ui.config", "uiContent": "ui.content"},
            "bundles": [], "testBundles": [],
            "contentPackages": [{"path": "src-pkg",
                "jcrRoot": "src-pkg/src/main/content/jcr_root",
                "filterXml": "src-pkg/src/main/content/META-INF/vault/filter.xml"}],
            "runModeDecisions": {}}


def _structure_pom_xml():
    """The real archetype-56 `ui.apps.structure/pom.xml` FileVault shape (see
    assets/archetype-pom-templates/ui.apps.structure/pom.xml, rendered verbatim
    by scaffold_modules.scaffold): cloudManagerTarget nested INSIDE <properties>,
    <filters /> shipped as an empty self-closing element. write_structure_roots
    must anchor on the empty <filters/>, NOT on cloudManagerTarget."""
    return (
        '<project><build><plugins><plugin>'
        '<artifactId>filevault-package-maven-plugin</artifactId>'
        '<configuration>'
        '<properties>'
        '<cloudManagerTarget>none</cloudManagerTarget>'
        '</properties>'
        '<filters />'
        '</configuration>'
        '</plugin></plugins></build></project>')


def _mk_structure_pom(d):
    pom = d / "ui.apps.structure/pom.xml"
    pom.parent.mkdir(parents=True, exist_ok=True)
    pom.write_text(_structure_pom_xml())
    return pom


def _init_git(d):
    subprocess.run(["git", "init", "-q"], cwd=d, check=True)
    _commit_all(d, "b")


def _commit_all(d, msg):
    # `git mv` only stages a rename in the index; `git log` walks *commits*, so
    # `--follow` sees nothing until the staged rename is actually committed. This
    # mirrors the real workflow (Phase 1's split step lands as a reviewable commit/
    # diff on a dedicated branch, per SKILL.md), and is what lets the tests below
    # confirm the moved file's history survives the split.
    subprocess.run(["git", "add", "-A"], cwd=d, check=True)
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", msg], cwd=d, check=True)


def _git_log_follow(d, relpath):
    return subprocess.run(["git", "log", "--follow", "--oneline", "--", relpath], cwd=d,
                           capture_output=True, text=True).stdout


class Routing(unittest.TestCase):
    def test_immutable_dirs(self):
        for n in ["apps", "libs", "_oak_index"]:
            self.assertEqual(SP.route_top_level_dir(n), "ui.apps", n)

    def test_mutable_dirs(self):
        for n in ["content", "etc", "conf", "home"]:
            self.assertEqual(SP.route_top_level_dir(n), "ui.content", n)


class Move(unittest.TestCase):
    def _mk_git_proj(self):
        d = Path(tempfile.mkdtemp()) / "proj"
        base = d / "src-pkg/src/main/content/jcr_root"
        (base / "apps/wknd").mkdir(parents=True); (base / "apps/wknd/x.txt").write_text("A")
        (base / "etc/designs/wknd").mkdir(parents=True); (base / "etc/designs/wknd/y.txt").write_text("E")
        for m in ["ui.apps", "ui.content"]:
            (d / f"{m}/src/main/content/jcr_root").mkdir(parents=True, exist_ok=True)
        _init_git(d)
        return d

    def test_etc_routes_to_ui_content_apps_stays(self):
        d = self._mk_git_proj()
        moved = SP.move_content(str(d), _config(), use_git=True)
        self.assertTrue((d / "ui.content/src/main/content/jcr_root/etc/designs/wknd/y.txt").exists())
        self.assertTrue((d / "ui.apps/src/main/content/jcr_root/apps/wknd/x.txt").exists())
        _commit_all(d, "split")  # commit the git-mv-staged rename so `log --follow` has history to walk
        log = _git_log_follow(d, "ui.content/src/main/content/jcr_root/etc/designs/wknd/y.txt")
        self.assertTrue(log.strip(), "history should follow the git mv")
        self.assertEqual(sorted(moved), ["src-pkg/apps -> ui.apps", "src-pkg/etc -> ui.content"])

    def test_shutil_fallback_when_use_git_false(self):
        # No git repo at all here — use_git=False must not shell out to git.
        d = Path(tempfile.mkdtemp()) / "proj"
        base = d / "src-pkg/src/main/content/jcr_root"
        (base / "apps/wknd").mkdir(parents=True); (base / "apps/wknd/x.txt").write_text("A")
        moved = SP.move_content(str(d), _config(), use_git=False)
        self.assertTrue((d / "ui.apps/src/main/content/jcr_root/apps/wknd/x.txt").exists())
        self.assertEqual(moved, ["src-pkg/apps -> ui.apps"])


class SelfMoveGuard(unittest.TestCase):
    """Real-world fixture (the canonical config-schema.md example): source content
    packages literally named ui.apps / ui.content / oak-indexes. apps/libs/content
    resolve to a destination identical to their current location and must STAY put
    (self-move guard); etc/ still re-routes out of ui.apps into ui.content, and
    _oak_index still re-routes out of oak-indexes into ui.apps. This is the exact
    trace this task was specified against, and the same fixture Task B12 exercises
    end-to-end."""

    def _mk_matching_name_proj(self):
        d = Path(tempfile.mkdtemp()) / "proj"
        ui_apps = d / "ui.apps/src/main/content/jcr_root"
        (ui_apps / "apps/wknd").mkdir(parents=True); (ui_apps / "apps/wknd/a.txt").write_text("A")
        (ui_apps / "libs/wknd").mkdir(parents=True); (ui_apps / "libs/wknd/l.txt").write_text("L")
        (ui_apps / "etc/designs/wknd").mkdir(parents=True); (ui_apps / "etc/designs/wknd/e.txt").write_text("E")
        ui_content = d / "ui.content/src/main/content/jcr_root"
        (ui_content / "content/wknd").mkdir(parents=True); (ui_content / "content/wknd/c.txt").write_text("C")
        oak = d / "oak-indexes/src/main/content/jcr_root"
        (oak / "_oak_index/someIndex").mkdir(parents=True); (oak / "_oak_index/someIndex/o.txt").write_text("O")
        _init_git(d)
        return d

    def _matching_name_config(self):
        cfg = _config()
        cfg["contentPackages"] = [
            {"path": "ui.apps", "jcrRoot": "ui.apps/src/main/content/jcr_root",
             "filterXml": "ui.apps/src/main/content/META-INF/vault/filter.xml"},
            {"path": "ui.content", "jcrRoot": "ui.content/src/main/content/jcr_root",
             "filterXml": "ui.content/src/main/content/META-INF/vault/filter.xml"},
            {"path": "oak-indexes", "jcrRoot": "oak-indexes/src/main/content/jcr_root",
             "filterXml": "oak-indexes/src/main/content/META-INF/vault/filter.xml"},
        ]
        return cfg

    def test_self_move_stays_reroute_moves_oak_index_to_ui_apps(self):
        d = self._mk_matching_name_proj()
        moved = SP.move_content(str(d), self._matching_name_config(), use_git=True)

        # self-move guard: apps/ and libs/ under source ui.apps resolve onto themselves -> STAY
        self.assertTrue((d / "ui.apps/src/main/content/jcr_root/apps/wknd/a.txt").exists())
        self.assertTrue((d / "ui.apps/src/main/content/jcr_root/libs/wknd/l.txt").exists())
        # self-move guard: content/ under source ui.content resolves onto itself -> STAYS
        self.assertTrue((d / "ui.content/src/main/content/jcr_root/content/wknd/c.txt").exists())

        # re-route: etc/ under source ui.apps is NOT a self-move -> moves to ui.content
        self.assertTrue((d / "ui.content/src/main/content/jcr_root/etc/designs/wknd/e.txt").exists())
        self.assertFalse((d / "ui.apps/src/main/content/jcr_root/etc").exists())

        # re-route: _oak_index under source oak-indexes -> moves to ui.apps
        self.assertTrue((d / "ui.apps/src/main/content/jcr_root/_oak_index/someIndex/o.txt").exists())
        self.assertFalse((d / "oak-indexes/src/main/content/jcr_root/_oak_index").exists())

        _commit_all(d, "split")  # commit the git-mv-staged renames so `log --follow` has history to walk

        # git mv, not copy+add: history follows both re-routed files/dirs
        self.assertTrue(_git_log_follow(
            d, "ui.content/src/main/content/jcr_root/etc/designs/wknd/e.txt").strip(),
            "history should follow the git mv for etc/")
        self.assertTrue(_git_log_follow(
            d, "ui.apps/src/main/content/jcr_root/_oak_index/someIndex/o.txt").strip(),
            "history should follow the git mv for _oak_index")

        # exactly the two re-routed dirs are reported; self-moved dirs are skipped, not "moved"
        self.assertEqual(moved, ["ui.apps/etc -> ui.content", "oak-indexes/_oak_index -> ui.apps"])


class SkipsMissingJcrRoot(unittest.TestCase):
    def test_missing_jcr_root_is_skipped_not_raised(self):
        d = Path(tempfile.mkdtemp()) / "proj"
        d.mkdir(parents=True)
        cfg = _config()
        cfg["contentPackages"] = [{"path": "ghost", "jcrRoot": "ghost/src/main/content/jcr_root",
                                    "filterXml": "ghost/src/main/content/META-INF/vault/filter.xml"}]
        moved = SP.move_content(str(d), cfg, use_git=True)
        self.assertEqual(moved, [])


class Filters(unittest.TestCase):
    """split_filters: route every source filter root via validate.classify_filter_root
    into a NEW ui.apps/ui.content filter.xml, stripping include/exclude by construction."""

    def _mk_source_filter(self, roots_xml):
        d = Path(tempfile.mkdtemp()) / "proj"
        fx = d / "src-pkg/src/main/content/META-INF/vault/filter.xml"
        fx.parent.mkdir(parents=True)
        fx.write_text('<workspaceFilter version="1.0">' + "".join(roots_xml) + '</workspaceFilter>')
        for m in ["ui.apps", "ui.content"]:
            (d / f"{m}/src/main/content/META-INF/vault").mkdir(parents=True, exist_ok=True)
        # Create backing content on disk for every declared root (in both target
        # modules) so split_filters' CAM-parity content-resolution prune keeps them
        # -- these unit tests exercise ROUTING/escaping/mode, not the prune, and
        # call split_filters directly (no move_content), so without this every root
        # would resolve to no content and be pruned. `_oak_index` escaping mirrors
        # split_content's own on-disk naming.
        import re as _re
        from xml.sax.saxutils import unescape as _unescape
        for rx in roots_xml:
            m = _re.search(r'root="([^"]+)"', rx)
            if not m:
                continue
            rel = _unescape(m.group(1)).lstrip("/")  # decode &amp; etc. like the XML parser does
            if rel.startswith("oak:index"):
                rel = "_oak_index" + rel[len("oak:index"):]
            for mod in ["ui.apps", "ui.content"]:
                (d / mod / "src/main/content/jcr_root" / rel).mkdir(parents=True, exist_ok=True)
        return d

    def test_split_routes_roots_and_strips_immutable_includes(self):
        d = self._mk_source_filter([
            '<filter root="/apps/wknd"><include pattern="/apps/wknd/components"/></filter>',
            '<filter root="/etc/designs/wknd"/>',
            '<filter root="/oak:index/x"/>'])
        SP.split_filters(str(d), _config())
        apps = (d / "ui.apps/src/main/content/META-INF/vault/filter.xml").read_text()
        content = (d / "ui.content/src/main/content/META-INF/vault/filter.xml").read_text()
        self.assertIn('root="/apps/wknd"', apps)
        self.assertNotIn("include", apps)
        self.assertIn('root="/oak:index/x"', apps)
        self.assertIn('root="/etc/designs/wknd"', content)
        self.assertNotIn("include", content)

    def test_mutable_filter_preserves_include_exclude_immutable_stays_bare(self):
        """The asymmetry fixed here (references/transform-rules.md §2, encoding
        CAM tool §6.1): an IMMUTABLE root's include/exclude is stripped (as
        above), but a MUTABLE root's include/exclude MUST be preserved verbatim
        -- attributes and all (e.g. `pattern`, `mode`) -- so the modernized
        ui.content package is never broader than the legacy filter it replaces.
        Fixture: immutable `/apps/y` carries an `<include>`; mutable `/content/x`
        carries both an `<include mode="...">` and an `<exclude>`."""
        d = self._mk_source_filter([
            '<filter root="/apps/y"><include pattern="/apps/y/keep"/></filter>',
            '<filter root="/content/x">'
            '<include pattern="/content/x/keep" mode="replace"/>'
            '<exclude pattern="/content/x/drop"/>'
            '</filter>'])
        SP.split_filters(str(d), _config())
        apps_path = d / "ui.apps/src/main/content/META-INF/vault/filter.xml"
        content_path = d / "ui.content/src/main/content/META-INF/vault/filter.xml"
        apps = apps_path.read_text()
        content = content_path.read_text()

        # immutable /apps/y: bare filter, its source include is gone entirely
        self.assertIn('<filter root="/apps/y"/>', apps)
        self.assertNotIn("include", apps)

        # mutable /content/x: NOT bare -- include AND exclude preserved, attrs intact
        self.assertNotIn('<filter root="/content/x"/>', content)
        self.assertIn('root="/content/x"', content)
        self.assertIn('<include pattern="/content/x/keep" mode="replace"/>', content)
        self.assertIn('<exclude pattern="/content/x/drop"/>', content)

        # both outputs remain well-formed XML
        ET.parse(str(apps_path))
        ET.parse(str(content_path))

    def test_mutable_filter_preserves_mode_attribute_immutable_strips_it(self):
        """#8 (references/transform-rules.md §2): the source `<filter>`'s OWN `mode`
        attribute (update/merge) is preserved on a MUTABLE root -- dropping it would
        default the root to `replace` on install and risk clobbering existing author
        content -- but is STRIPPED on an IMMUTABLE root (which keeps only its root).
        Matches the CAM tool, which preserves `mode` on the mutable roots it emits,
        and emits it BEFORE `root`."""
        d = self._mk_source_filter([
            '<filter mode="merge" root="/apps/z"/>',      # immutable -> mode dropped
            '<filter mode="update" root="/conf/x"/>',     # mutable   -> mode kept
            '<filter mode="merge" root="/content/y"/>'])  # mutable   -> mode kept
        SP.split_filters(str(d), _config())
        apps = (d / "ui.apps/src/main/content/META-INF/vault/filter.xml").read_text()
        content = (d / "ui.content/src/main/content/META-INF/vault/filter.xml").read_text()
        # immutable /apps/z: bare, NO mode attribute at all
        self.assertIn('<filter root="/apps/z"/>', apps)
        self.assertNotIn("mode=", apps)
        # mutable roots: mode preserved, emitted before root (CAM output order)
        self.assertIn('<filter mode="update" root="/conf/x"/>', content)
        self.assertIn('<filter mode="merge" root="/content/y"/>', content)

    def test_content_less_bare_root_is_pruned_backed_root_kept(self):
        """CAM parity: a bare filter root that resolves to NO content on disk is
        pruned ("could not be resolved to valid content"); a root WITH backing
        content is kept. A root carrying include/exclude is always kept (a
        deliberate customer narrowing), even without a direct backing dir."""
        d = Path(tempfile.mkdtemp()) / "proj"
        fx = d / "src-pkg/src/main/content/META-INF/vault/filter.xml"
        fx.parent.mkdir(parents=True)
        fx.write_text('<workspaceFilter version="1.0">'
                      '<filter root="/apps/real"/>'          # backed -> kept
                      '<filter root="/apps/ghost"/>'         # no backing -> pruned
                      '<filter root="/content/real"/>'       # backed -> kept
                      '<filter root="/content/ghost"/>'      # no backing -> pruned
                      '<filter root="/content/narrowed">'    # no dir but has include -> kept
                      '<include pattern="/content/narrowed/x"/></filter>'
                      '</workspaceFilter>')
        for m in ("ui.apps", "ui.content"):
            (d / m / "src/main/content/META-INF/vault").mkdir(parents=True)
        # only the "real" roots get backing content
        (d / "ui.apps/src/main/content/jcr_root/apps/real").mkdir(parents=True)
        (d / "ui.content/src/main/content/jcr_root/content/real").mkdir(parents=True)
        pruned = SP.split_filters(str(d), _config())
        apps = (d / "ui.apps/src/main/content/META-INF/vault/filter.xml").read_text()
        content = (d / "ui.content/src/main/content/META-INF/vault/filter.xml").read_text()
        self.assertEqual(sorted(pruned), ["/apps/ghost", "/content/ghost"])
        self.assertIn('root="/apps/real"', apps)
        self.assertNotIn("ghost", apps)
        self.assertIn('root="/content/real"', content)
        self.assertIn('root="/content/narrowed"', content)   # kept via include
        self.assertNotIn("ghost", content)

    def test_inline_child_node_backing_is_kept(self):
        """A filter root whose leaf node is serialized INLINE inside the parent's
        `.content.xml` (e.g. oak:index/x) must be KEPT -- never false-pruned."""
        d = Path(tempfile.mkdtemp()) / "proj"
        fx = d / "src-pkg/src/main/content/META-INF/vault/filter.xml"
        fx.parent.mkdir(parents=True)
        fx.write_text('<workspaceFilter version="1.0">'
                      '<filter root="/oak:index/myIndex"/></workspaceFilter>')
        for m in ("ui.apps", "ui.content"):
            (d / m / "src/main/content/META-INF/vault").mkdir(parents=True)
        oak = d / "ui.apps/src/main/content/jcr_root/_oak_index"
        oak.mkdir(parents=True)
        # myIndex declared INLINE as a child of _oak_index/.content.xml (no own dir/file)
        (oak / ".content.xml").write_text(
            '<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0">'
            '<myIndex jcr:primaryType="oak:QueryIndexDefinition"/></jcr:root>')
        pruned = SP.split_filters(str(d), _config())
        apps = (d / "ui.apps/src/main/content/META-INF/vault/filter.xml").read_text()
        self.assertEqual(pruned, [])                      # nothing pruned
        self.assertIn('root="/oak:index/myIndex"', apps)  # inline-backed root kept

    def test_namespaced_segment_backing_is_kept(self):
        """A mutable filter root with a NAMESPACED segment (`cq:tags`, `rep:policy`, ...)
        is FileVault-escaped on disk as `_cq_tags`/`_rep_policy`; the content-resolution
        check must recognize that and KEEP the root (regression: a real umbrella project had
        `/content/cq:tags` backed by a `_cq_tags` directory, and the leading-only
        oak:index escaping wrongly pruned it)."""
        d = Path(tempfile.mkdtemp()) / "proj"
        fx = d / "src-pkg/src/main/content/META-INF/vault/filter.xml"
        fx.parent.mkdir(parents=True)
        fx.write_text('<workspaceFilter version="1.0">'
                      '<filter root="/content/cq:tags"/>'          # backed by _cq_tags dir
                      '<filter root="/content/ghost:node"/>'       # no backing -> pruned
                      '</workspaceFilter>')
        for m in ("ui.apps", "ui.content"):
            (d / m / "src/main/content/META-INF/vault").mkdir(parents=True)
        (d / "ui.content/src/main/content/jcr_root/content/_cq_tags").mkdir(parents=True)
        pruned = SP.split_filters(str(d), _config())
        content = (d / "ui.content/src/main/content/META-INF/vault/filter.xml").read_text()
        self.assertIn('root="/content/cq:tags"', content)  # namespaced-backed root kept
        self.assertEqual(pruned, ["/content/ghost:node"])  # only the truly-unbacked one pruned

    def test_split_filters_escapes_ampersand_and_round_trips(self):
        # A JCR name/pattern containing `&` (or `<`, `>`, `"`) must be XML-escaped on
        # write, in both the bare (_write_filter's root attr) and child (_child_xml's
        # include/exclude attrs) cases -- otherwise the emitted filter.xml is
        # malformed and ET.parse raises ParseError instead of round-tripping.
        d = self._mk_source_filter([
            '<filter root="/apps/a&amp;b"/>',
            '<filter root="/content/c&amp;d">'
            '<include pattern="/content/c&amp;d/x&amp;y"/>'
            '</filter>'])
        SP.split_filters(str(d), _config())
        apps_path = d / "ui.apps/src/main/content/META-INF/vault/filter.xml"
        content_path = d / "ui.content/src/main/content/META-INF/vault/filter.xml"

        apps_filter = next(e for e in ET.parse(str(apps_path)).iter()
                            if e.tag.split("}")[-1] == "filter")
        self.assertEqual(apps_filter.attrib["root"], "/apps/a&b")

        content_tree = ET.parse(str(content_path))  # must not raise ParseError
        content_filter = next(e for e in content_tree.iter() if e.tag.split("}")[-1] == "filter")
        self.assertEqual(content_filter.attrib["root"], "/content/c&d")
        include = next(e for e in content_filter if e.tag.split("}")[-1] == "include")
        self.assertEqual(include.attrib["pattern"], "/content/c&d/x&y")


class StructureRoots(unittest.TestCase):
    """derive_structure_roots: seeded ancestor-path set, leaf dropped.
    write_structure_roots: populates the ui.apps.structure/pom.xml FileVault
    config's empty <filters/> -- NOT anchored on cloudManagerTarget (that lives
    inside <properties> in the real archetype-56 template; anchoring there would
    nest <filters> inside <properties> and leave a duplicate empty <filters/>
    behind). See assets/archetype-pom-templates/ui.apps.structure/pom.xml for the
    exact shape this fixture mirrors."""

    def test_ancestors_seeded_and_leaf_dropped(self):
        roots = SP.derive_structure_roots(
            ["/apps/wknd", "/libs/cq/core/content/nav/wknd", "/oak:index/x"], "wknd")
        self.assertIn("/apps", roots)
        self.assertIn("/apps/wknd", roots)
        self.assertIn("/libs/cq/core/content/nav", roots)
        self.assertNotIn("/libs/cq/core/content/nav/wknd", roots)
        self.assertIn("/oak:index", roots)

    def test_populates_empty_filters_without_duplicating_it(self):
        d = Path(tempfile.mkdtemp()) / "proj"
        pom = _mk_structure_pom(d)
        SP.write_structure_roots(str(d), _config(), ["/apps", "/apps/wknd"])
        text = pom.read_text()
        self.assertIn("<filter><root>/apps</root></filter>", text)
        self.assertIn("<filter><root>/apps/wknd</root></filter>", text)
        # the empty placeholder is gone, and not merely duplicated alongside a new one
        self.assertNotIn("<filters />", text)
        self.assertNotIn("<filters/>", text)
        self.assertEqual(text.count("<filters>"), 1)
        # cloudManagerTarget / properties wrapper survives untouched
        self.assertIn("<cloudManagerTarget>none</cloudManagerTarget>", text)
        self.assertIn("<properties>", text)
        # no oak root in this call -> allowIndexDefinitions must NOT appear
        self.assertNotIn("allowIndexDefinitions", text)

    def test_replaces_a_pre_populated_filters_block(self):
        """Regression (real umbrella project): a PARTLY-MODERNIZED project already ships a
        `ui.apps.structure/pom.xml` with a POPULATED `<filters>...</filters>` (not the
        empty archetype placeholder). write_structure_roots must REPLACE that block with
        the freshly-computed roots, not raise."""
        d = Path(tempfile.mkdtemp()) / "proj"
        pom = d / "ui.apps.structure/pom.xml"
        pom.parent.mkdir(parents=True)
        pom.write_text(
            '<project xmlns="http://maven.apache.org/POM/4.0.0"><build><plugins><plugin>'
            '<artifactId>filevault-package-maven-plugin</artifactId><configuration>'
            '<properties><cloudManagerTarget>none</cloudManagerTarget></properties>'
            '<filters>\n'
            '            <filter><root>/apps</root></filter>\n'
            '            <filter><root>/apps/settings</root></filter>\n'
            '          </filters>'
            '</configuration></plugin></plugins></build></project>\n')
        SP.write_structure_roots(str(d), _config(), ["/apps", "/apps/umbrella"])
        text = pom.read_text()
        self.assertIn("<filter><root>/apps/umbrella</root></filter>", text)   # new root in
        self.assertNotIn("/apps/settings", text)                          # stale root out
        self.assertEqual(text.count("<filters>"), 1)                      # exactly one block

    def test_allow_index_definitions_when_oak(self):
        d = Path(tempfile.mkdtemp()) / "proj"
        pom = _mk_structure_pom(d)
        SP.write_structure_roots(str(d), _config(), ["/apps", "/oak:index/x"])
        text = pom.read_text()
        self.assertIn("allowIndexDefinitions", text)
        self.assertIn("<filter><root>/oak:index/x</root></filter>", text)
        self.assertNotIn("<filters />", text)
        self.assertEqual(text.count("<filters>"), 1)
        # sibling of </properties>, not nested inside it
        self.assertLess(text.index("</properties>"), text.index("allowIndexDefinitions"))
        self.assertLess(text.index("</properties>"), text.index("<filters>"))

    def test_write_structure_roots_escapes_ampersand_and_round_trips(self):
        # <root> is element TEXT, not an attribute -- a root containing `&` must be
        # XML-escaped or the whole pom.xml becomes malformed (ET.parse raises).
        d = Path(tempfile.mkdtemp()) / "proj"
        pom = _mk_structure_pom(d)
        SP.write_structure_roots(str(d), _config(), ["/apps", "/apps/a&b"])
        tree = ET.parse(str(pom))  # must not raise ParseError
        roots = {e.text for e in tree.iter() if e.tag.split("}")[-1] == "root"}
        self.assertEqual(roots, {"/apps", "/apps/a&b"})


class Cli(unittest.TestCase):
    def test_main_git_flag_moves_and_exits_zero(self):
        d = Move()._mk_git_proj()
        # main() now also runs split_filters + write_structure_roots, so the CLI
        # fixture needs a scaffolded ui.apps.structure/pom.xml (real archetype-56
        # shape -- see _mk_structure_pom) for main() to write into.
        _mk_structure_pom(d)
        cfg = d / ".modernize/config.json"
        C.save_json(cfg, _config())
        self.assertEqual(SP.main([str(d), "--config", str(cfg), "--git"]), 0)
        self.assertTrue((d / "ui.content/src/main/content/jcr_root/etc/designs/wknd/y.txt").exists())
        _commit_all(d, "split")  # commit the git-mv-staged rename so `log --follow` has history to walk
        self.assertTrue(_git_log_follow(
            d, "ui.content/src/main/content/jcr_root/etc/designs/wknd/y.txt").strip())
        # main() also ran split_filters + write_structure_roots: the source proj
        # here has no filter.xml, so both output filters are empty, but the files
        # must exist and the structure pom must have its <filters/> populated
        # with at least the two fixed seeds (/apps, /apps/wknd).
        self.assertTrue((d / "ui.apps/src/main/content/META-INF/vault/filter.xml").exists())
        self.assertTrue((d / "ui.content/src/main/content/META-INF/vault/filter.xml").exists())
        structure_pom_text = (d / "ui.apps.structure/pom.xml").read_text()
        self.assertIn("<filter><root>/apps</root></filter>", structure_pom_text)
        self.assertIn("<filter><root>/apps/wknd</root></filter>", structure_pom_text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
