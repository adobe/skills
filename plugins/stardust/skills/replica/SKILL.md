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
| Setup | `node skills/stardust/scripts/preflight-runtime.mjs` (runtime deps → `stardust/node_modules`); copy this skill's `scripts/` → `stardust/scripts/replica/` and `../diff/scripts/` → `stardust/scripts/diff/`; after Phase 1: `replica/impeccable-ignores.mjs [--files]` |
| 1 | `$stardust extract <URL> --prep --dynamics` — bounded entry: `--single` / `--pages <slug,...>`; then `replica/chrome-variants.mjs --write` (chrome variants from the capture, zero live hits) |
| 2 | mechanical promotion + `stardust/replica/inconsistency-register.md`; the `dynamics` skill Phases 1–3 |
| 3 | `replica/lift.mjs <live> --width <w>` per gate width (`--save-css`), chrome archetype row per variant first (`reference/chrome-states.md` § Chrome variants), then author `stardust/prototypes/<slug>-proposed.html` (+ per-page CSS) |
| 4 | serve: `replica/serve.mjs stardust/prototypes --role proto` (port from `replica/port.mjs proto`; `port.mjs stop proto`); probes 1+2: `diff/content-diff.mjs`, `diff/visual-diff.mjs` (`--profile generic --width <w> --main <root> --dismiss`); probe 3: `replica/stitch-shot.mjs`, `replica/pixel-compare.mjs --timeout <s>`, `replica/review-image.mjs --bands|--sheet`; inner loop: `replica/anchor.mjs --landmarks --cache|--against`, `replica/chrome-parity.mjs --live-cache`, `replica/gate.sh <slug> <live> <proto> <width> [iter] [--marker] [--refresh] [--variance] [--over-cap <reason>] [--record → replica/progress-record.mjs]`; sweeps: `replica/gate-batch.mjs <pairs.tsv> [--concurrency 2]` (progress: `stardust/.work/replica/gate-batch.progress.json`) — env `GATE_STITCH_TIMEOUT`, `GATE_COMPARE_TIMEOUT`, `GATE_ANCHOR_TIMEOUT`, `GATE_REAP_MIN`, `GATE_BLOCK`, `GATE_ALLOW_CONSENT`, `GATE_TOKEN_ENV`, `GATE_LANDMARKS=0`; each node step runs under `replica/run-capped.mjs --timeout <s> -- <cmd>`; then `replica/motion-observe.mjs <live> [--hover <sel>] [--click <sel>] [--triggers auto]` → `replica/motion-assert.mjs <observe.json> <proto> --record stardust/replica/progress.json --slug <slug>`; chrome cells: `replica/chrome-states.mjs <live> [<proto>] --from-state stardust/state.json --live-cache` |
| 5 | `replica/gate-ledger-lint.mjs --state stardust/state.json` (exit 2 = blocked types); `replica/chrome-variants.mjs --progress stardust/replica/progress.json` (exit 2 = a variant without its chrome row); first: `deploy` the approved archetype to a branch preview; `replica/sibling-variance.mjs <archetype> <siblings…> --probe <block>=<sel>`; then the `migrate` (sibling tier) → `deploy` → `rollout` skills; re-run the Phase 4 gate (and `motion-assert.mjs … --regime published-origin`) against the published origin |

Gates: Phase 2 — every dynamic-surface row has a disposition. Phase 4, per breakpoint (default `1440,360`) — content-diff 0 structural 🔴 · visual-diff flags none/justified · pixel diff ≤ 10% with no hot band unexplained · height |Δ| ≤ 8px · cap 3 iterations · interaction parity recorded · chrome state matrix probed, every cell gated or a named residual. `gate.sh` exits: 0 pass · 2 fail · 1 error / incomparable captures · 3 bot challenge · 4 wrong server · 5 invalid capture (consent / short / overlay / error page) · 6 cap reached (decide: residual / register / `--over-cap <reason>`; `--invalidate <label> <fix>` excludes a defect round; `--record` copies the round into `progress.json`) · 124 deadline (re-run, not a FAIL).

Outputs: `stardust/direction.md` · `stardust/replica/{inconsistency-register.md, progress.json (+ `.chrome`), motion/<slug>.json, variant-census.json, capture/lift/, gates/<slug>-<width>/}` · `stardust/current/layout-clusters.json` · `stardust/.work/ports.json` · `stardust/prototypes/<slug>-proposed.html` · root `PRODUCT.md` / `DESIGN.md` / `DESIGN.json`.

