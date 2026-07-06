---
name: replica
description: Same-design migration — re-platform a site to AEM Edge Delivery (or any clean front end) keeping its current design near pixel-perfect. Recreates key pages (one archetype per page type) as clean re-authored HTML/CSS (never DOM copies), verifies each against the live site with a measured source-fidelity gate (structural diff + visual diff + stitched pixel diff per breakpoint), then hands off to migrate/deploy/rollout for site-wide delivery with reusable blocks. The only permitted design changes are entries in an explicit inconsistency register. Use when the user says "migrate this site keeping its current design", "same-design migration", "pixel-perfect replatform to AEM", "rebuild the site exactly as it is but clean", or "keep the design, change the platform". NOT for redesigns — a new or refreshed design is the stardust core pipeline (direct/prototype) or uplift.
license: Apache-2.0
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
   the captured spec — `stardust:direct` is never invoked. Every judgment
   call in a replica run is a *measurement-policy* call, not a taste call.
2. **Recreation, not copying.** Archetypes are authored as clean semantic
   HTML/CSS from captured content + values lifted from the source site's own
   CSS — never DOM copies, never ported page-level stylesheets. Fidelity is
   proven by instruments, not asserted by construction.

Validated end-to-end (aesop.com home, 2026-07-03): 8.31% → 2.93% → **1.31%**
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
   loader, state read.
2. Verify Playwright is importable from the project root (extract needs it;
   so do the gate scripts).
3. Install the gate's pixel deps in the project:
   `npm i -D playwright pixelmatch pngjs --no-save --legacy-peer-deps`.
   Same trap as diff's prereq 0: a `--no-save` install is PRUNED by any later
   real `npm i` — re-probe before every gate run
   (`node -e "import('pixelmatch').then(()=>process.exit(0))"`).
4. Copy scripts into the project and run them from there, not from the
   plugin: this skill's `scripts/` (stitch-shot.mjs, pixel-compare.mjs) AND
   the whole `../diff/scripts/` dir (the diff scripts import
   diff-profiles.mjs, and ALL live-target hardening — including
   stitch-shot's — lives in its live-session.mjs; stitch-shot resolves it
   from `scripts/diff/` next to `scripts/replica/`, so keep the two dirs
   siblings).

## Procedure

Five phases. Phases 1 and 5 delegate to existing skills unchanged; phases
2–4 are owned by `replica`.

### Phase 1 — EXTRACT (delegate to `stardust:extract --prep`)

Invoke `stardust:extract <URL> --prep`, unchanged. Prep mode is required —
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

