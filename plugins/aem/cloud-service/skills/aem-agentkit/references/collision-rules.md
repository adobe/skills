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
| `.aem/constitution.md`, `.aem/specs/`, `.aem/plans/`, `.aem/tasks/`, `.aem/templates/` (from aem-orchestration-workflow) | Never touched. The skill writes only inside `.aem/context/`. |
| `_disable_agentkit` file at root | Skill skips entirely (exit 0, no writes). |

## Marker check

A file is marker-bearing when **all** of:
- Its first content line (Markdown / `.mdc`) starts with `<!-- aem-agentkit: generated`, **OR**
- It is JSON whose top-level object contains `"_generatedBy": "aem-agentkit"`.

Anything else is human-curated.

## `.agentkit-new` lifecycle

When the skill writes `<path>.agentkit-new`:
- The original file is untouched.
- The customer reviews the diff (`diff <path> <path>.agentkit-new`).
- The customer either deletes the `.agentkit-new` file (rejects changes)
  or `mv`s it over the original (accepts).
- The skill never auto-applies. Re-running the skill while a
  `.agentkit-new` exists just re-overwrites it; the original is still
  untouched.
