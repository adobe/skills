# Per-tool artifacts — Claude / Cursor / Copilot / Codex / Continue / Cline / Windsurf / Augment

> **Beta Skill:** Outputs must be reviewed before applying to production.

This reference defines how the skill projects a single canonical role-prompt
source into each IDE's artifact format. The **content** is identical across
IDEs; only the frontmatter and file extension differ. This is the
equivalence guarantee promised in SKILL.md.

## Contents

- § 0. LLM-agnostic foundation
- § 1. Silent IDE detection and stability tiers
- § 2. Canonical role-prompt source
- § 3. Projection rules (per IDE)
- § 4. Conditional generation
- § 5. Index self-update rule (indexable roles only)
- § 6. Size budgets and deferred-role sidecar
- § 7. Self-validation

## 0. LLM-agnostic foundation

The **universal layer** (`AGENTS.md` + `.aem/context/*`) is fully tool-
agnostic. Any coding agent that follows the open `AGENTS.md` standard
(Claude Code, Cursor, GitHub Copilot, OpenAI Codex, Continue.dev, Cline,
Roo Code, Windsurf, Aider, Augment, and any future adopter) gets value
from it without any tool-specific configuration.

The **tool-specific layer** is an optimization, not a requirement. It
gives each tool's native routing system (Claude subagents, Cursor `.mdc`
globs, Copilot `applyTo` instructions, Continue rules, Cline / Windsurf
rule files) the same canonical content so agents route to the right
guidance based on the file under edit.

If a customer uses an agent the skill does not have a projection for,
they still get the full universal layer, which is enough for AGENTS.md-
spec-compliant agents to behave correctly.

## 1. IDE detection signals and selection

Detection signals are deliberately tight to avoid false positives. Each
tool's row below is a **necessary** condition: if the row's signal does
not match, the tool is considered absent and is never offered in the
selection prompt.

| Tool | Positive signal (both halves where applicable) | Stability tier |
|---|---|---|
| Claude Code | `.claude/agents/` is non-empty OR `.claude/commands/` is non-empty OR `.claude/rules/` is non-empty (an empty `.claude/` directory left by an IDE installer is **not** a signal) | **stable** |
| Cursor | `.cursor/rules/` is non-empty OR `.cursor/mcp.json` exists | **stable** |
| GitHub Copilot | `.github/copilot-instructions.md` exists (the presence of any `.github/*.yml` workflow is **not** a signal — GitHub Actions ≠ Copilot) | **stable** |
| Codex (OpenAI) | Always — Codex reads `AGENTS.md` natively per the open standard | **stable** |
| Continue.dev | `.continue/rules/` is non-empty | **stable** |
| Cline (VS Code) | `.clinerules` file at workspace root, OR `.vscode/extensions.json` lists `saoudrizwan.claude-dev` | **stable** |
| Windsurf | `.windsurfrules` file at workspace root, OR `.codeium/` directory has content | **stable** |
| Aider | Always — Aider reads `AGENTS.md` natively | **stable** |
| Augment Code | `.augment/` directory or `augment.md` at root | **stable** |
| **Native AGENTS.md adopters (no projection needed — universal layer is enough)** | Always covered: OpenAI Codex, Gemini CLI, Zed, Factory, Jules, Devin, Amp, Kilo, RooCode, Warp, JetBrains Junie, Ona, Phoenix, and any future AGENTS.md-spec-compliant agent | **stable** |

### 1.1 Selection prompt

After detection, the skill presents the customer with the matched
toolchains and waits for one of four answers: **all** (every detected
toolchain), **single** (pick one), **multi** (multi-select subset), or
**none** (universal layer only). The exact prompt template is in
[`output-format.md`](./output-format.md) § 1.1.

The selection is persisted under the `decision: ide-targets` entry of
`.aem/agentkit-overrides.yml` (schema in
[`manifest.md`](./manifest.md) § 5). On subsequent runs the override
takes precedence and the prompt is skipped.

