#!/usr/bin/env python3
"""
Test suite for restructure_runmodes.py.

Builds synthetic AEM project trees in a temp dir and exercises every
classification branch, the planner's PID-collision detection, and the
apply/verify round-trip. Pure stdlib unittest; run with:

    python3 test_restructure_runmodes.py -v
"""
from __future__ import annotations

import json
import os
import random
import tempfile
import unittest
from pathlib import Path

import restructure_runmodes as rr


def touch(path: Path, content: str = "{}") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


class ClassifyTests(unittest.TestCase):
    def test_bare_config_valid(self):
        f = rr.classify("config")
        self.assertEqual(f.status, rr.VALID)
        self.assertEqual(f.target_name, "config")

    def test_single_service_valid(self):
        for name in ("config.author", "config.publish"):
            self.assertEqual(rr.classify(name).status, rr.VALID, name)

    def test_single_env_valid(self):
        for name in ("config.dev", "config.stage", "config.prod"):
            self.assertEqual(rr.classify(name).status, rr.VALID, name)

    def test_service_then_env_valid(self):
        for name in ("config.author.dev", "config.author.prod",
                     "config.publish.stage", "config.publish.prod"):
            self.assertEqual(rr.classify(name).status, rr.VALID, name)

    def test_reorder_env_before_service(self):
        f = rr.classify("config.prod.author")
        self.assertEqual(f.status, rr.REORDER)
        self.assertEqual(f.target_name, "config.author.prod")

    def test_reorder_dev_author(self):
        f = rr.classify("config.dev.author")
        self.assertEqual(f.status, rr.REORDER)
        self.assertEqual(f.target_name, "config.author.dev")

    def test_two_services_invalid_combo(self):
        f = rr.classify("config.author.publish")
        self.assertEqual(f.status, rr.INVALID_COMBO)
        self.assertIsNone(f.target_name)

    def test_two_envs_invalid_combo(self):
        f = rr.classify("config.dev.stage")
        self.assertEqual(f.status, rr.INVALID_COMBO)

    def test_unsupported_no_mapping(self):
        f = rr.classify("config.qa")
        self.assertEqual(f.status, rr.UNSUPPORTED)
        self.assertEqual(f.unknown_tokens, ["qa"])
        self.assertIsNone(f.target_name)  # needs a mapping

    def test_unsupported_with_mapping(self):
        f = rr.classify("config.qa", {"qa": "stage"})
        self.assertEqual(f.status, rr.UNSUPPORTED)
        self.assertEqual(f.target_name, "config.stage")

    def test_unsupported_service_plus_custom(self):
        f = rr.classify("config.author.uat", {"uat": "stage"})
        self.assertEqual(f.target_name, "config.author.stage")

    def test_unsupported_drop_token(self):
        f = rr.classify("config.author.local", {"local": "drop"})
        self.assertEqual(f.target_name, "config.author")

    def test_unsupported_drop_empty(self):
        f = rr.classify("config.local", {"local": ""})
        self.assertEqual(f.target_name, "config")

    def test_mapping_to_invalid_combo(self):
        # custom token maps to a second env -> invalid combination, no target
        f = rr.classify("config.prod.uat", {"uat": "stage"})
        self.assertEqual(f.status, rr.UNSUPPORTED)
        self.assertIsNone(f.target_name)

    def test_preview_mapped_to_publish(self):
        f = rr.classify("config.preview", {"preview": "publish"})
        self.assertEqual(f.target_name, "config.publish")


class ScanAndPlanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        base = self.root / "ui.config/src/main/content/jcr_root/apps/myco"
        # valid folders
        touch(base / "config" / "com.myco.A.cfg.json")
        touch(base / "config.author" / "com.myco.B.cfg.json")
        touch(base / "config.author.prod" / "com.myco.C.cfg.json")
        # reorder
        touch(base / "config.prod.author" / "com.myco.D.cfg.json")
        # unsupported (custom run modes)
        touch(base / "config.qa" / "com.myco.E.cfg.json")
        touch(base / "config.author.uat" / "com.myco.F.cfg.json")
        # invalid combo
        touch(base / "config.author.publish" / "com.myco.G.cfg.json")
        self.base = base

    def tearDown(self):
        self.tmp.cleanup()

    def test_scan_counts(self):
        findings = rr.scan(self.root, {"qa": "stage", "uat": "stage"})
        by_status = {}
        for f in findings:
            by_status.setdefault(f.status, []).append(f.name)
        self.assertEqual(len(by_status[rr.VALID]), 3)
        self.assertEqual(by_status[rr.REORDER], ["config.prod.author"])
        self.assertEqual(sorted(by_status[rr.UNSUPPORTED]),
                         ["config.author.uat", "config.qa"])
        self.assertEqual(by_status[rr.INVALID_COMBO], ["config.author.publish"])

    def test_plan_actions(self):
        findings = rr.scan(self.root, {"qa": "stage", "uat": "stage"})
        actions = rr.build_plan(findings)
        targets = {Path(a.source).name: Path(a.target).name for a in actions}
        self.assertEqual(targets["config.prod.author"], "config.author.prod")
        self.assertEqual(targets["config.qa"], "config.stage")
        self.assertEqual(targets["config.author.uat"], "config.author.stage")
        # invalid combo is NOT in the action list
        self.assertNotIn("config.author.publish", targets)

    def test_unmapped_unsupported_no_action(self):
        findings = rr.scan(self.root, {})  # no mapping supplied
        actions = rr.build_plan(findings)
        names = {Path(a.source).name for a in actions}
        self.assertNotIn("config.qa", names)
        self.assertNotIn("config.author.uat", names)
        # reorder still actionable without any mapping
        self.assertIn("config.prod.author", names)


