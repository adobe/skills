# Git and in-place workflow

Owned by the runbook ([`runbook.md`](runbook.md)). `edit_mode` is detected once in the runbook's preflight.

**The skill does not commit, push, or open PRs.**

| `edit_mode` | Isolation | Rollback on verify fail | Handoff |
|---|---|---|---|
| `git` | `autofix/<pattern-slug>/<date>-<hash>` branch | `git restore .`, delete branch | `git diff <base>...HEAD` |
| `in_place` | Edits written directly to workspace paths | User reverts via IDE/history; summary lists every touched path | Path list + diff in IDE |

See [runbook.md](runbook.md) for when each mode applies.

## Branch naming

```
autofix/<pattern-slug>/<YYYY-MM-DD>-<short-hash>
```

- `<pattern-slug>` — short kebab-case slug for the pattern being fixed (e.g. `outdated-dependencies`, `inject-in-sling-model`).
- `<YYYY-MM-DD>` — today's UTC date.
- `<short-hash>` — first 7 characters of the `HEAD` SHA at the time the skill creates the branch.

Examples:
- `autofix/outdated-dependencies/2026-04-21-a1b2c3d`
- `autofix/inject-in-sling-model/2026-04-21-a1b2c3d`

Why include the hash: the user may run the skill multiple times (after base-branch moves, or on different patterns). The hash makes every branch unique and traceable to a specific baseline.

## When to create the branch (git mode only)

**After the user confirms the plan** (`runbook.md` step 7). Never before. Skip entirely when `edit_mode=in_place`. This means:

- If the user declines the plan → no branch was ever created; nothing to clean up.
- If the user declines the plan or intent is **report** → no branch.

## What the skill writes — and does NOT write

The skill writes the modified source files (e.g. `pom.xml`, `.java`) on the fix branch. It does **not**:

- Stage files (`git add`).
- Create commits.
- Push the branch.
- Open a PR.
- Amend or force-push anything.

The run's log file (`.autofix/last-run.json`) is written to the working-directory root. On first use the skill also writes `.autofix/.gitignore` containing `*`, so the directory self-ignores and the run log never lands in the developer's commits.

## Rollback

If verification compile fails:

**git mode:**

```bash
git restore .
git checkout -
git branch -D autofix/<pattern-slug>/<date>-<hash>
```

**in_place mode:** Do not run git commands. Tell the user which files were modified and that they must revert those paths manually (IDE local history, backup, or VCS outside this skill). Set `status=reverted` in the run log.

The `.autofix/last-run.json` record persists (gitignored) so the user can inspect what happened.

## Handing back to the developer

After a successful run, the skill tells the user:

> "Edits applied on branch `<branch-name>`. Review with `git diff <base-branch>...HEAD`. If the diff looks right, stage and commit the files yourself, then open a PR from your git host — the skill does not commit, push, or open PRs automatically."

Suggested commit message (for the developer to use, not the skill):

```
autofix: <pattern-slug> — <summary line per the expert skill>

<per-edit detail lines>

Skipped (unlocatable / ambiguous targets):
<entry> — <reason>
...
```

The `Skipped (…)` trailer is included only if the run had skips.

Each expert skill under `code-assessment/<pattern>/` documents its own suggested subject line and per-edit detail format. The developer is free to adjust the message.

## Run log: `.autofix/last-run.json`

The skill writes a single JSON record to `.autofix/last-run.json` at the working-directory root after each run (success, revert, report, or abort). On first use it also writes `.autofix/.gitignore` containing `*`, so the directory self-ignores in the developer's repo (the skill cannot edit the developer's root `.gitignore`). The file is the authoritative record of what the skill did or attempted. A new run overwrites it; historical runs are not retained. **During an apply it is updated after each file** (not only at the end) so an interrupted or context-compacted session can resume from it without losing or repeating work — see "Resuming a large apply".

### Schema

