#!/usr/bin/env python3
"""Run eval assertions against generated project output."""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys


def load_evals(skill_path: str) -> dict:
    evals_path = os.path.join(skill_path, "evals", "evals.json")
    with open(evals_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def find_eval(evals_data: dict, eval_id: int) -> dict | None:
    for eval_entry in evals_data.get("evals", []):
        if str(eval_entry.get("id")) == str(eval_id):
            return eval_entry
    return None


def has_glob_pattern(path_value: str) -> bool:
    return any(char in path_value for char in "*?[")


def resolve_project_paths(project_path: str, path_value: str) -> list[str]:
    full_path = os.path.join(project_path, path_value)
    if has_glob_pattern(path_value):
        return sorted(glob.glob(full_path, recursive=True))
    return [full_path]


def read_text_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def get_required_text(assertion: dict, key: str) -> str | None:
    value = assertion.get(key)
    if isinstance(value, str) and value.strip():
        return value
    return None


def search_pattern(text: str, pattern: str) -> tuple[bool, str]:
    try:
        return re.search(pattern, text, re.MULTILINE) is not None, "regex"
    except re.error as exc:
        return False, f"invalid regex: {exc}"


def count_files(root_path: str) -> int:
    total = 0
    for current_root, dir_names, file_names in os.walk(root_path):
        dir_names[:] = [d for d in dir_names if d not in {"node_modules", ".git"}]
        total += len(file_names)
    return total


def tail_text(text: str, max_lines: int = 10) -> str:
    lines = text.strip().splitlines()
    if not lines:
        return ""
    return "\n".join(lines[-max_lines:])


def evaluate_assertion(assertion: dict, project_path: str, output_log_path: str | None) -> dict:
    assertion_type = assertion.get("type", "")
    description = assertion.get("description") or assertion_type

    if assertion_type == "file_exists":
        path_value = get_required_text(assertion, "path")
        if not path_value:
            return fail_result(assertion_type, description, "Missing required field: path")
        matches = resolve_project_paths(project_path, path_value)
        files = [path for path in matches if os.path.isfile(path)]
        if files:
            return pass_result(assertion_type, description, f"Found file: {relative_to_project(project_path, files[0])}")
        return fail_result(assertion_type, description, f"Expected file missing: {path_value}")

    if assertion_type == "file_not_exists":
        path_value = get_required_text(assertion, "path")
        if not path_value:
            return fail_result(assertion_type, description, "Missing required field: path")
        matches = resolve_project_paths(project_path, path_value)
        existing = [path for path in matches if os.path.exists(path)]
        if not existing:
            return pass_result(assertion_type, description, f"Confirmed missing: {path_value}")
        return fail_result(assertion_type, description, f"Unexpected path exists: {relative_to_project(project_path, existing[0])}")

    if assertion_type == "dir_exists":
        path_value = get_required_text(assertion, "path")
        if not path_value:
            return fail_result(assertion_type, description, "Missing required field: path")
        matches = resolve_project_paths(project_path, path_value)
        dirs = [path for path in matches if os.path.isdir(path)]
        if dirs:
            return pass_result(assertion_type, description, f"Found directory: {relative_to_project(project_path, dirs[0])}")
        return fail_result(assertion_type, description, f"Expected directory missing: {path_value}")

    if assertion_type == "dir_not_exists":
        path_value = get_required_text(assertion, "path")
        if not path_value:
            return fail_result(assertion_type, description, "Missing required field: path")
        matches = resolve_project_paths(project_path, path_value)
        existing = [path for path in matches if os.path.exists(path)]
        if not existing:
            return pass_result(assertion_type, description, f"Confirmed missing: {path_value}")
        return fail_result(assertion_type, description, f"Unexpected path exists: {relative_to_project(project_path, existing[0])}")

    if assertion_type == "file_contains":
        path_value = get_required_text(assertion, "path")
        pattern = get_required_text(assertion, "pattern")
        if not path_value:
            return fail_result(assertion_type, description, "Missing required field: path")
        if not pattern:
            return fail_result(assertion_type, description, "Missing required field: pattern")
        matches = [path for path in resolve_project_paths(project_path, path_value) if os.path.isfile(path)]
        if not matches:
            return fail_result(assertion_type, description, f"No files matched path: {path_value}")
        for file_path in matches:
            found, mode = search_pattern(read_text_file(file_path), pattern)
            if found:
                detail = f"Pattern matched in {relative_to_project(project_path, file_path)} ({mode})"
                return pass_result(assertion_type, description, detail)
            if mode.startswith("invalid regex"):
                return fail_result(assertion_type, description, mode)
        return fail_result(assertion_type, description, f"Pattern not found in {len(matches)} file(s): {pattern}")

    if assertion_type == "file_not_contains":
        path_value = get_required_text(assertion, "path")
        pattern = get_required_text(assertion, "pattern")
        if not path_value:
            return fail_result(assertion_type, description, "Missing required field: path")
        if not pattern:
            return fail_result(assertion_type, description, "Missing required field: pattern")
        matches = [path for path in resolve_project_paths(project_path, path_value) if os.path.isfile(path)]
        if not matches:
            return fail_result(assertion_type, description, f"No files matched path: {path_value}")
        matched_files: list[str] = []
        for file_path in matches:
            found, mode = search_pattern(read_text_file(file_path), pattern)
            if mode.startswith("invalid regex"):
                return fail_result(assertion_type, description, mode)
            if found:
                matched_files.append(relative_to_project(project_path, file_path))
        if matched_files:
            return fail_result(assertion_type, description, f"Pattern unexpectedly found in: {', '.join(matched_files)}")
        return pass_result(assertion_type, description, f"Pattern absent from {len(matches)} file(s)")

    if assertion_type == "file_matches_glob":
        pattern = get_required_text(assertion, "glob")
        if not pattern:
            return fail_result(assertion_type, description, "Missing required field: glob")
        matches = [path for path in sorted(glob.glob(os.path.join(project_path, pattern), recursive=True)) if os.path.isfile(path)]
        if not matches:
            return fail_result(assertion_type, description, f"No matches for glob: {pattern}")
        content_pattern = assertion.get("content_pattern")
        if content_pattern:
            pattern_re = re.compile(content_pattern)
            content_matches = []
            for file_path in matches:
                try:
                    content = read_text_file(file_path)
                    if pattern_re.search(content):
                        content_matches.append(file_path)
                except (IOError, UnicodeDecodeError):
                    continue
            if content_matches:
                detail = f"Found {len(content_matches)} file(s) matching glob with content pattern"
                return pass_result(assertion_type, description, detail)
            return fail_result(assertion_type, description, f"Files match glob but none contain pattern '{content_pattern}'")
        detail = f"Matched {len(matches)} path(s); first match: {relative_to_project(project_path, matches[0])}"
        return pass_result(assertion_type, description, detail)

    if assertion_type == "command_succeeds":
        command = get_required_text(assertion, "command")
        if not command:
            return fail_result(assertion_type, description, "Missing required field: command")
        try:
            timeout_seconds = int(assertion.get("timeout_seconds", 300))
        except (TypeError, ValueError):
            return fail_result(assertion_type, description, "Invalid timeout_seconds value")
        try:
            completed = subprocess.run(
                command,
                cwd=project_path,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            return fail_result(assertion_type, description, f"Command timed out after {timeout_seconds}s: {command}")

        if completed.returncode == 0:
            detail = f"Command succeeded: {command}"
            output_tail = tail_text(completed.stdout or completed.stderr)
            if output_tail:
                detail = f"{detail}\n{output_tail}"
            return pass_result(assertion_type, description, detail)

        detail = f"Command failed ({completed.returncode}): {command}"
        output_tail = tail_text((completed.stdout or "") + "\n" + (completed.stderr or ""))
        if output_tail:
            detail = f"{detail}\n{output_tail}"
        return fail_result(assertion_type, description, detail)

    if assertion_type == "max_file_count":
        path_value = assertion.get("path", ".")
        try:
            max_files = int(assertion.get("max", 0))
        except (TypeError, ValueError):
            return fail_result(assertion_type, description, "Invalid max value")
        target_path = os.path.join(project_path, path_value)
        if not os.path.isdir(target_path):
            return fail_result(assertion_type, description, f"Directory not found: {path_value}")
        file_count = count_files(target_path)
        if file_count <= max_files:
            return pass_result(assertion_type, description, f"File count {file_count} <= {max_files} in {path_value}")
        return fail_result(assertion_type, description, f"File count {file_count} > {max_files} in {path_value}")

    if assertion_type == "output_contains":
        pattern = get_required_text(assertion, "pattern")
        if not pattern:
            return fail_result(assertion_type, description, "Missing required field: pattern")
        if not output_log_path:
            return fail_result(assertion_type, description, "--output-log is required for output_contains assertions")
        if not os.path.isfile(output_log_path):
            return fail_result(assertion_type, description, f"Output log not found: {output_log_path}")
        found, mode = search_pattern(read_text_file(output_log_path), pattern)
        if mode.startswith("invalid regex"):
            return fail_result(assertion_type, description, mode)
        if found:
            return pass_result(assertion_type, description, f"Pattern matched in output log ({mode})")
        return fail_result(assertion_type, description, f"Pattern not found in output log: {pattern}")

    if assertion_type == "output_not_contains":
        pattern = get_required_text(assertion, "pattern")
        if not pattern:
            return fail_result(assertion_type, description, "Missing required field: pattern")
        if not output_log_path:
            return fail_result(assertion_type, description, "--output-log is required for output_not_contains assertions")
        if not os.path.isfile(output_log_path):
            return fail_result(assertion_type, description, f"Output log not found: {output_log_path}")
        output_text = read_text_file(output_log_path)
        if pattern.lower() not in output_text.lower():
            return pass_result(assertion_type, description, f"Output does not contain '{pattern}'")
        return fail_result(assertion_type, description, f"Output contains '{pattern}' but should not")

    return fail_result(assertion_type or "unknown", description, f"Unsupported assertion type: {assertion_type}")


def relative_to_project(project_path: str, candidate_path: str) -> str:
    try:
        return os.path.relpath(candidate_path, project_path)
    except ValueError:
        return candidate_path


def pass_result(assertion_type: str, description: str, details: str) -> dict:
    return {
        "type": assertion_type,
        "description": description,
        "passed": True,
        "details": details,
    }


def fail_result(assertion_type: str, description: str, details: str) -> dict:
    return {
        "type": assertion_type,
        "description": description,
        "passed": False,
        "details": details,
    }


def print_assertion_result(index: int, total: int, result: dict) -> None:
    icon = "✅" if result["passed"] else "❌"
    status = "PASS" if result["passed"] else "FAIL"
    print(f"{icon} {status} {index}/{total} - {result['description']}")
    if result.get("details"):
        print(f"    {result['details']}")


def run_eval(evals_data: dict, eval_id: int, project_path: str, output_log_path: str | None) -> dict:
    eval_entry = find_eval(evals_data, eval_id)
    if not eval_entry:
        return {
            "eval_id": eval_id,
            "project_path": project_path,
            "assertions": [],
            "passed": 0,
            "total": 0,
            "all_passed": False,
            "error": f"Eval ID {eval_id} not found",
        }

    assertions = eval_entry.get("assertions", [])
    print(f"== Eval {eval_id} ==")
    print(f"Project: {project_path}")

    if not assertions:
        print("❌ FAIL - No assertions defined for this eval")
        print("Summary: 0/0 assertions passed")
        return {
            "eval_id": eval_id,
            "project_path": project_path,
            "assertions": [],
            "passed": 0,
            "total": 0,
            "all_passed": False,
            "error": "No assertions defined for this eval",
        }

    results = [evaluate_assertion(assertion, project_path, output_log_path) for assertion in assertions]
    passed = sum(1 for result in results if result["passed"])

    for index, result in enumerate(results, start=1):
        print_assertion_result(index, len(results), result)

    print(f"Summary: {passed}/{len(results)} assertions passed")
    return {
        "eval_id": eval_id,
        "project_path": project_path,
        "output_log": output_log_path,
        "assertions": results,
        "passed": passed,
        "total": len(results),
        "all_passed": passed == len(results),
    }


def write_results_file(results_file: str, payload: dict) -> None:
    parent_dir = os.path.dirname(results_file)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)
    with open(results_file, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def derive_output_log(projects_dir: str, project_prefix: str, eval_id: int) -> str:
    return os.path.join(projects_dir, f"{project_prefix}-{eval_id}-output.log")


def validate_args(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    if args.run_all:
        if not args.projects_dir or not args.project_prefix:
            parser.error("--run-all requires --projects-dir and --project-prefix")
        return
    if not args.project_path or args.eval_id is None:
        parser.error("single-eval mode requires --project-path and --eval-id")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run eval assertions against generated project output"
    )
    parser.add_argument("--skill-path", required=True, help="Path to the skill directory")
    parser.add_argument("--project-path", help="Path to the generated project directory")
    parser.add_argument("--eval-id", type=int, help="Eval ID to validate")
    parser.add_argument("--output-log", help="Path to the eval output log")
    parser.add_argument("--results-file", help="Optional path to write JSON results")
    parser.add_argument("--run-all", action="store_true", help="Run assertions for all evals")
    parser.add_argument("--projects-dir", help="Directory containing generated eval projects")
    parser.add_argument("--project-prefix", help="Project directory prefix used with --run-all")
    args = parser.parse_args()

    validate_args(args, parser)
    evals_data = load_evals(args.skill_path)

    if args.run_all:
        all_results = []
        for eval_entry in sorted(evals_data.get("evals", []), key=lambda item: int(item.get("id", 0))):
            eval_id = int(eval_entry.get("id"))
            project_path = os.path.join(args.projects_dir, f"{args.project_prefix}-{eval_id}")
            output_log = derive_output_log(args.projects_dir, args.project_prefix, eval_id)
            result = run_eval(evals_data, eval_id, project_path, output_log)
            all_results.append(result)
            print()

        all_passed = all(result.get("all_passed") for result in all_results)
        passed_evals = sum(1 for result in all_results if result.get("all_passed"))
        print(f"Overall: {passed_evals}/{len(all_results)} evals passed")

        payload = {
            "run_all": True,
            "skill_path": args.skill_path,
            "projects_dir": args.projects_dir,
            "project_prefix": args.project_prefix,
            "results": all_results,
            "all_passed": all_passed,
        }
        if args.results_file:
            write_results_file(args.results_file, payload)
        return 0 if all_passed else 1

    result = run_eval(evals_data, args.eval_id, args.project_path, args.output_log)
    payload = {
        "run_all": False,
        "skill_path": args.skill_path,
        "result": result,
        "all_passed": result.get("all_passed", False),
    }
    if args.results_file:
        write_results_file(args.results_file, payload)
    return 0 if result.get("all_passed") else 1


if __name__ == "__main__":
    sys.exit(main())