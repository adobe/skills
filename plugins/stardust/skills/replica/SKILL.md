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
none" (198/198 nodes). Every fix came off the instruments, never off
eyeballing.

## Inputs

- `<URL>` — required. The site to migrate.
- `--breakpoints <list>` — optional. Gate breakpoints, default `1440,360`.
  Mobile is NOT free: the validation run's 1440-tuned prototype measured 24%
  at 360. Each breakpoint gets its own gate pass.
- `--register <file>` — optional. User-supplied inconsistency items to seed
  the register (see Phase 2). Without it and without an audit, the register
  is empty — a pure replica.

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
3. Install the gate's pixel deps in the project:
   `npm i -D playwright pixelmatch pngjs --no-save --legacy-peer-deps`.
   Same trap as diff's prereq 0: a `--no-save` install is PRUNED by any later
   real `npm i` — re-probe before every gate run
   (`node -e "import('pixelmatch').then(()=>process.exit(0))"`).
4. Copy scripts into the project and run them from there, not from the
   plugin: this skill's whole `scripts/` dir (stitch-shot, pixel-compare,
   crop-compare, chrome-parity, row-profile, sibling-variance, anchor, measure,
   gate.sh, run-capped, run-bg, gate-evidence, foundation-freeze, the four
   inspection helpers, motion-observe, motion-compare) to
   `stardust/scripts/replica/`, the master skill's `../stardust/scripts/`
   (ledger.mjs, state.mjs) to `stardust/scripts/stardust/`, the migrate
   skill's `../migrate/scripts/` (migrate.mjs) to `stardust/scripts/migrate/`,
   AND the whole
   `../diff/scripts/` dir to `stardust/scripts/diff/` (the diff scripts
   import diff-profiles.mjs, and ALL live-target hardening — including
   stitch-shot's — lives in its live-session.mjs; stitch-shot resolves it
   from `stardust/scripts/diff/` next to `stardust/scripts/replica/`, so
   keep the two dirs siblings). Never copy into the project-root
   `scripts/` — that is the EDS boilerplate's directory (master skill
   § Artifacts, the write boundary).

**Reading and inspection discipline — the context is the budget**
(`reference/reading-discipline.md`, read it once at Setup). Every byte a
step prints is re-read on every later model call (recorded: 750k characters
of tool output in one 77-minute session). The rules in one line each:
reference docs by section (`section.mjs <doc> --list`, then one heading, one
section per call); captured CSS through `css-rules.mjs`, capture JSON through
`json-query.mjs` (values that feed a command from `--tsv`/`--path`, never the
table), captured HTML through `html-slice.mjs`; instrument output through
`run-bg.mjs wait` and `log --grep`, never `cat`; live-vs-prototype boxes
through `measure.mjs`, never an authored probe; images one crop per fact,
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
- `state.json.pages[].type` — page types (each becomes one archetype).
- `DESIGN.json.extensions.modules[]` — module candidates (become blocks).

When extract's summary comes back, surface it with the flow line first —
"Flow: replica — the design is kept. Say `switch to redesign` now if it is
to change." — so the first thing the user sees in this flow is the choice
it rests on. `switch to redesign` runs `$stardust prepare-migration
--switch-flow`; the extract is reused, nothing else is.

**Bounded/single-page entry (one-page or pilot runs).** `--prep` is the
site-wide contract; it is NOT the only way in. When the ask is "replicate
just this page" — or the user wants to pilot one archetype before committing
to a full migration — invoke `$stardust extract <URL> --single` (or
`--pages <slug,...>` for a short list) instead. This is a first-class entry,
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
   replica** — that is a valid and common outcome, not a failure.

4. **Dynamic surface (migration gate — the stardust `dynamics` skill Phases 1–3).**
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
inventory, author `stardust/prototypes/<slug>-proposed.html` (+ per-page CSS)
as **clean semantic HTML/CSS** from three sources, in this order:

(a) **Captured page JSON content — verbatim.** Headings, body, CTAs+hrefs,
    alt text, metadata from `current/pages/<slug>.json`. The migrate
    content-preservation rules (`../migrate/reference/content-preservation.md`)
    apply from the first line: no rewording, no fabrication.
