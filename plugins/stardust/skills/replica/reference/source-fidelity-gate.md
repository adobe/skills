# Source-fidelity gate (the measured heart of replica)

## When to read what

- § The three probes — first: what each instrument catches and is blind to, and why all three run.
- § Per-breakpoint procedure — when running a gate pass: breakpoint order and the commands.
- § Pass bar — when deciding whether an archetype ships: the criteria every breakpoint must meet.
- § Reading the band breakdown — only after a failed round: locating the first hot band and ignoring the contaminated ones below it.
- § Wide-viewport fluid check — after the desktop pass: catching frozen pixel widths that only diverge on wider screens.
- § Iteration discipline — when a round fails: the hard cap, the measure-first order of fixes, and the three named regimes (`source-inconsistent`, `separate-composition`, `canon-followup`) that end a loop early or sit outside the cap.
- § Hardening rules — before trusting any number: the false-measurement traps (UA challenges, overlays, animation, lazy media, font forks).
- § The published-origin gate — after platform delivery: re-running the gate against the published page, the only number that counts as final.
- § Residual logging format — when recording a passed or capped result in `progress.json`: the `result` fields `gate.sh` emits (regime, masks, unmasked %, reference date) and § Residual classes, the table every residual's `cause` cites.

The gate proves an archetype matches the LIVE site — three instruments, per
breakpoint, with a hard iteration cap. It replaces the redesign pipeline's
craft gates entirely: an archetype ships because it measured true, never
because it looked right. Every fix in the loop comes off the instruments;
eyeballing is not an input.

Validated (UC1-E1, a typographic retail home page): 8.31% → 2.93% → 1.31% pixel diff across
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
# Serve the prototype from its own dir so relative assets resolve. Verify the
# port is YOURS first (lsof -nP -iTCP:8791 -sTCP:LISTEN); prefer a per-project
# port — a stale server from another stardust project on the shared suggested
# port silently serves a foreign site into the gate.
# On shared machines run gate.sh with --marker "<brand string>": the slug
# default can false-pass against another stardust project sharing the slug
# (both serving a home-proposed.html that contains "home").
(cd stardust/prototypes && python3 -m http.server 8791 &)
PROTO="http://localhost:8791/<slug>-proposed.html"
LIVE="https://<site>/<path>"
W=1440   # then 360
GATE="stardust/replica/gates/<slug>-$W"

# 1. structural — --dismiss keeps consent + timed marketing modals out of the
#    inventory on both sides; add extra selectors for non-standard closers
node stardust/scripts/diff/content-diff.mjs "$LIVE" "$PROTO" --profile generic --width $W \
  --main "<content-root>" --dismiss | tee "$GATE/content-diff-iter<N>.txt"

# 2. visual heuristics — --main is a real flag here too (live sites often
#    have no <main>; without it both sides false-flag BLANK RENDER)
node stardust/scripts/diff/visual-diff.mjs "$LIVE" "$PROTO" --profile generic --width $W \
  --main "<content-root>" --dismiss --out "$GATE/vdiff" | tee "$GATE/visual-diff-iter<N>.txt"

# 3. pixel — stitched captures on BOTH sides (never fullPage:true)
node stardust/scripts/replica/stitch-shot.mjs "$LIVE"  "$GATE/live.png"  --width $W --settle
node stardust/scripts/replica/stitch-shot.mjs "$PROTO" "$GATE/proto.png" --width $W
node stardust/scripts/replica/pixel-compare.mjs "$GATE/live.png" "$GATE/proto.png" \
  --out "$GATE/diff-iter<N>.png" --threshold 10
