# Artifact map

## When to read what

- § Project root — when writing or reading the impeccable-format files at the project root: who owns the format and when stardust touches each.
- § `stardust/` — when locating any stardust-owned file: the full tree with owner and consumer per path.
- § Versioning — when deciding what a clone commits or ignores under `stardust/`.
- § Provenance shapes — when stamping a new HTML, JSON or Markdown artifact.
- § Site-level vs page-level — when unsure whether a decision belongs to `direct`'s system or `prototype`'s deployment.
- § Read-vs-write discipline — before any sub-command reads or writes: the read order, the write order, and the `state.json`-last rule.

Every file stardust reads or writes, who owns it, what it contains, and
how its provenance block is shaped.

---

## Project root (impeccable's format — stardust authors directly)

| Path             | Format owner | Stardust writes when                                         | Stardust reads when                    |
|------------------|--------------|--------------------------------------------------------------|----------------------------------------|
| `PRODUCT.md`     | impeccable   | `$stardust direct` authors it from the resolved direction    | every sub-command (target strategy)    |
| `DESIGN.md`      | impeccable   | `$stardust direct` authors it from the resolved direction + brand surface | `prototype`, `migrate`     |
| `DESIGN.json`    | impeccable   | `$stardust direct` authors it from the resolved direction + brand surface | `prototype`, `migrate`     |
| `AGENTS.md`      | impeccable   | never (read-only for stardust)                               | every sub-command (Design Context)     |

Stardust authors `PRODUCT.md`, `DESIGN.md`, and `DESIGN.json` **directly**,
treating impeccable's `reference/init.md` and `reference/document.md` as
**format specs** rather than runtime commands. Reasoning: by the time
`$stardust direct` runs, the user has already gone through stardust's
intent-reasoning interview — re-running impeccable's interview would
duplicate questions. The resolved direction in `stardust/direction.md`
carries every answer impeccable's interviews would surface.

Users who want impeccable to validate or refine the project-root files
can run `$impeccable init` or `$impeccable document` directly at any
time; stardust does not own those commands and will not interfere.

The same direct-authoring pattern is used for the descriptive files
under `stardust/current/` written by `$stardust extract`.

### `DESIGN.json.extensions`

The `extensions` object grows with the migrate-template-canon
refactor (see `notes/migrate-template-canon-refactor.md`):

- **`extensions.canon`** — pinned token values, compositional moves
  (free-text), and references to `stardust/canon/*` chrome and CSS
  files (`{ path, sha }` per file). Written by `$stardust prototype
  --prep` on first approval; extended on subsequent approvals.
- **`extensions.modules[]`** — brand module catalog: `id`, `slots`
  (with `name`, `type`, `required`, optional `default`),
  `canonicalRendering` reference. Auto-detected during `$stardust
  extract --prep`; promoted/refined during `$stardust direct
  --prep`.
- **`extensions.colorReservations[]`** — colors reserved to specific
  modules or contexts (e.g., centennial-red reserved to a
  `trh-100-lockup` module). Validated at migrate time; violation
  refuses the page.
- **`extensions.metadata`** — site-level metadata defaults: site
  name, default OG image, theme color, organization JSON-LD,
  default locale. Composed with per-page metadata at migrate time.

---

## `stardust/` (stardust's territory)

