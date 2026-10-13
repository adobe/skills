# scripts/test_convert_osgi.py
import contextlib
import io
import json
import os
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest import mock

import convert_osgi as O

class Values(unittest.TestCase):
    def test_plain_string(self):
        self.assertEqual(O.convert_value("/x"), "/x")
    def test_typed_scalar_hint_stripped(self):        # {Boolean}true -> "true"
        self.assertEqual(O.convert_value("{Boolean}true"), "true")
        self.assertEqual(O.convert_value("{Long}5"), "5")
    def test_array(self):                              # [a,b] -> ["a","b"]
        self.assertEqual(O.convert_value("[wknd/components/page/page]"), ["wknd/components/page/page"])
        self.assertEqual(O.convert_value("[a,b]"), ["a", "b"])
    def test_escaped_comma_in_array(self):             # [a\,b,c] -> ["a,b","c"]
        self.assertEqual(O.convert_value(r"[a\,b,c]"), ["a,b", "c"])
    def test_escaped_brace_unescaped(self):            # \{0,date...} -> {0,date...}
        self.assertEqual(O.convert_value(r"\{0,date,yyyy-MM-dd}"), "{0,date,yyyy-MM-dd}")
    def test_empty_array(self):
        self.assertEqual(O.convert_value("[]"), [])

class RepoInit(unittest.TestCase):
    def test_repoinit_pid(self):
        self.assertTrue(O.is_repoinit_pid("org.apache.sling.jcr.repoinit.RepositoryInitializer-x"))
        self.assertFalse(O.is_repoinit_pid("com.day.cq.wcm.mobile.core.impl.MobileEmulatorProvider-wknd"))

class XmlToCfg(unittest.TestCase):
    def test_mobile_emulator(self):
        import tempfile, os
        d = tempfile.mkdtemp(); p = os.path.join(d, "com.x.MobileEmulatorProvider-wknd.xml")
        open(p,"w").write('<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" '
          'xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="sling:OsgiConfig" '
          'mobile.resourceTypes="[wknd/components/page/page]" README="hi"/>')
        cfg = O.xml_to_cfgjson(p)
        self.assertEqual(cfg["mobile.resourceTypes"], ["wknd/components/page/page"])
        self.assertEqual(cfg["README"], "hi")
        self.assertNotIn("jcr:primaryType", cfg)

    def test_pid_of(self):
        self.assertEqual(O.pid_of("com.x.Foo-bar.xml"), "com.x.Foo-bar")
        self.assertEqual(O.pid_of("com.x.Foo.cfg.json"), "com.x.Foo")

    def test_convert_file_repoinit_moved_verbatim(self):
        import tempfile, os
        d = tempfile.mkdtemp(); dest = tempfile.mkdtemp()
        p = os.path.join(d, "org.apache.sling.jcr.repoinit.RepositoryInitializer-x.xml")
        open(p,"w").write('<jcr:root jcr:primaryType="sling:OsgiConfig" scripts="[create path /x]"/>')
        name, converted = O.convert_file(p, dest)
        self.assertFalse(converted)                                  # repoinit NOT converted
        self.assertTrue(name.endswith(".xml"))
        self.assertTrue(os.path.exists(os.path.join(dest, name)))

    # -- supplementary coverage: pid_of's other two suffixes and the
    #    general (not just-"primaryType") namespace-drop rule + real
    #    convert_value wiring through xml_to_cfgjson. Not in the brief's
    #    illustrative snippet, but required by its prose spec. --------

    def test_pid_of_config_and_cfg_extensions(self):
        self.assertEqual(O.pid_of("com.x.Foo.config"), "com.x.Foo")
        self.assertEqual(O.pid_of("com.x.Foo.cfg"), "com.x.Foo")

    def test_xml_to_cfgjson_drops_any_namespaced_attr_not_just_primarytype(self):
        import tempfile, os
        d = tempfile.mkdtemp(); p = os.path.join(d, "com.x.Foo.xml")
        with open(p, "w") as fh:
            fh.write('<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" '
              'jcr:primaryType="sling:OsgiConfig" jcr:mixinTypes="[mix:lockable]" '
              'plain.key="v"/>')
        cfg = O.xml_to_cfgjson(p)
        self.assertEqual(cfg, {"plain.key": "v"})          # both namespaced attrs dropped

    def test_xml_to_cfgjson_type_hint_scalars(self):
        import tempfile, os
        d = tempfile.mkdtemp(); p = os.path.join(d, "com.x.Bar.xml")
        with open(p, "w") as fh:
            fh.write('<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" '
              'jcr:primaryType="sling:OsgiConfig" enabled="{Boolean}true" count="{Long}5"/>')
        cfg = O.xml_to_cfgjson(p)
        self.assertEqual(cfg["enabled"], "true")
        self.assertEqual(cfg["count"], "5")


