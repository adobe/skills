---
name: aem-agentkit
description: |
  [BETA] Bootstrap an AEM as a Cloud Service repository for agentic workflows
  across Claude Code, Cursor, GitHub Copilot, Codex, and Continue. Generates
  per-module AGENTS.md, machine-readable codified context under .aem/context/,
  project-scoped subagents / slash commands / rule files / Copilot instructions,
  MCP wiring, and guardrail rules — without modifying customer source code.
  Detects installed agent stacks silently and writes only matching tool-specific
  artifacts. Defers root AGENTS.md to ensure-agents-md when present; works
  standalone when not.
  This skill is in beta. Verify all outputs before applying them to production
  projects.
license: Apache-2.0
compatibility: AEM as a Cloud Service projects (Java stack, Maven, Dispatcher).
metadata:
  status: beta
  version: "0.1.0-beta"
  aem_version: "Cloud Service"
  complements: ensure-agents-md
---

# aem-agentkit — bootstrap for agentic workflows on AEM as a Cloud Service

> **Beta Skill**: This skill is in beta and under active development. Results
> should be reviewed carefully before use in production. Report issues at
> https://github.com/adobe/skills/issues

## What this skill does, in one sentence

Writes a small set of agent-meta files at the workspace root and inside
existing modules so coding agents (Claude Code, Cursor, GitHub Copilot, Codex,
Continue, and any agentic harness on top of them) can perform agentic
workflows on the customer's AEM as a Cloud Service repository with high
reliability and low hallucination — without ever modifying customer source
code.

## Hard guarantee — never modifies customer source

This skill writes **only** into the following paths, all relative to the
workspace root:

- `<module>/AGENTS.md` for each detected AEM module (recursively, including nested AEM sub-projects)
- `.aem/context/` (`components.json`, `osgi-services.json`, `conventions.md`,
  `avoid.md`, `glossary.md`, `test-patterns.md`, `aem-api-namespaces.md`, `README.md`) — written at the workspace root **and** scoped per nested AEM sub-project
- `.claude/agents/aem-*.md`, `.claude/commands/<owned-names>.md`,
  `.mcp.json` *(only when `.claude/` is detected and the file is missing)*
- `.cursor/rules/aem-*.mdc`, `.cursor/mcp.json` *(only when `.cursor/` is
  detected and the file is missing)*
- `.github/copilot-instructions.md` *(only when missing and Copilot is
  detected)*, `.github/instructions/aem-*.instructions.md`
- `.continue/rules/aem-*.md` *(only when `.continue/` is detected)*

Every other file is read-only. The root `AGENTS.md` and `CLAUDE.md` are
owned by `ensure-agents-md` and are never modified by this skill. Every
generated artifact carries a marker comment so the customer can identify,
delete, or regenerate them safely.

## Relationship to `ensure-agents-md`

`aem-agentkit` complements `ensure-agents-md` — they are not replacements
for each other.

| Skill | Owns | Outputs |
|---|---|---|
| `ensure-agents-md` (stable) | Root `AGENTS.md` + `CLAUDE.md` | 2 files |
| `aem-agentkit` (beta) | Per-module `AGENTS.md`, `.aem/context/`, tool-specific files | Everything else |

| Customer state | `aem-agentkit` behavior |
|---|---|
| Root `AGENTS.md` present (any author) | Use it as-is, never modify |
| Root `AGENTS.md` missing AND `ensure-agents-md` installed | Defer to `ensure-agents-md` as step 0, then continue |
| Root `AGENTS.md` missing AND `ensure-agents-md` not installed | Proceed with everything else; one-line notice asks user to add a root `AGENTS.md` |

## Trigger and invocation

This skill is **opt-in** — it does not auto-bootstrap like `ensure-agents-md`.
It runs when:

- The user invokes it by name ("set up agentic context", "bootstrap aem-agentkit", "make this repo agentic-ready", etc.).
- The host routes here because the user is doing component / Sling Model / dispatcher work and codified context would reduce hallucination, AND the repo has root `AGENTS.md` but no `.aem/context/`.
- The slash commands it installs are invoked: `/regen-context`, `/agents-md-check`.

The skill skips silently and exits cleanly when:

- Root `pom.xml` is missing or the repo is not an AEM as a Cloud Service project.
- A `_disable_agentkit` file exists at the workspace root.
- Every universal-layer artifact already exists with a matching marker checksum and no tool-specific layer is missing.

## Silent IDE detection

