# Agentify Phase 2

Use this file for the full Phase 2 workflow. `PLAN.md` remains the top-level execution index,
but the canonical Phase 2 instructions live here. This document is self-sufficient for Phase 2:
once it becomes active, it replaces `phase-1.md` as the current phase instruction source.

## Prerequisite Gate

Phase 2 may start only after Phase 1 is fully complete.

Before offering or starting any Phase 2 work, confirm all of the following:
- every applicable Phase 1 item is in a final state: completed and written, explicitly skipped
  with a recorded reason, not applicable, already adequate, or explicitly declined by the user
- there is no pending Phase 1 draft awaiting approval
- every in-scope Phase 1 file has a final status
- the skipped-files report was shown

If any Phase 1 work is still pending, stop and return to Phase 1. Do not begin Phase 2.

Once the gate passes, assume all Phase 1 files exist in final approved form. If a mandatory Phase 1
file is missing, return to Phase 1 rather than papering over the gap.

## Skill Registration Rule

See [skills-templates.md → Skill Registration Rule](skills-templates.md) for the full required
order. Apply it whenever any skill is created inside a target repo.

## Prompt Registration Rule

See [prompt-templates.md → Prompt Registration Rule](prompt-templates.md) for the full required
order. Apply it whenever the prompt library is created or updated inside a target repo.

## Agent Registration Rule

See [repo-agent-templates.md → Agent Registration Rule](repo-agent-templates.md) for the full
required order. Apply it whenever any repo-local helper agent is created inside a target repo.

## Workflow Registration Rule

**Applies whenever GitHub workflow automation is created, updated, or documented inside a target
repo.**

After writing or reviewing the canonical workflow files under `.github/workflows/` and any related
shared helper scripts under `.github/scripts/`, always register the workflow surface in the exact
order below. This registration pass must cover the full current workflow surface in scope for the
repo section you are updating, not just the workflows changed in the current run.

**Required order:**
1. Update the canonical workflow files under `.github/workflows/` and any touched shared helpers
   under `.github/scripts/` when the current change modifies them. If the current change is only
   documenting an already-existing workflow surface, read those files first and treat them as the
   source material for the docs below.
2. Create or update `docs/workflows.md` so it covers the full current workflow surface in scope,
   including both pre-existing workflows and workflows created or updated in the current run.
3. Create or update `.github/workflows/README.md` so it explains the detailed behavior for the
   workflows currently in scope without duplicating the stable contract from `docs/workflows.md`.
4. Update `AGENTS.md` so the repository structure tree, `## Key Documentation`, and workflow
   summary reflect the current workflow surface in scope.
5. If `docs/runbooks.md` and/or `wiki/architecture.md` already exist, or were explicitly approved
   in Phase 2, update them so they reflect the current workflow surface and canonical workflow-doc
   locations. Otherwise leave them untouched.
6. Refresh any affected projection or quick-reference files so they point back to `AGENTS.md`,
   `docs/workflows.md`, or `.github/workflows/README.md` instead of duplicating workflow rules.

## Decision Registration Rule

**Applies whenever `docs/decisions/` is created or updated inside a target repo.**

After writing the canonical ADR files under `docs/decisions/`, always register the decision set in
the exact order below. This registration pass must cover the full current ADR set in scope for the
repo section you are updating, not just the ADRs created in the current change.

**Required order:**
1. Update the canonical ADR files under `docs/decisions/`.
2. Update `AGENTS.md` so the repository structure tree and `## Key Documentation` entry reflect
   `docs/decisions/` as the canonical ADR location.
3. Update `README.md` only if it already mentions the generated Phase 2 decision-doc set and needs
   a brief human-facing pointer refresh. Do not turn `README.md` into the ADR catalog.
4. If `docs/runbooks.md` and/or `wiki/architecture.md` already exist, or were explicitly approved
   in Phase 2, update them so they reflect the ADR set and where it lives. Otherwise leave them
   untouched.
5. Refresh any affected projection or quick-reference files so they continue to point back to
   `AGENTS.md` rather than duplicating ADR content.

## Surface API Registration Rule

**Applies whenever helper-surface contract docs are created or updated inside `docs/`.**

This rule covers focused contract docs for repo helper surfaces such as:
- `docs/workflows.md`
- `docs/skills.md`
- `docs/rules.md`
- `docs/prompts.md`
- `docs/agents.md`
- the top-level index `docs/api.md`

