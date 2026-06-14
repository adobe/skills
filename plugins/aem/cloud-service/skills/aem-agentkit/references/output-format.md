# Communication contract — output format

> **Beta Skill:** Outputs must be reviewed before applying to production.

The skill writes to the user at exactly three points: a one-line
preamble before any writes, a deterministic summary after all writes,
and a one-line workspace-relative diagnostic on any error.
[`SKILL.md`](../SKILL.md) § "Communication contract" summarizes the
points and links here for the exact templates.

## 1. Preamble (one line)

Default:

```
Bootstrapping agentic workflow context for this AEM as a Cloud Service repository. No source files will be modified.
```

When the repository is not an AEM as a Cloud Service layout (see
[`SKILL.md`](../SKILL.md) § Scope), the preamble is replaced by:

```
aem-agentkit: not an AEM as a Cloud Service layout (<reason>). No writes performed.
```

When `_disable_agentkit` is detected at the workspace root, the
preamble is replaced by:

```
aem-agentkit: skipped (opt-out signal `_disable_agentkit` present at <workspace-relative-path>; disables [<sub-project list>]). No writes performed.
```

The `<sub-project list>` enumerates which sub-projects the opt-out
applies to (all of them for a workspace-root signal; just the named
sub-project for a per-sub-project signal). For a single-archetype
workspace the list reads `[all detected sub-projects]` so the customer
cannot mistake partial-scope intent for whole-workspace skip.

When `_disable_agentkit` is detected inside a nested AEM sub-project
root (and the directory passes nested-AEM-project detection), the
preamble adds one line per skipped sub-project:

```
aem-agentkit: per-sub-project opt-out at <workspace-relative-path>; skipping <subproject-name>.
```

When **no** IDE signal is detected, the preamble adds:

```
aem-agentkit: no IDE signal detected; writing universal layer only. Create .claude/, .cursor/, .continue/, .github/instructions/, .clinerules, .windsurfrules, or augment.md and re-run to layer in tool-specific artifacts.
```

The skill then exits 0 with no writes for the opt-out branches; the
no-IDE-signal branch proceeds with the universal layer.

## 1.1 IDE selection prompt

After the universal layer is planned and the IDE detection
signals from
[`per-tool-artifacts.md`](./per-tool-artifacts.md) § 1 are evaluated,
the skill prompts the customer before writing any tool-specific
artifact. The prompt is suppressed when `--silent`,
`AEM_AGENTKIT_SILENT=1`, or a `decision: ide-targets` entry in
`.aem/agentkit-overrides.yml` is present
([`per-tool-artifacts.md`](./per-tool-artifacts.md) § 1.2).

The prompt template:

```
aem-agentkit: detected agentic toolchain signals:
  [x] Claude Code     (.claude/agents/, .claude/commands/)
  [x] GitHub Copilot  (.github/copilot-instructions.md)
  [ ] Cursor          (no signal)
  [ ] Continue.dev    (no signal)
  [ ] Cline           (no signal)
  [ ] Windsurf        (no signal)
  [ ] Augment Code    (no signal)

Generate tool-specific artifacts for which toolchain(s)? Universal layer
is always written regardless of this choice.

  [a] All detected         (Claude Code, GitHub Copilot)
  [s] Single — pick one
  [m] Multi-select
  [n] None — universal layer only

> _
```

Detected toolchains appear with `[x]`; undetected toolchains appear
with `[ ]` so the customer sees the complete picture. Detected-but-not-
chosen toolchains receive no artifacts (and no `.agentkit-new` sidecar
is produced — the absence is the answer).

The selection is recorded in `.aem/agentkit-overrides.yml` as:

```yaml
schemaVersion: "1"
overrides:
  - decision: ide-targets
    value: [claude, copilot]
```

Valid `value` entries: `claude`, `cursor`, `copilot`, `continue`,
`cline`, `windsurf`, `augment`. The list is the **exclusive** target
set — toolchains not listed are not materialized. An empty list
(`value: []`) is equivalent to choosing "none" — only the universal
layer is written.

## 1.2 Root `CLAUDE.md` consent prompt

After the IDE-selection prompt, the skill issues a second prompt asking
whether it may add or update an "AEM as a Cloud Service" agentic-context
section in the customer's root `CLAUDE.md`. Root `AGENTS.md` is never
offered — it is always deferred to `ensure-agents-md`. The prompt is
suppressed under the same three escape hatches as § 1.1: `--silent`,
`AEM_AGENTKIT_SILENT=1`, or an existing `decision: claude-md` entry in
`.aem/agentkit-overrides.yml`. When suppressed with no pre-existing
decision, the silent default is **DENY** — `CLAUDE.md` is left untouched
(the safe/old behavior).

The prompt template (mirrors § 1.1):