```
stardust/
├── state.json                        # state machine (state-machine.md)
├── status.jsonl                      # append-only phase-transition log — every skill appends start/end/blocked lines (run-status.md)
├── direction.md                      # resolved intent + reasoning trace
├── decisions.md                      # plan-time decision register — default rows applied, owner-decided rows, owner-only rows (decisions.md)
├── learnings.md                      # per-run learnings ledger — rollout writes, maintainers harvest (learnings.md)
├── dynamic-features.md               # the dynamic-surface inventory: listings contract + one row per feature with class · disposition · reproducibility · status (dynamics Phase 3; prepare-migration 4.5 / replica Phase 2 / rollout B2)
├── dynamic-features-plan.md          # phases with deliverables, authoring contract, verification, owner decision (dynamics Phase 3)
├── dynamics/                         # dynamics working dir: generated-plan draft, parity.json (Phase 5), snapshot sync logs
├── redirects.tsv                     # original→normalized path pairs from the path-safety gate (rollout Phase C)
├── runtime-contract.json             # EDS runtime probe result (deploy § Runtime-detection probe)
├── live-budget.json                  # learned per-host live ceiling — merge-by-host, written by a live tool (extract crawl.mjs) on a bare 429
├── uplift-improvements.md            # >=3 specific weaknesses (cut, not padded) — load-bearing for uplift's variant A (written by the stardust `uplift` skill Phase 2a; absent otherwise)
├── uplift-questions.md               # 6–8 "what if…" candidates with disqualifications (written by the stardust `uplift` skill Phase 2b; absent otherwise)
├── canon/                            # design canon (canon-extraction.md) — written by prototype --prep on first approval, extended on subsequent approvals
│   ├── header.html                   # canonical header chrome
│   ├── footer.html                   # canonical footer chrome
│   ├── canon.css                     # compound CSS (button/card/link/form language)
│   └── modules/
│       └── <module-id>.html          # canonical rendering per brand module
├── current/
│   ├── PRODUCT.md                    # impeccable-format strategy of the EXISTING site
│   ├── DESIGN.md                     # impeccable-format visual system of the EXISTING site
│   ├── DESIGN.json                   # sidecar
│   ├── brand-review.html             # self-contained visual review of the extraction (first eyeball-able artifact)
│   ├── _brand-extraction.json        # consolidated brand surface (palette, type, motifs, voice, system components)
│   ├── _crawl-log.json               # discovery + crawl audit trail
│   ├── pages/
│   │   └── <slug>.json               # per-page parsed structure + content (includes metadata block)
│   └── assets/
│       ├── logo.<ext>                # extracted logo
│       ├── screenshots/<slug>.png    # per-page viewport screenshots (used by brand-review)
│       └── media/                    # extracted images, with original URLs
├── prototypes/
│   ├── <slug>-shape.md               # per-page compositional brief (page-level deployment record)
│   ├── <slug>-proposed.html          # proposed redesign (iteration target, migration source, user-facing review surface)
│   ├── <slug>-cinematic.html         # cinematic variant — written only when `prototype --cinematic` ran (alongside proposed)
│   ├── lenis.min.js                  # smooth-scroll runtime (copied from skills/prototype/assets/motion/; cinematic only)
│   └── lenis.min.css                 # smooth-scroll styles (cinematic only)
└── migrated/                         # deployable static HTML site
    ├── index.html                    # the home page (slug "index" -> root; "home" is a legacy alias)
    ├── _meta.json                    # sidecar JSON (full reasoning trace) — one per migrated page
    ├── <slug>/
    │   ├── index.html                # one per non-home slug (URL-faithful nesting)
    │   └── _meta.json
    ├── docs/api/                     # multi-segment slugs nest naturally
    │   ├── index.html
    │   └── _meta.json
    ├── assets/                       # self-contained bundle (skills/migrate/reference/asset-bundling.md)
    │   ├── logo.<ext>                # copied from current/assets/
    │   ├── favicon.<ext>             # canonical favicon
    │   ├── favicon-512.png           # variants generated during prepare-migration phase 4
    │   ├── apple-touch-icon.png
    │   ├── fonts/                    # @font-face files downloaded during prepare-migration phase 4
    │   └── <subpath>                 # every asset referenced by a migrated page, subdir structure preserved from current/assets/
    ├── robots.txt                    # minimal
    └── sitemap.xml                   # derived from migrated inventory
```