class ConvertFileXml(unittest.TestCase):
    def test_regular_osgiconfig_xml_converted_sorted_keys(self):
        import tempfile, os
        d = tempfile.mkdtemp(); dest = tempfile.mkdtemp()
        p = os.path.join(d, "com.x.MobileEmulatorProvider-wknd.xml")
        with open(p, "w") as fh:
            fh.write('<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" '
              'jcr:primaryType="sling:OsgiConfig" '
              'mobile.resourceTypes="[wknd/components/page/page]" README="hi"/>')
        name, converted = O.convert_file(p, dest)
        self.assertTrue(converted)
        self.assertEqual(name, "com.x.MobileEmulatorProvider-wknd.cfg.json")
        with open(os.path.join(dest, name)) as fh:
            text = fh.read()
        self.assertLess(text.index('"README"'), text.index('"mobile.resourceTypes"'))  # sorted keys
        self.assertTrue(os.path.exists(p))          # convert_file never touches the source

    def test_convert_file_repoinit_content_preserved(self):
        import tempfile, os
        d = tempfile.mkdtemp(); dest = tempfile.mkdtemp()
        p = os.path.join(d, "org.apache.sling.jcr.repoinit.RepositoryInitializer-y.xml")
        content = '<jcr:root jcr:primaryType="sling:OsgiConfig" scripts="[create path /y]"/>'
        with open(p, "w") as fh:
            fh.write(content)
        name, converted = O.convert_file(p, dest)
        self.assertFalse(converted)
        with open(os.path.join(dest, name)) as fh:
            self.assertEqual(fh.read(), content)
        self.assertTrue(os.path.exists(p))          # convert_file never touches the source


class FelixConfig(unittest.TestCase):
    def test_config_extension_converted(self):
        import tempfile, os, json
        d = tempfile.mkdtemp(); dest = tempfile.mkdtemp()
        p = os.path.join(d, "com.x.Bar.config")
        with open(p, "w") as fh:
            fh.write("# a comment\n\nfoo=bar\nbaz=[a,b]\nenabled={Boolean}true\n")
        name, converted = O.convert_file(p, dest)
        self.assertTrue(converted)
        self.assertEqual(name, "com.x.Bar.cfg.json")
        with open(os.path.join(dest, name)) as fh:
            cfg = json.load(fh)
        self.assertEqual(cfg, {"foo": "bar", "baz": ["a", "b"], "enabled": "true"})

    def test_cfg_extension_converted(self):
        import tempfile, os, json
        d = tempfile.mkdtemp(); dest = tempfile.mkdtemp()
        p = os.path.join(d, "com.x.Qux.cfg")
        with open(p, "w") as fh:
            fh.write("k=v\n! bang comment\n\n")
        name, converted = O.convert_file(p, dest)
        self.assertTrue(converted)
        self.assertEqual(name, "com.x.Qux.cfg.json")
        with open(os.path.join(dest, name)) as fh:
            cfg = json.load(fh)
        self.assertEqual(cfg, {"k": "v"})


class CfgJsonNoop(unittest.TestCase):
    def test_existing_cfgjson_moved_verbatim(self):
        import tempfile, os
        d = tempfile.mkdtemp(); dest = tempfile.mkdtemp()
        p = os.path.join(d, "com.x.Already.cfg.json")
        content = '{\n  "enabled": "true"\n}\n'
        with open(p, "w") as fh:
            fh.write(content)
        name, converted = O.convert_file(p, dest)
        self.assertFalse(converted)
        self.assertEqual(name, "com.x.Already.cfg.json")
        with open(os.path.join(dest, name)) as fh:
            self.assertEqual(fh.read(), content)
        self.assertTrue(os.path.exists(p))          # convert_file never touches the source


