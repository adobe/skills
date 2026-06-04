# Collision rules — every pre-existing state

> **Beta Skill:** Outputs must be reviewed before applying to production.

This table is the single source of truth for what the skill does when a
target path already exists. Every target falls into exactly one row.

| Pre-existing state | Skill behavior |
|---|---|
| Root `AGENTS.md` present (any author) | Never modified. Read-only consult. |
| Root `CLAUDE.md` present | Never modified. |
| `<module>/AGENTS.md` present, **no** marker | Treated as human-curated. Never modified. The skill emits a TODO entry to `warningStubs`: `"human-curated <path>; skipping per-module generation"`. |
| `<module>/AGENTS.md` present, marker + **same** checksum | Skip silently (idempotent). |
| `<module>/AGENTS.md` present, marker + **different** checksum | Write new content to `<path>.agentkit-new`. Print a one-line diff summary. Original untouched. |
| `<module>/AGENTS.md` missing | Generate. |
| `.aem/context/` directory missing | Create. |
| `.aem/context/<file>` missing | Generate. |
| `.aem/context/<file>` present, **no** marker | Never overwrite. Write new content to `<file>.agentkit-new` and warn. |
| `.aem/context/<file>` present, marker + same checksum | Skip. |
| `.aem/context/<file>` present, marker + different checksum | Write `<file>.agentkit-new`. |
| `.aem/context/<file>` present, marker + **older `schemaVersion`** | Run schema migration ([`upgrade-and-migration.md`](./upgrade-and-migration.md) § Schema migration). Write migrated content to `<file>.agentkit-new`. |
| `.claude/agents/aem-<role>.md` missing | Generate (if Claude tool detected). |
| `.claude/agents/aem-<role>.md` present, no marker | Never touched. |
| `.claude/agents/aem-<role>.md` present, marker | Idempotency rules above. |
| `.claude/agents/<customer-name>.md` (non-`aem-*` filename) | Never read, never touched. The skill only writes files matching `aem-*`. |
| `.claude/commands/<name>.md` for a name we own (`new-component`, `new-sling-model`, `validate-dispatcher`, `regen-context`, `agents-md-check`) | Idempotency rules. |
| `.claude/commands/<customer-name>.md` for any other name | Never touched. |
| `.cursor/rules/aem-*.mdc` | Idempotency rules. |
| `.cursor/rules/<customer-name>.mdc` for non-`aem-*` filename | Never touched. |
| `.cursor/mcp.json` present, valid JSON | Never modified. |
| `.cursor/mcp.json` present, invalid JSON | Skip MCP wiring; log warning; do not touch the file. |
| `.cursor/mcp.json` missing **and** `.cursor/` directory exists | Write placeholder. |
| `.github/copilot-instructions.md` present | **Never modified** — customer-owned global instruction file. |
| `.github/copilot-instructions.md` missing | Create with a single-line pointer to `AGENTS.md` (only when `.github/` is detected as Copilot-active). |
| `.github/instructions/aem-<role>.instructions.md` | Idempotency rules. |
| `.github/instructions/<customer-name>.instructions.md` | Never touched. |
| `.continue/rules/aem-<role>.md` | Idempotency rules. |
| `.continue/rules/<customer-name>.md` | Never touched. |
| `.mcp.json` present | Never modified. |
| `.mcp.json` missing AND `.claude/` detected | Write placeholder. |
| `.clinerules` present (any author) | Never modified. The skill emits a `warningStubs` entry if Cline signal is detected. |
| `.clinerules` missing AND Cline signal detected | Write placeholder concatenating canonical role bodies. |
| `.windsurfrules` present | Never modified. |
| `.windsurfrules` missing AND Windsurf signal detected | Write placeholder concatenating canonical role bodies. |
| `augment.md` present | Never modified. |
| `augment.md` missing AND Augment signal detected | Write placeholder concatenating canonical role bodies. |
| `.aem/constitution.md`, `.aem/specs/`, `.aem/plans/`, `.aem/tasks/`, `.aem/templates/` (from aem-orchestration-workflow) | Never touched. The skill writes only inside `.aem/context/`. |
| `_disable_agentkit` at workspace root (regular file, directory, or symlink — contents ignored) | Skill skips entirely (exit 0, no writes). |
| `_disable_agentkit` inside a nested AEM sub-project root | That sub-project is skipped; the rest of the run proceeds. |
| Customer slash-command `<owned-name>.md` present in `.claude/commands/`, **no marker** | Never touched. The skill emits a `warningStubs` entry: `"slash-command name collision: <name> is human-curated; the matching aem-agentkit command was not installed"`. |
| Customer-renamed marker-bearing file (e.g. `core/AGENTS.md` moved to `core/docs/AGENTS-aem.md`) | Workspace-wide marker scan runs first. When a marker-bearing file is found outside the expected path **and** the expected path is missing, the skill leaves the renamed file alone and emits a `warningStubs` entry: `"marker-bearing file at unexpected location <found>; expected <wanted>; skipping regeneration of <wanted>"`. It does not regenerate the canonical location until the customer resolves the move. |

## Marker check (authenticated)

A file is treated as **skill-owned** only when **all** of:
- Its first content line (Markdown / `.mdc`) starts with the exact prefix `<!-- aem-agentkit: generated v` followed by a version string and a `; checksum: <64-hex>` portion, **OR**
- It is parseable JSON whose top-level object contains both `"_generatedBy": "aem-agentkit"` and a `"_skillVersion"` matching the expected pattern.
- **AND** the embedded `sha256` recomputes correctly over the file body excluding the marker line (Markdown / `.mdc`) or over the JSON body with the three marker fields removed (JSON).

A file with a marker-shaped prefix but a wrong, malformed, missing, or
duplicated `sha256` is treated as **human-curated** and never overwritten.
Two markers found in the same file → human-curated (an attacker / careless
paste cannot trick the skill into ownership by adding the marker comment).

Anything that fails the above is human-curated.

## `.agentkit-new` lifecycle

When the skill writes `<path>.agentkit-new`:
- The original file is untouched.
- The customer reviews the diff (`diff <path> <path>.agentkit-new`).
- The customer either deletes the `.agentkit-new` file (rejects changes)
  or `mv`s it over the original (accepts).
- The skill never auto-applies.

When a `.agentkit-new` already exists at re-run time:
- If the new content matches the existing `.agentkit-new` byte-for-byte,
  the file is left untouched (no churn, no `mtime` bump).
- If the new content differs, the existing `.agentkit-new` is rotated to
  `<path>.agentkit-new.<UTC-timestamp>` before the fresh `.agentkit-new`
  is written. The timestamp format is `YYYYMMDDTHHMMSSZ` (e.g.
  `core/AGENTS.md.agentkit-new.20260604T113053Z`). This prevents silent
  loss of an in-progress diff review.
- **Collision suffix.** If a rotated path already exists (two refreshes
  in the same second on a fast filesystem, or test-harness back-to-back
  runs), append `.<N>` starting at `1` and incrementing until the path
  is free: `core/AGENTS.md.agentkit-new.20260604T113053Z.1`,
  `…Z.2`, etc. The skill never overwrites a previously rotated file.
- A `warningStubs` entry summarises every rotation so the customer can
  find archived diffs and rejected content is never lost silently.