The migrated tree is a **self-contained, zip-and-deploy** bundle.
Contract in `skills/stardust/reference/migrate-output-format.md`;
the `state.json.migrate` block (with `selfContained: true`) is the
forward-compat signal downstream consumers test for.

### `stardust/state.json`
Owner: every stardust sub-command. Schema in `state-machine.md`.

### `stardust/status.jsonl`
Owner: every stardust sub-command (append-only). One JSON line per
phase start/end/blocked event; contract in `reference/run-status.md`.
The deterministic progress surface any harness can tail. Carries no
provenance block — each line is self-describing (`ts` + `skill`), and
append-only replaces the overwrite protection provenance provides.

### `stardust/direction.md`
Owner: `$stardust direct`. The full reasoning trace for the resolved
direction, written using the format in
`skills/direct/reference/direction-format.md`. The agent appends a new
section every time direction changes. Under hands-off mode the master
skill also appends the activation line, named assumptions, and the
chosen volume caps here.

### `stardust/decisions.md`
Owner: any phase appends on discovery; the plan gate (`prepare-migration`
§ Final report, `replica` Phase 2, `rollout` Phase A) settles the batch.
Row format, default rows and owner-only rows in `reference/decisions.md`.

### `stardust/learnings.md`
Owner: `$stardust rollout` (report phase), plus any skill that hits a
failure class its SKILL.md didn't anticipate. Entry shape + lifecycle
in `reference/learnings.md`. Plugin maintainers harvest `pending`
entries into skill diffs and flip them to `folded`.

### `stardust/dynamic-features.md` (+ `-plan.md`, `dynamics/`)
Owner: `$stardust dynamics` Phase 3, run from `prepare-migration` (4.5),
`replica` (Phase 2) or `migrate`'s safety net — whichever comes first;
`rollout` B2 verifies rather than redoes. § Listings contract (per-type
`<meta>` fields; `helix-query.yaml` at the EDS project root is its
sibling), § Features (one row per finding: class · disposition ·
reproducibility · status · pattern · decision), § Decision batch,
§ Register (decided-out). The gate fails on a row without a
disposition. `dynamics/parity.json` is Phase 5's replayable parity
report; `qa` and `rollout` read it. Contract:
`skills/dynamics/reference/triage.md`, `parity-report.md`.

### `stardust/runtime-contract.json`
Owner: `$stardust deploy` (runtime-detection probe, before Step 1).
Records the target vanilla-EDS runtime's conventions (`runtime`,
`blockWrapperClass`, `buttonClasses`, `buttonization`,
`fragmentScriptPolicy`, `emptySectionCollapse`) so block CSS/JS
generation and the QA harness read a probed contract instead of
assuming one (boilerplate clones drift — e.g. `button-wrapper` vs
`button-container`).

### `stardust/redirects.tsv`
Owner: `$stardust rollout` (Phase C path-safety gate). One
`source<TAB>destination` pair per normalized path; wired into the EDS
redirects mechanism at Phase D so original inbound URLs don't 404.

### `stardust/current/PRODUCT.md` and `DESIGN.md`
Owner: `$stardust extract`. Authored by `$impeccable init` /
`$impeccable document` against the extracted site, but seeded by
stardust. These files describe what *is*, not what *should be*.

### `stardust/current/brand-review.html`
Owner: `$stardust extract` (Phase 5). Self-contained visual review of
the extraction — the **first eyeball-able artifact** the pipeline
emits. Renders the canonical brand-board section contract plus a
Tensions section that surfaces forced decisions for `direct`. Format
spec in `skills/extract/reference/brand-review-template.md`. Embedded
CSS only, no external JavaScript, rendered in the brand's own
captured colors and fonts.

The reviewer is expected to open this file and confirm the extraction
captured the site faithfully **before** running `$stardust direct`.
Misreads caught here are cheap to fix (re-run extract); misreads
caught after `direct` are not.

