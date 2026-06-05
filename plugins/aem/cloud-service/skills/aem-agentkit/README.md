# aem-agentkit (beta)

Bootstrap an **AEM as a Cloud Service** repository for agentic workflows.

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

This skill writes a small set of agent-meta files at the workspace root and
inside existing modules so coding agents and any harness on top of them can
work on the customer's repository with high reliability and low
hallucination. It never modifies customer source code.

**Scope:** AEM as a Cloud Service only. The skill exits early on AEM 6.5
LTS, AMS, and on-premise AEM layouts.

See [`SKILL.md`](./SKILL.md) for the full contract.

## What gets created

### Universal layer (always written if missing)

| Path | Purpose |
|---|---|
| `<module>/AGENTS.md` | Focused per-module context (sized for one task) |
| `.aem/context/components.json` | Machine-readable component catalog |
| `.aem/context/osgi-services.json` | Sling Models, OSGi services, Sling Servlets |
| `.aem/context/conventions.md` | Derived conventions with evidence pointers |
| `.aem/context/avoid.md` | Anti-patterns detected in the repo |
| `.aem/context/glossary.md` | Domain disambiguation |
| `.aem/context/test-patterns.md` | How this project writes tests |
| `.aem/context/aem-api-namespaces.md` | Canonical AEM as a Cloud Service API package roots (verify-before-import support) |
| `.aem/context/README.md` | Index of the above |
| `.aem/context/.agentkit-manifest.json` | Run manifest: every file written, post-write checksum, every heuristic decision |
| `.aem/context/.agentkit.lock` | Workspace advisory lock so parallel invocations exit cleanly |

### Tool-specific layer (silent auto-detection)

| Tool | Detection signal | Tool-specific artifacts |
|---|---|---|
| Claude Code | `.claude/` dir or `CLAUDE.md` | `.claude/agents/aem-*.md`, `.claude/commands/<owned>.md`, `.mcp.json` |
| Cursor | `.cursor/` dir | `.cursor/rules/aem-*.mdc`, `.cursor/mcp.json` |
| GitHub Copilot | `.github/copilot-instructions.md` or `.github/*.yml` workflow | `.github/instructions/aem-*.instructions.md` (Copilot-instructions written only if missing) |
| Codex | (universal layer is sufficient) | — |
| Continue.dev | `.continue/` dir | `.continue/rules/aem-*.md` |
| Cline | `.clinerules` or `.vscode/extensions.json` listing the Cline extension | `.clinerules` (only when missing) |
| Windsurf | `.windsurfrules` or `.codeium/` directory | `.windsurfrules` (only when missing) |
| Augment Code | `.augment/` directory or pre-existing `augment.md` | `augment.md` (only when missing) |
| Aider, Gemini CLI, Zed, Factory, Jules, Devin, Amp, Kilo, RooCode, Warp, JetBrains Junie, Ona, Phoenix | (universal layer is sufficient — read `AGENTS.md` natively) | — |

A single canonical role-prompt source is projected into each tool's format
so the content seen by the agent is identical regardless of IDE. The
deferred-role inline fallback (for the concatenated single-file
projections — Cline / Windsurf / Augment) writes a sibling
`<file>.aem-roles-extra.md` so the customer always has every role body on
disk, not behind a pointer to the published skill bundle.

## What never changes

Customer Java, HTL, JSP, JS/TS/CSS, dispatcher configuration, FileVault XML,
`pom.xml`, content `.json`, OSGi config files, `README`, `CONTRIBUTING`,
`LICENSE`, the root `AGENTS.md` / `CLAUDE.md`, or any other pre-existing file
lacking the marker comment. See `SKILL.md` § "Hard guarantee" for the exact
allow-list.

## Relationship to `ensure-agents-md`

`aem-agentkit` does not replace `ensure-agents-md`; they are complementary.
`ensure-agents-md` owns the root `AGENTS.md` + `CLAUDE.md`. `aem-agentkit`
owns everything else. If root `AGENTS.md` is missing and `ensure-agents-md`
is available, `aem-agentkit` defers to it as step 0. If it is not
available, `aem-agentkit` proceeds with everything except the root
`AGENTS.md` and emits a one-line notice.

## Status

Beta. Skill version `1.0.0-beta`. Generated JSON files carry
`schemaVersion: "1"`. Marker contract, migration rules, and the
deterministic-helper version pin are documented in
[`references/upgrade-and-migration.md`](./references/upgrade-and-migration.md)
and [`references/helpers.md`](./references/helpers.md).

Verify all outputs before applying to production projects.

## End-to-end agentic workflow coverage

This skill covers the **bootstrap** phase of an end-to-end agentic
workflow on AEM as a Cloud Service. Other phases are handled by sibling
skills already published in the `aem-cloud-service` plugin
(`plugins/aem/cloud-service/skills/` in [adobe/skills](https://github.com/adobe/skills)):

| Phase | Public sibling skill |
|---|---|
| Bootstrap (this skill) | `aem-agentkit` — per-module AGENTS.md, codified context, tool-specific routing |
| Root context | `ensure-agents-md` — root AGENTS.md + CLAUDE.md |
| Pattern transformation | `best-practices` — Cloud Service patterns, legacy-to-cloud transformations |
| Component scaffolding | `create-component` — opinionated component scaffolds |
| Migration orchestration | `migration` — BPA / CAM orchestration on top of `best-practices` |
| Workflow authoring | `aem-workflow` — Granite Workflow model design, development, triggering, debugging, triaging |
| Dispatcher | `dispatcher` — config authoring, advisory, incident response, performance tuning, security hardening |
| Content distribution | `content-distribution` — Sling distribution and replication |
| Rapid Development | `aem-rde` — RDE deploy, log inspection, snapshots, troubleshooting via `aio aem rde` |

The bootstrap this skill produces (per-module `AGENTS.md`, codified
context under `.aem/context/`, project-scoped subagents and rules) is
read by every later-phase skill. A customer who has installed the
`aem-cloud-service` plugin (which bundles every skill above) and run
`aem-agentkit` has end-to-end agentic-workflow coverage on their
repository.

## Trademarks

This skill is licensed under Apache 2.0. References to third-party IDE
and agent names (Claude Code, Cursor, GitHub Copilot, Codex, Continue,
Cline, Windsurf, Augment, Aider, Gemini CLI, Zed, RooCode, JetBrains
Junie, and others) are nominative and descriptive only — they identify
the tools the skill produces artifacts for. All such names remain the
trademarks of their respective owners. This skill is not affiliated with
or endorsed by any of them.

## Reporting issues

https://github.com/adobe/skills/issues
