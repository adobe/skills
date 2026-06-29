# Agentify Repo Agent Templates

Use this reference when `references/phase-2.md` §2.12 (repo-aware helper agents) is in scope.

## Goal

Create a small set of repo-local helper agents, implemented under the target repo's root
`agents/` folder, that automate the target repo's most common code flows. These agents
must be **repo-aware**: they should use the real workflow names, docs, commands,
directories, and guardrails discovered earlier in the agentify flow.

## Rules

- Do not generate generic "assistant wrappers." If the same agent could be dropped into any
  repo with only a noun swap, it is too generic.
- Start from the target repo's real recurring workflows:
  - Phase 0/1 findings
  - existing runbooks
  - `wiki/code-flows.md`
  - matching `wiki/code-flow-*.md` pages
  - release, test, debug, or module-boundary workflows already documented in the repo
- Keep the set small. Create 3-5 high-value helper agents by default, not a large catalog of thin
  wrappers. This is guidance, not a hard limit — create more when the repo has enough distinct,
  commonly used workflows to justify it.
- One helper agent should automate one workflow. Do not create catch-all "do everything"
  agents.
- Prefer the repo's own vocabulary in agent names. If the repo calls a workflow "backport,"
  "content sync," or "promote package," use that terminology instead of a generic label.
- Each helper agent must point back to `AGENTS.md` and deeper docs instead of copying full
  repo guidance into the agent body.

## Good Starting Flows

Use these only when they are genuinely common and can be made repo-specific:

- explain the repo
- plan a change
- review a change (use `/review-governor`)
- debug a failing build, test, or runtime issue
- work in a specific module or package boundary
- prepare a release-oriented change

Prefer more specific workflow agents when the repo already has named flows that future agents
will repeatedly need, for example:

- trace a request through the runtime path
- update a package or content deployment flow
- prepare a migration change
- diagnose CI failures for this repo's pipeline
- follow a release or backport workflow
- maintain the skill catalog (`skill-maintainer`) — create this whenever the repo has a
  `skills/` directory; it automates adding/updating skills and keeping all catalog files
  (`skills/README.md`, `docs/skills.md`, `AGENTS.md#available-skills`) in sync

## AI Code Review

When §2.12 is in scope, offer AI-powered code review as an optional addition for repos where
code review is a recurring, high-value workflow. Use the `/review-governor` skill.

## Required Repo Facts

Every generated helper agent should include only the facts relevant to its workflow:

- repo name and one-line purpose
- primary languages/frameworks and build system
- canonical docs to read first
- exact commands to run for validation
- important directories, modules, or entry points for that workflow
- repo-specific guardrails, immutable contracts, or release constraints
- expected output format for the workflow

## Recommended File Pattern

Implement each helper agent under the canonical root-level `agents/` folder:

```text
agents/
  <flow-name>/
    AGENT.md
    openai.yaml
```

Keep `AGENT.md` focused on the workflow contract and use `openai.yaml` only for lightweight
Codex metadata when Codex is one of the selected tools.

## Agent Template Guidance

Each generated helper agent should roughly follow this shape:

```markdown
---
name: <flow-name>
description: <one sentence describing the repo-specific workflow and when to use it>
tools: Bash, Read, Edit, Write, Glob, Grep
---

# <Agent name>

Use this when: <one sentence>

Before you start:
- Read `AGENTS.md`
- Read <1-2 repo-specific docs or workflow pages>
- Use `<repo validation command>` when relevant

Repo context:
- Purpose: <one line>
- Important paths: `<path>`, `<path>`
- Constraints: <repo-specific guardrails>

Workflow:
1. <repo-specific step>
2. <repo-specific step>
3. <repo-specific verification and output>
```

The workflow section should:

- mention real repo paths and commands
- encode expected outputs (plan, findings, patch, release checklist, RCA, etc.)
- call out the repo-specific validation step to run before completion
- stay focused on the single flow

## Codex Metadata

When Codex is selected, add `openai.yaml` with minimal UI metadata derived from the
repo-aware agent:

```yaml
interface:
  display_name: "Plan Change"
  short_description: "Plan a change using this repository's actual modules and checks"
  default_prompt: "Use $plan-a-change to plan a repo-specific change"
policy:
  allow_implicit_invocation: false
```

Do not put workflow logic in `openai.yaml`.

## Tool-Local Mirrors

The root `agents/` folder is canonical. Create tool-local mirrors that point back to it:

```text
.claude/agents  -> ../agents
.codex/agents   -> ../agents
.agents/agents  -> ../agents
.cursor/agents  -> ../agents
.github/agents  -> ../agents
```

If the repo also has a root-level `skills/` directory, create the corresponding skill mirrors
in the same pass:

```text
.claude/skills  -> ../skills
.codex/skills   -> ../skills
.agents/skills  -> ../skills
.cursor/skills  -> ../skills
.github/skills  -> ../skills
```

**Symlink safety:** Before running `ln -sf TARGET LINK`, check whether `LINK` already exists
as a symlink. If it does, `ln -sf` will create the new symlink *inside* the existing target
directory rather than replacing it, producing a broken circular link (e.g. `skills/skills`).
Use `ln -sfn TARGET LINK` (the `-n` flag treats an existing symlink-to-directory as a file and
replaces it safely) or remove the stale symlink first with `rm LINK`.

Do not duplicate or copy agent or skill definitions into these tool-local folders.

## Agent Registration Rule

**Applies whenever any repo-local helper agent is created inside a target repo.**

After writing the canonical files under `agents/`, always register the agents in the exact order
below.

**Required order:**
1. Update the canonical agent files under `agents/`.
2. Create or update `agents/README.md` with exhaustive per-agent documentation. For each agent
   include: purpose, files list, phases or workflow steps, invocation examples, expectations, and
   guardrails. `agents/README.md` is the exhaustive catalog — one well-documented section per
   agent covering all agents present in the repo, not just the ones changed in this run.
3. Create or update `docs/agents.md` so it covers the full current agent surface in scope,
   including both pre-existing agents and agents created or updated in the current run.
4. Update `AGENTS.md` with the **minimal** entry for all agents currently present in the repo.
   Document for each one only:
   - name
   - canonical path under `agents/`
   - when to use it
   - how to use or invoke it
   - one-line purpose and guardrails
   Do not copy the exhaustive documentation from `agents/README.md` into `AGENTS.md`.
   `AGENTS.md` is the minimal index; `agents/README.md` is the exhaustive catalog.
5. Update `README.md` with a brief human-facing note and point back to `AGENTS.md`.
6. If `docs/runbooks.md` and/or `wiki/architecture.md` already exist, or were explicitly
   approved in Phase 2, update them so they reflect the current agent catalog and canonical
   `agents/` location. Otherwise leave them untouched.
7. Refresh the projection files so they point back to `AGENTS.md#available-agents`.
8. Create or repair the tool-local `agents/` mirrors.

`AGENTS.md` remains the minimal index. `agents/README.md` is the exhaustive catalog.

## Alignment Notes

- If there is a matching prompt under `prompts/repo/`, keep the naming, cited docs, and
  workflow terminology aligned between the prompt and the helper agent.
- If the repo already has an equivalent helper agent, update it instead of creating a duplicate.