### `stardust/current/_brand-extraction.json`
Owner: `$stardust extract` (Phase 3). Consolidated brand surface —
palette, type, motifs, system components, voice, register. Schema in
`skills/extract/reference/brand-surface.md`.

### `stardust/current/_crawl-log.json`
Owner: `$stardust extract` (Phases 1, 2, 6). Append-only audit trail
of discovery and crawl. Re-running extract appends to `runs[]` rather
than overwriting. Schema in
`skills/extract/reference/ia-extraction.md` § `_crawl-log.json` shape.

### `stardust/current/pages/<slug>.json`
Owner: `$stardust extract`. Per-page parsed model. Schema lives in
`skills/extract/reference/current-state-schema.md` (Phase 1). The
crawler writes a `pages/<slug>.html` sidecar next to it — the settled
rendered DOM (`renderedHtml` field) for offline parsing by importers;
it is not a page record and never matches `pages/*.json`.

### `stardust/current/assets/`
Owner: `$stardust extract`. Logo + media extracted from the live site.
Filenames preserve the source basename plus a hash to avoid collisions.

### `stardust/prototypes/<slug>-shape.md`
Owner: `$stardust prototype` (Phase 1). Per-page compositional
brief. Carries page-level deployment decisions: section order,
layout strategy, key states, interaction model, structural data
attributes, unsourced-content list. Format spec in
`skills/prototype/reference/page-shape-brief.md`.

The brief exists because of the site/page split (see the
site-level vs page-level table below). `direct` authors the
design **system**; the brief records the **deployment** of that
system to a specific page. A direction change invalidates the
system; the brief is content-aware-stale only when the system
change makes its composition impossible.

### `stardust/prototypes/<slug>-proposed.html`
Owner: `$stardust prototype`. One file per page — the **proposed
redesign on its own**: self-contained, complete HTML page rendered
against the target `DESIGN.md`. The user opens it in the browser to
review; chat-driven impeccable commands iterate on it; `$stardust
migrate` later re-derives from it for the final migrated page. Full
contract in `skills/prototype/reference/proposed-file-shell.md`.

The file carries a provenance block in `<head>` listing the active
direction it was rendered against; when direction changes the page
is flagged `stale` in `state.json` and re-runs of `prototype` skip
it unless `--all` is passed.

### `stardust/uplift-improvements.md` and `stardust/uplift-questions.md`
Owner: `$stardust uplift`. Written in Phase 2 of uplift before any
variant renders. **`uplift-improvements.md`** is the load-bearing
list of >= 3 specific captured-site weaknesses (as many as the
evidence supports — cut, not padded) that variant A applies
exactly. **`uplift-questions.md`** is the 6–8 "what if…" candidate
catalog (per `skills/uplift/reference/what-if-candidates.md`) with
disqualifications recorded — the audit trail proving that B and C
picked their directional bets from the candidate catalog — or an
evidence-shaped `derived` candidate per its § Extension rule —
rather than improvising.

Both files are absent when uplift has not been run; the standard
`extract → direct → prototype` chain produces no equivalent
artifacts (their content lives implicitly in `direction.md` and
the per-page shape briefs).

### `stardust/prototypes/<slug>-cinematic.html`
Owner: `$stardust prototype --cinematic`. One file per page when
the cinematic feature was engaged. Written **alongside**
`<slug>-proposed.html`, never replacing it — the static prototype
remains the load-bearing artifact for accessibility audits,
migration consumption, and brand-faithful inheritance reviews.

The cinematic file declares an active motion register in its
provenance block (`_provenance.motion.register`) and ships the
Lenis runtime alongside (relative `<script src="lenis.min.js">`).
Full contract in:

- `skills/prototype/reference/motion-stack.md` — technology choice
- `skills/prototype/reference/motion-registers.md` — five
  brand-faithful motion personalities and the selection heuristic
- `skills/prototype/reference/motion-attributes.md` — `data-*`
  vocabulary the runtime consumes