class ConvertFileUnknownExtension(unittest.TestCase):
    def test_unknown_extension_raises(self):
        import tempfile, os
        d = tempfile.mkdtemp(); dest = tempfile.mkdtemp()
        p = os.path.join(d, "com.x.Weird.txt")
        with open(p, "w") as fh:
            fh.write("nope")
        with self.assertRaises(ValueError):
            O.convert_file(p, dest)


# ---------------------------------------------------------------------------
# Task A3: move_and_convert orchestration + main. A fixture-shaped temp
# project mirroring the real wknd-legacy layout (see
# the public aem-guides-wknd sample in its legacy pre-Cloud shape):
# ui.apps/.../apps/wknd/config.author/ (a MobileEmulatorProvider .xml, needs
# conversion) + .../config/ (a repoinit .xml, moved verbatim) + a scaffolded
# (pom-only) ui.config module -- the on-disk state move_and_convert expects
# at the start of the OSGi-segregation step.
# ---------------------------------------------------------------------------

def _build_wknd_project():
    """Build the temp project described above. Returns `(project_dir,
    config)`; `config` is a real (schema-shaped) config.json dict, not a
    trimmed-down stand-in, so this doubles as a check that move_and_convert
    only ever reads the documented `.modernize/config.json` fields."""
    d = Path(tempfile.mkdtemp())

    apps_wknd = d / "ui.apps/src/main/content/jcr_root/apps/wknd"
    cfg_author = apps_wknd / "config.author"
    cfg_author.mkdir(parents=True)
    (cfg_author / "com.day.cq.wcm.mobile.core.impl.MobileEmulatorProvider-wknd.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" '
        'xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="sling:OsgiConfig" '
        'mobile.resourceTypes="[wknd/components/page/page]" '
        'README="Indicate which page resource types should display the mobile emulators."/>\n'
    )

    cfg_plain = apps_wknd / "config"
    cfg_plain.mkdir(parents=True)
    (cfg_plain / "org.apache.sling.jcr.repoinit.RepositoryInitializer-DistributionService.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="sling:OsgiConfig" '
        'scripts="[create path /content/dam/distribution]"/>\n'
    )

    # Non-config content directly under apps/wknd -- this app folder must
    # SURVIVE the move (only a folder emptied down to nothing is removed).
    components = apps_wknd / "components"
    components.mkdir(parents=True)
    (components / "dummy.txt").write_text("keep me\n")

    # ui.config: scaffolded (pom-only) already, like scaffold_modules.py
    # would leave it -- no filter.xml yet, move_and_convert creates it fresh.
    ui_config_pom = d / "ui.config/pom.xml"
    ui_config_pom.parent.mkdir(parents=True)
    ui_config_pom.write_text("<project/>\n")

    config = {
        "schemaVersion": 1, "projectShape": "SINGLE", "appId": "wknd", "appTitle": "WKND",
        "groupId": "com.adobe.aem.guides", "artifactId": "aem-guides-wknd",
        "version": "1.0.0-SNAPSHOT",
        "targetModules": {"all": "all", "uiApps": "ui.apps", "uiAppsStructure": "ui.apps.structure",
                           "uiConfig": "ui.config", "uiContent": "ui.content"},
    }
    return d, config


def _init_git(d, msg="base"):
    subprocess.run(["git", "init", "-q"], cwd=d, check=True)
    subprocess.run(["git", "add", "-A"], cwd=d, check=True)
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                     "commit", "-qm", msg], cwd=d, check=True)


def _filter_roots(filter_xml: Path):
    if not filter_xml.exists():
        return []
    return [e.attrib["root"] for e in ET.parse(str(filter_xml)).iter()
            if e.tag.split("}")[-1] == "filter" and "root" in e.attrib]


