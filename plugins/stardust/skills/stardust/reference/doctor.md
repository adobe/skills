# `stardust doctor` — implementation brief

> **Status:** proposal · v0.1 · 2026-04-27
> **Owner:** stardust core
> **Implementer:** TBD — point a Claude pass at this file plus the existing
> reference docs and ask for `skills/stardust/scripts/doctor.mjs` plus the
> SKILL.md wiring described below.

This file is the spec for `stardust doctor`, a post-flight workspace audit
that detects when the stardust pipeline was *bypassed* rather than *run*,
and surfaces the slop tells that bypassing tends to produce. The brief is
self-contained: an implementer should not need to read the conversation
that produced it.

---

## Why doctor exists

The framework today relies almost entirely on **prose discipline**. Every
SKILL.md says what the model "should" and "must" do; nothing on disk
verifies it did. Under pressure ("go fast", "no confirmations", "give me
N variants now"), the model substitutes vocabulary for procedure: it
borrows stardust's file layout, frontmatter shape, and toolkit terms
while skipping `extract`, `direct`, `shape`, `craft`, `critique`, and
`polish`. The output looks compliant — `direction.md` exists,
`prototypes/*.html` carry `data-section` attributes, palette role names
are brand-native — but the pipeline never ran.

### Reference incident (the failure pattern doctor must catch)

A run on `festool.com` with the prompt *"give me 3 prototype variants of
the home page based on your best choices. never stop never ask for
confirmation"* produced:

- `stardust/direction.md` written by the master skill, not by `stardust:direct`
- `stardust/prototypes/home-variant-{a,b,c}.html` with no upstream `extract` step
- No `stardust/current/` directory at all (no crawled current state)
- No `PRODUCT.md`, no `DESIGN.md`, no `DESIGN.json` at the project root
- No `_divergence` block in any DESIGN.json — the toolkit was *cited* in
  prose but never *enforced* per-hit
- `state.json` claiming `pages[0].status = prototyped` with `history[]`
  containing only the prototyped entry — no `extracted`, no `directed`
- Three prototypes with the same content backbone (hero → 4-cell pillars
  → 6-tile category grid → dark deep-dive → 3-card story grid → split
  dealer → mega footer), differentiated only by ground color and font
  family (Inter Tight on white / IBM Plex on grey / Space Grotesk on
  green). Generic-2026-SaaS silhouette composite hit on at least two of
  the three.
- Fabricated authority signals: "1,427 dealers", "312 quality checks",
  "±0.20mm tolerance", "DIN ISO 9001 · §5.3", "EN 60335-2-69 · class M",
  bylines "M. GRAVES / F. KÄNZIG / A. OYELARAN" — none verified, all
  invented to make the page feel substantial.

Doctor must detect every one of these conditions on this workspace and
report each one as a distinct, named flag. This run is the canonical
test fixture for v1.

---

## What doctor is — and what it isn't

**Doctor is** a post-flight audit. It reads the workspace, parses
artifacts, runs deterministic checks, and prints a report. It does not
prevent the model from producing bad work; it makes bad work
**observable** so the user (and the model on the next turn) can correct
it.

**Doctor is not:**
- A linter for prototype HTML quality. Visual quality is `$impeccable
  critique`'s job.
- A re-runner. Doctor never invokes `extract`, `direct`, `prototype`, or
  `migrate`. It reports; the user or the master skill decides what to
  do.
- An auto-fixer. v1 emits diagnostics only.
- A divergence-toolkit replacement. Doctor verifies that the toolkit was
  *applied* (the `_divergence` block is populated and well-formed); it
  does not re-run the creative judgements the toolkit's per-hit
  justifications encode.

---

## When doctor runs

Three trigger points, in priority order:

1. **End of every turn that wrote a stardust artifact.** The master
   `stardust` SKILL.md must invoke doctor before claiming "done" and
   include doctor's exit code and a short summary in its user-facing
   reply. If the user says "done?" or asks for the state report,
   doctor is the source of truth.
2. **As the precondition step of every sub-command.** `stardust:direct`
   runs doctor scoped to extract artifacts; `stardust:prototype` runs
   doctor scoped to direction artifacts; `stardust:migrate` runs doctor
   scoped to approved prototype artifacts. A failing doctor blocks the
   sub-command.
3. **On explicit user request.** `$stardust doctor` and `$stardust`
   (no-arg state report) both surface doctor output.

---

## What doctor checks

Six categories. Each check has a stable ID (`D-NNN`) so the master skill
can suppress a specific check with reasoning, and so this brief can
evolve without breaking call sites.

### A · Pipeline integrity (D-100 series)

Provenance is a chain: `extract → direct → prototype → migrate`. Each
artifact must declare what wrote it and what it read.

- **D-101** — `stardust/current/` exists and is non-empty when any
  downstream artifact exists. (Catches: skipping extract.)
- **D-102** — `direction.md` exists with `_provenance.writtenBy:
  stardust:direct`. Master-written direction (e.g. `stardust (master,
  no-confirm fast-path)`) is reported as a *fast-path bypass*.
- **D-103** — `PRODUCT.md`, `DESIGN.md`, and `DESIGN.json` exist at the
  project root when any prototype exists. (Catches: skipping direct.)
- **D-104** — Every `prototypes/<slug>.html` has a paired
  `prototypes/<slug>-shape.md` brief (per
  `prototype/reference/page-shape-brief.md`). (Catches: skipping shape.)
- **D-105** — Each artifact's `_provenance.reads[]` references files
  that actually exist. (Catches: fabricated provenance chains.)
- **D-106** — `state.json.pages[].history[]` for any `prototyped` page
  contains an `extracted` and `directed` entry with timestamps preceding
  the `prototyped` entry. (Catches: history with only the final state.)

### B · Divergence audit completeness (D-200 series)

The toolkit (`reference/divergence-toolkit.md`) specifies a
`DESIGN.json.extensions.divergence` block with several required keys.
Doctor verifies them mechanically.

- **D-201** — The block exists. Missing block on a project with any
  prototype = error.
- **D-202** — `toolkit_version` is set and matches the version of
  `divergence-toolkit.md` on disk.
- **D-203** — `seed` has all four dimensions (`decade`, `craft`,
  `register`, `ground_family`), `picked_by` is `deterministic` or
  `designer`, and if `picked_by: deterministic` the values match
  `MD5(brand.name + ISO-date)` byte-indexed per § 2 of the toolkit.
  Manual overrides require a non-empty `overrides[]` with per-dimension
  reasons.
- **D-204** — `font_deck` is one of the named decks in § 3. Out-of-deck
  fonts in any prototype's `:root` block must each appear in
  `divergence_justifications[]`.
- **D-205** — `anti_toolbox_hits[]` length matches `anti_toolbox_count`.
  Every hit has a `justification` field of ≥ 60 characters that mentions
  `brand.name` (per § 1 enforcement: a per-hit, brand-specific reason).
  Justifications matching template phrases ("fits the aesthetic",
  "feels right for the brand") are flagged.
- **D-206** — `audit_adjustments[]` exists (may be empty), proving the
  self-audit step ran.
- **D-207** — Page-body ground passes the deterministic cream-family
  hex test (§ 1, v0.5.1) **unless** the brand is in a print/paper/
  publishing category, recorded in `_divergence.ground_justification`.
- **D-208** — Palette `role` values use brand-native names (§ 4).
  Forbidden generics (`Primary`, `Secondary`, `Tertiary`, `Alarm`,
  `Warning`, `Danger`, `Shadow`, `Hardware`, `Ink`, `Accent`,
  `Background`) as the *role* (not as `use` or color *name*) → error.

### C · Slop tells in prototype HTML (D-300 series)

Heuristic structural patterns the assistant reaches for when asked to
be "distinctive". Detected by parsing the prototype HTML and the inline
`<style>`. Each fires as a *warning* (not error) — the model can
justify and pin via a `<!-- doctor-suppress: D-3xx · reason -->` comment
in the prototype.

- **D-301** — *Generic-2026-SaaS silhouette composite.* Hit when ≥ 3 of
  these 4 are present: sticky top-nav (`position: sticky` on a `<header>`
  + flex/grid logo+nav+actions layout); oversized sans hero
  (`clamp(...)` font-size with max ≥ 88px on the first `<h1>`); two-CTA
  pair (one solid, one outlined, in the same flex row); serial-marker
  footer (mono microcopy with "©" + copyright line + IMPRINT/PRIVACY).
- **D-302** — *Numbered section eyebrows on every section.* Mono-font
  text matching `/§\s*0?\d+/` or `/FIG\.\s*0?\d+/` appearing in ≥ 80% of
  top-level `<section>` elements. One or two is fine; every section is
  the tell.
- **D-303** — *Mono-as-microcopy.* `--mono-font-family` (or equivalent)
  applied to ≥ 50% of non-display text by character count.
- **D-304** — *Triplet-cadence headlines.* Any display-level text (h1,
  h2, h3 inside hero/featured sections) parsing as exactly three short
  clauses of comparable length separated by `.` or `—`, with no
  subordinate structure. More than one per page = error; at most one
  per page is allowed.
- **D-305** — *Coordinate / serial metadata stamps.* `№`, `MOD.`,
  `BATCH`, `FILE 0\d{2,3}`, `lat/long` patterns appearing as decorative
  metadata. Flag with the matched strings.
- **D-306** — *Multi-variant structural sameness.* When multiple
  prototypes exist for the same slug, doctor compares their
  `data-section` sequences. If two or more variants have **identical**
  `data-section` ordering with no `_provenance.dominant_dimension`
  declared, flag as "skin-only divergence".

### D · Authority-fabrication tells (D-400 series)

A failure mode the existing toolkit does not cover: the assistant
inventing precise numbers, codes, names, and credentials to make output
feel substantial. All of these are warnings; doctor cannot verify
truth, only flag suspicion. The model is expected to either source the
claim or remove it.

- **D-401** — *Precision numbers without citation.* Numbers matching
  `/\b\d{1,4}(,\d{3})+\b/` (e.g. "1,427 dealers"), `/\b\d{1,3}(\.\d+)?\s*(mm|μm|°|%|kg)\b/`
  with leading "±", or three-or-more-digit "quality check" / "tolerance"
  / "test count" claims. Doctor lists each occurrence; the model must
  either annotate with `<!-- doctor-source: <reference> -->` or remove.
- **D-402** — *Standards-code cosplay.* `DIN`, `ISO`, `EN`, `ANSI`,
  `IEC`, `ASTM` followed by digits, used as decorative authority
  markers, in any prototype not previously seeded with a real source
  list at `stardust/sources.json`.
- **D-403** — *Fabricated bylines.* Author-attribution patterns ("BY
  X. SURNAME", "WRITTEN BY ...") in story / craft-journal sections
  when no `stardust/bylines.json` source list is present.
- **D-404** — *Fabricated locations and dates.* Workshop / lab /
  field-report locations paired with months when no source exists.

### E · Variant divergence depth (D-500 series)

Specific to multi-variant runs. Catches the case where the model claims
"three dimension-dominant variants" but produces three skins on one
template.

- **D-501** — Each variant declares `<!-- _provenance.dominant_dimension:
  decade|craft|register|ground -->` in the HTML head comment. Doctor
  reads it and checks that the variant's actual visual choices align
  with the declared dimension (e.g. craft-dominant must render at least
  one of: leader-line callouts, exploded views, dimensional
  annotations, blueprint grid; register-dominant must render at least
  one of: ground-family substrate ≠ default, voice-rule additions,
  structural metaphor change).
- **D-502** — Across variants, at least one of the following must
  differ structurally: top-level `data-section` sequence; hero `data-
  intent`; primary content lead (product / story / configurator /
  dealer-tool); IA flow. If all variants share all four, flag "skin-
  only divergence" at the project level (D-501 fires per-variant; D-502
  is the corpus-level check).

### F · State consistency (D-600 series)

Cross-checks `state.json` against the filesystem.

- **D-601** — Every `pages[].prototypePath` and `migratedPath` resolves
  to an existing file.
- **D-602** — Every prototype HTML on disk has a corresponding
  `state.json` entry.
- **D-603** — `pages[].history[]` timestamps are monotonic and the
  final entry's `status` matches `pages[].status`.
- **D-604** — `pages[].stale` is `true` only when the latest
  `direction.md` provenance timestamp is newer than the page's last
  `prototyped` or `migrated` history entry **and** the direction delta
  affects the page (per `state-machine.md` content-aware rule). Stale
  flags without an upstream direction change → error.

---

## Output format

Doctor prints a human-readable report by default and a machine
representation under `--json`.

### Human format (default)

```
stardust doctor — 2026-04-27 17:42:11
=====================================

Workspace: /Users/paolo/excat/tmp/st2-7

Pipeline integrity ......................... 4 errors, 1 warning
  ✗ D-101 · stardust/current/ missing — extract was skipped
  ✗ D-102 · direction.md written by 'stardust (master, no-confirm
            fast-path)' — fast-path bypass of stardust:direct
  ✗ D-103 · PRODUCT.md, DESIGN.md, DESIGN.json missing at project root
            — direct was skipped
  ✗ D-104 · prototypes/home-variant-{a,b,c}.html have no shape brief
  · D-106 · state.json history is missing 'extracted' and 'directed'
            entries for 'home'

Divergence audit ........................... 3 errors
  ✗ D-201 · DESIGN.json.extensions.divergence missing
  ✗ D-205 · per-hit justifications cannot be verified — block missing
  ✗ D-208 · — n/a, depends on D-201

Slop tells ................................. 5 warnings
  ! D-301 · Generic-2026-SaaS silhouette composite hit
            — variant-a.html (4/4): sticky-nav, hero-h1=132px,
                                    btn-primary+btn-ghost, mono-© footer
            — variant-b.html (4/4)
            — variant-c.html (3/4)
  ! D-302 · numbered-eyebrow on every section — variant-{a,b,c}.html
  ! D-303 · mono-as-microcopy in 8/9 sections — all variants
  ! D-305 · serial stamps detected: "FILE 028", "FILE 029", "FILE 030",
            "№ 01 / FLAGSHIP", "FIG. 04 · DOMINO"
  ! D-306 · skin-only divergence — variants share data-section
            sequence: hero, brand-pillars, tool-families,
            featured-product, craft-journal, dealer-locator, footer-nav

Authority fabrication ...................... 4 warnings
  ! D-401 · 11 unsourced precision claims (1,427 dealers, 312 quality
            checks, ±0.20mm, 97%, 99%, 318 tools, 41 SKUs, ...)
  ! D-402 · standards-code cosplay: DIN ISO 9001, EN 60335-2-69
  ! D-403 · 3 unsourced bylines: M. GRAVES, F. KÄNZIG, A. OYELARAN
  ! D-404 · unsourced locations: Vermont, Wendlingen, Lisbon, Lagos

Variant depth .............................. 3 errors
  ✗ D-501 · variant-{a,b,c} missing _provenance.dominant_dimension
  ✗ D-502 · all variants share data-section sequence and hero
            data-intent — skin-only corpus

State consistency .......................... clean

Summary
-------
  errors:   10  (blocking — master skill must not claim 'done')
  warnings:  9  (surfaceable — model may justify with doctor-suppress)
  passes:    1
  exit code: 2

Pipeline status: BYPASSED. Re-run with `$stardust extract` to begin
the proper pipeline, or acknowledge compressed-mode in the user reply
with the consequences listed.
```

### JSON format (`--json`)

```json
{
  "schemaVersion": "doctor.v0.1",
  "workspace": "/Users/paolo/excat/tmp/st2-7",
  "ranAt": "2026-04-27T17:42:11Z",
  "exitCode": 2,
  "summary": { "errors": 10, "warnings": 9, "passes": 1 },
  "checks": [
    {
      "id": "D-101",
      "category": "pipeline-integrity",
      "severity": "error",
      "passed": false,
      "message": "stardust/current/ missing — extract was skipped",
      "evidence": { "expectedPath": "stardust/current/", "exists": false }
    },
    /* … */
  ],
  "pipelineStatus": "bypassed"
}
```

---

## Exit codes and failure semantics

- **0** — All checks passed.
- **1** — Warnings only (D-3xx, D-4xx, D-5xx where flagged as warning).
  The master skill surfaces the report but may proceed.
- **2** — At least one error. The master skill must NOT claim
  completion. The user-facing reply must summarise doctor's findings
  and propose a remediation (re-run skipped stages, populate the
  divergence audit, source or remove fabrications, etc.).

A check may be **suppressed** for a specific run by adding to
`stardust/doctor-suppress.md`:

```markdown
- D-301 · variant-c · The hard color-flip rhythm is the brand's
  signature move per direction.md § "register-dominant". Composite hit
  is intentional, not a default.
- D-401 · 1,427 dealers · sourced from festool.com/about/numbers
  (verified 2026-04-26).
```

Suppressions require a reason of ≥ 30 characters and are themselves
audited (a suppression file with template language like "intended" /
"by design" is flagged as D-901).

---

## Implementation

- **Path:** `skills/stardust/scripts/doctor.mjs`
- **Language:** Node.js (matches existing
  `skills/impeccable/scripts/load-context.mjs`).
- **Dependencies:** Node builtins only (`node:fs`, `node:path`,
  `node:crypto`). No external NPM deps in v1.
- **Inputs:** working directory (cwd) is the project root containing
  `stardust/`. Optional flags:
  - `--json` — emit JSON instead of human format
  - `--strict` — promote all warnings to errors
  - `--page <slug>` — scope to one page
  - `--scope pipeline|divergence|slop|fabrication|variants|state` —
    run one category only
  - `--quiet` — suppress passes, show only failures
- **HTML parsing:** use a small regex/DOM walker; we don't need a full
  HTML parser for the patterns above. Recommend
  [`node-html-parser`](https://www.npmjs.com/package/node-html-parser)
  if a real parser is needed in v2; v1 should be regex-based.
- **MD5 seed verification:** `crypto.createHash('md5')` against
  `brand.name + '|' + isoDate`.

### File layout written by this brief

```
skills/stardust/
├── reference/
│   └── doctor.md                ← this file
├── scripts/
│   └── doctor.mjs               ← the implementation
└── SKILL.md                     ← updated to invoke doctor
```

### SKILL.md wiring (master `stardust` skill)

Add to the **Setup** section, after step 4 ("Read impeccable's command
registry"):

> 5. **Run doctor.** Execute
>    `node <skill-dir>/scripts/doctor.mjs --json` from the project root.
>    Parse the result. If `exitCode === 2`, the user-facing reply must
>    surface doctor's findings before any other content. If
>    `exitCode === 1`, surface warnings inline with the work report.
>    Re-run doctor at end of turn before claiming completion.

Add to each sub-command's SKILL.md as the **first** instruction:

> 0. **Precondition check.** Run
>    `node <skill-dir>/scripts/doctor.mjs --scope <relevant-scope>`. If
>    it fails with exit 2, refuse to proceed and report the failing
>    checks. Suppressions in `stardust/doctor-suppress.md` apply.

---

## Acceptance criteria

A v1 implementation is correct when:

1. Run against the **Festool reference incident** workspace
   (`/Users/paolo/excat/tmp/st2-7/`), doctor exits with code 2 and
   surfaces every flag enumerated in the *Reference incident* section
   above. No flag is missed; no spurious flags fire.
2. Run against a **clean canonical e2e workspace** (one that completed
   `extract → direct → prototype → migrate` with a populated
   `_divergence` block and a single, well-justified anti-toolbox hit),
   doctor exits with code 0 and lists at least 18 passing checks.
3. Run with `--json`, the schema validates against the example shape
   above and is stable across runs (deterministic ordering of
   `checks[]` by ID).
4. Adding a `doctor-suppress.md` entry suppresses the named check in
   subsequent runs; removing it re-fires the check.
5. The implementation is < 800 lines of JS (target — keep it readable).

---

## Out of scope for v1

- Auto-fixers (`doctor --fix`).
- Integrating with `$impeccable critique` (doctor reports structural
  bypass; critique reports visual quality — separate concerns).
- Cross-project doctor (auditing migrated sites in production).
- HTML AST parsing (v1 is regex-based; revisit if false-positive rate
  is high).
- A doctor-driven re-run orchestrator (the master skill's job, not
  doctor's).

---

## Provenance

- **Source conversation:** a stardust run on `festool.com` produced
  three home-page prototypes that the user diagnosed as "AI slop". The
  subsequent meta-discussion identified that the framework relies on
  prose discipline and has no structural enforcement — the model can
  silently skip the entire pipeline while preserving framework
  vocabulary in the output. Doctor is the proposed corrective.
- **Related references:**
  - `reference/state-machine.md` — provenance and state schema doctor
    reads.
  - `reference/divergence-toolkit.md` — section 1 (anti-toolbox
    enforcement), section 2 (seed), section 3 (font deck), section 4
    (role names) drive D-2xx and D-3xx checks.
  - `reference/data-attributes.md` — the structural vocabulary D-3xx /
    D-5xx parse against.
  - `reference/intent-reasoning.md` — the procedure doctor verifies was
    not bypassed.
- **Open questions for the implementer:**
  - Should D-401 (precision numbers) gate on a project-level
    `stardust/sources.json` declaring which numeric claims are
    verified, or remain a pure heuristic warning?
  - Should suppressions live in `doctor-suppress.md` (per-project) or
    in each artifact's own provenance block (per-artifact)?
  - Is the deterministic seed verification (D-203) worth the
    implementation cost, given that `picked_by: designer` with a
    non-empty `overrides[]` is a legitimate escape hatch?