- `skills/prototype/reference/motion-runtime.md` — canonical
  inline runtime script
- `skills/prototype/reference/motion-validation.md` § Pass 6 —
  cinematic-mode validation gates

Pages whose redesign brief does not engage motion never write this
file; the directory contains only `<slug>-proposed.html`. Detect
"is this a cinematic project" by the presence of
`stardust/prototypes/lenis.min.js`.

### `stardust/prototypes/lenis.min.js` and `lenis.min.css`
Owner: `$stardust prototype --cinematic`. Copied from
`skills/prototype/assets/motion/` on first cinematic render in a
project. Re-copied (sha-compared) on subsequent renders. The
cinematic prototype HTML loads these via relative paths so the
prototypes directory remains self-contained.

`migrate` re-copies them into `stardust/migrated/assets/motion/`
and rewrites the cinematic HTML's `<script>` and `<link>`
references to root-relative paths per the bundle-as-self-contained
contract.

### `stardust/migrated/`
Owner: `$stardust migrate`. A deployable static HTML site. The slug →
output-path mapping (`/` → `index.html`, `/pricing/` →
`pricing/index.html`, `/docs/api/` → `docs/api/index.html`) is detailed
in `skills/migrate/reference/migration-procedure.md` § Output path
mapping.

Each page is a self-contained HTML file with a stardust:migrate
provenance block as the first child of `<head>`, the `:root` block
exposing the current DESIGN.md tokens, structural data attributes on
every section, and asset references rewritten to root-relative
paths of the form `/assets/<subpath>` (per
`skills/migrate/reference/asset-bundling.md`). The full bundle —
HTML + every referenced asset — is self-contained: `cd
stardust/migrated && zip -r out.zip .` produces a deploy-ready
archive.

The migrated tree is **incremental and idempotent**. Re-running
migrate writes only pages whose source has changed (sha-compared in
provenance). Migration is per-page — the user can migrate part of
the site today and the rest later.

### `stardust/canon/`
Owner: `$stardust prototype --prep`. Written on first prototype
approval (typically the home; `--canon-from <slug>` overrides),
extended on subsequent approvals. Contains the design canon — the
load-bearing visual decisions extracted from approved prototypes
that govern every other template's rendering.

- **`header.html` / `footer.html`** — chrome HTML lifted verbatim
  from the canon-author prototype. Other templates inject these
  files into their proposed and migrated output.
- **`canon.css`** — compound CSS for the named visual language
  (`.btn-primary`, `.btn-secondary`, `.card`, `.link`, form
  inputs — the prototype's own class vocabulary, distinct from the
  EDS `.button.primary` delivery convention `deploy` applies).
  Consumes DESIGN.md tokens; injected into every migrated
  page's `<style>` block alongside `:root`.
- **`modules/<module-id>.html`** — canonical rendering per brand
  module. Each file's path + sha is referenced by
  `DESIGN.json.extensions.modules[].canonicalRendering`.

Pinned token values, compositional moves, and conflict-resolution
metadata live inside `DESIGN.json.extensions.canon` rather than as
standalone files. Canon-extraction procedure:
`skills/prototype/reference/canon-extraction.md`.

### `stardust/migrated/<slug-path>/_meta.json`
Owner: `$stardust migrate`. Sidecar JSON written alongside every
migrated `index.html` — one for the home at `migrated/_meta.json`,
one per nested slug at `migrated/<slug-path>/_meta.json`. Carries:

- Resolved metadata (system-fixed, brand-level, preserved, derived).
- Resolved JSON-LD (when page-type is known).
- Filled slot list and module-instance list.
- The `migrationDecisions[]` array — per-page reasoning trace
  (`template-applied` / `template-adapted` / `unique-render` /
  `module-bespoke-slot` / `canon-deviation` / `metadata-override`).
- Canon shas at the time of migration (so re-runs detect canon
  drift).

