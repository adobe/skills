# Fixture provenance & known limitations

`fixture/` is a verbatim copy of `../direct-from-phrase/fixture/` — the
post-extract project (5 pages `extracted`, signal-strong brand surface,
one journal entry, extract-only `status.jsonl`). Shape provenance and the
deliberate design choices are documented in
`../direct-from-phrase/fixture-notes.md`; nothing was changed here. If a
shape in that fixture is wrong, fix it there and re-copy.

This file lives outside `fixture/` on purpose: everything under
`fixture/` is copied into the eval workspace and is visible to the agent
under test.

## Why not the shared post-migrate fixture

`_shared/fixture-post-migrate/` is a keep-design project after `migrate`
(`flow: replica`, pages `migrated`). `direct` needs `extracted` pages and
no resolved direction to run its full phase, so that tree cannot exercise
a direct-phase checkpoint. The shared fixture is merged into this branch
for the evals that start from a migrated project; this eval does not read
it.

## What this eval adds on top of `direct-from-phrase`

Nothing in the fixture. The difference is the prompt (a phrase that
moves only type scale and tone, so Mode A fires and the two default
questions are the only ones) and the rubric, which grades the phase
close — checkpoint block, journal `Next:`, `status.jsonl` `next`, state
transition — rather than the reasoning quality `direct-from-phrase` pins.

## Known limitations

- Run 2 (re-run on the same workspace) is described in `task.md` but
  not executed: the runner runs the first prompt only. The
  `checkpoint_rerun_skip` criterion therefore grades the *statement*
  about a re-run in run 1's report, not the re-run.
- `checkpoint_verified`, `checkpoint_rerun_skip` and `status_end_line_next`
  pin `run-status.md` § Phase close, which entered the skill text in 0.24.0;
  the 0.23.0 baseline results fail them by design. Do not read those
  failures as agent defects.
- Inherited from the copied fixture: 1×1-pixel PNGs with realistic
  claimed dimensions, fabricated hash strings, no `brand-review.html`.
  `direct` opens none of these.
