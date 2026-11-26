# Replica: one more page of a delivered site

## Setup

A stardust `replica` run (same-design migration) of a small store site that
delivered one page, its home page, and ended. The site is served on this
machine: `http://localhost:8780/`. It is the live site of this task: treat it
as any remote origin.

- `stardust/state.json`: `flow: replica`, hands-off, one page `index` in
  status `migrated`.
- `stardust/status.jsonl`: the run's ledger; its last replica line is
  `handoff end`.
- `stardust/current/`: the capture of the home page and the descriptive spec
  (`PRODUCT.md`, `DESIGN.md`, `DESIGN.json`), promoted to the project root.
- `stardust/replica/progress.json`, `stardust/migrate/progress.json`,
  `stardust/rollout/progress.json`: the gated archetype and the delivery units,
  all `done`. `stardust/rollout/foundation-freeze.json`: the delivered
  foundation (`styles/`, `head.html`, `blocks/header/`).
- `stardust/scripts/<skill>/`: the plugin's scripts, copied as the replica
  skill's Setup has it. No `node_modules`: Playwright and Chromium are not
  installed.
- A git repository with one commit, the delivered state.
- No delivery target is reachable from this machine: no DA token, no AEM
  host.

## User prompt

"$stardust replica http://localhost:8780/ --extend-next 1 — the owner wants the next page of the site delivered on the same project. There is no DA access here: open the pass and take it through the extract and the decision of which phases the new page needs, then stop before any recreation, migration or deploy, and tell me what the pass does next. Hands-off: do not ask me questions, decide and record."