### 1.2 Suppressing the prompt (headless / CI runs)

The prompt is suppressed under any one of:

- CLI flag `--silent` (or skill argument `silent: true`).
- Environment variable `AEM_AGENTKIT_SILENT=1`.
- `.aem/agentkit-overrides.yml` already contains a `decision: ide-targets` entry — that entry is honored verbatim, no prompt.

In suppressed mode the skill writes for **every** detected toolchain
(the original silent behavior), so existing scripted invocations
remain reproducible. The CI integration recipe is therefore: commit
`.aem/agentkit-overrides.yml` with the team's chosen `ide-targets` list
on first run; every subsequent CI invocation honors it without
prompting.

### 1.3 Adding or removing IDEs on later runs

To layer in a tool the customer originally declined: either edit
`.aem/agentkit-overrides.yml` and add the new tool to the
`ide-targets` list, or delete the entry entirely (the next run
prompts again). To remove a tool whose artifacts already exist:
delete the marker-bearing files (the skill's reversibility recipe
in [`upgrade-and-migration.md`](./upgrade-and-migration.md) § 4) and
re-run. The skill never auto-removes tool artifacts when the customer
deselects a tool — those files have markers and remain skill-owned;
removing them is an explicit operation.

All projections are first-class. The skill's release process verifies
each projection's syntax against the upstream IDE's documented format
before every release; an IDE that materially changes its format produces
a follow-up release. The customer can pin `aem-agentkit` versions in
their plugin manifest if they need a stable target.

## 2. Canonical role-prompt source

Each role has one source-of-truth file under
[`templates/roles/`](./templates/roles/):

| Role | Source |
|---|---|
| Component author | [`templates/roles/role.component-author.md`](./templates/roles/role.component-author.md) |
| Sling Model author | [`templates/roles/role.sling-model-author.md`](./templates/roles/role.sling-model-author.md) |
| HTL author | [`templates/roles/role.htl-author.md`](./templates/roles/role.htl-author.md) |
| Dispatcher editor | [`templates/roles/role.dispatcher-editor.md`](./templates/roles/role.dispatcher-editor.md) |
| OSGi configuration author | [`templates/roles/role.osgi-config-author.md`](./templates/roles/role.osgi-config-author.md) |
| Integration test author (conditional — `it.tests/` exists) | [`templates/roles/role.integration-test-author.md`](./templates/roles/role.integration-test-author.md) |
| UI test author (conditional — `ui.tests/` exists) | [`templates/roles/role.ui-test-author.md`](./templates/roles/role.ui-test-author.md) |
| Content Fragment author (conditional) | [`templates/roles/role.content-fragment-author.md`](./templates/roles/role.content-fragment-author.md) |
| Guardrails (always-on, every IDE) | [`templates/roles/role.guardrails.md`](./templates/roles/role.guardrails.md) |

The body of each source file is the system prompt the agent will see. The
projection logic for each IDE wraps that body with the correct
frontmatter and extension; no content is rewritten between IDEs.

### Sub-project resolution in role bodies

Role bodies that reference paths like `<project>/components/<name>/` or
`<module>/...` resolve `<project>`, `<module>`, and the path prefix at
runtime by walking up from the file under edit to the closest `pom.xml`
whose directory either is the workspace root or matches a nested-AEM-
project detection from [`per-module-agents-md.md`](./per-module-agents-md.md)
§ 1. Each role body states this explicitly. In multi-brand monorepos
the agent therefore writes into the correct sub-project tree
(`brand-a/ui.apps/...` or `brand-b/ui.apps/...`) instead of guessing
from a single hard-coded path.

## 3. Projection rules

### 3.1 Claude Code — `.claude/agents/aem-<role>.md`