class CollisionTests(unittest.TestCase):
    """config.prod.author merges into existing config.author.prod -> PID clash."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        base = self.root / "apps/myco"
        touch(base / "config.author.prod" / "com.myco.Same.cfg.json", '{"x":1}')
        touch(base / "config.author.prod" / "com.myco.OnlyInTarget.cfg.json")
        touch(base / "config.prod.author" / "com.myco.Same.cfg.json", '{"x":2}')
        touch(base / "config.prod.author" / "com.myco.OnlyInSource.cfg.json")
        self.base = base

    def tearDown(self):
        self.tmp.cleanup()

    def test_collision_detected_in_plan(self):
        findings = rr.scan(self.root)
        actions = rr.build_plan(findings)
        merge = [a for a in actions if a.kind == "merge"]
        self.assertEqual(len(merge), 1)
        self.assertEqual(merge[0].conflicts, ["com.myco.Same.cfg.json"])

    def test_apply_skips_collider_moves_rest(self):
        # apply_plan (library level) moves non-colliding files and skips the
        # colliding PID without clobbering. The all-or-nothing refusal is the
        # CLI's job (cmd_apply), exercised in CliApplyGateTests below.
        findings = rr.scan(self.root)
        actions = rr.build_plan(findings)
        changed, errors = rr.apply_plan(actions, use_git=False)
        self.assertTrue(any("PID collision" in e for e in errors))
        # colliding PID preserved on BOTH sides, never overwritten
        self.assertTrue((self.base / "config.prod.author" / "com.myco.Same.cfg.json").exists())
        self.assertEqual((self.base / "config.author.prod" / "com.myco.Same.cfg.json").read_text(),
                         '{"x":1}')  # target value intact
        # the non-colliding source file did get merged in
        self.assertTrue((self.base / "config.author.prod" / "com.myco.OnlyInSource.cfg.json").exists())

    def test_cli_apply_refuses_collision_no_move(self):
        # Without --allow-conflicts the CLI must refuse entirely (rc 2, nothing moved).
        rc = rr.main(["apply", str(self.root)])
        self.assertEqual(rc, 2)
        self.assertTrue((self.base / "config.prod.author" / "com.myco.Same.cfg.json").exists())
        self.assertTrue((self.base / "config.prod.author" / "com.myco.OnlyInSource.cfg.json").exists())
        self.assertFalse((self.base / "config.author.prod" / "com.myco.OnlyInSource.cfg.json").exists())

    def test_cli_allow_conflicts_moves_noncolliders(self):
        rc = rr.main(["apply", str(self.root), "--allow-conflicts"])
        self.assertEqual(rc, 0)
        # non-colliding file merged; collider left, target copy intact
        self.assertTrue((self.base / "config.author.prod" / "com.myco.OnlyInSource.cfg.json").exists())
        self.assertEqual((self.base / "config.author.prod" / "com.myco.Same.cfg.json").read_text(),
                         '{"x":1}')


class ApplyVerifyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        base = self.root / "apps/myco"
        touch(base / "config.prod.author" / "com.myco.D.cfg.json")   # reorder
        touch(base / "config.qa" / "com.myco.E.cfg.json")            # unsupported
        touch(base / "config.author" / "com.myco.B.cfg.json")        # valid, untouched
        self.base = base

    def tearDown(self):
        self.tmp.cleanup()

    def test_apply_renames_and_merges(self):
        mapping = {"qa": "stage"}
        findings = rr.scan(self.root, mapping)
        actions = rr.build_plan(findings)
        changed, errors = rr.apply_plan(actions, use_git=False)
        self.assertEqual(errors, [])
        self.assertEqual(changed, 2)
        # reorder produced a fresh folder
        self.assertTrue((self.base / "config.author.prod" / "com.myco.D.cfg.json").exists())
        self.assertFalse((self.base / "config.prod.author").exists())
        # unsupported mapped to config.stage
        self.assertTrue((self.base / "config.stage" / "com.myco.E.cfg.json").exists())
        self.assertFalse((self.base / "config.qa").exists())
        # valid folder untouched
        self.assertTrue((self.base / "config.author" / "com.myco.B.cfg.json").exists())

    def test_verify_clean_after_apply(self):
        mapping = {"qa": "stage"}
        actions = rr.build_plan(rr.scan(self.root, mapping))
        rr.apply_plan(actions, use_git=False)
        # re-scan with same mapping -> nothing fixable remains
        findings = rr.scan(self.root, mapping)
        bad = [f for f in findings if f.status in (rr.UNSUPPORTED, rr.REORDER, rr.INVALID_COMBO)]
        self.assertEqual(bad, [])


class ContentXmlTests(unittest.TestCase):
    """.content.xml is a shared sling:Folder marker, never a PID collision."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.base = self.root / "apps/myco"
        marker = '<?xml version="1.0"?><jcr:root jcr:primaryType="sling:Folder"/>'
        # target already exists with its own marker + a distinct PID
        touch(self.base / "config.author.prod" / ".content.xml", marker)
        touch(self.base / "config.author.prod" / "com.myco.Target.cfg.json")
        # source reorders into it, also has a marker + a distinct PID
        touch(self.base / "config.prod.author" / ".content.xml", marker)
        touch(self.base / "config.prod.author" / "com.myco.Source.cfg.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_marker_not_a_collision(self):
        findings = rr.scan(self.root)
        actions = rr.build_plan(findings)
        merge = [a for a in actions if a.kind == "merge"]
        self.assertEqual(len(merge), 1)
        self.assertEqual(merge[0].conflicts, [])  # .content.xml must NOT be flagged

    def test_merge_drops_source_marker_keeps_payload(self):
        actions = rr.build_plan(rr.scan(self.root))
        changed, errors = rr.apply_plan(actions, use_git=False)
        self.assertEqual(errors, [])
        self.assertEqual(changed, 1)
        tgt = self.base / "config.author.prod"
        self.assertTrue((tgt / "com.myco.Target.cfg.json").exists())
        self.assertTrue((tgt / "com.myco.Source.cfg.json").exists())  # moved in
        self.assertTrue((tgt / ".content.xml").exists())               # target's kept
        self.assertFalse((self.base / "config.prod.author").exists())  # source gone


class SubfolderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.base = self.root / "apps/myco"
        touch(self.base / "config.author.prod" / "com.myco.T.cfg.json")
        touch(self.base / "config.prod.author" / "com.myco.S.cfg.json")
        touch(self.base / "config.prod.author" / "nested" / "weird.txt")

    def tearDown(self):
        self.tmp.cleanup()

    def test_subfolder_left_with_error(self):
        actions = rr.build_plan(rr.scan(self.root))
        changed, errors = rr.apply_plan(actions, use_git=False)
        # payload moved, but the unexpected subfolder is reported and source kept
        self.assertTrue(any("subfolder" in e for e in errors))
        self.assertTrue((self.base / "config.author.prod" / "com.myco.S.cfg.json").exists())
        self.assertTrue((self.base / "config.prod.author" / "nested").exists())


class GitMvTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        import subprocess
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.email", "t@t"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.name", "t"], cwd=self.root, check=True)
        touch(self.root / "apps/myco/config.prod.author/com.myco.D.cfg.json")
        subprocess.run(["git", "add", "-A"], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "init"], cwd=self.root, check=True)

    def tearDown(self):
        self.tmp.cleanup()

    def test_git_mv_rename(self):
        actions = rr.build_plan(rr.scan(self.root))
        changed, errors = rr.apply_plan(actions, use_git=True)
        self.assertEqual(errors, [])
        self.assertTrue((self.root / "apps/myco/config.author.prod"
                         / "com.myco.D.cfg.json").exists())
        import subprocess
        # git should see a rename (tracked), not an untracked add
        out = subprocess.run(["git", "status", "--porcelain"], cwd=self.root,
                             capture_output=True, text=True).stdout
        self.assertIn("R", out.split("\n")[0][:2] + "".join(l[:2] for l in out.split("\n")))