These files are canonical only under `docs/`. Do not create helper-surface contract files such as
`skills/api.md`, `prompts/api.md`, `agents/api.md`, `.github/workflows/api.md`, or similar
surface-local duplicates.

Each helper-surface contract doc must cover the full current surface in scope for that repo area,
including both items that already existed before the run and items created or updated in the
current run. Do not write these docs as change summaries or delta-only notes.

After writing the canonical surface API docs, always register them in the exact order below.

**Required order:**
1. Update the canonical surface API docs under `docs/`.
2. Update `AGENTS.md` so the repository structure tree and `## Key Documentation` entries reflect
   the current surface API docs that exist in the repo.
3. Update `README.md` only when it already mentions the relevant helper surface and needs a brief
   human-facing pointer refresh. Do not turn `README.md` into a detailed contract catalog.
4. If `docs/runbooks.md` and/or `wiki/architecture.md` already exist, or were explicitly approved
   in Phase 2, update them so they reflect the current surface API docs and canonical locations.
   Otherwise leave them untouched.
5. Refresh any affected projection or quick-reference files so they continue to point back to the
   canonical contract docs instead of duplicating the contracts inline.

## Phase 2 Registration Rule

**Applies after any Phase 2 deliverable is written** (`wiki/architecture.md`, `wiki/code-flows.md`,
`wiki/code-flow-*.md`, `docs/runbooks.md`, `docs/decisions/`, `docs/testing.md`,
`docs/release-process.md`, `prompts/README.md`, root-level repo-aware helper agents under
`agents/`, etc.).

After writing each Phase 2 file or prompt-library entry point, update `AGENTS.md` and any
affected projection quick-reference files.

1. **Repository Structure tree** — add the new file or directory with a one-line description.
2. **Key Documentation section** — add or update the `## Key Documentation` table entry.
3. **Prompt Library section** — when `prompts/` changes, update `AGENTS.md#prompt-library` with
   the **minimal** entry per prompt (path + one-liner). Update `prompts/README.md` with exhaustive
   per-prompt documentation. Do not put exhaustive docs in `AGENTS.md`.
4. **Projection quick references** — when `prompts/` changes, refresh short pointers in selected
   tool-local projection files so they point to `AGENTS.md#prompt-library` and `prompts/README.md`.
5. **Available Agents section** — when repo-local agents change, update `AGENTS.md#available-agents`
   with the **minimal** entry per agent (name, path, one-line guardrails). Update `agents/README.md`
   with exhaustive per-agent documentation. Do not put exhaustive docs in `AGENTS.md`.
6. **Projection quick references for agents** — when repo-local agents change, refresh the short
   agent-catalog pointers in selected projection files (`CLAUDE.md`, `.cursorrules`,
   `.github/copilot-instructions.md`) so they point to `AGENTS.md#available-agents`
   and `agents/README.md`.
7. **Available Skills section** — when repo-local skills change, update `AGENTS.md#available-skills`
   with the **minimal** entry per skill (name, path, one-line when-to-use). Update `skills/README.md`
   with exhaustive per-skill documentation. Do not put exhaustive docs in `AGENTS.md`.
8. **Projection quick references for skills** — when repo-local skills change, refresh the short
   skill-catalog pointers in selected projection files (`CLAUDE.md`, `.cursorrules`,
   `.github/copilot-instructions.md`) so they point to `AGENTS.md#available-skills`
   and `skills/README.md`.

Do not duplicate long content in `AGENTS.md` table entries or projection files. `AGENTS.md` carries
the minimal index; exhaustive catalogs live in `prompts/README.md`, `agents/README.md`, and
`skills/README.md`. Show the `AGENTS.md` additions before writing.

## Phase 2: Contract Clarity

**Goal:** Make the codebase self-documenting so AI tools can reason about intent, not just syntax.

### Presenting Phase 2 to the User

Only after the prerequisite gate above passes:
- offer Phase 2 explicitly
- do not start Phase 2 work without asking
- do not assume defer
- keep this file as the only active phase document until Phase 2 is complete

**Always applicable (offer first):**
- `2.1` `wiki/architecture.md` + `wiki/code-flows.md` + 3–4 `wiki/code-flow-*.md` pages
- `2.2` `docs/runbooks.md`
- `2.3` `docs/decisions/`
- `2.12` helper-surface docs: `prompts/README.md` + repo-aware prompts + root-level helper agents + focused API docs for workflows, skills, rules, prompts, and agents when those surfaces exist
- `2.5` `CHANGELOG.md` for versioned repos
- `2.6` `docs/release-process.md` for versioned repos