```markdown
<!-- aem-agentkit: generated v1.0.0-beta; safe to delete or edit. checksum: <sha256> -->
---
name: aem-<role>
description: <one-line from canonical source>
model: sonnet
tools: Read, Glob, Grep, Edit, Write, Bash
---

<body of canonical role source>
```

#### 3.1.1 Claude Code — `.claude/rules/aem-<role>.md` (passive projection)

A lighter sibling of the subagent file at `.claude/agents/`. The body is
the **same canonical role source** (§ 7 — semantic equivalence). The
frontmatter omits `name:` (so the file is not exposed as an invocable
subagent), omits the `tools:` allow-list (rules don't execute), and
carries only `description:` plus a `globs:` hint that mirrors the Cursor
glob table below. The agent treats this file as **passive context** —
the file is read into context when one of the matching globs is under
edit, in the same way Cursor reads `.cursor/rules/*.mdc` and Copilot
reads `.github/instructions/*.instructions.md`.

```markdown
<!-- aem-agentkit: generated v1.0.0-beta; safe to delete or edit. checksum: <sha256> -->
---
description: <one-line from canonical source>
globs:
  - <glob pattern from role>
---

<body of canonical role source>
```

The Claude rules surface is intentionally a parallel projection (not a
replacement) of the subagent surface: `.claude/agents/` remains the
delegation target for explicit `@aem-<role>` invocations; `.claude/rules/`
is the glob-scoped passive guidance Cursor users have had since the PR's
initial cut. Customers using Claude Code without delegating to a
subagent now read the same role body the Cursor user reads, instead of
relying solely on per-module `AGENTS.md`.

The `.claude/rules/` file is **never** invoked as a subagent — its
frontmatter intentionally omits `name:` to enforce this. If a future
Claude Code version surfaces rules files in the subagent picker, that
absence keeps the file read-only.

Manifest entry: each generated `.claude/rules/aem-<role>.md` is recorded
under `files[]` with `kind: "tool-claude-rule"` ([`manifest.md`](./manifest.md)
§ 3 — `files[].kind`). The kind disambiguates it from the invocable
`.claude/agents/` projection (`kind: "tool-claude-agent"`) so
`/agents-md-check` and `.agentkit-new` rotation handle each surface
independently.

Plus slash commands at `.claude/commands/`:

| File | Owns name |
|---|---|
| `new-component.md` | `/new-component <name>` |
| `new-sling-model.md` | `/new-sling-model <FQCN>` |
| `validate-dispatcher.md` | `/validate-dispatcher` (only if `dispatcher/` exists) |
| `regen-context.md` | `/regen-context` |
| `agents-md-check.md` | `/agents-md-check` |

**Slash-command pre-flight.** Before writing any of the above, the skill
scans `.claude/commands/` for files of the same name. A matching name
that is **not** marker-bearing (per [`collision-rules.md`](./collision-rules.md))
is human-curated — usually owned by a sibling skill such as
`create-component`. The skill does **not** overwrite it; instead it
emits a `warningStubs` entry: `"slash-command name collision: /<name>
is human-curated; aem-agentkit slash command not installed. Invoke
@aem-<role> directly via the IDE's subagent invocation."` The Claude
projection still ships the role agents (`aem-component-author` etc.);
the customer can invoke them directly. The summary block surfaces one
line per collision with the alternate invocation so the customer is
never told a feature is missing without being told how to reach it.

**Input-argument validation.** `<name>` in `/new-component` must match
`^[a-z][a-z0-9-]{0,63}$`; `<FQCN>` in `/new-sling-model` must match the
FQCN regex documented in the template. `MVN_CMD` template variable is
restricted to the literal set `{"mvn", "./mvnw"}`; any other resolved
value emits a `warningStubs` entry and the build line is omitted from
the rendered command artifact.

Plus MCP wiring at `.mcp.json` (see [`mcp-wiring.md`](./mcp-wiring.md)).

### 3.2 Cursor — `.cursor/rules/aem-<role>.mdc`

```markdown
<!-- aem-agentkit: generated v1.0.0-beta; safe to delete or edit. checksum: <sha256> -->
---
description: <one-line from canonical source>
globs:
  - <glob pattern from role>
alwaysApply: false
---

<body of canonical role source>
```

Globs per role:

| Role | `globs:` |
|---|---|
| component-author | `**/ui.apps/**`, `**/ui.apps.*/**` |
| sling-model-author | `**/src/main/java/**` |
| htl-author | `**/ui.apps*/**/*.html` |
| dispatcher-editor | `dispatcher/**` |
| osgi-config-author | `**/ui.config/**`, `**/ui.config.*/**`, `**/jcr_root/apps/*/config*/**` |
| integration-test-author | `**/it.tests/**` |
| ui-test-author | `**/ui.tests/**` |
| content-fragment-author | `**/conf/**/settings/dam/cfm/**`, `**/content/dam/**` |
| guardrails | `**/*` with `alwaysApply: true` |

`htl-author` is intentionally scoped to `**/ui.apps*/**/*.html` (note the
trailing `*` after `ui.apps`) so it covers customer modules like
`ui.apps.commerce/` or `ui.apps.commons/` while still avoiding
`ui.frontend/dist/**`, `ui.tests/**`, and other non-HTL HTML in the
workspace.

Plus MCP wiring at `.cursor/mcp.json`.

### 3.3 GitHub Copilot — `.github/instructions/aem-<role>.instructions.md`

```markdown
<!-- aem-agentkit: generated v1.0.0-beta; safe to delete or edit. checksum: <sha256> -->
---
applyTo: "<glob pattern>"
---

<body of canonical role source>
```

`applyTo` patterns mirror the Cursor `globs:` above. Guardrails use
`applyTo: "**/*"`.

The Copilot custom-instructions spec accepts a single string with
comma-separated globs. When a role has multiple globs (e.g.
`osgi-config-author`, `content-fragment-author`), emit a single
`applyTo` line joining the globs with `,` (no surrounding spaces):

```markdown
applyTo: "**/ui.config/**,**/ui.config.*/**,**/jcr_root/apps/*/config*/**"
```

Do **not** split into multiple `.instructions.md` files — the canonical
role source projects 1:1 to a single Copilot instruction file per role.

If `.github/copilot-instructions.md` is missing **and** Copilot is detected,
write a minimal version:

```markdown
<!-- aem-agentkit: generated v1.0.0-beta; safe to delete or edit. checksum: <sha256> -->
# Repository-wide Copilot instructions

This repository follows the conventions documented in [`AGENTS.md`](../AGENTS.md)
and `.aem/context/`. Honor every guardrail in [`AGENTS.md`](../AGENTS.md) and
the scoped instructions in `.github/instructions/`.
```

If it already exists, the skill never touches it.

### 3.4 Continue.dev — `.continue/rules/aem-<role>.md`

```markdown
<!-- aem-agentkit: generated v1.0.0-beta; safe to delete or edit. checksum: <sha256> -->
# aem-<role>

<body of canonical role source>
```

Continue rules under `.continue/rules/` are always-on; no frontmatter
required. If Continue uses `.continue/config.json` for agent registration,
the skill does not modify it.

### 3.5 Codex (OpenAI)

No tool-specific files. Codex reads `AGENTS.md` (root + per-module) and
queries the indexes natively per the open standard.

### 3.6 Cline (VS Code) — `.clinerules`

Single Markdown file at the workspace root. Cline concatenates all rules
into its system prompt.

```markdown
<!-- aem-agentkit: generated v1.0.0-beta; safe to delete or edit. checksum: <sha256> -->
# AEM as a Cloud Service — agent rules

Read AGENTS.md, the relevant per-module AGENTS.md, and the indexes under
.aem/context/ before generating any code. Apply every rule under
"Agentic workflow guardrails" in AGENTS.md.

<body of canonical guardrails role>

---

<body of canonical component-author role>

---

<body of canonical sling-model-author role>

(… all detected roles concatenated …)
```

A single file works for Cline because it ingests one rules document, not
per-file or per-glob rules. The same content blocks are reused from the
canonical role sources. When the budget in § 6 forces deferred roles,
the deferred bodies are inlined into the sibling
`<file>.aem-roles-extra.md` so the customer keeps the full role set on
disk.

### 3.7 Windsurf — `.windsurfrules`

Same shape as `.clinerules`. Single file at the workspace root with all
detected roles concatenated. Deferred roles go into
`.windsurfrules.aem-roles-extra.md`.

### 3.8 Aider

No tool-specific files. Aider reads `AGENTS.md` natively. If the customer
maintains an `.aider.conf.yml`, the skill does not touch it.

### 3.9 Augment Code

Single file at `augment.md` (project root) — same concatenation pattern
as Cline / Windsurf. Created only when `.augment/` directory or existing
`augment.md` signal is detected. Deferred roles go into
`augment.md.aem-roles-extra.md`.

## 4. Conditional generation

| Role / artifact | Condition |
|---|---|
| component-author | Always (universal author role) |
| sling-model-author | Any module with `src/main/java/**` contains `@Model` classes |
| htl-author | `ui.apps` module present (any nesting level), including `ui.apps.*` siblings |
| dispatcher-editor | `dispatcher/` module present |
| osgi-config-author | `ui.config` module present (any nesting level), including `ui.config.*` siblings |
| integration-test-author | `it.tests/` module present |
| ui-test-author | `ui.tests/` module present |
| content-fragment-author | Content Fragment models present under `/conf/*/settings/dam/cfm/models/` |
| guardrails | Always (every IDE that is detected) |
| `/new-component` | `ui.apps` module present |
| `/new-sling-model` | Any module with `src/main/java/**` |
| `/validate-dispatcher` | `dispatcher/` module present |
| `/regen-context` | Always |
| `/agents-md-check` | Always |
| `.claude/rules/aem-<role>.md` (passive projection) | Claude Code detected AND the role is detected (same per-role conditions as `.claude/agents/`) |

## 5. Index self-update rule (indexable roles only)

Roles that author artifacts tracked by a `.aem/context/*.json` index end
with an `## Index self-update (mandatory final step)` section. The
section body is the role's instruction to call `/regen-context` after a
successful write so the index is recomputed and re-checksummed by the
skill (not by the agent inline). This is the **single shared protocol**
that any sibling skill (`create-component`, `best-practices`, `migration`,
or any future skill that touches `.aem/context/*.json`) MUST follow.
Agent-driven inline mutation of the index files is forbidden: the
agent cannot reliably compute SHA-256 over canonical bodies, so it
either succeeds (and the file becomes uncertified) or fails silently
(and the file looks human-curated to the next skill run, which then
treats it as a collision and starts producing `.agentkit-new` sidecars).

| Role | Indexed by | Has the section |
|---|---|---|
| component-author | `.aem/context/components.json` | yes (delegates to `/regen-context`) |
| sling-model-author | `.aem/context/osgi-services.json` (`slingModels`) | yes (delegates to `/regen-context`) |
| htl-author | (covered by component-author when the HTL belongs to a new component) | no |
| dispatcher-editor | (dispatcher config is not indexed) | no |
| osgi-config-author | (PIDs are resolved against `osgi-services.json`, but the config files themselves are not indexed) | no |
| integration-test-author | (test files are not indexed) | no |
| ui-test-author | (test files are not indexed) | no |
| content-fragment-author | (CF instances are not indexed; CF models are read-only from the role's perspective) | no |
| guardrails | (no authoring) | no |

The section body is identical across the two indexable roles, scoped to
that role's index file, and appears verbatim in every IDE projection
(Claude / Cursor / Copilot / Continue / Cline / Windsurf / Augment).

Roles without the section still inherit the "Honor the indexes" rule from
the canonical guardrails block, so they will not bypass `/regen-context`
when the work they touch incidentally produces an indexable artifact (for
example, a new component HTL written by `htl-author` triggers an
`/regen-context` reminder from the guardrails block).

## 6. Size budgets and deferred-role sidecar

| Artifact | Soft | Hard |
|---|---|---|
| Claude subagent | 50 lines | 100 lines |
| Claude `.claude/rules/aem-<role>.md` (passive) | 50 lines | 100 lines |
| Cursor `.mdc` rule | 50 lines | 100 lines |
| Copilot `.instructions.md` | 50 lines | 100 lines |
| Continue rule | 50 lines | 100 lines |
| Cline `.clinerules` (concatenated) | 300 lines | 600 lines |
| Windsurf `.windsurfrules` (concatenated) | 300 lines | 600 lines |
| Augment `augment.md` (concatenated) | 300 lines | 600 lines |
| Any slash command | 30 lines | 60 lines |

When a concatenated single-file projection (Cline / Windsurf / Augment)
would exceed its hard budget, the skill keeps the guardrails role plus the
core roles (component-author, sling-model-author, htl-author,
dispatcher-editor) in full in the main file and writes the remaining role
bodies to a sibling `<file>.aem-roles-extra.md` (e.g.
`.clinerules.aem-roles-extra.md`). The customer therefore always has every
role body on disk; nothing points back to the published skill bundle. A
one-line pointer at the bottom of the main file directs the agent to the
sidecar, and a `warningStubs` entry names the truncated roles.

## 7. Semantic equivalence across IDE projections

The canonical role-source body is the single source of truth for each
role (`role.component-author.md`, `role.sling-model-author.md`, etc.).
Each IDE projection materializes the SAME canonical body, wrapped in
the IDE's preferred container:

- **Claude Code (subagent):** `.claude/agents/<role>.md` (frontmatter + body) — invocable as `@aem-<role>`.
- **Claude Code (rules):** `.claude/rules/<role>.md` (frontmatter with `globs:` + body) — passive context.
- **Cursor:** `.cursor/rules/<role>.mdc` (frontmatter with `globs` + body).
- **Copilot:** `.github/instructions/<role>.instructions.md` (frontmatter with `applyTo` + body).
- **Continue.dev:** `.continue/rules/<role>.md` (body only, slug filename).
- **Cline / Windsurf / Augment:** concatenated into the single rules
  file with a `## <role>` section heading.

**Today's guarantee:** the role body content is functionally identical
across projections — same guidance, same evidence pointers, same
guardrails. Per-projection adapters (frontmatter, file extension,
IDE-specific directives like Cursor's `@-mentions`) are permitted and
expected; they wrap the canonical body without changing its semantics.

**What this is NOT:** a byte-identical guarantee. Earlier drafts
asserted "byte-identical body across all IDE projections," but that
formulation does not survive the next round of IDE format evolution.
The day Cursor ships a custom interpolation syntax that mid-body
content can take advantage of, "byte-identical" forces either lowest-
common-denominator content (skill systematically underperforms each
tool) or a fork (the guarantee becomes a partial truth). Semantic
equivalence is the durable contract; per-projection adapters are the
escape hatch.

## 7.1 Self-validation

After writing all tool-specific files:
- Every generated file carries the marker.
- The canonical role-source body is semantically equivalent across all tool projections — wrap, frontmatter, and extension may vary per IDE; the role body content is the same in every projection.
- No file contains marketing language; framing uses "agentic workflow" terminology only.
- Every URL is Cloud-Service-scoped (no `/6.5/`, no `experience-manager-65/`).
- Every sanitized customer string is free of every code point in [`privacy-and-sanitization.md`](./privacy-and-sanitization.md) § 2.1.