The HTML `<head>` provenance block stays compact; the sidecar
carries the full trace. Both are redundant on purpose — downstream
consumers can read either source.

---

## Versioning — what a clone holds

Policy (2026-09): **everything under `stardust/` is committed** except
what `skills/stardust/reference/stardust.gitignore` lists. The rule of
thumb is cost to reproduce, not regenerability: an LLM-written artifact
comes back different on a re-run, and a capture of the source site cannot
come back at all once the site is replaced. Size alone never drops a
file; screenshots and four rewritten-on-every-run folders are the
exceptions. The master skill installs the ignore file as
`stardust/.gitignore` (Setup step 6); a project that wants one of the
excluded folders tracked deletes that line or adds a negation below it.

| Path | Tracked | Owner | Notes |
|---|---|---|---|
| `state.json`, `status.jsonl`, `journal.md`, `learnings.md`, `direction.md`, `decisions.md` | yes | master / all | delivery state and decisions; a clone is dead without `state.json` |
| `live-budget.json` | yes | extract / any live tool | learned per-host live ceiling (`{ "<host>": { navPerMin, minGapMs, learnedAt, learnedBy, lastStatus } }`), merge-by-host, written on a bare 429; a clone inherits the origin's known limit |
| `dynamic-features.md`, `dynamic-features-plan.md`, `dynamics/parity.json`, `trees.json` | yes | dynamics | dispositions and parity checks |
| `dynamics/` other (`*.generated-plan.*`, `sheets/_sync.json`) | yes | dynamics | small text; drafts superseded by the curated file |
| `redirects.tsv`, `runtime-contract.json`, `eds-conversion-log.md`, `ai-readability-allowlist.json` | yes | rollout / deploy | |
| `canon/**` | yes | prototype | the design canon |
| `canon-source/**` except `assets/screenshots/` | yes | extract | donor capture |
| `current/` text: `PRODUCT.md`, `DESIGN.md`, `DESIGN.json`, `_brand-extraction.json`, `_crawl-log.json`, `_dynamics.json`, `brand-review.html`, `pages/*.json`, `pages/*.html` | yes | extract | `pages/*.json` feeds nine skills; the substrate of the pipeline |
| `current/assets/**` | **no** | extract | 50 MB screenshots rewritten on every extract + source media; `migrate`/`deploy` need it → re-run extract on a clone |
| `current/brand-sources/*/assets/screenshots/` | **no** | extract | screenshots |
| `prototypes/**` incl. `assets/` | yes | prototype / replica | approved design; `assets/` is source media, not screenshots |
| `validation/**` | **no** | master / prototype | clean-pass screenshots |
| `replica/inconsistency-register.md`, `progress.json`, `motion/`, `capture/` | yes | replica | register, ledger, runtime CSS/DOM captures (2 MB) |
| `replica/gates/**` | **no** | replica | per-iteration renders and diffs; verdicts live in `progress.json`; `live.png` re-taken on first run |
| `reskin/**` except `content-model/**/*.png`, `reports/*.png` | yes | reskin | tokens, model, renderers, pages, ledger |
| `migrated/**/*.html`, `_meta.json`, `robots.txt`, `sitemap.xml` | yes | migrate | the deliverable and its reasoning |
| `migrated/assets/**` | **no** | migrate | byte copy of `current/assets/media` + favicon variants |
| `audit/**` | yes | audit | score of the original site; irreplaceable after launch |
| `eds-schema/**` | yes | deploy | small JSON |
| `rollout/` except `qa/` | yes | rollout | `rollout.json`, `coverage/`, `optimize/`, `plan.json`, `site/`, `dashboard/` |
| `rollout/qa/**` | **no** | rollout | screenshots of the delivered site |
| `qa/allowlist.json`, `qa/report.*`, `qa/inventory.json`, `qa/dynamics-report.*`, `qa/ai-readability.json` | yes | qa | judgement and last report |
| `qa/shots/**`, `qa/baselines/**` | **no** | qa | screenshots; baselines are per machine, a clone re-creates them |
| `scripts/**` | yes (for now) | extract / reskin / replica | byte copies of plugin scripts so ESM resolves the project's `node_modules`; stale against the installed plugin — removing the copies is a planned change |
| `_pre-publish-backup/**`, `_palette-pick.html`, `*.generated.*` drafts | backup yes; picker no | prototype / direct / dynamics | |
| `.work/live-<host>.lock` | **never** | extract / any live tool | per-host live lock (pid liveness); one live tool per origin at a time — `state-machine.md` § Concurrency |
| `.work/**` | **no** | any | run residue: logs, harness page, pre-renders, probe dumps |
| `*.log`, `*.err`, `*.out`, `last-run.json` anywhere | **no** | any | safety net until every writer routes to `.work/logs/` |
| `_storage-state.json`, `*-clearance.json` | **never** | extract | admitted session (cookies / storage), written 0600; secrets |

