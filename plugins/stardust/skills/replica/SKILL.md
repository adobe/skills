---
name: replica
description: Same-design migration — re-platform a site to AEM Edge Delivery (or any clean front end) keeping its current design near pixel-perfect. Recreates key pages (one archetype per page type) as clean re-authored HTML/CSS (never DOM copies), verifies each against the live site with a measured source-fidelity gate (structural + visual + stitched pixel diff per breakpoint), then hands off to migrate/deploy/rollout for site-wide delivery (subsumes prepare-migration's prep cascade — never chain the two). The only permitted design changes are entries in an explicit inconsistency register. Use when the user says "migrate this site keeping its current design", "same-design migration", "pixel-perfect replatform to AEM", or "keep the design, change the platform". NOT for redesigns — those are the stardust core pipeline (direct/prototype) or uplift.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and playwright-cli on PATH.
metadata:
  impeccable: none
---

# stardust:replica — same-design migration

## Operator card

Phases, in order: Setup → 1 EXTRACT → 2 PRESERVE DIRECTION → 3 RECREATE → 4 SOURCE-FIDELITY GATE (per archetype × breakpoint) → 5 HANDOFF.

| Phase | Command (project copies under `stardust/scripts/`) |
|---|---|
| Setup | `npm i -D playwright pixelmatch pngjs --no-save --legacy-peer-deps`; copy this skill's `scripts/` → `stardust/scripts/replica/` and `../diff/scripts/` → `stardust/scripts/diff/`; after Phase 1: `replica/impeccable-ignores.mjs [--files]` |
| 1 | `$stardust extract <URL> --prep --dynamics` — bounded entry: `--single` / `--pages <slug,...>` |
| 2 | mechanical promotion + `stardust/replica/inconsistency-register.md`; the `dynamics` skill Phases 1–3 |
| 3 | author `stardust/prototypes/<slug>-proposed.html` (+ per-page CSS) |
| 4 | probes 1+2: `diff/content-diff.mjs`, `diff/visual-diff.mjs` (`--profile generic --width <w> --main <root> --dismiss`); probe 3: `replica/stitch-shot.mjs`, `replica/pixel-compare.mjs --timeout <s>`; inner loop: `replica/anchor.mjs --cache`, `replica/chrome-parity.mjs --live-cache`, `replica/gate.sh <slug> <live> <proto> <width> [iter] [--marker <string>] [--refresh] [--variance]` (reference freshness + noise floor: gate doc § Per-breakpoint procedure) — deadlines `GATE_STITCH_TIMEOUT`, `GATE_COMPARE_TIMEOUT`, stale reap `GATE_REAP_MIN`; every node step runs under `replica/run-capped.mjs --timeout <s> -- <cmd>`; after the static pass: `replica/motion-observe.mjs <live>` |
| 5 | `replica/sibling-variance.mjs <archetype> <siblings…> --probe <block>=<sel>`; then the `migrate` (sibling tier) → `deploy` → `rollout` skills; re-run the Phase 4 gate against the published origin |

Gates: Phase 2 — every dynamic-surface row has a disposition. Phase 4, per breakpoint (default `1440,360`) — content-diff 0 structural 🔴 · visual-diff flags none/justified · pixel diff ≤ 10% with no hot band unexplained · height |Δ| ≤ 8px · cap 3 iterations · interaction parity recorded. `gate.sh` exits: 0 pass · 2 fail · 1 error / incomparable captures · 3 bot challenge · 4 wrong server · 5 invalid capture (consent) · 124 deadline (re-run, not a FAIL).

Outputs: `stardust/direction.md` · `stardust/replica/{inconsistency-register.md, progress.json, motion/<slug>.json, gates/<slug>-<width>/}` · `stardust/prototypes/<slug>-proposed.html` · root `PRODUCT.md` / `DESIGN.md` / `DESIGN.json`.

| At phase | Read |
|---|---|
| Setup | `../stardust/reference/state-machine.md` § Flow keys; `reference/preserve-direction.md` § 4. Impeccable ignore set |
| 2 | `reference/preserve-direction.md` § 1. Promotion contract · § 1a. Bounded promotion branch · § 3. The inconsistency register; `../dynamics/reference/triage.md` § Dispositions |
| 3 | `reference/recreation-procedure.md` § Authoring order · § Cumulative archetype prototypes · § CSS lifting · § Fonts policy · § Asset harvest and the capture-state policy · § CSS-portation fallback; parallel archetypes: `../stardust/reference/fan-out.md` § Scope and type of delegated agents · § Worker contract |
| 4 | `reference/source-fidelity-gate.md` § Per-breakpoint procedure · § Pass bar · § Reading the band breakdown · § Iteration discipline · § Hardening rules · § Script adaptations; `../stardust/reference/context-hygiene.md` § Image reads; after a capped round: § Residual classes |
| 4, after the static pass | `reference/recreation-procedure.md` § Interaction parity · § Fixed and sticky chrome · § Granularity parity |
| 5 | `../migrate/reference/fidelity-tiers.md` § Sibling variance probe · § Content-count acceptance; `reference/source-fidelity-gate.md` § The published-origin gate · § Residual logging format; `../rollout/reference/sweep-protocol.md` § The protocol |

Sections: Inputs · Setup · Procedure · What replica never does · Outputs · References.

Same pages, same content, same design — new platform. `replica` migrates a
site to AEM Edge Delivery (or just re-platforms its front end) keeping the
current design **near pixel-perfect**: the target spec IS the captured current
state, the only permitted deltas are the entries of an explicit
**inconsistency register**, and every archetype must pass a **measured
source-fidelity gate** against the live site before anything ships.

Two properties separate this from the redesign pipeline:

1. **No creative decisions.** Direction is mechanical promotion of the
   captured spec — the stardust `direct` skill is never invoked; every
   judgment call is a measurement-policy call, not a taste call.
2. **Recreation, not copying.** Clean semantic HTML/CSS from captured
   content + values lifted from the source site's own CSS — never DOM
   copies or ported stylesheets; fidelity is proven by instruments.

## Inputs

- `<URL>` — required. The site to migrate.
- `--breakpoints <list>` — optional. Gate breakpoints, default `1440,360`.
  Each breakpoint gets its own gate pass — a 1440-tuned page is not gated at 360.
- `--register <file>` — optional. User-supplied inconsistency items to seed
  the register (Phase 2). Without it and without an audit, the register is
  empty — a pure replica.

## Setup

1. Run the master skill's setup (`../stardust/SKILL.md` § Setup):
   impeccable dep level, state read. **Flow guard.** If `state.json.flow` is
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
   A `--no-save` install is PRUNED by any later real `npm i` — re-probe
   before every gate run (`node -e "import('pixelmatch').then(()=>process.exit(0))"`).
4. Copy scripts into the project and run them from there, not from the
   plugin: this skill's whole `scripts/` dir to `stardust/scripts/replica/`
   AND the whole `../diff/scripts/` dir to `stardust/scripts/diff/`
   (stitch-shot resolves `live-session.mjs` from the sibling dir — keep
   them siblings). Never copy
   into the project-root `scripts/` — the EDS boilerplate's directory
   (master skill § Artifacts, the write boundary).
5. **Impeccable ignore set for lifted values** — once, after the Phase 1
   capture: `node stardust/scripts/replica/impeccable-ignores.mjs`
   (`--files` on the user's go / hands-off; `--tokens` for the Phase 3
   lift). Contract: `reference/preserve-direction.md` § 4.

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

**Bounded entry (one-page or pilot runs).** `--prep` is the
site-wide contract, not the only way in: for "replicate just this page" or
a one-archetype pilot, invoke `$stardust extract <URL> --single` (or
`--pages <slug,...>`). A first-class entry: per-page JSON, screenshot and fonts are all
provided; the CSS lift is Phase 3's either way. A bounded run skips the prep-only inventory (page
typing, module detection — needed only when Phase 5 fans out; a pilot that
grows re-runs Phase 1 with `--prep`) AND the descriptive synthesis: no
`current/PRODUCT.md` / `DESIGN.md` / `DESIGN.json`, so Phase 2 takes the
**bounded promotion branch** (`reference/preserve-direction.md` § 1a),
provenance `bounded-single`.