```

On a geo-redirecting site add `--locale <tag>` to all three (a live side that
redirects to a different locale per run is a nondeterministic source); on a
bot-managed site that exits 3, escalate with `--headed` (§ Hardening rule 1).

The live capture is taken ONCE per breakpoint per full gate run and reused
across iterations. **Freshness is an instrument, not a judgment**: `gate.sh`
re-probes a reference older than `GATE_REF_MAX_AGE_H` (24 h; `--refresh`
forces it) with ONE `anchor.mjs` hit and recaptures only on `LIVE DRIFT`
(height beyond a noise-bounded threshold or a changed section count),
invalidating `live.png`, `anchor-live.json` and `chrome-live.json` together
— a stale reference is not a residual (§ Residual classes, `live-drift`)
and the recapture round does not count against the cap. The gate dir's own
capture is the only reference; never a POC or crawl screenshot. Add
`--variance` (a second live hit, once per gate dir) for the published-origin
gate and for the first round of an archetype whose dynamics inventory lists
index-backed or personalised rows; never on hard-CDN sites. Its `noise floor`
is printed beside the raw number and its hot bands offered as `--mask`
suggestions — it is never subtracted and never moves the bar. This is a
bot-block control, not just a cost note: content-diff + visual-diff each
navigate the live URL per run, so a full 3-iter, 2-breakpoint gate is
already ≈12–18 live hits, and hard-CDN sites escalate to an IP block after a handful. The prototype
capture is re-taken every iteration.

## Pass bar (all five, per breakpoint)

1. **content-diff: 0 structural 🔴.** 🟡 (body/EXTRA) and 🟠 (font fork)
   confirmed intended — a substituted licensed font is a permanent justified
   🟠; record it once in the ledger.
2. **visual-diff: flags none or justified.** A live page's own quirks are
   justified when the prototype mirrors them (e.g. a 1×1 SEO h1 at x0, a
   carousel tile at a negative offset).
3. **pixel diff ≤ 10% full-page** — AND no band left unexplained (§ Band
   breakdown). 10% is the ship bar, not the target (validated run: 1.31%).
4. **height delta: |Δ| ≤ 8px** — pixel-compare's own warning threshold is
   the bar (it prints ⚠ above 8px), so a −9px result is unambiguously a
   residual, not a pass. A large delta invalidates the % — the overlap crop
   silently discards the tail, so a short prototype can score deceptively
   well. Fix heights before trusting anything else.
5. **Chrome crop gate: header band AND footer band each ≤ 2% diff (≥98%
   match, #115).** The full-page bar dilutes the chrome — header/footer are
   a small share of page pixels but carry disproportionate visual weight
   and repeat on every page of a rollout. Run `../scripts/crop-compare.mjs`
   over the SAME stitched captures the pixel probe used — no extra live hit:

   ```bash
   node stardust/scripts/replica/crop-compare.mjs "$GATE/live.png" "$GATE/proto.png" \
     --y 0 --height <nav-height> --out "$GATE/chrome-header-diff.png"
   node stardust/scripts/replica/crop-compare.mjs "$GATE/live.png" "$GATE/proto.png" \
     --y <liveDocH - footerH> --y-b <protoDocH - footerH> --height <footerH> \
     --out "$GATE/chrome-footer-diff.png"
   ```

   `--y-b` gives the footer crop a per-side offset so a small doc-height
   delta doesn't contaminate it with a false full-band diff. Read the band
   heights off the section-anchor probe (`anchor.mjs` prints the footer's
   `[y, height]` on both sides).

   **Styles diagnose, pixels confirm — run the computed-style parity probe
   BEFORE any pixel iteration on chrome.** `../scripts/chrome-parity.mjs`
   probes the same regions on live and build (default `header` + `footer`;
   add sticky strips with `--region strip=<liveSel>|<buildSel>`), pairs
   every text-bearing element by its text, and prints only what differs:
   family / size / weight / style / line-height / letter-spacing /
   transform / colour / background / padding / radius / list marker /
   underline thickness, the element rect, the clickable box of links and
   buttons (OCCLUDED when another element covers it), the current-page
   marker (STATE) and the icon inventory (count + size + signature, paired
   by order). Fix every delta, re-run until it is
   quiet (exit 0), THEN crop-compare — a pixel loop on chrome with parity
   deltas outstanding is wasted iterations. Each run is one live
   navigation (budget it like any live probe); `--json` records both
   sides as the round's evidence.

   ```bash
   node stardust/scripts/replica/chrome-parity.mjs "$LIVE" "$PROTO" --width $W \
     --region header=header --region footer=footer   # + --region strip=<sel>|<sel>
   ```

   States: `--open <liveSel>|<buildSel>` per top-level trigger (opened
   menus — EXTRA, PSEUDO, OCCLUDED) and `--scroll <y>` for sticky chrome
   (STICKY) — one state per run, cached per state (`chrome-live-<state>.json`).

   **Multi-theme sites (a theme id on `html`/`body`, brand or product
   themes on one template): run `chrome-parity.mjs` on one themed page per
   template × theme id, not on the home archetype alone.** Theme tokens
   bind per theme id, not per brand: an alias derived from one theme's
   surface is wrong on every other theme, and the archetype gate cannot
   see it (chrome is a small share of page pixels).
   Alias only tokens the live CSS actually binds to the measured element,
   and treat the source's theme/variant classes as probe deltas → block
   variants on the sibling's content (`../../migrate/reference/fidelity-tiers.md`
   § Sibling variance probe) — encode the variant, never fix the page.

   **Glyph-dense chrome has a pixel noise floor — the ONE justified way past
   the 2% bar, and it is evidence-gated three ways.** A footer of ~50 links
   bottomed out at ~5% pixel diff with family, size, line-height, weight,
   colour, pitch and positions all numerically identical: per-glyph
   antialiasing between a hinted licensed face and the self-hosted webfont
   dominates, and raw pixel bars over-iterate against noise. A chrome band
   that FAILS crop-compare may be logged as a **justified residual** —
   never a pass — only when ALL three hold, and each is an artifact in the
   residual entry (§ Residual logging format, `cause: "glyph-antialiasing"`):
   (1) `chrome-parity.mjs` exits 0 for that region at tolerance 1px — every
   paired text's metrics and position match, no MISSING/EXTRA, icons paired;
   (2) `crop-compare.mjs` reports the diff **texture** as thin-edge (≤15% of
   differing pixels have ≥5 differing neighbours) — glyph antialiasing is
   thin, misalignment and missing paint are thick; (3) the region is
   text-dense (link columns, nav rows) — a band with imagery or icons never
   qualifies (parity's ICONS finding would not be quiet anyway). One or two
   of the three is not enough: a quiet parity probe with a THICK texture is
   a paint defect the probe does not model; a thin texture with parity
   deltas is a real metric error hiding in noise. The 2% bar itself is
   unchanged, and the residual is re-verified every gate round like any
   other justified flag.

   **Chrome crops are ELEMENT-ANCHORED per side, never fixed-y — and
   "chrome" means every site-wide repeating band: header, sticky/quick-link
   strips, footer.** Chrome is small-area, highest-salience and repeats on
   every page. Two traps: (a) a fixed-y crop produces FALSE reads the moment
   either side's rhythm shifts (a nav fix moves every strip below it). Locate each
   region on EACH side (its element rect via `anchor.mjs`, or its band
   edges via `row-profile.mjs`'s column scan) and pass both anchors
   (`--y`/`--y-b`); every gate round re-reads the anchors. (b) Regions whose
   live content is authored-volatile — campaign heroes, promo creatives that
   change between capture and gate — are masked out of the fidelity number
   with `pixel-compare.mjs --mask <yA:h[@yB]>` or a `masks.json` entry (rule 19; printed on the verdict line, never silent): they are authored content, not conversion fidelity, and
   chasing them burns iterations on a moving target.

Applied inconsistency-register entries create expected deltas: cross-
reference the entry ID (`R-<nn>`) when justifying a flag over its zone
(`preserve-direction.md` § Gate interaction).

**Calibration honesty — two fidelity regimes, one bar.** The validated
numbers above (1.31%, Δ0) describe the **prototype regime**: a standalone
prototype gated against the live page, on a typographic page. Pages
converted to the delivery platform and gated against the **published
origin** (§ The published-origin gate) carry justified block-model deltas —
control UI, split anchors, nondeterministic elements — and landed at
near the bar while visually faithful. The ≤10% bar covers both
regimes; what burns iteration caps is chasing prototype-regime numbers on a
published-origin gate. Record which regime a number belongs to in the
ledger, and judge each against its own regime's precedent.

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
- Uniform 5–7 % bands with Δh growing linearly with the section/heading
  count = a source CONTAINER margin, not a section fault: compare
  `anchor.mjs` y positions on both sides and emit one section per source
  container (its margin becomes the section gap). Import-side rule: migrate
  `reference/importer-recipe.md` rule 8 points here.

**Landmark table first — `gate.sh` prints it every round.**
`../scripts/anchor.mjs --landmarks` pairs h1–h4 and CTAs by text, the first
image per section and the footer; `--against <other-side.json>` prints
`landmark | yA | yB | Δy | hA | hB | Δh`, then `first non-zero Δ: <landmark>
(+N px, section <label>) — fix its section first` or `landmarks clean`
(`--json-out` for the record; never an exit code). Fix the first non-zero Δ
top-down (everything below is offset-contaminated), re-run pixels; open the
band table only when the landmarks are clean or the remaining Δ are named
residuals.

```bash
node stardust/scripts/replica/anchor.mjs "$LIVE"  --width $W --landmarks --cache $G/anchor-live.json    # one live hit per breakpoint
node stardust/scripts/replica/anchor.mjs "$PROTO" --width $W --landmarks --against $G/anchor-live.json  # free — build side
```

**Band-row legend** (`pixel-compare`, default on): `offset +48px (0.9)` is
how many px side B is shifted in that band (confidence 0–1); `◄ seam` marks
the band where the shift is introduced — name its section with the landmark
table and fix it first; `—` is a flat band, no measurement; `◄◄ hot band`
stays > 15 %. `crop-compare.mjs` (pass-bar item 5) is the full-resolution
escalation for ONE named band; `review-<label>.png` is the round's one image.

**Two row-level instruments replace eyeballing crops (`../scripts/row-profile.mjs`,
runs over the same stitched PNGs — no live hit):**

- **Column scan for layout boundaries.** Before editing CSS to fix a section
  height, photo height, band start or card overlap, read the per-column
  class transitions (white / dark / brand / photo at N x positions) on the
  capture: `node stardust/scripts/replica/row-profile.mjs live.png proto.png
  --columns 7`. Crop eyeballing is hypothesis; the scan is the measurement.
- **Brand-colour landmarks for vertical alignment.** Band percentages say
  WHERE diffs are, not by how many pixels sections are offset. When a
  saturated brand colour recurs in every section (CTA buttons are ideal),
  `--color <#rrggbb>` lists every row run dominated by it on both sides and
  pairs them in order: the per-pair delta is each landmark's offset, and the
  CHANGE in delta between consecutive pairs (`gapShift`) names the one
  inter-landmark CSS gap that absorbed the shift. Patch that gap, re-measure,
  top-down — the same contamination rule as the band table. Do not tune
  margins by eye against crops (`review-image.mjs --bands` / `crop-compare`,
  never `sips`).

