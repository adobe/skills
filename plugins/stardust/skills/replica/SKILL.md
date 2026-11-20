---
name: replica
description: Same-design migration — re-platform a site to AEM Edge Delivery (or any clean front end) keeping its current design near pixel-perfect. Recreates key pages (one archetype per page type) as clean re-authored HTML/CSS (never DOM copies), verifies each against the live site with a measured source-fidelity gate (structural + visual + stitched pixel diff per breakpoint), then hands off to migrate/deploy/rollout for site-wide delivery (subsumes prepare-migration's prep cascade — never chain the two). The only permitted design changes are entries in an explicit inconsistency register. Use when the user says "migrate this site keeping its current design", "same-design migration", "pixel-perfect replatform to AEM", or "keep the design, change the platform". NOT for redesigns — those are the stardust core pipeline (direct/prototype) or uplift.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
metadata:
  version: "1.5.1"
---

# stardust:replica — same-design migration

Same pages, same content, same design — new platform. The target spec IS
the captured current state, the only permitted deltas are the entries of an
explicit **inconsistency register**, and every archetype passes a **measured
source-fidelity gate** against the live site before anything ships.

1. **No creative decisions.** The direction step is mechanical promotion of
   the captured spec: the stardust `direct` skill is never invoked and
   impeccable craft is never delegated to (its redesign gates do not apply —
   a "tastefully improved" section is a failing section).
2. **Recreation, not copying.** Archetypes are clean semantic HTML/CSS
   authored from captured content and from values MEASURED on the source —
   never DOM copies, never ported page-level stylesheets. Fidelity is proven
   by instruments, not asserted.

## Inputs

- `<URL>` — required. The site to migrate.
- `--breakpoints <list>` — optional. Gate widths, default `1440,360`; each
  gets its own gate pass (mobile is not free — gate doc § Per-breakpoint).
- `--target-breakpoints <list>` — optional. Mobile-first `min-width` steps
  (e.g. `600,900,1200`) the delivered site switches layout at instead of the
  source's. Absent = source breakpoints kept, every target step below
  skipped. Persisted in `DESIGN.json` `extensions.breakpoints.target`.
- `--register <file>` — optional. Inconsistency items to seed the register
  (Phase 2). Without it and without an audit the register is empty.
- `--first-page <url|home>` — optional; hands-off `home`. The page a
  full-site run delivers first (`reference/first-page-first.md`).

## Setup

1. Run the master skill's setup (`../stardust/SKILL.md` § Setup). **Flow
   guard:** if `state.json.flow` is `redesign`, refuse — print the never-mix
   line and the switch command (`$stardust replica --switch-flow`; master
   skill § Two migration flows). If `flow` is absent, stamp
   `flow: "replica"`, `flowSource: "user-phrase"`.
2. Probe the gate's deps from the project root —
   `node -e "import('pixelmatch').then(()=>process.exit(0))"` (and
   playwright, pngjs, cheerio) — and only on failure install them AS
   devDependencies, never `--no-save` (`npm i -D playwright pixelmatch pngjs
   cheerio --legacy-peer-deps`): ESM resolves from the project root, and the
   delivered repo carries what is installed.
3. Copy scripts into the project and run them from there: this skill's
   `scripts/` to `stardust/scripts/replica/`, `../stardust/scripts/` to
   `stardust/scripts/stardust/`, `../migrate/scripts/` to
   `stardust/scripts/migrate/` and `../diff/scripts/` to
   `stardust/scripts/diff/` (siblings — the gates import across them). Never
   into the project-root `scripts/`: that is the EDS boilerplate's.

**The context is the budget** — read `reference/reading-discipline.md` once
at Setup. Reference docs by section (`section.mjs <doc> --list`, then one
heading per call); captures through `css-rules.mjs`, `json-query.mjs` and
`html-slice.mjs`; instrument output through `run-bg.mjs wait` and
`log --grep`, never `cat`; script flags from
`../stardust/reference/scripts-index.md`, then `--help`, never the source.

## Procedure

Five phases. 1 and 5 delegate to existing skills unchanged; 2–4 are
replica's. A full-site run opens first page first
(`reference/first-page-first.md`). Every phase opens with
`node stardust/scripts/stardust/ledger.mjs replica <phase> start` as its
FIRST command and closes with the `end` line plus its section in
`stardust/journal.md` (`../stardust/reference/run-status.md`).

### Phase 1 — EXTRACT (delegate to `$stardust extract --prep --dynamics`)

Invoke `$stardust extract <URL> --prep --dynamics`, unchanged. Replica
consumes the full migration inventory: `stardust/current/pages/<slug>.json`
(the verbatim source of every string), the per-page screenshots, the
captured fonts and media, the descriptive `PRODUCT.md` / `DESIGN.md` /
`DESIGN.json`, `state.json.pages[].type` (each type becomes one archetype)
and `DESIGN.json.extensions.modules[]` (block candidates).

Surface extract's summary with the flow line first — "Flow: replica — the
design is kept. Say `switch to redesign` now if it is to change."
(`switch to redesign` runs `$stardust prepare-migration --switch-flow`; the
extract is reused, nothing else is.)

**Bounded entry (one page, or a pilot):** `$stardust extract <URL> --single
--dynamics` (or `--pages <slug,...> --dynamics`) is a first-class way in. It
provides what recreation needs per page; it skips page typing and module
detection, needed only when Phase 5 fans out, and the descriptive synthesis
(Phase 2 takes the bounded promotion branch).

If extract fell back to headed Chrome, the gate captures need `--headed` too.

### Phase 2 — PRESERVE DIRECTION (mechanical — never invoke the stardust `direct` skill)

Full contract: `reference/preserve-direction.md`.

1. **Promote** `stardust/current/PRODUCT.md`, `DESIGN.md`, `DESIGN.json`
   verbatim to the project root as the target spec — no divergence roll, no
   re-direction. Bounded entry: those files do not exist; take the bounded
   promotion branch (§ 1a, provenance `bounded-single`). Never mix the two.
2. **Write `stardust/direction.md`**: what was promoted, from where, the
   provenance and the register pointer — what tells downstream skills the
   direction step happened.
3. **Build the inconsistency register** at
   `stardust/replica/inconsistency-register.md` — the ONLY permitted design
   deltas. Sources: `audit` design findings (only when the user wants
   improvement candidates) and `--register` items; every entry carries
   captured evidence, the minimal change and a status. An empty register is
   a pure replica, a valid and common outcome.
4. **Target breakpoints** (only with `--target-breakpoints`), before any CSS
   exists (§ 4): persist the list, map each source breakpoint to a step in
   `stardust/replica/breakpoint-map.md`, seed the ONE register entry.
5. **Dynamic surface** (the stardust `dynamics` skill, Phases 1–3): run the
   detector on the archetypes, draft the triage, curate
   `stardust/dynamic-features.md` and its plan — every row gets a
   disposition (`skills/dynamics/reference/triage.md`). This is what
   surfaces the modals, forms, search and host-bound APIs a pixel gate
   certifies as correct.

Anything not in the register is out of scope for change: a recreation
choice that "improves" something unregistered is a fidelity bug.

### Phase 3 — RECREATE (one archetype per page type)

Full method: `reference/recreation-procedure.md` (§ Authoring order). For
each page type (archetype: the type's `rep_url` in a spec's
`archetypes.json`) author `stardust/prototypes/<slug>-proposed.html` (+ its
CSS):

1. **Measure the source first, at every gate width, before any CSS:**
   `node stardust/scripts/replica/source-spec.mjs capture <live-url> --slug
   <slug> --widths 1440,360` writes a spec per width and the header and
   footer inventory. Author from them.
2. **Content verbatim** from `current/pages/<slug>.json` — headings, body,
   CTAs and hrefs, alt text, metadata
   (`../migrate/reference/content-preservation.md`): no rewording.
3. **The source's CSS for what the spec cannot name** (states, media-query
   structure, tokens), read through `css-rules.mjs`. The container model is
   measured (DESIGN.json `extensions.breakpoints`; a bounded entry runs
   `cap-probe.mjs <live-url> --write-design stardust/current/DESIGN.json`
   first). Any other live-vs-prototype box check goes through
   `measure.mjs --against`, never an authored probe.
