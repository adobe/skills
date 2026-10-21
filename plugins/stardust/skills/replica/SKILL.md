---
name: replica
description: Same-design migration — re-platform a site to AEM Edge Delivery (or any clean front end) keeping its current design near pixel-perfect. Recreates key pages (one archetype per page type) as clean re-authored HTML/CSS (never DOM copies), verifies each against the live site with a measured source-fidelity gate (structural + visual + stitched pixel diff per breakpoint), then hands off to migrate/deploy/rollout for site-wide delivery (subsumes prepare-migration's prep cascade — never chain the two). The only permitted design changes are entries in an explicit inconsistency register. Use when the user says "migrate this site keeping its current design", "same-design migration", "pixel-perfect replatform to AEM", or "keep the design, change the platform". NOT for redesigns — those are the stardust core pipeline (direct/prototype) or uplift.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, playwright-cli on PATH, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
---

# stardust:replica — same-design migration

Same pages, same content, same design — new platform. `replica` migrates a
site to AEM Edge Delivery (or just re-platforms its front end) keeping the
current design **near pixel-perfect**: the target spec IS the captured current
state, the only permitted deltas are the entries of an explicit
**inconsistency register**, and every archetype must pass a **measured
source-fidelity gate** against the live site before anything ships.

Two properties make this a different animal from the redesign pipeline:

1. **No creative decisions.** The direction step is mechanical promotion of
   the captured spec — the stardust `direct` skill is never invoked. Every judgment
   call in a replica run is a *measurement-policy* call, not a taste call.
2. **Recreation, not copying.** Archetypes are authored as clean semantic
   HTML/CSS from captured content + values lifted from the source site's own
   CSS — never DOM copies, never ported page-level stylesheets. Fidelity is
   proven by instruments, not asserted by construction.

Validated end-to-end (a typographic retail home page, 2026-07-03): 8.31% → 2.93% → **1.31%**
pixel diff in 3 measured iterations, height Δ 0, content-diff "findings:
none" (198/198 nodes).

## Inputs

- `<URL>` — required. The site to migrate.
- `--breakpoints <list>` — optional. Gate widths, default `1440,360`; each
  gets its own gate pass (mobile is not free — gate doc § Per-breakpoint).
- `--target-breakpoints <list>` — optional. Mobile-first `min-width` steps
  (e.g. `600,900,1200`) the delivered site switches layout at instead of the
  source's. Absent = source breakpoints kept, every target step below
  skipped. Persisted in `DESIGN.json` `extensions.breakpoints.target`.
- `--register <file>` — optional. User-supplied inconsistency items to seed
  the register (see Phase 2). Without it and without an audit, the register
  holds no design delta — a pure replica.

## Setup

1. Run the master skill's setup (`../stardust/SKILL.md` § Setup): context
   loader, state read. **Flow guard.** If `state.json.flow` is
   `redesign`, refuse: print the never-mix line and the switch command
   (`$stardust replica --switch-flow`, which marks the redesign flow's
   prototyped and migrated pages stale — master skill § Two migration
   flows). If `flow` is absent, stamp `flow: "replica"`,
   `flowSource: "user-phrase"` (`../stardust/reference/state-machine.md`
   § Flow keys): invoking `replica` is the choice.
2. Verify Playwright is importable from the project root (extract needs it;
   so do the gate scripts).
3. Probe the gate's deps from the project root first —
   `node -e "import('pixelmatch').then(()=>process.exit(0))"` (and playwright,
   pngjs, cheerio) — and only on failure install them AS devDependencies,
   never `--no-save`: `npm i -D playwright pixelmatch pngjs cheerio
   --legacy-peer-deps` (`../extract/SKILL.md` § Setup). A harness that already
   resolves them leaves the delivered code repo untouched; the
   devDependencies otherwise land in the repo the skills push. Run every
   probe from the project root: ESM resolves `playwright` from the script's
   own location.
4. Copy scripts into the project and run them from there, not from the
   plugin: this skill's whole `scripts/` dir to
   `stardust/scripts/replica/`, the master skill's `../stardust/scripts/`
   (ledger.mjs, state.mjs, progress.mjs, browser-lock.mjs, unit-commit.mjs)
   to `stardust/scripts/stardust/` (progress.mjs locks through deploy's
   `file-lock.mjs`: copy that one to `stardust/scripts/deploy/` now), the migrate
   skill's whole `../migrate/scripts/` dir (migrate.mjs, encode.mjs and its
   `encode/` modules; migrate.mjs imports its siblings) to `stardust/scripts/migrate/`,
   AND the whole
   `../diff/scripts/` dir to `stardust/scripts/diff/` (the diff scripts
   import diff-profiles.mjs, and ALL live-target hardening lives in its
   live-session.mjs, which the replica instruments resolve from
   `stardust/scripts/diff/` next to `stardust/scripts/replica/` — keep the
   two dirs siblings). Never copy into the project-root
   `scripts/` — that is the EDS boilerplate's directory (master skill
   § Artifacts, the write boundary). `run-bg.mjs` takes one machine-wide
   browser slot per browser job (`browser-lock.mjs`, slot files in
   `~/.stardust/locks/browser/`): `STARDUST_BROWSER_SLOTS` (default 3, `0` =
   off) concurrent browser jobs across projects, `RUN_BG_SLOTS` paces one
   project's jobs inside them. A job holding a slot gets
   `STARDUST_BROWSERS_PER_SLOT` = max(1, floor(`STARDUST_BROWSER_BUDGET`
   (default 3) / `STARDUST_BROWSER_SLOTS`)): the contract's 3 browsers =
   budget 3 across all jobs; a larger machine raises `STARDUST_BROWSER_BUDGET`
   (and the slots with it, up to the budget). gate-all clamps its pools to it
   (captures sequential at 1) and sizes its roster estimate accordingly;
   gate.sh runs its `--full` probes that many at a time — their times add up,
   hence `--timeout 1800` on a `--full` round (examples below). A job
   waits for its slot queued, without a limit unless `STARDUST_BROWSER_WAIT`
   (seconds) is set; no slot within it → exit 124: no verdict, re-run, never
   a FAIL.
