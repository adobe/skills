# Source-fidelity gate (the measured heart of replica)

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
| Structural content + type | `../../diff/scripts/content-diff.mjs` (project copy) | dropped/mis-slotted headings·eyebrows·CTAs, invented/dropped copy, rendered-face font forks (width probe); dropped `placeholder`/`aria-label` values, missing/wrong/moved icons — on the main root AND the chrome roots (`header`, `footer`) by default | geometry |
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
# Serve the prototype from its own dir so relative assets resolve. ONE server,
# ONE port — probe with curl before starting one (lsof is optional, often absent):
curl -sI localhost:8791/ | head -1                       # 200/404 = something serves the port; no line = free
curl -sI localhost:8791/<slug>-proposed.html | head -1   # 200 = it serves YOUR dir: reuse it
# Answers but not your file → foreign server: never kill it, take a per-project port. gate.sh asserts
# a page marker (exit 4); on shared machines pass --marker "<brand string>" (a shared slug false-passes).
(cd stardust/prototypes && python3 -m http.server 8791 &)   # only when nothing answered
PROTO="http://localhost:8791/<slug>-proposed.html"
LIVE="https://<site>/<path>"
W=1440   # then 360
GATE="stardust/replica/gates/<slug>-$W"

# 1. structural — --dismiss keeps consent + timed marketing modals out of the
#    inventory on both sides; add extra selectors for non-standard closers.
#    The header and footer roots are compared beside --main BY DEFAULT — this is
#    the whole command, no chrome flag; the report has one block per root and a
#    finding reads "[header]" / "[footer]" where it sits (--no-chrome = main only)
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
across iterations — re-take it only if it is genuinely stale (site changed,
capture hardening changed). This is a bot-block control, not just a cost
note: content-diff + visual-diff each navigate the live URL per run, so a
full 3-iter, 2-breakpoint gate is already ≈12–18 live hits, and hard-CDN
sites (recorded: an Akamai-defended luggage retailer) escalate to an IP block after a handful.
The prototype capture is re-taken every iteration.

## Pass bar (all five per breakpoint, plus the content-cap row)

