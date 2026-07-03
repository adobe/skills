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

# 1. structural
node scripts/diff/content-diff.mjs "$LIVE" "$PROTO" --profile generic --width $W \
  --main "<content-root>" | tee "$GATE/content-diff-iter<N>.txt"

# 2. visual heuristics
node scripts/diff/visual-diff.mjs "$LIVE" "$PROTO" --profile generic --width $W \
  --out "$GATE/vdiff" | tee "$GATE/visual-diff-iter<N>.txt"

# 3. pixel — stitched captures on BOTH sides (never fullPage:true)
node scripts/replica/stitch-shot.mjs "$LIVE"  "$GATE/live.png"  --width $W --settle
node scripts/replica/stitch-shot.mjs "$PROTO" "$GATE/proto.png" --width $W
node scripts/replica/pixel-compare.mjs "$GATE/live.png" "$GATE/proto.png" \
  --out "$GATE/diff-iter<N>.png" --threshold 10
```

The live capture is re-taken per iteration only if the earlier one is stale
(site changed, capture hardening changed); the prototype capture is re-taken
every iteration.

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

## Hardening rules (false-measurement traps)

Each of these was hit live; skipping one silently corrupts the measurement
rather than erroring.

1. **Real-Chrome UA on every capture and probe.** The default
   HeadlessChrome UA can receive a Cloudflare managed challenge, and the
   probe then **measures the challenge page as the source** (3 headings,
   "Performing security verification" — it diffs cleanly, wrongly). This is
   a false-measurement trap, not a crash. `stitch-shot.mjs` defaults to a
   real UA; the diff scripts need the adaptation (§ Script adaptations).
   Sanity check when numbers shift inexplicably between runs: grep the
   content-diff inventory for challenge-page strings.
2. **`domcontentloaded`, never `networkidle`.** Live sites with analytics
   beacons never reach networkidle — hard timeout. Use
   `domcontentloaded` + a generous timeout (60s) + explicit settle waits.
3. **Symmetric `--main` scoping.** Live `<main>` often contains header nav
   + hidden mega-menu; unscoped, those diff as ~dozens of missing CTAs
   (UC1-E1 iteration 1: 41 of 50 reds were scoping artifacts). Scope BOTH
   sides with the same selector — have the prototype adopt the live
   content-root class so one `--main` value fits both. visual-diff ships
   without a `--main` flag (hardcoded `<main>` — on sites without one, both
   sides false-flag BLANK RENDER while the main-scoped checks no-op); apply
   § Script adaptations 3.
4. **Stitched captures only, never `fullPage:true`.** Chromium's
   captureBeyondViewport renders lazy-decoded images as gray placeholders
   even when the DOM says loaded. Stitch on BOTH sides — the instrument
   must be symmetric.
5. **Freeze animations for capture, injected AFTER lazyload settle.**
   Injection before the settle breaks some lazy loaders' swaps (recorded
   failure mode). stitch-shot.mjs orders this correctly.
6. **Consent dismissed by clicking accept**, not DOM removal, so layout
   settles as a real visit does (`stitch-shot.mjs --consent <sel>` for
   non-standard banners). The diff probes run consent-blind as shipped —
   § Script adaptations 4 covers when that matters and the patch.
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
10. **Pointer parked after any consent click.** A consent click leaves the
    virtual cursor at the button's coordinates; a `:hover`-styled element
    under the resting cursor is silently captured in HOVER state (recorded:
    a hero's `a.box-hover:hover img{opacity:.4}` shipped the live capture
    dimmed — measured 0.4 in capture, 1.0 in reality). stitch-shot.mjs
    parks the mouse after dismissal; mirror it in any ad-hoc capture and in
    adapted diff probes (§ Script adaptations 4).
11. **Fixed/sticky chrome × stitched capture.** Fixed elements repeat at
    every chunk seam, occlude a band of content per seam, and can morph
    with scroll state — chunks 2+ then capture different chrome than
    chunk 1. Symmetry requires the prototype to replicate the chrome
    including its scroll-state trigger; any height delta turns the seam
    repeats into ghost bands in the diff. Full treatment:
    `recreation-procedure.md` § Fixed and sticky chrome.

### Script adaptations (diff project copies)

The shipped diff scripts assume a controlled prototype↔build pair:
`waitUntil: 'networkidle'`, the default UA, a hardcoded `<main>` content
root (visual-diff), and no consent handling. Pointing them at a live site
requires four edits in the project copies (never edit the plugin):

**1. Real-Chrome UA (rule 1)** — in each script's `browser.newContext(...)`
(content-diff `grab()`, visual-diff `capture()`):

```js
const ctx = await browser.newContext({ viewport: { width: opts.width, height: 1000 }, reducedMotion: 'reduce',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' }); // replica ADAPTATION: real-Chrome UA (rule 1)
```

**2. `domcontentloaded` (rule 2)** — in each script's `page.goto(...)`:

```js
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); // replica ADAPTATION: never networkidle on live sites (rule 2)
```

**3. visual-diff `--main` flag (rule 3).** The shipped probe hardcodes
`document.querySelector('main')` plus literal `main h1…` selectors; on a
live site with no `<main>` BOTH sides report `blankRender: true,
mainHeight: 0` — the probe red-flags BLANK RENDER while its main-scoped
checks silently no-op, so symmetric `--main` scoping is unsatisfiable as
shipped (content-diff already has the flag). Thread a content-root selector
through `analyse()`:

```js
// parseArgs(): add the flag
const opts = { out: 'qa/vdiff', width: 1280, sections: [], profile: 'eds', main: null }; // replica ADAPTATION: --main content-root override
…
else if (a === '--main') { opts.main = rest[i += 1]; } // replica ADAPTATION

// analyse(): take the selector as a parameter…
function analyse(mainSel) { // replica ADAPTATION: content root param
  …
  const mainEl = document.querySelector(mainSel || 'main');
  // …and use mainEl everywhere the probe scopes to main:
  const flushText = [...(mainEl || document).querySelectorAll('h1, h2, h3, p')] /* replica ADAPTATION */
  let boxes = [...(mainEl ? mainEl.querySelectorAll('[class]') : document.querySelectorAll('main [class]'))] /* replica ADAPTATION */

// capture(): pass it in
const metrics = await page.evaluate(analyse, opts.main); // replica ADAPTATION
```

**4. Consent handling (rule 6).** The diff probes run consent-blind:
stitch-shot dismisses banners, content-diff/visual-diff don't, so the banner
stays up during both probes. Either verify it is harmless — outside the
`--main` content root AND image-less, so no probe ever sees it — or add a
dismiss click after the goto/initial wait in each script's
`grab()`/`capture()` (same candidates as stitch-shot, and park the pointer
after the click, rule 10):

```js
// replica ADAPTATION: consent dismissal (rule 6) + mouse park (rule 10)
for (const sel of ['#onetrust-accept-btn-handler', 'button:has-text("Accept all")', 'button:has-text("Accept All")', 'button:has-text("Accept")', 'button:has-text("I agree")', '[data-testid*="accept"]']) {
  try {
    const btn = page.locator(sel).first();
    if (await btn.count() && await btn.isVisible()) { await btn.click({ timeout: 3000 }); await page.waitForTimeout(1500); await page.mouse.move(0, 999); break; }
  } catch { /* candidate absent — try next */ }
}
```

Mark every edit with a `// replica ADAPTATION:` comment so a later re-copy
doesn't silently lose them. (Upstreaming all four as diff flags — `--ua`,
`--wait-until`, visual-diff `--main`, `--consent` — is the recorded round-2
candidate; until then the adaptation is manual.)

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
