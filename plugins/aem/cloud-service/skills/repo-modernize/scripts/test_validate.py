# scripts/test_validate.py
import unittest, tempfile
from pathlib import Path
import validate as V
import rm_common as V_C


class Classify(unittest.TestCase):
    def test_immutable(self):
        for r in ["/apps", "/apps/wknd", "/libs/cq/x", "/oak:index/foo"]:
            self.assertEqual(V.classify_filter_root(r), "immutable", r)

    def test_mutable(self):
        for r in ["/content/wknd", "/etc/designs/wknd", "/conf/x", "/home/users"]:
            self.assertEqual(V.classify_filter_root(r), "mutable", r)

    def test_apps_prefix_not_greedy(self):
        # a path that merely starts with the letters "apps" but not the /apps segment
        self.assertEqual(V.classify_filter_root("/appsuite/x"), "mutable")


def _write_pkg(root, mod, pkg_type, cmt, roots):
    pom = root / mod / "pom.xml"; pom.parent.mkdir(parents=True, exist_ok=True)
    cmt_xml = f"<cloudManagerTarget>{cmt}</cloudManagerTarget>" if cmt else ""
    pom.write_text(f'<project xmlns="http://maven.apache.org/POM/4.0.0">'
                   f'<artifactId>acme.{mod}</artifactId>'
                   f'<build><plugins><plugin><configuration>'
                   f'<packageType>{pkg_type}</packageType>{cmt_xml}'
                   f'</configuration></plugin></plugins></build></project>')
    fx = root / mod / "src/main/content/META-INF/vault/filter.xml"; fx.parent.mkdir(parents=True, exist_ok=True)
    fx.write_text('<workspaceFilter version="1.0">'
                  + "".join(f'<filter root="{r}"/>' for r in roots) + '</workspaceFilter>')


def _write_all(root, embeds):
    pom = root / "all" / "pom.xml"; pom.parent.mkdir(parents=True, exist_ok=True)
    emb = "".join(f"<embedded><artifactId>{a}</artifactId></embedded>" for a in embeds)
    pom.write_text('<project xmlns="http://maven.apache.org/POM/4.0.0">'
                   '<artifactId>acme.all</artifactId>'
                   '<build><plugins><plugin><configuration>'
                   '<packageType>container</packageType>'
                   f'<embeddeds>{emb}</embeddeds>'
                   '</configuration></plugin></plugins></build></project>')


def _config():
    return {"schemaVersion": 1, "projectShape": "SINGLE", "groupId": "com.x", "artifactId": "acme",
            "appId": "acme", "appTitle": "ACME", "version": "1.0.0-SNAPSHOT",
            "targetModules": {"all": "all", "uiApps": "ui.apps", "uiAppsStructure": "ui.apps.structure",
                               "uiConfig": "ui.config", "uiContent": "ui.content"},
            "bundles": [], "testBundles": [], "contentPackages": [], "runModeDecisions": {}}