4. **`source-spec.mjs compare <spec> <prototype-url>` exits 0 at every
   width BEFORE the first gate round.**

**Fonts** (§ Fonts policy): the captured faces are self-hosted as-is,
proprietary ones with deploy's licensing alert and one register entry; a
substitute renders only a face with no captured file, declared in
`stardust/replica/font-subst.txt`.

**With a target set**, every `@media` rule and JS width threshold is
authored on the target steps from the first line per `breakpoint-map.md`;
`breakpoint-lint.mjs` exits 0 on a prototype before its gate.

**Every archetype gets its own standalone prototype — cumulative, never
skipped.** Never go straight to platform authoring for a new archetype:
direct-authored pages plateaued at 8–16 % in the field, prototyped ones at
3.5–5.6 %. Each new prototype imports the shared layers already gated and
iterates only on its new modules (§ Cumulative archetype prototypes).

**CSS-portation is the per-section fallback only** (§ CSS-portation fallback): paint
effects not recoverable from computed styles, JS-hydrated widgets, video or
animated heroes — the minimal source rules, scoped, never page-level.

### Phase 4 — SOURCE-FIDELITY GATE (measured, per breakpoint)

Full contract: `reference/source-fidelity-gate.md` ("gate doc"). Per
archetype, per breakpoint, live URL against the served prototype:

