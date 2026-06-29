# agentify

Transforms any AEM customer repository into one that AI agents can navigate and contribute to
independently — without hand-holding.

Invoke with: `agentify`, `make AI native`, `set up agent files`, `add AGENTS.md / CLAUDE.md`,
or `make this repo agent-ready`.

Works across all AEM repo types: OSGi bundles, content packages, multi-module Maven projects,
AEM Cloud Service projects, and AEM 6.5 / AMS projects.

## What it creates

| Output | Purpose |
|--------|---------|
| `AGENTS.md` | Vendor-neutral SSoT — read by Claude Code, Cursor, Copilot, and Codex |
| `CLAUDE.md` | Claude Code projection of `AGENTS.md` |
| `.claude/settings.json` + `.claude/rules/` | Permission gates and quick-reference rule files |
| `.cursorrules` + `.cursor/rules/` | Cursor projection (when selected) |
| `.github/copilot-instructions.md` | Copilot IDE projection (when selected) |
| `CONTRIBUTING.md` | Behavioural contract for human and AI contributors |
| `wiki/architecture.md` + code-flow pages | Architecture and workflow documentation |
| `docs/runbooks.md`, `docs/decisions/` | Operational runbooks and lightweight ADRs |
| `prompts/` | Repo-aware helper prompts |
| `docs/release-process.md` + `skills/release/` | Release documentation and execution skill |

## How it runs

Four phases, always in order — nothing writes without user approval:

- **Phase 0 — Assess**: classifies the repo (Source, Packaging, Multi-module, etc.) and
  inventories existing AI-native files. Always runs first.
- **Phase 1 — High-ROI wins**: creates the files AI tools read first — `AGENTS.md`, `CLAUDE.md`,
  `CONTRIBUTING.md`, `.gitignore`, CI workflow. Typically 1–2 hours per repo.
- **Phase 2 — Contract clarity**: architecture docs, runbooks, ADRs, prompt library, and
  repo-aware agents. Offer/defer workflow per item.
- **Phase 3 & 4 — Structural improvements + automation**: triage-first (do-now / offer / defer).
  Covers centralised config/logging, CI coverage gates, pre-commit hooks, living-document hygiene.

## Relationship to `ensure-agents-md`

`ensure-agents-md` is a **lightweight bootstrap** — it creates `AGENTS.md` from a fixed AEM
template when none exists, then immediately continues with the user's original request. `agentify`
is the **full transformation** — a structured multi-phase workflow that creates architecture docs,
ADRs, a prompt library, repo-aware agents, CI workflows, and a `/release` skill. Use
`ensure-agents-md` for a quick start on an AEM Cloud Service project; use `agentify` when setting
up any AEM repo for sustained, multi-agent AI-native development.

## Supporting files

| File | Purpose |
|------|---------|
| [`SKILL.md`](SKILL.md) | Entry point and execution map |
| [`PLAN.md`](PLAN.md) | Phase routing, Step 0 execution, pre-PR gate, completion report |
| [`CONVENTIONS.md`](CONVENTIONS.md) | AEM coding conventions embedded in generated `AGENTS.md` (Java/OSGi, Bash, Git) |
| [`references/phase-1.md`](references/phase-1.md) | Phase 1 canonical instructions |
| [`references/phase-2.md`](references/phase-2.md) | Phase 2 canonical instructions |
| [`references/phase-3.md`](references/phase-3.md) | Phase 3 canonical instructions |
| [`references/phase-4.md`](references/phase-4.md) | Phase 4 canonical instructions |
| [`references/repo-type-guidance.md`](references/repo-type-guidance.md) | Packaging, Multi-module, even/odd versioning, and LLM-app guidance |
| [`references/repo-agent-templates.md`](references/repo-agent-templates.md) | Templates and registration rules for repo-local helper agents |
| [`references/prompt-templates.md`](references/prompt-templates.md) | Templates and registration rules for repo-aware prompts |
| [`references/skills-templates.md`](references/skills-templates.md) | Templates and registration rules for repo-local skills |
| [`references/rules-templates.md`](references/rules-templates.md) | Templates for `.claude/rules/` and `.cursor/rules/` projection files |
| [`references/release-skill-template.md`](references/release-skill-template.md) | `/release` skill template for versioned Maven/npm repos |
| [`references/maven-release.md`](references/maven-release.md) | Maven release plugin commands, even/odd versioning, troubleshooting |
