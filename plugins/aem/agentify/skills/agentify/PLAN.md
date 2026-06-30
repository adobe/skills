# AI-Native Repository Conversion Plan

A generic, phased, technology-agnostic plan for converting any existing repository into one that LLMs can reason about effectively.

---

## How to Use This Plan

1. **Run Phase 0** — assess the repo's current state and classify its type.
2. **For each step in Phases 1–4**, read the "When to apply" criterion to decide if it is relevant.
3. **Re-assess quarterly** using Phase 0 to track progress.

### Non-Negotiable Rules

See **`SKILL.md` § GLOBAL RULES** — those rules govern all execution and are the single authoritative source. This plan does not repeat them.

---

## Setup and Bootstrap

**Goal:** Make the skill available in the current session and resolve the supporting files before any repo work begins.

### Installation Options

This skill lives in: `https://github.com/adobe/skills` (plugin path: `plugins/aem/agentify/skills/agentify/`)

Choose one:

**Option 1 — Plugin marketplace** (recommended):
```bash
/plugin marketplace add adobe/skills
/plugin install aem-agentify@adobe-skills
```
When installed this way, `SKILL_DIR=${CLAUDE_SKILL_DIR}` — skip the Resolve SKILL_DIR step below.

**Option 2 — Global symlink** (for development or direct use):
```bash
ln -s ~/path/to/skills/plugins/aem/agentify/skills/agentify \
      ~/.agents/skills/agentify
```

Use the tool-native global path for the tool the user selected in Step 0.g:
- Codex → `~/.agents/skills/agentify`
- Claude Code → `~/.claude/skills/agentify`
- Cursor → `~/.cursor/skills/agentify`

**Option 3 — Run from skills repo** (recommended for remote repos):
```bash
cd ~/path/to/skills
```
Then launch the selected tool from that directory.

**Option 4 — Add as extra context dir**:
```bash
<selected-tool-command> --add-dir ~/path/to/skills/plugins/aem/agentify
```
Use the actual command for the selected tool. If the selected tool does not support `--add-dir` or an equivalent feature, skip this option.

### Resolve `SKILL_DIR`

**Plugin marketplace install:** `SKILL_DIR=${CLAUDE_SKILL_DIR}` — already resolved. Skip below.

**Manual install:** find the skill folder:

```bash
# Option 2: globally installed for Codex
ls ~/.agents/skills/agentify/PLAN.md 2>/dev/null \
  && echo "SKILL_DIR=~/.agents/skills/agentify" || true

# Option 2: globally installed for Claude Code
ls ~/.claude/skills/agentify/PLAN.md 2>/dev/null \
  && echo "SKILL_DIR=~/.claude/skills/agentify" || true

# Option 2: globally installed for Cursor
ls ~/.cursor/skills/agentify/PLAN.md 2>/dev/null \
  && echo "SKILL_DIR=~/.cursor/skills/agentify" || true

# Option 3/4: project-local (cwd is the skills repo)
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" && \
  ls "$repo_root/plugins/aem/agentify/skills/agentify/PLAN.md" 2>/dev/null && \
  echo "SKILL_DIR=$repo_root/plugins/aem/agentify/skills/agentify" || true
```

Record `SKILL_DIR`. If unresolved, tell the user to install via one of the options above and stop.

---

## Step 0 Execution

**Goal:** Resolve runtime context for this invocation before Phase 0 assessment begins.

### 0.a — Detect Execution Mode

```bash
git rev-parse --show-toplevel 2>/dev/null && echo "IN_REPO" || echo "NOT_IN_REPO"
```

| Mode | Condition | Action |
|------|-----------|--------|
| **Local** | Already inside a git repo AND no URL provided | Work in current directory |
| **Remote** | URL provided OR not inside a git repo | Clone first (see 0.b) |

### 0.b — Remote Mode: Clone the Repo

1. Ask user where to clone (`~/ai-native/<repo-name>` or custom path).
2. Before cloning, check the target path:
   ```bash
   ls -la <CLONE_PATH> 2>/dev/null && echo "EXISTS" || echo "EMPTY"
   ```