Outside `stardust/`: the impeccable target files at the project root and
the EDS project are tracked by the project's own rules; `.env` / `.env.*`
and `.claude/settings.local.json` are excluded by the managed block Setup
step 6 appends. `stardust/` is
also appended to `.hlxignore` on EDS projects so nothing here is served.

Setup step 6 in detail (idempotent, writes only what is missing):
(a) `stardust/.gitignore` from `stardust.gitignore`, byte-identical, only
if absent — the project owns any line it adds afterwards; (b) root
`.gitignore`: a block between `# >>> stardust` and `# <<< stardust`
holding `.env`, `.env.*` and `.claude/settings.local.json` (the per-machine
permission allowlist, `reference/harness-permissions.md`), lines outside
the markers never touched;
(c) `.hlxignore`, when present: append `stardust/`; (d) assert
`git check-ignore -q stardust/state.json` fails — a bare `state.json`
pattern in `.git/info/exclude` or a global excludes file silently drops
the state machine from every clone (field finding); if it is ignored,
stop and tell the user which rule does it; (e) when `git lfs` is
installed and tracked binaries under `stardust/` exceed 50 MB, offer
`.gitattributes` patterns for
`stardust/**/*.{png,jpg,jpeg,webp,gif,woff,woff2,ttf,otf,mp4}` — never
write them unasked. Consequences to state in the state report when they
apply on this checkout: without `current/assets/`, `brand-review.html`
has no thumbnails and `migrate` / `deploy` need an `extract` re-run.

Who reads `stardust/current/` (the dependency that decides what a clone
can do): `pages/*.json` — migrate, prototype, replica, master, direct,
uplift, audit, prepare-migration, stardust; `_brand-extraction.json` —
direct, prototype, uplift, audit, master; `PRODUCT.md` / `DESIGN*.*` —
replica, prototype, direct, uplift, master; `assets/media`, favicon, logo
— migrate, deploy, prepare-migration, direct; `assets/screenshots` —
prototype, replica, audit, reskin; `brand-review.html` — direct, uplift,
audit, rollout, master; `pages/*.html` (DOM sidecars) — no skill. Only
`qa` and `diff` never read `current/`.

## Provenance shapes

Stardust uses three provenance shapes depending on the file type, the
same convention as v1 and as impeccable's loader expects.

### HTML files
First child of `<head>`:

```html
<!-- stardust:provenance
  writtenBy:        stardust:prototype
  writtenAt:        2026-04-25T15:42:00Z
  againstDirection: stardust/direction.md#section-2
  readArtifacts:
    - stardust/current/pages/index.json
    - DESIGN.md
    - DESIGN.json
  synthesizedInputs: []
  stardustVersion:  0.10.0
-->
```

### Markdown files
First line, before any frontmatter:

```markdown
<!-- stardust:provenance
  writtenBy: stardust:direct
  writtenAt: 2026-04-25T14:10:00Z
  ...
-->
---
```

