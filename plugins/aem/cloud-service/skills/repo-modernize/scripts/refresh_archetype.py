#!/usr/bin/env python3
"""Update the skill's pinned AEM SDK API version to the latest (safe auto-bump),
and REPORT the archetype-structure delta for a human/test-gated refresh.

The skill deliberately pins two things (see `archetype.py`):
  - the AEM SDK API version (a version string) -- SAFE to auto-bump here.
  - the archetype TEMPLATE STRUCTURE (`assets/archetype-pom-templates/`) -- NOT
    safe to auto-swap, because the skill's deterministic transforms are calibrated
    to the current template shapes. A structure bump needs regeneration + the full
    test suite as a gate (the model CAM uses in its weekly `archetype-auto-update`
    CI job).

This script does the safe half and flags the rest:
  1. Resolves the latest `aem-sdk-api` version from Maven Central.
  2. Rewrites the pin in `scripts/archetype.py`, `scripts/refactor_poms.py`, and the
     template reactor `assets/archetype-pom-templates/pom.xml` (idempotent).
  3. Reports whether a newer ARCHETYPE (e.g. 57/58) exists, with the exact manual
     steps to regenerate the templates under the test gate.

Usage:
    python3 scripts/refresh_archetype.py            # bump SDK pin to latest, report
    python3 scripts/refresh_archetype.py --check    # report only, change nothing
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import archetype as A

_SKILL = Path(__file__).resolve().parent.parent
_TARGETS_SDK = [
    _SKILL / "scripts" / "archetype.py",
    _SKILL / "scripts" / "refactor_poms.py",
    _SKILL / "assets" / "archetype-pom-templates" / "pom.xml",
]


def _bump_sdk(old: str, new: str) -> int:
    changed = 0
    for f in _TARGETS_SDK:
        if not f.exists():
            continue
        text = f.read_text()
        if old in text:
            f.write_text(text.replace(old, new))
            changed += 1
    return changed


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="refresh the skill's pinned archetype/SDK")
    ap.add_argument("--check", action="store_true", help="report only; make no changes")
    a = ap.parse_args(argv)

    latest_sdk = A.resolve_latest_sdk_api()
    latest_arch = A.resolve_latest_archetype()
    if latest_sdk is None and latest_arch is None:
        print("error: could not reach Maven Central (offline?). Try again with network.",
              file=sys.stderr)
        return 2

    print(f"pinned : archetype-{A.PINNED_ARCHETYPE} | SDK {A.PINNED_SDK_API}")
    print(f"latest : archetype-{latest_arch or '?'} | SDK {latest_sdk or '?'}")

    # SDK: safe auto-bump.
    if latest_sdk and latest_sdk != A.PINNED_SDK_API:
        if a.check:
            print(f"\n[check] SDK pin would bump {A.PINNED_SDK_API} -> {latest_sdk}")
        else:
            n = _bump_sdk(A.PINNED_SDK_API, latest_sdk)
            print(f"\nSDK pin bumped {A.PINNED_SDK_API} -> {latest_sdk} in {n} file(s). "
                  "Run the test suite to confirm green, then commit.")
    else:
        print("\nSDK pin is already latest.")

    # Archetype structure: report only (needs test-gated regeneration).
    if latest_arch and latest_arch != A.PINNED_ARCHETYPE:
        print(f"\nNOTE: a newer archetype (archetype-{latest_arch}) is available. The template "
              "STRUCTURE is intentionally not auto-swapped -- the transforms are calibrated to "
              "the current shapes. To move to it safely:")
        print(f"  1. mvn -B archetype:generate -DarchetypeGroupId=com.adobe.aem "
              f"-DarchetypeArtifactId=aem-project-archetype -DarchetypeVersion={latest_arch} ...")
        print("  2. copy the generated module poms into assets/archetype-pom-templates/, "
              "re-parameterizing {{groupId}}/{{artifactId}}/{{appId}}/{{appTitle}}/{{version}};")
        print("  3. run the full test suite (WKND_FIXTURE=... pytest) -- fix any transform that "
              "the new template shape breaks; only accept the bump when green.")
    else:
        print("\nArchetype structure pin is already latest.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
