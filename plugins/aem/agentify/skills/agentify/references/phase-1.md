# Agentify Phase 1

Use this file for the full Phase 1 workflow. `PLAN.md` remains the top-level execution index,
but the canonical Phase 1 instructions live here. This document is self-sufficient for Phase 1:
while it is active, do not load or use `phase-2.md` as an execution source.

## Scope And Prerequisites

- Start only after Step 0 is resolved and Phase 0 classification is confirmed.
- Use this file for all `1.1`–`1.13` work and for the Phase 1 completion gate.
- Keep `AGENTS.md` as the single source of truth. Tool-local files stay lightweight projections.
- For applicability, effort, and priority lookup, use [plan-reference.md](plan-reference.md).
- For repo-type-specific Phase 1 guidance, use [repo-type-guidance.md](repo-type-guidance.md).

## Phase 1: Zero-Effort, High-ROI Wins

**Goal:** Add the files AI tools read first. No source code changes required.

### The Single Source Of Truth Pattern

Use `AGENTS.md` as the single source of truth. It is vendor-neutral and read by OpenAI Codex,
GitHub Copilot Workspace, and future agents.

Tool-local projection files (`CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`)
are lightweight pointers — but they deliberately include one additional element beyond a pure
pointer: a **minimal index table** (name, path, when-to-use) for prompts, agents, skills, and
workflows when those surfaces exist in the repo. This lets Claude act without always loading
`AGENTS.md`. Only the index rows are copied — never the exhaustive per-item docs, which belong
in `prompts/README.md`, `agents/README.md`, `skills/README.md`, and `.github/workflows/README.md`.

**Rule:** When conventions change, update `AGENTS.md` first. Then sync the index tables in
the projection files in the same commit. All generated projection files must say explicitly that
they are projections and must not be edited directly.

```text
AGENTS.md                              ← full conventions, build, architecture, anti-patterns (SSoT)
  ↑ referenced by:
  ├── CLAUDE.md                        ← Claude Code
  ├── .claude/rules/*.md               ← Claude quick-reference rules (when selected)
  ├── .cursorrules                     ← Cursor (when selected)
  ├── .cursor/rules/*.mdc              ← Cursor quick-reference rules (when selected)
  └── .github/copilot-instructions.md  ← GitHub Copilot IDE
```

If the repo has repo-local helper agents, keep them canonical under the root `agents/` folder.
Tool-local `agents/` paths are mirrors only and must point back to `agents/`:

```text
agents/                                ← canonical repo-aware agent catalog
.claude/agents                         ← symlink mirror → ../agents
.codex/agents                          ← symlink mirror → ../agents
.agents/agents                         ← symlink mirror → ../agents
.cursor/agents                         ← symlink mirror → ../agents
.github/agents                         ← symlink mirror → ../agents
```

### 1.1 — `CLAUDE.md`

**When to apply:** Claude Code selected.

**What to do:** Create `CLAUDE.md` at repo root as a projection of `AGENTS.md`.
Include:
- a prominent "Projection only: never edit this file directly; update `AGENTS.md` first." note
- a "Canonical source: `AGENTS.md`" header
- a "Projected from `AGENTS.md` as of <date/commit>" audit line
- a reminder to update `AGENTS.md` first when repo guidance changes
- a minimal quick-reference summary of critical rules
- if `prompts/` exists: the same minimal index table from `AGENTS.md#prompt-library` (name, path,
  when-to-use) plus a pointer to `prompts/README.md` for the exhaustive catalog
- if `agents/` exists: the same minimal index table from `AGENTS.md#available-agents` (name, path,
  when-to-use) plus a pointer to `agents/README.md` for the exhaustive catalog
- if `skills/` exists: the same minimal index table from `AGENTS.md#available-skills` (name, path,
  when-to-use) plus a pointer to `skills/README.md` for the exhaustive catalog
- if `.github/workflows/` exists: the same minimal index table from `AGENTS.md#workflow-overview`
  (name, file, trigger) plus a pointer to `.github/workflows/README.md` for the exhaustive catalog

