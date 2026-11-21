# Fast first page — one page with no fixture, to a measured preview, and the run ends there

A speed profile for the demo branch. It changes HOW one page is taken through Phases 1–5 and how much
of the site the run covers — never what is measured or what may ship: the content-preservation rules,
the empty-register rule and the gate's instruments are unchanged.

## Scope: exactly one page, whatever the run asked for

| Run (`stardust/.labs/run.json` `scope`) | The page | The run |
|---|---|---|
| `mode: pages`, one URL, no fixture (`fixture-replay.mjs` printed `REPLAY-NO-MATCH`) | that URL | that page |
| `mode: pages`, several URLs, no fixture | the first URL | that page only |
| `mode: site` (full site — aem.new sends these), no fixture | the submitted URL's page when it has a path, else the home page (`scope.sourceUrl`) | that page only |

**Before Phase 1, scope the run to that page** — the runner's own rule is that pages not in the site plan
are out of scope for every phase:

1. Rewrite `stardust/.labs/site-plan.json` in its existing shape with ONE page: `pages: [{ "url": <the page>,
   "slug": <its slug>, "score": 10, "selected": true }]`, `discovery.total: 1`, `discovery.note: "demo
   branch fast-first-page: one page"` (keep `version`, `mode`, `sourceUrl`, `pageCap`); write the same URL
   alone to `stardust/.labs/site-plan.pages`. When the runner asked you to discover pages, do not
   discover: this rewrite is the plan.
2. Take the bounded entry: `stardust:extract <the page> --single --dynamics` (never `--prep`, never
   `--pages` with more than this page, no first-page-first tracks), Phase 2's bounded promotion branch.
3. Record the decision once in `stardust/journal.md`: "Demo branch: the run is scoped to one page (<url>);
   the rest of the site is out of scope."

Every later phase (migrate, rollout A–I, the done-check) then covers this one page.

## The profile

1. **Gate width 1440 only**, overriding `run.json` `breakpoints`; record it in the journal.
2. **Pass bar:** unaligned pixel ≤ 10 % and |height delta| ≤ 8 px. Offsets and the aligned % are
   reported, not gating (the aligner reports texture-matching steps on photographic heroes).
3. **Rounds:** at most 2 local rounds, at most 2 published fix rounds. A fix that regresses is reverted;
   one confirmation round after a revert is allowed (`rounds.mjs decide … --decision extend`, reason
   "revert of a regressing fix"); the best measured round is the result. Residuals go to the progress
   ledger, never a third loop.
4. **Measure before each fix:** `measure.mjs <live> --against <build> --selectors …` on the boxes the band
   breakdown names; never fix from an offset's sign alone.
5. **Skip:** motion-observe / interaction parity, the prototype table (`gate-all --stage prototype`), the
   header-contract check, audit, cap-probe beyond the 1440 row, martech (unless the runner's add-on asks
   for it — then after the first preview, with every contract part disabled). Behaviours the capture
   shows still ship (carousels autoplay as observed, no timing investigation).
6. **One delivery unit:** the main agent deploys foundation + the page's blocks + its DA documents (page,
   nav, footer) itself, in one unit — no subagents, no foundation freeze before the first preview. The
   first preview is the unit's first milestone; publish follows the run's publish decision.
7. **Code-live polling:** after every push poll the changed block file with `curl -s --compressed`
   ≤ 5 s apart until served (force `POST https://admin.hlx.page/code/<org>/<site>/main/*` once after
   ~60 s); never a fixed sleep.
8. **Gate speed flags:** every `gate-all.mjs` call adds `--parallel-probes` (content, clip and unit probes
   alongside the captures; same criteria).
9. **Rollout D–I for one page are records, not projects:** D-site (root resolves), D2-dynamic (interim
   tiers as triaged), E-full-site (`verify.mjs --all`), E2-link-audit (off-page links stay absolute to the
   source), F-optimize (`optimize.mjs --all`), G/H/I (`dashboard.mjs`) — minutes, not a phase each.
10. **Timing:** append to `stardust/timing.md` (`| event | time (UTC) | result |`): `fast-page-start`,
   `prototype-first-served`, `prototype-round-N` (pixel %, aligned %, height delta, PASS/FAIL),
   `deploy-start`, `code-live` (per push), `first-preview`, `published-round-N`, `done`.

## Then

The runner's done-check as usual; the handoff end line once it is complete. Nothing else runs: the
run's site is this one page.
