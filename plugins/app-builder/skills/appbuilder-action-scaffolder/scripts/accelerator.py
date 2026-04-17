#!/usr/bin/env python3
"""Generate a skill-specific App Builder execution plan for first-wave skills."""

from __future__ import annotations

import argparse
from pathlib import Path

SKILL_TITLE = "App Builder Action Scaffolder"
CONFIG = {
  "focus": "Create a consistent action scaffold with validation, logging, and test hooks.",
  "discovery": [
    "Define action input/output contract and status code behavior.",
    "Confirm dependency and shared utility reuse expectations.",
    "Capture latency and retry requirements for upstream calls."
  ],
  "commands": [
    "aio app add action",
    "npm run lint",
    "npm test",
    "aio app dev",
    "aio app deploy --workspace {workspace}"
  ],
  "validation": [
    "Action handles invalid input with deterministic error responses.",
    "Action logs include request context for debugging.",
    "Unit tests cover success and failure paths."
  ],
  "artifacts": [
    "Action contract document",
    "Action source and tests",
    "Deployment verification notes"
  ]
}


def render_commands(workspace: str) -> list[str]:
    rendered = []
    for command in CONFIG["commands"]:
        line = command
        line = line.replace("{workspace}", workspace)
        rendered.append(line)
    return rendered


def build_document(
    ticket: str,
    workspace: str,
) -> str:
    lines = [
        f"# {SKILL_TITLE} Execution Plan",
        "",
        f"Ticket: {ticket}",
        f"Workspace: {workspace}",
        "",
        "## Focus",
        CONFIG["focus"],
        "",
        "## Discovery Checklist",
    ]

    for item in CONFIG["discovery"]:
        lines.append(f"- [ ] {item}")

    lines.extend(["", "## Command Scaffolds", "```bash"])
    lines.extend(render_commands(workspace))
    lines.append("python3 skills/_shared/scripts/validate_manifest_structure.py path/to/app.config.yaml")
    lines.extend(["```", "", "## Validation Gates"])

    for item in CONFIG["validation"]:
        lines.append(f"- [ ] {item}")
    lines.append("- [ ] app.config.yaml validated: application.runtimeManifest present and root-level runtimeManifest absent")

    lines.extend(["", "## Expected Artifacts"])
    for item in CONFIG["artifacts"]:
        lines.append(f"- [ ] {item}")

    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a markdown execution plan for this App Builder skill"
    )
    parser.add_argument("--ticket", default="[ticket-id]", help="Ticket identifier")
    parser.add_argument("--workspace", default="dev", help="Target App Builder workspace")
    parser.add_argument(
        "--out",
        default="",
        help="Optional path to write the generated markdown plan",
    )
    args = parser.parse_args()

    doc = build_document(
        args.ticket,
        args.workspace,
    )

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(doc)
        print(f"Wrote execution plan to {out_path}")
    else:
        print(doc, end="")


if __name__ == "__main__":
    main()