| At phase | Read |
|---|---|
| Setup | `../stardust/reference/state-machine.md` § Flow keys; `reference/preserve-direction.md` § 4. Impeccable ignore set |
| 2 | `reference/preserve-direction.md` § 1. Promotion contract · § 1a. Bounded promotion branch · § 3. The inconsistency register; `../dynamics/reference/triage.md` § Dispositions |
| 3 | `reference/recreation-procedure.md` § Authoring order · § Cumulative archetype prototypes · § CSS lifting · § Fonts policy · § Asset harvest and the capture-state policy · § CSS-portation fallback; parallel archetypes: `../stardust/reference/fan-out.md` § Scope and type of delegated agents · § Worker contract |
| 4 | `reference/source-fidelity-gate.md` § Per-breakpoint procedure · § Pass bar · § Reading the band breakdown · § Iteration discipline · § Hardening rules · § Script adaptations; `../stardust/reference/context-hygiene.md` § Image reads; after a capped round: § Residual classes; close: `../stardust/reference/run-status.md` § Phase close |
| 4, after the static pass | `reference/recreation-procedure.md` § Interaction parity · § Chrome archetype and the state matrix · § Fixed and sticky chrome · § Granularity parity; `reference/chrome-states.md` § The matrix · § Contract |
| 5 | `../migrate/reference/fidelity-tiers.md` § Sibling variance probe · § Module-map precondition · § Content-count acceptance; `reference/source-fidelity-gate.md` § The published-origin gate · § Residual logging format; `../rollout/reference/sweep-protocol.md` § The fix loop |

Sections: Inputs · Setup · Procedure · What replica never does · Outputs · References.

Same pages, same content, same design — new platform. `replica` keeps the
current design **near pixel-perfect**: the target spec IS the captured current
state, the only permitted deltas are the entries of an explicit
**inconsistency register**, and every archetype must pass a **measured
source-fidelity gate** against the live site before anything ships.

Two properties separate this from redesign: **no creative decisions**
(mechanical promotion of the captured spec; `direct` is never invoked) and
**recreation, not copying** (clean HTML/CSS from captured content + values
lifted from the source CSS — never DOM copies or ported stylesheets; fidelity
is proven by instruments).

## Inputs

- `<URL>` — required. The site to migrate.
- `--breakpoints <list>` — gate breakpoints, default `1440,360`; each gets
  its own gate pass (a 1440-tuned page is not gated at 360).
- `--register <file>` — inconsistency items seeding the register (Phase 2);
  without it and without an audit the register is empty — a pure replica.

## Setup

1. Run the master skill's setup (`../stardust/SKILL.md` § Setup):
   impeccable dep level, state read. **Flow guard.** If `state.json.flow` is
   `redesign`, refuse: print the never-mix line and the switch command
   (`$stardust replica --switch-flow` — master § Two migration flows). If
   `flow` is absent, stamp `flow: "replica"`,
   `flowSource: "user-phrase"` (`../stardust/reference/state-machine.md`
   § Flow keys): invoking `replica` is the choice.
2. Run the runtime preflight: `node skills/stardust/scripts/preflight-runtime.mjs`
   — playwright, pixelmatch and pngjs resolve from `stardust/node_modules`
   for every gate run (`../stardust/reference/runtime-preflight.md`).
3. Never `npm i … --no-save` in the EDS repo: the repo's own `npm i` prunes
   it; `stardust/node_modules` is the one dependency dir.