3. If the path exists, ask whether to reuse it, pick a new path, or replace it.
4. Record `ORIGINAL_DIR=$(pwd)` before cloning.
5. Clone and enter the repo:
   ```bash
   git clone <URL> <CLONE_PATH>
   cd <CLONE_PATH>
   ```
6. Record `IS_REMOTE_CLONE=true`.

### 0.c — Resolve Working Directory Strategy (Remote Mode Only)

Because the skill is running outside the target repo, every Bash command would otherwise need a `cd <CLONE_PATH>` prefix. Offer the user three options after Step 0.g has identified which tools are being configured:

> **This skill is running outside the target repo. Choose how to handle the working directory:**
>
> - **A) Global symlink** — Create the tool-native global symlink for the selected tool (`~/.agents/skills/agentify`, `~/.claude/skills/agentify`, or `~/.cursor/skills/agentify`) so the user can open a fresh session in the target repo and the skill will be available there.
> - **B) Tool-native discovery** — Open a new session from the target repo and use the selected tool's normal project or marketplace discovery flow, if it has one.
> - **C) Continue as-is** — Prefix every subsequent Bash command with `cd <CLONE_PATH> &&`.

**For option A:** create the symlink that matches the selected tool:
```bash
# Codex
ln -s <SKILL_DIR> ~/.agents/skills/agentify

# Claude Code
ln -s <SKILL_DIR> ~/.claude/skills/agentify

# Cursor
ln -s <SKILL_DIR> ~/.cursor/skills/agentify
```
Then tell the user to open a new terminal from `<CLONE_PATH>` and start a fresh session in the selected tool there. Stop here; the work continues in that new session.

**For option B:** tell the user to open a new terminal, `cd <CLONE_PATH>`, then launch the selected tool and use its normal discovery path (for example, marketplace or project-local skill discovery). Stop here; the work continues in that new session.

**For option C:** record `WD_STRATEGY=prefix` and continue. All later Bash commands in this skill must be prefixed with `cd <CLONE_PATH> &&`.

### 0.d — Resolve Work Item / Branch Identifier

```bash
git branch --show-current
git remote get-url origin
```

- If the user already provided a work item or branch identifier and the current branch matches, confirm and proceed.
- If the user provided one but the current branch does not match, ask whether to:
  - check out or create a branch from that identifier, or
  - stay on the current branch and use the identifier only for commit/PR naming.
- If the user did not provide one:
  - on `main`/`trunk`/`master`, ask for a short work item or branch identifier;
  - otherwise propose the current branch name and wait for confirmation.

Accept JIRA-style identifiers (`PROJ-12345`), GitHub-style issue keys (`GH-123`), team-specific identifiers, or a plain branch slug.

Record the confirmed value as `WORK_ID`. Do not continue until `WORK_ID` is confirmed.

### 0.e — Confirm Base Branches and Branch Naming

Run both commands to surface all candidate base branches — repos may use non-standard names
like `1.6`, `1.60`, `release/2.x`, `develop`, or `v3`:

```bash
# 1. All remote branches — shows everything including version-style names
git branch -r | sed 's|origin/||' | sort

# 2. If the current branch already exists locally, check what remote it tracks
#    — this is the authoritative source when the branch was pre-created for you
git remote show origin | grep "merges with remote"
```

Do NOT rely solely on the system-provided "main branch" label — it reflects the GitHub
default branch, which may differ from the correct PR target for the current work.

Ask which branch is the base. Also ask whether the same changes should apply to multiple base branches.

If the answer is **yes**, create one derived branch per base branch using:
- Single base branch: `BRANCH_NAME="$WORK_ID"`
- Multiple base branches: `BRANCH_NAME="$WORK_ID-$BASE_BRANCH"` (example: `WORK-1234-main`)

Run the branch/PR flow separately for each entry in `BASE_BRANCHES`.

Record `BASE_BRANCHES`, whether `MULTI_BASE=yes` or `MULTI_BASE=no`, and the derived `BRANCH_NAME` rule.

### 0.f — Branch Checkout Rules