class MoveAndConvertWkndFixture(unittest.TestCase):
    def test_move_and_convert_wknd_layout(self):
        d, config = _build_wknd_project()
        _init_git(d)

        findings = O.move_and_convert(str(d), config, use_git=True)

        # MobileEmulatorProvider: converted + relocated, array value intact.
        dest = (d / "ui.config/src/main/content/jcr_root/apps/wknd/osgiconfig/config.author"
                  / "com.day.cq.wcm.mobile.core.impl.MobileEmulatorProvider-wknd.cfg.json")
        self.assertTrue(dest.exists(), f"expected converted config at {dest}")
        with open(dest) as fh:
            cfg = json.load(fh)
        self.assertEqual(cfg["mobile.resourceTypes"], ["wknd/components/page/page"])
        self.assertEqual(cfg["README"],
                          "Indicate which page resource types should display the mobile emulators.")

        # repoinit: relocated but landed as .xml, verbatim (not converted).
        repoinit_dest = (d / "ui.config/src/main/content/jcr_root/apps/wknd/osgiconfig/config"
                           / "org.apache.sling.jcr.repoinit.RepositoryInitializer-DistributionService.xml")
        self.assertTrue(repoinit_dest.exists())
        self.assertIn('jcr:primaryType="sling:OsgiConfig"', repoinit_dest.read_text())
        self.assertIn("scripts=", repoinit_dest.read_text())

        # ui.config filter gained exactly the one fixed root.
        filt = d / "ui.config/src/main/content/META-INF/vault/filter.xml"
        self.assertEqual(_filter_roots(filt), ["/apps/wknd/osgiconfig"])

        # source config* folders are gone from ui.apps.
        self.assertFalse((d / "ui.apps/src/main/content/jcr_root/apps/wknd/config.author").exists())
        self.assertFalse((d / "ui.apps/src/main/content/jcr_root/apps/wknd/config").exists())

        # apps/wknd itself still exists -- non-config content (components/) remains.
        self.assertTrue((d / "ui.apps/src/main/content/jcr_root/apps/wknd").is_dir())
        self.assertTrue((d / "ui.apps/src/main/content/jcr_root/apps/wknd/components/dummy.txt").exists())

        # a NORMAL finding notes the repoinit file was left unconverted.
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0].priority, "NORMAL")
        self.assertIn("repoinit", findings[0].detail.lower())

    def test_git_history_preserved_for_verbatim_move(self):
        """`git log --follow` on the relocated repoinit file bridges back to
        the pre-move commit -- proves the git-mv relocation is a real,
        history-preserving rename, not a delete+add. (The XML -> .cfg.json
        CONTENT-converted case is not asserted this way: empirically, git's
        own rename/similarity heuristic does not bridge that format change
        even when the relocation itself used `git mv` -- verified by hand
        for this exact fixture file, at every `-M` threshold down to 1% --
        which is an inherent git limitation given the tiny file size and the
        wholesale XML->JSON reformat, not a defect in `move_and_convert`;
        see the Task A3 report. The brief's own wording anticipates this
        ambiguity ("if practical") -- the repoinit file is where it IS
        practical, because its content is untouched (100% similarity).)"""
        d, config = _build_wknd_project()
        _init_git(d)

        O.move_and_convert(str(d), config, use_git=True)
        subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                         "commit", "-qm", "convert"], cwd=d, check=True)

        repoinit_dest = ("ui.config/src/main/content/jcr_root/apps/wknd/osgiconfig/config/"
                          "org.apache.sling.jcr.repoinit.RepositoryInitializer-DistributionService.xml")
        log = subprocess.run(["git", "log", "--follow", "--oneline", "--", repoinit_dest],
                              cwd=d, check=True, capture_output=True, text=True).stdout
        self.assertIn("base", log)     # history crosses the rename back to the pre-move commit
        self.assertIn("convert", log)
        self.assertEqual(len(log.strip().splitlines()), 2)

    def test_move_and_convert_no_git_fallback(self):
        """`use_git=False` -- copy-then-remove, no git repo required at all."""
        d, config = _build_wknd_project()

        O.move_and_convert(str(d), config, use_git=False)

        dest = (d / "ui.config/src/main/content/jcr_root/apps/wknd/osgiconfig/config.author"
                  / "com.day.cq.wcm.mobile.core.impl.MobileEmulatorProvider-wknd.cfg.json")
        with open(dest) as fh:
            cfg = json.load(fh)
        self.assertEqual(cfg["mobile.resourceTypes"], ["wknd/components/page/page"])
        self.assertFalse((d / "ui.apps/src/main/content/jcr_root/apps/wknd/config.author").exists())
        self.assertEqual(_filter_roots(d / "ui.config/src/main/content/META-INF/vault/filter.xml"),
                          ["/apps/wknd/osgiconfig"])