**Conditionally applicable:**
- `2.4` `docs/testing.md` → Has-tests only
- `2.7` `docs/api.md` / `openapi.yaml` → Service only
- `2.8` public API overview + source-level API docs → Source repos with a public API surface
- `2.13` `evals/` → LLM-app only

**When drafting any Phase 2 deliverable:**
1. Read relevant source files first.
2. Draft from actual repo content.
3. Show the draft and wait for approval.
4. Write only after approval.

> `2.6` and `2.9` follow the boy-scout rule when touched. `2.1`–`2.5`, `2.7`, `2.12`, and the
> public API overview portion of `2.8` are one-time documentation or helper-surface tasks.

### 2.1 — `wiki/architecture.md` (+ code-flow wiki pages)

**When to apply:** All repo types.

**What to do:** Write a one-to-two page architecture document covering system shape, major
components, data flow, external dependencies, and deployment model. Also create:
- `wiki/code-flows.md` — index page for generated workflow docs
- `wiki/code-flow-<slug>.md` — 3–4 low-level workflow pages

Keep `wiki/architecture.md` high-level. Put path-by-path execution in the per-workflow pages.
Use Mermaid diagrams when possible.

For multi-module repos, add a module topology section covering:
- root/aggregator module
- public API vs implementation vs tests/integrations/packaging modules
- which modules are safe to change in isolation
- which modules must stay version-aligned

Each code-flow page should include:
- a short workflow title
- why the workflow matters
- entry points/components/files involved
- one Mermaid diagram

Treat these pages as living docs:
- add a new page when the repo gains a new major workflow
- update matching pages when an existing workflow changes
- update index plus pages when workflows are renamed, split, or removed

**Files:** Ensure `wiki/` exists; add `wiki/architecture.md`, `wiki/code-flows.md`, and 3–4
`wiki/code-flow-<slug>.md` files.

**GitHub wiki sync (GitHub repos only):**
1. Check whether the GitHub wiki is enabled:
   ```bash
   gh api repos/OWNER/REPO --jq '.has_wiki'
   ```
2. If false, enable it:
   ```bash
   gh api repos/OWNER/REPO -X PATCH -f 'has_wiki=true'
   ```
3. Try cloning the wiki repo:
   ```bash
   git clone git@github.com:OWNER/REPO.wiki.git /tmp/repo-wiki 2>&1
   ```
4. If clone fails because the wiki is uninitialized, ask the user to create the first page in the
   GitHub UI, then wait.
5. Copy updated wiki files into the wiki repo, commit, and push.

**Done when:** An LLM reading only these wiki files can understand the repo shape and its key
workflows without guessing.

### 2.2 — `docs/runbooks.md`

**When to apply:** Repos with release, deploy, or important operational procedures.

**What to do:** Document how to release, debug common failures, deploy, rotate secrets, handle
database migrations, and basic incident response.

**Files:** New `docs/runbooks.md`.

**Done when:** An on-call engineer or AI agent can perform the three most common operational tasks
without asking anyone.

### 2.3 — `docs/decisions/`

**When to apply:** All repo types.

**What to do:** Create `docs/decisions/` and write lightweight ADRs for the 4-5 most important
past decisions that are currently tribal knowledge. Treat that as the default starting set, not a
hard cap: if the repo clearly has more than five independent, high-value decisions that agents or
contributors repeatedly need to understand, create more.

Find likely candidates first:

```bash
git --no-pager log --oneline --all -n 200
```

If a commit message includes a JIRA key matching `[A-Z]+-[0-9]+`, use it directly. Never invent a
ticket ID.

ADR format:

```markdown
# ADR-0001: Title

**Status:** Accepted
**Linked ticket:** PROJECT-123
**Context:** Why was this decision needed?
**Decision:** What was decided?
**Consequences:** What are the trade-offs?
```

**Files:** New `docs/decisions/0001-*.md`, etc.

After writing the ADR files, apply the **Decision Registration Rule** above.

**Done when:** The default 4-5 highest-value "why did we do it this way?" questions are answered by
ADRs, and any additional repo-specific decisions worth preserving have also been captured.

### 2.4 — `docs/testing.md`

**When to apply:** Has-tests repos only.

**What to do:** Document the test pyramid, fixture/mocks locations, targeted test commands, and
coverage thresholds. For multi-module repos, include module-aware test commands.