For the current base branch:

```bash
# Resolve branch name for this base branch
if [ "$MULTI_BASE" = "yes" ]; then
  BRANCH_NAME="$WORK_ID-$BASE_BRANCH"
else
  BRANCH_NAME="$WORK_ID"
fi

if git branch --list "$BRANCH_NAME" | grep -q .; then
  # EXISTS locally — checkout + rebase
  git diff --quiet && git diff --cached --quiet || { git stash; STASHED=1; }
  git checkout "$BRANCH_NAME"
  git remote | grep -q "^upstream$" && remote="upstream" || remote="origin"
  git fetch "$remote" && git rebase "$remote/$BASE_BRANCH"
  [ "${STASHED:-}" = "1" ] && git stash pop
else
  # Does NOT exist locally — create from base
  git diff --quiet && git diff --cached --quiet || { git stash; STASHED=1; }
  git remote | grep -q "^upstream$" && remote="upstream" || remote="origin"
  git fetch "$remote"
  git checkout -b "$BRANCH_NAME" "${remote}/$BASE_BRANCH"
  [ "${STASHED:-}" = "1" ] && git stash pop
fi
```

### 0.g — Select AI Tools to Support

Ask which tools to configure (default all selected):

- **Claude Code** → `CLAUDE.md`, `.claude/settings.json`, `.claude/rules/*.md`
- **GitHub Copilot (IDE)** → `.github/copilot-instructions.md`
- **Cursor** → `.cursorrules`, `.cursor/rules/*.mdc`
- **OpenAI Codex / Gemini / Windsurf** → `AGENTS.md`

`AGENTS.md` and `.github/CODEOWNERS` are always created regardless of selection. Create
`.cursorrules` when Cursor is selected.

This Step 0.g list is only the tool-selection summary. The per-section Phase 1 steps below remain
the source of truth for exactly what gets created for each selected tool.

Record tool selection for the Phase 1 gates.

---

## Repo Type Reference

The "When to apply" sections use these labels. A repo may match more than one.

| Label | What it means |
|-------|---------------|
| **Source** | Has `src/` with compilable application code (Java, Python, Go, JS/TS, etc.) |
| **Packaging** | Build file exists but no meaningful source — assembles/bundles external dependencies |
| **Infra** | Contains Dockerfiles, Terraform, Helm, Ansible, shell scripts, k8s manifests |
| **Multi-module** | One logical project with a root build and many submodules (for example Maven/Gradle reactor builds such as `apache/jackrabbit-oak`) |
| **Monorepo** | Multiple relatively independent applications/libraries/tools in one repo, often with separate build/test/deploy flows |
| **Docs** | Contains only documentation, wikis, or specs — no runnable code |
| **LLM-app** | Imports `openai`, `anthropic`, `langchain`, etc.; stores prompts; runs model evaluations |
| **Service** | Exposes a network API (REST, gRPC, GraphQL, message queue) consumed by other systems |
| **Has-tests** | At least one test file exists in the repo |
| **Has-env-vars** | Requires environment variables to build, run, or test |
| **Multi-agent** | Team uses more than one AI coding tool (Claude Code + Copilot, Cursor + Devin, etc.) |

---

## Phase 0: Assessment (Always Run First)

**Goal:** Understand the repo's current state and type before taking any action.

### 0.1 — Classify the Repo

**What to do:** Apply the Repo Type Reference labels above. A repo may have multiple labels (e.g., a Java microservice is both **Source** and **Service**; an AEM content package repo is **Packaging**; `apache/jackrabbit-oak` is **Source**, **Multi-module**, **Has-tests**, and partially **Service**).

