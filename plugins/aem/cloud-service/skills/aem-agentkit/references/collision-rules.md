# Collision rules — every pre-existing state

> **Beta Skill:** Outputs must be reviewed before applying to production.

This table is the single source of truth for what the skill does when a
target path already exists. Every target falls into exactly one row.

| Pre-existing state | Skill behavior |
|---|---|
| Root `AGENTS.md` present (any author) | Never modified. Read-only consult. Always deferred to `ensure-agents-md`. |
| Root `CLAUDE.md` missing, consent **declined** (or silent default DENY) | Not created. No write. This is the old/default behavior. |
| Root `CLAUDE.md` missing, consent **accepted** | Create `CLAUDE.md` carrying only the marked "AEM as a Cloud Service" section. Written via `write-atomic` (no `allowOverwriteHumanCurated` needed — the file does not exist). |
| Root `CLAUDE.md` present, **skill-owned** AEM section, consent accepted | Re-render the marked AEM section in place (idempotent if unchanged). Skill-owned, so `write-atomic` permits it without `allowOverwriteHumanCurated`. |
| Root `CLAUDE.md` present, **human-curated**, consent **declined** (or silent default DENY) | Never modified. |
| Root `CLAUDE.md` present, **human-curated**, consent **accepted** | **Append** a marked "AEM as a Cloud Service" section to the end; existing content preserved. The orchestrator passes `write-atomic`'s `allowOverwriteHumanCurated: true` ONLY because the developer consented. |
| `<module>/AGENTS.md` present, **no** marker | Treated as human-curated. Never modified. The skill emits a `warningStubs` entry: `"human-curated <path>; skipping per-module generation"`. |
| `<module>/AGENTS.md` present, marker + **same** checksum | Skip silently (idempotent). |
| `<module>/AGENTS.md` present, marker + **different** checksum | Write new content to `<path>.agentkit-new`. Print a one-line diff summary. Original untouched. |
| `<module>/AGENTS.md` missing | Generate. |
| `<module>/AGENTS.md` present, marker prefix matches but checksum fails to parse | **Suspicious marker.** Treated as human-curated; emit a distinct `suspiciousMarkers` `warningStubs` entry so `/agents-md-check` surfaces the file for review. |
| `.aem/context/` directory missing | Create. |
| `.aem/context/<file>` missing | Generate. |
| `.aem/context/<file>` present, **no** marker | Never overwrite. Write new content to `<file>.agentkit-new` and warn. |
| `.aem/context/<file>` present, marker + same checksum | Skip. |
| `.aem/context/<file>` present, marker + different checksum | Write `<file>.agentkit-new`. |
| `.aem/context/<file>` present, marker + **older `schemaVersion`** | Run schema migration ([`upgrade-and-migration.md`](./upgrade-and-migration.md) § Schema migration). Write migrated content to `<file>.agentkit-new`. |
| `.aem/context/<file>` present, marker + `_static: true` + different content | **Static-reference exception.** Overwrite in place (no `.agentkit-new` sidecar) — these files have no customer content to lose. Limited to `.aem/context/aem-api-namespaces.md` and `.aem/context/README.md`. |
| `.aem/context/.agentkit-manifest.json` present, marker + same checksum | Replace with the fresh manifest (always rewritten in full at end of run; idempotent if nothing changed). |
| `.aem/context/.agentkit-manifest.json` present, **no** marker | Treated as human-curated; warning emitted, manifest not written, exit code `1`. Customer must move or delete the file. |
| `.aem/context/.agentkit.lock` present, held by another invocation | Exit `1` with the concurrency diagnostic. |
| `.claude/agents/aem-<role>.md` missing | Generate (if Claude tool detected). |
| `.claude/agents/aem-<role>.md` present, no marker | Never touched. |
| `.claude/agents/aem-<role>.md` present, marker | Idempotency rules above. |
| `.claude/agents/<customer-name>.md` (non-`aem-*` filename) | Never read, never touched. The skill only writes files matching `aem-*`. |
| `.claude/commands/<name>.md` for a name we own (`new-component`, `new-sling-model`, `validate-dispatcher`, `regen-context`, `agents-md-check`) | Idempotency rules. |
| `.claude/commands/<customer-name>.md` for any other name | Never touched. |
| `.cursor/rules/aem-*.mdc` | Idempotency rules. |
| `.cursor/rules/<customer-name>.mdc` for non-`aem-*` filename | Never touched. |
| `.cursor/mcp.json` present, valid JSON (parses under RFC 8259 strict, non-empty, top-level object) | Never modified. |
| `.cursor/mcp.json` present, invalid JSON (parse fails, 0 bytes, top-level non-object) | Skip MCP wiring; log warning; do not touch the file. The 0-byte case is explicitly flagged in `/agents-md-check` so the customer sees it. |
| `.cursor/mcp.json` missing **and** `.cursor/` directory exists | Write placeholder. |
| `.github/copilot-instructions.md` present | **Never modified** — customer-owned global instruction file. |
| `.github/copilot-instructions.md` missing | Create with a single-line pointer to `AGENTS.md` (only when `.github/` is detected as Copilot-active). |
| `.github/instructions/aem-<role>.instructions.md` | Idempotency rules. |
| `.github/instructions/<customer-name>.instructions.md` | Never touched. |
| `.continue/rules/aem-<role>.md` | Idempotency rules. |
| `.continue/rules/<customer-name>.md` | Never touched. |
| `.mcp.json` present, valid JSON (RFC 8259 strict, non-empty, top-level object) | Never modified. |
| `.mcp.json` present, invalid JSON or 0 bytes | Skip MCP wiring; log warning; do not touch the file. `/agents-md-check` flags the 0-byte case. |
| `.mcp.json` missing AND `.claude/` detected | Write placeholder. |
| `.clinerules` present (any author) | Never modified. The skill emits a `warningStubs` entry if Cline signal is detected. |
| `.clinerules` missing AND Cline signal detected | Write placeholder concatenating canonical role bodies (with `<file>.aem-roles-extra.md` sidecar for any deferred role). |
| `.windsurfrules` present | Never modified. |
| `.windsurfrules` missing AND Windsurf signal detected | Write placeholder concatenating canonical role bodies (with `<file>.aem-roles-extra.md` sidecar for any deferred role). |
| `augment.md` present | Never modified. |
| `augment.md` missing AND Augment signal detected | Write placeholder concatenating canonical role bodies (with `<file>.aem-roles-extra.md` sidecar for any deferred role). |
| `.aem/constitution.md`, `.aem/specs/`, `.aem/plans/`, `.aem/tasks/`, `.aem/templates/` (from aem-orchestration-workflow) | Never touched. The skill writes only inside `.aem/context/`. |
| `.aem/agentkit-overrides.yml` present with no `decision: ide-targets` entry | **Read-only** by the skill for the heuristic-override entries. On first IDE-selection prompt answer, the skill appends a `decision: ide-targets` entry (see [`manifest.md`](./manifest.md) § Overrides + [`output-format.md`](./output-format.md) § 1.1). |
| `.aem/agentkit-overrides.yml` present with `decision: ide-targets` already populated | Read-only. The IDE selection prompt is suppressed; the entry is honored as the exclusive target set. |
| `.aem/agentkit-overrides.yml` present with no `decision: claude-md` entry | On the first root-`CLAUDE.md` consent answer, the skill appends a `decision: claude-md` entry (`value: allow` or `deny`) so re-runs don't re-prompt (see [`output-format.md`](./output-format.md) § 1.2). |
| `.aem/agentkit-overrides.yml` present with `decision: claude-md` already populated | Read-only. The `CLAUDE.md` consent prompt is suppressed; `value: allow` writes/updates the marked AEM section, `value: deny` leaves `CLAUDE.md` untouched. Same suppression rules as `ide-targets` (`--silent` / `AEM_AGENTKIT_SILENT=1` / pre-existing entry); silent default with no entry is DENY. |
| Tool-specific artifact already exists with the marker for a tool the customer **deselected** in the current run | Left in place; not regenerated, not deleted. Removal is an explicit customer operation (delete the marker-bearing files per [`upgrade-and-migration.md`](./upgrade-and-migration.md) § 4 Reversibility). |
| `_disable_agentkit` at workspace root (any regular file, directory, or symlink — `lstat`-by-name; contents and target are never dereferenced) | Skill skips entirely (exit 0, no writes). For single-archetype workspaces the preamble enumerates the disabled sub-project list explicitly to prevent partial-scope confusion. The 1024-byte sanity threshold from earlier v0.x designs was dropped — `_disable_agentkit` is an obscure-enough name that name-collision with a committed binary is implausible, and the threshold produced more "why isn't opt-out engaging?" support tickets than the binary-collision risk it defended against. |
| `_disable_agentkit` inside a nested AEM sub-project root | That sub-project is skipped; the rest of the run proceeds. The directory containing `_disable_agentkit` must independently pass nested-AEM-project detection ([`per-module-agents-md.md`](./per-module-agents-md.md) § 1); otherwise the file is ignored. |
| Customer slash-command `<owned-name>.md` present in `.claude/commands/`, **no marker** | Never touched. The skill emits a `warningStubs` entry of the form `"slash-command name collision: <name> is human-curated; aem-agentkit slash command not installed. Invoke @aem-<role> directly via the IDE's subagent invocation."` so the alternate invocation is visible. |
| Customer-renamed marker-bearing file (e.g. `core/AGENTS.md` moved to `core/docs/AGENTS-aem.md`) | Workspace-wide marker scan runs first. When a marker-bearing file is found outside the expected path **and** the expected path is missing, the skill leaves the renamed file alone and emits a `warningStubs` entry: `"marker-bearing file at unexpected location <found>; expected <wanted>; skipping regeneration of <wanted>"`. It does not regenerate the canonical location until the customer resolves the move. |
| Marker prefix matches across **two or more** files at the same expected path (impossible on a standard filesystem, but defensive) | Both files treated as human-curated; `warningStubs` entry. |
| Case-insensitive filesystem collision (default macOS APFS, Windows NTFS): the skill is asked to write `AGENTS.md` and a pre-existing `agents.md` is the same realpath | Helper's `write-atomic` op refuses with a `case-insensitive filesystem collision` diagnostic. The skill surfaces it as a `warningStubs` entry asking the customer to rename their lowercase file or pass `allowCaseCollision: true` explicitly. Default-refuses to avoid silently overwriting customer content on case-insensitive filesystems. |