Extract's failure modes apply as-is (bot-management ladder, consent
handling, no-synthesis rule); the gate instruments start at the tier
extract recorded.

### Phase 2 — PRESERVE DIRECTION (mechanical — never invoke the stardust `direct` skill)

Full contract: `reference/preserve-direction.md`. Summary:

1. **Promote** `stardust/current/PRODUCT.md`, `DESIGN.md`, `DESIGN.json`
   verbatim to the project root as the target spec. No divergence roll, no
   re-direction, no Mode A/B — the current state IS the target. **Bounded
   entry (`--single`/`--pages`): those files don't exist** — take the
   bounded promotion branch (`reference/preserve-direction.md` § 1a): a
   minimal descriptive spec from the captured page JSON + the Phase-3 CSS
   lift, provenance `bounded-single`. Never mix the branches: if
   `current/PRODUCT.md` exists, promotion is verbatim.
2. **Write `stardust/direction.md`** recording preserve mode: what was
   promoted, from where, provenance (verbatim `--prep` promotion vs
   `bounded-single` synthesis), and the register pointer. This is what
   tells downstream skills "the direction step happened".
3. **Build the inconsistency register** at
   `stardust/replica/inconsistency-register.md` — the ONLY permitted design
   deltas, the "almost" in almost-pixel-perfect. Sources: the stardust
   `audit` skill's design findings (only if the user wants improvement
   candidates) and/or `--register` items. Every entry needs captured
   evidence + the minimal change + a status. **Empty register = pure
   replica** — that is a valid and common outcome, not a failure.