class Structural(unittest.TestCase):
    def _mk(self):
        d = Path(tempfile.mkdtemp())
        _write_pkg(d, "ui.apps", "application", "none", ["/apps/wknd"])
        _write_pkg(d, "ui.content", "content", "none", ["/content/wknd"])
        _write_pkg(d, "ui.config", "container", "none", ["/apps/acme/osgiconfig"])
        _write_all(d, ["acme.ui.apps", "acme.ui.content", "acme.ui.config"])
        return d

    def test_ui_apps_mutable_root_is_violation(self):
        d = self._mk()
        f = d / "ui.apps/src/main/content/META-INF/vault/filter.xml"
        f.write_text(f.read_text().replace("/apps/wknd", "/etc/designs/wknd"))
        self.assertTrue(any(v.kind == "mutable-in-ui.apps" for v in V.check_structural(str(d), _config())))

    def test_ui_content_immutable_root_is_violation(self):
        d = self._mk()
        f = d / "ui.content/src/main/content/META-INF/vault/filter.xml"
        f.write_text(f.read_text().replace("/content/wknd", "/apps/wknd"))
        self.assertTrue(any(v.kind == "immutable-in-ui.content" for v in V.check_structural(str(d), _config())))

    def test_missing_module_is_violation(self):
        d = self._mk()
        (d / "ui.config/pom.xml").unlink()
        self.assertTrue(any(v.kind == "missing-module" for v in V.check_structural(str(d), _config())))

    def test_clean_project_has_no_structural_violations(self):
        self.assertEqual(V.check_structural(str(self._mk()), _config()), [])

    # --- check_pom_shape is a SEPARATE function; check_structural must not perform this check ---
    # (Ruling: idempotent scaffold retains a legacy ui.apps/ui.content pom's pre-existing
    # shape — no <packageType>, no cloudManagerTarget — when the source content package name
    # already equals the target module name, as in the fixture. Rewriting that shape is
    # Phase-2 `refactor_poms` work, so pom-shape checks live in check_pom_shape, not the
    # Phase-1 check_structural gate. See validate.py module docstring.)

    def test_missing_cloud_manager_target_is_violation(self):
        d = self._mk()
        p = d / "ui.apps/pom.xml"; p.write_text(p.read_text().replace(
            "<cloudManagerTarget>none</cloudManagerTarget>", ""))
        self.assertTrue(any(v.kind == "missing-cloudManagerTarget" for v in V.check_pom_shape(str(d), _config())))
        # and check_structural itself must NOT flag this — pom-shape is excluded from it
        self.assertFalse(any(v.kind == "missing-cloudManagerTarget" for v in V.check_structural(str(d), _config())))

    def test_wrong_packagetype_is_violation(self):
        d = self._mk()
        p = d / "ui.apps/pom.xml"; p.write_text(p.read_text().replace(
            "<packageType>application</packageType>", "<packageType>content</packageType>"))
        self.assertTrue(any(v.kind == "wrong-packageType" for v in V.check_pom_shape(str(d), _config())))
        # and check_structural itself must NOT flag this — pom-shape is excluded from it
        self.assertFalse(any(v.kind == "wrong-packageType" for v in V.check_structural(str(d), _config())))

    def test_pom_shape_clean_has_no_violations(self):
        self.assertEqual(V.check_pom_shape(str(self._mk()), _config()), [])

    def test_pom_shape_skips_missing_module_silently(self):
        # existence is check_structural's job; check_pom_shape must not re-flag it either
        # as wrong-packageType/missing-cloudManagerTarget or as its own missing-module kind.
        d = self._mk()
        (d / "ui.config/pom.xml").unlink()
        self.assertEqual(V.check_pom_shape(str(d), _config()), [])

    # --- check_all_embeds is a SEPARATE function; check_structural must not perform this check ---

    def test_subpackage_not_embedded_in_all_is_violation(self):
        d = self._mk()
        p = d / "all/pom.xml"; p.write_text(p.read_text().replace("acme.ui.content", "acme.NOPE"))
        self.assertTrue(any(v.kind == "not-embedded-in-all" for v in V.check_all_embeds(str(d), _config())))
        # and check_structural itself must NOT flag this — the embed check is excluded from it
        self.assertFalse(any(v.kind == "not-embedded-in-all" for v in V.check_structural(str(d), _config())))

    def test_all_embeds_present_has_no_violations(self):
        self.assertEqual(V.check_all_embeds(str(self._mk()), _config()), [])