5. Seed the site-wide hide list: `node stardust/scripts/replica/presence.mjs seed`
   writes the runner's overlay selectors (`stardust/.labs/run.json`
   `siteOverlays`, env `STARDUST_SITE_OVERLAYS`) into `stardust/replica/presence.json`.

**Reading and inspection discipline — the context is the budget**
(`reference/reading-discipline.md`, read it once at Setup). Every byte a
step prints is re-read on every later model call. The rules in one line each:
reference docs by section (`section.mjs <doc> --list`, then one heading, one
section per call); captured CSS through `css-rules.mjs`, capture JSON through
`json-query.mjs` (values that feed a command from `--tsv`/`--path`, never the
table), captured HTML through `html-slice.mjs`; instrument output through
`run-bg.mjs wait` and `log --grep`, never `cat`; live-vs-prototype boxes
through `measure.mjs`, any other look at a page through `page-probe.mjs`,
never an authored probe; images one crop per fact,
never a stitched page or the live/build/diff triplet (the extract thumbnail,
`thumb.mjs`, is the one exception); script flags from
`../stardust/reference/scripts-index.md` first, then `--help`, never the
source. Write anything you will need again to a file under `stardust/` and
read it back by query.

## Procedure

Five phases. Phases 1 and 5 delegate to existing skills unchanged; phases
2–4 are owned by `replica`.

### Phase 1 — EXTRACT (delegate to `$stardust extract --prep --dynamics`)

Invoke `$stardust extract <URL> --prep`, unchanged. Prep mode is required —
replica consumes the full migration inventory, not the discovery cap:

- `stardust/current/pages/<slug>.json` — per-page structure + content
  (verbatim source of every string the prototypes will carry).
- `stardust/current/assets/screenshots/` — per-page captures (ground truth
  for recreation, alongside the gate's own stitched shots).
- `stardust/current/assets/` — fonts (network-intercepted woff2), logo, media.
- `stardust/current/PRODUCT.md`, `DESIGN.md`, `DESIGN.json` — the descriptive
  current state (Phase 2 promotes these verbatim).
- `state.json` — written after the crawl by `node stardust/scripts/stardust/state.mjs
  init --pages <url-file|-> [--types <slug=type,…>] [--site-url <u>] [--page-cap <n>]`;
  page types (each becomes one archetype) and `representative` (the archetype a
  sibling clones) change via `state.mjs set`, never `node -e`.
- `DESIGN.json.extensions.modules[]` — module candidates (become blocks).

When extract's summary comes back, surface it with the flow line first —
"Flow: replica — the design is kept. Say `switch to redesign` now if it is
to change." — so the first thing the user sees in this flow is the choice
it rests on. `switch to redesign` runs `$stardust prepare-migration
--switch-flow`; the extract is reused, nothing else is.

**Bounded/single-page entry (one-page or pilot runs).** `--prep` is the
site-wide contract; it is NOT the only way in. When the ask is "replicate
just this page" — or the user wants to pilot one archetype before committing
to a full migration — invoke `$stardust extract <URL> --single --dynamics`
(or `--pages <slug,...> --dynamics` for a short list) instead. This is a first-class entry,
not an improvisation: the recreation phase needs, per page, the captured
page JSON (verbatim content), the per-page screenshot (ground truth), and
the captured fonts — all of which a bounded extract provides; the source-CSS
harvest and per-breakpoint computed styles come from Phase 3's CSS lifting
either way. What a bounded run skips is the prep-only inventory (page
typing, module detection), which is only needed when Phase 5 fans out to
siblings — a pilot that later grows to site scope re-runs Phase 1 with
`--prep`. **A bounded run also skips the descriptive synthesis**: crawl.mjs
alone writes `pages/<slug>.json`, screenshots, and `_crawl-log.json` — it
does NOT produce `current/PRODUCT.md` / `DESIGN.md` / `DESIGN.json`, so
Phase 2's verbatim promotion has nothing to promote. On this path Phase 2
takes the **bounded promotion branch** instead
(`reference/preserve-direction.md` § 1a): replica synthesizes a minimal
descriptive target spec from the captured page JSON + the Phase-3 CSS lift,
marked `provenance: bounded-single`.

Extract's failure modes apply as-is (bot-management headed fallback, consent
handling, no-synthesis rule). If extract had to fall back to headed Chrome,
expect the gate captures to need the same treatment.

### Phase 2 — PRESERVE DIRECTION (mechanical — never invoke the stardust `direct` skill)

Full contract: `reference/preserve-direction.md`. Summary:

1. **Promote** `stardust/current/PRODUCT.md`, `DESIGN.md`, `DESIGN.json`
   verbatim to the project root as the target spec. No divergence roll, no
   re-direction, no Mode A/B — the current state IS the target. **Bounded
   entry (`--single`/`--pages`): those files don't exist** — take the
   bounded promotion branch instead (`reference/preserve-direction.md`
   § 1a): synthesize a minimal descriptive spec from the captured page JSON
   + the Phase-3 CSS lift (palette, type ramp, container, buttons — exactly
   the values the lift produces anyway), provenance `bounded-single`. Never
   mix the branches: if `current/PRODUCT.md` exists, promotion is verbatim.
