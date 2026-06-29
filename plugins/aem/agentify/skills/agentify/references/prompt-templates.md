# Agentify Prompt Templates

Use this reference when `references/phase-2.md` §2.12 (`prompts/`) is in scope.

## Goal

Create a small `prompts/` library that helps humans and agents work effectively in the target
repo without guessing where to start. These prompts must be **repo-aware**: they should name the
real build/test commands, key docs, important directories, and repo-specific guardrails discovered
earlier in the agentify flow.

## Rules

- Do not duplicate `AGENTS.md` verbatim. Prompt files should point back to `AGENTS.md` and other
  docs, then restate only the few repo facts needed for the task.
- Keep each prompt focused on one job. Avoid giant "do everything" prompts.
- Prefer concrete repo paths, module names, commands, and contracts over placeholders.
- Use Markdown so the prompts are easy to read and edit in git.
- Keep the library small. Start with 3-5 high-value prompts by default, then add optional prompts
  only when the repo type clearly calls for them. This is guidance, not a hard limit — create
  more when the repo has enough distinct, commonly used workflows to justify it.
- For simple repos, keep the library lean: create the baseline prompts, keep them concise, and
  avoid repeating large chunks of `AGENTS.md`, `README.md`, or existing runbooks.
- If agentify also creates repo-aware helper agents for the same workflows, keep prompt names,
  cited docs, and repo terminology aligned so the prompt and agent entry points reinforce the
  same code flows.
- Prompts are the lightweight human-readable starting point. Repo-aware helper agents are the
  executable workflow surface. Do not duplicate full workflow instructions in both.
## Baseline Prompt Set

Create these files for most repos:

- `prompts/README.md`
- `prompts/repo/explain-the-repo.md`
- `prompts/repo/plan-a-change.md`
- `prompts/repo/review-a-change.md`

Add `prompts/repo/debug-a-failure.md` when the repo has runtime behavior, tests, infra, or a
service surface worth debugging.

## Optional Prompt Set

Create these only when the repo type or workflow makes them clearly useful:

- `prompts/repo/add-or-fix-tests.md` for `Has-tests` repos
- `prompts/repo/prepare-a-release-change.md` for versioned repos or repos with a documented release process
- `prompts/repo/work-in-a-module.md` for `Multi-module` or `Monorepo` repos with non-obvious boundaries

For `LLM-app` repos, keep helper prompts under `prompts/repo/` and store application prompts in
dedicated subdirectories such as `prompts/system/`, `prompts/tasks/`, and `prompts/templates/`.
Do not mix user helper prompts and runtime application prompts in the same folder.

## Repo Facts to Inject

Every generated prompt should include the subset of these facts that matters for its task:

- Repo name and one-line purpose
- Primary languages/frameworks and build system
- Canonical docs to read first, usually `AGENTS.md`, `README.md`, and one or two deeper docs
- Build, test, lint, and typecheck commands when they exist
- Important directories, modules, or entry points
- Repo-specific "must not do" rules, immutable APIs, or release/versioning constraints
- Expected output format for the task (plan, patch, findings, root cause summary, etc.)

## Recommended File Pattern

Each prompt file should follow this rough shape:

```markdown
# <Prompt title>

Use this when: <one sentence>

Before you start:
- Read `AGENTS.md`
- Read <1-2 repo-specific docs or paths>
- Use `<build/test/lint command>` to validate when relevant

Repo context:
- Purpose: <one line>
- Stack: <languages/frameworks>
- Important paths: `<path>`, `<path>`
- Constraints: <must-not-do or immutable contract>

Prompt:
<task-specific prompt text>
```

## Template Guidance

### `prompts/README.md`

Purpose:
- Serve as the **exhaustive prompt catalog** — one section per prompt with full documentation
- Explain what lives under `prompts/` and how it relates to `AGENTS.md`
- Tell users to treat the files as starting points, not rigid scripts
- Keep `AGENTS.md#prompt-library` as the minimal index (path + one-liner per prompt); do not duplicate the exhaustive docs there

Required structure for each prompt section:
- Name and one-line purpose
- When to use (concrete trigger conditions)
- What it covers (bullet list of scope)
- How to invoke (exact invocation example)
- Expected output (what the prompt produces)
- Repo-specific docs it references

This file covers all prompts in the repo, not just the ones created in the current run.

### `prompts/repo/explain-the-repo.md`

Prompt goal:
- Help a user or agent understand the repo quickly
- Ask for a concise architecture map, important modules, key commands, and risky areas

Include:
- Which docs to read first
- Which directories/modules matter most
- A request to call out immutable contracts and common footguns

### `prompts/repo/plan-a-change.md`

Prompt goal:
- Produce a scoped implementation plan before editing

Include:
- The commands to validate after the change
- A request to search for existing patterns before proposing new structure
- A requirement to list risks, affected files, and tests to update

### `prompts/repo/review-a-change.md`

Prompt goal:
- Run a review with findings-first output

Include:
- A reminder to prioritize correctness, regressions, missing tests, and contract drift
- The repo's normal validation commands
- A request to use file/line references in findings

### `prompts/repo/debug-a-failure.md`

Prompt goal:
- Triage a broken build, failing test, incident, or runtime issue

Include:
- Where logs, workflows, runbooks, fixtures, or sample inputs live
- Commands for reproducing locally
- A request to separate confirmed facts from hypotheses

### Optional prompts

`add-or-fix-tests.md`
- Ask for the narrowest tests that prove behavior and guard regressions
- Name the repo's test framework and command

`prepare-a-release-change.md`
- Point to `docs/release-process.md` and versioning rules
- Ask for release-impact analysis and files that must stay in sync

`work-in-a-module.md`
- Describe the module map and module boundaries
- Ask the agent to state cross-module impact before changing shared code

## Prompt Registration Rule

**Applies whenever the prompt library is created or updated inside a target repo.**

After writing the canonical files under `prompts/`, always register the prompt library in the
exact order below.

**Required order:**
1. Update the canonical prompt files under `prompts/`.
2. Create or update `prompts/README.md` with exhaustive per-prompt documentation. For each
   prompt include: purpose, when to use it, what it covers, how to invoke it, expected output,
   and any repo-specific docs or commands it references. `prompts/README.md` is the exhaustive
   prompt catalog — one well-documented section per prompt, covering all prompts present in the
   repo, not just the ones changed in this run.
3. Create or update `docs/prompts.md` so it covers the full current prompt surface in scope,
   including both pre-existing prompts and prompts created or updated in the current run.
4. Update `AGENTS.md` with the **minimal** entry for the full current prompt set in the repo.
   Document for each prompt or prompt group only:
   - path under `prompts/`
   - when to use it
   - how to use it
   - what output or task it is meant to drive
   Do not copy the exhaustive documentation from `prompts/README.md` into `AGENTS.md`.
   `AGENTS.md` is the minimal index; `prompts/README.md` is the exhaustive catalog.
5. Update `README.md` with a brief human-facing note and point back to `AGENTS.md`.
6. If `docs/runbooks.md` and/or `wiki/architecture.md` already exist, or were explicitly
   approved in Phase 2, update them so they reflect the prompt library and canonical `prompts/`
   location. Otherwise leave them untouched.
7. Refresh the projection files so they point back to `AGENTS.md#prompt-library`.

`AGENTS.md` is the minimal index. `prompts/README.md` is the exhaustive catalog.
