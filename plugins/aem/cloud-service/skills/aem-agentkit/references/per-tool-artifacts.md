# Per-tool artifacts — Claude / Cursor / Copilot / Codex / Continue

> **Beta Skill:** Outputs must be reviewed before applying to production.

This reference defines how the skill projects a single canonical role-prompt
source into each IDE's artifact format. The **content** is identical across
IDEs; only the frontmatter and file extension differ. This is the
equivalence guarantee promised in SKILL.md.

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

## 1. Silent IDE detection

| Tool | Positive signal(s) |
|---|---|
| Claude Code | `.claude/` directory at workspace root, OR `CLAUDE.md` at root, OR `~/.claude/agents/aem-*.md` symlinked from the workspace |
| Cursor | `.cursor/` directory at workspace root |
| GitHub Copilot | `.github/copilot-instructions.md` present, OR `.github/` with any `.yml` workflow file (covers VS Code, JetBrains, Neovim with Copilot) |
| Codex (OpenAI) | Always — Codex reads `AGENTS.md` natively per the open standard |
| Continue.dev | `.continue/` directory at workspace root (covers VS Code, JetBrains with Continue) |
| Cline (VS Code) | `.clinerules` file at workspace root, OR `.vscode/extensions.json` listing `saoudrizwan.claude-dev` |
| Windsurf | `.windsurfrules` file at workspace root, OR `.codeium/` directory |
| Aider | Always — Aider reads `AGENTS.md` natively |
| Augment Code | `.augment/` directory or `augment.md` at root |
| **Native AGENTS.md adopters (no projection needed — universal layer is enough)** | Always covered: OpenAI Codex, Gemini CLI, Zed, Factory, Jules, Devin, Amp, Kilo, RooCode, Warp, JetBrains Junie, Ona, Phoenix, and any future AGENTS.md-spec-compliant agent |

A signal present **after** the customer manually creates the relevant
directory is treated identically — re-running the skill after `mkdir
.cursor` (or `touch .clinerules`) adds that tool's layer.

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

## 3. Projection rules

### 3.1 Claude Code — `.claude/agents/aem-<role>.md`

```markdown
<!-- aem-agentkit: generated v0.1.0-beta; safe to delete or edit. checksum: <sha256> -->
---
name: aem-<role>
description: <one-line from canonical source>
model: sonnet
tools: Read, Glob, Grep, Edit, Write, Bash
---

<body of canonical role source>
```

Plus slash commands at `.claude/commands/`:

| File | Owns name |
|---|---|
| `new-component.md` | `/new-component <name>` |
| `new-sling-model.md` | `/new-sling-model <FQCN>` |
| `validate-dispatcher.md` | `/validate-dispatcher` (only if `dispatcher/` exists) |
| `regen-context.md` | `/regen-context` |
| `agents-md-check.md` | `/agents-md-check` |

Plus MCP wiring at `.mcp.json` (see [`mcp-wiring.md`](./mcp-wiring.md)).

### 3.2 Cursor — `.cursor/rules/aem-<role>.mdc`

```markdown
<!-- aem-agentkit: generated v0.1.0-beta; safe to delete or edit. checksum: <sha256> -->
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
| component-author | `**/ui.apps/**` |
| sling-model-author | `**/src/main/java/**` |
| htl-author | `**/*.html` |
| dispatcher-editor | `dispatcher/**` |
| osgi-config-author | `**/ui.config/**`, `**/jcr_root/apps/*/config*/**` |
| integration-test-author | `**/it.tests/**` |
| ui-test-author | `**/ui.tests/**` |
| content-fragment-author | `**/conf/**/settings/dam/cfm/**`, `**/content/dam/**` |
| guardrails | `**/*` with `alwaysApply: true` |

Plus MCP wiring at `.cursor/mcp.json`.

### 3.3 GitHub Copilot — `.github/instructions/aem-<role>.instructions.md`

```markdown
<!-- aem-agentkit: generated v0.1.0-beta; safe to delete or edit. checksum: <sha256> -->
---
applyTo: "<glob pattern>"
---

<body of canonical role source>
```

`applyTo` patterns mirror the Cursor `globs:` above. Guardrails use
`applyTo: "**/*"`.

If `.github/copilot-instructions.md` is missing **and** Copilot is detected,
write a minimal version:

```markdown
<!-- aem-agentkit: generated v0.1.0-beta; safe to delete or edit. checksum: <sha256> -->
# Repository-wide Copilot instructions

This repository follows the conventions documented in [`AGENTS.md`](../AGENTS.md)
and `.aem/context/`. Honor every guardrail in [`AGENTS.md`](../AGENTS.md) and
the scoped instructions in `.github/instructions/`.
```

If it already exists, the skill never touches it.

### 3.4 Continue.dev — `.continue/rules/aem-<role>.md`

```markdown
<!-- aem-agentkit: generated v0.1.0-beta; safe to delete or edit. checksum: <sha256> -->
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
<!-- aem-agentkit: generated v0.1.0-beta; safe to delete or edit. checksum: <sha256> -->
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
canonical role sources.

### 3.7 Windsurf — `.windsurfrules`

Same shape as `.clinerules`. Single file at the workspace root with all
detected roles concatenated.

### 3.8 Aider

No tool-specific files. Aider reads `AGENTS.md` natively. If the customer
maintains an `.aider.conf.yml`, the skill does not touch it.

### 3.9 Augment Code

Single file at `augment.md` (project root) — same concatenation pattern
as Cline / Windsurf. Created only when `.augment/` directory or existing
`augment.md` signal is detected.

## 4. Conditional generation

| Role / artifact | Condition |
|---|---|
| component-author | Always (universal author role) |
| sling-model-author | Any module with `src/main/java/**` contains `@Model` classes |
| htl-author | `ui.apps` module present (any nesting level) |
| dispatcher-editor | `dispatcher/` module present |
| osgi-config-author | `ui.config` module present (any nesting level) |
| integration-test-author | `it.tests/` module present |
| ui-test-author | `ui.tests/` module present |
| content-fragment-author | Content Fragment models present under `/conf/*/settings/dam/cfm/models/` |
| guardrails | Always (every IDE that is detected) |
| `/new-component` | `ui.apps` module present |
| `/new-sling-model` | Any module with `src/main/java/**` |
| `/validate-dispatcher` | `dispatcher/` module present |
| `/regen-context` | Always |
| `/agents-md-check` | Always |

## 5. Index self-update rule (embedded in every author role)

Every authoring role's canonical source ends with this section:

```markdown
## Index self-update (mandatory final step)

After your changes are on disk:

1. Append the new entry to the relevant `.aem/context/*.json` file.
2. Recompute the marker checksum on the JSON file.
3. Add the new entry to the per-module `AGENTS.md` "Common entry points"
   list only when the list is below its soft size budget (40 lines).

This keeps indexes from going stale between explicit `/regen-context` runs.
```

This single section appears verbatim in Claude, Cursor, Copilot, and
Continue artifacts. Same content, four IDE shapes.

## 6. Size budgets

| Artifact | Soft | Hard |
|---|---|---|
| Claude subagent | 50 lines | 100 lines |
| Cursor `.mdc` rule | 50 lines | 100 lines |
| Copilot `.instructions.md` | 50 lines | 100 lines |
| Continue rule | 50 lines | 100 lines |
| Any slash command | 30 lines | 60 lines |

## 7. Self-validation

After writing all tool-specific files:
- Every generated file carries the marker.
- The canonical role-source body appears verbatim across all tool projections (byte-identical inside each role across IDEs).
- No file contains marketing language; framing uses "agentic workflow" terminology only.