class NoLoss(unittest.TestCase):
    def test_moved_file_by_hash_is_ok(self):
        d = Path(tempfile.mkdtemp())
        (d / "old").mkdir(); (d / "old/a.txt").write_text("payload")
        inv = {"files": [{"path": "old/a.txt", "sha256": V_C.sha256_file(d / "old/a.txt")}]}
        (d / "old/a.txt").unlink(); (d / "new").mkdir(); (d / "new/a.txt").write_text("payload")
        self.assertEqual(V.check_no_loss(str(d), inv, _config()), [])

    def test_deleted_content_is_violation(self):
        d = Path(tempfile.mkdtemp()); (d / "a.txt").write_text("payload")
        inv = {"files": [{"path": "a.txt", "sha256": V_C.sha256_file(d / "a.txt")}]}
        (d / "a.txt").unlink()
        self.assertTrue(any(v.kind == "content-lost" for v in V.check_no_loss(str(d), inv, _config())))

    def test_uber_jar_drop_is_exempt(self):
        d = Path(tempfile.mkdtemp())
        inv = {"files": [{"path": "core/target/uber-jar-6.5.jar", "sha256": "deadbeef"}]}
        self.assertEqual(V.check_no_loss(str(d), inv, _config()), [])

    # --- Ruling 4: pom.xml / filter.xml are exempt by basename, not just by substring ---
    # split_content legitimately overwrites a source filter.xml when a source package name
    # equals a target module name (e.g. ui.apps/ui.content), and scaffold/split (re)write
    # module poms. Those rewrites change the file's hash, so the baseline hash won't be
    # found among current files even though nothing was "lost" — existence of the rewritten
    # module poms is guarded separately by check_structural.

    def test_filter_xml_with_unfound_hash_is_exempt_by_basename(self):
        d = Path(tempfile.mkdtemp())
        inv = {"files": [{"path": "ui.apps/src/main/content/META-INF/vault/filter.xml",
                           "sha256": "deadbeef"}]}
        self.assertEqual(V.check_no_loss(str(d), inv, _config()), [])

    def test_pom_xml_with_unfound_hash_is_exempt_by_basename(self):
        d = Path(tempfile.mkdtemp())
        inv = {"files": [{"path": "ui.content/pom.xml", "sha256": "deadbeef"}]}
        self.assertEqual(V.check_no_loss(str(d), inv, _config()), [])

    # --- Phase 2 carve-out: convert_osgi RE-ENCODES a legacy OSGi config file's bytes
    # (sling:OsgiConfig .xml / Felix .config,.cfg -> a freshly-written .cfg.json) on its
    # way out of ui.apps into ui.config — the baseline hash legitimately can't be found
    # afterwards, same false "content-lost" shape EXEMPT_BASENAMES already prevents for
    # pom.xml/filter.xml. See validate.py's _is_reencoded_osgi_config for the exact shape.

    def test_reencoded_sling_osgiconfig_xml_is_exempt(self):
        d = Path(tempfile.mkdtemp())
        inv = {"files": [{
            "path": "ui.apps/src/main/content/jcr_root/apps/wknd/config.qa/"
                    "org.apache.sling.commons.log.LogManager.factory.config-wknd.xml",
            "sha256": "deadbeef"}]}
        self.assertEqual(V.check_no_loss(str(d), inv, _config()), [])

    def test_reencoded_felix_config_file_is_exempt(self):
        d = Path(tempfile.mkdtemp())
        inv = {"files": [{
            "path": "ui.apps/src/main/content/jcr_root/apps/wknd/config/"
                    "com.example.Foo.config",
            "sha256": "deadbeef"}]}
        self.assertEqual(V.check_no_loss(str(d), inv, _config()), [])

    def test_reencoded_felix_cfg_file_is_exempt(self):
        d = Path(tempfile.mkdtemp())
        inv = {"files": [{
            "path": "ui.apps/src/main/content/jcr_root/apps/wknd/config.author/"
                    "com.example.Foo.cfg",
            "sha256": "deadbeef"}]}
        self.assertEqual(V.check_no_loss(str(d), inv, _config()), [])

    def test_repoinit_xml_is_NOT_exempt_verbatim_move_stays_under_watch(self):
        # The repoinit config is relocated byte-for-byte (never re-encoded) — its
        # baseline hash must still be found among current files; an unfound hash here
        # is a REAL content-lost, not a legitimate rewrite, so it must NOT be exempted.
        d = Path(tempfile.mkdtemp())
        inv = {"files": [{
            "path": "ui.apps/src/main/content/jcr_root/apps/wknd/config/"
                    "org.apache.sling.jcr.repoinit.RepositoryInitializer-DistributionService.xml",
            "sha256": "deadbeef"}]}
        self.assertTrue(any(v.kind == "content-lost" for v in V.check_no_loss(str(d), inv, _config())))

    def test_preexisting_cfgjson_is_NOT_exempt_verbatim_move_stays_under_watch(self):
        # An already-.cfg.json source file is moved byte-for-byte (never re-encoded) —
        # same reasoning as the repoinit case above: it must stay under no-loss's watch.
        d = Path(tempfile.mkdtemp())
        inv = {"files": [{
            "path": "ui.apps/src/main/content/jcr_root/apps/testconfig/config.author.stage/"
                    "com.example.Already.cfg.json",
            "sha256": "deadbeef"}]}
        self.assertTrue(any(v.kind == "content-lost" for v in V.check_no_loss(str(d), inv, _config())))

    def test_reencoded_osgi_config_still_requires_hash_when_present(self):
        # The carve-out only excuses an unfound hash; when the file legitimately still
        # exists unchanged (e.g. nothing actually moved it), check_no_loss must not be
        # fooled into thinking a real drop is fine for an unrelated reason -- this test
        # just pins that the exemption is about the PATH SHAPE of the baseline entry,
        # not a global "never check osgi configs" bypass: a matching-shape entry whose
        # hash IS present is obviously fine either way.
        d = Path(tempfile.mkdtemp())
        p = d / "ui.apps/src/main/content/jcr_root/apps/wknd/config.qa"
        p.mkdir(parents=True)
        f = p / "org.apache.sling.commons.log.LogManager.factory.config-wknd.xml"
        f.write_text("<jcr:root/>")
        inv = {"files": [{"path": str(f.relative_to(d)), "sha256": V_C.sha256_file(f)}]}
        self.assertEqual(V.check_no_loss(str(d), inv, _config()), [])

    def test_content_xml_folder_descriptor_is_NOT_exempt(self):
        # move_and_convert explicitly skips a bare .content.xml (the config FOLDER's own
        # FileVault node descriptor, never an OSGi PID file) -- it is left in place,
        # untouched, so its baseline hash must still be found; it is not re-encoded and
        # must not be swept into this carve-out just because it lives in a config*/ dir.
        d = Path(tempfile.mkdtemp())
        inv = {"files": [{
            "path": "ui.apps/src/main/content/jcr_root/apps/wknd/config.qa/.content.xml",
            "sha256": "deadbeef"}]}
        self.assertTrue(any(v.kind == "content-lost" for v in V.check_no_loss(str(d), inv, _config())))

    def test_unrelated_apps_path_is_NOT_exempt(self):
        # A file that merely lives under apps/<app>/ but NOT inside a config*/ folder
        # (e.g. an ordinary component) must never be swept into this carve-out.
        d = Path(tempfile.mkdtemp())
        inv = {"files": [{
            "path": "ui.apps/src/main/content/jcr_root/apps/wknd/components/foo/foo.xml",
            "sha256": "deadbeef"}]}
        self.assertTrue(any(v.kind == "content-lost" for v in V.check_no_loss(str(d), inv, _config())))