## Marker check (authenticated)

Marker shape and checksum rules are defined in
[`upgrade-and-migration.md`](./upgrade-and-migration.md) § 1 (the
authoritative source).

A file is treated as **skill-owned** only when its marker prefix matches
the exact shape defined there **and** the embedded `sha256` recomputes
correctly. The following additional rules apply:

- A file with a marker-shaped prefix but a wrong, malformed, missing, or
  duplicated `sha256` is treated as **human-curated** and never overwritten.
- Two markers found in the same file → human-curated (an attacker / careless
  paste cannot trick the skill into ownership by adding the marker comment).
- Markers whose first line *almost* matches the shape but fails to parse
  are emitted as a distinct `suspiciousMarkers` category by `/agents-md-check`
  so the customer can find files where a marker was edited but the file
  should still be reviewed.

Anything that fails the above is human-curated.

This floor is **helper-enforced**, not merely an orchestrator
convention: the helper's `write-atomic` op (see
[`helpers.md`](./helpers.md) § 2.5, step 7 `_is_skill_owned`) refuses to
overwrite a pre-existing human-curated file unless the caller passes
`allowOverwriteHumanCurated: true`. The collision decisions in the table
above are therefore backstopped in the helper — an orchestrator bug or
prompt injection cannot silently clobber human-curated content.

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
  `…Z.2`, etc. The rotation uses the helper's `write-atomic` operation
  with `O_CREAT | O_EXCL`, so the probe-and-create loop is atomic
  per-path; the skill never overwrites a previously rotated file.