**Bounded/single-page entry (one-page or pilot runs).** `--prep` is the
site-wide contract; it is NOT the only way in. When the ask is "replicate
just this page" — or the user wants to pilot one archetype before committing
to a full migration — invoke `stardust:extract <URL> --single` (or
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

### Phase 2 — PRESERVE DIRECTION (mechanical — never invoke `stardust:direct`)

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
   deltas, the "almost" in almost-pixel-perfect. Sources: `stardust:audit`
   design findings (run audit only if the user wants improvement candidates)
   and/or user-supplied items (`--register`). Every entry needs captured
   evidence + the minimal change + a status. **Empty register = pure
   replica** — that is a valid and common outcome, not a failure.

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
    converts 3–4 guess-and-screenshot loops into one.
(c) **The captured screenshot as ground truth** for everything CSS doesn't
    name (composition, image crops, paint effects).

**This is recreation, not redesign — do NOT delegate to impeccable craft.**
Impeccable's redesign gates (critique, anti-template, divergence) do not
apply; the source-fidelity gate (Phase 4) replaces them entirely. A
"tastefully improved" section is a failing section.

**Fonts:** use the same public source when available (extract's intercepted
woff2 for open/self-hostable faces). For licensed commercial kits: never
rehost on the new domain — pick a metric-matched substitute, keep the brand
family name first in the font stack so a licensed drop-in later wins, and
surface the substitution to the user. (Prior art: heathrow §3.7.)

**CSS-portation is the per-section fallback only** — paint-level effects not
recoverable from computed styles, JS-hydrated commerce widgets, video or
animated heroes. Port the minimal source rules for that section, scoped;
never page-level. Criteria in `reference/recreation-procedure.md` § Fallback.

### Phase 4 — SOURCE-FIDELITY GATE (the heart — measured, per breakpoint)

Full contract: `reference/source-fidelity-gate.md`. Run per archetype, per
breakpoint (default 1440 AND 360), live URL as source vs served prototype:

```bash
PROTO="http://localhost:8791/<slug>-proposed.html"   # python3 -m http.server from the prototypes dir
LIVE="https://<site>/<path>"

# Probe 1+2 — the diff skill's two probes, generic profile (--dismiss keeps
# consent + timed marketing modals out of both inventories)
node scripts/diff/content-diff.mjs "$LIVE" "$PROTO" --profile generic --width 1440 --main "<content-root>" --dismiss
node scripts/diff/visual-diff.mjs  "$LIVE" "$PROTO" --profile generic --width 1440 --main "<content-root>" --dismiss

# Probe 3 — replica's pixel probe (stitched captures, NEVER fullPage:true)
node scripts/replica/stitch-shot.mjs "$LIVE"  stardust/replica/gates/<slug>-1440/live.png  --width 1440 --settle
node scripts/replica/stitch-shot.mjs "$PROTO" stardust/replica/gates/<slug>-1440/proto.png --width 1440
node scripts/replica/pixel-compare.mjs stardust/replica/gates/<slug>-1440/live.png \
  stardust/replica/gates/<slug>-1440/proto.png --out stardust/replica/gates/<slug>-1440/diff.png
```

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
an undocumented fourth loop.

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

When all breakpoints pass, present the archetype + its gate metrics for
approval per the standard prototype approval flow (hands-off mode records
`approvedBy: "hands-off"` per `../stardust/reference/state-machine.md`).

### Phase 5 — HANDOFF (delegate — migrate → deploy → rollout, unchanged)

- **Pages beyond the archetypes** go through `stardust:migrate` at
  **sibling tier** (`../migrate/reference/fidelity-tiers.md`): structural
  clone of the gated archetype + content-fidelity + delivery-lint +
  media-reconcile. The archetype's source-fidelity gate is what the siblings
  inherit — never re-author a sibling from scratch.
- **Delivery** via `stardust:deploy` per page. Bias the decode tier toward
  **template-slotted** for fixed-composition sections (deploy #95): replica
  sections are by definition fixed compositions matched to a live original;
  reconstruction freedom is risk with no payoff here. Repeat/authorable
  groups (cards, listings) stay reconstructive.
- **Site-wide rollout** via `stardust:rollout`, unchanged — its block dedup
  is what implements "same blocks across the whole site".
- Optional final proof: re-run the pixel probe live-site vs deployed page.
  Expect small justified deltas (EDS chrome, font loading); log them.

**State:** replica writes its own state under `stardust/replica/` — the
inconsistency register, `progress.json` (per page type: archetype slug,
iterations used, per-breakpoint gate results, residuals), and
`gates/<slug>-<width>/` evidence. Pipeline status (extracted → prototyped →
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
│   ├── progress.json                   ← per-page-type ledger: iterations, gate results, residuals
│   └── gates/<slug>-<width>/           ← live.png, proto.png, diff.png, probe outputs per iteration
└── migrated/                           ← from migrate (Phase 5)

PRODUCT.md / DESIGN.md / DESIGN.json    ← promoted verbatim from current/ (Phase 2)
```

## References

- `reference/preserve-direction.md` — mechanical promotion contract +
  inconsistency-register entry schema.
- `reference/recreation-procedure.md` — CSS-lifting method (per gate
  breakpoint), fonts policy, scrim/luminance recovery, span-face forks,
  capture-state policy, fixed/sticky chrome, granularity parity, role
  parity (mirror the live wrapping per string), CSS-portation fallback
  criteria.
- `reference/source-fidelity-gate.md` — full gate contract: commands,
  thresholds, per-breakpoint procedure, hardening rules, band-breakdown
  reading guide, iteration discipline, residual logging format.
- `../diff/SKILL.md` — the two probes replica reuses (`--profile generic`);
  reading content-diff output; the #87 JOIN/SPLIT limitation.
- `../extract/SKILL.md` § Prep mode — what Phase 1 provides.
- `../migrate/reference/fidelity-tiers.md` — archetype/sibling model Phase 5
  hands off to.
- `../deploy/SKILL.md` § decode tiers (#95) — template-slotted bias.