## Wide-viewport fluid check (fluid-vs-fixed is invisible at the gate widths, #116)

Both gate breakpoints render a frozen `width: 720px` and an authored
`width: 50%` byte-identically at 1440 — and 360 collapses both — so a
computed-style lift that recorded the resolved px instead of the sizing
MODEL passes every gate and diverges only on wider screens. After the 1440 pass, run a cheap **box-map spot check at
≥1920**: sample the text-bearing elements' x/width on both sides (the
anchor-probe technique at `--width 1920`, or one extra stitched capture)
and compare — a box whose width scales on live but not on the prototype is
a frozen fluid value. No full pixel gate is needed at 1920; the box map
alone catches the mismatch class. Two rules when reading it: compare the
same DOM tier (EDS/section wrappers are full-width by design and
false-flag against live INNER containers), and fix upstream — re-lift the
authored rule per `recreation-procedure.md` § Lift the sizing MODEL, don't
nudge the px. Sample heights as well as widths, and take one extra sample
at an intermediate width (1280 or 1680) when the live layout is fluid: a
hero that scales with the viewport on live and is fixed-px on the prototype
is identical at 1440 and visibly off at 1512.

## Iteration discipline

**Hard cap: 3 iterations per breakpoint.** The validated run converged
within 3 with the recreation procedure followed; more loops mean the inputs
were wrong (values eyeballed instead of lifted, capture unhardened), and the
fix is upstream, not a fourth loop.

- **The cap is mechanical, per regime.** `gate.sh` counts the rounds from
  the round records (`gate-<label>.json` with verdict PASS/FAIL, not
  excluded, not a live-drift recapture, same `regime`; no-verdict rounds
  never count), labels rounds `iter<k>` (prototype) / `pub<k>`
  (published-origin) by default and stops at 3 with exit 6 before any capture.
  `--over-cap <reason>` runs one more round with one of the regime labels
  below, written to the record as `overCap`; `--invalidate <label> <fix>` is
  the instrument-invalidated exclusion as a record field; `--record` copies
  `iterations` and `result` into `progress.json` (`progress-record.mjs`).
  The verdict line prints `iteration k/3` and `NO-OP` when the
  differing-pixel count did not move.
- Measure first (iteration 1 IS the map — do not pre-polish).
- **Chrome: parity probe first, pixels second.** Before a chrome band's first
  pixel round, run `chrome-parity.mjs` and clear its deltas (§ Pass bar,
  item 5); style deltas are named in one pass, pixels only say where.
- Every fix cites the instrument line that demanded it.
- Images are read per `../../stardust/reference/context-hygiene.md` § Image
  reads: **`review-<label>.png` first** — `gate.sh` writes it every round
  (`pixel-compare --review`; standalone `../scripts/review-image.mjs
  --bands`): the 3 worst bands as [live | build] rows with a diff heat bar,
  one Read for the whole round. Then at most one full-resolution band per
  hot band still unexplained (`crop-compare --out`), ≤ 10 per round, never
  `live.png`/`proto.png`/`diff*.png` whole — the count is the cost.
- **Before counting an iteration, verify the fix changed the render.** A
  byte-identical differing-pixel count after a "fix" means the rule was a
  no-op and the round measured nothing. The check is free —
  the count is already on the verdict line; if it didn't move at all, find
  out why the rule never applied (specificity, wrong selector, value already
  in effect) before spending another round.
