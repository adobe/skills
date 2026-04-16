#!/usr/bin/env python3
"""Validate App Builder manifest structure in app.config.yaml.

Enforces the guardrail: action definitions must be under
application.runtimeManifest (for standalone apps) or inside ext.config.yaml
files referenced via $include (for extension-based apps). A root-level
runtimeManifest in app.config.yaml is invalid and ignored by the CLI.

Usage:
  python3 validate_manifest_structure.py <path-to-app.config.yaml>

Exit codes:
  0 -- Valid manifest structure
  1 -- Invalid manifest structure or file errors
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None

import re


def load_yaml_file(path: Path) -> dict:
    text = path.read_text()
    if yaml:
        return yaml.safe_load(text) or {}
    return _fallback_parse(text)


def _fallback_parse(text: str) -> dict:
    """Regex-based parser for the specific patterns we need to detect."""
    result: dict = {}

    if re.search(r'^runtimeManifest:', text, re.MULTILINE):
        indent = _get_indent(text, 'runtimeManifest:')
        if indent == 0:
            result['runtimeManifest'] = True

    if re.search(r'^application:', text, re.MULTILINE):
        result['application'] = {}
        if re.search(r'^\s+runtimeManifest:', text, re.MULTILINE):
            result['application']['runtimeManifest'] = True

    if re.search(r'^extensions:', text, re.MULTILINE):
        result['extensions'] = {}
        includes = re.findall(r'\$include:\s*(.+)', text)
        result['_includes'] = [i.strip() for i in includes]

    return result


def _get_indent(text: str, key: str) -> int:
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith(key):
            return len(line) - len(stripped)
    return -1


def validate(config_path: Path) -> int:
    errors: list[str] = []
    warnings: list[str] = []

    if not config_path.exists():
        print(f"FAIL: {config_path} does not exist")
        return 1

    try:
        config = load_yaml_file(config_path)
    except Exception as e:
        print(f"FAIL: Cannot parse {config_path}: {e}")
        return 1

    has_root_manifest = "runtimeManifest" in config and "application" not in config
    has_app_manifest = (
        isinstance(config.get("application"), dict)
        and "runtimeManifest" in config.get("application", {})
    )
    has_extensions = "extensions" in config

    # Guardrail: root-level runtimeManifest is invalid
    if has_root_manifest and not has_extensions:
        errors.append(
            "Root-level runtimeManifest found in app.config.yaml. "
            "Move action definitions under application.runtimeManifest "
            "or use extensions with $include to ext.config.yaml files."
        )

    # Valid patterns
    if has_app_manifest:
        print("PASS: application.runtimeManifest found (standalone app pattern)")

    if has_extensions:
        print("PASS: extensions section found (extension-based app pattern)")
        raw_text = config_path.read_text()
        includes = re.findall(r'\$include:\s*(.+)', raw_text)
        root_dir = config_path.parent

        if not includes:
            warnings.append(
                "extensions section has no $include directives. "
                "Each extension should $include an ext.config.yaml file."
            )

        for inc in includes:
            inc_path = root_dir / inc.strip()
            if inc_path.exists():
                print(f"PASS: $include resolves: {inc.strip()}")
                _validate_ext_config(inc_path, errors)
            else:
                errors.append(f"$include path does not exist: {inc_path}")

    if not has_app_manifest and not has_extensions:
        errors.append(
            "No application.runtimeManifest and no extensions section found. "
            "The manifest has no action definitions."
        )

    # Report
    for w in warnings:
        print(f"WARN: {w}")
    for e in errors:
        print(f"FAIL: {e}")

    if errors:
        print(f"\nResult: INVALID ({len(errors)} error(s))")
        return 1

    print("\nResult: VALID")
    return 0


def _validate_ext_config(ext_path: Path, errors: list[str]) -> None:
    """Check that an ext.config.yaml has runtimeManifest with actions."""
    try:
        ext_config = load_yaml_file(ext_path)
    except Exception as e:
        errors.append(f"Cannot parse {ext_path}: {e}")
        return

    if yaml:
        manifest = ext_config.get("runtimeManifest")
        if not manifest:
            errors.append(f"{ext_path.name} has no runtimeManifest")
            return

        packages = manifest.get("packages", {})
        if not packages:
            errors.append(f"{ext_path.name} runtimeManifest has no packages")
            return

        for pkg_name, pkg_def in packages.items():
            if not isinstance(pkg_def, dict):
                continue
            actions = pkg_def.get("actions", {})
            if not actions:
                errors.append(f"Package '{pkg_name}' in {ext_path.name} has no actions")
            else:
                for action_name, action_def in actions.items():
                    if isinstance(action_def, dict):
                        func = action_def.get("function")
                        if func:
                            full = ext_path.parent / func
                            if full.exists():
                                print(f"PASS: Action '{action_name}' entry point exists")
                            else:
                                errors.append(
                                    f"Action '{action_name}' function not found: {full}"
                                )
    else:
        raw = ext_path.read_text()
        if not re.search(r'runtimeManifest:', raw):
            errors.append(f"{ext_path.name} has no runtimeManifest")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate App Builder manifest structure"
    )
    parser.add_argument(
        "config_path",
        help="Path to app.config.yaml",
    )
    args = parser.parse_args()
    return validate(Path(args.config_path).resolve())


if __name__ == "__main__":
    sys.exit(main())
