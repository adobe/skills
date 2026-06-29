# Agentify Phase 4

Use this file for the full Phase 4 workflow. `PLAN.md` remains the top-level execution index,
but the canonical Phase 4 instructions live here. This document is self-sufficient for Phase 4:
once it becomes active, it replaces `phase-3.md` as the current phase instruction source.

## Scope And Prerequisites

- Start only after Phase 3 triage is complete and any selected Phase 3 work has reached final
  state.
- Use this file for all `4.1`–`4.8` work and for Phase 4 triage.
- Keep this file as the active Phase 4 instruction source when Phase 4 items are being assessed or executed.
- For applicability, effort, and priority lookup, use [plan-reference.md](plan-reference.md).
- Phase 4 does not depend on Phase 3 content. It may begin after the Phase 3 handoff even when
  some Phase 3 items were explicitly deferred.

## Phase 4: Automation And Ongoing Hygiene

**Goal:** Prevent regression and ensure AI-nativeness improves over time.

## Default Triage For Phase 4

Phase 4 contains a mix of immediate quick wins and larger follow-up work. Do not present it as
universally deferred.

- **Do now** when the work is a lightweight additive change that improves future agent work
  immediately without redesigning the repo's tooling.
- **Offer now** when the work is valuable but needs an explicit user decision on rollout cost,
  CI/tooling changes, or operational scope.
- **Defer** only when the work is a broader process change that is better handled in a dedicated
  follow-up effort.

**Default guidance:**
- **Do now:** `4.3` PR template, `4.8` living-document rule, and `4.1` / `4.4` when they are
  lightweight additive changes that fit the current repo tooling without redesigning CI
- **Offer now:** `4.1` when CI needs a broader redesign, `4.2` pre-commit hooks, `4.5`
  observability baseline, `4.6` security and ops docs, `4.7` periodic audit process
- **Defer:** only the larger rollout items that do not fit the current session cleanly

When presenting Phase 4, say which applicable steps fall into which bucket and why.

After classification:
- execute `Do now` items in the current session
- present `Offer now` items to the user before doing them
- record `Defer` items so they appear in the completion report as explicit follow-up work

### 4.1 — CI Pipeline (Formatting, Linting, Tests, Type Checks)

**When to apply:** All repo types with a CI system.

**What to do:** Ensure CI runs on every PR and covers all applicable checks:

| Check | Tools |
|-------|-------|
| Formatting | Spotless, Prettier, Black, gofmt |
| Linting | Checkstyle, ESLint, Pylint, golint |
| Tests | JUnit, pytest, Jest, go test |
| Coverage report | JaCoCo, coverage.py, nyc, go cover |
| Type check | tsc, mypy, pyright |
| Eval runs | Custom eval script (LLM-app repos only) |

Use `.github/workflows/ci.yml` for GitHub Actions, or extend Jenkinsfile/GitLab CI.

**Files:** `.github/workflows/ci.yml` or equivalent CI config.

**Done when:** Every PR is blocked if formatting, linting, or tests fail. Coverage report is published as a PR comment.

### 4.2 — Pre-Commit Hooks

**When to apply:** **Source** and **Infra** repos.

**What to do:** Configure pre-commit hooks that enforce formatting and linting before every commit. Use the pre-commit framework (<https://pre-commit.com>) for multi-language repos.

- Java: Spotless, Checkstyle
- Python: Black, Ruff, isort
- JavaScript/TypeScript: Prettier, ESLint
- Go: gofmt, golint

**Files:** `.pre-commit-config.yaml` or equivalent.

**Done when:** Malformatted code cannot be committed. Running the formatter on any file after a commit produces no changes.

### 4.3 — `.github/PULL_REQUEST_TEMPLATE.md`

**When to apply:** All repo types hosted on GitHub.

**What to do:** Create `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## Summary
[What changed and why]

## Changes
[Key files/methods changed]

## Test Plan
- [ ] New tests added
- [ ] Existing tests pass
- [ ] Manual testing performed (describe)

## AI Review Notes
[Any context that helps Copilot or other AI reviewers understand the change]
```

**Files:** New `.github/PULL_REQUEST_TEMPLATE.md`.

**Done when:** Every PR follows the template. "AI Review Notes" is populated for non-obvious changes.

### 4.4 — CI Documentation Coverage Check

**When to apply:** **Source** repos with public APIs.

**What to do:** Add a CI step that warns (not blocks initially) when public methods lack documentation.

- Java: Checkstyle `MissingJavadocMethod`
- Python: `interrogate` or `pydocstyle`
- JavaScript/TypeScript: `eslint-plugin-jsdoc`

**Done when:** CI reports documentation coverage percentage on every PR. The metric trends upward over time.

### 4.5 — Observability Baseline

**When to apply:** **Source** repos deployed to a runtime environment.

**What to do:** Document and enforce observability basics in `AGENTS.md` and `CONTRIBUTING.md`.
If tool-local projection files are in scope for the selected tools, sync their short pointers after
updating `AGENTS.md`:

- **Logging conventions**: log levels, structured fields, correlation IDs, what must always be logged (errors, slow operations, external calls)
- **Error handling**: how errors are caught, wrapped, and surfaced — never silently swallowed
- **Tracing**: if distributed tracing is used, document the span naming convention and where to find traces

Ensure new code follows these conventions. Add a CI lint rule if feasible.

**Done when:** Any developer (or AI agent) adding a new feature knows exactly what to log, how to handle errors, and how to instrument spans without asking.

**Skip if:** The repo is packaging-only, infrastructure-only, or produces no running process.

### 4.6 — Security And Ops Docs

**When to apply:** All repo types that handle secrets, user data, or have deploy steps.

**What to do:** Document in `docs/runbooks.md` or a dedicated `docs/security.md`:

- Where secrets live and how they are injected (never hardcoded)
- Permission model: who/what has access to which resources
- Database migration process (if applicable)
- Deploy steps in order
- Rollback procedure

**Done when:** A new team member can handle a credential rotation or a failed deployment without asking anyone.

### 4.7 — Periodic AI-Nativeness Audits

**When to apply:** All repo types.

**What to do:** Quarterly, re-run Phase 0 and score the repo against all applicable steps in this plan. Track metrics:

- Documentation coverage (% of public methods with docs)
- Test coverage (line and branch %)
- Magic value count per 1000 lines
- Average method length
- Number of files without any associated test
- Plan step completion count (applicable steps present vs total applicable)

**Done when:** Metrics improve or hold steady quarter-over-quarter. Any regression has a documented root cause.

### 4.8 — `AGENTS.md` As A Living Document

**When to apply:** All repo types.

**What to do:** Add to the team's definition-of-done: "If this change alters build steps,
conventions, architecture, deployment, prompts, or repo-local agents, update `AGENTS.md` first."
Treat `AGENTS.md` like a Dockerfile — it must always reflect reality. After updating it, sync the
tool-local projection files in the same change.

**Done when:** `AGENTS.md` was last modified within the last 30 days (for active repos), and the
tool-local projections still accurately point back to it.

## Phase 4 Completion

When the selected Phase 4 work is complete:
- summarize what was done now, what was offered, and what was deferred
- hand control back to `SKILL.md` / `PLAN.md`
- continue to verification, completion reporting, or post-PR flow as appropriate