The skill does **not** prompt the user. It detects installed agent stacks
from filesystem signals and writes only the matching tool-specific layer.

| Tool | Detection signal | Tool-specific artifacts |
|---|---|---|
| Claude Code | `.claude/` directory or `CLAUDE.md` at root | `.claude/agents/aem-*.md`, `.claude/commands/<owned>.md`, `.mcp.json` placeholder |
| Cursor | `.cursor/` directory | `.cursor/rules/aem-*.mdc`, `.cursor/mcp.json` placeholder |
| GitHub Copilot | `.github/copilot-instructions.md` present, or `.github/` with any workflow file | `.github/instructions/aem-*.instructions.md`; `.github/copilot-instructions.md` only if missing |
| Codex | (always — reads `AGENTS.md` natively per the open standard) | (none — universal layer is sufficient) |
| Continue.dev | `.continue/` directory | `.continue/rules/aem-*.md` |

If **no** signal is detected, only the universal layer is written and the
summary block lists what would be generated if each tool were detected,
so the customer can opt in later by creating the corresponding directory
and re-running the skill.

## Generation order (fixed)

The skill writes artifacts in this order. Earlier outputs are read by later
steps so cross-references stay consistent.

1. `.aem/context/components.json` — see [references/codified-context.md](./references/codified-context.md). Written at the workspace root **and** at each detected nested AEM sub-project root (scoped to that sub-project).
2. `.aem/context/osgi-services.json` — same per-scope rule.
3. `.aem/context/conventions.md` — derived rules with evidence pointers.
4. `.aem/context/avoid.md` — anti-patterns with evidence pointers.
5. `.aem/context/glossary.md` — domain disambiguation.
6. `.aem/context/test-patterns.md` — testing conventions.
7. `.aem/context/aem-api-namespaces.md` — canonical AEM API namespace reference (static guardrail support for "verify before import").
8. `.aem/context/README.md` — human-readable index of the above.
8. Per-module `AGENTS.md` (recursive — supports nested AEM monorepos where a top-level module is itself a full archetype) — see [references/per-module-agents-md.md](./references/per-module-agents-md.md)
9. Tool-specific artifacts (Claude / Cursor / Copilot / Continue) — see [references/per-tool-artifacts.md](./references/per-tool-artifacts.md)
10. `.mcp.json` and `.cursor/mcp.json` — see [references/mcp-wiring.md](./references/mcp-wiring.md)

After step 10, run the **self-validation pass**:

- Every evidence pointer in `conventions.md`, `avoid.md`, `glossary.md`, `test-patterns.md` resolves to an existing file (and line, when given).
- Every `slingModelFqcn` in `components.json` resolves to an existing `.java` file.
- Every per-module `AGENTS.md` corresponds to an existing directory.
- Every tool-specific file carries the marker.
- Failure aborts with a one-line diagnostic; no partial outputs (atomic write per `.tmp` + rename).

## Reference files

| File | Purpose |
|---|---|
| [references/per-module-agents-md.md](./references/per-module-agents-md.md) | Rules, templates, and size budgets for per-module `AGENTS.md` files |
| [references/codified-context.md](./references/codified-context.md) | `.aem/context/*` schemas, discovery rules, evidence-pointer format, schema versioning |
| [references/per-tool-artifacts.md](./references/per-tool-artifacts.md) | Tool detection signals, canonical role-prompt source, projection into Claude / Cursor / Copilot / Continue formats |
| [references/mcp-wiring.md](./references/mcp-wiring.md) | `.mcp.json` and `.cursor/mcp.json` non-destructive merge rules |
| [references/guardrails.md](./references/guardrails.md) | Guardrail rule text (search-before-create, verify-API, etc.) |
| [references/module-catalog.md](./references/module-catalog.md) | Module descriptions and add-on detection table |
| [references/collision-rules.md](./references/collision-rules.md) | Complete pre-existing-state behavior table (25+ scenarios) |
| [references/upgrade-and-migration.md](./references/upgrade-and-migration.md) | Skill version bump + JSON schema migration rules |

## Idempotency

- **Never overwrite** any pre-existing file lacking our marker.
- Each generated artifact's first content line is a marker:
  - Markdown / `.mdc`: `<!-- aem-agentkit: generated v0.1.0-beta; safe to delete or edit. checksum: <sha256> -->`
  - JSON: leading top-level fields `"_generatedBy": "aem-agentkit"`, `"_skillVersion": "0.1.0-beta"`, `"schemaVersion": "1"`.
