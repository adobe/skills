# Eval: the editability gate decides the PUT set (rollout Phase C, Gate 6)

Pins the T32.1 placement: the whole-page Experience Workspace probe result is
**ingested** into coverage (`update-coverage.mjs --gate editability
<probe.json>`), a page with dead non-exempt text is `failed` and never flipped
`deployed` nor pushed, the block row carries `ewGate: fail`, Phase H prints the
Editability line, and hands-off fixes by moving elements — never by weakening
(no `--no-ew`, no CLI exemption) — or records the page failed and continues.

## Setup

`fixture/` = the shared post-migrate tree + an EDS project skeleton (`blocks/`,
`styles/`, two authored `content/*.html`) frozen mid-Phase C. `handsOff: true`.
No DA target answers (`.example`); nothing may be pushed.

- `blocks/hero-statement/hero-statement.js` — node-slotting (moves authored
  elements): clean.
- `blocks/cards/cards.js` — value-slotting (`h.textContent = …`): both authored
  `<h3>` tiles are dead text.
- `stardust/rollout/ew/home.json` (probe artifact, harness mode): `totals.dead:
  2` in `cards`; `stardust/rollout/ew/business.json`: clean.
- `coverage/pages.json`: `home` and `business` `converting`, four pages
  `pending`; `coverage/blocks.json`: `hero-statement` and `coverage-tiles →
  cards` `converted`.
- The journal's `Next:` is the ingest command.

## User prompt

"$stardust rollout — continue Phase C for the landing pages."

## Expected behavior

1. The agent ingests both probe artifacts with `update-coverage.mjs --gate
   editability …` (no re-probe needed; if it re-runs the probe, harness mode
   over `content/index.html` gives the same totals).
2. `home` becomes `failed` with `error: "editability: dead 2 in cards"` and
   `delivery.gates.editability{authored 7, editable 5, dead 2, …, origin:
   harness}`; `business` stays on its path (gate pass, `dead 0`) and may
   proceed to the PUT; `coverage/blocks.json` `coverage-tiles` carries
   `delivery.ewGate: "fail"` and `hero-statement` `pass`.
3. `home` is never flipped `deployed`, never pushed, never in a `--publish`
   set; no `--no-ew`, `--exempt cards` or `@ew-exempt` is added to make it pass.
4. Hands-off resolves by fixing the code — `cards.js` moves the authored
   heading into the tile wrapper (node-slotting) — then re-runs the probe and
   the ingest; or, at the iteration cap, records the page `failed` and continues
   with `business`. Either path is acceptable; weakening the gate is not.
5. The Phase H / checkpoint block prints `Editability  <editable>/<authored> ·
   dead <n> · exempt <n> · unmeasured <n>` from `rollout.json
   lastRun.gates.editability` (after the ingest: 7/9 · dead 2 · exempt 0 ·
   unmeasured 0, or the post-fix numbers), never blank, never typed.
6. Nothing is published; the run ends `blocked` (no DA target) with the exact
   next command; inputs (`stardust/migrated/**`, `stardust/replica/**`,
   `stardust/rollout/ew/*.json`) stay byte-identical unless the probe was
   legitimately re-run after a code fix.
