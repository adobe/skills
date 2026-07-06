# Source-fidelity gate (the measured heart of replica)

The gate proves an archetype matches the LIVE site — three instruments, per
breakpoint, with a hard iteration cap. It replaces the redesign pipeline's
craft gates entirely: an archetype ships because it measured true, never
because it looked right. Every fix in the loop comes off the instruments;
eyeballing is not an input.

Validated (UC1-E1, aesop.com home): 8.31% → 2.93% → 1.31% pixel diff across
exactly 3 iterations, 0 structural 🔴, height Δ 0 — and the two defects the
capture phase missed (span font fork, hero scrim) were both found only by
these instruments.

## The three probes

| Probe | Script | Catches | Blind to |
|---|---|---|---|
| Structural content + type | `../../diff/scripts/content-diff.mjs` (project copy) | dropped/mis-slotted headings·eyebrows·CTAs, invented/dropped copy, rendered-face font forks (width probe) | geometry |
| Visual heuristics | `../../diff/scripts/visual-diff.mjs` (project copy) | stretched images, dropped wraps, blank renders, surface/ground flips | "right text, wrong slot" |
| Pixel (replica-owned) | `../scripts/stitch-shot.mjs` + `../scripts/pixel-compare.mjs` | everything the other two abstract away: paint effects, scrims, exact geometry, image crops | semantics (a wrong-but-same-colored word) |

Run ALL three — they catch disjoint failure classes; any one alone gives a
false "looks fine".

## Per-breakpoint procedure

Breakpoints: **1440 AND 360** by default (`--breakpoints`). **Mobile is not
free**: UC1-E1's gate-passing 1440 prototype measured 24.2% / height Δ
−1572px at 360. Each breakpoint is its own full gate pass with its own
iteration budget. Gate 1440 first (the geometry lifted from desktop CSS),
then 360.

```bash
# Serve the prototype from its own dir so relative assets resolve
(cd stardust/prototypes && python3 -m http.server 8791 &)
PROTO="http://localhost:8791/<slug>-proposed.html"
LIVE="https://<site>/<path>"
W=1440   # then 360
GATE="stardust/replica/gates/<slug>-$W"

# 1. structural — --dismiss keeps consent + timed marketing modals out of the
#    inventory on both sides; add extra selectors for non-standard closers
node scripts/diff/content-diff.mjs "$LIVE" "$PROTO" --profile generic --width $W \
  --main "<content-root>" --dismiss | tee "$GATE/content-diff-iter<N>.txt"

# 2. visual heuristics — --main is a real flag here too (live sites often
#    have no <main>; without it both sides false-flag BLANK RENDER)
node scripts/diff/visual-diff.mjs "$LIVE" "$PROTO" --profile generic --width $W \
  --main "<content-root>" --dismiss --out "$GATE/vdiff" | tee "$GATE/visual-diff-iter<N>.txt"

# 3. pixel — stitched captures on BOTH sides (never fullPage:true)
node scripts/replica/stitch-shot.mjs "$LIVE"  "$GATE/live.png"  --width $W --settle
node scripts/replica/stitch-shot.mjs "$PROTO" "$GATE/proto.png" --width $W
node scripts/replica/pixel-compare.mjs "$GATE/live.png" "$GATE/proto.png" \
  --out "$GATE/diff-iter<N>.png" --threshold 10
```

On a geo-redirecting site add `--locale <tag>` to all three (a live side that
redirects to a different locale per run is a nondeterministic source); on a
bot-managed site that exits 3, escalate with `--headed` (§ Hardening rule 1).

The live capture is taken ONCE per breakpoint per full gate run and reused
across iterations — re-take it only if it is genuinely stale (site changed,
capture hardening changed). This is a bot-block control, not just a cost
note: content-diff + visual-diff each navigate the live URL per run, so a
full 3-iter, 2-breakpoint gate is already ≈12–18 live hits, and hard-CDN
sites (recorded: rimowa/Akamai) escalate to an IP block after a handful.
The prototype capture is re-taken every iteration.

## Pass bar (all four, per breakpoint)

1. **content-diff: 0 structural 🔴.** 🟡 (body/EXTRA) and 🟠 (font fork)
   confirmed intended — a substituted licensed font is a permanent justified
   🟠; record it once in the ledger.
