# Code-assessment runbook

This is the **standard runbook** — the ordered procedure the agent follows for a code-assessment run. Findings come from the user (named paths) or from discovery (a repo scan); the runbook handles both identically.

For design *why*, see [`shared-principles.md`](shared-principles.md). For git branch naming, run log schema, and rollback commands, see [`git-workflow.md`](git-workflow.md).

## Invocation modes

| Mode | How it starts | Findings `files[]` | Target versions (deps) |
|---|---|---|---|
| **with_findings** | User named paths or coordinates | Provided — use only these paths | User-supplied target versions before planning. |
| **discover** | User asks to scan/fix project without a file list | Empty — run **Discovery** in the active expert skill's `SKILL.md` + recipe under `../<pattern-name>/` (e.g. `../inject-in-sling-model/`, `../outdated-dependencies/`) inside workspace roots | Ask user for coordinates + target versions before building dep plans |

## Git vs in-place

Detect once: `git rev-parse --is-inside-work-tree` (exit 0 → git available).

| | **git** | **in_place** (not a git repo, or user/workspace has no `.git`) |
|---|---|---|
| Pre-flight | **Advisory only** — record status; warn if dirty or on `autofix/*` (see Step 4) | No git checks |
| Isolation | Create `autofix/<pattern-slug>/<date>-<hash>` after plan confirm (apply intent) | **Edit files in place** on disk — no branch |
| Rollback on verify fail | `git restore .`, delete branch | Revert each touched file from editor/local history; list paths in summary — skill does not auto-backup |
| Handoff | `git diff <base>...HEAD` | List modified paths; user reviews in IDE |

Record `edit_mode: "git" | "in_place"` in `.autofix/last-run.json` (see git-workflow schema).

## User intent: report vs apply

Many real runs should end with a **useful report**, not blocked pre-checks. Classify intent from the prompt:

| Intent | User signals | Deliverable |
|---|---|---|
| **report** | "scan", "assess", "what needs fixing", "show findings", "analyze" (without "apply"/"fix") | Discovery + detailed plan + skip/defer reasons — **no file edits** unless the user then explicitly asks to apply |
| **apply** | "fix", "upgrade", "remediate", "apply", "make the changes" | Plan → confirm → edits → verify |

Default for ambiguous discover prompts: **report first**, then ask: *"Apply these changes? (yes/no)"* — do not treat silence as consent.

**Version policy (standalone deps):** If target versions are missing, still produce the report listing `groupId:artifactId@current` per file and ask for targets. Do not stop after "need versions" with an empty report.

## Steps

Run in order. **Hard stops** are limited to: unsupported pattern, user declined plan, already on `autofix/*` without user consent to continue, verify failure after apply (rollback). Do not stop solely for dirty git or failed baseline compile.

**Per-pattern fault isolation:** if detecting or fixing one pattern fails unexpectedly, isolate it — record the failure (a `skipped` entry with the reason) and continue with the remaining patterns; the report lists it. One pattern's failure never aborts the whole run.

Do not edit the developer's code until the active expert skill's `SKILL.md` and recipe have been read in full.

### 1. Classify

Match the request to one expert skill under `code-assessment/<pattern>/` using the **Manual Pattern Hints** table in [`../SKILL.md`](../SKILL.md). If nothing matches, stop and say the issue is not supported yet.

### 2. Read reference module

Read the chosen expert skill's `SKILL.md` then its `recipe.md` (or `path-*.md`) in full — **Discovery**, input contract, recipe, Unlocatable, editing strategy.

### 3. Resolve findings (with_findings or discover)

**Findings shape (the detection↔remediation interface).** However found, each finding carries: `pattern` (slug), `file` (workspace-relative path), `line` (1-indexed), `snippet` (the offending text). Every source — an LLM `scan`, user-named targets, or a future deterministic `analyzer` — emits this shape, and everything downstream (plan, apply, verify, report) consumes it identically.

**with_findings:** Build the work list from user-named paths/coordinates. For outdated dependencies, merge user-supplied fields with local pom inspection for `shape` / `propertyName`. For Sling Model inject migration, use the resolved Java paths only.
Pass the named paths to the analyzer with `--files a.java,b.java` so detection runs only on them.

**discover:** Run the analyzer — it is the detection engine:

