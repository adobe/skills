# Site-scale delivery — sample, class triage, tail, one confirmation sweep

## When to read what

The fix loop that follows Phase E's structural verify — "does the DELIVERED site
match its source at every page?" (Phase C's wave driver is `waves.md`). It sits **after** deploy's per-page reconcile
and the per-page published-origin gate (`replica`
`reference/source-fidelity-gate.md` § The published-origin gate), which stay
authoritative. A read-only sweep with no fixing is the `qa` skill; delivery
mechanics: `reference/delivery-gates.md` § Batched delivery at scale.

## Wave driver

Phase C's stage runner is `scripts/wave.mjs`; its contract (stage table, park
reasons and `next`, `--unpark`, hash re-gate, D1/D16 order, no-verdict, state,
exit map) is `waves.md`. The fix loop below consumes its outputs: the deploy
ledger, `waves/<wave>.report.md` and `wave.mjs regate-list`.

## The fix loop

1. **Reference once.** Capture the live side once per page and width into the
   gates dir and reuse it for every round (`gate.sh` keeps `live.png` when
   present; `anchor.mjs --cache`, `chrome-parity.mjs --live-cache`). A live
   capture is re-taken only when the source itself changed. One browser
   instrument at a time against the live host.
2. **Template sample.** Gate the `node skills/rollout/scripts/plan.mjs
   --sample 3` set per template (printed in delivery order), representative
   first — the representative is the template's **archetype** (the page the
   prototype phase gated; `inventory.mjs` groups siblings under it). Triage
   **class-complete per page**: list every large delta on the page (band table
   + anchor probe), not the first divergence, and name each delta's class (a
   block's CSS, a section style, a chrome state, an importer rule,
   page-specific content).
3. **Fix once per class, re-gate only the mapped pages.** One fix per class,
   then `node skills/rollout/scripts/wave.mjs regate-list --since <ref>` lists
   the pages the change maps to (`slug<TAB>path<TAB>reason`): `blocks/<name>/**`
   → the block's `usedByPages`; `styles/`, `scripts/`, `head.html`, chrome and
   fragments → every page (`site-wide`); `content/<path>.html` → that page; a
   file no rule maps → every page (`unmapped→all`). Fail-open by contract: a
   wrong mapping costs time, never a skipped defect. `--files <list>` instead
   of a git range; `--all` forces the full list; `--json` adds the ledger's
   `bodyHash`/`branch` per page. Never re-gate the whole site for a class fix.
4. **Tail.** After at most **3** class rounds the remainder is page-specific:
   class-level fixing on the residual tail leaves most pages unchanged and
   regresses some. Switch to a one-page loop (gate → fix → re-gate) on the
   priority pages the owner names; every other residual is ledgered per
   `source-fidelity-gate.md` § Residual logging format with an owner item.
   Do not start a fourth class round.
5. **One unattended confirmation sweep.** Gate every delivered page once,
   against **preview**; publish follows the pass (the D1 default). The sweep is
   full by contract — `regate-list` narrows class rounds, never this step.
   Output: the residual ledger, the allowlist of accepted residuals, and the
   owner-item list — nothing else re-runs.
6. **Report.** The Phase H report carries the sweep's ledger and allowlist
   next to the delivery ledger and the wave reports; class rounds used and
   pages in the tail are the two numbers that tell the reader how converged
   the site is.

## Ops rules while the loop runs

- A CSS-only fix batch never triggers a content re-drive; content re-imports
  and CSS purges are separate batches with separate ledgers.
- No CSS purge or publish while a sampled gate is capturing — a capture that
  straddles a publish measures two sites.
- One browser instrument while a deploy batch runs (the master skill's wait
  discipline applies to both).
- The confirmation sweep is background work with a per-page ledger; check it
  on the wait discipline, never with a long fixed sleep.