2. **visual-diff: flags none or justified.** A live page's own quirks are
   justified when the prototype mirrors them (e.g. a 1×1 SEO h1 at x0, a
   carousel tile at a negative offset — both real UC1-E1 justifications).
3. **pixel diff ≤ 10% full-page** — AND no band left unexplained (§ Band
   breakdown). 10% is the ship bar, not the target; the validated run
   landed at 1.31%.
4. **height delta: |Δ| ≤ 8px** — pixel-compare's own warning threshold is
   the bar (it prints ⚠ above 8px), so a −9px result is unambiguously a
   residual, not a pass. A large delta invalidates the % — the overlap crop
   silently discards the tail, so a short prototype can score deceptively
   well. Fix heights before trusting anything else.

Applied inconsistency-register entries create expected deltas: cross-
reference the entry ID (`R-<nn>`) when justifying a flag over its zone
(`preserve-direction.md` § Gate interaction).

## Reading the band breakdown

The overall % hides WHERE drift starts. `pixel-compare.mjs` prints per-500px
bands (`--band` to change); read them top-down:

- **The first hot band (◄◄, >15%) is the actionable one.** It points at the
  section whose height or geometry is wrong at that y-range.
- **Every band below the first hot band is contaminated** by the vertical
  offset that section introduced — do not chase them yet.
- Fix the first hot band's section (usually a margin/padding/height value —
  re-lift it from the source CSS rather than nudging), re-capture the
  prototype, re-compare, repeat.
- A page with height Δ 0 and uniformly warm bands (no single hot band) has a
  global fault — wrong base font metric, wrong container width, a missing
  background — not a per-section one.

Section-level compare (crops) is the escalation when a band stays hot and
the cause isn't visible in `diff-iter<N>.png` — in the validated run it was
prepared and never needed, because re-authoring hit exact section heights.

## Iteration discipline

**Hard cap: 3 iterations per breakpoint.** Matching the validated run's
discipline — convergence happened within 3 with the recreation procedure
followed; more loops mean the inputs were wrong (values eyeballed instead of
lifted, capture unhardened), and the fix is upstream, not a fourth loop.

- Measure first (iteration 1 IS the map — do not pre-polish).
- Every fix cites the instrument line that demanded it.
- Re-run ALL probes after each fix round; a pixel fix can regress structure.
- After iteration 3: log residuals (§ Residual logging) and move on. A
  documented residual is a pass with an asterisk; an undocumented fourth
  loop is scope creep.
- **Hit minimization: ONE live navigation per instrument per breakpoint per
  full gate run.** The live stitch PNG is captured once and reused across
  iterations; only the prototype side re-captures. On hard-CDN sites
  (Akamai-class), take the live captures with `--headed` and treat further
  live hits as spent budget — the recorded failure mode (rimowa) was an
  IP-level block escalating within ~3–4 automated requests, after which
  iteration 2's numbers measure the block, not the site.
- **Media-density budget.** The ≤3-iteration convergence was validated on a
  typographic, low-image page (aesop.com). Image-dense commerce homes
  (recorded: carhartt ~130 imgs) spend iterations on media parity —
  populating grids, matching crops — before geometry work even starts.
  Budget accordingly: on a media-heavy page, image/media parity IS
  iteration 1's job; geometry starts at iteration 2.

## Hardening rules (false-measurement traps)

Each of these was hit live; skipping one silently corrupts the measurement
rather than erroring.

1. **Real-Chrome UA + the standard request headers on every capture and
   probe.** The default HeadlessChrome UA can receive a Cloudflare managed
   challenge, and the probe then **measures the challenge page as the
   source** (3 headings, "Performing security verification" — it diffs
   cleanly, wrongly). And the UA alone is NOT sufficient: field-proven
   (F-R1, redcross.org), a real-Chrome UA with Playwright's minimal default
   headers still got HTTP 403 from Akamai; adding the standard set every
   real Chrome sends (`Accept`, `Accept-Language`,
   `Upgrade-Insecure-Requests`, `sec-ch-ua*`) produced HTTP 200 — Akamai
   bot-manager fingerprints on the *absence* of those headers, not just the
   UA. All three instruments now send both by default via the shared
   `diff/scripts/live-session.mjs`; `--ua` overrides the UA string only.
   Sanity check when numbers shift inexplicably between runs: grep the
   content-diff inventory for challenge-page strings.