```bash
PROTO="http://localhost:8791/<slug>-proposed.html"   # ONE server, ONE port; one that answers but is not yours is never killed — take another port
LIVE="https://<site>/<path>"
G=stardust/replica/gates/<slug>-1440
# A round = gate.sh through run-bg, never a hand-written wrapper. The FIRST round of a
# breakpoint and the CONFIRMATION round after the last fix run --full; the others are pixel rounds.
node stardust/scripts/replica/run-bg.mjs start --name <slug>-1440-iter1 -- \
  stardust/scripts/replica/gate.sh <slug> "$LIVE" "$PROTO" 1440 iter1 --full --main "<content-root>"
node stardust/scripts/replica/run-bg.mjs start --name <slug>-360-iter1 -- \
  stardust/scripts/replica/gate.sh <slug> "$LIVE" "$PROTO" 360 iter1 --full --main "<content-root>"
node stardust/scripts/replica/run-bg.mjs wait   # verdict lines; exit 75 = still going → wait again as the NEXT step
# header and footer: style parity BEFORE any pixel round on them (exit 0 = quiet)
node stardust/scripts/replica/chrome-parity.mjs "$LIVE" "$PROTO" --width 1440 --live-cache $G/chrome-live.json
# content-cap row: once per archetype after the 1440 pass, at DESIGN.json's derived probeWidth
node stardust/scripts/replica/cap-probe.mjs "$LIVE" --against "$PROTO" --design DESIGN.json --slug <slug> --main "<content-root>"
# when the archetypes pass: the prototype table, one run per width — a prototype without a row is ungated
node stardust/scripts/replica/gate-all.mjs --stage prototype --proto-base "$PROTO_BASE" --width 1440
```

`gate.sh --help` lists the flags and exit codes. Its verdict lines are the
**pass bar** (gate doc § Pass bar): content-diff 0 🔴 and 0 nothing-lost 🟡;
visual-diff flags none or justified; pixel aligned ≤ 10 % with the offsets
within their bound; |Δh| ≤ 8 px; `Clipped: 0`; declared repeated units
within 4 px; no horizontal overflow; `cap-probe: PASS`. Exit 124 (deadline),
5 (unstable reference) and 3 (blocked — escalate `--headed`) are never a
verdict: fix the capture and re-run.

- **Reading a failing round** (gate doc § Reading the band breakdown): the
  offset steps are the fix list — fix every one in ONE round; bands are read
  after alignment. Every fix comes off an instrument line, never the eye.
- **Round cap** (gate doc § Iteration discipline): three counted rounds per
  page, width and stage. `gate.sh` exits 6 at the cap until
  `rounds.mjs decide` records the decision; residuals are logged, never
  iterated past it.
- **No step waits longer than the context cache lives:** a long instrument
  goes through `run-bg.mjs` (`start`, then `wait` in ≤ 100-second slices) —
  never in the foreground, never two as parallel tool calls, never behind a
  `sleep`.
- **Capture traps** are the scripts' flags, the same on both sides
  (`--consent`, `--dismiss`, `--headed`, `--locale`, `--main` — `--main
  body` is never valid); a project copy with hand-edits is a defect. The
  list: gate doc § Hardening rules.