**Minimal-index rule for projections:** `CLAUDE.md` must mirror the same minimal index tables
that live in `AGENTS.md` — not copy the exhaustive docs. The table rows (name, path, when-to-use)
are enough for Claude to act without opening `AGENTS.md`. The exhaustive per-item docs belong in
`prompts/README.md`, `agents/README.md`, and `skills/README.md` only. Keep `CLAUDE.md` in sync
with `AGENTS.md` whenever entries are added, renamed, or removed.

Do not create `.claude/rules/*.md` here. Those belong to `1.11`.

**Files:** New `CLAUDE.md`.

**Done when:** An LLM reading this file knows to load `AGENTS.md` and has enough quick context to
avoid common mistakes when `AGENTS.md` is not already in context.

**Repo type notes:**
- Packaging: focus on dependency management, versioning strategy, release process, and build DSL.
- Infra: document target environment, required access, and deploy/apply workflow.
- Multi-module: include a module map and commonly changed-together modules.
- Monorepo: include a package/app map and per-unit notes for major independently owned areas.
- LLM-app: document model usage, prompt locations, and eval flow.

### 1.2 — `README.md`

**When to apply:** All repo types.

If `README.md` already exists:
- do not delete or replace existing content
- add a short AI Agents section immediately after the first paragraph:

```markdown
## AI Agents

This repository is AI-native. See **[AGENTS.md](AGENTS.md)** for the full agent
guide: build/test commands, architecture, what agents may and must not do, git
workflow, and versioning conventions.
```

If `README.md` does not exist, create one with at minimum:
- project name and one-sentence description
- the AI Agents section above
- prerequisites
- build command
- test command
- link to deeper documentation

If a legacy `readme.txt` exists, do not delete it. Note in `README.md` that `readme.txt` exists
and `README.md` is canonical going forward.

**Files:** `README.md` at repo root.

**Done when:** A new contributor can clone and build within 15 minutes and immediately knows to
read `AGENTS.md` for AI guidance.

### 1.3 — `CONTRIBUTING.md`

**When to apply:** All repo types.

**What to do:** Create `CONTRIBUTING.md` covering:
- coding conventions
- branch and PR workflow
- testing expectations
- how AI agents should work in the repo
- single source of truth for standard commands: `install`, `dev`, `test`, `lint`, `typecheck`, `build`

Any `gh pr create` example must include `--body` or `--fill`.

**Files:** New `CONTRIBUTING.md`.

**Done when:** An AI agent reading only this file knows the style, PR shape, test expectations,
and hard boundaries.

### 1.4 — `.github/CODEOWNERS`

**When to apply:** All GitHub-hosted repos.

**What to do:** Create or update `.github/CODEOWNERS`.

**Before writing:** Ask the user for the exact GitHub team or user handle — do not use a
placeholder. If the information is not readily available, pause and ask:
*"What GitHub team or user should own PRs in this repo? (e.g. @MyOrg/my-team)"*

Minimum content (substitute the real handle):

```text
# Route all PRs to the team for required human review + automatic Copilot code review.
# Only the last matching rule takes effect in CODEOWNERS — keep all owners on one line.
# Copilot review requires GitHub Copilot Enterprise/Business licence.
# Enable in: GitHub repo Settings → Copilot → Pull request reviews
*    @your-org/actual-team-name @Copilot
```

Important:
- do not use two separate `*` lines
- if a `*` entry already exists, merge owners onto one line
- `@Copilot` is for review, not autonomous coding

**Files:** `.github/CODEOWNERS`.

**Done when:** The file exists with at least the team/owner entry. Copilot review entry may be
added now or later.

### 1.5 — `.github/copilot-instructions.md`

**When to apply:** All GitHub-hosted repos.

**What to do:** Create `.github/copilot-instructions.md` as a projection of `AGENTS.md`.
Include the same projection/audit/reminder pattern used for `CLAUDE.md`, plus a minimal
critical-rules summary.

Apply the same minimal-index rule as `CLAUDE.md`: for prompts, agents, and skills include only
a single pointer line to `AGENTS.md` and the relevant exhaustive `README.md` — do not list
individual items or copy their docs into this file.

Do not duplicate the full contents of `AGENTS.md`.

**Files:** New `.github/copilot-instructions.md`.

**Done when:** Copilot suggestions in the IDE align with project style without manual correction.

### 1.6 — `AGENTS.md`

**When to apply:** All repo types.