```bash
bash <skill-dir>/scripts/analyze.sh <workspace-root> [--pattern <slug>]
```

Pass `--pattern <slug>` for a single expert-skill run; omit it for a full multi-pattern audit.
Parse its stdout JSON: `findings[]` (each already in the `{pattern,file,line,snippet}` shape
below) is the work list; surface `warnings[]` under **Discover warnings** in the report. Do not
re-scan per pattern — the analyzer parses the workspace once and runs all enabled detectors over
that single parse. See [`../scripts/README.md`](../scripts/README.md).

**Dependency scope (`--all`):** `outdated-dependencies` defaults to a curated allowlist of
coordinates where upgrades are actionable in AEM CS (`aem-sdk-api`, `org.mockito:*`). Pass `--all`
**only** for an explicit full audit — the user says "all dependencies", "every library", or
"comprehensive". Do **not** pass `--all` for a normal "are my dependencies outdated?" ask: the
allowlist is the actionable answer, and `--all` floods the report with platform deps (OSGi, JCR,
servlet-api) that are not independently upgradeable.

**Discover-time checks (run during Step 3, before Step 6):** Do not wait until plan/skip to surface predictable failures.

| Check | When | Action |
|---|---|---|
| Duplicate pom locator | Outdated dependencies — for each candidate `(file, groupId, artifactId, currentVersion)` | Count `<dependency>` blocks matching all three in that `file`. If count > 1, record immediately as `skipped` with `ambiguous-locator: multiple matches for <g>:<a>@<v> in <file>` and add a **Discover warning** (see below). |
| Property shape sanity | Same pattern, `${property}` shape | If property missing or not referenced by the dependency, pre-record the matching `property-*` skip reason from the recipe. |
| `@Inject` file-level risk | Inject-in-sling-model | After listing Java candidates, optionally skim for constructor/setter `@Inject` or unsupported companions — pre-mark likely `inject-ambiguous-field` skips in the discover summary so the report is honest before Step 6. |

**Discover warnings** — collect in memory and in `last-run.json` as `discovery_warnings[]` (strings). Show them in the Step 7 report under **Discover warnings**, not only under per-item skip lines. Example:

```text
discover-warning: core/pom.xml — org.mockito:mockito-core@4.4.0 appears in 2 <dependency> blocks (will skip as ambiguous-locator)
```

**Outdated dependencies without target version:** List candidates and missing target versions in discover output. Ask for targets in the report; do not invent versions.

### 4. Git snapshot (advisory — git mode only)

Detect `edit_mode` (`git rev-parse --is-inside-work-tree` → `git` | `in_place`) and take the advisory git snapshot **here** — this runbook is the sole owner of repo-environment detection; the entry/router (`../SKILL.md`) does not duplicate it. Run `git status --porcelain` and `git rev-parse --abbrev-ref HEAD`. Record in the run log as `preflight.git_status: clean | dirty` and `preflight.branch`.

- **JDK check (detection requirement):** run `java -version`. The analyzer needs a JDK
  (Java 11+). If absent, **stop** with: *"Detection requires a local JDK (Java 11+). Install a
  JDK or point `JAVA_HOME` at one, then re-run."* (Analyzer-only; no LLM-scan fallback.)
- **Dirty tree (untracked or modified files):** do **not** stop. Warn in the plan: mixed WIP and autofix edits may be harder to review; `git restore` rollback only reverts paths this skill touched.
- **Already on `autofix/*`:** stop unless the user explicitly wants to continue on that branch — avoids nested/confusing runs.
- **Not on team base branch:** warn only; proceed if user intent is apply.

### 5. Baseline compile (informational)

From the AEM Maven reactor root when present, run `mvn compile` (or `mvn compile -pl <module> -am` when fixes are scoped to one module — document which module in the log).

- Record `compile.baseline: pass | fail | skipped` in the run log and **always surface in the plan/summary** with a short excerpt of errors on failure.
- **Do not block** planning or apply on baseline failure. The project may already be broken; the skill still attempts recipe-driven fixes the user asked for.
- On baseline **fail** and intent **apply**, require explicit `yes` that acknowledges: *"Baseline compile failed; I still want edits applied."*

If no Maven project, set `compile.baseline=skipped` and note in the report.

