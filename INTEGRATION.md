# stardust/local-integration-run17 — LOCAL integration image for run 17 (never pushed)

Base: `stardust/local-integration-run16` @ 2fe5cbbf (the run-16 image's stardust, 0.36.0+r16; carries the LOCAL 20 KiB
scripts-index cap and the run-16 #146–#150 renumbering). Worktree:
`adobe-skills/.worktrees/stardust-local-integration-run17`. Merged with `git merge --no-ff`, each branch at its
verified head, in the order the verifications landed; conflicts settled inside (or just after) the merge commit. Every
tip was re-checked at the end: unchanged and contained in HEAD. Lints and tests run from a scratch copy under
`/Users/kpauls/.of1-labs/tools/scratch-i5/` (rsync of the worktree minus `.git`/`node_modules`, `node_modules`
symlinked to `.worktrees/gate-trust/node_modules`); the integration worktree never held a `node_modules`.

**Batch 1 (this report):** five branches. The branch stays open — `stardust/r16-export-fresh` is still to come.

| commit | what |
|--------|------|
| 18e4fbe1 | Merge `stardust/r16-edit-instruments` @ 37f63dca (S28, 0.36.x, #NNN → #151 local) |
| feaef1be | Merge `stardust/r16-wait-and-waves` @ 7d319b81 (S29, 0.36.x, #NNN → #152 local) |
| c0a91a17 | Merge `stardust/r16-proto-to-doc` @ b7ee3c21 (S30, 0.36.x, #NNN → #153 local) |
| 8dc91d7c | LOCAL: scripts-index — raise the cap (maintainer question) |
| 4d0978c2 | Merge `stardust/r16-census-and-clock` @ 0c92fa19 (S31, 0.36.x, #NNN → #154 local) |
| b6b20098 | LOCAL: extract SKILL + scripts-index name style-census `--page-timeout` and `--resume` |
| 2620ef32 | LOCAL: validate workflow runs the inline-writes lint beside the other stardust lints |
| d30b636f | LOCAL: migrate SKILL — a pre-existing "skipped skipped." typo on the extended line |
| 2ffe08c5 | LOCAL: proto-to-doc removes its temp file when the write fails |
| fd49614f | LOCAL: renumber the batch-1 branches (#151–#154) and add the +r17 note to 0.36.0 |
| 76ca7c27 | Merge `stardust/r16-gates-and-jobs` @ 9151ef8c (S30b, 0.36.x, #NNN → #155 local) |
| e366e172 | LOCAL: rollout — restore four sentences the gates-and-jobs condensing dropped; delivery-gates names exit 77 |
| 0f11e1c5 | LOCAL: renumber gates-and-jobs (#155) and refresh the +r17 note |

Version label: `plugin.json` and the stardust entry in `marketplace.json` stay **0.36.0** (no branch bumped them; the
operator's build labels it `0.36.0+local`). CHANGELOG: the five branch entries keep their own headings at the top,
each labelled with its branch (`## 0.36.x (stardust/r16-<branch>) — … (#n)`), newest merge first (gates #155 on top,
down to edit-instruments #151); the 0.36.0 section gains a `+r17` paragraph listing the merged branches in order with
their local numbers, the local-only commits, and the one branch not yet in the image.

scripts-index: the four-branch union of new/expanded rows (edit-instruments, wait-and-waves, proto-to-doc, and the
census `--page-timeout`/`--resume` flags) exceeded the historic 20 KiB (20480-byte) cap. Per the rule the NEW rows
were trimmed first — `replace` (`[--files-from]`, "nothing written"), `progress` (`[--kind] [--pages]`), `run-bg`
("bounded wait", "tool timeout > wait") lost words the full `--help` still carries; no other row was touched. The
residual overflow was covered by raising `MAX_BYTES` to `20 * 1024 + 96` (20576) in a separate commit (8dc91d7c).
The index is **20553 bytes** (23 under the raised cap), 132 scripts / 132 rows. gates-and-jobs added no index rows.

**Maintainer question (scripts-index cap):** keep the terse rows at 20576, or drop/relocate a row upstream once these
branches land so the historic 20 KiB cap can return.

## Improvement numbers — renumbering at merge (fd49614f, 0f11e1c5)

Free before: #151+ (run-16 used #146–#150). In merge order: `r16-edit-instruments` → **#151**, `r16-wait-and-waves`
→ **#152**, `r16-proto-to-doc` → **#153**, `r16-census-and-clock` → **#154**, `r16-gates-and-jobs` → **#155**. Only
the CHANGELOG headings carried a provisional `#NNN` (census and gates arrived pre-numbered #151; both renumbered).
No skill doc cited a provisional number.

## Conflicts and resolutions

The repo's merge driver shows diff3 markers (base + ours + theirs). Every merge was followed by `lint:stardust`, the
`--help` sweep and the owning suites before (or just after) its commit.

### M1 S28 edit-instruments (18e4fbe1) — auto-merged, 16 files
- No conflict (first merge onto the run-16 base; it chained `evals/lint/inline-writes.mjs` into `lint:stardust` via
  root `package.json`). LOCAL follow-ups (its verifier's open items the lead flagged): 2620ef32 adds the
  inline-writes step to `.github/workflows/validate.yml` between site-names and the advisory prose-delta;
  d30b636f fixes the pre-existing "skipped skipped." typo on the migrate-SKILL line the branch extended.

### M2 S29 wait-and-waves (feaef1be) — 2 conflicts
- CHANGELOG: both add a 0.36.x heading — kept both, newest merge first.
- scripts-index: the `progress.mjs` row — ours (edit) added `replace.mjs` after an unchanged progress row, theirs
  (wait) rewrote the progress row (`--waves`, `wait`, exit 0/76/77). Kept wait's progress row and edit's replace row.
- `replica/SKILL.md`, `rollout/SKILL.md` auto-merged (disjoint paragraphs).

### M3 S30 proto-to-doc (c0a91a17) — 1 conflict + the cap
- CHANGELOG: new 0.36.x heading kept on top (newest merge first).
- `migrate/SKILL.md`, `replica/reference/handoff-contract.md` (proto's § Encoded siblings beside wait's § Fan-out),
  `scripts-index.md` (proto-to-doc row + `--split`) all auto-merged. The four-branch scripts-index union went over the
  cap here → the new rows were trimmed inside the merge commit, the residual covered by the cap raise (8dc91d7c).

### M4 S31 census-and-clock (4d0978c2) — 1 conflict
- CHANGELOG: new 0.36.x heading kept on top.
- `handoff-contract.md` auto-merged: census's § Unit briefs (the absolute `deadline:` clock and the resumable-unit
  rule) sits before wait's § Fan-out discipline and resolves wait-and-waves' forward reference to "§ Unit briefs"
  (previously a dangling reference). LOCAL b6b20098: the extract SKILL census paragraph and the style-census
  scripts-index row name `--page-timeout` and `--resume` (the branch left them under `--help` only).

### M5 S30b gates-and-jobs (76ca7c27) — 3 conflicts (run-bg.mjs 10 blocks, run-bg.test.mjs 4 blocks, CHANGELOG)
- Stacks on wait-and-waves' pre-addenda head c68a0856, so only `run-bg.mjs` and `run-bg.test.mjs` (both touched by the
  wait addendum and by gates) conflicted; handoff-contract, rollout/SKILL, delivery-gates, gate-all, unit-commit,
  chrome-explore all auto-merged.
- `run-bg.mjs` (10 blocks): the server/stall/stop machinery (theirs — `stop()`, `pickNames` servers/skipped,
  `stallNotices`, `SERVERS_HEAD`, `startKind`, `mayLaunch`, `isServer`, `serverLine`) kept beside the wake/exit-77 and
  `settled()` machinery (ours). `report()` carries `skipped`/`servers`/`serversOf`/`stalls` AND `wake`; `pickNames`
  derives `states` through `settled()`; `wait()` takes both `stallMin` and `wakeFile`; the final `report(...)` passes
  `skipped`, `stalls` and `wake: woken`; `case 'wait'` keeps the woken return (`r.woken != null ? WAKE_EXIT :
  STILL_RUNNING_EXIT`). All referenced symbols resolve to a single definition; `node --check` clean.
- `run-bg.test.mjs` (4 blocks): fs import union (`appendFileSync` + `utimesSync`); run-bg import union; the slot-env
  regex took theirs; the appended wake-file test block (ours) and the servers/stop/stall test block (theirs) both kept.
- CHANGELOG: gates heading kept on top (#155).
- LOCAL e366e172: restored four sentences the gates condensing dropped from rollout/SKILL.md § C-deliver and not
  covered by the new text (the silent-and-sitewide wrong-runtime-assumption warning; the favicon first-pass note;
  the encode-attempt "not-attempted is refused without a --reason, and `migrate.mjs plan` lists the maps still due"
  clause; the `progress.mjs unit …` pointer in Cluster sub-units); delivery-gates' fix-round brief now names exit 77.
- **Not done (cap-gated, optional):** the verifier's follow-up to name gates' new flags (`--kind server`, `--stall`,
  `--also`, `--changed-only`, `--fresh`/`--build-only`) in the scripts-index rows — the index has only 23 bytes free
  under the raised cap, and the flags stay documented in each script's `--help`. Left for the maintainer.

## Verification (Node v24; lints/tests from the scratch copy; the integration worktree never held node_modules)

- After every merge: `lint:stardust` green from the scratch copy (recorded per merge; final tail below).
- Final `lint:stardust` at HEAD 0f11e1c5 → exit 0:
  - harness-neutral 110 files clean · script-paths 110 files, 383 references resolve · scripts-index 132/132,
    **20553 bytes** (cap 20576) · script-help 117 answer `--help`, 15 skipped (libraries), 0 failed · site-names 638
    files, no site named · inline-writes 106 files clean. (site-names walks the FS and prose-delta is advisory in the
    scratch copy — no `.git` there; both exit 0.)
- `--help` sweep, every `plugins/stardust/skills/*/scripts/*.mjs` in an empty temp cwd: **130/130** exit 0, nothing
  written.
- `node --test` per skill (TEST TAILS — filled at completion):
  - TBD
- Forbidden substrings over the added lines of `git diff 2fe5cbbf..HEAD -- plugins/stardust .claude-plugin`
  (path column stripped, case-insensitive, the full list): **0**. In every integration commit message of the range
  (trailers aside): **0**. Conflict markers in the tree: **0**. Duplicate ≥80-char paragraphs within a changed `.md`:
  none.
- Every merged tip re-checked at HEAD: unchanged and contained — edit-instruments 37f63dca, wait-and-waves 7d319b81,
  proto-to-doc b7ee3c21, census-and-clock 0c92fa19, gates-and-jobs 9151ef8c.
- `git status --short` shows only the untracked `INTEGRATION.md`.

## Open items (none blocks the image; for the maintainer or the next session)

1. **scripts-index cap:** raised to `20 * 1024 + 96` (20576) for the batch-1 union; 20553 used. Maintainer question —
   keep the terse rows at the higher cap or relocate/drop a row upstream to restore the 20 KiB cap. (8dc91d7c)
2. **scripts-index flags (gates):** `--kind server`, `--stall`, `--also`, `--changed-only`, `--fresh`/`--build-only`
   are documented in `--help` but not named in the run-bg / unit-commit / gate-all / chrome-explore index rows — cap
   did not allow it after the union; add them if the cap question is resolved.
3. **validate.yml inline-writes:** added (2620ef32); CI runs it now. Upstream, it belongs with whichever of
   edit-instruments or a workflow change merges — it is outside the plugin tree, so not in the forbidden grep's scope.
4. **Carried branch follow-ups (verifier open items, for the owners):** edit-instruments — add `replace.mjs`/
   `json-edit.mjs` to replica SKILL Setup step 4's and handoff-contract's master-copy lists (not actioned here; a
   missing copy makes json-edit refuse with a clear line). wait-and-waves — stale pointers in handoff-contract:77/§5,
   source-fidelity-gate:530, deploy/SKILL:617; `browser-lock.mjs` still defaults to 3 slots for hand-run acquirers.
   proto-to-doc — IF-TIME `measure.mjs --summary` and `slot-map.mjs widen|accept` deferred. census — IF-TIME
   `style-census --summary` (needs a spacing-scale aggregate). gates-and-jobs — see item 2.
5. **Upstream ownership of the LOCAL code commits:** proto-to-doc's temp-file cleanup (2ffe08c5) belongs with
   proto-to-doc; the run-bg union resolution belongs with whichever of wait-and-waves × gates-and-jobs merges second;
   the migrate typo and the restored rollout sentences are doc-alignment.
6. Carried from run 16 / run 15: those images' open items (unchanged) still stand.

HEAD 0f11e1c5 — batch 1 (5 merges, 8 LOCAL) on stardust/local-integration-run16 @ 2fe5cbbf. Branch open for
`stardust/r16-export-fresh`.