2. **Write `stardust/direction.md`** recording preserve mode: what was
   promoted, from where, provenance (verbatim `--prep` promotion vs
   `bounded-single` synthesis), and the register pointer. This is what
   tells downstream skills "the direction step happened".
3. **Build the inconsistency register** at
   `stardust/replica/inconsistency-register.md` — the ONLY permitted design
   deltas, the "almost" in almost-pixel-perfect. Sources: the stardust `audit` skill
   design findings (run audit only if the user wants improvement candidates)
   and/or user-supplied items (`--register`). Every entry needs captured
   evidence + the minimal change + a status. **Empty register = pure
   replica** — that is a valid and common outcome, not a failure. A
   per-visitor in-flow region's entry (`kind: per-visitor-region`) carries its
   `selector`; write it with `node stardust/scripts/replica/presence.mjs add --hide <sel> --reason <R-nn> --verify <url>`
   — refused with candidates when it matches nothing live (`presence.mjs suggest <url>`
   lists them: the in-flow blocks above the header). Every other capture setting
   goes there too, never only on a command line, so the roster gate reads it:
   `presence.mjs add --dismiss <sel>` (an extra closer), `--pin <sel> --state <label>`
   (a rotator pinned), `--allow clip|per-visitor-dialog=<sel>` — each with
   `--reason <R-nn>` (and `--slug <s>` for one page).
4. **Target breakpoints (only with `--target-breakpoints`)**, before any
   CSS exists (`reference/preserve-direction.md` § 4): persist the list, map
   each source breakpoint to a step by intent in
   `stardust/replica/breakpoint-map.md`, seed the ONE register entry. Phase 3
   and C0 apply the map; they never decide it.

5. **Dynamic surface (migration gate — the stardust `dynamics` skill Phases 1–3).**
   Phase 1 must have run `extract --dynamics`. Run the detector on the
   archetypes, draft the triage (`--target-origin` when the EDS host is
   known), curate `stardust/dynamic-features.md` + `-plan.md`. Every row
   gets a disposition; the static recreation continues regardless. This is
   what surfaces modals, players, forms, search, tags and host-bound APIs
   that pixel gates certify as correct. Contract:
   `skills/dynamics/reference/triage.md`.

Anything not in the register is out of scope for change. When a recreation
choice would "improve" something not registered, it is a fidelity bug.

### Phase 3 — RECREATE (one archetype per page type)

Full method: `reference/recreation-procedure.md`. For each page type in the
inventory (archetype: the type's `rep_url` in a spec's `archetypes.json`), author `stardust/prototypes/<slug>-proposed.html` (+ per-page CSS)
as **clean semantic HTML/CSS** from three sources, in this order:

(a) **Captured page JSON content — verbatim.** Headings, body, CTAs+hrefs,
    alt text, metadata from `current/pages/<slug>.json`. The migrate
    content-preservation rules (`../migrate/reference/content-preservation.md`)
    apply from the first line: no rewording, no fabrication.
(b) **Exact values lifted from the source site's own CSS.** Fetch the live
    stylesheets; lift the type ramp, button specs, section paddings, radii,
    shadows, hero heights. The container model is measured, not lifted —
    DESIGN.json `extensions.breakpoints` (extract's `cap-probe.mjs` run; a bounded
    entry runs `cap-probe.mjs <live-url> --write-design stardust/current/DESIGN.json` first).
    **Fidelity values come from the original site's CSS, not the eye** — this
    converts 3–4 guess-and-screenshot loops into one. Box-by-box comparison of
    the live page against the served prototype goes through the shipped
    `measure.mjs` (`node stardust/scripts/replica/measure.mjs <live-url>
    --against <prototype-url> --selectors "<css>,…"`); any other look at a
    page — a screenshot, a JS value, a click state, two shots side by side
    — through `node stardust/scripts/diff/page-probe.mjs <url> [--shot
    <png>] [--eval <expr>] [--click <sel>] [--sbs <a> <b> <out>]` (the
    gate's navigation and consent handling; each image written as a
    capped `<name>.jpg`, 1400 × 1000 q80 — `--full-res` keeps the PNG; an
    `--sbs` `<out>` that is the `--shot` file goes beside it as
    `<name>-sbs.png`; for looking, never gate evidence). Never an authored
    browser script.
(c) **The captured screenshot as ground truth** for everything CSS doesn't
    name (composition, image crops, paint effects).

**With a target set, every `@media` rule and JS width threshold
(`matchMedia`, `innerWidth`) is authored on the target steps from the first
line** per `breakpoint-map.md`, never fixed later (a retrofit costs a full
re-gate); `breakpoint-lint.mjs` exits 0 on a prototype before its gate.

**Every archetype gets its own standalone prototype — cumulative, never
skipped.** Never skip to direct platform authoring for a new archetype:
prototyped archetypes stayed the quality ceiling in the field (3.5%/5.6%)
while direct-authored pages plateaued at 8–16%. Each new prototype imports
the shared layers earlier ones already gated (shared canon CSS + a
per-archetype file) and iterates only on its NEW modules — full contract:
`reference/recreation-procedure.md` § Cumulative archetype prototypes.

**This is recreation, not redesign — do NOT delegate to impeccable craft.**
Impeccable's redesign gates (critique, anti-template, divergence) do not
apply; the source-fidelity gate (Phase 4) replaces them entirely. A
"tastefully improved" section is a failing section.