### 6. Build detailed edit plan

Per finding/file: locator from recipe → `apply` or `skipped` with the **exact** reason string from the recipe's Unlocatable section. No partial file migrations for `@Inject` (file-level skip policy).

Include: pattern, `edit_mode`, file list, before/after summary, skip list, deferred list (no-recipe or not-selected patterns).

When more than one pattern is in play, order them in the plan and report by their catalog `severity` (`high` → `low`, from [`patterns.md`](patterns.md)) so the highest-severity fixes surface first.

### 7. Plan and confirm (report deliverable)

Present the report using the **template below** (fill every section; use `—` or `None` when empty). Write the same content to `.autofix/last-run.json` fields where applicable (on first write, also create `.autofix/.gitignore` containing `*` so the log self-ignores — see [`git-workflow.md`](git-workflow.md)), then show the markdown to the user.

**report intent:** Stop here with `status=reported` in the run log (no branch, no edits). Offer apply as a follow-up.

**apply intent:** Require explicit `yes` (or stronger: "apply", "proceed", "fix it") before Step 8. If declined → `status=aborted`.

#### Report template (Step 7)

Copy this structure; keep section headings so runs are comparable across sessions.

```markdown
# Code assessment report

## Run metadata
| Field | Value |
|-------|-------|
| Pattern | <name> |
| Invocation | with_findings \| discover |
| Intent | report \| apply |
| Edit mode | git \| in_place |

## Preflight
- Git status: <clean \| dirty \| n/a>
- Branch: <name or —>
- Warnings: <bullets or None>

## Compile (baseline)
- Result: <pass \| fail \| skipped>
- Notes: <one-line excerpt if fail, or —>

## Discover warnings
<bullets from Step 3 discover-time checks, or None>

## Candidates
| File | Finding | Planned action | Target / notes |
|------|---------|----------------|----------------|
| <path> | <id> | apply \| skipped | <before → after, or skip reason> |

## Summary counts
- Apply: <n>
- Skipped: <n>
- — of which needs user target version: <n> (subset of Skipped; deps only)
- Deferred (no-recipe / not-selected): <n>

## Deferred (no-recipe / not-selected)
<bullets from deferred[], or None>

## Next step
<For report intent: "Reply **apply** to make edits, or name files/versions to narrow scope.">
<For apply intent: awaiting user confirmation — do not edit until yes>
```

**Agent output requirement:** present the full report template above in the user-facing response — every section, headings verbatim. Do not replace it with a shortened or ad-hoc summary; identical headings keep runs comparable across sessions.

**Counts come from the analyzer JSON `findings[]` and the per-item plan — never estimated.** Each finding has exactly one disposition: **apply-candidate** or **skipped**. The invariant is `apply + skipped == total findings`. The skipped *reasons* (`needs-target`, `ambiguous-locator`, `unlocatable`) **partition** the skipped set — they sum to `skipped`, they are not added on top of it. Pattern-level deferral (`not-selected`, from one-pattern-per-session) is recorded separately in `deferred[]` for the apply phase; it is **not** a per-finding skip and must not be added to the skipped count. In `report` intent, "apply-candidate" means a finding that *would* be applied — no edits are made.

**Runtime caveat** (include when `@Inject` migration is in scope): compile does not exercise Sling Model adaptation — deploy to dev before merge.

### 8. Apply edits (apply intent only)

**git:** Create branch per [`git-workflow.md`](git-workflow.md), then surgical edits.

**in_place:** Write directly to resolved paths. Same surgical rules — no reformat, no out-of-scope files.

### 9. Verify and summarize

Re-run `mvn compile` when Step 5 was not skipped. Record `compile.verification: pass | fail | skipped`.

- **Pass:** `status=success` — summary includes baseline + verification, applied/skipped, handoff (`git diff` or path list), runtime caveat for `@Inject`.
- **Fail after apply:** Rollback per `edit_mode`, `status=reverted`, surface compiler output. Do not auto-retry with different versions.
- **report-only run:** `compile.verification=skipped`; summary is the Step 7 report.

**Never** `git commit`, `git push`, or open a PR.

## Workspace scope

- Developer Java/XML/HTL: **only** under current IDE workspace root(s).
- Skill files under `code-assessment/`: read for instructions, never edit.
