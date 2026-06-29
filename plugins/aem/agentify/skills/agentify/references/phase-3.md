# Agentify Phase 3

Use this file for the full Phase 3 workflow. `PLAN.md` remains the top-level execution index,
but the canonical Phase 3 instructions live here. This document is self-sufficient for Phase 3:
while it is active, do not load or use `phase-4.md` as an execution source.

## Scope And Prerequisites

- Start only after Phase 2 is complete.
- Use this file for all `3.1`–`3.6` work and for Phase 3 triage.
- Keep this file as the active Phase 3 instruction source when Phase 3 items are being assessed or executed.
- For applicability, effort, and priority lookup, use [plan-reference.md](plan-reference.md).
- Phase 3 does not depend on Phase 4 content. Triaging or deferring Phase 4 does not affect how
  Phase 3 itself is evaluated.

## Phase 3: Structural Improvements

**Goal:** Reduce implicit context and make the codebase navigable by AI tools.

> All steps follow the **boy-scout rule** unless otherwise noted.

## Default Triage For Phase 3

Do not treat all of Phase 3 as automatic defer work, but structural changes should still be
handled conservatively.

- **Do now** when a Phase 3 step is low-risk, tightly scoped, and naturally overlaps with files
  already being changed in the current session.
- **Offer now** when a structural improvement is clearly valuable but requires an explicit user
  decision about scope, rollout cost, or architectural tradeoffs.
- **Defer** when the work is a broader refactor that is better handled during a future change
  touching the same code paths.

**Default guidance:**
- **Do now:** only narrowly scoped structural cleanup that cleanly fits the current change
- **Offer now:** bounded structural improvements the user may want to include in the current round
- **Defer:** most of Phase 3 (`3.1`–`3.6`) unless the current session is already modifying those
  code paths or the user explicitly wants the structural follow-up now

When presenting Phase 3, say which applicable steps fall into which bucket and why.

After classification:
- execute `Do now` items in the current session
- present `Offer now` items to the user before doing them
- record `Defer` items so they appear in the completion report as explicit follow-up work

### 3.1 — Centralised Configuration (`src/config/` or module-level equivalent)

**When to apply:** **Source** repos that have model choices, feature flags, or runtime configuration scattered across multiple files.

**What to do:** Create a `src/config/` directory (or equivalent per language convention) that centralises all runtime configuration: model selection, feature flags, timeouts, retry counts, external service URLs.

No configuration value should be defined in more than one place. Application code reads from this single location.

In **Multi-module** repos, interpret this at the module boundary: shared configuration belongs in a shared module or parent configuration layer; module-specific runtime config stays with that module.

**Files:** New `src/config/` (or `config/`) directory with dedicated config files per concern.

**Done when:** Changing a model name, feature flag, or timeout requires editing exactly one file. Grep for config values produces one result.

**Skip if:** The repo is packaging-only, infrastructure-only, or documentation-only with no runtime config.

### 3.2 — Centralised Logging (`src/lib/logger.*` or shared module equivalent)

**When to apply:** **Source** repos only.

**What to do:** Create a single logging module (`src/lib/logger.*` or language equivalent). All logging in the application goes through this module. Document: log levels used, structured fields required, correlation ID conventions, where logs are shipped.

In **Multi-module** repos, this may be a shared library module rather than a single `src/lib/` path at the repo root.

**Files:** New `src/lib/logger.*` (or equivalent).

**Done when:** `grep -r "console.log\\|System.out.print\\|print(" src/` (or language equivalent) returns zero hits. All log statements use the centralised logger.

**Skip if:** The repo is packaging-only, infrastructure-only, or uses a framework that provides logging (e.g., OSGi SLF4J already centralises logging in AEM projects).

### 3.3 — Eliminate Magic Values

**When to apply:** **Source** and **Infra** repos. Boy-scout rule.

**What to do:** Replace magic numbers, hardcoded strings, and unexplained literals with named constants.

Bad: `if (retryCount > 3)` — Good: `if (retryCount > MAX_RETRY_ATTEMPTS)`

**Done when:** Grep for numeric literals (excluding 0 and 1) and string literals in conditional expressions returns fewer than 5 unexplained hits per 1000 lines of code.

### 3.4 — Reduce Method Length and Complexity

**When to apply:** **Source** repos. Boy-scout rule — apply only to methods being modified.

**What to do:** When modifying a method longer than 30 lines or with cyclomatic complexity above 10, extract well-named helper methods.

**Done when:** No newly written or modified method exceeds 40 lines or cyclomatic complexity of 10. Measure with Checkstyle, ESLint, Pylint, or SonarQube.

### 3.5 — Make Dependencies Explicit

**When to apply:** **Source** repos. Boy-scout rule.

**What to do:** Replace service locator patterns with constructor injection. Replace global state accessed via static methods with injected dependencies. Replace implicit ordering with explicit state machines or builder patterns.

**Done when:** For any class, an LLM can determine all its dependencies by reading the constructor (or import list for functional code) alone.

### 3.6 — Organise Directory Structure To Reflect Architecture

**When to apply:** **Source** and **Infra** repos with flat or confusing directory layouts. NOT a boy-scout item — plan deliberately.

**What to do:** Organise sub-packages/modules to reflect architectural boundaries. Do this module-by-module during natural refactoring milestones, not as a big-bang rename.

**Done when:** The output of `tree` tells the architectural story. Major components and their relationships are inferable from directory names alone.

**Repo type notes:**
- **Multi-module:** Prefer clear parent/child module boundaries over forcing every module to be top-level. Group modules by role (`core`, `store`, `segment`, `search`, `benchmarks`, `it`, `examples`, etc.) and document the reason each grouping exists.
- **Monorepo:** Each independently deployable unit should be a top-level directory with its own README, build file, and `CLAUDE.md`.
- **Packaging-only:** This step rarely applies.

## Phase 3 Completion

When the selected Phase 3 work is complete:
- summarize what was done now, what was offered, and what was deferred
- confirm there is no pending Phase 3 draft or unresolved Phase 3 decision still blocking handoff
- hand control back to `SKILL.md` / `PLAN.md`
- stop using this file as the active phase document
- continue with Phase 4 by loading `phase-4.md`