**Before drafting — mandatory codebase exploration:**

Run these checks and record the findings. `AGENTS.md` must contain real repo facts, not
placeholders.

```bash
git branch -r | grep -E "prod|develop|release|maintenance" | head -20
ls docs/ 2>/dev/null
grep -i "release\|maven-scm\|npm version\|git tag" Jenkinsfile .github/workflows/*.yml 2>/dev/null | head -20
grep -i "sonar\|coverage\|skip\|disable\|comment" Jenkinsfile 2>/dev/null | head -10
cat index.jsx index.js index.ts 2>/dev/null | head -30
ls src/*/components/ src/*/supercomponents/ 2>/dev/null | head -30
cat docs/naming.md docs/webcomponents.md docs/component.md 2>/dev/null | head -80
```

`AGENTS.md` must include:
- library entry point and path aliases when applicable
- branching model
- component naming conventions when present
- release ownership
- disabled CI features that agents must not assume exist
- immutable public API elements
- minimal prompt-library index when `prompts/` exists or will be created (path + one-liner per prompt; exhaustive docs belong in `prompts/README.md`)
- minimal available-agents index when repo-local agents exist or will be created (name + path + one-liner per agent; exhaustive docs belong in `agents/README.md`)
- minimal available-skills index when repo-local skills exist or will be created (name + path + one-liner per skill; exhaustive docs belong in `skills/README.md`)

**What to do:** Create `AGENTS.md` covering:
- repo type and what agents may/may not do
- build and test commands
- library consumption pattern and path aliases when applicable
- branching model
- component naming conventions
- key files to read first
- project-specific rules
- commit format
- minimal prompt library index with pointer to `prompts/README.md` as exhaustive catalog (when present)
- minimal agent catalog index with pointer to `agents/README.md` as exhaustive catalog (when present)
- minimal skill catalog index with pointer to `skills/README.md` as exhaustive catalog (when present)

**Minimal-index rule:** `AGENTS.md` is the SSoT for *where* things live and *when to use* them —
not the full documentation for each surface. Keep prompt, agent, and skill entries short (one line
per item). Put exhaustive per-item documentation — full workflow steps, invocation examples,
constraints, file lists — in `prompts/README.md`, `agents/README.md`, and `skills/README.md`
respectively. This keeps `AGENTS.md` scannable and prevents it from becoming a duplicate of those
catalogs.

Any `gh pr create` example must include `--body` or `--fill`.

If the target repo contains `SKILL.md` files, document frontmatter with:
- Required: `name`, `description`
- Optional: `argument-hint`, `disable-model-invocation`, `tools` / `allowed-tools`

**Done when:** An agent reading only `AGENTS.md` knows what the repo does, what it may change,
what it must not do, and how to commit.

**Conventions — choose inline or split based on repo complexity:**

Before embedding conventions, ask whether `AGENTS.md` would exceed about 400 lines. If the repo
has 3+ languages or multiple owning teams, offer a split pattern under `docs/conventions/`.

Inline option:
- all repos: A.0 General Coding + A.1 Git Workflow
- Java source repos: A.2 Java Code Style + A.3 Java Testing when applicable
- shell repos: A.4 Bash Style

Split option:

```text
docs/conventions/general.md
docs/conventions/git.md
docs/conventions/java-style.md
docs/conventions/java-testing.md
docs/conventions/bash.md
```

Even when split files are used, the following must stay inline in `AGENTS.md`:
- build and test commands
- must-not-do list
- branching model

If split files are used, also update pointer files to link directly to them.

For repo-type-specific guidance, use [repo-type-guidance.md](repo-type-guidance.md).

### 1.7 — `.cursorrules`

**When to apply:** Cursor selected.

**Before drafting `.cursor/rules/` files:** Read [rules-templates.md](rules-templates.md) for
content guidance, Cursor `.mdc` front matter format, and which rule files to create.

**What to do:** Create `.cursorrules` at repo root as a projection of `AGENTS.md`.
Include the projection note, canonical source line, projected-from audit line, sync reminder,
and a minimal quick-reference summary.

Apply the same minimal-index rule as `CLAUDE.md`: for prompts, agents, and skills include only
a single pointer line per surface to `AGENTS.md` and the relevant exhaustive `README.md` — do
not list individual items or copy their docs into this file.