Run these checks:
```bash
# Detect build system
ls pom.xml build.gradle build.gradle.kts package.json go.mod Makefile setup.py pyproject.toml 2>/dev/null

# Count source files
find . \( -name "*.java" -o -name "*.py" -o -name "*.ts" -o -name "*.go" -o -name "*.js" \) \
  -not -path "*/target/*" -not -path "*/node_modules/*" | wc -l

# Check for multi-module root
grep -l "<modules>" pom.xml settings.gradle settings.gradle.kts 2>/dev/null || true
grep -R "include(" settings.gradle settings.gradle.kts 2>/dev/null || true

# Check for infra markers
ls Dockerfile docker-compose.yml terraform/ helm/ ansible/ k8s/ *.tf 2>/dev/null || true

# Check for LLM usage
grep -r "openai\|anthropic\|langchain\|ollama" \
  --include="*.py" --include="*.ts" --include="*.js" -l 2>/dev/null | head -5 || true

# Check for tests
find . \( -name "*Test*" -o -name "*Spec*" -o -name "test_*.py" \) \
  -not -path "*/target/*" -not -path "*/node_modules/*" | wc -l

# Check for env var usage
grep -r "process\.env\|os\.environ\|System\.getenv\|dotenv" \
  --include="*.py" --include="*.ts" --include="*.js" --include="*.java" -l 2>/dev/null | head -5 || true

# Check what AI-native files already exist
ls AGENTS.md CLAUDE.md CONTRIBUTING.md README.md CHANGELOG.md .editorconfig .env.example 2>/dev/null || true
ls .github/CODEOWNERS .github/copilot-instructions.md .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null || true
if [ -d .github/workflows ]; then
  echo "WORKFLOWS_DIR_PRESENT"
  if ! ls .github/workflows; then
    echo "WORKFLOWS_LISTING_FAILED"
  fi
else
  echo "WORKFLOWS_DIR_ABSENT"
fi
ls .claude/settings.json .claude/rules .cursor/rules .cursorrules 2>/dev/null || true
ls wiki/architecture.md wiki/code-flows.md docs/runbooks.md docs/release-process.md docs/testing.md 2>/dev/null || true
find wiki -maxdepth 1 -name 'code-flow-*.md' 2>/dev/null | sort || true
ls docs/decisions/ 2>/dev/null || true
```

**Output:** A list of applicable repo type labels. Keep this list — each step in Phases 1–4 uses it to tell you whether to apply that step.

**Label assignment rules:**

| Label | Assign when |
|-------|-------------|
| **Source** | ≥1 source file found (.java, .py, .ts, .go, .js) |
| **Packaging** | Build file exists but 0 source files — assembles/bundles dependencies |
| **Infra** | Dockerfile, *.tf, helm/, ansible/, or k8s/ found |
| **Multi-module** | Root pom.xml with `<modules>` or settings.gradle with `include(` |
| **Monorepo** | Multiple top-level app/service directories each with own build file |
| **LLM-app** | openai/anthropic/langchain import found |
| **Has-tests** | ≥1 test file found |
| **Has-env-vars** | env var usage found in source |

> **Monorepo vs Multi-module:** Do NOT label as Monorepo just because many Maven modules exist.
> One root build + one release train = Multi-module. Monorepo = multiple semi-independent
> products with separate lifecycle boundaries.

**Classification rule for large Java repos:** Do not label a repo **Monorepo** just because it has many Maven or Gradle modules. If there is one root build, one release train, and shared versioning/dependency management, classify it as **Multi-module** first. Use **Monorepo** only when the repo contains multiple semi-independent products or services with separate lifecycle boundaries.

### 0.2 — Repository Structure Inventory

**What to do:** Document in one page: directory layout, build system, test framework, CI/CD pipeline, deployment model.

**Assessment criterion:** Can a new team member answer: (a) what does this repo build, (b) how to build it, (c) how to test it, (d) how to deploy it — without asking anyone?

### 0.3 — Naming and Convention Audit

**What to do:** Sample 10–15 files. Are names self-descriptive? Are abbreviations explained? Are conventions consistent?

**Assessment criterion:** >70% of sampled files pass: public function names are understandable without reading the body. If not, Phase 3 naming work is needed.

### 0.4 — Test Coverage Audit

**What to do:** Run coverage tooling. Record line/branch % per module. List modules with zero tests.

**Assessment criterion:** Modules with <50% line coverage are "AI-opaque." Zero-test modules are the highest priority gap.

### 0.5 — Implicit Knowledge Audit

