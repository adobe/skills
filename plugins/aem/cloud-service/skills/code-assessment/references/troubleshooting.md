# Troubleshooting

Decision tree for common failure paths. Execution steps live in [`runbook.md`](runbook.md).

## "Baseline compile failed"

Recorded in the report as `compile.baseline=fail` — the run **continues** to plan/report and can still apply after an explicit `yes` that acknowledges baseline failure. The skill does not fix unrelated pre-existing errors. If verification fails after apply, rollback still applies.

## "Verification compile failed"

Edits reverted per `edit_mode` (git restore + branch delete, or in-place path list for manual revert). See `.autofix/last-run.json`.

Common causes: breaking API after a dependency upgrade, transitive conflicts, a wrong user-supplied target version. The skill does not auto-retry with lower versions.

## "Git working tree not clean" (git mode only)

**Does not block the run.** The plan/summary warns that WIP and autofix edits may mix; rollback via `git restore` only affects paths the skill changed. Stash or commit first only if the user wants an isolated review.

## "Not a git repository" / in-place run

Expected when `edit_mode=in_place`. No `autofix/*` branch; review modified paths in the IDE. Revert manually if verify failed.

## "Edit skipped"

| Reason prefix | Meaning | Recovery |
|---|---|---|
| `literal-not-found: …` | Pom dependency triple not present in the file | Re-scan / re-inspect the pom |
| `property-missing: …` / `property-value-mismatch: …` | Property shape changed or value differs | Re-inspect the pom |
| `property-not-referenced: …` | Property unused by the target dependency | Likely a false candidate |
| `ambiguous-locator: …` | Non-unique pom match | Fix manually |
| `inject-ambiguous-field: …` | Whole file skipped per policy | See `../inject-in-sling-model/recipe.md` |
| `discovery-no-match: …` | Discover mode found no antipattern hits | Widen scope or name the files explicitly |

## Re-running

Runs are independent. A fixed issue won't be re-found on the next scan, so re-running after a successful fix finds fewer (or no) candidates.

## Known limitations

- **outdated-dependencies** — literal `<version>` + same-pom `${property}` only; target versions are **user-supplied**.
- **inject-in-sling-model** — `@Inject` field injection in `@Model` only; constructor/setter `@Inject` and Felix SCR are not supported.
- **Compile only** — no runtime Sling adaptation check; deploy to a dev instance before merge.
- **No remote git** — no push/PR; in-place mode has no automatic file backup.