class TwoSourcesOneTargetTests(unittest.TestCase):
    """config.qa and config.uat both map to config.stage (which does not exist yet)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.base = self.root / "apps/myco"
        touch(self.base / "config.qa" / ".content.xml", "marker")
        touch(self.base / "config.qa" / "com.myco.FromQa.cfg.json")
        touch(self.base / "config.uat" / ".content.xml", "marker")
        touch(self.base / "config.uat" / "com.myco.FromUat.cfg.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_plan_marks_second_as_merge(self):
        findings = rr.scan(self.root, {"qa": "stage", "uat": "stage"})
        actions = rr.build_plan(findings)
        self.assertEqual(len(actions), 2)
        kinds = sorted(a.kind for a in actions)
        self.assertEqual(kinds, ["merge", "rename"])
        self.assertTrue(all(a.target.endswith("config.stage") for a in actions))

    def test_apply_merges_both_no_loss(self):
        mapping = {"qa": "stage", "uat": "stage"}
        actions = rr.build_plan(rr.scan(self.root, mapping))
        changed, errors = rr.apply_plan(actions, use_git=False)
        self.assertEqual(errors, [])
        stage = self.base / "config.stage"
        self.assertTrue((stage / "com.myco.FromQa.cfg.json").exists())
        self.assertTrue((stage / "com.myco.FromUat.cfg.json").exists())  # not lost
        self.assertFalse((self.base / "config.qa").exists())
        self.assertFalse((self.base / "config.uat").exists())

    def test_two_sources_same_pid_conflict(self):
        # both define the SAME pid -> real collision must be reported
        touch(self.base / "config.uat" / "com.myco.FromQa.cfg.json")  # dup of qa's pid
        mapping = {"qa": "stage", "uat": "stage"}
        actions = rr.build_plan(rr.scan(self.root, mapping))
        merge = [a for a in actions if a.kind == "merge"][0]
        self.assertIn("com.myco.FromQa.cfg.json", merge.conflicts)


class FalsePositiveGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_non_aem_config_dir_ignored(self):
        # a directory named like a config folder but holding no OSGi artifacts
        (self.root / "build/config.prod").mkdir(parents=True)
        (self.root / "build/config.prod/webpack.js").write_text("//")
        findings = rr.scan(self.root)
        self.assertEqual(findings, [])

    def test_real_aem_config_dir_detected(self):
        touch(self.root / "apps/x/config.qa" / "com.x.A.cfg.json")
        findings = rr.scan(self.root)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0].name, "config.qa")


class IdempotencyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        touch(self.root / "apps/x/config.prod.author" / "com.x.A.cfg.json")
        touch(self.root / "apps/x/config.qa" / "com.x.B.cfg.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_apply_twice_is_noop_second_time(self):
        mapping = {"qa": "stage"}
        rr.apply_plan(rr.build_plan(rr.scan(self.root, mapping)), use_git=False)
        # second run: nothing actionable left
        actions2 = rr.build_plan(rr.scan(self.root, mapping))
        self.assertEqual(actions2, [])
        self.assertEqual(rr.main(["verify", str(self.root), "--map", "qa=stage"]), 0)


class MapParsingTests(unittest.TestCase):
    def test_parse_map_ok(self):
        m = rr.parse_map("qa=stage, uat=stage ,local=drop")
        self.assertEqual(m, {"qa": "stage", "uat": "stage", "local": "drop"})

    def test_parse_map_empty(self):
        self.assertEqual(rr.parse_map(""), {})
        self.assertEqual(rr.parse_map(None), {})

    def test_parse_map_bad(self):
        with self.assertRaises(ValueError):
            rr.parse_map("qa-stage")


class CliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        touch(self.root / "apps/myco/config.prod.author/com.myco.D.cfg.json")
        touch(self.root / "apps/myco/config.qa/com.myco.E.cfg.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_scan_strict_exit_code(self):
        rc = rr.main(["scan", str(self.root), "--strict"])
        self.assertEqual(rc, 1)

    def test_plan_to_file(self):
        out = self.root / "plan.json"
        rc = rr.main(["plan", str(self.root), "--map", "qa=stage", "--out", str(out)])
        self.assertEqual(rc, 0)
        plan = json.loads(out.read_text())
        self.assertEqual(plan["summary"]["actions"], 2)
        self.assertEqual(plan["summary"]["needs_user_review"], 0)

    def test_verify_after_apply_cli(self):
        self.assertEqual(rr.main(["apply", str(self.root), "--map", "qa=stage"]), 0)
        self.assertEqual(rr.main(["verify", str(self.root), "--map", "qa=stage"]), 0)


class PropertyFuzzTests(unittest.TestCase):
    """Random trees + fixed mapping: payloads are never lost and verify is clean."""
    SERVICES = ["author", "publish"]
    ENVS = ["dev", "stage", "prod"]
    CUSTOM = ["qa", "uat", "local", "preview", "ams", "sit"]
    MAP = {"qa": "stage", "uat": "stage", "local": "dev",
           "preview": "publish", "ams": "drop", "sit": "stage"}

    def _build(self, root, seed):
        import collections
        rng = random.Random(seed)
        base = root / "apps/x"
        names = set()
        for _ in range(rng.randint(1, 12)):
            pool = self.SERVICES + self.ENVS + self.CUSTOM
            toks = [rng.choice(pool) for _ in range(rng.randint(0, 3))]
            names.add("config" + "".join("." + t for t in toks))
        contents = collections.Counter()
        for i, name in enumerate(sorted(names)):
            d = base / name
            d.mkdir(parents=True, exist_ok=True)
            (d / ".content.xml").write_text("M")
            for j in range(rng.randint(0, 3)):
                c = f"p-{i}-{j}"
                (d / f"com.x.P{i}_{j}.cfg.json").write_text(c)
                contents[c] += 1
        return contents

    def _payloads(self, root):
        import collections
        c = collections.Counter()
        for p in root.rglob("*.cfg.json"):
            c[p.read_text()] += 1
        return c

    def test_fuzz_120_seeds(self):
        for seed in range(120):
            with tempfile.TemporaryDirectory() as t:
                root = Path(t)
                before = self._build(root, seed)
                actions = rr.build_plan(rr.scan(root, self.MAP))
                changed, errors = rr.apply_plan(actions, use_git=False)
                after = self._payloads(root)
                if not errors:
                    self.assertEqual(before, after, f"seed {seed}: payload multiset changed")
                    bad = [f.name for f in rr.scan(root, self.MAP)
                           if f.status == rr.REORDER or (f.status == rr.UNSUPPORTED and f.actionable)]
                    self.assertEqual(bad, [], f"seed {seed}: not converged")
                else:
                    self.assertGreaterEqual(sum(after.values()), sum(before.values()),
                                            f"seed {seed}: payload lost despite errors")


class OrderAndResumeTests(unittest.TestCase):
    def test_actions_are_order_independent(self):
        for seed in range(30):
            with tempfile.TemporaryDirectory() as t:
                root = Path(t)
                base = root / "apps/x"
                names = ["config.prod.author", "config.qa", "config.uat",
                         "config.dev.publish", "config.author"]
                for i, n in enumerate(names):
                    touch(base / n / f"com.x.P{i}.cfg.json", f"c{i}")
                mp = {"qa": "stage", "uat": "stage"}
                actions = rr.build_plan(rr.scan(root, mp))
                random.Random(seed).shuffle(actions)
                _, errors = rr.apply_plan(actions, use_git=False)
                self.assertEqual(errors, [], f"seed {seed}")
                payloads = sorted(p.read_text() for p in root.rglob("*.cfg.json"))
                self.assertEqual(payloads, [f"c{i}" for i in range(len(names))])

    def test_resume_after_partial_apply(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            base = root / "apps/x"
            for i, n in enumerate(["config.prod.author", "config.qa",
                                   "config.dev.publish", "config.uat"]):
                touch(base / n / f"com.x.P{i}.cfg.json", f"c{i}")
            mp = {"qa": "stage", "uat": "stage"}
            rr.apply_plan(rr.build_plan(rr.scan(root, mp))[:2], use_git=False)  # interrupted
            rr.apply_plan(rr.build_plan(rr.scan(root, mp)), use_git=False)       # resume
            after = sorted(p.read_text() for p in root.rglob("*.cfg.json"))
            self.assertEqual(after, ["c0", "c1", "c2", "c3"])
            self.assertEqual(rr.main(["verify", str(root), "--map", "qa=stage,uat=stage"]), 0)


class GitRmFallbackTests(unittest.TestCase):
    def test_untracked_source_marker_falls_back(self):
        import subprocess
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            base = root / "apps/x"
            for a in (["init", "-q"], ["config", "user.email", "a@b"], ["config", "user.name", "x"]):
                subprocess.run(["git", *a], cwd=root, check=True, capture_output=True)
            touch(base / "config.author.prod" / ".content.xml", "M")
            touch(base / "config.author.prod" / "com.x.T.cfg.json", "t")
            touch(base / "config.prod.author" / "com.x.S.cfg.json", "s")
            subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "commit", "-qm", "i"], cwd=root, check=True, capture_output=True)
            touch(base / "config.prod.author" / ".content.xml", "M")  # untracked marker
            _, errors = rr.apply_plan(rr.build_plan(rr.scan(root, {})), use_git=True)
            self.assertEqual(errors, [])
            self.assertFalse((base / "config.prod.author").exists())
            self.assertTrue((base / "config.author.prod" / "com.x.S.cfg.json").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