- A `warningStubs` entry summarises every rotation so the customer can
  find archived diffs and rejected content is never lost silently.

## Root `CLAUDE.md` consent prompt — state detection and decision flow

After the IDE-selection prompt, the skill issues a **second** prompt
asking whether it may add or update an "AEM as a Cloud Service"
agentic-context section in the customer's root `CLAUDE.md`. Root
`AGENTS.md` is **never** touched — it is deferred to `ensure-agents-md`;
only `CLAUDE.md` is offered here.

### State detection

The skill classifies the existing `CLAUDE.md`:

- **Missing** — no root `CLAUDE.md` exists.
- **Skill-owned** — a `CLAUDE.md` whose AEM section recomputes its
  marker correctly (the helper's `_is_skill_owned` check,
  [`helpers.md`](./helpers.md) § 2.5 step 7).
- **Human-curated** — a `CLAUDE.md` that exists without a valid AEM
  section marker (any other content the developer authored).

### Decision flow

The prompt template lives in [`output-format.md`](./output-format.md) § 1.2.

- On **decline** → skip entirely. The skill does **not** touch
  `CLAUDE.md` (this is the default behavior).
- On **accept**:
  - Missing → write a `CLAUDE.md` carrying only the marked AEM section.
  - Skill-owned → re-render the marked AEM section in place.
  - Human-curated → **append** a marked "AEM as a Cloud Service" section
    to the end of the existing file without clobbering existing content.
    Because the file is human-curated, the orchestrator passes the
    helper's `allowOverwriteHumanCurated: true` to `write-atomic`
    **only** because the developer consented on this prompt.

### Persistence

The consent decision is persisted in `.aem/agentkit-overrides.yml` as
`decision: claude-md` with value `allow` or `deny`, so re-runs do not
re-prompt.

### Suppression (CI / headless)

The prompt is suppressed under any of:

- CLI flag `--silent` on the invocation.
- Environment variable `AEM_AGENTKIT_SILENT=1`.
- `.aem/agentkit-overrides.yml` already contains a `decision: claude-md`
  entry — that entry wins outright.

The silent default is **DENY** (`CLAUDE.md` is left untouched), which is
the safe behavior: a scripted or CI invocation never writes `CLAUDE.md`
unless an existing `decision: claude-md` entry says `allow`.