4. Copy scripts into the project and run them from there: this skill's
   `scripts/` to `stardust/scripts/replica/` AND `../diff/scripts/` to
   `stardust/scripts/diff/` — never into the project-root `scripts/` (the
   EDS boilerplate's write boundary).
5. **Impeccable ignore set for lifted values** — once, after the Phase 1
   capture: `node stardust/scripts/replica/impeccable-ignores.mjs`
   (`--files` on the user's go / hands-off; `--tokens` for the Phase 3
   lift). Contract: `reference/preserve-direction.md` § 4.

## Procedure

Five phases: 1 and 5 delegate to existing skills unchanged; 2–4 are
`replica`'s.

### Phase 1 — EXTRACT (delegate to `$stardust extract --prep --dynamics`)

Invoke `$stardust extract <URL> --prep --assets full`, unchanged (prep mode:
the full inventory, not the discovery cap):

- `stardust/current/pages/<slug>.json` — per-page structure + content
  (verbatim source of every prototype string).
- `stardust/current/assets/screenshots/` — per-page captures (ground truth).
- `stardust/current/assets/` — fonts, logo, media harvested from the render's
  own responses (`media/_media-manifest.json`; `images[].localPath` per record
  — prototypes reference the copies, never the source CDN URL).
- `stardust/current/PRODUCT.md`, `DESIGN.md`, `DESIGN.json` — the descriptive
  current state (Phase 2 promotes these verbatim).
- `state.json.pages[].type` — page types (each becomes one archetype: the
  page whose layout cluster and chrome variant cover the most siblings —
  `layout-cluster.mjs`, `chrome-variants.mjs` — never the first or prettiest);
  `pages[].chromeVariant` from `chrome-variants.mjs --write` — a second
  variant opens the `chrome-variant` decision row before its fan-out.
- `DESIGN.json.extensions.modules[]` — module candidates (become blocks).

Lead extract's summary with "Flow: replica — the design is kept; say
`switch to redesign` now if it is to change" (it runs `$stardust
prepare-migration --switch-flow`; the extract is reused, nothing else).

**Bounded entry (one page or a pilot).** `$stardust extract <URL> --single`
(or `--pages <slug,...>`) is a first-class entry: per-page JSON, screenshot
and fonts are provided; it skips the
prep-only inventory (a pilot that grows re-runs Phase 1 with `--prep`) and
the descriptive synthesis, so Phase 2 takes the **bounded promotion branch**
(`reference/preserve-direction.md` § 1a), provenance `bounded-single`; extract
still writes `_brand-extraction.json` with `_provenance.mode: "bounded"` — the
branch reads a real file, never a synthesized spec.

Extract's failure modes apply as-is (ladder, consent, no-synthesis); the gate
instruments start at the tier extract recorded. A chrome capability outside the captured page (menu,
search, language) is a plan row with a phase, never a journal note.

### Phase 2 — PRESERVE DIRECTION (mechanical — never invoke the stardust `direct` skill)

Full contract: `reference/preserve-direction.md`. Summary:

1. **Promote** `stardust/current/PRODUCT.md`, `DESIGN.md`, `DESIGN.json`
   verbatim to the project root as the target spec — no divergence roll, no
   re-direction, no Mode A/B: the current state IS the target. **Bounded
   entry (`--single`/`--pages`): those files don't exist** — the bounded
   promotion branch (`reference/preserve-direction.md` § 1a): a minimal
   descriptive spec from the captured page JSON + the Phase-3 CSS lift,
   provenance `bounded-single`. Never mix the branches.
2. **Write `stardust/direction.md`** recording preserve mode: what was
   promoted, from where, provenance (`--prep` verbatim vs `bounded-single`),
   the register pointer.
3. **Build the inconsistency register** at
   `stardust/replica/inconsistency-register.md` — the ONLY permitted design
   deltas. Sources: `audit` design findings (only if the user wants
   improvements) and/or `--register` items; every entry needs captured
   evidence + the minimal change + a status. **Empty register = pure
   replica** — a valid outcome.

4. **Dynamic surface (migration gate — the stardust `dynamics` skill Phases 1–3).**
   Phase 1 must have run `extract --dynamics`. Run the detector on the
   archetypes, draft the triage (`--target-origin` when the EDS host is
   known), curate `stardust/dynamic-features.md` + `-plan.md`: every row
   gets a disposition; the static recreation continues regardless
   (`skills/dynamics/reference/triage.md`).
5. **Plan gate.** Present every `stardust/decisions.md` row not yet
   `owner-decided` as one numbered message, default on each line
   (`../stardust/reference/decisions.md` § How phases use it); the
   dynamics batch rides along.

### Phase 3 — RECREATE (one archetype per page type, one exemplar per layout cluster)

Parallel archetypes: one worker per archetype gate loop
(`../stardust/reference/fan-out.md` § Worker contract), its own
`progress-<slug>.json` merged by the lead; briefs cite § Cumulative
archetype prototypes.

Full method: `reference/recreation-procedure.md`. For each page type in the
inventory, author `stardust/prototypes/<slug>-proposed.html` (+ per-page CSS)
as **clean semantic HTML/CSS** from three sources, in this order:

(a) **Captured page JSON content — verbatim.** Headings, body, CTAs+hrefs,
    alt text, metadata from `current/pages/<slug>.json`. The migrate
    content-preservation rules (`../migrate/reference/content-preservation.md`)
    apply from the first line: no rewording, no fabrication.
(b) **Exact values lifted from the source site's own CSS** — `lift.mjs`
    at each gate width, never the eye (container model, type ramp, buttons,
    paddings, radii, shadows, hero heights, `@media`, `@font-face`), after `replica/variant-census.mjs
    --type <t> --css … --code …` (majority variant first, minority ≥ min-pages
    budgeted as variant classes; `../migrate/reference/fidelity-tiers.md`
    § Sibling variance probe).
(c) **The captured screenshot as ground truth** for what CSS doesn't name
    (composition, image crops, paint effects).

**Every archetype gets its own standalone, cumulative prototype**: it
imports the layers earlier ones gated and iterates only on its NEW modules
(`reference/recreation-procedure.md` § Cumulative archetype prototypes).

**Module-kind lift ledger — `progress.json.modules[]`:** one entry per
module KIND, `{ kind, firstSeen: <slug>, lifted: { "1440": <gate artefact>,
"360": <gate artefact> } }`; lifted = a gate artefact at BOTH breakpoints.
A sibling (Phase 5) introducing a kind absent from the ledger triggers a
lift plus a Phase 4 gate ON THAT SIBLING at both breakpoints first. Each
kind lifted here gets an emitter in `stardust/import/vocabulary.json` before
migrate's sibling tier renders the template (migrate § Module-map
precondition; `importer-skeleton.mjs --template` blocks an unmapped kind at
plan time).

**Recreation, not redesign — never delegate to impeccable craft** (Phase 4
replaces its gates).

**Fonts:** same public source when available; licensed kits are never
rehosted — metric-matched substitute, surfaced to the user
(`reference/recreation-procedure.md` § Fonts policy).

**CSS-portation is the per-section fallback only** (paint effects, hydrated
widgets, video heroes) — scoped, never page-level; criteria in
`reference/recreation-procedure.md` § Fallback.

### Phase 4 — SOURCE-FIDELITY GATE (the heart — measured, per breakpoint)

Full contract: `reference/source-fidelity-gate.md`. Run per archetype, per
breakpoint (default 1440 AND 360), live URL as source vs served prototype:

```bash
node stardust/scripts/replica/serve.mjs stardust/prototypes --role proto &   # own port, marker file, pidfile
PROTO="http://127.0.0.1:$(node stardust/scripts/replica/port.mjs proto)/<slug>-proposed.html"   # the project's 8800–8899 slot, never 8791
# no serve.mjs: python3 -m http.server 8791 -d stardust/prototypes → PROTO=http://localhost:8791/… (a typed port is still identity-gated, exit 4)
# a foreign listener is listed, never killed — the allocator moves; gate.sh asserts the marker (exit 4 = no verdict)
LIVE="https://<site>/<path>"

# Probe 1+2 — the diff skill's two probes, generic profile
node stardust/scripts/diff/content-diff.mjs "$LIVE" "$PROTO" --profile generic --width 1440 --main "<content-root>" --dismiss
node stardust/scripts/diff/visual-diff.mjs  "$LIVE" "$PROTO" --profile generic --width 1440 --main "<content-root>" --dismiss

# Phase 3 evidence, once per width: node stardust/scripts/replica/lift.mjs "$LIVE" --width 1440 --save-css
# Probe 3 — gate.sh wraps stitch-shot (stitched, NEVER fullPage) + pixel-compare;
# masks only via stardust/replica/masks.json (rule 19). Inner loop (gate doc
# § Band breakdown): anchor both sides (--cache), chrome-parity --live-cache first, then
stardust/scripts/replica/gate.sh <slug> "$LIVE" auto 1440   # build URL from ports.json; cached live.png, deadlines, round record, cap
```

**Pass bar (all five, per breakpoint — the fifth is the chrome crop gate,
gate doc item 5, cells per `reference/chrome-states.md`):**
- content-diff: **0 structural 🔴** (🟡/🟠 confirmed intended);
- visual-diff: flags none or justified;
- pixel diff: **≤ 10%** full-page, with no per-500px band left unexplained
  (fix the first hot band top-down — gate doc § Reading the band breakdown);
- height delta **|Δ| ≤ 8px** (pixel-compare's own warning bar).

**Iteration discipline: hard cap 3 iterations per breakpoint.** Fixes come
off the instruments, never eyeballing (image reads: read table 4). After 3 an over-bar breakpoint is
**FAIL** unless every residual is a named class with `artifacts[]` +
`acceptedBy` (gate doc § Residual classes · § Residual logging format;
`result` copied from `gate-<label>.json`); hands-off never approves it.
Three named regimes end a loop early or sit outside the cap —
`source-inconsistent`, `separate-composition`, `canon-followup` (gate doc
§ Iteration discipline).

**Hardening — the gate doc § Hardening rules is the list**, built into
`diff/scripts/live-session.mjs` and shipped as flags: a challenge fails loud
(exit 3), the ladder climbs, never degrades; `domcontentloaded`; symmetric
`--main` (`body` never valid); pinned chrome hidden on chunks 2+; JOIN/SPLIT
parity; capture-state policy. A hand-edited project copy is a defect (gate
doc § Script adaptations).

**After the static gate passes, interaction parity is a REQUIRED gate
output per archetype — not a post-pass**
(`reference/recreation-procedure.md` § Interaction parity). Motion is OBSERVED,
never inferred: `motion-observe.mjs` per archetype live URL (`--hover`,
`--click`, `--triggers auto`) → `stardust/replica/motion/<slug>.json`;
implement ONLY behaviors that fired (dead classes = NOT implemented), record
`motion: {observed, implemented, dead[]}` in `progress.json`; then
`motion-assert.mjs <observe.json> <proto> --record … --slug <slug>` replays
it against the PROTOTYPE (never live) and writes `breakpoints.<bp>.motion.assert`
(🟡 advisory verdict this release; no record = `motion: unasserted`); re-run
pixel-compare — the number must return to the gated value. Widgets are
implemented, not justified away. Fan-out briefs carry the evidence rule +
both invocations verbatim.

When all breakpoints pass — and the archetype's chrome variant row is gated
(`progress.json.chrome`, its state matrix named in the approval message) —
present the archetype + its gate metrics for approval per the standard
prototype approval flow (hands-off records `approvedBy: "hands-off"`).
The close leads with what is NOT green per archetype × breakpoint (`home
360: FAIL 12 % (register: R-04)`, `… 360: ungated`, `… 1440: motion:
unasserted`), then the passes and the coverage line `archetypes gated A of T
at <bp> · ungated: <slug@bp …>` from `progress.json`; an archetype without
its `motion.assert` record is `ungated` for approval — hands-off never
approves it. The phase-close block (master § Phase close) carries
`EDS URL: <branch preview URL> | none yet`.

### Phase 5 — HANDOFF (delegate — migrate → deploy → rollout, unchanged)

- **First act after approval: put the archetype on an EDS preview.** Run
  the `deploy` skill Steps 1–9 for the approved archetype, then
  `deploy-batch.mjs … --branch <branch>` (preview only — D16; live publish
  is a separate `--publish` on PASS, D1) and iterate on the published
  origin (gate doc § The published-origin gate). Approval is the trigger —
  hands-off never asks "ready to deploy?"; no EDS origin yet →
  `../deploy/reference/site-bootstrap.md` (rollout Setup step 3).
- **Pages beyond the archetypes** go through the stardust `migrate` skill at
  **sibling tier** (`../migrate/reference/fidelity-tiers.md`): structural
  clone of the gated archetype + content-fidelity + delivery-lint +
  media-reconcile. Siblings inherit the archetype's **prototype** gate; every
  delivered page carries its own published-origin evidence (sample or cheap
  probe — `../rollout/reference/sweep-protocol.md` § Coverage regime) — never
  re-author one from scratch. First `replica/layout-cluster.mjs --type
  <t> --write-state`: a layout cluster ≥ T without a gated exemplar is a
  coverage gap — nothing in it renders (same file, § Sibling variance probe,
  Layout clusters). **Template constancy is measured**:
  `replica/sibling-variance.mjs <archetype> <siblings…> --probe <block>=<sel>
  --brief` (or `--from-clusters`) once per template; every delta = a block
  VARIANT class on the sibling's content; census + probe JSON go next to
  the brief. A new module kind on a sibling → the lift ledger rule (Phase 3). Content-fidelity
  is **measured per page at import time** (same file, § Content-count
  acceptance).
- **Delivery** via the stardust `deploy` skill per page: decode tier biased
  to **template-slotted** for fixed compositions (deploy #95), repeat groups
  reconstructive; blocks obey the Experience Workspace editability contract
  (`../deploy/reference/block-js-scaffold.md`, EW1–EW10) and pass
  `block-roundtrip --ew`.
- **Site-wide rollout** via the stardust `rollout` skill — its block dedup
  implements "same blocks across the whole site".
- **The hand-off names the captured variant**: every brief and report
  carries `captured variant: <markers, capture date, consent mode>` —
  compare against the capture, not a fresh live view
  (`reference/recreation-procedure.md` § Asset harvest and the
  capture-state policy).
- **The final gate runs against the PUBLISHED origin — not the harness**
  (gate doc § The published-origin gate): the pipeline transforms markup, so
  harness numbers understate. Re-run the full gate per delivered page on the
  published origin — only that number counts — after
  `node skills/deploy/scripts/code-sync-verify.mjs --org <org> --repo <repo>
  --ref <branch>` exits 0 (served == tree; a stale-served round is no
  iteration); at site scale the fix loop is `../rollout/reference/sweep-protocol.md`.
- **Hand-off shape**: `../stardust/reference/handoff-report.md` § Gate table
  first — failing and `ungated` rows first, provenance per row,
  `published.<bp>` absent = `ungated`.
- **Wave close chains** — a gate PASS or wave close starts the next planned
  step in the same turn (master § Hands-off mode → Turn-end contract).

**State:** replica writes only under `stardust/replica/` (Outputs tree);
`progress.json` carries per page type the archetype slug, rounds, per-breakpoint
gate results, residuals, motion, `chromeVariant`, the `modules[]` lift ledger,
plus the top-level `chrome` variants ledger and `captureState.consent`
(`accept` | `deny`, read by `gate.sh`); every gate PNG has a provenance sidecar.
Pipeline status stays in the core `state.json` — replica never redefines it.

## What replica never does

No redesign (palette, type, spacing, composition, motion); no content
rewriting (captured strings verbatim, placeholders and hydration states as
captured); no invented improvements (a change without a register entry is a
defect); no DOM copying or page-level CSS porting.

## Outputs

```
stardust/
├── state.json                          ← core state machine (unchanged contract)
├── direction.md                        ← preserve-mode record (Phase 2)
├── current/                            ← from extract --prep
├── prototypes/<slug>-proposed.html     ← gated archetypes (one per page type)
├── replica/
│   ├── inconsistency-register.md       ← the ONLY permitted design deltas
│   ├── progress.json                   ← per-page-type ledger (rounds, residuals, motion)
│   ├── motion/<slug>.json              ← motion-observe evidence
│   └── gates/<slug>-<width>/           ← live.png, build.png, diff-<label>.png, gate-<label>.json per round
└── migrated/                           ← from migrate (Phase 5)

PRODUCT.md / DESIGN.md / DESIGN.json    ← promoted verbatim from current/ (Phase 2)
```

## References

- `reference/preserve-direction.md` — mechanical promotion contract,
  inconsistency-register entry schema, impeccable ignore set.
- `reference/recreation-procedure.md` — lifting, fonts, capture state,
  chrome, parity, CSS-portation fallback.
- `reference/chrome-states.md` — chrome states: the matrix, the item-5 cells contract, nav model.
- `reference/source-fidelity-gate.md` — the full gate contract.
- `../diff/SKILL.md` — the two probes replica reuses (`--profile generic`).
- `../extract/SKILL.md` § Prep mode — what Phase 1 provides.
- `../migrate/reference/fidelity-tiers.md` — the archetype/sibling model.
- `../deploy/reference/audit-and-naming.md` § 2b — template-slotted bias (#95).