(b) **Exact values lifted from the source site's own CSS.** Fetch the live
    stylesheets; lift container max-widths, the type ramp, button specs,
    section paddings, radii, shadows, hero heights, the container model.
    **Fidelity values come from the original site's CSS, not the eye** — this
    converts 3–4 guess-and-screenshot loops into one. Box-by-box comparison of
    the live page against the served prototype goes through the shipped
    `measure.mjs` (`node stardust/scripts/replica/measure.mjs <live-url>
    --against <prototype-url> --selectors "<css>,…"` — rect + computed values
    per selector per width, one delta line each), never through an authored
    probe.
(c) **The captured screenshot as ground truth** for everything CSS doesn't
    name (composition, image crops, paint effects).

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

**Fonts:** use the same public source when available (extract's intercepted
woff2 for open/self-hostable faces). For licensed commercial kits: never
rehost on the new domain — pick a metric-matched substitute, keep the brand
family name first in the font stack so a licensed drop-in later wins, and
surface the substitution to the user. (Prior art: an earlier airport-site migration's improvement notes, §3.7.)

**CSS-portation is the per-section fallback only** — paint-level effects not
recoverable from computed styles, JS-hydrated commerce widgets, video or
animated heroes. Port the minimal source rules for that section, scoped;
never page-level. Criteria in `reference/recreation-procedure.md` § Fallback.

### Phase 4 — SOURCE-FIDELITY GATE (the heart — measured, per breakpoint)

Full contract: `reference/source-fidelity-gate.md`. Run per archetype, per
breakpoint (default 1440 AND 360), live URL as source vs served prototype:

```bash
PROTO="http://localhost:8791/<slug>-proposed.html"   # python3 -m http.server from the prototypes dir
# ONE server, ONE port — probe with curl before starting one (lsof is optional, often absent):
curl -sI localhost:8791/ | head -1                       # 200/404 = something serves the port; no line = free
curl -sI localhost:8791/<slug>-proposed.html | head -1   # 200 = it serves YOUR dir: reuse it
# no answer → start yours; answers but not your file → foreign server: never kill it, take a
# per-project port (a foreign server silently poisons the gate; gate.sh asserts a marker, exit 4)
LIVE="https://<site>/<path>"

# One command per round — gate.sh, through run-bg. The FIRST round of a breakpoint and the
# CONFIRMATION round after the last fix run `--full` (pixel probe — stitched captures, NEVER
# fullPage:true — plus content-diff, visual-diff and chrome-parity under deadlines, one verdict
# line each, reports in the gate dir); rounds in between are pixel rounds. Never hand-write a
# wrapper around the instruments (a recorded one lost the deadlines; a round took 15 minutes).
node stardust/scripts/replica/run-bg.mjs start --name <slug>-1440-iter1 -- \
  stardust/scripts/replica/gate.sh <slug> "$LIVE" "$PROTO" 1440 iter1 --full --main "<content-root>"
node stardust/scripts/replica/run-bg.mjs start --name <slug>-360-iter1 -- \
  stardust/scripts/replica/gate.sh <slug> "$LIVE" "$PROTO" 360 iter1 --full --main "<content-root>"
node stardust/scripts/replica/run-bg.mjs wait      # verdict lines: pixel %, height delta, hot bands, structural 🔴, flags, chrome deltas

# Iteration inner loop (gate doc § Band breakdown): anchor probe + pixel round
G=stardust/replica/gates/<slug>-1440
node stardust/scripts/replica/anchor.mjs "$LIVE"  --width 1440 --cache $G/anchor-live.json   # live side: probed once, reused
node stardust/scripts/replica/anchor.mjs "$PROTO" --width 1440   # build-side runs are free
# Chrome: computed-style parity BEFORE any pixel round on header/footer/strips
node stardust/scripts/replica/chrome-parity.mjs "$LIVE" "$PROTO" --width 1440 --live-cache $G/chrome-live.json   # exit 0 = quiet, then crop-compare
# gate.sh: live.png cached, every step under a deadline (exit 124 = re-run, not FAIL). Rounds run in
# the BACKGROUND: start every round at once (the slots pace the Chromiums — no `sleep N;` staggering),
# then `wait` prints verdict lines only; exit 75 = still going → `wait` again as your NEXT step, never
# in a shell loop, never after a `sleep` (gate doc § Iteration discipline). A propagation wait is a
# bounded inline poll (`curl -sf` ≤ 5 s apart, capped), never a fixed sleep.
node stardust/scripts/replica/run-bg.mjs start --name <slug>-1440-iter2 -- stardust/scripts/replica/gate.sh <slug> "$LIVE" "$PROTO" 1440 iter2
node stardust/scripts/replica/run-bg.mjs start --name <slug>-360-iter2  -- stardust/scripts/replica/gate.sh <slug> "$LIVE" "$PROTO" 360  iter2
node stardust/scripts/replica/run-bg.mjs wait      # returns within 100 s; full output: run-bg.mjs log <job> --grep <re>
```

`gate.sh --help` lists the flags; `--full` exits 124 when any probe hit its
deadline (re-run, not a verdict), 2 on a pixel fail, a structural content 🔴
or a chrome delta, 1 when a probe errored (it gave no verdict — read its
`ERROR` line), 0 only when all four ran and passed.

**Pass bar (all four, per breakpoint):**
- content-diff: **0 structural 🔴** (🟡/🟠 confirmed intended);
- visual-diff: flags none or justified;
- pixel diff: **≤ 10%** full-page, with no per-500px band left unexplained
  (the band breakdown is the navigation instrument — fix the first hot band,
  top-down; everything below it is offset-contaminated);
- height delta **|Δ| ≤ 8px** (pixel-compare's own warning bar).

**Iteration discipline: hard cap 3 iterations per breakpoint.** Each
iteration's fixes come off the instruments, never off eyeballing. After 3,
log the residuals in the ledger and move on — a documented 2% residual beats
an undocumented fourth loop. **No single step waits longer than the context
cache lives:** long instruments go through `run-bg.mjs` (`start`, then `wait`
in ≤ 100-second slices), main agent and subagents alike — a long instrument
in the foreground, or two as parallel tool calls in one turn, is the same
blocked step (reference doc § Iteration discipline: one 15-minute batch cost
a 513k-token context rewrite, $6.30).

**Hardening (each is a recorded false-measurement trap — see the reference
doc for the full list):** real-Chrome UA **plus the standard request
headers** on every capture (built into the shared
`diff/scripts/live-session.mjs` — the default HeadlessChrome UA gets a
Cloudflare challenge that the probes then silently measure AS the source,
and the UA alone still 403s on Akamai); a challenge/blocked interstitial
**fails loud (exit 3)**, never measured — escalate with `--headed`, and a
site that still blocks needs crawl.mjs-class capture (the gate must not
silently degrade); `domcontentloaded` on live targets, never `networkidle`;
symmetric `--main` scoping on both sides (`--main body` is never valid);
both overlay classes dismissed via `--dismiss` (consent AND timed marketing
modals); animations frozen for capture; the pointer parked after any
dismissal click (a `:hover`-styled element under the resting cursor
captures in hover state); fixed/sticky chrome replicated fixed, with its
scroll-state morph, so seam repeats stay symmetric
(`reference/recreation-procedure.md` § Fixed and sticky chrome);
granularity-parity policy for JOIN/SPLIT false-reds (#87); capture-state
policy for CDN-403 images and hydration placeholders (replicate as captured
+ log). Two defect classes only the gate catches — DOM/style capture misses
them: rendered-face font forks on inner spans (width probe) and overlay
scrims invisible to computed styles (recover by per-row luminance fitting).

The live-target hardening ships as flags on the diff scripts (`--ua`,
`--wait-until`, `--dismiss`, `--headed`, `--locale`, visual-diff `--main`)
backed by `live-session.mjs` — copy the scripts and pass flags; a project
copy carrying hand-edits is a defect
(`reference/source-fidelity-gate.md` § Script adaptations).

**After the static gate passes, interaction parity is a REQUIRED gate
output per archetype — not a post-pass**
(`reference/recreation-procedure.md` § Interaction parity; optional, it was
skipped on 5 of 7 archetypes — all shipped static). Motion is OBSERVED,
never inferred from static classes or CSS: run
`stardust/scripts/replica/motion-observe.mjs` per archetype live URL →
`stardust/replica/motion/<slug>.json`, implement ONLY behaviors that
fired (dead classes = NOT implemented), then observe the served prototype
with the same `--click`/`--hover` pokes in the same order (→
`stardust/replica/motion/<slug>-build.json`) and compare the two files with
`stardust/scripts/replica/motion-compare.mjs` — one line per behavior
(parity / MISSING on build / EXTRA on build / timing delta / advisory) and a
summary line; it is a reporter, not a gate: a MISSING or EXTRA line is
confirmed on the class lines (the sampler misses class-toggled and
pseudo-element mechanics) and resolved in the prototype or recorded as dead.
Record
`motion: {observed, implemented, dead[]}` in `progress.json`, and re-run
pixel-compare — the number must return to the gated value.
Widgets are implemented, not justified away. Fan-out briefs carry the
evidence rule + instrument invocation verbatim.

When all breakpoints pass, present the archetype + its gate metrics for
approval per the standard prototype approval flow (hands-off mode records
`approvedBy: "hands-off"` per `../stardust/reference/state-machine.md`).
Bookkeeping is one command each, never a hand-built JSON line or an inline
`node -e` edit of state.json: `node stardust/scripts/stardust/state.mjs advance <slug> --to
approved --by hands-off --prototype stardust/prototypes/<slug>-proposed.html`
and `node stardust/scripts/stardust/ledger.mjs replica source-fidelity-gate
end --detail "<per-breakpoint numbers>"`. Resuming a run starts with
`ledger.mjs tail` and `state.mjs summary --slugs`, not `cat`.

### Phase 5 — HANDOFF (delegate — migrate → deploy → rollout, unchanged)

- **Read the contract card first: `reference/handoff-contract.md`** — the
  distilled migrate/deploy/rollout rules this phase needs, the exact rollout
  ledger phase strings (`A-inventory` … `I-dashboard`), one usage line per
  deploy and rollout script, and the bookkeeping commands. Never read the
  sibling SKILL.md files whole (one recorded session read 260k characters
  of them, then re-read the overflow, before its first Phase 5 output);
  fetch a cited section with `section.mjs` only when a step needs depth.
- **Pages beyond the archetypes** go through the stardust `migrate` skill at
  **sibling tier** (`../migrate/reference/fidelity-tiers.md`): structural
  clone of the gated archetype + content-fidelity + delivery-lint +
  media-reconcile. Siblings inherit the archetype's source-fidelity gate —
  never re-author one from scratch. **Template constancy is measured, not
  assumed**: before cloning, run `stardust/scripts/replica/sibling-variance.mjs
  <archetype> <siblings…> --probe <block>=<sel> …` once per template and
  budget every delta as a block VARIANT class on the sibling's content (same
  file, § Sibling variance probe). Content-fidelity is
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
- **C-deliver runs in units** (`reference/handoff-contract.md` § 3, row C +
  Fan-out discipline): C0 — ONE foundation subagent authors AND deploys the
  foundation; the main agent gates the shell on the published origin, then
  `foundation-freeze.mjs freeze` + commit; C1…Cn — one subagent per template
  cluster runs the whole chain, PUT → preview → published-origin gates
  included, with its own batch ledger (`deploy-batch.mjs --ledger …`,
  lock-safe) and reports one verdict line; the main agent only coordinates
  and records; C-final — `check`, the queued `foundation-requests.md` lines
  applied once, `C-deliver end`. Each unit is recorded in
  `stardust/rollout/progress.json` and committed — a safe resume point,
  never by itself a reason to end the session; no frozen file is edited
  mid-wave.
- **The final gate runs against the PUBLISHED origin — not the harness**
  (`reference/source-fidelity-gate.md` § The published-origin gate): the
  delivery pipeline transforms markup, so harness numbers understate.
  Deploy the page first (`PUT → preview`), then gate it there — nothing
  pixel-shaped runs on the local EDS harness before the first PUT (it feeds
  `qa-gate`/`block-roundtrip` only; a recorded session spent its budget on a
  harness diff and delivered no page). The published round is the same
  command with the preview URL: `gate.sh <slug> "$LIVE" "<preview-url>"
  <width> pub1 --full --marker "<brand or domain string>"` through
  `run-bg.mjs` — `--marker` is required (the slug lives in the prototype's
  file name, not the preview page) — in the ordinary
  `stardust/replica/gates/<slug>-<width>/` dir under the `pub<N>` label (a
  new dir would force a fresh live capture). Only the published number
  counts.

**State:** replica writes its own state under `stardust/replica/` — the
inconsistency register, `progress.json` (per page type: archetype slug,
iterations used, per-breakpoint gate results, residuals, motion
inventory), `motion/<slug>.json`, and `gates/<slug>-<width>/` evidence.
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
│   ├── progress.json                   ← per-page-type ledger: iterations, gate results, residuals, motion inventory
│   ├── motion/<slug>.json              ← motion-observe evidence
│   └── gates/<slug>-<width>/           ← live.png, proto.png, diff.png, probe outputs per iteration
├── migrated/                           ← from migrate (Phase 5)
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
