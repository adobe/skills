# Agentify Skill Templates

Use this reference when `references/phase-2.md` §2.12 (repo-local skills) is in scope, or when
any agentify phase creates a skill inside the target repo. The `/release` skill has its own
dedicated template in `references/release-skill-template.md` — use that instead for release skills.

## Goal

Create a small set of repo-local skills, implemented under the target repo's `skills/` folder,
that encode the target repo's most common, repeatable workflows. These skills must be
**repo-aware**: they should use the real workflow names, docs, commands, directories, and guardrails
discovered earlier in the agentify flow.

## Rules

- Do not generate generic "assistant wrappers." If the same skill could be dropped into any repo
  with only a noun swap, it is too generic.
- Start from the target repo's real recurring workflows:
  - Phase 0/1 findings
  - existing runbooks
  - `wiki/code-flows.md` and matching `wiki/code-flow-*.md` pages
  - release, test, debug, migration, or module-boundary workflows already documented in the repo
- Keep the set small. Create 1-3 high-value skills by default, not a large catalog of thin
  wrappers. `agentify` already creates the `/release` skill via `release-skill-template.md` when
  applicable — count that in the set.
- One skill encodes one workflow. Do not create catch-all "do everything" skills.
- Prefer the repo's own vocabulary in skill names. If the repo calls a flow "backport,"
  "content sync," or "promote package," use that terminology.
- Keep `SKILL.md` under 500 lines. Move bulky detail into `references/` files.
- Each skill must point back to `AGENTS.md` and deeper docs instead of copying full repo
  guidance inline.
- No hardcoded repo paths, ticket IDs, or usernames in skill content — skills must remain
  generic and reusable if extracted.

## Good Starting Flows

Use these only when they are genuinely common and can be made repo-specific:

- cut a release (→ use `release-skill-template.md` for this one)
- debug a failing build, test, or CI pipeline step
- backport a fix to a maintenance branch
- prepare a migration change
- validate or deploy a package
- work within a specific module boundary

## Required Repo Facts

Every generated skill should include only the facts relevant to its workflow:

- repo name and one-line purpose
- primary languages/frameworks and build system
- canonical docs to read first
- exact commands to run for validation
- important directories, modules, or entry points for that workflow
- repo-specific guardrails, immutable contracts, or release constraints

## Recommended File Pattern

```text
skills/
  <workflow-name>/
    SKILL.md
    references/         ← optional; detailed docs linked from SKILL.md
    scripts/            ← optional; helper scripts
```

## SKILL.md Template

```markdown
---
name: <workflow-name>
description: >
  <one or two sentences describing the repo-specific workflow and when to use it.
  Include trigger phrases so Claude Code auto-invokes it correctly.>
tools: Bash, Read, Edit, Write, Glob, Grep
---

# <Skill name>

<One-line purpose statement.>

## When To Use

<Two to four bullet points describing concrete trigger conditions.>

## Before You Start

- Read `AGENTS.md`
- Read `<1-2 repo-specific docs or runbook sections>`
- Use `<repo validation command>` to verify your environment when relevant

## Repo Context

- Purpose: <one line>
- Important paths: `<path>`, `<path>`
- Constraints: <repo-specific guardrails and immutable contracts>

## Workflow

1. <Repo-specific step using real commands and paths>
2. <Repo-specific step>
3. <Repo-specific verification and output format>
```

The workflow section should:
- mention real repo paths and commands
- encode expected outputs (plan, findings, patch, release checklist, RCA, etc.)
- call out the repo-specific validation step to run before completion
- stay focused on the single workflow

## `references/` Files

When a skill needs reference material — patterns, checklists, command references — put them under
`skills/<name>/references/` and link them explicitly from `SKILL.md`:

```markdown
## Supporting Files

| File | Purpose | Load when |
|------|---------|-----------|
| [references/patterns.md](references/patterns.md) | ... | When ... |
```

Do not inline bulky reference content in `SKILL.md` — that is what pushes it past 500 lines.

## `openai.yaml` (Optional)

When Codex is one of the selected tools, add `openai.yaml` with minimal metadata:

```yaml
interface:
  display_name: "<Human-readable skill name>"
  short_description: "<One sentence using the repo's own vocabulary>"
  default_prompt: "Use /<skill-name> to <one-line task description>"
policy:
  allow_implicit_invocation: false
```

Do not put workflow logic in `openai.yaml`.

## Skill Registration Rule

**Applies whenever any skill is created inside a target repo** (currently: the `/release` skill in
`2.6`, but applies to any future skill agentify creates).

After writing the canonical files under `skills/`, always register the skills in the exact order
below. This registration pass must cover the full current skill set in scope for the repo section
you are updating, not just the skills created in the current change.

**Required order:**
1. Update the canonical skill files under `skills/`.
2. Create or update `skills/README.md` with exhaustive per-skill documentation. For each skill
   include: purpose, trigger phrases, argument usage, workflow steps, supporting files, and
   constraints. `skills/README.md` is the exhaustive catalog — one well-documented section per
   skill, covering all skills present in the repo, not just the ones changed in this run.
3. Create or update `docs/skills.md` so it covers the full current skill surface in scope,
   including both pre-existing skills and skills created or updated in the current run.
4. Update `AGENTS.md` with the **minimal** entry for all skills currently present in scope.
   Document for each one only:
   - name
   - canonical path under `skills/`
   - when to use it
   - how to use or invoke it
   - one-line purpose and guardrails
   Do not copy the exhaustive documentation from `skills/README.md` into `AGENTS.md`.
   `AGENTS.md` is the minimal index; `skills/README.md` is the exhaustive catalog.
5. Update `README.md` with a brief human-facing note and point back to `AGENTS.md`.
6. If `docs/runbooks.md` and/or `wiki/architecture.md` already exist, or were explicitly
   approved in Phase 2, update them so they reflect the current skill set and canonical `skills/`
   location. Otherwise leave them untouched.
7. Refresh the projection files (`CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`)
   so they point back to `AGENTS.md#available-skills` and `skills/README.md`.
8. Create or repair the tool-local `skills/` mirrors:

   ```text
   .claude/skills  -> ../skills
   .codex/skills   -> ../skills
   .agents/skills  -> ../skills
   .cursor/skills  -> ../skills
   .github/skills  -> ../skills
   ```

   Use `ln -sfn ../skills <LINK>` (note `-n`) so that re-running is safe even if the symlink
   already exists — `-n` treats an existing symlink-to-directory as a file and replaces it
   rather than creating a nested `skills/skills` entry inside the target.

`AGENTS.md` is the minimal index. `skills/README.md` is the exhaustive catalog.

## Alignment Notes

- If the repo already has an equivalent skill, update it instead of creating a duplicate.
- If a matching prompt under `prompts/repo/` exists for the same workflow, keep the naming,
  cited docs, and terminology aligned between the prompt and the skill.