class ConfigPrefixMatchingAndContentXml(unittest.TestCase):
    def test_configuration_prefix_matches_content_xml_skipped_non_config_untouched(self):
        d = Path(tempfile.mkdtemp())
        apps_x = d / "ui.apps/src/main/content/jcr_root/apps/x"

        # "configuration" starts with "config" -- CAM Sec.6.2's documented
        # (loose, not-a-runmode-allowlist) match.
        conf = apps_x / "configuration"
        conf.mkdir(parents=True)
        (conf / "com.x.Foo.cfg").write_text("k=v\n")
        (conf / ".content.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="sling:Folder"/>\n')

        # "settings" does NOT start with "config" -- left completely alone.
        settings = apps_x / "settings"
        settings.mkdir(parents=True)
        (settings / "keep.txt").write_text("untouched\n")

        (d / "ui.config").mkdir(parents=True)
        config = {"appId": "x", "targetModules": {"uiApps": "ui.apps", "uiConfig": "ui.config"}}

        findings = O.move_and_convert(str(d), config, use_git=False)

        dest = d / "ui.config/src/main/content/jcr_root/apps/x/osgiconfig/configuration/com.x.Foo.cfg.json"
        self.assertTrue(dest.exists())
        self.assertEqual(findings, [])

        # .content.xml (the folder's own FileVault node descriptor) was
        # skipped -- left in place, never treated as an OSGi PID file.
        self.assertTrue((conf / ".content.xml").exists())
        self.assertFalse((conf / "com.x.Foo.cfg").exists())  # the real PID file DID move
        self.assertTrue(conf.is_dir())     # not removed -- .content.xml still occupies it

        # "settings" untouched.
        self.assertTrue((settings / "keep.txt").exists())
        self.assertFalse((d / "ui.config/src/main/content/jcr_root/apps/x/osgiconfig/settings").exists())


class EnsureFilterRoot(unittest.TestCase):
    def test_creates_fresh_file(self):
        d = Path(tempfile.mkdtemp())
        filt = d / "ui.config/src/main/content/META-INF/vault/filter.xml"
        changed = O.ensure_filter_root(filt, "/apps/wknd/osgiconfig")
        self.assertTrue(changed)
        self.assertEqual(_filter_roots(filt), ["/apps/wknd/osgiconfig"])

    def test_does_not_duplicate_when_already_present(self):
        d = Path(tempfile.mkdtemp())
        filt = d / "ui.config/src/main/content/META-INF/vault/filter.xml"
        O.ensure_filter_root(filt, "/apps/wknd/osgiconfig")
        changed_again = O.ensure_filter_root(filt, "/apps/wknd/osgiconfig")
        self.assertFalse(changed_again)
        self.assertEqual(_filter_roots(filt), ["/apps/wknd/osgiconfig"])   # still exactly one

    def test_preserves_other_pre_existing_roots(self):
        d = Path(tempfile.mkdtemp())
        filt = d / "ui.config/src/main/content/META-INF/vault/filter.xml"
        O.ensure_filter_root(filt, "/apps/other/thing")
        O.ensure_filter_root(filt, "/apps/wknd/osgiconfig")
        self.assertEqual(_filter_roots(filt), ["/apps/other/thing", "/apps/wknd/osgiconfig"])


class MainCli(unittest.TestCase):
    def test_main_runs_and_returns_zero(self):
        import rm_common as C
        d, config = _build_wknd_project()
        cfg_path = d / ".modernize/config.json"
        C.save_json(cfg_path, config)

        rc = O.main([str(d), "--config", str(cfg_path)])

        self.assertEqual(rc, 0)
        dest = (d / "ui.config/src/main/content/jcr_root/apps/wknd/osgiconfig/config.author"
                  / "com.day.cq.wcm.mobile.core.impl.MobileEmulatorProvider-wknd.cfg.json")
        self.assertTrue(dest.exists())
        self.assertEqual(_filter_roots(d / "ui.config/src/main/content/META-INF/vault/filter.xml"),
                          ["/apps/wknd/osgiconfig"])


# ---------------------------------------------------------------------------
# Task A4 (CAM parity): flag_noncloud_runmodes -- detect-and-flag only. The skill
# relocates run-mode folders verbatim and raises RM-108 for any non-Cloud folder,
# exactly like CAM; it never renames/merges (which would risk losing configs when
# two conflicting run modes -- e.g. config.test + config.preprod -- collapse).
# ---------------------------------------------------------------------------


class IsCloudRunmodeFolder(unittest.TestCase):
    def test_valid_folders(self):
        for name in ("config", "config.author", "config.publish", "config.dev",
                      "config.stage", "config.prod", "config.author.dev",
                      "config.publish.prod", "config.author.stage"):
            self.assertTrue(O._is_cloud_runmode_folder(name), name)

    def test_invalid_folders(self):
        for name in ("config.test", "config.preprod", "config.qa", "config.dev2",
                      "config.test2", "config.preprod2", "config.author.test",
                      "config.author.preprod", "config.publish.local",
                      "config.publish.test", "configfoo", "notconfig"):
            self.assertFalse(O._is_cloud_runmode_folder(name), name)

    def test_wrong_order_env_before_service_is_invalid(self):
        # CAM parity (verified against the real initech report): a
        # `config.<environment>.<service>` folder (environment BEFORE service) is
        # flagged RM-108, even though both tokens are individually valid. Also two
        # services / two environments / 3+ tokens are invalid.
        for name in ("config.prod.author", "config.dev.publish", "config.stage.author",
                      "config.prod.publish", "config.stage.publish", "config.dev.author",
                      "config.author.publish", "config.dev.prod", "config.author.dev.prod"):
            self.assertFalse(O._is_cloud_runmode_folder(name), name)
        # ...and the correct order stays valid
        for name in ("config.author.prod", "config.publish.dev", "config.author.stage"):
            self.assertTrue(O._is_cloud_runmode_folder(name), name)


class FlagNoncloudRunmodes(unittest.TestCase):
    def _cfg(self):
        return {"appId": "wknd",
                "targetModules": {"all": "all", "uiApps": "ui.apps",
                                   "uiAppsStructure": "ui.apps.structure",
                                   "uiConfig": "ui.config", "uiContent": "ui.content"}}

    def test_returns_empty_when_no_osgiconfig_dir(self):
        d = Path(tempfile.mkdtemp())
        self.assertEqual(O.flag_noncloud_runmodes(str(d), self._cfg()), [])

    def test_flags_only_noncloud_folders_deduped_and_preserves_all(self):
        d = Path(tempfile.mkdtemp())
        base = d / "ui.config/src/main/content/jcr_root/apps/wknd/osgiconfig"
        for name in ("config", "config.author", "config.prod",   # valid -> not flagged
                      "config.test", "config.preprod", "config.author.test"):  # invalid
            (base / name).mkdir(parents=True)
        findings = O.flag_noncloud_runmodes(str(d), self._cfg())
        codes = {f.code for f in findings}
        flagged = sorted(f.detail.split("'")[1] for f in findings)
        self.assertEqual(codes, {"RM-108"})
        self.assertTrue(all(f.priority == "HIGH" for f in findings))
        self.assertEqual(flagged, ["config.author.test", "config.preprod", "config.test"])
        # every folder still exists on disk -- detect-only, nothing renamed/merged/lost
        for name in ("config", "config.author", "config.prod",
                      "config.test", "config.preprod", "config.author.test"):
            self.assertTrue((base / name).is_dir(), name)


class MainCliRunmodeFlag(unittest.TestCase):
    def test_main_flags_noncloud_runmode_and_preserves_it(self):
        import rm_common as C
        d = Path(tempfile.mkdtemp())
        # a legacy non-Cloud run-mode folder with one OSGi config
        cfgdir = d / "ui.apps/src/main/content/jcr_root/apps/wknd/config.test"
        cfgdir.mkdir(parents=True)
        (cfgdir / "com.example.Foo.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" '
            'xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="sling:OsgiConfig" '
            'k="v"/>\n')
        (d / "ui.config/pom.xml").parent.mkdir(parents=True)
        (d / "ui.config/pom.xml").write_text("<project/>\n")
        config = {"appId": "wknd",
                  "targetModules": {"all": "all", "uiApps": "ui.apps",
                                     "uiAppsStructure": "ui.apps.structure",
                                     "uiConfig": "ui.config", "uiContent": "ui.content"}}
        cfg_path = d / ".modernize/config.json"
        C.save_json(cfg_path, config)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = O.main([str(d), "--config", str(cfg_path)])
        out = buf.getvalue()
        self.assertEqual(rc, 0)
        self.assertIn("RM-108", out)
        # the config was relocated to ui.config under its ORIGINAL run-mode name
        self.assertTrue((d / "ui.config/src/main/content/jcr_root/apps/wknd/osgiconfig"
                          / "config.test/com.example.Foo.cfg.json").exists())


class MoveAndConvertNestedRunmodes(unittest.TestCase):
    """Regression for the recursive `config*` scan: run-mode OSGi config folders
    nested under an intermediate grouping dir (e.g. `apps/<app>/runmodes/config*`,
    as the acme-portal real project lays them out) must still be found, converted,
    and relocated -- and a structural JCR node merely NAMED `config` (only a
    `.content.xml`, no OSGi PID file) must NOT be mistaken for one."""

    def _build(self):
        d = Path(tempfile.mkdtemp())
        base = d / "ui.apps/src/main/content/jcr_root/apps/digital"
        # nested run-mode folders under an intermediate `runmodes/` dir (no
        # .content.xml, so they empty out and the intermediate prunes -- exactly
        # like the acme-portal real project)
        (base / "runmodes/config").mkdir(parents=True)
        (base / "runmodes/config/com.example.Service.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" '
            'xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="sling:OsgiConfig" '
            'size="{Long}5"/>\n')
        (base / "runmodes/config.author").mkdir(parents=True)
        (base / "runmodes/config.author/com.example.Author.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" '
            'xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="sling:OsgiConfig" '
            'enabled="{Boolean}true"/>\n')
        # DECOY: a component child node literally named `config`, only a .content.xml.
        decoy = base / "components/foo/config"
        decoy.mkdir(parents=True)
        decoy.joinpath(".content.xml").write_text(
            '<?xml version="1.0"?><jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" '
            'jcr:primaryType="nt:unstructured"/>\n')
        (d / "ui.config/pom.xml").parent.mkdir(parents=True)
        (d / "ui.config/pom.xml").write_text("<project/>\n")
        config = {
            "schemaVersion": 1, "projectShape": "SINGLE", "appId": "acme-portal",
            "appTitle": "Acme", "groupId": "com.example.acme", "artifactId": "acme-portal",
            "version": "3.2.69-SNAPSHOT",
            "targetModules": {"all": "all", "uiApps": "ui.apps",
                               "uiAppsStructure": "ui.apps.structure",
                               "uiConfig": "ui.config", "uiContent": "ui.content"},
        }
        return d, config

    def test_nested_runmode_configs_found_converted_and_intermediate_pruned(self):
        d, config = self._build()
        _init_git(d)
        O.move_and_convert(str(d), config, use_git=True)

        osgi = d / "ui.config/src/main/content/jcr_root/apps/acme-portal/osgiconfig"
        # both nested run-mode configs converted + relocated (intermediate `runmodes/`
        # dropped from the destination path, exactly as CAM does)
        svc = osgi / "config/com.example.Service.cfg.json"
        author = osgi / "config.author/com.example.Author.cfg.json"
        self.assertTrue(svc.exists(), f"missing {svc}")
        self.assertTrue(author.exists(), f"missing {author}")
        self.assertEqual(json.load(open(svc))["size"], "5")        # {Long} hint stripped
        self.assertEqual(json.load(open(author))["enabled"], "true")  # {Boolean} hint stripped

        # source config* folders AND the now-empty intermediate `runmodes/` are pruned
        self.assertFalse((d / "ui.apps/src/main/content/jcr_root/apps/digital/runmodes").exists())

        # DECOY component `config` node (only .content.xml) is untouched -- never moved
        self.assertTrue((d / "ui.apps/src/main/content/jcr_root/apps/digital/components/foo/config"
                          / ".content.xml").exists())
        self.assertFalse((osgi / "config/.content.xml").exists())  # decoy did NOT leak in


class MoveAndConvertMultiAppGlobex(unittest.TestCase):
    """Regression for the multi-app/multi-brand globex shape: a frontend
    clientlib `config` folder holding only `.scss` must be SKIPPED (not crash
    `_plan_move`), and the SAME PID copied under two different app subtrees must
    be DEDUPED when identical (RM-906 NORMAL) / flagged when it conflicts (HIGH)."""

    def _cfg(self):
        return {"schemaVersion": 1, "projectShape": "SINGLE", "appId": "globex",
                "appTitle": "Globex", "groupId": "com.globex", "artifactId": "globex",
                "version": "1.0-SNAPSHOT",
                "targetModules": {"all": "all", "uiApps": "ui.apps",
                                   "uiAppsStructure": "ui.apps.structure",
                                   "uiConfig": "ui.config", "uiContent": "ui.content"}}

    def _osgi(self, val):
        return ('<?xml version="1.0" encoding="UTF-8"?>\n'
                '<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" '
                'xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="sling:OsgiConfig" '
                f'k="{val}"/>\n')

    def test_scss_config_folder_skipped_and_identical_pid_deduped(self):
        d = Path(tempfile.mkdtemp())
        apps = d / "ui.apps/src/main/content/jcr_root/apps"
        # frontend clientlib config folder: ONLY scss -> must be skipped, not crash
        scss = apps / "globex/components/clientlib/toplib/styles/config"
        scss.mkdir(parents=True)
        (scss / "_constants.scss").write_text("$x: 1;\n")
        # same PID under two brand apps, IDENTICAL content -> dedup
        (apps / "app-a/config").mkdir(parents=True)
        (apps / "app-a/config/com.x.Foo.config.xml").write_text(self._osgi("same"))
        (apps / "app-b/config").mkdir(parents=True)
        (apps / "app-b/config/com.x.Foo.config.xml").write_text(self._osgi("same"))
        (d / "ui.config/pom.xml").parent.mkdir(parents=True)
        (d / "ui.config/pom.xml").write_text("<project/>\n")
        _init_git(d)

        findings = O.move_and_convert(str(d), self._cfg(), use_git=True)

        # scss left in place, never relocated
        self.assertTrue((scss / "_constants.scss").exists())
        # one converted config landed; the duplicate was deduped (RM-906 NORMAL)
        dest = d / "ui.config/src/main/content/jcr_root/apps/globex/osgiconfig/config/com.x.Foo.config.cfg.json"
        self.assertTrue(dest.exists())
        dedup = [f for f in findings if f.code == "RM-906" and f.priority == "NORMAL"]
        self.assertEqual(len(dedup), 1)

    def test_conflicting_pid_flagged_high_and_left_in_place(self):
        d = Path(tempfile.mkdtemp())
        apps = d / "ui.apps/src/main/content/jcr_root/apps"
        # same PID under two app subtrees with DIFFERENT content. Folders are scanned in
        # sorted order, so `app-a` is relocated first and `app-b` (the later one) is the
        # conflicting source left in place.
        (apps / "app-a/config").mkdir(parents=True)
        (apps / "app-a/config/com.x.Foo.config.xml").write_text(self._osgi("A"))
        (apps / "app-b/config").mkdir(parents=True)
        (apps / "app-b/config/com.x.Foo.config.xml").write_text(self._osgi("B"))  # DIFFERENT
        (d / "ui.config/pom.xml").parent.mkdir(parents=True)
        (d / "ui.config/pom.xml").write_text("<project/>\n")
        _init_git(d)

        findings = O.move_and_convert(str(d), self._cfg(), use_git=True)

        conflict = [f for f in findings if f.code == "RM-906" and f.priority == "HIGH"]
        self.assertEqual(len(conflict), 1)
        # the conflicting second source is left in place (not overwritten/lost)
        self.assertTrue((apps / "app-b/config/com.x.Foo.config.xml").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