- **Verify geometry fixes on the RULE-BEARING element, cache-free (#117).**
  One field "parity verified" claim was wrong three ways at once: the probe
  matched a heuristic element ("white column wider than 400px") that wasn't
  the box carrying the lifted rule — always pair the same semantic element
  on both sides (the element the fixed rule targets on the build; the
  element whose source rule was lifted on live); the re-check ran through a
  CACHED stylesheet — verify serving out-of-band
  (`node skills/deploy/scripts/served-check.mjs <css-url> --grep
  '<new-rule>'` — served assets are gzip-encoded; the helper decodes and
  prints the grep verdict) and re-render in a fresh headless context; and
  a reviewer's screenshot encodes their zoom — back-compute their CSS viewport from any
  element with a known percentage rule (a card at 851px under `width: 50%`
  → viewport 1702px) and reproduce THAT viewport headlessly before letting
  their numbers overturn a fix.
- Probe schedule per fix round: **pixels every round; content-diff +
  visual-diff at milestones** — iteration 1, after any fix that touched
  content or markup (not pure CSS values), and once at final. Pixel-only
  rounds never regressed structure once it passed, and each content/visual
  re-run costs 2 extra live navigations. A fix that
  touched markup re-runs all three; a CSS-value fix re-runs pixels only.
- **The landmark table is the first read of every round; the section-anchor
  probe is the fast inner loop** (`anchor.mjs --landmarks`, § Band
  breakdown). `gate.sh` prints it before the band table each round (live
  side from the cached `anchor-live.json`, build side free) and records it
  in `gate-<label>.json#landmarks`: headings/CTAs paired by text, first
  image per section, footer, with `Δy`. Fix the `first non-zero Δ` line's
  section top-down; open the band table only when it says `landmarks
  clean` or the remaining Δ are named residuals (nondeterministic
  landmarks, the T05.1 regimes). It is a diagnosis order inside one round —
  not a pass bar. Build-side anchor/computed-style passes never navigate
  the live origin and are FREE — the cap governs live-gate cycles, not
  measurement.
- **After iteration 3 an over-bar breakpoint is FAIL** unless every residual
  is a named class (§ Residual classes) with an instrument artifact and an
  `acceptedBy` (§ Residual logging format); log it and stop — hands-off
  never approves an over-bar result (it may self-accept only the table's
  permanent classes as `hands-off-policy:<class>`). An undocumented fourth
  loop is scope creep; "eyeball matches" is never a verdict. Before calling
  a hot band "ghosting", run `anchor.mjs` plus one computed-style probe on
  the hot element. Per-row source inconsistency → register entry `R-nn`
  (`preserve-direction.md` § 3), not a fourth round.
- **Three named regimes end a loop early or sit outside the cap.** The
  label is the ledger's `overCap` reason; bars are unchanged in all
  three — a justified residual is never a pass.
  - `source-inconsistent` — the live page is internally inconsistent
    (per-row authoring artefacts, irregular indents, mixed CTA arrangements
    inside one module). After round 2 the honest output is an
    inconsistency-register entry (`preserve-direction.md` § 3) naming the
    normalisation as a permitted delta — not a fourth round chasing rows.
  - `separate-composition` — the 360 page is a different composition, not
    a reflow: the two document heights differ by more than 40 %, or
    content-diff reports hidden twin rows (MISSING duplicates of desktop
    content). Declare it BEFORE iterating; anchors + chrome crops are the
    diagnostic evidence, and after two rounds with no material gain the
    360 result is logged as a documented residual with a register entry
    (FAIL-at-cap with a cause — never a second pass bar).
  - `canon-followup` — a round that fixes a canon defect (chrome, tokens)
    after an archetype passed does not count against that archetype's cap;
    log it `canon-followup` and follow it with a re-gate of every approved
    archetype sharing the canon. Template variants of canon modules are a
    recreation rule: `recreation-procedure.md` § Cumulative archetype
    prototypes.
- **Instrument-invalidated runs don't consume the cap — once the defect is
  fixed and named.** The 3-iteration cap assumes valid instruments. When a
  run is later shown to have measured an instrument defect (a challenge
  page, a font fork forced by the capture itself — rule 14), the honest
  ledger practice is: count the runs, mark which ones measured the defect
  state, and exclude those from the cap, with the instrument fix named in
  the ledger. This legitimizes the exclusion without weakening the cap — an
  unnamed "the instrument felt wrong" is still a spent iteration.
- **Hit minimization: ONE live navigation per instrument per breakpoint per
  full gate run.** The live stitch PNG is captured once and reused across
  iterations; only the prototype side re-captures. The two other live-side
  instruments cache the same way: `chrome-parity.mjs --live-cache
  <gates-dir>/chrome-live.json` and `anchor.mjs --cache
  <gates-dir>/anchor-live.json` (live URL only) write the live measurement
  on the first run and reuse it while URL, width and selectors match —
  delete the file to re-probe. On hard-CDN sites
  (Akamai-class), take the live captures with `--headed` and treat further
  live hits as spent budget — an IP-level block escalates within a few automated requests, after which the numbers measure the block, not the site. A challenged
  headless run costs exactly **1** hit: `gotoLive` throws
  `BotChallengeError` on the first challenge-classified response (the
  wait+reload solve window runs only under `--headed`, where clearance can
  actually land) — so the block budget is still intact when you escalate.
- **Some origins score sessions, not requests (admitted-then-escalated):**
  one live-hitting tool per host at a time — `stardust/.work/live-<host>.lock`
  enforces it (`STARDUST_LIVE_FORCE=1` overrides); pacing never re-captures a
  page that already has a record.
- **Instrument deadlines are the gate's, not yours.** `gate.sh` runs each
  capture under `run-capped.mjs` (stitch 300 s, compare 120 s —
  `GATE_STITCH_TIMEOUT` / `GATE_COMPARE_TIMEOUT`) and reaps this user's
  replica instruments older than 15 minutes before a round (`GATE_REAP_MIN`,
  0 disables); `pixel-compare.mjs` supervises its own `--timeout` (120 s)
  when run alone. Exit 124 is "no verdict — re-run", never a FAIL. Do not
  wrap the instruments in your own `sleep N; kill` guard: a fixed sleep spends its whole window every round.
  When a capture legitimately needs longer (a 10k-px page under `--settle`),
  raise the variable for that page and say so in the ledger.
- **Your waiting has a ceiling too.** A gate round over several archetypes
  or siblings runs as `gate-batch.mjs <pairs.tsv>` in the background, not a
  foreground `for` loop of `gate.sh` calls. Read its progress file at most
  every 4 minutes, never with a single `sleep` of 5 minutes or more — the
  master skill's wait discipline; its SUMMARY line is the completion.
- **Media-density budget.** The ≤3-iteration convergence assumes a
  typographic, low-image page. Image-dense pages spend iterations on media parity —
  populating grids, matching crops — before geometry work even starts.
  Budget accordingly: on a media-heavy page, image/media parity IS
  iteration 1's job; geometry starts at iteration 2.
- **A pixel pass at the wrong metric is debt — spot-check base typography
  against live computed styles once the gate passes.** Tuned spacing absorbs
  a body text one size too small; siblings with more text amplify it into
  extra wraps and taller pages. After the pass,
  read body font-size/line-height per block on both sides (a computed-style
  probe — build-side runs are free) and re-fit rhythm at the true metric.
  Compensating spacing is the tell.

## Hardening rules (false-measurement traps)

Each of these was hit live; skipping one silently corrupts the measurement
rather than erroring.

1. **Real-Chrome UA + the standard request headers on every capture and
   probe.** The default HeadlessChrome UA can receive a Cloudflare managed
   challenge, and the probe then **measures the challenge page as the
   source** (it diffs cleanly, wrongly). And the UA alone is NOT
   sufficient: field-proven (F-R1), a real-Chrome UA with Playwright's
   minimal default headers still got HTTP 403 from Akamai; adding the standard set every
   real Chrome sends (`Accept`, `Accept-Language`,
   `Upgrade-Insecure-Requests`, `sec-ch-ua*`) produced HTTP 200 — Akamai
   bot-manager fingerprints on the *absence* of those headers, not just the
   UA. All three instruments now send both by default via the shared
   `diff/scripts/live-session.mjs`; `--ua` overrides the UA string only.
   The header set rides **document requests only** (F-B2):
   forcing it on every request makes cross-origin CORS-mode webfont fetches
   non-simple and kills them with `net::ERR_FAILED` — the capture then
   silently renders fallback type (see rule 14); bot managers fingerprint
   the navigation request, which still carries the full set. Sanity check
   when numbers shift inexplicably between runs: grep the content-diff
   inventory for challenge-page strings.
2. **`domcontentloaded`, never `networkidle`, on live targets.** Live sites
   with analytics beacons never reach networkidle — hard timeout. Built in:
   the diff scripts default `domcontentloaded` for non-localhost http(s)
   URLs (decided per side; EDS build/preview origins — `*.aem.page`,
   `*.aem.live`, `*.hlx.page`, `*.hlx.live` — are the exception and get
   `networkidle`, they decorate async) and keep `networkidle` for local
   prototypes; `--wait-until` overrides. stitch-shot is always
   `domcontentloaded`.
3. **Symmetric `--main` scoping — and never `body`.** Live `<main>` often
   contains header nav + hidden mega-menu; unscoped, those diff as ~dozens
   of missing CTAs. Scope BOTH sides with the same selector — have the prototype
   adopt the live content-root class so one `--main` value fits both. Both
   diff scripts take `--main` (visual-diff's is the upstreamed flag: on
   sites without a `<main>`, both sides otherwise false-flag BLANK RENDER
   while the main-scoped checks silently no-op). Two guardrails:
   - **`--main body` is NEVER a valid replica scope.** A too-broad root
     self-poisons the instrument regardless of symmetry: reproduced,
     content-diff run live-vs-ITSELF with `--main body` produced **103
     structural 🔴** and asymmetric node counts from analytics/inline-script
     text plus a nondeterministic cookie-settings panel. The content root
     must exclude consent/analytics chrome.
   - **Verify the consent banner is actually gone post-dismiss before
     trusting an inventory** — consent UIs render nondeterministically
     between two sequential captures. If reds cluster on cookie/consent
     strings, the scope or the dismissal is wrong, not the recreation.
4. **Stitched captures only, never `fullPage:true`.** Chromium's
   captureBeyondViewport renders lazy-decoded images as gray placeholders
   even when the DOM says loaded. Stitch on BOTH sides — the instrument
   must be symmetric.
5. **Freeze animations for capture, injected AFTER lazyload settle.**
   Injection before the settle breaks some lazy loaders' swaps; stitch-shot.mjs orders this correctly.
6. **Overlays dismissed — BOTH classes, by clicking, not DOM removal** (so
   layout settles as a real visit does). Two classes, both handled by the
   shared `dismissOverlays` (stitch-shot always; diff probes via
   `--dismiss`): (a) cookie consent (clicked accept; `--consent <sel>` /
   `--dismiss <sel,...>` for non-standard banners); (b) **timed
   marketing/newsletter interstitials** — they fire on a timer seconds after load and, undismissed, bake a per-seam contributor into the live capture, so the dismissal polls for late arrivals and stitch-shot sweeps
   again after the settle pass. **Consent mode is one instrument
   parameter, the same on capture and gate**: `--consent-mode
   accept|deny` (default `accept`) on stitch-shot and every live-session
   probe (content-diff, visual-diff, anchor, chrome-parity,
   sibling-variance); the project's choice lives in
   `progress.json#captureState.consent` and `gate.sh` passes it to both
   sides. The lift's control is inherited, not re-guessed: stitch-shot
   reads the extract crawl's `_crawl-log.json#consent.method`
   (`dismissed:<sel>` / `text:<label>`) as its default `--consent`.
   `deny` is right when accepting loads nondeterministic third-party
   walls the build cannot carry; in `deny` the accept list is never
   tried, and a dialog that cannot be rejected is an invalid capture
   (exit 5, no PNG, no verdict) — never a silent accept. The shared
   dismissal inspects every match of a selector and clicks the first
   visible one, falls back to an exact multilingual label (overlay-scoped, selectors first), sweeps child
   frames and open shadow roots, and re-runs all of it inside one late-mount
   window. What no click removes — CMP re-open launcher, accessibility
   trigger, feedback tab — is hidden (`visibility`, layout kept) on BOTH
   sides (`--no-dismiss-defaults` disables the list; `--remove-text
   "<phrase>"` is the last resort for one undismissable bar, both sides).
   A consent container still visible after the window is **exit 5** on
   stitch-shot (`consent present, not dismissed — <container>`; `--consent
   <sel>` or `GATE_ALLOW_CONSENT=1` / `--allow-consent` on both sides) and
   a `WARN consent present` on the structural probes.
7. **Granularity parity for JOIN/SPLIT false-reds (#87)** — mirror live
   node granularity or confirm-justify per
   `recreation-procedure.md` § Granularity parity.
8. **Capture-state policy** — CDN-403 placeholders and hydration states are
   ground truth (`recreation-procedure.md` § Capture-state); a probe flag
   over a logged capture-state zone is justified. A third-party widget with
   no close control (iframe/shadow-hosted chat, survey) is blocked at the
   route, not eyeballed: `--block <host-substr,…>` on every replica and diff
   instrument (`GATE_BLOCK` on `gate.sh`) — opt-in, host-substring, never
   the page's own origin, the SAME value on both sides: the sidecar records
   `blocked` and pixel-compare refuses an asymmetric pair. A consent-manager
   host in that list is a consent decision (D3), and the instrument says so.
9. **Two classes only the gate sees:** rendered-face font forks on inner
   spans (trust the width probe over captured computed styles) and overlay
   scrims (recover by per-row luminance fitting). Both in
   `recreation-procedure.md`.
10. **Pointer parked after any dismissal click.** A consent/modal click
    leaves the virtual cursor at the button's coordinates; a
    `:hover`-styled element under the resting cursor is silently captured
    in HOVER state. The shared `dismissOverlays` parks the mouse (bottom-left)
    after every dismissal pass — all three instruments inherit it; mirror
    it in any ad-hoc capture that clicks anything.
11. **Fixed/sticky chrome × stitched capture.** Fixed elements can morph
    with scroll state — chunks 2+ then capture different chrome than
    chunk 1. Seam repeats are now instrument-provided (rule 16 hides pinned
    chrome on chunks 2+ on both sides); what remains a recreation duty is
    the chrome itself, replicated fixed with its scroll-state trigger, so
    chunk 1 and the chrome crop gate match. Full treatment:
    `recreation-procedure.md` § Fixed and sticky chrome.
12. **A challenge/blocked response FAILS LOUD — it is never measured.** All
    three instruments classify every navigation (live-session.mjs
    `challengeMarker`: `cf-mitigated: challenge`; a 4xx/5xx with a
    Cloudflare/Akamai/F5/Imperva edge signature, a PerimeterX/DataDome
    `set-cookie`, or the Akamai 400 body; plus the DOM/phrase stage) and
    exit **3** with a `BotChallengeError` naming URL and marker.
    Escalation follows the ladder in
    `skills/extract/reference/playwright-recipe.md` § Bot-management
    fallback; the instruments start at
    `_crawl-log.json#discovery.fetchTechnique` (`--headed` = tier 2,
    `--headed=window` = tier 3); `--solve-wait <ms>` on any instrument
    opens the visible window and waits for a hand solve. stitch-shot WARNs
    when `document.visibilityState` is not `visible` (read `pendingDecodes`)
    and refuses a stitched capture that is short AND challenge-phrased /
    near-empty (exit 3, nothing written; short alone WARNs). If tier 3 is
    still blocked **the gate must not silently degrade** — record the
    breakpoint as gate-blocked in the ledger and surface it to the user; a
    gate that can't read the live source has no pass to report.
13. **Inner-scroller / scroll-jacked pages fail loud — stitched capture
    cannot measure them.** On pages where `html`/`body` are
    `overflow:hidden` and an inner container scrolls, the document reports
    the full content height but `window.scrollTo` is a no-op — every chunk
    would capture the top viewport and the rows below would stitch as
    zero-filled black: a silently fictitious pixel diff. stitch-shot detects
    the stall and exits 1 (`stitch-shot error: scroll stall at chunk
    target …px`).
    Capturing the inner scroller is future work; for now record the page as
    gate-blocked for the pixel probe and rely on content-diff/visual-diff.
14. **Captures assert fonts loaded — a silent font fork is a false
    measurement.** A webfont that fails to fetch renders the ENTIRE live
    capture in fallback type: wrong wraps, wrong line counts, wrong section
    heights, wrong doc height — with no error anywhere, and it poisons
    every number the gate reports. stitch-shot checks after
    `document.fonts.ready` for declared faces with FontFace status
    `error` and warns loudly with the family names; mirror the check in any ad-hoc
    capture. On the warning, decide before gating: load the face in a real
    browser — if it loads there, the failure is **instrument-induced** (a
    capture defect: fix the instrument, and the poisoned runs don't consume
    the iteration cap per § Iteration discipline); if it fails there too,
    fallback type is the truthful capture (**capture-state** — log it).
15. **Comparable captures only — the provenance sidecar decides.** Every
    stitch-shot capture writes `<png>.json` (schema: the header of
    `../scripts/capture-sidecar.mjs`): url, width, vh, dpr, capturedAt,
    instrument, consent {mode, via}, dismissed, fontsFailed, docHeight,
    source, technique. `pixel-compare` and `crop-compare` read both sides
    and refuse (exit 1, named message) a pair that differs in instrument
    name, width, vh, dpr or consent mode, or has a sidecar on one side
    only; `--force` compares anyway and marks the number `forced`.
    `gate.sh` treats a cached `live.png` without a sidecar as stale and
    re-captures it, and prints `reference: … captured <ts> via <technique>`
    on every reuse. A reference imported with `gate.sh --live-from-capture
    <png>` (bot-walled sites) carries `source: extract-capture`; that compare is
    forced once, said out loud, and its number is marked `forced`.
16. **Pinned chrome is hidden on chunks 2+, scroll is integer, decodes are
    raced.** stitch-shot sets `opacity:0 !important` on every fixed and
    stuck-sticky element before shooting chunks 2+ and restores it after
    (chunk 1 keeps everything for the chrome crop; `--keep-pinned` is the
    off-switch), rounds `window.scrollY` before placing a chunk, and bounds
    the in-viewport `img.decode()` wait. Read the verdict block: `pinned
    hidden on chunks 2+: N […]` is the list; `WARN fixed overlay baked into N seams`
    means chrome the hide could not reach (iframe/shadow-hosted) — pass
    `--exclude <sel>` on both sides or mask the seam rows.
17. **Short and invalid captures are exit 5 — no PNG, no verdict, never a
    FAIL.** stitch-shot re-measures the settled height after one more
    `--wait` (growth = load race: it settles again);
    `gate.sh` passes `--expect-height` from the crawl screenshot on the
    live side and a height under 40 % of it retries once then exits 5; an
    error-boundary page or a fixed/dialog element still covering much of
    the first viewport after dismissal exits 5 too (`--allow-overlay`,
    both sides, when the overlay is the page). `gate.sh` removes the
    partial PNG, caches nothing and re-exits 5 like it re-exits 3.
18. **`--exclude` is the last resort for in-flow widgets, and symmetric.**
    A chat launcher or feedback tab that no dismissal removes and that
    takes layout space is `display:none`d after the settle by `--exclude
    <sel,…>` — on BOTH sides, recorded in the sidecar `hidden[]`.
    `--exclude-live-only` exists for a widget the build never had; its
    verdict line says ASYMMETRIC and the number is not a gate number.
    Read `tail Npx below footer: …` on the same block before chasing a
    footer-band residual: it names the element under the footer.

19. **Masks are declared, symmetric and printed — one rect model.** Every
    mask (`--mask` band, `sel`, `iframe`, `img`) is a rect painted on BOTH
    sides and dropped from the denominator; `pixelPctUnmasked` always
    accompanies the number. Auto-masks come only from
    `stardust/replica/masks.json` (`sel` + `class` + `source`; schema in `../scripts/capture-sidecar.mjs`): `gate.sh` validates it
    before the first capture, passes it to both stitch-shot calls (sidecar
    `masksRects[]`, read at scroll 0; a fixed/sticky match is recorded,
    never masked) and to pixel-compare (`--masks-json`; an undeclared `sel`
    rect is exit 1). `kind: iframes` masks every iframe (a live-only one
    prints `asymmetric`); `kind: images` masks only image rects whose
    geometry matches on both sides — a moved or missing image stays in the
    number — and above 60 % image area the verdict prints `photo-dominated`,
    which the ledger copies. A cached `live.png` taken with other mask
    flags is stale and re-captured.
20. **Session pin — every live-side probe of one gate run uses the same
    storage state.** Each live-session instrument resolves it the same way:
    `--storage-state <file>`, else `stardust/current/_storage-state.json`
    when one of its cookie domains matches the live host (the crawl saves
    it after clearing a challenge), else none; a local URL never gets one.
    `--fresh-state` opts out. A state older than the reference capture is
    not reused — delete it and recapture rather than mix sessions.

### Script adaptations (built-in flags first — but fail-loud outranks script immutability)

The four manual adaptations this section used to prescribe are upstreamed
into the shipped scripts. All live-target hardening lives in one shared
module — `diff/scripts/live-session.mjs` (UA + standard headers, challenge
fail-loud, overlay dismissal, headed-stealth escalation) — and the diff
scripts expose it as flags:

```bash
# content-diff against a live source: no source edits, flags only
node stardust/scripts/diff/content-diff.mjs "$LIVE" "$PROTO" --profile generic \
  --width 1440 --main "<content-root>" --dismiss

# visual-diff: --main is a real flag (rule 3), same live hardening
node stardust/scripts/diff/visual-diff.mjs "$LIVE" "$PROTO" --profile generic \
  --width 1440 --main "<content-root>" --dismiss

# non-standard overlay closer / pinned locale / bot-managed site:
#   --dismiss "#custom-close"    --locale en-GB    --headed
# undismissable iframe/shadow widget (chat, survey) — same value BOTH sides:
#   --block "chat-vendor.example,ads.example"   (gate.sh: GATE_BLOCK=…)
```

Defaults when no flags are passed: real-Chrome UA + standard headers on
every context; `domcontentloaded` for non-localhost http(s) URLs and
`networkidle` for local ones (per side); no overlay dismissal (pass
`--dismiss` for live pairs); exit 3 on a challenge (rule 12).

**A project copy re-implementing retired adaptations is a defect**, not
diligence: the edits were 10 distinct changes across 2 files, and a partial
application silently mis-measured (e.g. one `main`-scoped selector left
hardcoded in visual-diff). If you find `// replica ADAPTATION:` copies from
an older run, re-copy the shipped scripts and pass flags instead.

The narrow exception: **a documented instrument-bug fix is the correct
move when the shipped instrument measures falsely** — fail-loud outranks
script immutability. The rule above exists to kill stale re-implementations
of upstreamed flags, not to force gating on an instrument known to lie. A legitimate instrument fix is (a) commented in the
script with the defect it corrects, (b) recorded in the ledger with the
runs it invalidates, and (c) flagged for upstreaming into the plugin. An
uncommented, unledgered edit is still a defect.

## The published-origin gate (EDS pipeline deltas)

The prototype gate above proves the RECREATION; it does not prove the
DELIVERED page. Local render harnesses systematically understate deltas
because the real delivery pipeline transforms the markup — a page gating at
X% on the harness lands elsewhere on the published origin until the transforms below are
handled. **Only the published-origin number counts as the final gate** for
a platform-delivered page: re-run the full gate (same instruments, same
pass bar, same iteration discipline) with the live site as source and the
published page — preview or live origin — as build. Judge the result in the
published-origin regime (§ Pass bar, calibration honesty), not against
prototype-regime numbers. It runs at **every configured breakpoint**: a
breakpoint without a published-origin number is `ungated` in the ledger
(`published.<bp>` absent, § Residual logging format) and in every report —
never passed, never inherited from the prototype number.

Before the final run: `skills/deploy/scripts/served-check.mjs <css|js-url>
--same-as <local-file> --wait 180` exits 0 for every block CSS/JS the round
touched and `… <page-url> --grep <marker> --wait 180` for the page marker —
`../../deploy/reference/deployed-reconcile.md` § The six reconcile checks
(a gate run earlier measures yesterday's code). Two rules for that final run:

- **Re-probe live chrome metrics at deploy time — crawl captures are the
  CONTENT source, live-now is the chrome/metrics source.** The live site
  drifts between crawl and deploy. A deploy gated against
  crawl-time captures ships yesterday's chrome. Immediately before the
  published-origin gate, re-run
  the chrome probes (anchor + crop gate, computed styles of matched
  header/footer elements) against the live origin, never the crawl
  snapshot; mask live-content drift (campaign creatives, promo slots) out
  of the fidelity number — it is authored content, not conversion fidelity.
  Run the round with `--refresh --variance`: the drift probe decides
  whether the reference is recaptured, the self-noise floor tells a rotating
  campaign slot from a conversion defect before any CSS round is spent.
- **Budget ONE anchors-driven reconcile round at the published origin.** The
  pipeline shifts vertical rhythm (section wrappers, `<p><picture>`,
  fragment chrome): a gate-passed prototype first publishes above the bar,
  and one or two text-anchor rounds (anchor probe live-vs-published, patch
  section paddings in block CSS, re-measure) bring it back with anchor
  parity. Treat the pre-publish harness number as provisional
  and the reconcile round as expected work, not a regression.
- **Two published-origin rounds without improvement → stop editing CSS.**
  The number is then not a CSS problem. Run, in this order: the served-hash
  check (§ Iteration discipline — CDN `max-age` serves the previous round
  for hours); the DOM
  ladder published-vs-prototype (which wrappers the pipeline added); the
  landmark Δy table (`anchor.mjs --landmarks --against`); the
  text-wrap diff (line counts per matched paragraph). CSS experiments run
  on a branch host (`<branch>--<repo>--<owner>.aem.page`), never as
  commit/revert on `main` — every revert is a live publish and a phantom
  round.
- **Run the published-origin gate and the qa sweep sequentially, never
  against the same `aem.live` host at once.** The origin rate-limits per
  host; a 429/503 during the gate is infrastructure state, not a fidelity
  delta — the gate has no verdict for that page (re-run it), and qa reports
  the same condition as `<check>/unmeasured` / exit 2
  (`../../qa/reference/checks.md` § Cross-cutting).

Recurring EDS pipeline transforms that move the number (none visible on a
local harness):

- **Images get wrapped in `<p><picture>`.** The pipeline emits every
  authored image inside a paragraph. If any base rule makes that `<p>`
  positioned, absolutely-positioned imgs inside it collapse to 0×0
  (backgrounds vanish) and the now-empty paragraph box distorts flex/grid
  flow. Style `p:has(picture)` as the media layer, and expect specificity
  fights with `:not()`-heavy base selectors — junction/override rules must
  match or exceed them.
- **Metadata-only sections render as empty `.section` divs** carrying full
  section padding — a ~96px phantom band, typically at the page tail (the
  same class as deploy's `emptySectionCollapse`; the fix there is
  `main .section:empty { display: none }`, see
  `../../deploy/SKILL.md` § Runtime-detection probe).
- **Media URLs are rewritten to `/media_<hash>` renditions** with width
  params — size/ratio assumptions lifted from the authored URL don't
  survive; read dimensions from the delivered rendition, not the authored
  asset.
- **Authored inner blocks may be FLATTENED to default content**, so a
  selector written against the authored markup
  (`.section:has(.some-block)`) can silently never match the delivered
  page. Verify every `:has()` / block-class selector against the
  delivered `.plain.html` and rendered DOM, not the authored file.

## Residual logging format

Per archetype per breakpoint, in `stardust/replica/progress.json`. The
`result` object is COPIED from the instruments — `gate.sh` writes it every
round as `gates/<slug>-<width>/gate-<label>.json` (pixel-compare
`--json-out` plus `regime`, `ref` and the verdict) — never typed: a
hand-typed number is where masked and unmasked figures, regimes and
reference dates get mixed up.

```json
{
  "pageType": "landing",
  "archetype": "home",
  "breakpoints": {
    "1440": {
      "iterations": 3,
      "result": { "regime": "prototype", "structuralRed": 0, "visualFlags": "3 justified",
                   "pixelPct": 1.31, "pixelPctUnmasked": 4.02, "heightDelta": 0, "pass": true,
                   "masks": [ { "kind": "band", "class": "authored-volatile-masked", "spec": "1200:600@1210", "areaPct": 8.3 } ],
                   "ref": { "url": "https://<site>/", "width": 1440, "capturedAt": "<ISO-8601>" },
                   "at": "<ISO-8601>", "build": "a1b2c3d", "run": "<status.jsonl run start — optional>" },
      "justified": [
        { "probe": "visual", "flag": "1x1 h1 at x0", "why": "mirrors live SEO h1" },
        { "probe": "content", "flag": "🟠 font fork ×2", "why": "licensed kit substituted, R-policy fonts", "permanent": true }
      ],
      "residuals": [
        { "band": "y 4500–5000", "pct": 6.2, "cause": "capture-state", "what": "3 CDN-403 placeholder tiles", "flaggedFor": "delivery",
          "artifacts": [ "gates/home-1440/diff-iter3.png", "gates/home-1440/anchor-iter3.txt" ], "acceptedBy": "user" },
        { "region": "footer", "pct": 4.8, "cause": "glyph-antialiasing", "parity": "gates/home-1440/chrome-parity-iter3.json", "texture": { "thickPct": 6.1 }, "flaggedFor": "user",
          "artifacts": [ "gates/home-1440/chrome-parity-iter3.json", "gates/home-1440/crop-footer-iter3.json" ], "acceptedBy": "hands-off-policy:glyph-antialiasing" }
      ],
      "captureState": [ { "what": "product tiles 4–6 on placeholder data-URIs", "where": "carousel-2" } ]
    },
    "360": { "...": "..." }
  },
  "published": {
    "1440": { "result": { "regime": "published-origin", "pixelPct": 6.5, "heightDelta": 2, "pass": true, "ref": { "...": "..." } },
              "url": "https://<branch>--<repo>--<org>.aem.page/", "artifacts": [ "gates/home-1440/gate-pub1.json" ] }
  }
}
```

`iterations` and `result` come from `gate.sh --record` (it counts the
rounds from the round records and copies `pass`, never typed). Every
residual carries `artifacts[]`
(the instrument outputs that show it) and `acceptedBy`: `user`,
`register:R-nn`, or `hands-off-policy:<class>` — the last only for the
table's **permanent** classes; an entry missing either is invalid and the
breakpoint is FAIL. `published.<bp>` holds the published-origin result per
breakpoint (§ The published-origin gate); a breakpoint absent there is
`ungated` — reported as such, never as passed. `../scripts/gate-ledger-lint.mjs`
is this ledger's reader (rollout Setup, `migrate` before any A′ render; `--published`
reports `published.<bp>` and the coverage line): it applies § Pass bar to `result`
and this residual rule per configured breakpoint — a shape it cannot read is
not a pass.

`result` fields: `regime` — `prototype` (standalone prototype vs live) or
`published-origin` (delivered page vs live, § The published-origin gate);
`pixelPct` — the gated number, masks excluded; `pixelPctUnmasked` — the
same captures matched with no mask, the number an outside audit reads
(equal to `pixelPct` when nothing was masked); `masks[]` — every mask
with its kind, class and area % of the compared area (`spec` for bands, `sel`/`src` otherwise; `asymmetric` when one side only); `ref` — the live capture the
number was measured against (URL, width, capture time); `at` — when the
gate ran; `build` — the code commit measured against; `run` (optional) —
the `status.jsonl` run start. Every row is provenance the hand-off prints
(`skills/stardust/reference/handoff-report.md` § Gate table first); a
number without `regime` is not printed, and regimes are never compared
(§ Pass bar, calibration honesty).

### Residual classes

A residual's `cause` starts with a class id from this table or `register:R-nn`
(a trailing description is fine: `capture-state: 3 CDN-403 tiles`); anything
else is an unfinished iteration — diagnose it into a class or spend the
remaining budget on it. `flaggedFor` names who inherits it
(`delivery` — resolved when authors or wiring land; `user` — an accepted
trade-off). A permanent class can never zero out: log it once with its band
and %, do not chase it.

| class id | detection cue | standard exclusion | inherits | permanent |
|---|---|---|---|---|
| `glyph-antialiasing` | crop-compare texture thin-edge, chrome-parity quiet, text-dense band (§ Pass bar, item 5) | none — stays in the number, logged with both artifacts | user | yes |
| `third-party-in-flow` | a band whose live content is a third-party widget in document flow (chat launcher, feedback badge, social wall) rendering per session | `masks.json` `sel` entry (rule 19); the widget is wired at delivery | delivery | yes |
| `tag-injected-tail` | doc height grows at the page tail between captures (tag-manager legal copy, consent footers), content-diff EXTRA at the end | recapture the reference; if it persists, `--mask` the tail rows | user | until recapture |
| `index-driven-content` | listing/results items change between captures (news, search, feeds) | `--mask` the listing band, or mirror the same data source | delivery | yes |
| `photo-reencoding` | diff spread evenly over an image whose anchors match — rendition or compression differences | `masks.json` `kind: images` (rule 19): geometry-matched rects only; the `photo-dominated` line is ledgered | delivery | yes |
| `live-drift` | live changed since `ref.capturedAt` (campaign, copy edits): content-diff MISSING/EXTRA on fresh text, height Δ explained by a new element | delete `live.png` and recapture — a stale reference is not a residual | — | no |
| `nondeterministic-live` | tickers, "last updated" dates, counts, personalization slots — live differs from itself run to run | replicate the structure, freeze one captured value, `--mask` | user | yes |
| `live-data-embed` | third-party iframe or widget carrying moving data | load the SAME src on both sides so the data cancels; log the timing-skew remainder; decided-out embeds: `masks.json` `kind: iframes` | user | yes |
| `randomized-decoration` | generative line art, particle fields regenerated per load — live never matches itself | `--mask` the band | user | yes |
| `personalised-region` | store or recommendation rails, ad slots: hundreds of px vary between loads by cookie or geo | pin storage state; `--mask` the region | delivery | yes |
| `skip-link-focus` | a thin band at the top present in one capture only — a skip link or focus ring left visible after a dismissal click | instrument fix (blur the active element before capture); the run does not count against the cap | — | no |
| `fixed-disc-at-seams` | the same small shape (chat disc, back-to-top) repeats every `vh` px | replicate the element fixed on both sides (`recreation-procedure.md` § Fixed and sticky chrome); `--mask` only as last resort | delivery | no |
| `subpixel-layoutunit` | a whole band shifted 1px, anchors Δy ±1 — a fractional layout unit rounding differently per engine path | none — logged with band and % | user | yes |
| `icon-font-substitution` | chrome-parity ICONS signature mismatch on a licensed icon font the new host cannot ship | harvest the live vectors first (`recreation-procedure.md` § Asset harvest, icons); residual only when the licensed face is unavailable | user | yes |
| `capture-state` | CDN-403 placeholders, hydration states, fallback type on a face that fails for real browsers too (rules 8 and 14) | replicate as captured; real assets wired at delivery | delivery | until delivery |
| `authored-volatile-masked` | campaign heroes / promo creatives that changed between capture and gate | `--mask` — every mask on the verdict line and in `masks[]` | user | n/a (masked) |

The rollout phase's final report surfaces the residual list per page type
so "gate passed" can't hide "passed with 6% unexplained".