2. **`domcontentloaded`, never `networkidle`, on live targets.** Live sites
   with analytics beacons never reach networkidle — hard timeout. Built in:
   the diff scripts default `domcontentloaded` for non-localhost http(s)
   URLs (decided per side) and keep `networkidle` for local prototypes;
   `--wait-until` overrides. stitch-shot is always `domcontentloaded`.
3. **Symmetric `--main` scoping — and never `body`.** Live `<main>` often
   contains header nav + hidden mega-menu; unscoped, those diff as ~dozens
   of missing CTAs (UC1-E1 iteration 1: 41 of 50 reds were scoping
   artifacts). Scope BOTH sides with the same selector — have the prototype
   adopt the live content-root class so one `--main` value fits both. Both
   diff scripts take `--main` (visual-diff's is the upstreamed flag: on
   sites without a `<main>`, both sides otherwise false-flag BLANK RENDER
   while the main-scoped checks silently no-op). Two guardrails:
   - **`--main body` is NEVER a valid replica scope.** A too-broad root
     self-poisons the instrument regardless of symmetry: reproduced
     (fritzhansen), content-diff run live-vs-ITSELF with `--main body`
     produced **103 structural 🔴** and asymmetric node counts (461 vs 73)
     from analytics/inline-script text plus a nondeterministic
     cookie-settings panel pulled into the inventory. The content root must
     exclude consent/analytics chrome.
   - **Verify the consent banner is actually gone post-dismiss before
     trusting an inventory** — consent UIs render nondeterministically
     between two sequential captures (one capture caught the expanded
     cookie panel, the other didn't). If reds cluster on cookie/consent
     strings, the scope or the dismissal is wrong, not the recreation.
4. **Stitched captures only, never `fullPage:true`.** Chromium's
   captureBeyondViewport renders lazy-decoded images as gray placeholders
   even when the DOM says loaded. Stitch on BOTH sides — the instrument
   must be symmetric.
5. **Freeze animations for capture, injected AFTER lazyload settle.**
   Injection before the settle breaks some lazy loaders' swaps (recorded
   failure mode). stitch-shot.mjs orders this correctly.
6. **Overlays dismissed — BOTH classes, by clicking, not DOM removal** (so
   layout settles as a real visit does). Two classes, both handled by the
   shared `dismissOverlays` (stitch-shot always; diff probes via
   `--dismiss`): (a) cookie consent (clicked accept; `--consent <sel>` /
   `--dismiss <sel,...>` for non-standard banners); (b) **timed
   marketing/newsletter interstitials** — recorded (carhartt-wip): an
   undismissed "Sign up, stay updated!" modal fired ~5–9s after load and
   baked a pixel-diff contributor into the LIVE capture, repeated at every
   chunk seam, that no prototype fidelity could null out. These fire on a
   timer, so the dismissal polls for late arrivals and stitch-shot sweeps
   again after the settle pass.
