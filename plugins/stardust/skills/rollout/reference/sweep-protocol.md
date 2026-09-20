# Site-scale fix loop — sample, class triage, tail, one confirmation sweep

## When to read what

Read this after Phase E's structural verify passes and the question becomes
"does the DELIVERED site match its source at every page?" — the fix loop at site
scale. It sits **after** deploy's per-page reconcile (Step 10, one page against
its prototype) and the per-page published-origin gate (`replica`
`reference/source-fidelity-gate.md` § The published-origin gate), which stay
authoritative; it does not replace them. A read-only sweep with no fixing is
the `qa` skill. Per-page gate mechanics: the replica gate file; the page-gate
driver and the coverage regime: `reference/publish-gate.md` § Gate 8; delivery
mechanics: `reference/delivery-gates.md` § Batched delivery at scale.

Running the full gate on every page after every fix is the failure mode this
protocol replaces: a whole-site gate round is hours of wall time per pass, and
most of what it re-measures did not change.

## The protocol

1. **Reference once.** Capture the live side once per page and width into the
   gates dir and reuse it for every round (`gate.sh` keeps `live.png` when
   present; `anchor.mjs --cache`, `chrome-parity.mjs --live-cache`). A live
   capture is re-taken only when the source itself changed. One browser
   instrument at a time against the live host.
2. **Template sample.** Gate a **seeded random** sample per template —
   `node skills/rollout/scripts/gate-publish.mjs --sample <n ≥ 10> --seed <run
   seed> --exclude <fix-loop slugs> --origin <preview>` (archetypes always in;
   never the delivery-order head, never a page the fix loop touched; seed and
   draw land in `gate-report.json`; `plan.mjs --sample` is the authoring-order
   listing, not this sample). Triage **class-complete per page**: list every large delta on the
   page (band table + anchor probe), not the first divergence, and name each
   delta's class (a block's CSS, a section style, a chrome state, an importer
   rule, page-specific content).
3. **Fix once per class, re-gate only the mapped pages.** One fix per class,
   then re-gate the pages that carry it: blocks or styles touched → pages via
   `coverage/blocks.json` `usedByPages` and each page's `_meta.json` `blocks`
   (by hand or `jq` today; a mapped re-gate list script replaces the manual
   step when it lands). Never re-gate the whole site for a class fix.
4. **Tail.** After at most **3** class rounds the remainder is page-specific:
   class-level fixing on the residual tail leaves most pages unchanged and
   regresses some. Switch to a one-page loop (gate → fix → re-gate) on the
   priority pages the owner names; every other residual is ledgered per
   `source-fidelity-gate.md` § Residual logging format with an owner item.
   Do not start a fourth class round.
5. **One unattended confirmation sweep.** ≤ 150 delivered pages: gate every
   page once against **preview** — `gate-publish.mjs --all-delivered --origin
   <preview>`; > 150: the seeded sample expands n → 4n → all as class rounds
   close (`publish-gate.md` § Coverage regime — every unsampled page stays
   `ungated`, held). Publish follows the pass (the D1 default): `deploy-batch
   … --publish` over the PASS rows. Once the delivery ledger carries a content
   hash, sweep changed pages only; until then the sweep is full. Output: the
   residual ledger, the allowlist of accepted residuals, and the owner-item
   list — nothing else re-runs.
6. **Report.** The Phase H report carries the sweep's ledger and allowlist
   next to the delivery ledger; class rounds used and pages in the tail are
   the two numbers that tell the reader how converged the site is.

## Ops rules while the loop runs

- A CSS-only fix batch never triggers a content re-drive; content re-imports
  and CSS purges are separate batches with separate ledgers.
- No CSS purge or publish while a sampled gate is capturing — a capture that
  straddles a publish measures two sites.
- One browser instrument while a deploy batch runs (the master skill's wait
  discipline applies to both).
- The confirmation sweep is background work with a per-page ledger; check it
  on the wait discipline, never with a long fixed sleep.