4. **Dynamic surface (migration gate — the stardust `dynamics` skill Phases 1–3).**
   Phase 1 must have run `extract --dynamics`. Run the detector on the
   archetypes, draft the triage (`--target-origin` when the EDS host is
   known), curate `stardust/dynamic-features.md` + `-plan.md`. Every row
   gets a disposition; the static recreation continues regardless. This
   surfaces the modals, players, forms, search and host-bound APIs that
   pixel gates cannot see. Contract:
   `skills/dynamics/reference/triage.md`.
5. **Plan gate.** Present every `stardust/decisions.md` row not yet
   `owner-decided` as one numbered message, default on each line
   (`../stardust/reference/decisions.md` § How phases use it); the
   dynamics batch rides along.

Anything not in the register is out of scope for change. When a recreation
choice would "improve" something not registered, it is a fidelity bug.

### Phase 3 — RECREATE (one archetype per page type)

When archetypes are recreated in parallel, each worker follows
`../stardust/reference/fan-out.md` § Scope and type of delegated agents ·
§ Worker contract: one agent per archetype gate loop, its own
`progress-<slug>.json` beside `progress.json`, merged by the lead; each
brief cites `reference/recreation-procedure.md` § Cumulative archetype
prototypes.

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
    **Fidelity values come from the original site's CSS, not the eye.**
(c) **The captured screenshot as ground truth** for everything CSS doesn't
    name (composition, image crops, paint effects).

**Every archetype gets its own standalone prototype — cumulative, never
skipped.** Never skip to direct platform authoring for a new archetype
(prototypes stayed the quality ceiling; direct-authored pages plateaued).
Each new prototype imports
the shared layers earlier ones already gated (shared canon CSS + a
per-archetype file) and iterates only on its NEW modules — full contract:
`reference/recreation-procedure.md` § Cumulative archetype prototypes.

**Module-kind lift ledger — `progress.json.modules[]`:** one entry per
module KIND, `{ kind, firstSeen: <slug>, lifted: { "1440": <gate artefact>,
"360": <gate artefact> } }`. A kind is lifted when it has a gate artefact
at BOTH breakpoints. A sibling (Phase 5) that introduces a kind absent from
the ledger triggers a lift plus a Phase 4 gate ON THAT SIBLING at both
breakpoints before its template counts as recreated.

**This is recreation, not redesign — do NOT delegate to impeccable craft.**
Impeccable's redesign gates (critique, anti-template, divergence) do not
apply; the source-fidelity gate (Phase 4) replaces them entirely.

**Fonts:** same public source when available (extract's intercepted woff2
for open/self-hostable faces). Licensed commercial kits are never rehosted:
metric-matched substitute, brand family first in the stack so a licensed
drop-in later wins, substitution surfaced to the user
(`reference/recreation-procedure.md` § Fonts policy).

**CSS-portation is the per-section fallback only** — paint-level effects not
recoverable from computed styles, JS-hydrated commerce widgets, video or
animated heroes. Port the minimal source rules for that section, scoped;
never page-level. Criteria in `reference/recreation-procedure.md` § Fallback.

### Phase 4 — SOURCE-FIDELITY GATE (the heart — measured, per breakpoint)

Full contract: `reference/source-fidelity-gate.md`. Run per archetype, per
breakpoint (default 1440 AND 360), live URL as source vs served prototype:

```bash
PROTO="http://localhost:8791/<slug>-proposed.html"   # python3 -m http.server from the prototypes dir
# verify the port is YOURS (lsof -nP -iTCP:8791 -sTCP:LISTEN) — a stale foreign
# server silently poisons the gate (gate.sh asserts a page marker, exit 4)
LIVE="https://<site>/<path>"

# Probe 1+2 — the diff skill's two probes, generic profile (--dismiss: both overlay classes)
node stardust/scripts/diff/content-diff.mjs "$LIVE" "$PROTO" --profile generic --width 1440 --main "<content-root>" --dismiss
node stardust/scripts/diff/visual-diff.mjs  "$LIVE" "$PROTO" --profile generic --width 1440 --main "<content-root>" --dismiss

# Probe 3 — replica's pixel probe: gate.sh below wraps stitch-shot (stitched
# captures, NEVER fullPage:true) + pixel-compare; the unwrapped form is in the gate doc.

# Iteration inner loop (gate doc § Band breakdown): anchor probe + pixel round
G=stardust/replica/gates/<slug>-1440
node stardust/scripts/replica/anchor.mjs "$LIVE"  --width 1440 --cache $G/anchor-live.json   # live: probed once, reused
node stardust/scripts/replica/anchor.mjs "$PROTO" --width 1440   # build-side runs are free
# Chrome: computed-style parity BEFORE any pixel round (exit 0 = quiet, then crop-compare)
node stardust/scripts/replica/chrome-parity.mjs "$LIVE" "$PROTO" --width 1440 --live-cache $G/chrome-live.json
# gate.sh: live.png cached with its sidecar, every step under a deadline, round record written
stardust/scripts/replica/gate.sh <slug> "$LIVE" "$PROTO" 1440 iter2
```

**Pass bar (all four, per breakpoint):**
- content-diff: **0 structural 🔴** (🟡/🟠 confirmed intended);
- visual-diff: flags none or justified;
- pixel diff: **≤ 10%** full-page, with no per-500px band left unexplained
  (fix the first hot band top-down — gate doc § Reading the band breakdown);