```
aem-agentkit: root CLAUDE.md detected state: <missing | skill-owned | human-curated>.

May I add an "AEM as a Cloud Service" agentic-context section to your
root CLAUDE.md? This points coding agents at the per-module AGENTS.md and
.aem/context/* this skill generates. Root AGENTS.md is never modified.

  - missing       → a new CLAUDE.md is created with only the AEM section.
  - skill-owned   → the existing AEM section is re-rendered in place.
  - human-curated → the AEM section is appended; your existing content is
                    preserved untouched.

  [y] Yes — add / update the AEM as a Cloud Service section
  [n] No  — leave CLAUDE.md untouched (default)

> _
```

The decision is recorded in `.aem/agentkit-overrides.yml` as:

```yaml
schemaVersion: "1"
overrides:
  - decision: claude-md
    value: allow
```

Valid `value` entries: `allow`, `deny`. On `allow` the orchestrator
writes via the helper's `write-atomic` op; for a human-curated
`CLAUDE.md` it passes `allowOverwriteHumanCurated: true` (so the helper
permits the append) **only** because the developer consented. On `deny`
the skill performs no write to `CLAUDE.md`.

## 2. Summary block

Printed verbatim after every successful run. Counts are filled in from
the deterministic discovery (sorted POSIX paths, full four-level
tiebreaker on path → line → pre-sanitization value → SHA-256 of
pre-sanitization value).

Every row is **always emitted** (filled with `0` or `none` when the
tool was not detected) so a customer scanning the block can see which
tools were not detected at a glance. The previous "omit-when-zero" rule
was ambiguous; "always-emit" is the contract.

```
aem-agentkit: complete
  Universal layer:
    Per-module AGENTS.md: <N> across [<modules>]
    Indexes: components.json (<N>), osgi-services.json (<N>)
    Derived: conventions.md (<N> rules, <T> TODOs), avoid.md (<N> entries),
             glossary.md (<N> terms), test-patterns.md (<N> rules)
    Static refs: aem-api-namespaces.md, README.md
  Tool-specific layer (detected: <tool list or "none">):
    Claude:   <count> agents, <count> commands, mcp.json (existing|new-placeholder|absent)
    Cursor:   <count> rules, mcp.json (existing|new-placeholder|absent)
    Copilot:  <count> instructions, copilot-instructions.md (existing|new|absent)
    Continue: <count> rules
    Cline:    .clinerules (existing|new|absent), .clinerules.aem-roles-extra.md (present|absent)
    Windsurf: .windsurfrules (existing|new|absent), .windsurfrules.aem-roles-extra.md (present|absent)
    Augment:  augment.md (existing|new|absent), augment.md.aem-roles-extra.md (present|absent)
  Heuristics (<N>): <one line per inferred decision: <decision>=<value> at <path>>
  TODO markers: <T> items pending human review
  Warnings (<N>): <one line per warningStubs category and count, e.g. "slash-command-collision (1), suspicious-markers (0), declared-but-missing-modules (2)">
  MCP placeholders to replace: <N> (in <files>) — agent will not connect until set
  Manifest: .aem/context/.agentkit-manifest.json (<N> entries, helper v<X>)
  Refresh:   /regen-context
  Drift:     /agents-md-check
  Exit code: 0 (clean) | 2 (completed with warnings)
```

### 2.1 Row semantics

- Every row is always emitted; zero values are explicit (`0`, `none`,
  `absent`) so the customer never wonders whether a row was suppressed.
- The `Heuristics` group expands inline (one line per recorded
  decision) so the customer reviews the inferences without having to
  open the manifest.
- The `Warnings` row names every distinct category with a count. The
  full text of each warning is in the corresponding index file's
  `warningStubs[]`; the summary lists the categories so nothing is
  silently buried.
- The `MCP placeholders to replace` row is emitted whenever `.mcp.json`
  or `.cursor/mcp.json` was written from the placeholder template and
  still contains one or more `_TODO_*` server-name keys (see
  [`mcp-wiring.md`](./mcp-wiring.md)). The row reads `0` when no
  placeholder was written this run.
- `Exit code` mirrors the process exit: `0` (clean), `2` (completed
  with one or more `warningStubs` entries), `1` (hard failure — in
  which case the summary block is replaced by the error diagnostic
  below).

## 3. Error diagnostic

Single line. Always workspace-relative path (no absolute paths, no
`~/`). Always names the failing check.

```
aem-agentkit: failed (<workspace-relative-path>): <check name>: <one-line reason>
```

The skill leaves no partial files (each individual file write is
atomic via the deterministic helper; earlier successful writes from
prior steps remain on disk and resume idempotently on the next
invocation).

## 4. After the summary

The skill yields back so the user's original request proceeds with the
new context loaded.