### JSON files
First top-level key (`_provenance`):

```json
{
  "_provenance": {
    "writtenBy": "stardust:extract",
    "writtenAt": "2026-04-25T13:00:00Z",
    "readArtifacts": ["https://example.com/"],
    "synthesizedInputs": [],
    "stardustVersion": "0.10.0"
  },
  "...": "..."
}
```

---

## Site-level vs page-level

Stardust separates **system** (site-wide design decisions) from
**deployment** (how the system applies to a specific page). The
boundary lives between `direct`'s outputs and `prototype`'s
outputs, not within either:

| concern | lives in (site-level) | lives in (page-level) |
|---|---|---|
| Token vocabulary (colors, typography, spacing, radii) | `DESIGN.md` frontmatter | — |
| Voice rules, hard rules, anti-references, tone exemplars | `DESIGN.md` § 6 + `DESIGN.json` `narrative.rules/dos/donts` | — |
| Anti-toolbox audit, divergence trace | `DESIGN.json` `extensions.divergence` | — |
| Abstract component vocabulary (button-primary, card, input — default treatment, no per-page values) | `DESIGN.json` `extensions.componentStyle` + top-level `components[]` | — |
| Named system-component **roles** (header / footer / cta-band / etc. — purpose + position class) | `DESIGN.json` `extensions.systemComponentRoles` | — |
| Per-page section list and order | — | `<slug>-shape.md` § Sections |
| Per-page layout strategy (column ratios, alternation, breakpoint inversions) | — | `<slug>-shape.md` § Layout strategy |
| Literal copy per section | — | sourced from `current/pages/<slug>.json` into `<slug>-shape.md` |
| Section-level pixel dimensions, dock points, viewport-specific widths | — | `<slug>-shape.md` § Layout strategy |
| Stat numbers, addresses, phones, quotes, named persons | — | `<slug>-shape.md` § Sections OR `<slug>-shape.md` § Unsourced content (placeholder) |
| System-component **deployment** (literal tile labels, link targets, copy variants) | — | `<slug>-shape.md` § Sections |
| Per-page interaction model (CSS-only details/target panels, etc.) | — | `<slug>-shape.md` § Interaction model |
| Per-page key states (default/empty/loading/error) | — | `<slug>-shape.md` § Key states |

**Rule of thumb:** if removing a value from the file would make
the file nonsensical for *every other page on the site*, it's
site-level (DESIGN.md). If removing it would only affect *this
page*, it's page-level (`<slug>-shape.md`).

The split solves three problems with a prior mash-up where both
lived in DESIGN.md:

1. **DESIGN.md grew per-page** — each prototyped page leaked its
   specifics into the site spec. Now DESIGN.md size is bounded
   by the system, not the page count.
2. **Direct over-specified the visual layer at site-time** —
   leaving prototype no room to diverge per-page. Now prototype
   owns deployment; direct owns vocabulary.
3. **Re-direct ambiguity** — was the user changing the system
   (tokens, voice) or the deployment (composition on this page)?
   Now direct's edits target the system; prototype's edits target
   a single brief; stale-flagging is content-aware per
   `state-machine.md` § Stale flagging.

When in doubt about where a new piece of information should land,
ask: does this affect *every* page in the inventory, or just one?
The answer locates the file.

## Read-vs-write discipline

- **Read order** for any sub-command: `state.json` first, then
  `direction.md`, then the impeccable target files at the project root,
  then anything from `stardust/current/` it specifically needs.
- **Write order** for any sub-command: write all artifacts first, then
  update `state.json` last. If a write fails, the `state.json` update
  is skipped so the next run sees a consistent prior state.
- **Provenance is mandatory.** Any artifact without a provenance block
  is treated as user-edited and stardust will not silently overwrite it.
  When stardust detects a provenance-less artifact in a path it owns,
  it asks the user before proceeding.