```json
{
  "schema_version": 2,
  "run_id": "<uuid-v4>",
  "started_at": "<ISO-8601 UTC timestamp>",
  "finished_at": "<ISO-8601 UTC timestamp>",
  "status": "success | reverted | aborted | reported | applied-partial | applied-unverified",
  "intent": "report | apply",
  "preflight": {
    "git_status": "clean | dirty | n/a",
    "branch": "<branch name or null>",
    "warnings": ["<string>"]
  },
  "abort_reason": "<string, only present when status=aborted>",
  "pattern": "outdated-dependencies",
  "edit_mode": "git | in_place",
  "invocation": "with_findings | discover",
  "base_branch": "main",
  "base_sha": "<7-char short hash, null when in_place>",
  "branch": "autofix/outdated-dependencies/2026-04-21-a1b2c3d",
  "compile": {
    "baseline": "pass | fail | skipped",
    "baseline_reason": "toolchain-jdk-lombok | missing-private-repo | other | no-maven-project | null",
    "verification": "pass | fail | skipped"
  },
  "apply_progress": {
    "total": 0,
    "applied": 0,
    "skipped": 0,
    "remaining": ["<workspace-relative path not yet processed this pass>"],
    "batch_cap": 40
  },
  "applied": [
    {
      "file": "core/pom.xml",
      "finding": "org.mockito:mockito-core@4.4.0 -> 5.14.0",
      "shape": "literal | property",
      "property_name": "<string, only when shape=property>"
    }
  ],
  "skipped": [
    {
      "file": "core/pom.xml",
      "finding": "<colon-string or annotation marker>",
      "reason": "<exact reason from the recipe's Unlocatable section>"
    }
  ],
  "discovery_warnings": [
    "discover-warning: <file> — <human-readable prediction or early skip explanation>"
  ],
  "deferred": [
    {
      "pattern": "inject-in-sling-model",
      "finding_count": 8,
      "reason": "not-selected: user chose outdated-dependencies"
    },
    {
      "pattern": "some-new-pattern",
      "finding_count": 3,
      "reason": "no-recipe: no expert skill at ../some-new-pattern/"
    }
  ]
}
```

### Field rules

- **`status`** — `success` = edits applied and verification compile passed. `reported` = report/plan delivered, no edits (`intent=report` or user did not confirm apply). `reverted` = edits applied but verification failed; rollback ran. `aborted` = stopped before useful output (unsupported pattern, user declined, blocked `autofix/*` without consent). `applied-partial` = a batch of files was applied and **more remain** (apply paused at `apply_progress.batch_cap`; resume to continue — see "Resuming a large apply"). `applied-unverified` = edits applied but post-apply compile could not confirm them because the **baseline build does not compile** for a toolchain/repo reason (`compile.baseline_reason` ∈ `toolchain-jdk-lombok | missing-private-repo`); not a rollback. **Not** used for dirty git or baseline compile failure alone.
- **`compile.baseline_reason`** — when `compile.baseline=fail`, the classified cause (`toolchain-jdk-lombok | missing-private-repo | other`); `no-maven-project` when no pom; `null` when baseline passed.
- **`apply_progress`** — present only for `intent=apply`. `total` = applicable findings/files for the pattern; `applied`/`skipped` = processed so far; `remaining[]` = files not yet processed; `batch_cap` = max files per pass (default 40). Updated **after each file** so progress survives an interrupted/compacted session.
- **`intent`** — `report` or `apply` for this run.
- **`preflight`** — advisory git snapshot; dirty tree is a warning, not a failure status.
- **`discovery_warnings[]`** — strings from Step 3 discover-time checks (e.g. duplicate pom locator). Mirror the **Discover warnings** section of the Step 7 report template in `runbook.md`.
- **`pattern`** — the expert skill (pattern slug) fixed this session.
- **`edit_mode`** — `git` or `in_place` for the whole run.
- **`invocation`** — `with_findings` (paths/coordinates supplied by the user) or `discover` (repo scan).
- **`branch`** — `null` when `edit_mode=in_place`, or `status=aborted` before branch creation.
- **`base_branch` / `base_sha`** — `null` when `edit_mode=in_place`.
- **`compile.baseline`** — `skipped` only when `status=aborted` before reaching baseline (e.g. unsupported pattern, user declined) or when no Maven project is present.
- **`compile.verification`** — `skipped` when `status=aborted` (no edits applied) or when zero findings were applicable.
- **`applied[].finding`** — human-readable identifier for the finding. For `outdated-dependencies` use `<groupId>:<artifactId>@<currentVersion> -> <targetVersion>`. For `inject-in-sling-model` use the file path.
- **`skipped[].reason`** — must be one of the exact strings the active expert skill defines under "Unlocatable" (`literal-not-found: …`, `property-missing: …`, `inject-ambiguous-field: …`, `ambiguous-locator: …`, `discovery-no-match: …`). No free-form text.
- **`deferred[]`** — patterns found but **not fixed this session**. Two reason variants:
  - `not-selected: user chose <other-pattern>` — the user picked a different pattern this session (one-pattern-per-session rule).
  - `no-recipe: no expert skill at ../<pattern-slug>/` — the issue has no expert skill yet.

  Recording these means nothing is silently dropped — the user has a clear list to fix in a follow-up session or request a new expert skill for.