**Files:** New `docs/testing.md`.

**Done when:** An AI agent can place and write a correctly structured test by following this file
alone.

### 2.5 — `CHANGELOG.md`

**When to apply:** Repos with versioned releases.

**What to do:** Create `CHANGELOG.md` using Keep a Changelog format, seeded from git history.

**Files:** New `CHANGELOG.md`.

**Done when:** Every released version has an entry and the last release can be answered from this
file alone.

### 2.6 — `docs/release-process.md`

**When to apply:** Repos that produce versioned releases or deployable artifacts.

**What to do:** Use the Phase 0 assessment output rather than re-reading files unnecessarily.
Document:
- versioning strategy
- release ownership (manual vs CI-managed)
- pre-release checklist
- release flow
- post-release verification
- rollback

For any repo that does versioned releases, **both `docs/release-process.md` and a `/release`
execution skill are required, non-deferrable deliverables**.
Create the `/release` skill as a separate deliverable immediately after
`docs/release-process.md` is written and confirmed. Do not skip, defer, or treat the skill as
optional — it is mandatory for versioned repos whenever release documentation is in scope.

**Required execution order for the `/release` skill:**

Follow the **Skill Registration Rule** in [skills-templates.md](skills-templates.md), applied to
`skills/release/`. If the target repo uses Codex, also create `skills/release/agents/openai.yaml`
with lightweight interface metadata after completing the registration steps.

**Done when:** Any team member or AI agent can execute a release from scratch by following the
document alone.

### 2.7 — Service API documentation

**When to apply:** Service repos only.

**What to do:** Document service boundaries using `docs/api.md`, `openapi.yaml`, `schemas/`, or
equivalent machine-readable contracts.

**Done when:** An LLM can generate a valid API client from the documented contract alone.

### 2.8 — Public API documentation

**When to apply:** Source repos only. Boy-scout rule.

**What to do:** Add in-file public API docs when touching files. Also, if the repo exposes a
public API surface, explicitly offer a repo-level public API overview.

Use these targets:
- library/component repos: `docs/api.md`
- large code-heavy repos: `docs/api-overview.md`
- service repos: use `2.7` instead

**Done when:** An LLM reading only the chosen overview file can answer what the public contract is
and which types are safe to call.

### 2.9 — Configuration file comments

**When to apply:** All repo types. Boy-scout rule.

**What to do:** Add inline comments to non-obvious configuration entries. Explain why, not what.

### 2.10 — Type annotations

**When to apply:** Source repos using dynamic languages only. Boy-scout rule.

**What to do:** Add type hints or type-like annotations to public function signatures when files
are touched.

### 2.11 — Descriptive test names

**When to apply:** Has-tests repos only. Boy-scout rule.

**What to do:** Ensure test names encode what is tested, under what condition, and the expected
outcome.

### 2.12 — `prompts/` + repo-aware helper agents + helper-surface API docs

**When to apply:** All repo types. Highest priority for Multi-agent and LLM-app repos.

**Before drafting:**
- read [prompt-templates.md](prompt-templates.md) when `prompts/` is in scope
- read [repo-agent-templates.md](repo-agent-templates.md) when helper agents are in scope
- read [skills-templates.md](skills-templates.md) when repo-local skills (other than `/release`) are in scope
- use recurring workflows discovered in Phase 0/1 and, when present, `wiki/code-flows.md` plus
  matching `wiki/code-flow-*.md` pages as the source of truth

**Helper-surface API docs to create when the matching surface exists or is generated in scope:**
- `docs/workflows.md` for workflow contracts
- `docs/skills.md` for repo-local skill contracts
- `docs/rules.md` for tool-local rules and projection-rule contracts
- `docs/prompts.md` for prompt-library contracts
- `docs/agents.md` for repo-local helper-agent contracts
- `docs/api.md` as the top-level index for those surface docs

Do not create surface API docs for surfaces that do not exist in the target repo. Keep each doc
focused on one surface instead of combining all helper-surface contracts into one large file.
Create them only under `docs/`, never as `api.md` files colocated with the surface they describe.
Each doc should describe the whole current surface in scope, including both pre-existing and newly
created items, so a fresh reader can understand the repo without cross-referencing the diff.

**Required execution order inside `2.12`:**
1. Create or update the canonical prompts under `prompts/`.
2. Create or update `prompts/README.md` with **exhaustive** per-prompt documentation — one
   section per prompt covering: purpose, when to use, what it covers, how to invoke, expected
   output, and repo-specific docs it references. This is the exhaustive prompt catalog; cover all
   prompts in the repo, not just the ones created in this run.