class Cli(unittest.TestCase):
    def _mk(self):
        return Structural()._mk()  # reuse the clean-project builder

    def test_clean_exits_zero(self):
        d = self._mk()
        cfg = d / ".modernize/config.json"; V_C.save_json(cfg, _config())
        inv = d / ".modernize/inventory.json"; V_C.save_json(inv, {"files": []})
        self.assertEqual(V.main([str(d), "--config", str(cfg), "--inventory", str(inv)]), 0)

    def test_violation_exits_one(self):
        d = self._mk()
        f = d / "ui.apps/src/main/content/META-INF/vault/filter.xml"
        f.write_text(f.read_text().replace("/apps/wknd", "/etc/designs/wknd"))
        cfg = d / ".modernize/config.json"; V_C.save_json(cfg, _config())
        self.assertEqual(V.main([str(d), "--config", str(cfg), "--structural-only"]), 1)

    # --- Ruling: check_pom_shape is OFF by default in the Phase-1 gate; only
    # --check-pom-shape opts in. Idempotent scaffold retains a legacy ui.apps/ui.content
    # pom's pre-existing shape (no <packageType>, no cloudManagerTarget) when the source
    # content package name already equals the target module name, as in the real fixture —
    # rewriting that shape is Phase-2 `refactor_poms` work, not Phase 1's. See validate.py
    # module docstring / check_pom_shape. ---

    def test_wrong_packagetype_not_gated_by_default(self):
        d = self._mk()
        p = d / "ui.apps/pom.xml"; p.write_text(p.read_text().replace(
            "<packageType>application</packageType>", "<packageType>content</packageType>"))
        cfg = d / ".modernize/config.json"; V_C.save_json(cfg, _config())
        self.assertEqual(V.main([str(d), "--config", str(cfg), "--structural-only"]), 0)

    def test_wrong_packagetype_with_check_pom_shape_flag_exits_one(self):
        d = self._mk()
        p = d / "ui.apps/pom.xml"; p.write_text(p.read_text().replace(
            "<packageType>application</packageType>", "<packageType>content</packageType>"))
        cfg = d / ".modernize/config.json"; V_C.save_json(cfg, _config())
        self.assertEqual(V.main([str(d), "--config", str(cfg), "--structural-only", "--check-pom-shape"]), 1)

    # --- Ruling 3: check_all_embeds is OFF by default in the Phase-1 gate; only
    # --check-embeds opts in (a real legacy `all` pom predates ui.config and
    # legitimately lacks that embed in Phase 1 — see validate.py module docstring). ---

    def test_missing_embed_not_gated_by_default(self):
        d = self._mk()
        p = d / "all/pom.xml"; p.write_text(p.read_text().replace("acme.ui.config", "acme.NOPE"))
        cfg = d / ".modernize/config.json"; V_C.save_json(cfg, _config())
        self.assertEqual(V.main([str(d), "--config", str(cfg), "--structural-only"]), 0)

    def test_missing_embed_with_check_embeds_flag_exits_one(self):
        d = self._mk()
        p = d / "all/pom.xml"; p.write_text(p.read_text().replace("acme.ui.config", "acme.NOPE"))
        cfg = d / ".modernize/config.json"; V_C.save_json(cfg, _config())
        self.assertEqual(V.main([str(d), "--config", str(cfg), "--structural-only", "--check-embeds"]), 1)

    # --- Exit code 2 = usage/IO error, per main()'s docstring. Malformed JSON raises
    # json.JSONDecodeError (a ValueError subclass), which previously escaped a bare
    # `except OSError` and produced an uncaught traceback + exit 1 instead of exit 2. ---

    def test_malformed_json_config_exits_two_not_traceback(self):
        d = self._mk()
        cfg = d / ".modernize/config.json"
        cfg.parent.mkdir(parents=True, exist_ok=True)
        cfg.write_text("{ not json")
        self.assertEqual(V.main([str(d), "--config", str(cfg), "--structural-only"]), 2)

    def test_missing_config_file_exits_two(self):
        d = self._mk()
        cfg = d / ".modernize/does-not-exist.json"
        self.assertEqual(V.main([str(d), "--config", str(cfg), "--structural-only"]), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