## Resuming a large apply (batching)

A large apply (e.g. an `@Inject` migration spanning 150 files) can exceed one context window; a
mid-run summary/compaction must not lose track of which files are done. The run log is the durable
checkpoint:

1. **Checkpoint per file.** After each file is applied or skipped, append it to `applied[]` /
   `skipped[]` and update `apply_progress` (`applied`/`skipped`/`remaining`) in `.autofix/last-run.json`
   **immediately** — never batch the writes to the end.
2. **Cap per pass.** Process at most `apply_progress.batch_cap` files (default 40) in one pass. If more
   remain, stop cleanly with `status=applied-partial` and tell the user: *"Applied N of M files for
   `<pattern>`; <K> remain. Reply **apply `<pattern>`** to continue."* The branch (git mode) stays as
   is between passes.
3. **Resume idempotently.** On an `apply <pattern>` invocation, before editing, read
   `.autofix/last-run.json`; if it records the same `pattern` + `base_sha` (git) and `status` is
   `applied-partial`, **skip files already in `applied[]`/`skipped[]`** and continue with `remaining[]`.
   Re-applying an already-migrated file must be a no-op (the recipe's edits are idempotent — e.g. a
   field already on `@ValueMapValue` is left unchanged), so a resume after a partial write is safe.
4. **Finish.** When `remaining[]` is empty, run Step 9 verify and set the terminal status
   (`success` / `reverted` / `applied-unverified`).

This keeps a large mechanical migration safe across context boundaries and gives the user a clear
resume handle instead of an opaque half-migration.

### Why this shape

- **`status` is a closed set of terminal values** — every run lands in exactly one, so the outcome is unambiguous.
- **`schema_version` lets the format evolve** — future patterns may add per-finding metadata; bumping the version flags incompatibilities to anything that reads the log.
- **`applied` and `skipped` mirror the pattern's own vocabulary** — using the recipe's exact "Unlocatable" reasons (rather than free-form messages) makes a run's behaviour traceable back to the recipe that authored it.

## Why this overall shape

- **Branch, no commit** — the branch isolates the experiment from the developer's main branch. The absence of a commit preserves the human checkpoint that catches wrong transformations. An autofix that commits without review can silently merge a broken rewrite.
- **No push, no PR** — remote state is entirely developer-owned. The skill never touches it.
- **Explicit `.autofix/last-run.json` log** (self-ignored via `.autofix/.gitignore`) — makes a failed or partial run recoverable and auditable without inferring state from git, and never pollutes the developer's commits.
