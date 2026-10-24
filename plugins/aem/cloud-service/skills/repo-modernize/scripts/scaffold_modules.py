# scripts/scaffold_modules.py
"""Render archetype-56 POM templates and scaffold only the Cloud Service modules a
project is missing — the repo-modernize "create structure" step (Phase 1).

`render` is a tiny mustache-subset substitution: it replaces exactly the five known
placeholders ({{groupId}}, {{artifactId}}, {{appId}}, {{appTitle}}, {{version}}) and
leaves any other `{{...}}` token untouched, so anything that merely looks like a
placeholder but isn't one of the five known config keys passes through unchanged
instead of raising.

`scaffold` is idempotent: it never overwrites an existing pom.xml under a target
module directory. That's load-bearing — a customer project that already has an
`all/pom.xml` (or is re-run after a developer hand-edited a generated pom) must not
have that file clobbered on a second pass. The archetype's own top-level parent
`pom.xml` template is intentionally NOT instantiated here in Phase 1; only the five
child modules (all, ui.apps, ui.apps.structure, ui.config, ui.content) are created.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List

import rm_common as C

_KEYS = ("groupId", "artifactId", "appId", "appTitle", "version")

# logical targetModules key -> template path (relative to templates_dir), one per
# Cloud Service child module. The templates_dir also ships a top-level pom.xml (the
# archetype's own parent) which is deliberately absent from this map.
_MODULES = {
    "all": "all/pom.xml",
    "uiApps": "ui.apps/pom.xml",
    "uiAppsStructure": "ui.apps.structure/pom.xml",
    "uiConfig": "ui.config/pom.xml",
    "uiContent": "ui.content/pom.xml",
}


def render(text: str, config: dict) -> str:
    """Substitute {{groupId}}/{{artifactId}}/{{appId}}/{{appTitle}}/{{version}} from
    config; leave any other {{...}} token untouched."""
    def sub(m: "re.Match[str]") -> str:
        key = m.group(1)
        return str(config[key]) if key in _KEYS else m.group(0)
    return re.sub(r"\{\{([a-zA-Z]+)\}\}", sub, text)


def scaffold(project_root, config: dict, templates_dir) -> List[str]:
    """Create the pom.xml for each of the 5 target modules that doesn't already exist.

    Idempotent: a pom.xml already present under a target module directory is left
    alone (never overwritten), so re-running against a project a developer has
    already hand-edited is always safe. Returns the paths (relative to
    project_root, using '/' via Path semantics) that were actually created; a
    module already on disk is silently skipped and does not appear in the result.
    """
    root = Path(project_root)
    tpl = Path(templates_dir)
    tm: Dict[str, str] = config["targetModules"]
    created: List[str] = []
    for key, tpl_rel in _MODULES.items():
        dest = root / tm[key] / "pom.xml"
        if dest.exists():
            continue  # idempotent: never clobber a pre-existing (possibly hand-edited) pom
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(render((tpl / tpl_rel).read_text(), config))
        created.append(str(dest.relative_to(root)))
    return created


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(description="repo-modernize module scaffolding")
    ap.add_argument("root", help="target project root")
    ap.add_argument("--config", required=True, help="path to .modernize/config.json")
    ap.add_argument(
        "--templates",
        default=str(Path(__file__).resolve().parent.parent / "assets/archetype-pom-templates"),
        help="pinned archetype-pom-templates directory (default: the skill's own copy)",
    )
    a = ap.parse_args(argv)
    created = scaffold(a.root, C.load_json(a.config), a.templates)
    print(f"scaffolded {len(created)} module pom(s): {created}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