**Fonts (#138, extends deploy #80):** self-host the source's own brand faces
as-is — extract's `stardust/current/assets/fonts/`, same weights and styles,
`@font-face` in the shared canon CSS. The brand family stays first in every
stack; a metric-matched substitute is only the fallback entry after it, never
a calibrated stand-in. Proprietary faces get deploy § 4's licensing alert
and ONE register entry for all of them. A substitute costs calibration work
and still changes line counts; the owner's license question exists either
way. Details: `reference/recreation-procedure.md` § Fonts policy.

**CSS-portation is the per-section fallback only** — paint-level effects not
recoverable from computed styles, JS-hydrated commerce widgets, video or
animated heroes. Port the minimal source rules for that section, scoped;
never page-level. Criteria in `reference/recreation-procedure.md` § Fallback.

### Phase 4 — SOURCE-FIDELITY GATE (the heart — measured, per breakpoint)

Full contract: `reference/source-fidelity-gate.md`. Run per archetype, per
breakpoint (default 1440 AND 360), live URL as source vs served prototype:

```bash
PROTO="http://localhost:8791/<slug>-proposed.html"   # python3 -m http.server 8791 --bind 127.0.0.1 from the prototypes dir
# (loopback only: the default binds every interface, exposing the tree, and can crash on a long container host name)
# ONE server, ONE port — probe with curl first (gate doc § Per-breakpoint procedure): no answer →
# start yours; answers but not your file → foreign server, never kill it, take a per-project port
curl -sI localhost:8791/<slug>-proposed.html | head -1   # 200 = it serves YOUR dir: reuse it
LIVE="https://<site>/<path>"

# One command per round — gate.sh, through run-bg. The FIRST round of a breakpoint and the
# CONFIRMATION round after the last fix run `--full` (pixel probe — stitched captures, NEVER
# fullPage:true — plus content-diff, visual-diff and chrome-parity under deadlines, one verdict
# line each, reports in the gate dir); rounds in between are pixel rounds. Never hand-write a
# wrapper around the instruments (gate doc § Iteration discipline, Instrument deadlines).
# content-diff inside --full compares --main AND the header/footer roots by default — no chrome flag.
node stardust/scripts/replica/run-bg.mjs start --name <slug>-1440-iter1 --timeout 1800 -- \
  stardust/scripts/replica/gate.sh <slug> "$LIVE" "$PROTO" 1440 iter1 --full --main "<content-root>"
node stardust/scripts/replica/run-bg.mjs start --name <slug>-360-iter1 --timeout 1800 -- \
  stardust/scripts/replica/gate.sh <slug> "$LIVE" "$PROTO" 360 iter1 --full --main "<content-root>"
# A consent manager the built-in candidates miss: add --consent "<accept selector>" to every gate.sh
# round — it reaches both stitched captures and the probes alike (gate doc § Hardening rule 6).
# In-flow per-visitor bar above the header: captures and probes hide stardust/replica/presence.json's
# list (Phase 2 writes it; a hide that matched nothing prints a WARNING naming candidates).
# Exit 3 (BLOCKED): a challenge OR a 2xx denial page ("origin blocked") → re-run that round's live captures with --headed (gate doc rule 12).
node stardust/scripts/replica/run-bg.mjs wait      # verdict lines: pixel %, height delta, hot bands, structural 🔴, flags, chrome deltas

# Iteration inner loop (gate doc § Band breakdown): anchor probe + pixel round
G=stardust/replica/gates/<slug>-1440
node stardust/scripts/replica/anchor.mjs "$LIVE"  --width 1440 --cache $G/anchor-live.json   # live side: probed once, reused
node stardust/scripts/replica/anchor.mjs "$PROTO" --width 1440   # build-side runs are free
# Chrome: computed-style parity BEFORE any pixel round on header/footer/strips
node stardust/scripts/replica/chrome-parity.mjs "$LIVE" "$PROTO" --width 1440 --live-cache $G/chrome-live.json   # exit 0 = quiet, then crop-compare
# (pass gate.sh's --hide / --presence <file> --slug <slug> here too: the shared live cache is keyed on them)
# --headed in any instrument = the window-free real-Chrome stealth tier (#125); STARDUST_HEADED_WINDOW=1 is the only way to a window.
# gate.sh: live.png cached (a --full round's live probes too, within the run), every step under a
# deadline (exit 124 = re-run, not FAIL). Rounds run in the BACKGROUND: start every round at once
# (the slots pace the Chromiums — no `sleep N;` staggering), then `wait` prints verdict lines only;
# exit 75 = still going → `wait` again as your NEXT step, never in a shell loop, never after a `sleep`;
# exit 76 = the pause file appeared, stop waiting; --max 240 under a five-minute cache (default 1500)
# (gate doc § Iteration discipline). A propagation wait is deploy's `fresh-check.mjs <url> --grep
# '<marker>'` (checks ≤ 5 s apart, capped; exit 3 stale), never a fixed sleep.
node stardust/scripts/replica/run-bg.mjs start --name <slug>-1440-iter2 -- stardust/scripts/replica/gate.sh <slug> "$LIVE" "$PROTO" 1440 iter2
node stardust/scripts/replica/run-bg.mjs start --name <slug>-360-iter2  -- stardust/scripts/replica/gate.sh <slug> "$LIVE" "$PROTO" 360  iter2
node stardust/scripts/replica/run-bg.mjs wait      # your agent process's jobs (--all: every agent's; agents sharing one process: wait <job>…, or RUN_BG_OWNER=<unit> before each run-bg call); full output: run-bg.mjs log <job> --grep <re>
# Content-cap row — once per archetype after the 1440 pass, at DESIGN.json's derived probeWidth (never a pinned 1920)
node stardust/scripts/replica/cap-probe.mjs "$LIVE" --against "$PROTO" --design DESIGN.json --slug <slug> --main "<content-root>"
```

`gate.sh --help` lists the flags and exit codes (124 = deadline, re-run, not
a verdict; 0 only when all four ran and passed).

**Pass bar (all four per breakpoint, plus the content-cap row):**
- content-diff: **0 structural 🔴** on the main root and the chrome roots — the default run covers both, each finding names its root (🟡 confirmed intended; a 🟠 font fork is a defect to fix);
- visual-diff: flags none or justified;
- pixel diff: **≤ 10%** full-page, with no per-500px band left unexplained
  (the band breakdown is the navigation instrument — fix the first hot band,
  top-down; everything below it is offset-contaminated);
- height delta **|Δh| ≤ 8 px in the prototype regime, 5 % of origin height in
  the published regime** (a pixel-table row — gate-all, either stage — is
  judged at 5 % and decides when it exists);
- **content-cap row: `cap-probe.mjs … --against` prints `cap-probe: PASS`**
  (gate doc § Pass bar item 6 — every live cap held within ±20 px by kind,
  nothing capped only on the prototype; a ✗ names the sizing rule, no pixel iteration;
  `INCONCLUSIVE` is no FAIL — the wrapper/content-cap row decided: record its note
  and re-run once with matching `--main` / `--build-main` when the roots differ);
- **clip-probe: `Clipped: 0`** on the build side (a `--full` round runs it; cut or hidden
  text / controls fail the round like an over-threshold pixel diff — #125); a
  declared repeated-unit family (`stardust/replica/units.json`, gate doc item 7)
  within 4 px;
- and, outside the bar and outside the cap, the horizontal-overflow assert:
  `document.documentElement.scrollWidth` within 4 px of the viewport
  (integer rounding; `GATE_OVERFLOW_TOLERANCE`) at every breakpoint on the
  build side — gate.sh fails the round on more whatever the pixel number
  says; a `capture failed (exit 1)` round (after gate.sh's one
  retry) is re-queued, never counted.

**With a target set (#131):** gate widths add each target step; inside a
shifted band a pixel failure is **tier-shift** (logged against the register
entry, never iterated) or a **defect** (still fails) — gate doc § Target
breakpoints.

**Every prototype is a row (#125).** When the archetypes pass, one run per width
writes the prototype table — `node stardust/scripts/replica/gate-all.mjs --stage
prototype --proto-base "$PROTO_BASE" --width 1440` (then 360) through `run-bg.mjs`;
it reuses each archetype's cached `live.png`. `gate-evidence.mjs` reads it as the
source of record: a prototype without a row is ungated.

**Iteration discipline: hard cap 3 iterations per breakpoint.** Each
iteration's fixes come off the instruments, never off eyeballing. After 3,
log the residuals in the ledger and move on — a documented 2% residual beats
an undocumented fourth loop. **No single step waits longer than the context
cache lives:** long instruments go through `run-bg.mjs` (`start`, then
`wait`), main agent and subagents alike (the master skill's wait discipline;
reference doc § Iteration discipline).

**Hardening (each a recorded false-measurement trap — gate doc § Hardening
rules):** real-Chrome UA **plus the standard request headers** on every
capture, and `sec-ch-ua*` with the UA's brands and version, the host's platform
(UA metadata set from the UA string: documents and subresources, same- and
cross-origin, no preflight; out-of-process iframes and service workers keep the
browser's own; stitch-shot prefers the full Chromium build; opt out with
`--hints native` there, `STARDUST_LIVE_HINTS=native` in every instrument and
gate round; capture.json records `browserBuild`, `hints`); a challenge, blocked
interstitial or 2xx denial page (a vendor signature, a tiny page under one error
heading) **fails loud (exit 3)**, never measured — escalate with `--headed`, and
a site that still blocks needs crawl.mjs-class capture; `domcontentloaded` on
live targets, never `networkidle`; symmetric `--main` scoping on both sides
(`--main body` is never valid); consent banners, timed marketing modals and open
dialogs dismissed (a closed dialog's scroll lock released for the capture, a
survivor's kept); animations frozen; the pointer parked after any
dismissal click; fixed/sticky chrome replicated with its scroll-state morph
(`reference/recreation-procedure.md` § Fixed and sticky chrome);
granularity parity for JOIN/SPLIT false-reds (#87); the capture-state
policy; font forks on inner spans and overlay scrims, which only the gate
catches. It ships as flags (`--ua`, `--wait-until`, `--dismiss`,
`--headed`, `--locale`, visual-diff `--main`) backed by `live-session.mjs`
— a hand-edited project copy is a defect (gate doc § Script adaptations).
`measure.mjs`, `cap-probe.mjs`, `stitch-shot.mjs`, motion-observe, content-diff,
visual-diff, the reskin probes and the `gotoLive`/`visit()` probes (e.g.
anchor, chrome-parity, sibling-variance, clip-probe, content-presence,
unit-geometry) navigate under one timeout — max(`STARDUST_NAV_TIMEOUT_MS`,
2 × `crawl.navMs.p95`) clamped to 20–180 s (the env a floor: gate doc
rule 2), else their own default, a flag winning; measure and cap-probe race each
width read against it, re-read once on a fresh page when the page
navigated under a read, and exit 124 (no verdict) only when every width
read failed (cap-probe capture: every page's probe failed a read; compare:
any), else 0 with `_provenance.partial` and a `PARTIAL` first line.

**After the static gate passes, interaction parity is a REQUIRED gate
output per archetype — not a post-pass**
(`reference/recreation-procedure.md` § Interaction parity). Motion is OBSERVED,
never inferred from static classes or CSS: run
`stardust/scripts/replica/motion-observe.mjs` per archetype live URL →
`stardust/replica/motion/<slug>.json`, implement ONLY behaviors that
fired (dead classes = NOT implemented), then observe the served prototype
with the same `--click`/`--hover` pokes in the same order (→
`stardust/replica/motion/<slug>-build.json`) and compare the two files with
`stardust/scripts/replica/motion-compare.mjs`, a reporter, not a gate (the
header's behaviour is the header contract's): a MISSING or EXTRA line is
confirmed on the class lines (the sampler misses class-toggled and
pseudo-element mechanics) and resolved in the prototype or recorded as dead.
Record
`motion: {observed, implemented, dead[]}` in `progress.json`, and re-run
pixel-compare — the number must return to the gated value.
Widgets are implemented, not justified away — on EDS as `widgets/<path>/<name>`
when the component carries no authored content, never a block with empty rows.
Timer-driven media counts as fired (`autoplay`/`loop` video, auto-advancing
slides — the observe JSON's `media` block): the capture freeze is logged as
`captureState[].restoreAtDelivery` and delivered, never shipped as the spec
("poster + paused" is not a deliverable). Fan-out briefs carry the
evidence rule + instrument invocation verbatim, and the pause check: with
`STARDUST_PAUSE_FILE` set, an archetype subagent checks that file after
each gate iteration; present → it finishes the iteration, writes its report
and returns (`reference/handoff-contract.md` § Fan-out discipline).

When all breakpoints pass, present the archetype + its gate metrics for
approval per the standard prototype approval flow (hands-off mode records
`approvedBy: "hands-off"` per `../stardust/reference/state-machine.md`).
Bookkeeping is one command each, never a hand-built JSON line or an inline
`node -e` edit of state.json: `node stardust/scripts/stardust/state.mjs advance <slug> --to
approved --by hands-off --prototype stardust/prototypes/<slug>-proposed.html`
and `node stardust/scripts/stardust/ledger.mjs replica source-fidelity-gate
end --detail "<per-breakpoint numbers>"`. Resuming a run starts with
`ledger.mjs tail` and `state.mjs summary --slugs`, not `cat`.
Every phase of this skill — extract and preserve-direction included — opens
with `node stardust/scripts/stardust/ledger.mjs replica <phase> start` as its
FIRST command, before any script of the phase runs (`ledger.mjs` refuses an
`end` without an open `start` under `--strict`), and closes with the `end`
line plus a section in `stardust/journal.md` headed
`## <Phase name> — <what happened> (<date>)` — the section is part of the
phase `end`, and `ledger.mjs … end` warns when it is missing.

### Phase 5 — HANDOFF (delegate — migrate → deploy → rollout, unchanged)

- **Read the contract card first: `reference/handoff-contract.md`** — the
  distilled migrate/deploy/rollout rules this phase needs, the exact rollout
  ledger phase strings (`A-inventory` … `I-dashboard`, plus the unlettered
  `gap-closure` after C-final when `done-check.mjs` lists failed pages),
  one usage line per deploy and rollout script, and the bookkeeping
  commands. Never read the sibling SKILL.md files whole (one recorded
  session read 260k characters of them, then re-read the overflow, before
  its first Phase 5 output);
  fetch a cited section with `section.mjs` only when a step needs depth.
- **Pages beyond the archetypes** go through the stardust `migrate` skill at
  **sibling tier** (`../migrate/reference/fidelity-tiers.md`) — and only
  AFTER their archetype is live and gated at the published origin (contract
  § 3 row C, unit `C-archetype`; #126). A template whose map passes the
  plan gate is ENCODED — the model handles only the pages `encode.mjs`
  stops on — any other is cloned (contract § 1 row 2). Either
  way content-fidelity + delivery-lint + media-reconcile; the sibling's
  only counting number is its gate row after PUT + preview (no local pixel
  bar). Siblings inherit the archetype's proven map or encoder — never re-author one. **Template constancy is measured, not
  assumed**: before encoding or cloning, run `stardust/scripts/replica/sibling-variance.mjs
  <archetype> <siblings…> --probe <block>=<sel> …` once per template and
  budget every delta as a block VARIANT class on the sibling's content (same
  file, § Sibling variance probe — its record,
  `stardust/rollout/variance/<template>.json`, gates migrate's clone). Content-fidelity is
  **measured per page at import time** (same file, § Content-count
  acceptance) so importer bugs surface while cheap to fix.
- **Delivery** via the stardust `deploy` skill per page. Bias the decode tier toward
  **template-slotted** for fixed-composition sections (deploy #95): replica
  sections are fixed compositions matched to a live original.
  Repeat groups (cards, listings) stay reconstructive. **Blocks
  obey the Experience Workspace editability contract (deploy § 8, EW1–EW10:
  node-slotting, never value-slotting) and pass `block-roundtrip --ew`.**
- **Site-wide rollout** via the stardust `rollout` skill, unchanged — its block dedup
  is what implements "same blocks across the whole site".
- **Target breakpoints:** C0 authors the foundation and reused blocks on
  the target steps and wires `breakpoint-lint.mjs` into `npm run lint`
  (`reference/handoff-contract.md`), so every deploy and rollout lint pass
  enforces it.
- **C-deliver runs in units** (`reference/handoff-contract.md` § 3, row C +
  Fan-out discipline): C0 — three recorded sub-units, one after another:
  `foundation-chrome`, `foundation-styles`, then `archetype-<template>` of
  the shell template, each with its own `progress.json` entry, its own
  subagent that authors AND deploys its part and returns, its own checkpoint
  and boundary ask; when that archetype page flips to `deployed`, the main
  agent runs the foundation-first gate ONCE on it against the published
  origin, the header contract included (`chrome-compare` exit 0 — fix or
  decide, **Header findings** below; `../diff/SKILL.md` § The header
  contract), and the gate closes the
  archetype; after the three, `foundation-freeze.mjs freeze` ONCE + commit; C-archetype — per template, the
  gated archetype is deployed and passes its full gate row on the preview URL
  (cap 3 fix rounds, then the re-prototype decision) BEFORE its siblings
  render or encode — an encoded template's map is drafted and round-tripped
  there; C1…Cn — one subagent per cluster unit runs the whole chain (an encoded cluster: the map plus its
  exceptions) with
  its own batch ledger and reports one verdict line, `first pass 360: x/y`
  from `gate-triage.mjs --unit <cluster>` included; a cluster of more than
  16 siblings is split into sub-units `cluster-<template>-1..n` of at most
  16 pages (target: no C-deliver unit runs longer than 90 minutes), in
  sibling order, one after another, each a unit with its own fresh
  subagent, `progress.json` entry (same shape, kind `cluster`), fix rounds,
  `gate-all --only` scope and `gate-triage.mjs --unit <sub-unit>`; the main
  agent only coordinates and records; C-final — `check`, the queued
  `foundation-requests.md` lines applied once, `C-deliver end`. Each unit is
  recorded in `stardust/rollout/progress.json` (`progress.mjs unit …`),
  committed and closed by its boundary ask — a safe resume point, never by
  itself a reason to end the
  session; no frozen file is edited mid-wave, and fan-out subagents honour
  `STARDUST_PAUSE_FILE` (`reference/handoff-contract.md` § Fan-out
  discipline).
- **Header findings** (`../diff/SKILL.md` § The header contract): Fix or
  decide every error (hands-off: you decide, with a reason). In a hands-off
  run (`stardust/state.json` `handsOff: true`) the agent is the deciding
  party: `chrome-compare.mjs decide <finding> --decision
  accept|fix-later|artefact --reason "<r>"` signs `{ finding, decision,
  reason, by: "agent", at }` into `stardust/chrome/header-decisions.json`,
  one exact finding key per entry, with a reason of at least 40 characters
  naming the evidence (a measurement artefact, a host-bound feature, a
  third-party component, a hide-list offset); chrome-compare counts it as
  decided and lists it in `decidedByAgent` for the owner's review. In an
  attended run (`handsOff` false or absent) only the site owner clears a
  finding (`by`, `at`); an agent-signed entry is ignored and reported.
- **The final gate runs against the PUBLISHED origin — not the harness**
  (`reference/source-fidelity-gate.md` § The published-origin gate): deploy
  first (`PUT → preview`, then `update-coverage.mjs <slug> --status deployed
  --url <deployed URL>`); the archetype's published row of record is the
  C-archetype unit's `gate-all.mjs --only <archetype> --eds-host <preview
  host>` row — the evidence the clusters' preview re-runs reuse. `gate.sh <slug> "$LIVE"
  "<preview-url>" <width> pub<N> --full --marker "<brand or domain string>"`
  through `run-bg.mjs` stays the fix-round instrument inside that unit, never
  a second verdict, in the ordinary `gates/<slug>-<width>/` dir. Nothing
  pixel-shaped runs on the local harness — it feeds
  `qa-gate`/`block-roundtrip` only.
- **The delivery gate is the ALL-PAGES run, four criteria — not the pixel
  number alone** (`reference/source-fidelity-gate.md` § The all-pages
  published-origin gate, #125): `node stardust/scripts/replica/gate-all.mjs
  [--only <slug,…>] [--skip-existing] [--eds-host <host>]` through `run-bg.mjs`.
  Its roster is the rollout coverage (`stardust/rollout/coverage/pages.json`
  rows `deployed` / `verified`, and `failed` by the gate so a fix round
  re-gates them) — no state file, no hand-built roster; `--eds-host` takes a
  bare host or `https://<host>`. A `--only` fix round reuses this run's
  origin capture (`--recapture-origin`
  when the source changed; reference § Iteration discipline, Evidence
  freshness); opt-in `--one-load` reads the probes off the stitched pages.
  DELIVERED = pixel % ≤ 10 AND |Δh| ≤ 5 % AND 0 clipped text / controls
  (`clip-probe`) AND 0 MISSING / HIDDEN links / headings (`content-presence`).
  Evidence and sidecars: `stardust/replica/gates/all-<width>/`; with the Phase 4
  `prototypes-<width>/` table it is the pair `gate-evidence.mjs` reads (a page
  without a row is ungated). Each cluster subagent runs `--only` over its own
  pages inside the fan-out; cluster re-runs pass `--skip-existing` with the
  clusters' (preview) `--eds-host`, C-final's roster run (unit `gate-all`, after
  re-freezing the foundation the requests changed; then
  `update-coverage.mjs --gate`) `--skip-existing --eds-host <rollout.json site.liveHost>`
  — that host change re-gates every row, as the gate key hashes the build
  origin. A PASS row is reused only while its gate key (foundation,
  blocks, content, criteria) is proven served and unchanged, probes only
  while the capture pair holds; an EDS capture not proven current (changed
  key, or unknown key whose `gate-key.json` record differs; without a local
  `content/<page>.html` nothing compares — every run, slower) is re-shot;
  rows say `reused` (handoff § 3, C). Between fix rounds,
  `node stardust/scripts/replica/gate-triage.mjs [--unit <name>]`
  (advisory) groups the failing rows by shared cause in
  `gates/all-<width>/triage.md` — act on causes with rows on your own pages:
  fix each cause once and re-gate the scope it names; the rows stay the
  verdict.

**State:** replica writes its own state under `stardust/replica/` — the
inconsistency register, `progress.json` (one map: `types.<archetype>` —
page type, iterations used, per-breakpoint gate results, residuals, motion
inventory — beside `gate-evidence.mjs`'s `siblings` / `migrate`; written
with `node stardust/scripts/stardust/progress.mjs unit <start|done|failed>
<archetype> --ledger replica [--set <key>=<value>]`, never `node -e`),
`motion/<slug>.json`, and `gates/<slug>-<width>/` evidence.
The delivery gate (#125) adds `gates/all-<width>/` — one dir per deployed
page (`origin.png`, `eds.png`, `diff.png`, `pixel.json`, `content.json`,
`clip.json`, `units.json`, `probes.json`, `gate-key.json` — the reuse
records), `summary.{json,md}`, `runs/` for `--only` runs and
the documented sidecars (`masks.json`, `overrides.json`, `clip-allow.json`,
`presence.json`, `units.json`).
Phase 5 adds three files under `stardust/rollout/`: `progress.json` (the
C-deliver unit ledger — status, gates and verdict per unit),
`foundation-freeze.json` (the sha256 manifest of the frozen foundation) and
`foundation-requests.md` (queued foundation change requests, applied once at
C-final). Pipeline status (extracted → prototyped →
approved → migrated) stays in the core `state.json` per the standard state
machine — replica never redefines it.

## What replica never does

- **No redesign.** No new palette, type, spacing, composition, motion. The
  target spec is the captured current state.
- **No content rewriting.** Captured strings are verbatim; placeholders and
  hydration states are replicated as captured, not "fixed".
- **No invented improvements.** A change without an inconsistency-register
  entry is a defect, however tasteful.
- **No DOM copying.** Never paste the live DOM or port page-level CSS as the
  prototype (that's the snowflake escape hatch, not this skill). Clean
  re-authoring is the point — byte-fidelity without re-implementation value
  defeats the migration.

## Outputs

```
stardust/
├── state.json                          ← core state machine (unchanged contract)
├── direction.md                        ← preserve-mode record (Phase 2)
├── current/                            ← from extract --prep
├── prototypes/<slug>-proposed.html     ← gated archetypes (one per page type)
├── replica/
│   ├── inconsistency-register.md       ← the ONLY permitted design deltas
│   ├── breakpoint-map.md               ← source → target breakpoint map (only with --target-breakpoints)
│   ├── progress.json                   ← per-page-type ledger: iterations, gate results, residuals, motion inventory
│   ├── motion/<slug>.json              ← motion-observe evidence
│   └── gates/<slug>-<width>/           ← live.png, proto.png, diff.png, probe outputs per iteration
├── migrated/                           ← from migrate (Phase 5)
├── import/<archetype>/, encoded/       ← migrate's encoder (Phase 5): a template's map; its siblings' delivered documents
└── rollout/                            ← from rollout (Phase 5); coverage/, plan.json … per its SKILL.md
    ├── progress.json                   ← C-deliver unit ledger: status, gates, verdict per unit
    ├── foundation-freeze.json          ← sha256 manifest of the frozen foundation (C0 → C-final)
    └── foundation-requests.md          ← queued foundation change requests, applied once at C-final

PRODUCT.md / DESIGN.md / DESIGN.json    ← promoted verbatim from current/ (Phase 2)
```

## References

- `reference/preserve-direction.md` — mechanical promotion contract +
  inconsistency-register entry schema.
- `reference/recreation-procedure.md` — CSS-lifting method (per gate
  breakpoint), fonts policy, scrim/luminance recovery, span-face forks,
  capture-state policy, wrap-junction margins, fixed/sticky chrome,
  granularity parity, role parity (mirror the live wrapping per string),
  interaction parity (motion observed, never inferred; Swiper-lock),
  CSS-portation fallback criteria.
- `reference/source-fidelity-gate.md` — full gate contract: commands,
  thresholds, per-breakpoint procedure, hardening rules, band-breakdown
  reading guide (+ the section-anchor inner loop), iteration discipline,
  the published-origin gate (EDS pipeline deltas), residual logging format.
- `../diff/SKILL.md` — the two probes replica reuses (`--profile generic`);
  reading content-diff output; the #87 JOIN/SPLIT limitation.
- `../extract/SKILL.md` § Prep mode — what Phase 1 provides.
- `reference/reading-discipline.md` — the reading and inspection rules in
  full: which helper reads what, the image rule, the evidence behind them.
- `reference/handoff-contract.md` — Phase 5 contract card: sibling-tier
  steps, deploy editability/decode/DA protocols, rollout phases A–I with
  their ledger phase strings, one usage line per deploy and rollout
  script, bookkeeping commands.
- `../stardust/scripts/ledger.mjs`, `../stardust/scripts/state.mjs` — the
  ledger and state writers (project copies under
  `stardust/scripts/stardust/`); `--help` on each.
- `../migrate/reference/fidelity-tiers.md` — archetype/sibling model Phase 5
  hands off to.
- `../deploy/SKILL.md` § decode tiers (#95) — template-slotted bias.
- `../stardust/reference/scripts-index.md` — every shipped script on one line
  (what it does, key flags); read it before any `--help`.
