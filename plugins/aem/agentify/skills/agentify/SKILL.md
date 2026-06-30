---
name: agentify
description: >
  Transforms an existing repository into one that AI agents can navigate and
  contribute to independently — without hand-holding. Creates AGENTS.md (the
  agent's SSoT), CLAUDE.md, .cursorrules, CONTRIBUTING.md, architecture docs,
  runbooks, decision records, repo-aware prompts, a root-level `agents/`
  catalog for common code flows, and permission gates. Trigger phrases:
  "agentify", "make AI native", "set up agent files", "add AGENTS.md /
  CLAUDE.md", "make this repo agent-ready". Works across all repo types:
  Source, Packaging, Infra, Multi-module, Monorepo, Docs, LLM-app, Service.
tools: Bash, Read, Edit, Write, Glob, Grep
---

# agentify Skill

Transforms an existing repository into one that AI agents can navigate and contribute
to independently. All content requirements, templates, and phase guidance live in the
supporting files — this file is the execution map.

## Supporting Files

| File | Purpose | Load when |
|------|---------|-----------|
| [PLAN.md](PLAN.md) | Conversion index: setup, Step 0 execution, Phase 0, phase routing, Phases 3–4, verification gate, completion report | **Once at startup** — before STEP 0. Keep in context for all steps. |
| [CONVENTIONS.md](CONVENTIONS.md) | Code conventions to embed in AGENTS.md: Git workflow, Java, Bash | **Once at startup** — load alongside `PLAN.md`. Needed for AGENTS.md if repo has Java or Bash source. |
| [references/phase-1.md](references/phase-1.md) | Canonical Phase 1 instructions: SSoT pattern, `1.1`–`1.13`, Phase 1 completion gate | Load when STEP 2 begins. Keep it as the only active phase document until Phase 1 is fully complete. |
| [references/phase-2.md](references/phase-2.md) | Canonical Phase 2 instructions: registration rules, offer flow, `2.1`–`2.15` | Load only after Phase 1 is fully complete, `phase-1.md` is no longer the active phase document, and STEP 3 begins. Keep it as the only active phase document for Phase 2. |
| [references/phase-3.md](references/phase-3.md) | Canonical Phase 3 instructions: structural follow-up guidance, triage, and `3.1`–`3.6` | Load when STEP 4 begins. Keep it as the only active phase document until Phase 3 triage and selected work are fully complete. |
| [references/phase-4.md](references/phase-4.md) | Canonical Phase 4 instructions: automation/hygiene guidance, triage, and `4.1`–`4.8` | Load only after Phase 3 is fully complete, `phase-3.md` is no longer the active phase document, and STEP 5 begins. Keep it as the only active phase document for Phase 4. |
| [references/plan-reference.md](references/plan-reference.md) | Quick-reference matrix, effort table, and priority order | Load only when you need lookup/reference material rather than execution steps. |
| [references/prompt-templates.md](references/prompt-templates.md) | Templates and adaptation rules for repo-aware helper prompts and LLM-app prompt layouts; includes exhaustive `prompts/README.md` guidance | Load when §2.12 `prompts/` is in scope. |
| [references/repo-agent-templates.md](references/repo-agent-templates.md) | Templates and selection rules for repo-aware helper agents stored under the target repo's root `agents/` folder; includes exhaustive `agents/README.md` guidance | Load when §2.12 helper agents are in scope. |
| [references/skills-templates.md](references/skills-templates.md) | Templates and selection rules for repo-local skills stored under the target repo's `skills/` folder; includes exhaustive `skills/README.md` guidance and the Skill Registration Rule | Load when §2.6 (`/release` skill), §2.12, or any phase creates repo-local skills. |
| [references/rules-templates.md](references/rules-templates.md) | Templates and content guidance for tool-local quick-reference rule files: `.claude/rules/`, `.cursor/rules/`, `.github/rules/` | Load when §1.11 (Claude rules), §1.7 (Cursor rules), or Copilot rules are in scope. |
| [references/repo-type-guidance.md](references/repo-type-guidance.md) | Repo-type-specific guidance for Packaging, Multi-module, versioning, and LLM-app repos | Load when Step 2 asks for repo-type-specific AGENTS.md guidance. |
| [references/release-skill-template.md](references/release-skill-template.md) | Template for the `/release` skill created inside the target repo | Load when §2.6 asks you to create the release skill. |
| [references/maven-release.md](references/maven-release.md) | Maven release reference (even/odd, commands, rollback, troubleshooting) copied to target repo | Load alongside release-skill-template.md for Maven repos. |

---

## Setup

Read **`$SKILL_DIR/PLAN.md` § Setup and Bootstrap** and follow it to:
- choose an installation mode if the skill is not yet available,
- resolve `SKILL_DIR`, and
- stop immediately if setup cannot be completed.

Do not continue until `SKILL_DIR` is resolved and both supporting files are loaded.

---

## GLOBAL RULES

1. **Show every file before writing it.** Display proposed content and wait for approval.
2. **Never delete or overwrite existing content.** Only add or extend. Read existing files first
   and merge additions into them — never replace or discard without explicit approval.
3. **Deletion requires explicit user confirmation with a reason.** If you believe something
   should be removed (a section, a file, a line), stop and ask the user. State clearly:
   what you want to remove and exactly why. Only proceed after the user explicitly confirms.
   A general "ok" or "proceed" is not confirmation — the user must acknowledge the specific item.
4. **Boy-scout rule.** Improve incrementally. Never batch-rewrite beyond what is requested.
5. **AGENTS.md is the SSoT.** Tool-local files (`CLAUDE.md`, `.cursorrules`,
   `.github/copilot-instructions.md`) are projections — they must never become competing
   sources of truth. They may include a minimal index table (name, path, when-to-use) for
   prompts, agents, skills, and workflows so Claude can act without always loading `AGENTS.md`.
   This deliberate duplication is intentional and bounded: only the index rows, never the
   exhaustive per-item docs. Whenever `AGENTS.md` entries change, sync the index tables in
   the projection files in the same commit.
6. **Never add `.cursor/` to `.gitignore`.** `.cursor/rules/` contains committable shared
   rules.
7. **Skip steps that already exist.** If a file is adequate, note it as done and move on.
8. **AGENTS.md is repo-specific — never cross-contaminate.** Write only instructions that
   apply to the target repo. Never mention other hosting platforms or repo types in the
   AGENTS.md written into a repo.
9. **Generated helper agents must be repo-aware.** Create only agents that automate real,
   commonly used repo code flows using the target repo's actual commands, docs, paths, and
   vocabulary. Do not generate generic placeholder agents.
10. **`agents/` is canonical for repo-local agents.** Tool-local `agents/` directories are
    mirrors only and must point back to the root `agents/` folder.
11. **Follow the repo-agent update order exactly.** When §2.12 is in scope or any helper agent
    is created, follow the **Agent Registration Rule** in `references/repo-agent-templates.md`
    exactly. That file is the authoritative order.
12. **Follow the prompt update order exactly.** When §2.12 is in scope or the prompt library is
    updated, follow the **Prompt Registration Rule** in `references/prompt-templates.md` exactly.
    That file is the authoritative order.
13. **Follow the skill update order exactly.** When creating repo-local skills (including
    `/release`), follow the **Skill Registration Rule** in `references/skills-templates.md`
    exactly. That file is the authoritative order.
14. **Follow the workflow update order exactly.** When Phase 2 changes `.github/workflows/` or
    related workflow helpers, do the work in this order: update canonical workflow files under
    `.github/workflows/` and any touched helpers under `.github/scripts/`; create or update
    `docs/workflows.md` so it covers the full current workflow surface in scope; update
    `.github/workflows/README.md` with per-workflow behavior; update `AGENTS.md` with the current
    workflow surface and canonical doc locations; then update `docs/runbooks.md` and/or
    `wiki/architecture.md` when they already exist or were explicitly approved in Phase 2.
15. **Default to a small agent set.** For repo-local agents under `agents/`, aim for 3-5
    high-value agents by default. This is guidance, not a hard cap — create more when the repo's
    workflows clearly justify it.
16. **Default to a small prompt set.** For repo-local prompts under `prompts/`, aim for 3-5
    high-value prompts by default. This is guidance, not a hard cap — create more when the repo's
    workflows clearly justify it.
17. **Create focused helper-surface API docs.** When Phase 2 includes repo helper surfaces such
    as workflows, skills, rules, prompts, or repo-local agents, create or update focused
    contract docs under `docs/` instead of burying those contracts in one generic file. Use these
    canonical names when the matching surface exists or is created in the target repo:
    `docs/workflows.md`, `docs/skills.md`, `docs/rules.md`, `docs/prompts.md`,
    and `docs/agents.md`. Keep `docs/api.md` as the top-level index for those contract docs
    rather than the only place where the contracts are described. Each surface doc must describe
    the full current surface in scope for the repo section it covers, including both pre-existing
    items and items created in the current run, not just the delta from this change. Do not create
    companion `api.md` files under `skills/`, `prompts/`, `agents/`, `.github/workflows/`, or any
    other non-`docs/` path.
18. **Default to a focused ADR set.** For `docs/decisions/`, aim for 4-5 high-value ADRs by
    default. This is guidance, not a hard cap — create more when the repo has materially more
    independent decisions that would otherwise remain tribal knowledge.
19. **Use one active phase document at a time.** `references/phase-1.md` is the only active phase
    instruction source during STEP 2, `references/phase-2.md` during STEP 3,
    `references/phase-3.md` during STEP 4, and `references/phase-4.md` during STEP 5. After each
    phase reaches its completion gate or final triage state, stop using that phase file as the
    active phase document before loading the next one.

---

## STEP 0 — Resolve Execution Mode, Repo, and Work Item

Read **`$SKILL_DIR/PLAN.md` § Step 0 Execution** and follow it in order to:
- determine local vs remote execution,
- clone and/or switch into the target repo when required,
- resolve the working-directory strategy,
- confirm `WORK_ID`,
- confirm `BASE_BRANCHES` and branch naming,
- run the branch checkout flow for the current base branch, and
- record the selected AI tools.

Stop at every explicit confirmation gate in the plan. Do not proceed to STEP 1 until Step 0 is fully resolved.

---

## STEP 1 — Phase 0: Assess the Repo

Read **`$SKILL_DIR/PLAN.md` § Phase 0** for the full assessment commands and label
assignment rules.

Run all checks from `PLAN.md` §0.1, collect the results, then output:
- A list of applicable Repo Type Labels
- A one-paragraph summary of the repo's current AI-nativeness state
- The set of Phase 1 steps that are applicable

**Do not proceed to STEP 2 until the user has confirmed the classification is correct.**

---

## STEP 2 — Phase 1: Zero-Effort High-ROI Files

Read **`$SKILL_DIR/references/phase-1.md`** for the full Phase 1 requirements and templates for
each file. This is the only active phase document during STEP 2. This step provides only the
execution workflow (tool gates, ordering, approval).

**For each file in scope:**
1. Check tool selection from Step 0.g — if tool deselected, skip this file entirely
2. Check if file already exists — if yes, read it and decide what needs updating
3. Read `references/phase-1.md` for this file's content requirements and template
4. For AGENTS.md: run the **mandatory codebase exploration** from
   **`$SKILL_DIR/references/phase-1.md` §1.6** before
   drafting. Also read
   **`$SKILL_DIR/CONVENTIONS.md`** for the conventions sections to append (Java style,
   Java testing, Bash style) based on repo type labels
5. Draft content tailored to this specific repo — never generic boilerplate
6. Show the draft and wait for approval
7. Write only after approval

**Path order, tool gates, and `references/phase-1.md` section references:**

| Path | Tool gate | `references/phase-1.md` section |
|------|-----------|-----------------|
| `AGENTS.md` | Always — first | §1.6 + CONVENTIONS.md Appendix A |
| `CLAUDE.md` | Claude Code selected | §1.1 |
| `.claude/settings.json` | Claude Code selected | §1.11 |
| `.claude/rules/*.md` | Claude Code selected | §1.11 |
| `.cursorrules` | Cursor selected | §1.7 |
| `.cursor/rules/*.mdc` | Cursor selected | §1.7 |
| `README.md` | Always | §1.2 |
| `CONTRIBUTING.md` | Always | §1.3 |
| `.github/CODEOWNERS` | Always (GitHub repos) | §1.4 |
| `.github/copilot-instructions.md` | GitHub Copilot (IDE) selected | §1.5 |
| `.gitignore` | Always | §1.9 |
| `.editorconfig` | All repos with text files | §1.8 |
| `.env.example` | Has-env-vars repos only | §1.10 |
| `.github/workflows/ci.yml` | GitHub repos | §1.12 |
| `.codex/` + `.agents/` | Codex / Gemini / Windsurf / generic tool selected | §1.13 |

For repo-type-specific AGENTS.md guidance (Packaging, Multi-module, even/odd versioning,
LLM-app): read **`$SKILL_DIR/references/repo-type-guidance.md`**.

After all files: output the **Skipped-Files Report** (`references/phase-1.md` § Phase 1 Completion),
then confirm the **Phase 1 Exit Gate** in that file is satisfied. Do not move on while any
Phase 1 work is still pending.

Do not proceed to STEP 3 until the Phase 1 Exit Gate in `references/phase-1.md` is satisfied.

---

## STEP 3 — Phase 2: Contract Clarity

Read **`$SKILL_DIR/references/phase-2.md`** for content requirements and registration rules for
each deliverable. Follow the offer workflow in
**`$SKILL_DIR/references/phase-2.md` § Presenting Phase 2 to the User**.

Key rules:
- Do not enter STEP 3 until the **Phase 1 Exit Gate** in `references/phase-1.md` is satisfied and
  there is no pending Phase 1 work
- `references/phase-2.md` is self-sufficient for Phase 2. Once STEP 3 begins, it replaces
  `references/phase-1.md` as the active phase document
- Always offer Phase 2 after Phase 1 — do not start without asking
- Before drafting any Phase 2 deliverable, explicitly present the applicable Phase 2 items to the user and wait for a yes/no decision on what to do now versus defer
- `docs/release-process.md`, `CHANGELOG.md`, and the `/release` execution skill are **not deferrable** for versioned repos
- Phase 2 may assume that every applicable Phase 1 file already exists in final approved form and
  may update those files where the Phase 2 rules require it
- For each deliverable: read source files first, draft from real content, show draft, write after approval
- Never assume the user wants to defer — ask explicitly
- Any edit to `wiki/architecture.md`, `wiki/code-flows.md`, or any `wiki/code-flow-*.md` file must be treated as a two-part change: update the repo copy and sync the GitHub wiki before moving on
- If the current change modifies a workflow, automation path, or code path that already has a matching `wiki/code-flow-*.md` page, update that wiki page in the same change instead of leaving it stale
- In `AGENTS.md`, keep `wiki/code-flows.md` as the workflow-doc entry point in `## Key Documentation`; list `wiki/code-flow-*.md` in the repository structure and let the index page link to the individual workflow docs
- Treat API documentation as four separate concerns during Phase 2:
  - service/network API docs (`references/phase-2.md` §2.7)
  - public library / consumer contract overview docs (`references/phase-2.md` §2.8 public API surface reference)
  - source-level API docs in touched files (`references/phase-2.md` §2.8 boy-scout rule)
  - helper-surface contract docs for workflows, skills, rules, prompts, and agents (`references/phase-2.md` §2.12)
- **After writing each Phase 2 deliverable**, apply the **Phase 2 Registration Rule**
  (`references/phase-2.md` § Phase 2 Registration Rule) — update `AGENTS.md`'s repo structure
  tree and `## Key Documentation` table to reference the new file or prompt entry point

---

## STEP 4 — Phase 3: Structural Improvements

Read **`$SKILL_DIR/references/phase-3.md`**.

Summarise which Phase 3 steps are applicable, then classify each applicable step using the
default triage guidance in `references/phase-3.md`.

For each classified Phase 3 item:
- execute `Do now` items in the current session
- present `Offer now` items to the user and wait for approval before doing them
- record `Defer` items for the completion report

Do not describe all of Phase 3 as blanket defer work. Keep `references/phase-3.md` as the only
active phase document during this step. Once Phase 3 triage and any selected Phase 3 work are in
final state, stop using `references/phase-3.md` as the active phase document before loading
`references/phase-4.md`.

---

## STEP 5 — Phase 4: Automation and Ongoing Hygiene

Read **`$SKILL_DIR/references/phase-4.md`**.

Summarise which Phase 4 steps are applicable, then classify each applicable step using the
default triage guidance in `references/phase-4.md`.

For each classified Phase 4 item:
- execute `Do now` items in the current session
- present `Offer now` items to the user and wait for approval before doing them
- record `Defer` items for the completion report

Do not describe all of Phase 4 as blanket defer work. Keep `references/phase-4.md` as the only
active phase document during this step.

---

## STEP 6 — User Verification and Completion Report

### Review generated files for overlap and redundancy

Check that no convention, rule, or process is documented in more than one place across the files
created or modified in this session (e.g. the same git workflow in both `AGENTS.md` and
`CONTRIBUTING.md`). Remove duplicates from the new or newly edited content in this run and ensure
each file has a single clear purpose. If fixing duplication would require deleting or replacing
pre-existing repo content outside the sections you already drafted for this session, stop and ask
the user for explicit approval before removing it.

If using Claude Code, run `/simplify` on the changed files. Other tools: manually diff the generated files against each other and consolidate.

### Mandatory verification before any PR

Follow the full gate defined in **`$SKILL_DIR/PLAN.md` § Pre-PR Verification Gate** exactly as written there. Do not abbreviate or skip any step.

### Completion Report

Output after the PR is created (template in **`$SKILL_DIR/PLAN.md` § Completion Report**).

---

## STEP 7 — Post-PR Cleanup (Remote mode only)

If `IS_REMOTE_CLONE` is set, run the full cleanup flow from
**`$SKILL_DIR/PLAN.md` § Post-PR Cleanup (Remote Mode Only)**.
Otherwise skip this step entirely.

---

When any step says "read `PLAN.md` §X", open `$SKILL_DIR/PLAN.md` and navigate to that section.