Also ensure `.cursor/rules/` exists and create only the applicable `.mdc` rule files:
- `general-coding.mdc`
- `git-practices.mdc`
- `java-style.mdc`
- `java-testing.mdc`
- `bash-style.mdc`
- `skill-authoring.mdc`

Each `.mdc` file must:
- say it is a projection
- name `AGENTS.md` as canonical source
- include a projected-from audit line
- remind the reader to update `AGENTS.md` first
- stay short and link back to `AGENTS.md`

Do not mirror full convention blocks into `.cursor/rules/*.mdc`.

**Files:** New `.cursorrules`; ensure `.cursor/rules/` exists and create applicable `.mdc` files.

**Done when:** A Cursor agent knows to read `AGENTS.md` and has enough quick guidance to avoid
common mistakes.

### 1.8 — `.editorconfig`

**When to apply:** All repos with text files.

**What to do:** Create `.editorconfig` with the project's actual formatting conventions.

**Files:** New `.editorconfig`.

**Done when:** Running the formatter on any file produces no changes.

### 1.9 — `.gitignore`

**When to apply:** All repo types.

**What to do:** Ensure `.gitignore` covers build output, IDE files, OS files, secrets, and
compiled output. Add ecosystem-specific entries as needed.

If Claude Code was selected, also append:

```text
# Claude Code local settings (personal overrides, not shared)
.claude/settings.local.json
```

Do not add `.cursor/`.

**Files:** `.gitignore` at repo root.

**Done when:** A fresh build does not leave untracked IDE, build, or secret files in `git status`.

### 1.10 — `.env.example`

**When to apply:** Has-env-vars repos only.

**What to do:** Create `.env.example` listing every required environment variable with a safe
placeholder and one-line explanation. Ensure `.env` is ignored.

**Files:** New `.env.example`; update `.gitignore`.

**Done when:** Every env var needed to run the project is listed.

**Skip if:** Config lives only in checked-in files. In that case add a note in `CLAUDE.md`
explaining where configuration lives.

### 1.11 — `.claude/settings.json` + `.claude/rules/`

**When to apply:** Claude Code selected.

**Before drafting rule files:** Read [rules-templates.md](rules-templates.md) for content
guidance, projection header format, and which rule files to create based on repo type.

**What to do:** Create `.claude/settings.json` with permission gates that require approval before
commits, pushes, or branch-changing operations. Also ensure `.claude/rules/` exists and contains
only the applicable Markdown quick-reference files:
- `general-coding.md`
- `git-practices.md`
- `java-style.md`
- `java-testing.md`
- `bash-style.md`
- `skill-authoring.md`

Note: `skill-authoring.md` applies whenever `skills/` exists **or will be created** (e.g. by
`/release` skill in Phase 2). If Phase 1 runs before Phase 2 creates `skills/`, come back and
add this rule file immediately after `skills/` is first written in Phase 2.

Each generated Claude rule file must:
- say it is a projection
- start with "Canonical source: `AGENTS.md`"
- include a projected-from audit line
- remind the reader to update `AGENTS.md` first
- stay short and link back to `AGENTS.md`

Example permission shape:

```json
{
  "permissions": {
    "allow": ["Bash(cp:*)", "Bash(gh auth:*)"],
    "ask": [
      "Bash(git stash:*)",
      "Bash(git checkout:*)",
      "Bash(git add:*)",
      "Bash(git push:*)",
      "Bash(git commit:*)"
    ],
    "deny": ["Bash(rm -rf:*)"]
  }
}
```

**Files:** New `.claude/settings.json`; ensure `.claude/rules/` exists and create applicable
Markdown rule files.

**Done when:** Claude Code pauses before any git write operation or destructive recursive delete.

### 1.12 — `.github/workflows/ci.yml`

**When to apply:** All GitHub-hosted repos.

**What to do:**
1. Use the Phase 0 `.github/workflows` listing as the source of truth.
2. If workflows exist, read them and propose additive fixes only.
3. If no workflows exist, propose a minimal CI workflow appropriate for the repo type and ask for
   explicit confirmation before writing.

Do not write anything under `.github/workflows/` without stating the exact path, what the
workflow does, and asking for explicit approval.