- height delta **|Δ| ≤ 8px** (pixel-compare's own warning bar).

**Iteration discipline: hard cap 3 iterations per breakpoint.** Each
iteration's fixes come off the instruments, never off eyeballing; image
reads follow `../stardust/reference/context-hygiene.md` § Image reads —
numbers first, band crops, never the stitched page. After 3, log the
residuals by class (gate doc § Residual classes; `result` copied
from `gate-<label>.json`) and move on — a documented residual beats an
undocumented fourth loop. Three named regimes end a loop early or sit
outside the cap — `source-inconsistent`, `separate-composition`,
`canon-followup` (gate doc § Iteration discipline).

**Hardening (each a recorded false-measurement trap — the gate doc
§ Hardening rules is the list):** real-Chrome UA **plus the standard
request headers** on every capture (built into the shared
`diff/scripts/live-session.mjs`); a challenge/blocked interstitial **fails
loud (exit 3)**, never measured — `--headed` starts the ladder at tier 2
(real Chrome headless), `--headed=window` at tier 3 (off-screen window;
visible only under `STARDUST_HEADED_WINDOW=1`) — rule in
`../extract/reference/playwright-recipe.md` § Bot-management fallback;
stitch-shot climbs the ladder itself, and a site still blocked at tier 3 is
gate-blocked, never degraded; `domcontentloaded` on live targets, never
`networkidle`;
symmetric `--main` scoping (`--main body` is never valid); both overlay
classes (consent, timed marketing) dismissed via `--dismiss`; animations
frozen; the pointer parked after any dismissal click;
fixed/sticky chrome replicated fixed with its scroll-state morph
(`reference/recreation-procedure.md` § Fixed and sticky chrome);
granularity parity for JOIN/SPLIT false-reds (#87); capture-state policy
for CDN-403 images and hydration placeholders.

Hardening ships as flags on the diff scripts (`--ua`, `--wait-until`,
`--dismiss`, `--headed[=window]`, `--locale`, `--main`) backed by
`live-session.mjs`; a project copy carrying hand-edits is a defect
(`reference/source-fidelity-gate.md` § Script adaptations).

**After the static gate passes, interaction parity is a REQUIRED gate
output per archetype — not a post-pass**
(`reference/recreation-procedure.md` § Interaction parity). Motion is OBSERVED,
never inferred from static classes or CSS: run
`stardust/scripts/replica/motion-observe.mjs` per archetype live URL →
`stardust/replica/motion/<slug>.json`, implement ONLY behaviors that
fired (dead classes = NOT implemented), record
`motion: {observed, implemented, dead[]}` in `progress.json`, and re-run
pixel-compare — the number must return to the gated value.
Widgets are implemented, not justified away. Fan-out briefs carry the
evidence rule + instrument invocation verbatim.

When all breakpoints pass, present the archetype + its gate metrics for
approval per the standard prototype approval flow (hands-off mode records
`approvedBy: "hands-off"` per `../stardust/reference/state-machine.md`).

### Phase 5 — HANDOFF (delegate — migrate → deploy → rollout, unchanged)

- **Pages beyond the archetypes** go through the stardust `migrate` skill at
  **sibling tier** (`../migrate/reference/fidelity-tiers.md`): structural
  clone of the gated archetype + content-fidelity + delivery-lint +
  media-reconcile. Siblings inherit the archetype's source-fidelity gate —
  never re-author one from scratch. **Template constancy is measured, not
  assumed**: before cloning, run `stardust/scripts/replica/sibling-variance.mjs
  <archetype> <siblings…> --probe <block>=<sel> … --brief` once per template
  and budget every delta as a block VARIANT class on the sibling's content
  (same file, § Sibling variance probe). A new
  module kind on a sibling → the lift ledger rule (Phase 3). Content-fidelity
  is **measured per page at import time** (same file, § Content-count
  acceptance) so importer bugs surface while cheap to fix.
- **Delivery** via the stardust `deploy` skill per page. Bias the decode tier toward
  **template-slotted** for fixed-composition sections (deploy #95): replica
  sections are fixed compositions matched to a live original.
  Repeat groups (cards, listings) stay reconstructive. **Blocks
  obey the Experience Workspace editability contract (`../deploy/reference/block-js-scaffold.md` § Experience Workspace editability contract, EW1–EW10:
  node-slotting, never value-slotting) and pass `block-roundtrip --ew`.**
- **Site-wide rollout** via the stardust `rollout` skill, unchanged — its block dedup
  is what implements "same blocks across the whole site".
- **The hand-off names the captured variant.** Every brief and report
  carries `captured variant: <observed variant markers, capture date,
  consent mode>` and the line "your browser may render a different variant —
  compare against the capture, not a fresh live view" (A/B, geo and cookie
  buckets: `reference/recreation-procedure.md` § Asset harvest and the
  capture-state policy).
- **The final gate runs against the PUBLISHED origin — not the harness**
  (`reference/source-fidelity-gate.md` § The published-origin gate): the
  delivery pipeline transforms markup, so harness numbers understate.
  Re-run the full gate per delivered page against the preview/live origin,
  judged in the published-origin regime; only the published number counts;
  at site scale the fix loop after that gate is rollout
  `../rollout/reference/sweep-protocol.md` (sample, class rounds, tail, one
  confirmation sweep).
- **Hand-off shape**: the close-out follows
  `../stardust/reference/handoff-report.md` § Gate table first — gate table
  before counts, provenance per row.
- **Wave close chains.** A gate PASS or wave close starts the next planned
  step in the same turn — master `../stardust/SKILL.md` § Hands-off mode →
  Turn-end contract (`approvedChain`).

**State:** replica writes its own state under `stardust/replica/` — the
inconsistency register, `progress.json` (per page type: archetype slug,
iterations used, per-breakpoint gate results, residuals, motion
inventory, `modules[]` lift ledger; top-level `captureState.consent` = the project's consent mode,
`accept` | `deny`, read by `gate.sh`), `motion/<slug>.json`, and
`gates/<slug>-<width>/` evidence (each PNG with its provenance sidecar).
Pipeline status stays in the core `state.json` — replica never redefines it.

## What replica never does

- **No redesign.** No new palette, type, spacing, composition, motion.
- **No content rewriting.** Captured strings verbatim; placeholders and
  hydration states replicated as captured, not "fixed".
- **No invented improvements.** A change without a register entry is a
  defect, however tasteful.
- **No DOM copying.** Never paste the live DOM or port page-level CSS.

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
│   └── gates/<slug>-<width>/           ← live.png, build.png, diff-<label>.png, gate-<label>.json per round
└── migrated/                           ← from migrate (Phase 5)

PRODUCT.md / DESIGN.md / DESIGN.json    ← promoted verbatim from current/ (Phase 2)
```

## References

- `reference/preserve-direction.md` — mechanical promotion contract,
  inconsistency-register entry schema, impeccable ignore set.
- `reference/recreation-procedure.md` — CSS lifting, fonts, capture-state
  policy, fixed/sticky chrome, parity rules, CSS-portation fallback.
- `reference/source-fidelity-gate.md` — the full gate contract: probes, pass
  bar, bands, iteration regimes, hardening, published-origin gate, residuals.
- `../diff/SKILL.md` — the two probes replica reuses (`--profile generic`);
  reading content-diff output; the #87 JOIN/SPLIT limitation.
- `../extract/SKILL.md` § Prep mode — what Phase 1 provides.
- `../migrate/reference/fidelity-tiers.md` — archetype/sibling model Phase 5
  hands off to.
- `../deploy/reference/audit-and-naming.md` § 2b. Section schema + decode tier (#95) — template-slotted bias.