**What to do:** List every piece of knowledge required to build, test, or deploy that is NOT in the repo (Slack messages, tribal knowledge, undocumented env vars, manual steps).

**Assessment criterion:** Can the project be built from a clean checkout with one documented command? Each undocumented step is a gap.

---

## Phase 1: Zero-Effort, High-ROI Wins

Canonical instructions: [references/phase-1.md](references/phase-1.md) — covers the SSoT pattern, sections `1.1`–`1.13`, skipped-files report, and exit gate. Keep it as the only active phase document until the exit gate passes.

---

## Phase 2: Contract Clarity

Canonical instructions: [references/phase-2.md](references/phase-2.md) — covers registration rules, offer workflow, and sections `2.1`–`2.15`. Start only after Phase 1 exit gate passes; keep it as the only active phase document.

---

## Pre-PR Verification Gate

Before staging, committing, or creating a PR, run this gate every time without exception.

**Step 1 — Show the diff:**
```bash
git status
git diff HEAD
git ls-files --others --exclude-standard
git ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do
  git diff --no-index -- /dev/null "$f" || true
done
```
Show the full output to the user.

**Step 2 — List every file created or modified** with a one-line summary of what was added.
Include untracked files shown by the commands above.

**Step 3 — Say the following word for word:**

> ---
> **Please review the changes listed above before I create the PR.**
>
> These files were created or modified by an AI. AI can make mistakes — content may
> be inaccurate, incomplete, or not reflect how this repo actually works. You know
> this codebase better than I do.
>
> **What to check:**
> - Are the build commands, versions, and branch names correct?
> - Does the branching model and versioning strategy match reality?
> - Is anything described that doesn't exist yet, or missing that does?
> - Are the "What Agents Must Not Do" rules complete and accurate?
> - Is any sensitive or internal information included that should not be public?
>
> You can edit any file directly, or tell me what to change and I will update it.
> Once you are satisfied, say **"proceed"** and I will create the PR.
> ---

**Step 4 — Wait.** Do not create a PR, do not stage any files, do not proceed until the
user explicitly says to.

**Step 5 — Re-verify on amendments.** If the user changes any file, re-run the full
verification commands above, show the updated output, and ask for confirmation again.

**Step 6 — Create the PR** only after explicit user go-ahead, for the exact set of files reviewed.

---

## Completion Report

After the user confirms and the PR is created, output this structured report:

```
## AI-Native Conversion Complete

### Repo Type
[Labels from Phase 0]

### Files Created
[List each file created in this session]

### Files Updated
[List each file updated in this session]

### Files Skipped (already existed)
[List files that were already adequate]

### Deferred (boy-scout rule)
[Phase 3 steps to apply when naturally touching those files]

### Quick Win Still Available
[Any Phase 1/4 quick wins not yet done — e.g. PR template §4.3 if skipped]

### Recommended Next Action
[Single most impactful next step for this repo]
```

---

## Post-PR Cleanup (Remote Mode Only)

Run this section only when `IS_REMOTE_CLONE=true`.

### 6.1 — Return to original directory

```bash
cd "$ORIGINAL_DIR"
```

### 6.2 — Wait for PR merge

Show the PR URL and say:

> "The PR is open at: `<PR_URL>`
> Please review it, make any final changes, and merge it when ready.
> Let me know once it is merged."

Wait. Do not proceed until the user confirms the PR is merged.

### 6.3 — Ask about clone deletion

Once merged, ask:

> "The local clone is at `<CLONE_PATH>`. The generated `.claude/settings.json` denies `rm -rf`,
> so if you want to remove this clone, please delete it manually."

---

## Phase 3: Structural Improvements

Canonical instructions: [references/phase-3.md](references/phase-3.md) — covers triage guidance and sections `3.1`–`3.6`. Start only after Phase 2 is complete.

---

## Phase 4: Automation and Ongoing Hygiene

Canonical instructions: [references/phase-4.md](references/phase-4.md) — covers triage guidance and sections `4.1`–`4.8`. Start only after Phase 3 triage is complete.

---
