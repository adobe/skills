"""Preflight or execute an explicitly approved, evaluation-only Java migration."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

import migrate_dependency_versions
import migrate_filevault
import migrate_plugins
from pom_support import (
    MigrationError, SKILL, compiler_versions, coordinate, reactor, source_version, target_config, write_changes,
)

STAGES = (
    "baseline", "java-recipe", "pom-updates", "cloud-manager",
    "target-build", "mockito-recipe", "final-verify",
)


class CommandError(MigrationError):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code if 0 < code < 256 else 1


def java_major(output):
    match = re.search(r'(?:java|openjdk) version "((?:1\.)?\d+)', output)
    if not match:
        raise MigrationError(f"Cannot read Java version: {output[:200]}")
    return int(match[1].removeprefix("1."))


def verify_jdk(home, major):
    home = Path(home).expanduser().resolve()
    java = home / "bin" / "java"
    javac = home / "bin" / "javac"
    if not java.is_file() or not javac.is_file():
        return None
    result = subprocess.run([str(java), "-version"], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise MigrationError(f"JDK version check failed ({result.returncode}): {java}")
    return home if java_major(result.stdout + result.stderr) == major else None


def find_jdk(major, config, explicit=None):
    if explicit:
        found = verify_jdk(explicit, major)
        if not found:
            raise MigrationError(f"Configured JDK is not Java {major}: {explicit}")
        return found
    candidates = [os.environ.get(name.format(version=major)) for name in config["jdk_environment"]]
    java = shutil.which("java")
    if java:
        candidates.append(str(Path(java).resolve().parent.parent))
    if sys.platform == "darwin":
        result = subprocess.run(
            ["/usr/libexec/java_home", "-v", "1.8" if major == 8 else str(major)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            candidates.append(result.stdout.strip())
    elif sys.platform.startswith("linux"):
        for directory in (Path("/usr/lib/jvm"), Path("/usr/java")):
            if directory.is_dir():
                candidates.extend(str(path) for path in directory.iterdir() if path.is_dir())
    for candidate in dict.fromkeys(value for value in candidates if value):
        found = verify_jdk(candidate, major)
        if found:
            return found
    return None


def jdk_env(home):
    return {**os.environ, "JAVA_HOME": str(home), "PATH": str(home / "bin") + os.pathsep + os.environ.get("PATH", "")}


def execute(command, cwd, env, log, timeout=1800):
    with log.open("w") as stream:
        try:
            result = subprocess.run(
                command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT,
                timeout=timeout, check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise CommandError(f"Command timed out; inspect {log}", 124) from exc
    if result.returncode:
        raise CommandError(f"Command failed ({result.returncode}); inspect {log}", result.returncode)


def eligible(poms):
    dependencies = [coordinate(dep) for pom in poms.values() for dep in pom.root.walk("dependency")]
    if "com.adobe.aem:aem-sdk-api" not in dependencies:
        raise MigrationError("Only AEM as a Cloud Service Maven projects with a declared aem-sdk-api are supported.")
    if any(key in dependencies for key in ("com.adobe.aem:uber-jar", "com.adobe.granite:com.adobe.granite.quickstart")):
        raise MigrationError("Legacy AEM/AMS dependencies require platform migration, not this skill.")


def workspace_safety(root):
    for directory, dirs, files in os.walk(root):
        dirs[:] = [name for name in dirs if name not in {".git", "target", "node_modules"}]
        for name in dirs + files:
            if (Path(directory) / name).is_symlink():
                raise MigrationError(f"Review symlink before migration: {Path(directory) / name}")
    result = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all", "--", "."],
                            cwd=root, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise MigrationError(f"Cannot inspect working tree: {result.stderr.strip()}")
    if result.stdout.strip():
        raise MigrationError("Project has existing changes. Preserve them in a separate disposable checkout before migration.")


def rewrite_command(maven, config, phase):
    java = phase == "java"
    return [
        maven, "--batch-mode", "--no-transfer-progress",
        f"org.openrewrite.maven:rewrite-maven-plugin:{config['rewrite_plugin']}:run",
        f"-Drewrite.recipeArtifactCoordinates={config['java_artifact'] if java else config['mockito_artifact']}",
        f"-Drewrite.configLocation={SKILL / 'recipes' / ('java_upgrade.yml' if java else 'mockito_upgrade.yml')}",
        f"-Drewrite.activeRecipes={config['java_recipe'] if java else config['mockito_recipe']}",
    ]


def snapshot(root):
    return subprocess.run(["git", "status", "--porcelain", "--untracked-files=all", "--", "."],
                          cwd=root, capture_output=True, text=True, timeout=30)


def test_counts(poms):
    counts = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0, "reports": 0}
    for path in poms:
        for folder in ("surefire-reports", "failsafe-reports"):
            for report in (path.parent / "target" / folder).glob("TEST-*.xml"):
                suite = ET.parse(report).getroot()
                for key in ("tests", "failures", "errors", "skipped"):
                    counts[key] += int(suite.get(key, "0"))
                counts["reports"] += 1
    return counts


def migrate(args, *, discover=find_jdk, run=execute):
    logs = Path(tempfile.mkdtemp(prefix="aem-java-migration-"))
    report = {
        "status": "blocked", "target": args.target, "project": str(args.project.resolve()),
        "logs": str(logs), "changed_files": [], "warnings": [], "manual_actions": [],
        "operations": {stage: {"status": "skipped", "reason": "Not reached"} for stage in STAGES},
        "external_checks": {
            "installed-agent": "BLOCKED: run with an installed skill and a disposable AEM project",
            "cloud-manager": "BLOCKED: Java 25 support and explicit user approval required",
            "runtime": "BLOCKED: supported Java 25 SDK/runtime and smoke tests required",
        },
    }
    code = 1
    root = args.project.resolve()
    active = None
    track_changes = False
    try:
        config = target_config(args.target)
        report["warnings"].extend([config["compatibility_warning"], config["validation"]])
        report["manual_actions"].append("Do not deploy or run Cloud Manager with this evaluation configuration.")
        if not args.evaluation:
            raise MigrationError("Java 25 is evaluation-only. Review platform limitations and pass --evaluation explicitly.")
        poms = reactor(root)
        eligible(poms)
        source = source_version(poms)
        report["source"] = source
        levels = compiler_versions(poms)
        report["compiler_levels"] = levels
        if source >= args.target:
            report["status"] = "skipped"
            for operation in report["operations"].values():
                operation["reason"] = "Source is already at or above the requested target"
            return report, 0
        if any(level not in config["source_versions"] for level in levels):
            raise MigrationError(f"Unsupported or mixed target-level compiler settings: {levels}; inspect the effective POM.")
        workspace_safety(root)
        source_jdk = max(levels)
        report["source_jdk_version"] = source_jdk
        source_home = discover(source_jdk, config, args.source_jdk)
        if not source_home:
            raise MigrationError(f"Source JDK {source_jdk} is missing; configure JAVA{source_jdk}_HOME or --source-jdk.")
        target_home = discover(args.target, config, args.target_jdk)
        runtime = target_home
        if args.rewrite_jdk:
            java = args.rewrite_jdk / "bin" / "java"
            result = subprocess.run([str(java), "-version"], capture_output=True, text=True, timeout=30)
            if result.returncode:
                raise MigrationError(f"Cannot verify rewrite JDK: {java}")
            major = java_major(result.stdout + result.stderr)
            if major < config["rewrite_runtime_minimum"]:
                raise MigrationError("Configured OpenRewrite runtime must be JDK 17+.")
            runtime = discover(major, config, args.rewrite_jdk)
        if not runtime:
            for major in (21, 17):
                if major >= config["rewrite_runtime_minimum"]:
                    runtime = discover(major, config)
                    if runtime:
                        break
        if not runtime:
            raise MigrationError("OpenRewrite needs a verified JDK 17+; configure --rewrite-jdk.")
        maven = shutil.which("mvn")
        if not maven:
            raise MigrationError("Maven is missing; install Maven and put mvn on PATH.")
        report["jdks"] = {"source": str(source_home), "target": str(target_home) if target_home else None,
                          "rewrite": str(runtime)}
        if not target_home:
            report["warnings"].append("Target JDK missing: applicable edits only; target builds and Mockito will be skipped.")
        # Validate all deterministic plans before the baseline or recipe can modify the project.
        migrate_plugins.plan(poms, args.target)
        migrate_dependency_versions.plan(poms, args.target)
        migrate_filevault.plan(poms, args.target)
        for pom in poms.values():
            pom.render()
        if not args.approve:
            report["status"] = "awaiting-approval"
            report["manual_actions"].append("Review the project, JDKs, planned POM/recipe changes and third-party recipe licenses; rerun with --approve only after approval.")
            return report, 0
        track_changes = True

        def command(stage, home, command_args):
            nonlocal active
            active = stage
            log = logs / f"{stage}.log"
            report["operations"][stage] = {"status": "running", "log": str(log), "command": command_args}
            environment = jdk_env(home)
            version_log = logs / f"{stage}-maven-version.log"
            run([maven, "--version"], root, environment, version_log)
            version = re.search(r"Java version:\s*((?:1\.)?\d+)", version_log.read_text())
            expected = verify_runtime_major(home)
            if not version or int(version[1].removeprefix("1.")) != expected:
                raise MigrationError(f"Maven is not running under the selected JDK; inspect {version_log}")
            run(command_args, root, environment, log)
            report["operations"][stage]["status"] = "passed"
            active = None

        command("baseline", source_home, [maven, "--batch-mode", "--no-transfer-progress", "clean", "verify"])
        report["baseline_tests"] = test_counts(poms)
        command("java-recipe", runtime, rewrite_command(maven, config, "java"))
        active = "pom-updates"
        poms = reactor(root)
        migrate_plugins.plan(poms, args.target)
        migrate_dependency_versions.plan(poms, args.target)
        migrate_filevault.plan(poms, args.target)
        write_changes(poms)
        report["operations"][active] = {"status": "passed"}
        active = "cloud-manager"
        directory = root / ".cloudmanager"
        if directory.is_symlink() or (directory / "java-version").is_symlink():
            raise MigrationError("Cloud Manager path is a symlink; refusing to write outside the project.")
        directory.mkdir(exist_ok=True)
        (directory / "java-version").write_text(f"{args.target}\n")
        report["operations"][active] = {"status": "passed", "warning": "Evaluation artifact; unsupported by documented Cloud Manager"}
        active = None
        if not target_home:
            report["status"] = "changes-applied-not-locally-validated"
            for stage in ("target-build", "mockito-recipe", "final-verify"):
                report["operations"][stage]["reason"] = "Target JDK missing"
            report["manual_actions"].append("Install JDK 25; inspect and validate the existing diff before running target build/Mockito/final verification. Do not rely on a repeat-run skip as validation.")
            return report, 3
        command("target-build", target_home, [maven, "--batch-mode", "--no-transfer-progress", "test"])
        command("mockito-recipe", target_home, rewrite_command(maven, config, "mockito"))
        command("final-verify", target_home, [maven, "--batch-mode", "--no-transfer-progress", "clean", "verify"])
        active = "final-verify"
        report["final_tests"] = test_counts(reactor(root))
        counts = report["final_tests"]
        if counts["failures"] or counts["errors"]:
            raise MigrationError("Test reports contain failures/errors despite successful Maven exit.")
        if counts["tests"] == 0 or counts["tests"] == counts["skipped"]:
            report["status"] = "local-build-passed-tests-unverified"
            report["manual_actions"].append("No executed tests were found; inspect test/profile configuration before acceptance.")
            return report, 3
        report["status"] = "local-build-passed-evaluation-only"
        report["manual_actions"].append("Inspect Surefire/Failsafe counts, effective POMs, bundle manifests and analyser output. A zero build exit is not runtime validation.")
        code = 0
        active = None
    except (MigrationError, OSError, subprocess.SubprocessError, ET.ParseError, ValueError) as exc:
        if active:
            report["operations"][active]["status"] = "failed"
            report["operations"][active]["error"] = str(exc)
        report["error"] = str(exc)
        report["status"] = "failed" if active else "blocked"
        report["manual_actions"].append("Inspect the report, logs and partial diff. Fix only migration-introduced failures; do not disable tests or analysis.")
        code = exc.code if isinstance(exc, CommandError) else 1
    finally:
        if track_changes:
            try:
                changes = snapshot(root)
                if changes.returncode == 0:
                    report["changed_files"] = changes.stdout.splitlines()
                else:
                    report["warnings"].append(f"Cannot collect changed files: {changes.stderr.strip()}")
            except (OSError, subprocess.SubprocessError) as exc:
                report["warnings"].append(f"Cannot collect changed files: {exc}")
        (logs / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report, code


def verify_runtime_major(home):
    result = subprocess.run([str(home / "bin" / "java"), "-version"],
                            capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise MigrationError(f"Selected JDK cannot execute: {home}")
    return java_major(result.stdout + result.stderr)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--target", required=True, type=int)
    parser.add_argument("--evaluation", action="store_true", help="Acknowledge unsupported Java 25 platform evaluation")
    parser.add_argument("--approve", action="store_true", help="Apply changes only after user approval of preflight")
    parser.add_argument("--source-jdk", type=Path)
    parser.add_argument("--target-jdk", type=Path)
    parser.add_argument("--rewrite-jdk", type=Path)
    return parser.parse_args(argv)


def main(argv=None):
    report, code = migrate(parse_args(argv))
    print(json.dumps(report, indent=2))
    return code


if __name__ == "__main__":
    sys.exit(main())
