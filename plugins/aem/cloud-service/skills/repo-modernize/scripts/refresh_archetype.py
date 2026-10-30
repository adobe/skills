#!/usr/bin/env python3
"""Refresh the archetype templates bundled with repo-modernize (maintainers and CI).

    python3 scripts/refresh_archetype.py                 # report pinned vs latest; no changes
    python3 scripts/refresh_archetype.py --update        # regenerate from the latest archetype
    python3 scripts/refresh_archetype.py --update --version 58 --sdk-version <version>

`--update` generates Adobe's AEM project archetype with Maven, converts it into the six
templates under `assets/archetype-pom-templates/` (see `archetype_templates.py`), checks
they fit what the transforms need, and rewrites every pin (`archetype.py`,
`refactor_poms.py`) from the regenerated reactor. Then run the test suite
(`plugins/aem/cloud-service/test/repo-modernize/run-tests.sh`) and open a pull request.

Exit codes: 0 done or nothing to report; 1 the archetype's templates don't fit the
transforms (a code change is needed first); 2 Maven or Maven Central unavailable.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
from pathlib import Path

import archetype as A
import archetype_templates as AT

_SKILL = Path(__file__).resolve().parent.parent
_TEMPLATES = _SKILL / "assets" / "archetype-pom-templates"
# file -> {constant: key into the new pins}
_PIN_CONSTANTS = {
    _SKILL / "scripts" / "archetype.py": {
        "PINNED_ARCHETYPE": "archetype", "PINNED_SDK_API": "aem.sdk.api",
        "PINNED_AEMANALYSER": "aemanalyser.version"},
    _SKILL / "scripts" / "refactor_poms.py": {
        "_AEM_SDK_API_VERSION": "aem.sdk.api", "_AEMANALYSER_VERSION": "aemanalyser.version",
        "_ARCHETYPE_FILEVAULT_VERSION": "filevault",
        "_ARCHETYPE_CONTENT_PACKAGE_VERSION": "content-package"},
}


def rewrite_pins(new: dict) -> list:
    """Set each pin constant to its new value; returns '<file>: NAME old -> new' lines."""
    changes = []
    for path, constants in _PIN_CONSTANTS.items():
        text = path.read_text(encoding="utf-8")
        for name, key in constants.items():
            pattern = re.compile(rf'^({re.escape(name)}\s*=\s*)"([^"]*)"', re.M)
            found = pattern.findall(text)
            if len(found) != 1:
                raise RuntimeError(f"expected one `{name} = \"...\"` in {path.name}, found {len(found)}")
            old = found[0][1]
            if old != new[key]:
                text = pattern.sub(lambda m: f'{m.group(1)}"{new[key]}"', text)
                changes.append(f"{path.name}: {name} {old} -> {new[key]}")
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
    return changes


def update(version: str, sdk_version: str) -> int:
    work = tempfile.mkdtemp(prefix="repo-modernize-refresh-")
    try:
        templates, coords = AT.build(version, work, sdk_version)
    except AT.ArchetypeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1 if isinstance(e, AT.TemplatesDoNotFit) else 2
    finally:
        shutil.rmtree(work, ignore_errors=True)
    AT.write(templates, _TEMPLATES)
    new = {**AT.pins(templates["pom.xml"]), "archetype": coords[2]}
    changes = rewrite_pins(new)
    print(f"templates regenerated from {':'.join(coords)} with AEM SDK {new['aem.sdk.api']}")
    for line in changes or ["pins unchanged"]:
        print(f"  {line}")
    print("next: plugins/aem/cloud-service/test/repo-modernize/run-tests.sh")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="refresh repo-modernize's bundled archetype templates")
    ap.add_argument("--check", action="store_true", help="report only (the default)")
    ap.add_argument("--update", action="store_true",
                    help="regenerate the templates and pins (needs Maven and network)")
    ap.add_argument("--version", default="latest",
                    help="archetype version for --update (default: latest)")
    ap.add_argument("--sdk-version", default="latest",
                    help="AEM SDK API version for --update (default: latest)")
    a = ap.parse_args(argv)

    latest_arch = A.resolve_latest_archetype()
    latest_sdk = A.resolve_latest_sdk_api()
    if not a.update:
        if latest_arch is None and latest_sdk is None:
            print("error: could not reach Maven Central (offline?).", file=sys.stderr)
            return 2
        print(f"pinned : archetype-{A.PINNED_ARCHETYPE} | AEM SDK {A.PINNED_SDK_API}")
        print(f"latest : archetype-{latest_arch or '?'} | AEM SDK {latest_sdk or '?'}")
        if (latest_arch, latest_sdk) != (A.PINNED_ARCHETYPE, A.PINNED_SDK_API):
            print("run with --update to regenerate the templates and pins")
        return 0

    version = latest_arch if a.version == "latest" else a.version
    sdk = latest_sdk if a.sdk_version == "latest" else a.sdk_version
    if not version or not sdk:
        print("error: could not reach Maven Central to resolve the latest archetype / SDK; "
              "pass --version and --sdk-version explicitly.", file=sys.stderr)
        return 2
    return update(version, sdk)


if __name__ == "__main__":
    raise SystemExit(main())