3. Create or update `docs/prompts.md` so it covers the full current prompt surface in scope.
4. Update `AGENTS.md` `## Prompt Library` with the **minimal** entry per prompt (name, path,
   and a brief when-to-use signal). Exhaustive docs go only in `prompts/README.md`.
5. Update `README.md` with only the brief human-facing prompt pointer.
6. If `docs/runbooks.md` and/or `wiki/architecture.md` already exist, or were explicitly
   approved in Phase 2, update them so they reflect the prompt library and canonical `prompts/`
   location. Otherwise leave them untouched.
7. Update projection files so they point to `AGENTS.md#prompt-library` and `prompts/README.md`.
8. Create or update the canonical helper agents under `agents/`.
9. Create or update `agents/README.md` with **exhaustive** per-agent documentation — one section
   per agent covering: purpose, files, phases/workflow steps, invocation examples, expectations,
   and constraints. This is the exhaustive agent catalog; cover all agents in the repo, not just
   the ones created in this run.
10. Create or update `docs/agents.md` so it covers the full current agent surface in scope.
11. Update `AGENTS.md` `## Available Agents` with the **minimal** entry per agent (name, path,
    brief when-to-use signal, and one-line guardrails). Exhaustive docs go only in `agents/README.md`.
12. Update `README.md` with only the brief human-facing agent pointer.
13. If `docs/runbooks.md` and/or `wiki/architecture.md` already exist, or were explicitly
    approved in Phase 2, update them so they reflect the helper-agent catalog and canonical
    `agents/` location. Otherwise leave them untouched.
14. Update projection files so they point to `AGENTS.md#available-agents` and `agents/README.md`.
15. Create or repair `.claude/agents`, `.codex/agents`, `.agents/agents`, `.cursor/agents`, and
    `.github/agents`.
16. If the target repo has skills under `skills/`, create or update `skills/README.md` with
    **exhaustive** per-skill documentation — one section per skill covering: purpose, trigger
    phrases, argument usage, workflow steps, supporting files, and constraints. This is the
    exhaustive skill catalog. Update `AGENTS.md` `## Available Skills` with the **minimal** entry
    only.
17. Create or update the remaining helper-surface API docs under `docs/` for every other in-scope
    surface that now exists and was not already covered above, typically workflows and rules. In
    each doc, cover the full current surface in scope, including both pre-existing and newly
    created items.
18. Update `docs/api.md` so it serves as the index for the focused helper-surface API docs rather
    than the only place those contracts are described.
19. Apply the **Surface API Registration Rule** above.

Typical prompt baseline:

```text
prompts/
  README.md
  repo/
    explain-the-repo.md
    plan-a-change.md
    review-a-change.md
```

Typical helper-agent baseline:

```text
agents/
  explain-the-repo/
    AGENT.md
    openai.yaml
  plan-a-change/
    AGENT.md
    openai.yaml
  review-a-change/
    AGENT.md
    openai.yaml
```

Create 3–5 prompts and 3–5 helper agents by default. This is guidance, not a hard cap.

For LLM-app repos, keep helper prompts under `prompts/repo/` and store runtime prompts under
`prompts/system/`, `prompts/tasks/`, and `prompts/templates/` as applicable.

Every helper agent must:
- automate a real, repeated repo code flow
- reference actual repo docs, commands, paths, and output expectations
- point back to `AGENTS.md` and deeper workflow docs rather than duplicating them
- stay focused on one workflow
- use lightweight `openai.yaml` only when Codex is selected
- live canonically under `agents/`

**Done when:** A newcomer can use `prompts/README.md` and the generated helper agents to work in
the repo without reverse-engineering the layout first.

### 2.13 — `evals/`

**When to apply:** LLM-app repos only.

**What to do:** Create `evals/` containing evaluation cases, golden outputs, and scripts that run
evals and report pass/fail. Add eval runs to CI when prompt/model files change.

### 2.14 — `schemas/`

**When to apply:** Service or LLM-app repos with important data contracts.

**What to do:** Create machine-readable schemas for data crossing system boundaries.

### 2.15 — `fixtures/` or `scripts/seed.*`

**When to apply:** Has-tests repos where reproducible test data matters.

**What to do:** Add seed data, factories, and mock responses needed to run tests consistently.
