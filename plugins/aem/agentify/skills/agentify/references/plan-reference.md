# Agentify Plan Reference

Lookup material that supports the main execution flow in `PLAN.md`.

## Quick Reference: When to Apply Each Step

| Step | Source | Packaging | Infra | Multi-module | Monorepo | Docs | LLM-app | Service | Has-tests | Has-env-vars | Multi-agent |
|------|:------:|:---------:|:-----:|:------------:|:--------:|:----:|:-------:|:-------:|:---------:|:------------:|:-----------:|
| 1.1 CLAUDE.md | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.2 README.md | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.3 CONTRIBUTING.md | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.4 CODEOWNERS | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.5 copilot-instructions | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.6 AGENTS.md (Codex/Copilot Workspace) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.7 .cursorrules + `.cursor/rules/*.mdc` | Cursor selected | Cursor selected | Cursor selected | Cursor selected | Cursor selected | Cursor selected | Cursor selected | Cursor selected | Cursor selected | Cursor selected | Cursor selected |
| 1.8 .editorconfig | ✅ | ✅ | ✅ | ✅ | ✅ | optional | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.9 .gitignore | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.10 .env.example | — | — | — | — | — | — | — | — | — | ✅ | — |
| 1.11 .claude/settings.json + `.claude/rules/*.md` (Claude Code only) | Claude Code | Claude Code | Claude Code | Claude Code | Claude Code | Claude Code | Claude Code | Claude Code | Claude Code | Claude Code | Claude Code |
| 1.12 .github/workflows/ci.yml | ✅ | optional | ✅ | ✅ | ✅ | optional | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.13 .codex/ + .agents/ (Codex/generic tools) | Codex/generic | Codex/generic | Codex/generic | Codex/generic | Codex/generic | Codex/generic | Codex/generic | Codex/generic | Codex/generic | Codex/generic | Codex/generic |
| 2.1 wiki/architecture.md (+ code-flow docs) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.2 docs/runbooks.md | ✅ | ✅ | ✅ | ✅ | ✅ | helpful | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.3 docs/decisions/ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.4 docs/testing.md | — | — | — | helpful | helpful | — | — | — | ✅ | — | — |
| 2.5 CHANGELOG.md | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | — | — |
| 2.6 docs/release-process.md | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | — | — |
| 2.7 docs/api.md / openapi | — | — | — | depends | depends | — | ✅ | ✅ | — | — | — |
| 2.8 Public API docs | ✅ | deps only | scripts | ✅ | ✅ | — | ✅ | ✅ | — | — | — |
| 2.9 Config file comments | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.10 Type annotations | dyn. langs | — | scripts | dyn. langs | dyn. langs | — | dyn. langs | dyn. langs | — | — | — |
| 2.11 Test naming | — | — | — | — | — | — | — | — | ✅ | — | — |
| 2.12 prompts/ + repo-aware helper agents | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.13 evals/ | — | — | — | — | — | — | ✅ | — | — | — | — |
| 2.14 schemas/ | — | — | — | depends | depends | — | ✅ | ✅ | — | — | — |
| 2.15 fixtures/ | — | — | — | helpful | helpful | — | — | — | ✅ | — | — |
| 3.1 src/config/ | ✅ | — | — | ✅ | ✅ | — | ✅ | ✅ | — | — | — |
| 3.2 src/lib/logger.* | ✅ | — | — | ✅ | ✅ | — | ✅ | ✅ | — | — | — |
| 3.3 Magic values | ✅ | — | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | — | — |
| 3.4 Method length | ✅ | — | scripts | ✅ | ✅ | — | ✅ | ✅ | — | — | — |
| 3.5 Explicit deps | ✅ | — | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | — | — |
| 3.6 Directory structure | ✅ | rarely | ✅ | critical | critical | — | ✅ | ✅ | — | — | — |
| 4.1 CI pipeline | ✅ | optional | ✅ | ✅ | ✅ | optional | ✅ | ✅ | ✅ | — | — |
| 4.2 Pre-commit hooks | ✅ | optional | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | — | — |
| 4.3 PR template | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4.4 Doc coverage CI | ✅ | — | — | ✅ | ✅ | — | ✅ | ✅ | — | — | — |
| 4.5 Observability baseline | ✅ | — | — | depends | ✅ | — | ✅ | ✅ | — | — | — |
| 4.6 Security and ops docs | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | — |
| 4.7 Periodic audits | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4.8 Living AGENTS.md | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Estimated Effort by Phase

| Phase | Typical Effort | Expected Impact |
|-------|---------------|-----------------|
| Phase 0: Assessment | 2–4 hours | Foundation — prevents wasted effort |
| Phase 1: High-ROI wins | 1–2 hours per repo | High — AGENTS.md alone improves AI accuracy by 50%+ |
| Phase 2: Contract clarity | 1–2 days for new docs, prompt libraries, and helper agents, plus ongoing upkeep when explicitly selected or already present | Medium-High — cumulative as structural coverage grows |
| Phase 3: Structural | Ongoing (varies per change) | Medium — reduces hallucination on complex reasoning |
| Phase 4: Automation | 4–8 hours initial setup | High for sustainability — prevents regression |

## Priority Order

1. **`AGENTS.md`** — single highest-impact action; vendor-neutral SSoT read by all major AI tools
2. **`CLAUDE.md`** — Claude Code's pointer to `AGENTS.md`; create immediately after `AGENTS.md`
3. **`.cursorrules`** — when Cursor is selected, create its pointer to `AGENTS.md`
4. **`.github/CODEOWNERS`** — always create; controls PR review routing for humans and AI tools
5. **`README.md`** — fixes the universal entry point
6. **`CONTRIBUTING.md`** — defines the behavioural contract for humans and AI agents
7. **`.github/copilot-instructions.md`** — Copilot IDE's pointer to `AGENTS.md`
8. **`wiki/architecture.md`** + **`wiki/code-flows.md`** + **`wiki/code-flow-*.md`** + **`docs/runbooks.md`** + **`prompts/README.md`** + **repo-aware helper agents under `agents/`** + **`agents/README.md`** — operational and structural context; `skills/README.md` belongs here too for repos that have skills
9. **`docs/decisions/`** — captures tribal knowledge before it is lost
10. **Everything else** — boy-scout rule, incrementally, when files are touched

> The boy-scout rule is the key sustainability mechanism: **never do a big-bang rewrite — improve incrementally every time a file is touched.**