Minimal Java/Maven CI:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main, master, trunk]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
          cache: maven
      - name: Build and test
        run: mvn --batch-mode verify
```

Minimal Node CI:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main, master, trunk]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - run: npm test
```

**Files:** New `.github/workflows/ci.yml` or additive edits to existing workflows.

**Done when:** PRs trigger automated build and test checks.

---

### 1.13 — `.codex/` and `.agents/` (Codex and generic AI tools)

**When to apply:** OpenAI Codex, Gemini, Windsurf, or any generic agent tool selected.

**What to do:** Create the tool-local discovery directories so Codex and other tools can
find repo-local agents (and skills, when present).

- **`.codex/`** — Codex project-local directory.
  - Ensure `.codex/` exists. When neither `agents/` nor `skills/` exists yet, the empty
    directory acts as a discovery hook for future additions.
  - If `agents/` exists in the repo: create `.codex/agents` as a symlink → `../agents`
    (skip if the symlink already exists — use `ln -sfn` or check first)
  - If `skills/` exists in the repo: create `.codex/skills` as a symlink → `../skills`
    (skip if the symlink already exists)

- **`.agents/`** — generic agent tool discovery directory.
  - Ensure `.agents/` exists.
  - If `agents/` exists: create `.agents/agents` as a symlink → `../agents`
    (skip if the symlink already exists)
  - If `skills/` exists: create `.agents/skills` as a symlink → `../skills`
    (skip if the symlink already exists)

> **Note:** When Phase 2 §2.12 adds repo-local agents, the Agent Registration Rule
> (step 15) also creates or repairs `.codex/agents` and `.agents/agents`. There is no
> conflict — §1.13 creates the directories and initial symlinks in Phase 1; step 15
> repairs them in Phase 2 after agents have been committed.

**Files:** `.codex/` (with `agents` and/or `skills` symlinks when applicable);
`.agents/` (with `agents` and/or `skills` symlinks when applicable).

**Done when:** `ls -la .codex/ .agents/` shows the directories and any symlinks point
to the correct relative targets (`../agents`, `../skills`).

## Phase 1 Exit Gate

Do not offer or start Phase 2 until every applicable Phase 1 item is in one of these states:
- completed and written
- explicitly skipped with a recorded reason
- not applicable because of repo type or tool selection
- already adequate and recorded as such
- explicitly declined by the user

Phase 1 is **not** complete if any of the following is still true:
- a Phase 1 file draft is still awaiting approval
- an in-scope Phase 1 file has no final status
- the skipped-files report has not been shown
- there is unresolved uncertainty about whether a Phase 1 file should exist

If any Phase 1 work is still pending, finish Phase 1 first and do not move to Phase 2.
After the Phase 1 Exit Gate passes, hand control back to `SKILL.md` / `PLAN.md`, stop using this
file as the active phase document, and only then load `phase-2.md`.

## Phase 1 Completion: Skipped-Files Report

After completing all applicable Phase 1 steps, output a table of every conditional file that was
not created, with the exact reason. Never silently skip a file.

| File | Condition to create | Reason skipped |
|------|--------------------|----------------|
| `CLAUDE.md` | Claude Code selected | _(fill in)_ |
| `.claude/rules/*.md` | Claude Code selected; create only the convention files applicable to this repo | _(fill in)_ |
| `.github/copilot-instructions.md` | GitHub Copilot (IDE) selected | _(fill in)_ |
| `.cursorrules` | Cursor selected | _(fill in)_ |
| `.cursor/rules/*.mdc` | Cursor selected; create only the convention files applicable to this repo | _(fill in)_ |
| additional `.cursor/rules/*.mdc` | Cursor-only scoped rules are needed beyond `.cursorrules` and the shared Cursor rule files | _(fill in)_ |
| `.env.example` | Has-env-vars repos only | _(fill in)_ |
| `.github/workflows/ci.yml` | GitHub repos — explicit user confirmation required | _(fill in)_ |
| `.codex/` + `.agents/` | Codex / Gemini / Windsurf or generic AI tool selected | _(fill in)_ |

This report must be shown even when the reason is obvious. It gives the user a clear picture of
what was done and what was intentionally deferred.