- Re-running the skill is a no-op when nothing has drifted.
- A file lacking the marker is treated as **human-curated**; the skill never touches it. When the skill would otherwise write to such a path, it writes to `<path>.agentkit-new` instead and surfaces a one-line diff summary.
- A marker-bearing file with a different checksum (because we ship new templates) is **not** overwritten — the new content goes to `.agentkit-new`; the customer chooses whether to swap.

## Modes

| Mode | Trigger | Behavior |
|---|---|---|
| Default | Skill invoked, opt-out signals absent | Step 0: defer to `ensure-agents-md` if root `AGENTS.md` missing and that skill is available. Step 1+: generate missing universal + matching tool-specific artifacts. |
| Refresh | `/regen-context` slash command (per detected tool) or skill argument | Regenerate only `.aem/context/*`. Diffs go to `.agentkit-new` per § Idempotency. |
| Check | `/agents-md-check` slash command or `--check` | Read-only drift report. Non-zero exit when stale. |

## What this skill never does

- Modify customer source code (Java, HTL, JSP, JS/TS/CSS, dispatcher `.conf`/`.any`/`.farm`, FileVault XML, `pom.xml`, content `.json`, OSGi config, `README`, `CONTRIBUTING`, `LICENSE`, or any other pre-existing file lacking the marker).
- Modify the root `AGENTS.md` or `CLAUDE.md`.
- Write into `.git/`, `target/`, `node_modules/`, `dist/`, `build/`, `out/`.
- Read `.cloudmanager/env*.json`, `.cloudmanager/secrets*`, `.env`, `.env.*`, `**/credentials*`, `**/*creds*`, `**/*secret*`, `**/*.pem`, `**/*.key`, `**/*.p12`. Only `.cloudmanager/java-version` is read from `.cloudmanager/`.
- Mention specific MCP server packages by name in the bodies of generated AGENTS.md / per-module AGENTS.md files. Server names live in `.mcp.json` / `.cursor/mcp.json` only.
- Use marketing language in any generated artifact. Generated content frames itself as agentic workflow context.
- Embed AEM 6.5 documentation URLs. All resource links use the Cloud Service namespace.
- Prompt the customer for input. IDE detection is silent.

## Communication contract

The skill writes only at three points to the user:

**Before any writes — one line:**

> Bootstrapping agentic workflow context for this AEM as a Cloud Service repository. No source files will be modified.

**After all writes — concise deterministic summary:**

```
aem-agentkit: complete
  Universal layer:
    Per-module AGENTS.md: <N> across [<modules>]
    Indexes: components.json (N), osgi-services.json (N)
    Derived: conventions.md (N rules, T TODOs), avoid.md (N entries),
             glossary.md, test-patterns.md
  Tool-specific layer (detected: <tool list>):
    Claude:   <count> agents, <count> commands, mcp.json (existing|new)
    Cursor:   <count> rules, mcp.json (existing|new)
    Copilot:  <count> instructions
    Continue: <count> rules
  TODO markers: <T> items pending human review
  Refresh:   /regen-context
  Drift:     /agents-md-check
```

**On any error:** a single line describing the failure plus the diagnostic path. The skill never leaves partial outputs (atomic write: `.tmp` + rename).

After the summary, the skill yields back so the user's original request proceeds with the new context loaded.

## Rules

- **Never overwrite** any pre-existing file (§ Idempotency).
- **Never hallucinate.** Only emit a derived rule when ≥ 3 evidence points exist; otherwise emit a TODO marker.
- **Never read** files in § "What this skill never does".
- **Never write** outside the allow-list in § "Hard guarantee".
- **Customer-only discovery.** Components, models, and services are discovered from the customer's source modules. Do not index Core Components or anything under `/libs`.
- **Workspace boundary.** Only walk paths under the workspace root. Do not follow symlinks pointing outside the workspace.
- **Output stability.** JSON sorted-keys + 2-space indent + LF + final newline + UTF-8 no BOM. Markdown LF + final newline + no trailing whitespace. Discovery enumerates with sorted directory listings.
- **Evidence-pointer format.** `<repo-relative-posix-path>:<1-based-line>`. Path uses `/` separators on every platform.
- **Atomic write.** Every output goes to `<path>.tmp` and is renamed to `<path>` on success. Orphan `.tmp` files from a previous interrupted run are deleted at startup.
- **Equivalence guarantee.** A single canonical role-prompt source is projected into Claude / Cursor / Copilot / Continue formats so the content seen by the agent is identical regardless of IDE.
