# Fast first page — the earliest measured preview of a page with no fixture

A speed profile, not a new flow. It changes HOW one page is taken through Phases 1–5, never what is
measured or what may ship: the content-preservation rules, the empty-register rule and the gate's
instruments are unchanged.

## When it applies

| Run (`stardust/.labs/run.json` `scope`) | Fast page | The rest |
|---|---|---|
| `mode: pages`, one URL, no fixture (`fixture-replay.mjs` printed `REPLAY-NO-MATCH`) | that page | — (the run is that page) |
| `mode: site` (full site, e.g. an aem.new request), no fixture | Track A of first page first (`first-page-first.md`): the submitted URL's page, else the home page | Track B, RECONCILE and every later phase under the normal contract, unchanged |
| `mode: pages`, several URLs | the first URL | the others under the normal contract |

The fast page is the run's first priority: Track A starts before Track B's crawl is complete and Track B
never blocks it.

## The profile (fast page only)

1. **Gate width 1440 only** for the fast page, overriding `run.json` `breakpoints` for this page; record
   it in `stardust/journal.md`. In a full-site run the 360 pass of this page happens with the rest of the
   site after RECONCILE (normal contract).
2. **Pass bar:** unaligned pixel ≤ 10 % and |height delta| ≤ 8 px. Offsets and the aligned % are
   reported, not gating (the aligner reports texture-matching steps on photographic heroes).
3. **Rounds:** at most 2 local rounds, at most 2 published fix rounds. A fix that regresses is reverted;
   one confirmation round after a revert is allowed (`rounds.mjs decide … --decision extend`, reason
   "revert of a regressing fix"); the best measured round is the result. Residuals go to the progress
   ledger, never a third loop.
4. **Measure before each fix:** `measure.mjs <live> --against <build> --selectors …` on the boxes the band
   breakdown names; never fix from an offset's sign alone.
5. **Skip for the fast page:** motion-observe / interaction parity, the prototype table
   (`gate-all --stage prototype`), the header-contract done-check, audit, martech (unless the runner's
   add-on asks for it — then after the first preview). Behaviours the capture shows still ship
   (carousels autoplay as observed, no timing investigation).
6. **One delivery unit:** the main agent deploys foundation + the page's blocks + its DA documents
   (page, nav, footer) itself, in one unit — no foundation subagent and no freeze before the first
   preview. The first preview is the unit's first milestone; publish follows the run's publish decision.
   In a full-site run, rollout's C0 later freezes this foundation, it never rebuilds it.
7. **Code-live polling:** after every push poll the changed block file with `curl -s --compressed`
   ≤ 5 s apart until served (force `POST https://admin.hlx.page/code/<org>/<site>/main/*` once after
   ~60 s); never a fixed sleep.
8. **Gate speed flags:** every `gate-all.mjs` call for the fast page adds `--parallel-probes` (content,
   clip and unit probes alongside the captures; same criteria).
9. **Timing:** append to `stardust/timing.md` (`| event | time (UTC) | result |`): `fast-page-start`,
   `prototype-first-served`, `prototype-round-N` (pixel %, aligned %, height delta, PASS/FAIL),
   `deploy-start`, `code-live` (per push), `first-preview`, `published-round-N`, `first-page-live`.

## Then

Single-page run: rollout's remaining phases and the runner's done-check as usual. Full-site run: Track A
ends at `first-page-live`; RECONCILE and the rest of the site follow `first-page-first.md` § RECONCILE and
§ Then, at the normal contract (both breakpoints, full rounds, motion, header contract).