- **With a target set (#131)** the gate widths add each target step; inside
  a shifted band a pixel failure is tier-shift (logged against the register
  entry) or a defect — gate doc § Target breakpoints.

**Interaction parity is a REQUIRED gate output per archetype, after the
static gate passes** (`reference/recreation-procedure.md` § Interaction
parity): motion is OBSERVED with `motion-observe.mjs`, never inferred from
classes or CSS; only what fired is implemented; the prototype is observed
the same way and compared with `motion-compare.mjs`. Record
`motion: {observed, implemented, dead[]}` in `progress.json`, then re-run
the pixel round — the number returns to the gated value.

When all breakpoints pass, present the archetype and its gate metrics for
approval (hands-off records `approvedBy: "hands-off"`). Bookkeeping is one
command each, never a hand-built JSON line: `node
stardust/scripts/stardust/state.mjs advance <slug> --to approved --by
hands-off --prototype stardust/prototypes/<slug>-proposed.html` and `node
stardust/scripts/stardust/ledger.mjs replica source-fidelity-gate end
--detail "<per-breakpoint numbers>"`. Resuming a run starts with
`ledger.mjs tail` and `state.mjs summary --slugs`, not `cat`.

### Phase 5 — HANDOFF (delegate — migrate → deploy → rollout, unchanged)

**Read the contract card first: `reference/handoff-contract.md`** — the
migrate, deploy and rollout rules this phase needs, the rollout ledger phase
strings, one usage line per script. Read it by section (`section.mjs
<doc> --list`, then the section a step needs), never whole, and never the
sibling SKILL.md files whole.

- **Pages beyond the archetypes** go through `migrate` at sibling tier
  (`../migrate/reference/fidelity-tiers.md`), only AFTER their archetype is
  live and gated at the published origin (contract § 3 row C). Siblings
  inherit the archetype's encoder, never a new one; template constancy is
  measured first (`sibling-variance.mjs`), content fidelity per page at
  import.
- **Delivery** via `deploy` per page: template-slotted for fixed
  compositions, reconstructive for repeat groups; blocks obey the
  editability contract and pass `block-roundtrip --ew`.
- **Site-wide rollout** via `rollout`, unchanged. C-deliver runs in recorded
  units (contract § 3 row C, Fan-out discipline): the foundation first,
  gated on the published origin with the header contract, then frozen (no
  frozen file is edited mid-wave); each
  archetype deployed and gated on its preview URL BEFORE its siblings
  render; one subagent per template cluster; C-final.
- **Target breakpoints:** C0 authors on the target steps and wires
  `breakpoint-lint.mjs` into `npm run lint`.
- **The final gate runs against the PUBLISHED origin, not the harness**
  (gate doc § The published-origin gate): `gate.sh <slug> "$LIVE"
  "<preview-url>" <width> pub1 --full --marker "<brand or domain string>"`
  through `run-bg.mjs`, in the page's ordinary gate dir. Nothing
  pixel-shaped runs on the local harness.
- **The delivery gate is the ALL-PAGES run** (gate doc § The all-pages
  published-origin gate): `node stardust/scripts/replica/gate-all.mjs
  [--only <slug,…>] [--skip-existing] [--eds-host <host>]` — pixel, height,
  clipped text and missing or hidden content; a page without a row is
  ungated. C-final ends with `update-coverage.mjs --gate`.

## What replica never does

- **No redesign.** No new palette, type, spacing, composition, motion.
- **No content rewriting.** Captured strings are verbatim; placeholders and
  hydration states are replicated as captured, not "fixed".
- **No invented improvements.** A change without a register entry is a
  defect, however tasteful.
- **No DOM copying.** Never paste the live DOM or port page-level CSS as the
  prototype: clean re-authoring is the point.

## Outputs

```
stardust/
├── state.json, direction.md, journal.md   ← core state, the preserve-mode record, the run journal
├── current/                               ← from extract
├── prototypes/<slug>-proposed.html        ← gated archetypes, one per page type
├── replica/
│   ├── inconsistency-register.md          ← the ONLY permitted design deltas
│   ├── breakpoint-map.md                  ← only with --target-breakpoints
│   ├── spec/<slug>-<width>.json           ← the measured source (Phase 3)
│   ├── progress.json                      ← per page type: rounds, gate results, residuals, motion
│   ├── motion/<slug>.json                 ← motion-observe evidence
│   └── gates/                             ← <slug>-<width>/ per round; prototypes-<width>/ and all-<width>/ tables
├── migrated/                              ← from migrate (Phase 5)
└── rollout/                               ← from rollout: progress.json (C-deliver units), foundation-freeze.json, foundation-requests.md
PRODUCT.md / DESIGN.md / DESIGN.json       ← promoted from current/ (Phase 2)
```

## References

- `reference/preserve-direction.md` — promotion contract, register schema.
- `reference/recreation-procedure.md` — authoring order, CSS lifting, fonts
  policy, fixed and sticky chrome, interaction parity, the fallback.
- `reference/source-fidelity-gate.md` — the gate: procedure, pass bar,
  reading a round, iteration discipline, hardening, the published-origin
  and all-pages gates, residual logging.
- `reference/handoff-contract.md` — Phase 5 contract card.
- `reference/reading-discipline.md`, `reference/first-page-first.md`.
- `../diff/SKILL.md` — the probes replica reuses, the header contract.
- `../migrate/reference/fidelity-tiers.md` — the archetype / sibling model.