7. **Granularity parity for JOIN/SPLIT false-reds (#87)** — mirror live
   node granularity or confirm-justify per
   `recreation-procedure.md` § Granularity parity.
8. **Capture-state policy** — CDN-403 placeholders and hydration states are
   ground truth (`recreation-procedure.md` § Capture-state); a probe flag
   over a logged capture-state zone is justified.
9. **Two classes only the gate sees:** rendered-face font forks on inner
   spans (trust the width probe over captured computed styles) and overlay
   scrims (recover by per-row luminance fitting). Both in
   `recreation-procedure.md`.
10. **Pointer parked after any dismissal click.** A consent/modal click
    leaves the virtual cursor at the button's coordinates; a
    `:hover`-styled element under the resting cursor is silently captured
    in HOVER state (recorded: a hero's `a.box-hover:hover img{opacity:.4}`
    shipped the live capture dimmed — measured 0.4 in capture, 1.0 in
    reality). The shared `dismissOverlays` parks the mouse (bottom-left)
    after every dismissal pass — all three instruments inherit it; mirror
    it in any ad-hoc capture that clicks anything.
11. **Fixed/sticky chrome × stitched capture.** Fixed elements repeat at
    every chunk seam, occlude a band of content per seam, and can morph
    with scroll state — chunks 2+ then capture different chrome than
    chunk 1. Symmetry requires the prototype to replicate the chrome
    including its scroll-state trigger; any height delta turns the seam
    repeats into ghost bands in the diff. Full treatment:
    `recreation-procedure.md` § Fixed and sticky chrome.
12. **A challenge/blocked response FAILS LOUD — it is never measured.** All
    three instruments detect bot-management interstitials on every
    navigation (crawl.mjs semantics: `cf-mitigated: challenge`, or
    403/429/503 with a Cloudflare/Akamai/F5/Imperva edge signature) and
    exit **3** with a `BotChallengeError` naming the URL and the marker.
    Recorded (rimowa): Akamai served "Access Denied" to the headless
    instruments — which, without this rule, would have silently measured
    the block page as the source and diffed it cleanly, wrongly. The
    escalation ladder: default (UA + standard headers) → `--headed`
    (stealth real Chrome, same tier as crawl.mjs's fallback) → if STILL
    blocked, the site needs crawl.mjs-class capture and **the gate must
    not silently degrade** — record the breakpoint as gate-blocked in the
    ledger and surface it to the user; a gate that can't read the live
    source has no pass to report.

### Script adaptations (now built-in flags — hand-edits are a defect)

The four manual adaptations this section used to prescribe are upstreamed
into the shipped scripts. All live-target hardening lives in one shared
module — `diff/scripts/live-session.mjs` (UA + standard headers, challenge
fail-loud, overlay dismissal, headed-stealth escalation) — and the diff
scripts expose it as flags:

```bash
# content-diff against a live source: no source edits, flags only
node scripts/diff/content-diff.mjs "$LIVE" "$PROTO" --profile generic \
  --width 1440 --main "<content-root>" --dismiss

# visual-diff: --main is a real flag (rule 3), same live hardening
node scripts/diff/visual-diff.mjs "$LIVE" "$PROTO" --profile generic \
  --width 1440 --main "<content-root>" --dismiss

# non-standard overlay closer / pinned locale / bot-managed site:
#   --dismiss "#custom-close"    --locale en-GB    --headed
```

Defaults when no flags are passed: real-Chrome UA + standard headers on
every context; `domcontentloaded` for non-localhost http(s) URLs and
`networkidle` for local ones (per side); no overlay dismissal (pass
`--dismiss` for live pairs); exit 3 on a challenge (rule 12).

**A project copy carrying `// replica ADAPTATION:` hand-edits is now a
defect**, not diligence: the edits were 10 distinct changes across 2 files,
and a partial application silently mis-measured (e.g. one `main`-scoped
selector left hardcoded in visual-diff). If you find adapted copies from an
older run, re-copy the shipped scripts and pass flags instead.

## Residual logging format

Per archetype per breakpoint, in `stardust/replica/progress.json`:

```json
{
  "pageType": "landing",
  "archetype": "home",
  "breakpoints": {
    "1440": {
      "iterations": 3,
      "result": { "structuralRed": 0, "visualFlags": "3 justified",
                   "pixelPct": 1.31, "heightDelta": 0, "pass": true },
      "justified": [
        { "probe": "visual", "flag": "1x1 h1 at x0", "why": "mirrors live SEO h1" },
        { "probe": "content", "flag": "🟠 font fork ×2", "why": "licensed kit substituted, R-policy fonts", "permanent": true }
      ],
      "residuals": [
        { "band": "y 4500–5000", "pct": 6.2, "cause": "capture-state: 3 CDN-403 placeholder tiles", "flaggedFor": "delivery" }
      ],
      "captureState": [ { "what": "product tiles 4–6 on placeholder data-URIs", "where": "carousel-2" } ]
    },
    "360": { "...": "..." }
  }
}
```

Rules: every residual names its band, its %, its cause, and who inherits it
(`delivery` for capture-state items, `user` for accepted trade-offs). A
residual without a cause is not a residual — it's an unfinished iteration;
either diagnose it or spend the remaining budget on it. The rollout phase's
final report surfaces the residual list per page type so "gate passed"
can't hide "passed with 6% unexplained".