1. **content-diff: 0 structural 🔴 — across the main root AND the chrome
   roots (`header`, `footer`), which the default run covers on every gate
   page; each finding line names its root.** 🟡 (body/EXTRA, a missing
   `title`, an `ICON MOVED` — the same icon at another anchor, e.g. inside a
   text-less accordion button) and 🟠 (font fork) confirmed intended — a
   substituted licensed font is a permanent justified 🟠; record it once in
   the ledger.
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
5. **Chrome crop gate: header band AND footer band each ≤ 2% diff (≥98%
   match, #115).** The full-page bar dilutes the chrome — header/footer are
   a small share of page pixels but carry disproportionate visual weight
   and repeat on every page of a rollout. Two field runs shipped
   full-page-green pages whose chrome measured only 93–97% (lookalike
   icons, wrong micro-weights, off-by-10px nav rows all fit inside a ≤10%
   full-page bar). Run `../scripts/crop-compare.mjs` over the SAME stitched
   captures the pixel probe used — no extra live hit — once per breakpoint
   (`$GATE` is per width), header band then footer band:

   ```bash
   B="$GATE/proto.png"   # $GATE/build.png when gate.sh took the round's captures
   NAV_H=<header bottom edge>  FOOTER_H=<footer height>
   LIVE_H=<live capture height>  PROTO_H=<prototype capture height>
   node stardust/scripts/replica/crop-compare.mjs "$GATE/live.png" "$B" \
     --y 0 --height $NAV_H --threshold 2 --out "$GATE/chrome-header-diff.png"
   node stardust/scripts/replica/crop-compare.mjs "$GATE/live.png" "$B" \
     --y $((LIVE_H - FOOTER_H)) --y-b $((PROTO_H - FOOTER_H)) --height $FOOTER_H \
     --threshold 2 --out "$GATE/chrome-footer-diff.png"
   ```

   Exit 2 = that band is over 2%. `--y-b` aligns the footer crop per side so
   a small doc-height delta does not read as a false full-band diff. The
   four numbers, none of them a new live hit:
   - `NAV_H` — the live header's bottom edge, `rect.y + rect.h` (y is 0 unless
     a strip sits above the header): `data.header.rect` in
     `$GATE/chrome-live.json`, the live cache `gate.sh --full` and
     `chrome-parity.mjs --live-cache` write (`json-query.mjs
     $GATE/chrome-live.json --path data.header.rect`); no cache yet →
     `measure.mjs "$LIVE" --selectors header --width $W` (one live hit).
   - `FOOTER_H` — the `h` on the `y … h … footer` line `anchor.mjs` prints per
     side (`--json` field `footer: [y, h]`; live side cached in
     `$GATE/anchor-live.json` under `data.footer`). That line's `y` IS
     `docH − footerH` while the footer is the last box — pass it straight to
     `--y` / `--y-b` when you have it.
   - `LIVE_H`, `PROTO_H` — the capture heights on pixel-compare's first verdict
     line, `A <w>x<h>  B <w>x<h>  → compare …, height delta …px`
     (`run-bg.mjs wait` surfaces it; stitch-shot's `stitched <file>: <w>x<h>`
     line is the same number per side).

   **Styles diagnose, pixels confirm — run the computed-style parity probe
   BEFORE any pixel iteration on chrome.** `../scripts/chrome-parity.mjs`
   probes the same regions on live and build (default `header` + `footer`;
   add sticky strips with `--region strip=<liveSel>|<buildSel>`), pairs
   every text-bearing element by its text, and prints only what differs:
   family / size / weight / style / line-height / letter-spacing /
   transform / colour / background / padding / radius, the element rect,
   the clickable box of links and buttons, and the icon inventory
   (count + size + signature, paired by order). Recorded: one run found
   what many pixel-band rounds had not — an italic-vs-normal note, a
   regular-vs-bold link, a wrong nav link colour, 12px row offsets, a 97×40
   vs 71×32 button, six missing icons. Fix every delta, re-run until it is
   quiet (exit 0), THEN crop-compare — a pixel loop on chrome with parity
   deltas outstanding is wasted iterations. Each run is one live
   navigation (budget it like any live probe); `--json` records both
   sides as the round's evidence.

   ```bash
   node stardust/scripts/replica/chrome-parity.mjs "$LIVE" "$PROTO" --width $W \
     --region header=header --region footer=footer   # + --region strip=<sel>|<sel>
   ```

   **Glyph-dense chrome has a pixel noise floor — the ONE justified way past
   the 2% bar, and it is evidence-gated three ways.** A footer of ~50 links
   bottomed out at ~5% pixel diff with family, size, line-height, weight,
   colour, pitch and positions all numerically identical (recorded): per-glyph
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
   strips, footer.** Recorded: the header measured 33.9% and a quick-links
   strip 19.2% while the full page passed at 6.5% — chrome is small-area,
   highest-salience and repeats on every page. Two traps: (a) a fixed-y crop
   produces FALSE reads the moment either side's rhythm shifts — a 35px nav
   fix moved everything below it and the strip crop read 66% while the strip
   itself, re-anchored to its own band edges, was at 1.6%. Locate each
   region on EACH side (its element rect via `anchor.mjs`, or its band
   edges via `row-profile.mjs`'s column scan) and pass both anchors
   (`--y`/`--y-b`); every gate round re-reads the anchors. (b) Regions whose
   live content is authored-volatile — campaign heroes, promo creatives that
   change between capture and gate — are masked out of the fidelity number
   with `pixel-compare.mjs --mask <yA:h[@yB]>` (printed on the verdict line,
   never silent): they are authored content, not conversion fidelity, and
   chasing them burns iterations on a moving target.

Applied inconsistency-register entries create expected deltas: cross-
reference the entry ID (`R-<nn>`) when justifying a flag over its zone
(`preserve-direction.md` § Gate interaction).

**Outside the numbered bar, and outside the iteration cap: the
horizontal-overflow assert.** `document.documentElement.scrollWidth` is
within 4 px of the viewport width (`GATE_OVERFLOW_TOLERANCE`, integer
rounding) at every gate breakpoint on the build side, evaluated on the
published origin for a delivered page. It is not a bar item because a
bar item can be traded for a documented residual; this cannot
(§ Iteration discipline, the HARD assert). `gate.sh` runs it every round
and prints the verdict line; `measure.mjs` prints the number on its root
line for any ad-hoc read.

6. **Content-cap row — once per archetype after the 1440 pass, at the
   DERIVED wide width (#116 → #124).** Both gate widths are narrower than
   most caps and render a resolved px and an authored `%` identically, so
   a build that renders edge to edge (recorded: live 1920 px shell + 1600 px
   article, build token declared and never applied) or a frozen fluid value
   passes them by construction. `node stardust/scripts/replica/cap-probe.mjs
   "$LIVE" --against "$PROTO" --design DESIGN.json --slug <slug> --main
   "<content-root>"` — one live navigation at DESIGN.json's `probeWidth`
   (max(2560, largest cap × 1.25); a probe AT a cap's width cannot see it —
   never pin 1920). Pass = every live cap held within ±20 px at the same
   KIND (wrapper, then one module per top-level section — never by DOM depth,
   EDS section wrappers are full width by design), nothing capped only on
   the prototype; a ✗ names the sizing rule (deploy Step 3 scaffold; re-lift
   per `recreation-procedure.md` § Lift the sizing MODEL), never a pixel
   iteration. Evidence: `stardust/replica/gates/<slug>-<probeWidth>/cap-<label>.{json,txt}`.

**Calibration honesty — two fidelity regimes, one bar.** The validated
numbers above (1.31%, Δ0) describe the **prototype regime**: a standalone
prototype gated against the live page, on a typographic page. Pages
converted to the delivery platform and gated against the **published
origin** (§ The published-origin gate) carry justified block-model deltas —
control UI, split anchors, nondeterministic elements — and landed at
6.9–9.9% in the field while visually faithful. The ≤10% bar covers both
regimes; what burns iteration caps is chasing prototype-regime numbers on a
published-origin gate. Record which regime a number belongs to in the
ledger, and judge each against its own regime's precedent.

7. **In the pixel table (#125).** Every crafted prototype and every deployed page is a
   row in `stardust/replica/gates/prototypes-<w>/summary.md` (gate-all `--stage
   prototype`, run at the end of Phase 4) or `…/all-<w>/summary.md` (delivery), with
   its measured number, height delta, clipped count, verdict and evidence dir.
   `gate-evidence.mjs` reads the table as the source of record: a page without a row is
   ungated, whatever its sidecar or a `gate.sh` log says. Inside a `--full` round the
   element probes rule a PASS the way the overflow assert does: `clip-probe: Clipped: n`
   with n > 0 (every regime), a `content-presence` MISSING / HIDDEN link or heading
   (published regime), a required repeated unit off (`stardust/replica/units.json`).

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

**The section-anchor probe names the section the band table only points
at.** `../scripts/anchor.mjs` prints `[y, height]` per top-level section
(+ footer + doc height), same shape on both sides:

```bash
node stardust/scripts/replica/anchor.mjs "$LIVE"  --width $W   # once per fix round at most (live hit)
node stardust/scripts/replica/anchor.mjs "$PROTO" --width $W   # free — build-side only
```

Diff the two outputs, fix the FIRST section whose `[y, height]` disagrees
(top-down — everything below it is offset-contaminated, the same rule as
the band table), re-run pixels. Field-validated (a financial-services site, 8 pages): this
loop roughly halved iterations vs band-reading alone. `../scripts/gate.sh`
wraps one full pixel round (stitch both sides — live cached — + compare +
verdict) in one command.

Section-level compare (crops) is the escalation when a band stays hot and
the cause isn't visible in `diff-iter<N>.png` — in the validated run it was
prepared and never needed, because re-authoring hit exact section heights.
`crop-compare.mjs` (the chrome-gate script, pass-bar item 5) does exactly
this for any y-band, not just chrome.

**Two row-level instruments replace eyeballing crops (`../scripts/row-profile.mjs`,
runs over the same stitched PNGs — no live hit):**

- **Column scan for layout boundaries.** Before editing CSS to fix a section
  height, photo height, band start or card overlap, read the per-column
  class transitions (white / dark / brand / photo at N x positions) on the
  capture: `node stardust/scripts/replica/row-profile.mjs live.png proto.png
  --columns 7`. Recorded: a stacked-crop visual read suggested a 415px photo
  with a white band under it; the scan of the same capture proved the photo
  full-bleed to 499px with the "white band" being an overlapping card — the
  wrong read cost two build/measure cycles. Crop eyeballing is hypothesis;
  the scan is the measurement.
- **Brand-colour landmarks for vertical alignment.** Band percentages say
  WHERE diffs are, not by how many pixels sections are offset. When a
  saturated brand colour recurs in every section (CTA buttons are ideal),
  `--color <#rrggbb>` lists every row run dominated by it on both sides and
  pairs them in order: the per-pair delta is each landmark's offset, and the
  CHANGE in delta between consecutive pairs (`gapShift`) names the one
  inter-landmark CSS gap that absorbed the shift. Patch that gap, re-measure,
  top-down — the same contamination rule as the band table. Recorded: three
  passes driven this way took a page 16.9% → 11.05% and a 1559px height
  delta → 48px. Do not tune margins by eye against crops. (Crop with pngjs;
  macOS `sips --cropOffset` is unreliable for band crops.)

## Iteration discipline

**Hard cap: 3 iterations per breakpoint.** Matching the validated run's
discipline — convergence happened within 3 with the recreation procedure
followed; more loops mean the inputs were wrong (values eyeballed instead of
lifted, capture unhardened), and the fix is upstream, not a fourth loop.

- Measure first (iteration 1 IS the map — do not pre-polish).
- **Chrome: parity probe first, pixels second.** Before a chrome band's first
  pixel round, run `chrome-parity.mjs` and clear its deltas (§ Pass bar,
  item 5); style deltas are named in one pass, pixels only say where.
- Every fix cites the instrument line that demanded it.
- **Before counting an iteration, verify the fix changed the render.** A
  byte-identical differing-pixel count after a "fix" means the rule was a
  no-op (recorded: a padding whose value the EDS section wrapper already
  carried — the round measured nothing and was burned). The check is free —
  the count is already on the verdict line; if it didn't move at all, find
  out why the rule never applied (specificity, wrong selector, value already
  in effect) before spending another round.
- **Verify geometry fixes on the RULE-BEARING element, cache-free (#117).**
  One field "parity verified" claim was wrong three ways at once: the probe
  matched a heuristic element ("white column wider than 400px") that wasn't
  the box carrying the lifted rule — always pair the same semantic element
  on both sides (the element the fixed rule targets on the build; the
  element whose source rule was lifted on live); the re-check ran through a
  CACHED stylesheet (DevTools showed the old rule at its old line number
  while both hosts already served the fix) — verify serving out-of-band
  (`curl --compressed <css-url> | grep '<new-rule>'`; the CSS is
  gzip-encoded, a bare `curl | grep` scans binary and silently matches
  nothing) and re-render in a fresh headless context; and a reviewer's
  screenshot encodes their zoom — back-compute their CSS viewport from any
  element with a known percentage rule (a card at 851px under `width: 50%`
  → viewport 1702px) and reproduce THAT viewport headlessly before letting
  their numbers overturn a fix.
- Probe schedule per fix round: **pixels every round; content-diff +
  visual-diff at milestones** — iteration 1, after any fix that touched
  content or markup (not pure CSS values), and once at final. Across ~25
  field fix rounds (financial-services site), pixel-only rounds never regressed structure
  once it passed, and each content/visual re-run costs 2 extra live
  navigations — against this doc's own hit-minimization rule. A fix that
  touched markup re-runs all three; a CSS-value fix re-runs pixels only.
- **The section-anchor probe is the fast inner loop** (`anchor.mjs`, § Band
  breakdown): run it on both sides, fix the first mismatched section
  top-down, re-run pixels. Build-side anchor/computed-style passes never
  navigate the live origin and are FREE — the cap governs live-gate cycles,
  not measurement.
- After iteration 3: log residuals (§ Residual logging) and move on. A
  documented residual is a pass with an asterisk; an undocumented fourth
  loop is scope creep.
- **HARD assert, not subject to the cap: `document.documentElement.scrollWidth`
  no more than 4 px over the viewport width at every gate breakpoint,
  evaluated on the published origin** (`GATE_OVERFLOW_TOLERANCE`, default 4:
  scrollWidth and clientWidth are integers, so a correct page whose widest
  box is 360.4 px reads +1; the qa skill's rendered sweep fails above the
  same 4 px — a real overflow is 13 px and up). A recorded hands-off run delivered two pages that rendered 373 px
  and 400 px wide at a 360 viewport — accordion headers and a blockquote
  overflowing, text clipped — and the gate logged `|Δ| 19–26 px at 360 …
  logged, not iterated further (3-iteration cap reached)` and passed them.
  Horizontal overflow is not a residual class. `gate.sh` runs `measure.mjs`
  on the BUILD side every round (no live hit) and reads its root line —
  `root  scrollWidth <n>  viewport <n>  scrollHeight <n>  ◄◄ OVERFLOW +<n>px`
  — so a build wider than its viewport prints `gate.sh: OVERFLOW at <w> —
  build scrollWidth <n> > viewport <n> (+<n>px) → FAIL` and the round exits 2
  whatever the pixel number says; `gate-evidence.mjs` records `FAIL:
  horizontal overflow +<n>px` over a PASS pixel line and withholds
  `pixel-gate-<w>`. No iteration cap, residual entry or register entry
  waives it: a page whose scrollWidth exceeds the viewport at any gate
  breakpoint is not verified, and the published-origin round (§ The
  published-origin gate) is where it finally counts. Diagnose with
  `measure.mjs "$BUILD" --selectors "<candidates>" --width 360 --all-matches`
  — the box whose `x + w` exceeds the viewport; the recorded causes are a
  desktop px width or `min-width` carried into the mobile pass,
  `white-space: nowrap`, an unbroken string without `overflow-wrap`, a
  content-box / border-box fork that adds padding beyond 100 %
  (`recreation-procedure.md` § Box model is a lifted value), a negative
  margin, `100vw` on a page with a scrollbar. When the LIVE side itself
  overflows at a breakpoint (the root line on side A says so), the replica
  does not mirror the defect: register the fix as an inconsistency entry and
  build without overflow — the assert holds on the build regardless.
- **Capture exit 1 is "re-queue", not a verdict.** Under parallel Chromium
  load (three rounds in flight, nine Chromiums with `--full`) a recorded
  hands-off run saw about 8 of 62 sibling gate rounds end in `build capture
  failed (exit 1)` and read them as verdicts. `gate.sh` retries a capture
  that exits 1 — live, build or the overflow probe — ONCE before declaring
  anything (`gate.sh: <step> exited 1 — retrying once`); when both attempts
  exit 1 the round exits 1 with `(twice: no verdict — re-queue the round)`.
  Treat it exactly like exit 124: start the same round again through
  `run-bg.mjs`, count no iteration, never write it into the ledger as a
  FAIL (`gate-evidence.mjs` records it `OPEN: no verdict (exit 1)`). Exit 3
  (bot challenge) and 4 (identity) are final on the first attempt. Do not
  raise `RUN_BG_SLOTS` to make room — the default 3 is the pacing that keeps
  the retry rare; lower it on a small machine.
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
  delete the file to re-probe. Recorded without it: a chrome-parity round
  on an AEM site cost 5½ minutes of live settle per iteration, ×3
  iterations ×4 archetypes. On hard-CDN sites
  (Akamai-class), take the live captures with `--headed` and treat further
  live hits as spent budget — the recorded failure mode (luggage retailer) was an
  IP-level block escalating within ~3–4 automated requests, after which
  iteration 2's numbers measure the block, not the site. A challenged
  headless run costs exactly **1** hit: `gotoLive` throws
  `BotChallengeError` on the first challenge-classified response (the
  wait+reload solve window runs only under `--headed`, where clearance can
  actually land) — so the block budget is still intact when you escalate.
- **Instrument deadlines are the gate's, not yours.** `gate.sh` runs each
  capture under `run-capped.mjs` (stitch 300 s, compare 120 s —
  `GATE_STITCH_TIMEOUT` / `GATE_COMPARE_TIMEOUT`) and reaps this user's
  replica instruments older than 15 minutes before a round (`GATE_REAP_MIN`,
  0 disables); `pixel-compare.mjs` supervises its own `--timeout` (120 s)
  when run alone. Exit 124 is "no verdict — re-run", never a FAIL. Do not
  wrap the instruments in your own `sleep N; kill` guard: three field
  migrations did, after `pixel-compare` sat at 0 % CPU for 10+ minutes
  (a Node exit-path hang, fixed in the script and now reproduced in a
  test), and a page's four rounds then spent a fixed 30 minutes sleeping.
  When a capture legitimately needs longer (a 10k-px page under `--settle`),
  raise the variable for that page and say so in the ledger.
- **A step never outlives the context cache — long instruments run in the
  background, and the step that waits for them returns in bounded slices.**
  The agent's prompt cache lives about five minutes past its last model
  call; a step that blocks longer evicts it, and the next call re-writes the
  whole context at the cache-write price. Recorded 2026-09-18 (hands-off
  run, 26 pages, 1440+360): one gate batch — three parallel steps, each
  `sleep 5|10|15;` then two rounds and a content-diff — blocked for 15
  minutes; the next call wrote 513k tokens of cache, **$6.30 for one silent
  gap, more than the rounds it waited for**, while every other gap in that
  session stayed under 184 s at a 96 % cache-hit ratio. So: `run-bg.mjs
  start --name <slug>-<w>-<iter> -- gate.sh …` for every round at once (the
  default 3 slots, `RUN_BG_SLOTS` to move them, launch the rounds first come
  first served — each capture is a Chromium, a `--full` round three, and the
  slots replace the `sleep N;` staggering), then `run-bg.mjs
  wait` (returns within `--max`, default 100 s, ceiling 110 s — inside the
  shell tool's ~2-minute default timeout, which applies only to a call that
  declares none) prints one
  line per job plus its verdict lines; exit 75 means "still going — `wait`
  again as your NEXT step". Never wrap `wait` in a shell loop: that
  recreates the blocked step; between waits do independent work, and read
  a round's ledger at most every 4 minutes (the master skill's wait
  discipline — recorded: 5–10-minute foreground sweeps, 58 % of which
  re-wrote the whole prompt prefix). The full instrument output stays in
  `stardust/.work/replica/bg/<job>.log` — read it with `run-bg.mjs log <job>
  --grep <re>`, not with `cat`; the same session carried 700k characters of
  tool output in 77 minutes, and a verdict is four lines of it.
- **Media-density budget.** The ≤3-iteration convergence was validated on a
  typographic, low-image page (the retail home). Image-dense commerce homes
  (recorded: a fashion retailer, ~130 imgs) spend iterations on media parity —
  populating grids, matching crops — before geometry work even starts.
  Budget accordingly: on a media-heavy page, image/media parity IS
  iteration 1's job; geometry starts at iteration 2.
- **A pixel pass at the wrong metric is debt — spot-check base typography
  against live computed styles once the gate passes.** An archetype shipped
  16px card body text (live: 17.6px) and still passed at 5.24% because the
  tuned spacing absorbed the size error; siblings with more text amplified
  it into extra wraps and +80..250px heights (recorded). After the pass,
  read body font-size/line-height per block on both sides (a computed-style
  probe — build-side runs are free) and re-fit rhythm at the true metric.
  Compensating spacing is the tell.

## Hardening rules (false-measurement traps)

Each of these was hit live; skipping one silently corrupts the measurement
rather than erroring.

1. **Real-Chrome UA + the standard request headers on every capture and
   probe.** The default HeadlessChrome UA can receive a Cloudflare managed
   challenge, and the probe then **measures the challenge page as the
   source** (3 headings, "Performing security verification" — it diffs
   cleanly, wrongly). And the UA alone is NOT sufficient: field-proven
   (F-R1, a nonprofit site), a real-Chrome UA with Playwright's minimal default
   headers still got HTTP 403 from Akamai; adding the standard set every
   real Chrome sends (`Accept`, `Accept-Language`,
   `Upgrade-Insecure-Requests`, `sec-ch-ua*`) produced HTTP 200 — Akamai
   bot-manager fingerprints on the *absence* of those headers, not just the
   UA. All three instruments now send both by default via the shared
   `diff/scripts/live-session.mjs`; `--ua` overrides the UA string only.
   The header set rides **document requests only** (F-B2, financial-services site):
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
   of missing CTAs (UC1-E1 iteration 1: 41 of 50 reds were scoping
   artifacts). Scope BOTH sides with the same selector — have the prototype
   adopt the live content-root class so one `--main` value fits both. Both
   diff scripts take `--main` (visual-diff's is the upstreamed flag: on
   sites without a `<main>`, both sides otherwise false-flag BLANK RENDER
   while the main-scoped checks silently no-op). Two guardrails:
   - **`--main body` is NEVER a valid replica scope.** A too-broad root
     self-poisons the instrument regardless of symmetry: reproduced
     (a furniture retailer), content-diff run live-vs-ITSELF with `--main body`
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
   marketing/newsletter interstitials** — recorded (fashion retailer): an
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
    Recorded (luggage retailer): Akamai served "Access Denied" to the headless
    instruments — which, without this rule, would have silently measured
    the block page as the source and diffed it cleanly, wrongly. The
    escalation ladder: default (UA + standard headers) → `--headed`
    (stealth real Chrome, same tier as crawl.mjs's fallback) → if STILL
    blocked, the site needs crawl.mjs-class capture and **the gate must
    not silently degrade** — record the breakpoint as gate-blocked in the
    ledger and surface it to the user; a gate that can't read the live
    source has no pass to report.
13. **Inner-scroller / scroll-jacked pages fail loud — stitched capture
    cannot measure them.** On pages where `html`/`body` are
    `overflow:hidden` and an inner container scrolls, the document reports
    the full content height but `window.scrollTo` is a no-op — every chunk
    would capture the top viewport and the rows below would stitch as
    zero-filled black: a silently fictitious pixel diff. stitch-shot now
    detects the stall and exits 1 with the signature `stitch-shot error:
    scroll stall at chunk target …px: window scroll is a no-op
    (window.scrollY stuck at …px) while the document reports …px`.
    Capturing the inner scroller is future work; for now record the page as
    gate-blocked for the pixel probe and rely on content-diff/visual-diff.
14. **Captures assert fonts loaded — a silent font fork is a false
    measurement.** A webfont that fails to fetch renders the ENTIRE live
    capture in fallback type: wrong wraps, wrong line counts, wrong section
    heights, wrong doc height — with no error anywhere. It is the same
    defect class as silently measuring a Cloudflare interstitial, and it
    poisons every number the gate reports (recorded, F-B2: an
    instrument-forced header set killed the live side's Typekit fetch; live
    doc height moved 6669→6518 once fixed, and a whole class of
    "one-line-off" defects vanished). stitch-shot now checks after
    `document.fonts.ready` for declared faces with FontFace status `error`
    and warns loudly with the family names; mirror the check in any ad-hoc
    capture. On the warning, decide before gating: load the face in a real
    browser — if it loads there, the failure is **instrument-induced** (a
    capture defect: fix the instrument, and the poisoned runs don't consume
    the iteration cap per § Iteration discipline); if it fails there too,
    fallback type is the truthful capture (**capture-state** — log it).

### Script adaptations (built-in flags first — but fail-loud outranks script immutability)

The four manual adaptations this section used to prescribe are upstreamed
into the shipped scripts. All live-target hardening lives in one shared
module — `diff/scripts/live-session.mjs` (UA + standard headers, challenge
fail-loud, overlay dismissal, headed-stealth escalation) — and the diff
scripts expose it as flags:

```bash
# content-diff against a live source: no source edits, flags only (the header and
# footer roots are compared beside --main by default — no extra flag; --no-chrome opts out)
node stardust/scripts/diff/content-diff.mjs "$LIVE" "$PROTO" --profile generic \
  --width 1440 --main "<content-root>" --dismiss

# visual-diff: --main is a real flag (rule 3), same live hardening
node stardust/scripts/diff/visual-diff.mjs "$LIVE" "$PROTO" --profile generic \
  --width 1440 --main "<content-root>" --dismiss

# non-standard overlay closer / pinned locale / bot-managed site:
#   --dismiss "#custom-close"    --locale en-GB    --headed
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
of upstreamed flags, not to force gating on an instrument known to lie
(recorded, F-B2: the shipped header delivery silently killed live webfont
loads; the session's most important fix was a hand-edit to the project's
live-session.mjs). A legitimate instrument fix is (a) commented in the
script with the defect it corrects, (b) recorded in the ledger with the
runs it invalidates, and (c) flagged for upstreaming into the plugin. An
uncommented, unledgered edit is still a defect.

## The published-origin gate (EDS pipeline deltas)

The published round is the Phase 4 command with the preview origin as the
build URL — `gate.sh <slug> "$LIVE" "<preview-url>" <width> pub1 --full
--marker "<brand or domain string>"` through `run-bg.mjs` — so the same four
probes, deadlines and verdict lines apply; no hand-written wrapper. The
`--marker` is required here: the identity assertion greps the served page for
the marker, and the slug sits in the prototype's file name, not in the
preview page. Keep the ordinary `stardust/replica/gates/<slug>-<width>/`
evidence dir — the `pub<N>` label keeps the round apart, and a new dir would
force a fresh live capture against the hit-minimisation rule.

The prototype gate above proves the RECREATION; it does not prove the
DELIVERED page. Local render harnesses systematically understate deltas
because the real delivery pipeline transforms the markup — field rule
(financial-services site, 8 pages published): a page gating at X% on the harness lands
at X±(large) on the published origin until the transforms below are
handled. **Only the published-origin number counts as the final gate** for
a platform-delivered page: re-run the full gate (same instruments, same
pass bar, same iteration discipline) with the live site as source and the
published page — preview or live origin — as build. Judge the result in the
published-origin regime (§ Pass bar, calibration honesty), not against
prototype-regime numbers.

Two rules for that final run:

- **Re-probe live chrome metrics at deploy time — crawl captures are the
  CONTENT source, live-now is the chrome/metrics source.** The live site
  drifts between crawl and deploy (recorded, one day apart: header 141→106px,
  footer links 13→16px/24px with new 24px column headings, a swapped
  campaign hero). A deploy gated against crawl-time captures ships
  yesterday's chrome. Immediately before the published-origin gate, re-run
  the chrome probes (anchor + crop gate, computed styles of matched
  header/footer elements) against the live origin, never the crawl
  snapshot; mask live-content drift (campaign creatives, promo slots) out
  of the fidelity number — it is authored content, not conversion fidelity.
- **Budget ONE anchors-driven reconcile round at the published origin.** The
  pipeline shifts vertical rhythm (section wrappers, `<p><picture>`,
  fragment chrome): a gate-passed 8.4% prototype first published at 11.75%,
  and two text-anchor rounds (anchor probe live-vs-published, patch section
  paddings in block CSS, re-measure) brought it to 6.5% with exact anchor
  parity (recorded). Treat the pre-publish harness number as provisional
  and the reconcile round as expected work, not a regression.

**`media-reconcile.mjs` is a delivery-chain gate, not a prototype-gate
instrument.** It resolves the images of the DELIVERED content file
(`content/<path>.html` — handoff contract § 1 row 7 and § 3 row C); run on a
prototype or a migrated file it exits 1 by construction, because no content
file exists before C-deliver, and a recorded hands-off run carried
`media-reconcile: OPEN` on every sibling sidecar until delivery for exactly
that reason. `gate-evidence.mjs` records `n/a: no delivered content file
yet` (never OPEN) while the page's content file is absent and leaves the
gate out of the sibling acceptance set; once the file exists the gate is
required again and its verdict counts. Nothing in Phase 4 runs it.

Recurring EDS pipeline transforms that move the number (each recorded;
none visible on a local harness):

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
  page (recorded). Verify every `:has()` / block-class selector against the
  delivered `.plain.html` and rendered DOM, not the authored file.

## The all-pages published-origin gate (gate-all) — four criteria (#125)

**The recorded case.** A 96-page rollout of a pharmacy retailer gated its five archetypes and
shipped the other pages unmeasured; the owner's first feedback was that they "don't look
formatted as the original". A runner then gated every deployed page on stitched 1440 captures
and pixel-compare, and a fix program took the roster from 3 to 67 PASS. Then the coupon-listing
page PASSED at **6.7 % / Δh 69 px** while every one of its 284 cards was broken: a fixed-height
card with `overflow: hidden`, the body ~30 px too low, the description clipped mid-glyph, the
details link pushed under the primary button — and the sort control reading a different default
than the origin. The links WERE in the served DOM; pure CSS geometry. Pixelmatch underweights
small text inside otherwise matching shapes (the text-only number, `--text-boxes`, read 16.5 %).
"PASS" meant "right shapes at the right places", not "every element present and legible".
Element presence and legibility are checkable — so `gate-all.mjs` checks them.

`node stardust/scripts/replica/gate-all.mjs` (project root; through `run-bg.mjs`) runs, for
every `deployed` page in `stardust/state.json`, the stitched captures and pixel-compare of the
archetype gate PLUS two DOM probes that load both pages in the same window-free real-Chrome tier
and settle them the same way (`measure-live.mjs`), and writes
`stardust/replica/gates/all-<width>/<slug>/{origin,eds,diff}.png + pixel.json + content.json +
clip.json [+ units.json]` and `summary.{json,md}`. **Verdict, per page — all four:**

1. **pixel** — overlap % ≤ `--threshold` (default 10).
2. **height** — |Δh| ≤ `--height-tol` × origin height (default 5 %). The overlap crop cannot see
   a render thousands of px too tall; a union (white-padded) metric was tried and rejected
   (white gaps score as matches), so the guard is explicit.
3. **clip** — served-side `clip-probe` count ≤ `--clip-max` (default 0) + the page's allowance
   in `clip-allow.json`. Counted: a text line cut across, whole lines behind an overflow-hidden
   ancestor without a line-clamp, a link or button outside or cut by its clipping ancestor.
   Advisory: line-clamp, "read more" collapsibles, scrollable containers, horizontal cuts.
4. **content** — `content-presence` MISSING + HIDDEN links and h1–h3 headings = 0. Visible
   headings, links (by visible text), buttons, images, text blocks per band (h1–h3 sequence
   aligned by text) plus control STATE. Clipped past 50 % = HIDDEN, not present. Buttons,
   control state and count deltas are reported, not blocking. Regions declared in
   `presence.json` (rails, coupon walls, reviews) compare as counts — HIDDEN still counts.
   Origin not probeable (edge 403, bot challenge) → `content: n/a (<why>)`, never a fail,
   never a silent pass.
   (+ **units** — `unit-geometry` off / hidden / missing = 0 for `units.json` entries marked
   `required: true`; others are advisory rows.)

**The table rule.** `--stage prototype` (pages with a `prototypePath`, build = the served
prototype dir, origin = the archetype round's cached `live.png` when present) writes
`gates/prototypes-<w>/summary.{json,md}`; the default published stage writes
`gates/all-<w>/`. Both are read by `gate-evidence.mjs`: with a table for the width, a
page's row decides `pixel-gate-<w>` and a page without a row is `OPEN: no table row`;
without any table the `gate.sh` logs stand in and `--check` names the missing table. The
eval requires both summaries with a row per page. The pixel-only verdict (1 + 2) is
recorded beside the full one per page and in the totals: every run is calibration data. Sidecars in the gate dir, each entry documented: `masks.json` (printed
on the verdict, never reported unmasked), `overrides.json` (shown BESIDE the measured number,
never replacing it), `clip-allow.json`, `presence.json`, `units.json`. Origin fallback: live
stitch → previous origin (`--recapture-origin`) → crawl fullPage screenshot (`crawl-fullpage`,
asymmetric, flagged). **Browser tier: the best available, registered.** The probes elect real
Chrome (`channel: 'chrome'`, window-free) and fall back to bundled Chromium when it is not
installed; every probe writes the tier it actually ran (`chrome` | `chromium-fallback` |
`chromium`) into its JSON, `summary.md` carries a `browser` column and the calibration line
counts degraded pages — a run that quietly lost its origin measurements on a bot-managed site is
visible in the artifact. Sites without bot management measure identically on both tiers.
`--eds-host` gates a code branch against the same content (branch hosts
serve the LITERAL branch name — `fix/x` → push a mirror `fix-x`). Read a finding as one crop of
the two captures at the row's band, never the whole pages.

**What a failing row means (#126).** The row's evidence decides the fix, mechanically: clip
groups, HIDDEN links or unit deltas confined to one block → fix the BLOCK (CSS or encoder) and
re-gate every page sharing it; MISSING links or images whose content is in the capture → fix the
ENCODER and re-render the affected siblings; MISSING h1–h3 bands, hot bands over most of the
page or |Δh| far beyond 5 % (a banded layout flattened) → RE-PROTOTYPE: the page leaves the
template — the variance probe across the template's other pages decides a new archetype (two or
more share the composition: craft, gate, deploy, migrate its siblings) or a standalone prototype
(an archetype of one); tier and template change in `state.json`, the redirect row stays. Cap: 3
fix rounds per page at the published origin, then this decision — never a fourth round.
Calibration on the recorded roster (96 pages): pixel-only 66 PASS → full 28 PASS; failing by
criterion pixel 30, height 6, clip 23, content 31; content n/a on 37 (edge-blocked origins).

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
        { "band": "y 4500–5000", "pct": 6.2, "cause": "capture-state: 3 CDN-403 placeholder tiles", "flaggedFor": "delivery" },
        { "region": "footer", "pct": 4.8, "cause": "glyph-antialiasing", "parity": "gates/home-1440/chrome-parity-iter3.json", "texture": { "thickPct": 6.1 }, "flaggedFor": "user" }
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
