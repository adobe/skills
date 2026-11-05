"""Executable workflow scenarios with simulated JDKs/commands, not real AEM builds."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from test_poms import HERE, SKILL
import run_migration as workflow
from pom_support import compiler_nodes, reactor, source_version, write_changes


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name) / "project"
        shutil.copytree(HERE / "fixtures" / "reactor", self.project)
        subprocess.run(["git", "init", "-q", str(self.project)], check=True)
        self.set_source(21)
        self.commit()
        self.calls = []
        self.missing = set()
        self.fail_stage = None
        runtime = patch.object(workflow, "verify_runtime_major", side_effect=lambda home: int(home.name.rsplit("-", 1)[1]))
        runtime.start()
        self.addCleanup(runtime.stop)

    def commit(self):
        subprocess.run(["git", "add", "."], cwd=self.project, check=True)
        if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=self.project).returncode == 0:
            return
        subprocess.run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                        "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"], cwd=self.project, check=True)

    def set_source(self, version):
        poms = reactor(self.project)
        for pom in poms.values():
            for node in compiler_nodes(pom):
                pom.set_text(node, str(version))
        write_changes(poms)

    def discover(self, major, config, explicit=None):
        return None if major in self.missing else Path(self.temp.name) / f"jdk-{major}"

    def fake_run(self, command, root, env, log, timeout=1800):
        self.calls.append((command, env["JAVA_HOME"], log.name))
        log.write_text("Simulated command: not an integration build\n")
        if command[-1] == "--version":
            major = int(Path(env["JAVA_HOME"]).name.rsplit("-", 1)[1])
            log.write_text(f"Simulated Maven\nJava version: {major}.0.1\n")
        if log.stem == self.fail_stage:
            raise workflow.CommandError(f"simulated command failed; inspect {log}", 7)
        if log.stem == "java-recipe":
            # Simulate the recipe changing the compiler before deterministic POM updates.
            self.set_source(25)
        if log.stem in {"baseline", "final-verify"}:
            reports = root / "core" / "target" / "surefire-reports"
            reports.mkdir(parents=True, exist_ok=True)
            (reports / "TEST-simulation.xml").write_text('<testsuite tests="2" failures="0" errors="0" skipped="0"/>')

    def migrate(self, *extra):
        args = workflow.parse_args([str(self.project), "--target", "25", "--evaluation", "--approve", *extra])
        report, code = workflow.migrate(args, discover=self.discover, run=self.fake_run)
        self.addCleanup(shutil.rmtree, report["logs"])
        self.assertEqual(json.loads((Path(report["logs"]) / "report.json").read_text()), report)
        return report, code

    def test_source_matrix_proceeds_including_21(self):
        for source in (8, 11, 17, 21):
            with self.subTest(source=source):
                self.set_source(source)
                self.commit()
                report, code = self.migrate()
                self.assertEqual(code, 0)
                self.assertEqual(report["source"], source)
                self.assertEqual(report["status"], "local-build-passed-evaluation-only")
                self.assertTrue(all(op["status"] == "passed" for op in report["operations"].values()))
                self.assertEqual(source_version(reactor(self.project)), 25)
                self.assertEqual((self.project / ".cloudmanager" / "java-version").read_text(), "25\n")
                # Reset only the disposable fixture, never a developer checkout.
                shutil.rmtree(self.project / ".cloudmanager")
                self.commit()
        baseline_homes = [home for _, home, log in self.calls if log == "baseline.log"]
        self.assertEqual([Path(home).name for home in baseline_homes], ["jdk-8", "jdk-11", "jdk-17", "jdk-21"])

    def test_source_25_skip_is_unchanged(self):
        self.set_source(25)
        before = {path: path.read_bytes() for path in self.project.rglob("pom.xml")}
        report, code = self.migrate()
        self.assertEqual((report["status"], code), ("skipped", 0))
        self.assertEqual(self.calls, [])
        self.assertFalse((self.project / ".cloudmanager").exists())
        self.assertEqual(before, {path: path.read_bytes() for path in before})

    def test_mixed_source_reactor_uses_highest_baseline_jdk(self):
        child = self.project / "core" / "pom.xml"
        child.write_text(child.read_text().replace("<maven.compiler.release>21</maven.compiler.release>",
                                                  "<maven.compiler.release>8</maven.compiler.release>"))
        self.commit()
        report, code = self.migrate()
        self.assertEqual(code, 0)
        self.assertEqual(report["source"], 8)
        self.assertEqual(report["compiler_levels"], [8, 21])
        self.assertEqual(report["source_jdk_version"], 21)
        baseline = next(home for _, home, log in self.calls if log == "baseline.log")
        self.assertEqual(Path(baseline).name, "jdk-21")

    def test_missing_source_stops_before_changes(self):
        self.missing = {21}
        report, code = self.migrate()
        self.assertEqual(code, 1)
        self.assertIn("Source JDK 21 is missing", report["error"])
        self.assertEqual(self.calls, [])
        self.assertEqual(source_version(reactor(self.project)), 21)

    def test_missing_target_explicitly_skips_target_and_mockito(self):
        self.missing = {25}
        report, code = self.migrate()
        self.assertEqual(code, 3)
        self.assertEqual(report["status"], "changes-applied-not-locally-validated")
        for stage in ("target-build", "mockito-recipe", "final-verify"):
            self.assertEqual(report["operations"][stage]["status"], "skipped")
            self.assertEqual(report["operations"][stage]["reason"], "Target JDK missing")
        self.assertEqual(source_version(reactor(self.project)), 25)
        self.assertTrue(report["changed_files"])

    def test_no_parsing_runtime_stops_before_baseline(self):
        self.missing = {25, 17}
        self.set_source(8)
        self.commit()
        self.missing.add(21)
        report, code = self.migrate()
        self.assertEqual(code, 1)
        self.assertIn("OpenRewrite needs", report["error"])
        self.assertEqual(self.calls, [])

    def test_preflight_and_refusal_make_no_project_changes(self):
        args = workflow.parse_args([str(self.project), "--target", "25", "--evaluation"])
        report, code = workflow.migrate(args, discover=self.discover, run=self.fake_run)
        self.addCleanup(shutil.rmtree, report["logs"])
        self.assertEqual((report["status"], code), ("awaiting-approval", 0))
        self.assertEqual(self.calls, [])
        self.assertEqual(source_version(reactor(self.project)), 21)
        self.assertFalse((self.project / ".cloudmanager").exists())

    def test_gate_and_invalid_target_stop_before_changes(self):
        for flags, message in ((["--target", "25"], "evaluation-only"),
                               (["--target", "21", "--evaluation"], "Unsupported")):
            args = workflow.parse_args([str(self.project), *flags, "--approve"])
            report, code = workflow.migrate(args, discover=self.discover, run=self.fake_run)
            self.addCleanup(shutil.rmtree, report["logs"])
            self.assertEqual(code, 1)
            self.assertIn(message, report["error"])
        self.assertEqual(self.calls, [])

    def test_disabled_target_stops(self):
        with patch.object(workflow, "target_config", side_effect=workflow.MigrationError("Unsupported or disabled Java target: 25")):
            report, code = self.migrate()
        self.assertEqual(code, 1)
        self.assertIn("disabled", report["error"])
        self.assertEqual(self.calls, [])

    def test_non_aem_stops_before_commands(self):
        path = self.project / "pom.xml"
        path.write_text(path.read_text().replace("aem-sdk-api", "not-aem-sdk"))
        report, code = self.migrate()
        self.assertEqual(code, 1)
        self.assertIn("Only AEM", report["error"])
        self.assertEqual(self.calls, [])

    def test_existing_changes_preserved(self):
        path = self.project / "user-file.txt"
        path.write_text("do not overwrite")
        report, code = self.migrate()
        self.assertEqual(code, 1)
        self.assertIn("existing changes", report["error"])
        self.assertEqual(path.read_text(), "do not overwrite")
        self.assertEqual(self.calls, [])

    def test_each_command_failure_report_and_exit_preserved(self):
        for stage in ("baseline", "java-recipe", "target-build", "mockito-recipe", "final-verify"):
            with self.subTest(stage=stage):
                self.set_source(21)
                self.commit()
                self.fail_stage = stage
                report, code = self.migrate()
                self.assertEqual(code, 7)
                self.assertEqual(report["status"], "failed")
                self.assertEqual(report["operations"][stage]["status"], "failed")
                self.assertIn("simulated command failed", report["error"])
                self.assertTrue(all(op["status"] != "running" for op in report["operations"].values()))
                if stage == "baseline":
                    self.assertEqual(source_version(reactor(self.project)), 21)
                if (self.project / ".cloudmanager").exists():
                    shutil.rmtree(self.project / ".cloudmanager")
                self.commit()

    def test_resources_resolved_without_harness_variable(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("AGENT_SKILL_DIR", None)
            report, code = self.migrate()
        recipe = next(cmd for cmd, _, log in self.calls if log == "java-recipe.log")
        resource = next(arg.split("=", 1)[1] for arg in recipe if arg.startswith("-Drewrite.configLocation="))
        self.assertTrue(Path(resource).is_absolute())
        self.assertTrue(Path(resource).is_file())
        self.assertEqual(code, 0)

    def test_unique_logs_for_simultaneous_different_projects(self):
        def preflight(index):
            project = Path(self.temp.name) / f"parallel-{index}"
            shutil.copytree(self.project, project)
            args = workflow.parse_args([str(project), "--target", "25", "--evaluation"])
            return workflow.migrate(args, discover=self.discover, run=self.fake_run)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(preflight, (1, 2)))
        self.assertNotEqual(results[0][0]["logs"], results[1][0]["logs"])
        for report, code in results:
            self.addCleanup(shutil.rmtree, report["logs"])
            self.assertEqual(code, 0)
        self.assertEqual(self.calls, [])

    def test_actual_subprocess_failure_and_version_checks(self):
        log = Path(self.temp.name) / "command.log"
        with self.assertRaises(workflow.CommandError) as caught:
            workflow.execute([sys.executable, "-c", "import sys; print('evidence'); sys.exit(9)"],
                             self.project, os.environ.copy(), log)
        self.assertEqual(caught.exception.code, 9)
        self.assertIn("evidence", log.read_text())
        self.assertEqual(workflow.java_major('openjdk version "25.0.1"'), 25)
        self.assertEqual(workflow.java_major('java version "1.8.0_412"'), 8)

    def test_no_executed_tests_is_unvalidated_not_passed(self):
        def no_tests(command, root, env, log):
            self.fake_run(command, root, env, log)
            if log.stem == "final-verify":
                report = root / "core" / "target" / "surefire-reports" / "TEST-simulation.xml"
                report.write_text('<testsuite tests="2" failures="0" errors="0" skipped="2"/>')
        args = workflow.parse_args([str(self.project), "--target", "25", "--evaluation", "--approve"])
        report, code = workflow.migrate(args, discover=self.discover, run=no_tests)
        self.addCleanup(shutil.rmtree, report["logs"])
        self.assertEqual(code, 3)
        self.assertEqual(report["status"], "local-build-passed-tests-unverified")
        self.assertEqual(report["final_tests"]["skipped"], 2)

    def test_test_report_failure_not_hidden_by_zero_maven_exit(self):
        def failing_tests(command, root, env, log):
            self.fake_run(command, root, env, log)
            if log.stem == "final-verify":
                report = root / "core" / "target" / "surefire-reports" / "TEST-simulation.xml"
                report.write_text('<testsuite tests="2" failures="1" errors="0" skipped="0"/>')
        args = workflow.parse_args([str(self.project), "--target", "25", "--evaluation", "--approve"])
        report, code = workflow.migrate(args, discover=self.discover, run=failing_tests)
        self.addCleanup(shutil.rmtree, report["logs"])
        self.assertEqual(code, 1)
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["operations"]["final-verify"]["status"], "failed")

    def test_maven_jdk_mismatch_stops_before_baseline_command(self):
        def wrong_jdk(command, root, env, log):
            self.fake_run(command, root, env, log)
            if command[-1] == "--version":
                log.write_text("Java version: 11.0.1\n")
        args = workflow.parse_args([str(self.project), "--target", "25", "--evaluation", "--approve"])
        report, code = workflow.migrate(args, discover=self.discover, run=wrong_jdk)
        self.addCleanup(shutil.rmtree, report["logs"])
        self.assertEqual(code, 1)
        self.assertIn("Maven is not running", report["error"])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(source_version(reactor(self.project)), 21)

    def test_timeout_exit_and_log_preserved(self):
        log = Path(self.temp.name) / "timeout.log"
        with self.assertRaises(workflow.CommandError) as caught:
            workflow.execute([sys.executable, "-c", "import time; time.sleep(5)"],
                             self.project, os.environ.copy(), log, timeout=0.05)
        self.assertEqual(caught.exception.code, 124)
        self.assertTrue(log.exists())

    def test_symlink_scope_stops_before_commands(self):
        (self.project / "escape").symlink_to(Path(self.temp.name))
        report, code = self.migrate()
        self.assertEqual(code, 1)
        self.assertIn("symlink", report["error"])
        self.assertEqual(self.calls, [])

    def test_installed_copy_invoked_from_unrelated_working_directory(self):
        installed = Path(self.temp.name) / "installed skill with spaces"
        shutil.copytree(SKILL, installed)
        environment = os.environ.copy()
        environment.pop("AGENT_SKILL_DIR", None)
        result = subprocess.run(
            [sys.executable, str(installed / "scripts" / "run_migration.py"), str(self.project),
             "--target", "25"],
            cwd=self.project, env=environment, capture_output=True, text=True,
        )
        report = json.loads(result.stdout)
        self.addCleanup(shutil.rmtree, report["logs"])
        self.assertEqual(result.returncode, 1)
        self.assertIn("evaluation-only", report["error"])
        self.assertIn("only 17/21", report["warnings"][0])
        self.assertEqual(source_version(reactor(self.project)), 21)

    def test_partial_script_failure_still_reports(self):
        original = workflow.migrate_plugins.plan
        calls = 0

        def plan(poms, target):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise workflow.MigrationError("induced post-recipe POM failure")
            return original(poms, target)

        with patch.object(workflow.migrate_plugins, "plan", side_effect=plan):
            report, code = self.migrate()
        self.assertEqual(code, 1)
        self.assertEqual(report["operations"]["pom-updates"]["status"], "failed")
        self.assertEqual(report["operations"]["java-recipe"]["status"], "passed")
        self.assertTrue(report["changed_files"])


if __name__ == "__main__":
    unittest.main()
