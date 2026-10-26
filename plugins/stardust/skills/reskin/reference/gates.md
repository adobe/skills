# The reskin gates — commands, pass bars, tolerances, failure modes

Three gate families per page, plus (d) for a Figma donor and (e) for a
deployed page, run in Phase 5 after the programmatic render. All scripts
are run as project-local copies
(`stardust/scripts/reskin/`, § Project copies) — never from the
plugin tree (ESM playwright resolution). `--rendered` accepts a URL or
a file path (auto-converted to `file://`).

Run order: content gate first (a design-adopted page with dropped
content is worthless), then design adoption, then sanity, then (d),
then (e) once the page is deployed. One fix iteration per gate family
(§ below); (e) has its own budget (`deployed-leg.md` § The fix budget).

## Project copies

SKILL.md Setup step 3. ESM resolves `import('playwright')` from the *script's* directory and the plugin tree ships no
`node_modules`: run byte-identical copies under `stardust/scripts/`, with `../diff/`, `../replica/` and `../deploy/`
siblings of `../reskin/`.

- `skills/reskin/scripts/` → `reskin/`, recursively except `test/` (`deployed/`, `figma/`, `figma-gate/` and `render/`
  travel with it).
- `skills/stardust/scripts/state.mjs` → `stardust/` (`figma-donor.mjs stamp` writes through it).
- `skills/diff/scripts/` → `diff/`, all of it.
- `skills/replica/scripts/` → `replica/`: `pixel-compare.mjs`, `run-capped.mjs`, `run-bg.mjs`, `stitch-shot.mjs`,
  `crop-compare.mjs`, `chrome-parity.mjs`, `cap-probe.mjs` (`pixel-compare` and `run-bg` import `run-capped`;
  `stitch-shot`, `chrome-parity` and `cap-probe` need `diff/live-session.mjs`).
- `skills/deploy/scripts/` → `deploy/`: `eds-path.mjs`, `qa-gate.mjs` (finds `replica/cap-probe.mjs`),
  `ai-readability.mjs`: what `deployed-gate.mjs` resolves.
- `skills/prototype/fixtures/mobile-nav-audit.mjs` → `prototype/`: `reskin-ledger.mjs record` runs it as the runtime
  mobile-adapt check; without it that check is `NOT-RUN`, which blocks the archetype until a residual is accepted.
  (`canon-from-reskin.mjs`'s visual record uses `replica/stitch-shot.mjs` and `pixel-compare.mjs`, listed above.)

Every gate script (`capture-content`, `dom-equality`, `donor-probe`, `slot-coverage`) needs `diff/live-session.mjs`
and exits 2 without it, even for a local file; only `capture-content` also fails `--help`.

## (a) Content gate

Two scripts, both must exit 0.

### dom-equality.mjs — byte equality

```bash
node stardust/scripts/reskin/dom-equality.mjs \
  --source <page-url> \
  --source-scope '<the scope string from content-model _provenance, verbatim>' \
  --normalize stardust/reskin/normalize/<slug>.mjs \
  --rendered stardust/reskin/pages/<slug>.html \
  --rendered-scope main \
  --report stardust/reskin/reports/<slug>-content-gate.md
```

Vendored + adapted from github.com/aemcoder/skills (Apache-2.0);
adaptations listed in the script header.

**Gating:** (1) visible text, whitespace-normalized, **byte-identical**
across the concatenated source scopes vs the rendered `main`;
(2) visible image src list, **order-sensitive**, URL-normalized to
host+path (query strings carry cache-busters; hidden images excluded
on both sides). "Visible" for images is the **single shared
predicate** exported by `source-normalize.mjs` (`IMG_VISIBLE`) and
executed identically by `capture-content.mjs` and this gate: hidden
by style → out; rendered above 1×1px → in (tracking pixels are not
content); `loading="lazy"` and still zero-size → in. One definition,
two callers — capture and gate cannot drift on image counts.
(3) **disclosure rest state**: the collapsed and open disclosures in
scope (`aria-expanded`, `<details>`, `hidden="until-found"`, the shared
`DISCLOSURE_STATE` in `source-normalize.mjs`) are counted on both sides
**before** the ledger runs. A source that starts any collapsed against a
render that starts none collapsed FAILS: a ledger entry that expands
accordions is capture-only and never makes the delivered block start
open. The rendered side then runs `REVEAL_DISCLOSURES` (opens `<details>`,
unhides `hidden="until-found"`) before its text is read, so a correctly
collapsed panel is still measured; a panel hidden any other way
(`display:none` on a class) stays unread and fails (1). `slot-coverage`
and `figma-text-gate` run the same reveal. A page whose redesign starts
every disclosure open says so in its deltas file:
`"disclosures": { "restState": "open", "why": "…" }`.
**Informational only:** element count and tag+class
sequence — a reskin re-structures markup by design; a tag-sequence
divergence at position 0 is expected and healthy.

Two invariants or the run measures nothing: `--source-scope` is
byte-identical to the capture's `_provenance.scope`, and
`--normalize` is the same ledger file the capture used — including
the default case: when the capture ran **without** `--normalize`
(the shared default ledger), the gate flag is **omitted too**, never
pointed at a page ledger the capture didn't use.

`--source` accepts a URL or a file path (auto-converted to `file://`,
same as `--rendered`) — useful for gating against a saved source
snapshot.

**The gate re-crawls the LIVE source at gate time — so its live
navigation is hardened exactly like the capture's**, via the shared
`live-session.mjs` (real-Chrome UA + the standard request headers —
the UA alone still 403s on Akamai-class bot managers —
`domcontentloaded` on live targets, challenge detection). This is the
byte gate's own correctness: a gate that silently measured a
challenge interstitial or a degraded UA-served document as the
source would pass/fail the render against the wrong reference. A bot
challenge exits **3** (distinct from 1=FAIL, 2=setup), never
measured; a non-challenge HTTP ≥ 400 exits 2. Escalate bot-managed
sites with `--headed`; pin geo-redirecting sources with `--locale`.
The reskin scripts resolve `live-session.mjs` from the diff scripts
copied alongside (`stardust/scripts/diff/`, SKILL.md § Setup).
Local/file targets keep the legacy `networkidle` path — file-path
sources and rendered pages behave as before.

### slot-coverage.mjs — per-slot presence + metadata

```bash
node stardust/scripts/reskin/slot-coverage.mjs \
  --model stardust/reskin/content-model/<slug>/content-model.json \
  --rendered stardust/reskin/pages/<slug>.html \
  --report stardust/reskin/reports/<slug>-slot-coverage.md
```

Why both: dom-equality proves the concatenated text is byte-equal;
slot-coverage proves the structure survived slot by slot and
localizes any failure to a named slot. It asserts, from the model:

- every slot's `visibleText` substring-present in the rendered scope;
- every CTA present as a (text, **absolute** href) pair;
- every image present (host+path normalized);
- every present image **painted** (§ Image paint below);
- metadata carried **verbatim**: title, description, canonical, each
  OG tag, each Twitter tag; JSON-LD block count. Verbatim includes
  source garbage — fidelity over repair; flag, don't fix
  (`reference/mapping-brief.md` § Flag, don't fix).

Live `--rendered` targets (a staged deploy on a real host) get the same
`live-session.mjs` hardening and exits as dom-equality (`--ua` /
`--wait-until` / `--headed` / `--locale`); local and file targets keep
the legacy `networkidle` path.

**Pass bar (content gate):** dom-equality exit 0 AND slot-coverage
exit 0. No partial credit — one dropped CTA is a fail. Exit codes:
0 pass, 1 fail, 2 setup error, 3 bot challenge / blocked live target.

#### Image paint — a PASSing image check is not a rendering image

Both image checks compare **URL strings** (host+path), and a string can
match while the pixel never arrives: an image CDN that answered HTTP 403
to any non-origin request left all 19 of a reskin's hotlinked images as
broken-image icons while every string check passed. The gate was
provably right and the page was provably broken.

Defenses, in order:

- `slot-coverage.mjs` asserts **paint** per present content image —
  after a lazy-load scroll pass, the matching rendered `img` must
  have `naturalWidth > 0`. A zero-painted image is a named **FAIL**
  line (`--paint warn` downgrades to a warning; do that only with a
  recorded reason in the ledger).
- Paint is necessary but not sufficient: an image with
  `naturalWidth > 0` can still RENDER 0×0 (circular flex sizing —
  the item's width derives from the image while the image's
  `max-width: 100%` derives from the item — collapses both to
  zero). When eyeballing, confirm each content image occupies real
  area; a rendered-size assertion (`clientWidth > 0` on visible
  content images) closes the gap the string and paint checks share.
- The **eyeball step must check paint explicitly**: look at the images
  themselves in the page or `--shot` capture, not just the layout; a
  broken-image icon is easy to gloss over.
- When the source CDN is origin-locked, **Phase 6 asset
  localization is NOT optional** — it is the only fix. Hotlinking
  is not a deferrable "delivery concern" in that case: the page is
  broken *now*, in the gated artifact (see § Failure modes,
  Hotlinked source images).

### figma-text-gate.mjs — content gate for Figma-sourced pages

A Figma-sourced page has no source DOM, so `dom-equality` cannot run. The Figma text gate replaces it:

```bash
node stardust/scripts/reskin/figma-text-gate.mjs \
  --model stardust/reskin/content-model/<slug>/content-model.json \
  --rendered stardust/prototypes/<slug>-proposed.html
```

The reference is every effectively-visible TEXT node of the frame's body sections, in reading order and
rendered case, re-read from the cached nodes response — never from the model it checks. Each string must
appear exactly once, in order, in `<main>` innerText; drawn-field placeholders must appear as
`placeholder` attributes. Findings: missing, order, case (TITLE is caseless: CSS `capitalize` is not
Figma TITLE), duplicate, extra. `text-ops.json` beside the model declares what not to expect. PASS only
with zero findings; exit 0 / 1 / 2 (setup). Run `slot-coverage.mjs --deltas reskin/deltas/<slug>.json`
beside it: `figma-donor.mjs content` seeds that file (the deployed leg's schema, `deployed/deltas.mjs`)
with `metadata.absent: [description, canonical]`, asserted not carried; the model's empty OG/Twitter
maps and JSON-LD list make the gate expect none, and images keep the host+path comparison.

## (a′) Source coverage

Every gate above compares the target with the captured model, so what the
capture did not observe is invisible to all of them and its loss passes.
`source-coverage.mjs` gates the three blind spots — space, time, attribute —
against the local reskin page (Phase 5) and again on the aem.page preview
(after (e)'s `preview`), where page chrome and client-rendered blocks exist.

| Check | Reads | Bar |
|---|---|---|
| S1 residue carried | `residue[]` (not `chrome`) | each region ≥ `--min-chars` (20): one target element outside header/footer, ≤ 3× its text, holds ≥ 60% of its text lines — else declared, else **FAIL**; shorter regions are `info` |
| S2 settled | `_provenance.settle` | missing (pre-0.40 model) or `stable: false` is **WARN**: re-capture; never fails |
| S3 tone carried | `sections[].tone` | a `dark` slot's first heading (else text) sits on a dark background in the target — else declared, else **FAIL** (also when the probe text is gone); `tinted` → other is WARN; `page` is not checked |

The target is settled the same way as the source (scroll, then text stable
3 × 500 ms, ≤ 15 s) before it is measured. Declared drops,
`stardust/reskin/coverage/<slug>.json`:

```json
{ "version": 1,
  "residue": [ { "match": "<substring of the sel or the first line>", "why": "…" } ],
  "tones":   [ { "slot": "s01", "to": "tinted", "why": "donor hero module is a light band" } ],
  "blocking": true }
```

Every entry needs a `why`; an unknown key, a bad slot id or tone is exit 2,
every problem listed. `"blocking": false` reports FAILs as ADVISORY (exit 0).
Exit 0 PASS, 1 FAIL, 2 setup (a protected preview, 401 or 403, is out of scope).

**Why it exists.** A 52-page school-site migration passed every content gate
while the deployed pages had no breadcrumb or section sidebar (outside
`main`, so never in the model), no Facebook posts on the home page (rendered
by XHR after the capture read the page) and light bands where the source's
callouts were dark (tone was a mapping judgment nothing measured). (a′)
FAILs all three on the original render, PASSes the fixed preview, and PASSes
a declared hero change.

## (b) Design-adoption gate

### donor-probe.mjs — computed-style token assertions

```bash
node stardust/scripts/reskin/donor-probe.mjs \
  --tokens stardust/reskin/donor-tokens.json \
  --rendered stardust/reskin/pages/<slug>.html \
  --report stardust/reskin/reports/<slug>-donor-probe.md \
  --shot   stardust/reskin/reports/<slug>-reskin-full.png
```

Asserts donor token values as computed styles on the rendered page.
The default spec covers: page bg/fg, font-family **token string**,
body size, display weight, heading color, primary button
(bg/fg/radius/padding/size), container max-width, section rhythm.
Pass `--spec <probe-spec.json>` (entry shape in the script header) to
extend with page-specific assertions: band palettes, card radii,
accent link color.

#### Rendered-page conventions

The default spec asserts against conventions the Phase 4 renderer
must follow: content in `<main>`; the page measure as `.container`
inside `main`; the donor primary button as `.btn` **inside `main`**
(the probe deliberately ignores chrome buttons — nav CTAs often carry
trimmed padding overrides and would fail the button spec spuriously).
A renderer that breaks a convention fails the probe with
`selector matched nothing` — a missing selector is a **FAIL, not a
skip**, because silent skips fake passes. A token path absent from
`donor-tokens.json` is a reported SKIP. The one content-aware
exception: with `--model <content-model.json>`, spec entries marked
`"needs": "button"` (the default `main .btn` entries) are a reported
SKIP when the page's content has nothing the renderer turns into a
button (`stream-render.mjs` `rendersButton`: a cta with a button class
or captured `buttonLike`,
a submit/button control, text inside a `<button>`). The decision reads
the source content, not the rendered page, so a renderer that drops a
real button still fails.

One default-spec blind spot: when the source's only heading is visually
hidden (an sr-only landmark), the display-weight assertion (the first
`h1`–`h3` in `main`; the heading colour takes the first heading of any
level, since form pages often carry no h1/h2) holds a token on an
**invisible** element and says nothing about the page's display face.
Add a `--spec` entry asserting the display tokens on the element that
renders as the display headline (the hero h2, typically).

#### Tolerances

| Assertion class | Tolerance | Why |
|---|---|---|
| Colors (bg, fg, accent, bands) | exact string | computed rgb() is deterministic |
| Radii | exact string | ditto |
| Font-family token string | exact after quote-strip + case-fold | licensed donor fonts are adopted as the *token string* with local fallback (§ Failure modes) — the string is the contract |
| Font sizes / weights | exact string | |
| Button padding | ±2px per component | sub-pixel/shorthand-expansion slack |
| Container max-width | ±20px | donors mix `max-width` with padding-based measures |
| Section vertical rhythm | ±16px | rhythm is a band, not a constant, on real donors |

Tighten per page via `--spec`; never loosen beyond the table without
recording why in the ledger.

### The side-by-side judgment (mandatory, not scriptable)

The probe proves tokens; it cannot prove the page *reads as* the
donor. Open the rendered page (or the `--shot` capture) next to the
donor reference-page screenshots
(`stardust/canon-source/assets/screenshots/`) and judge: hero
treatment, band rhythm, module shapes, link/CTA idiom. Record the
verdict and its weakest point in `ledger.json`.

## (c) Sanity

`donor-probe.mjs` runs it automatically: **no horizontal overflow at
1440 and 360** (`--widths` to override). Overflow at 360 is the
classic first-pass failure and it is usually chrome (the experiment's
was a fixed nav CTA), so the fix iteration typically touches
responsive chrome, not content or tokens.

## (d) Figma fidelity (Figma donor)

`figma-gate.mjs` checks the rendered page against the capture
`figma-donor.mjs` made, offline. Flags, the checks file schema, exit
codes (0 / 1 / 2 / 3 / 124) and outputs: `figma-gate.mjs --help`; the
run command is SKILL.md Phase 5 (d).

**The checks file.** `stardust/reskin/figma-checks/<slug>.json` is the
agent's reading of the frames, taken from `figma-gate.mjs boxes
--module Mn` outlines: per section, the page selectors and the Figma
node each is measured against (geometry) or whose text style it must
match (type).

In a component kit the curated module frame is usually a documentation
frame (title block, notation, the module at desktop, tablet and mobile
widths) and the module instance in it is content-width: point `node` at
the desktop instance, set `"width": 1440` and `roots` at the mobile one.
The page section is full-bleed and the instance is not, so check widths,
gaps and paddings, not `left`, `right` or `top`.

**Coverage floor.** Computed from Figma, so a file cannot cover only
what the page got right. Every root (`node`, each `roots` entry) is the
module frame or an outermost component or instance in it (no instance
between, never a TEXT node, a plain frame or another module's node), at
least half as wide as the width it is checked at, and holds a text
style unless the module has none. At every width a section is checked
at, every text style of that width's root (family, size, weight, line
height and letter spacing to 0.1px, colour) needs a `type` entry whose
node has it; a module frame holding a mobile variant (a component or
instance named mobile, 320 to 480 wide) needs a `roots` entry up to 480
wide that is one of them (the desktop root's own set when the frame holds
several), keyed at the variant's own width (its `w` in `boxes`: 414, not a
phone width such as 360), and some root is checked wider than 480. Only
`waive: [{ node | "width": "mobile" | "desktop", why }]` (or a section `skip`)
lowers it: `node` on a frame drops that subtree (a documentation panel), on a
TEXT node waives its style; the widths waive the mobile or the desktop root.
A miss is exit 2, every one listed, in `floor-problems.txt` too (the error's
last line, for `run-bg wait`). A `boxes` TEXT line prints the colour and
letter spacing a style is keyed by.

**Waiver budget.** Per checks file, waivers and skips may excuse at most 25%
of the floor's items (each root's text styles, plus a waived mobile or
desktop root's and a skipped section's), and never every mobile root the
floor requires. Over it is a floor problem (exit 2). `--waiver-budget <pct>`
raises the share; `summary.json` and the fragment record it.

| Step | Class | Asserts | Tolerance |
|---|---|---|---|
| B0 join | blocks | `mapping.md`'s rendered rows are exactly the page's top-level `section[data-slot]`s, in order, with the mapped `data-module` and the slot's first heading | exact; drift names the slot |
| B1 geometry | blocks | width, height, left, right, top, gaps, paddings of page boxes against Figma nodes (relative to the module root) or a token | ±1px (Figma has half pixels, `measure-live` rounds) unless an entry says why |
| B3 ramp | blocks | the `:root` block `donor-tokens.json` yields, and per type entry fontSize, fontWeight, lineHeight, letterSpacing, first fontFamily, color against the Figma text node | exact; lineHeight and letterSpacing ±0.1px |
| B2 pixel | advisory | the section's slice of the frame image against the section's screenshot | none: orientation only; reference classes (light text 3%, inverted 3.5%, raster ground 4%) are uncalibrated |
| B4 register | informational | `mandated` (passes on results of this checks file, every text style covered, no waiver; results of an older file give a `stale` row: re-run `all`), `waived` (one row per waiver), `unmandated`, `out-of-kit`, `conflict` and `pre-existing`, with Figma node links | none |

- **Waivers show.** A `waived` row names the node (or `mobile`/`desktop`),
  quotes its `why` and counts the text styles and nodes it drops per width, so
  a container waiver cannot hide a page area; the fragment's `coverage` keeps
  the totals (`text styles 8/8 · widths 1440 · waived 1`).
- **`n/a: frame content differs`.** B2 compares pixels only where the
  frame's copy is the section's copy (visible text, whitespace and
  case ignored). Reskin keeps the *source's* bytes, so a section
  whose copy differs is n/a; geometry and ramp carry it. A `fixture`
  pixel mode screenshots a hand-made stand-in with the frame's copy.
- **Fonts are recorded, not failed.** B2 names each font a section
  uses that the page does not render; B3 compares only the first
  family of the computed `font-family`.
- **Conflicts.** `conflict` is a Figma text colour below WCAG contrast (4.5, 3
  for large text) in a root the section's checks name, its alpha composited over
  the solid ground behind it; gradient and image grounds are skipped. A
  translucent colour or ground with no opaque ground behind it is listed as
  `Contrast not assessed: n texts` (`register.json` `unassessable[]`):
  supplemental unknown-contrast evidence, not a seventh class and not a PASS;
  counts and exits are unchanged.
- **No verdict.** Exit 124 (a crashed step, a `pixel-compare`
  deadline): re-run once, never a fix iteration; the same 124 twice is
  a residual (needs-owner). Exit 3 is a bot challenge on a live target,
  never measured; exit 2 a setup problem: fix the input, re-run.
  `all`'s exit order is in `--help`.

## (e) Deployed acceptance (aem.page preview)

`deployed-gate.mjs` holds the page `deploy` made to the local reskin
page and the donor, on `https://<branch>--<repo>--<org>.aem.page`.
Recipe, delta file, ledger, fix budget: `deployed-leg.md`; command
lines: SKILL.md Phase 5 (e); flags, evidence, exit codes:
`deployed-gate.mjs --help`. `content`, `tokens`, `sanity`, `chrome` and `figma` first
settle the EDS decoration (`body.appear`, every section and block `loaded`,
within 20 s) and name a stall; in `all` a stall is that step's FAIL and the
run goes on. `parity`'s captures wait a fixed 3 s instead, and `inherited`
fetches `.plain.html` without a browser.

| Step | Class | Asserts | Bar |
|---|---|---|---|
| `content` A1 | blocks; advisory while the delta file says `"blocking": false` | `dom-equality` and `slot-coverage` on the preview, through `--deltas`; a Figma-sourced model runs `figma-text-gate` in place of `dom-equality` | both exit 0; unused deltas warn |
| `tokens` A2 | blocks | `donor-probe`: palette and type on `body`, `main h1`, `main h2`, the primary button on `main a.button.primary`, `layout.sectionPaddingY` on every non-empty `main > .section` (top and bottom), every `:root` token verbatim, with the optional `--card-bg`, `--card-radius`, `--card-padding`, `--card-title-color`, `--button-height`, `--section-padding-mobile`, `--gutter-mobile` when the sheet carries `cards.primary.*`, `buttons.primary.height`, `layout.mobile.*` (the probe runs at 1440 only: the mobile ones are asserted as `:root` values) | exact, first font family only (a font not served fails nothing); sections ±16px; container width is `parity`'s cap row |
| `parity` A3 | blocks | at 1440 and 360 the preview against the reskin page (replica's instruments); at 1440 also `chrome-parity` and `cap-probe` | pixels ≤ 10% and Δh ≤ 5% of the reskin page's height; per section (`section[data-slot]` paired in order with non-empty `main > .section`) the worst Δh ≤ 10% of its height, n/a when the counts differ; a header or footer the reskin page lacks left out of the preview's capture; header and footer crops ≤ 2%; caps ±20px, a missing cap fails; `chrome-parity` advisory |
| `sanity` A4 | **hard**: no delta file or residual waives it | at 1440 and 360 overflow, decoration, images, page errors; at 1440 `clip-probe` and `content-presence` | overflow ≤ 4px; every `data-section-status` and `data-block-status` `loaded`; broken images 0; page errors 0; `clip-probe` 0; HIDDEN + MISSING 0; a page answering HTTP 400 or more is no verdict (exit 124), never a pass |
| `inherited` A5 | blocks | `.plain.html`, `ai-readability`, `qa-gate` (with `eds-schema/<slug>.json` and `design.json`) | `.plain.html` 200, one `<h1>`, no `about:error`, no `/img/` src, a top-level `<div>`; `ai-readability` ≥ 98; `qa-gate` exit 0 on the inputs there are, a missing one (`eds-schema/<slug>.json`, `design.json`) being a FAIL row `incomplete: no …`, never `n/a`. `localize-links --check`, `davids-model-lint` and `block-roundtrip --ew` ran in `deploy`'s loop: "by deploy", not in the verdict |
| `chrome` A6 | **hard**, as `sanity`; a header/footer residual (`step10.header`, …) is accepted only `--by` the site owner | at 1440 and 360 the `<header>` and `<footer>` against `mapping.json` `chrome` and its model (ctas, `iconLinks`, images, footer text) | present and decorated; a logo ≥ 16px when mapped; header ≤ 240px closed, covering main ≤ 4px, band above it ≤ 48px; every mapped link rendered and visible (at 360 a toggle shows the hidden ones); no icon-font ligature word as text; every mapped footer text. No chrome in the mapping: those rows `n/a`; a mapped slot empty in the model is exit 2 |
| figma B | as (d) | `figma-gate all --target preview`, when `figma-checks/<slug>.json` exists | as (d) |

- **Protected preview.** Out of scope: the preview must be reachable without
  auth. A 401 or 403 stops `preview` with exit 2 (`deployed-leg.md`).
- **Step 10 stays.** The verdict replaces only `deploy` Step 10's automated
  reconcile; its eyeball, CLS and header-behavior checks stay mandatory before
  handoff (`deployed-leg.md` § Recipe, step 7).
- **Figma on a preview.** Sections are the preview's authored
  `.plain.html` sections, found again as `main > div:nth-child(k)` of the
  decorated page (decoration can prepend or drop sections; a moved slot
  gets a note in `join.json`). An entry is measured by its
  `previewSelector`, else its `selector`; no match is "unmeasurable", a
  FAIL. Evidence goes to `gates/<slug>/figma-preview/`, so a local run's
  `figma/` survives it.
- **No verdict, exit 3.** As (d); the budget is in `deployed-leg.md`.

## One fix iteration per gate family, then residuals

The budget is **one fix iteration per gate family**: one for the
content gate (dom-equality + slot-coverage), one for
design-adoption/sanity (donor-probe + overflow), and for a Figma donor
one for (d) (B0, B1, B3 failures). On a failure: diagnose, fix once,
**re-run every gate family** (a fix for one gate can break another).
When a family's iteration is spent and it still fails, stop iterating
that family and log. On the preview each round costs a push and a Code
Sync, so (e) re-runs a matrix instead (`deployed-leg.md`).

Per family, not per page: the families fail for unrelated reasons
(emission bugs, responsive chrome, measure mismatches), so a per-page
budget would push independent cheap fixes into residuals.

### Residual logging

`stardust/reskin/ledger.json`, per page:

```json
{
  "pages": {
    "<slug>": {
      "status": "gated",
      "gates": { "domEquality": "PASS", "slotCoverage": "PASS", "donorProbe": "PASS", "eyeball": "adopted", "sanity": "PASS",
                 "figma": "<summary.json ledgerFragment, Figma donor only>",
                 "deployed": "<deployed-gate summary.json ledgerFragment: deployed-leg.md § The ledger>",
                 "step10": "<deployed-leg.md § The ledger>" },
      "fixIteration": "hid nav CTA + lang switch below 560px; stacked hero form",
      "residuals": [ { "gate": "donorProbe", "check": "section rhythm", "detail": "72px vs 96px on s05 — donor's own short sections do this too", "verdict": "accepted" } ],
      "flags": [ "source JSON-LD Organization URLs are broken upstream — carried verbatim, needs owner decision" ]
    }
  }
}
```

A Figma residual also carries `class` (`figma.join` | `figma.geometry` |
`figma.ramp`); a deployed one's classes are in `deployed-leg.md` § The ledger. Residuals are never silently absorbed:
each names the gate, the check, and a human-readable verdict (`accepted` | `needs-owner` |
`blocked`). The Phase 6 handoff report lists every residual and flag.

## Failure modes

- **The reference was smaller than the page.** A region beside the scope
  (sidebar, breadcrumb), a block rendered after the capture read the page,
  or a band tone the mapping recoloured — no byte gate can see these,
  because they compare against the model. (a′) `source-coverage.mjs`.

- **Content-root drop (the top one).** Byte equality "passes" against
  an incomplete reference because the scope missed content (the 30%
  drop). Defense: the scope-discovery procedure + coverage line
  (`reference/content-model.md` § Scope discovery) runs *before*
  rendering; the gate inherits the verified scope verbatim.
- **Carousel nondeterminism.** Rotating carousels make source text
  capture time-dependent (hidden slides absent, clones duplicated).
  Defense: `N-D2` de-carousel in the shared ledger, applied
  identically at capture and gate; the donor-native replacement
  (static grid) is a *module transformation* recorded in the mapping
  brief, not a content delta.
- **Multi-design-system donors.** Consolidating tokens across a donor's
  coexisting systems yields a chimera the probe asserts against nothing real.
  Defense: pin ONE reference page per module family
  (`reference/donor-sources.md` § Pin one reference page);
  `donor-tokens.json` names it.
- **Casing fork.** `innerText` reflects `text-transform`;
  `textContent` doesn't. Comparing across the two silently fails (or
  silently passes the wrong thing). Defense: both capture and gate
  use `innerText`; casing is reproduced via CSS
  (`reference/mapping-brief.md` § Casing policy).
- **Icon-font ligature text.** Like the casing fork:
  Material-Symbols-class icon fonts put the ligature *name*
  ("chevron_right") in the DOM, so it is in the source's `innerText`
  and the byte-gate reference. Carry it as text (it renders as the
  literal word unless the icon font is adopted) or declare a
  normalization in the shared ledger; never edit it out. Carry vs
  normalize: `reference/mapping-brief.md` § Icon-ligature text.
- **Source drift.** The gate re-crawls the live source, so on pages
  that update daily a byte-perfect render fails tomorrow through no
  fault of its own. A divergence that is *new source content* means a
  stale capture: **re-capture** (then re-render from the fresh model),
  **not a fix iteration**, never a residual.
- **Faithful ≠ clean.** Source defects (broken JSON-LD, wrong-locale
  labels) are carried verbatim and the gate is *right* to enforce
  that. Defense: the flags list — surface to the human, never
  silently fix, never silently keep.
- **Licensed donor fonts.** The donor's font files (Sohne-class
  licensing) cannot be rebundled. Defense: adopt the font-family
  **token string** with a local fallback stack; the probe asserts the
  string, which is the honest, probe-able contract.
- **Hotlinked source images.** On an **origin-locked CDN** the URL-string
  checks pass while nothing paints (§ Image paint); Phase 6 asset
  localization is then **mandatory** (migrate's asset bundling,
  `../../migrate/reference/content-preservation.md` § Media
  references). The gate compares host+path, so localization after
  gating requires a re-run with the localized mapping or acceptance
  as a recorded residual.
- **Gate/capture drift.** A scope or ledger edited after capture
  invalidates every downstream artifact. Defense: both are recorded
  in `_provenance` and echoed in gate report headers — check them
  when a gate result looks impossible.

## Relationship to the stardust `diff` skill

`../../diff/SKILL.md`'s two probes (pixel + structural) remain the
**build-side** check after Phase 6 deploys the page to EDS — run them
prototype-vs-build with `--profile eds`, exactly as `deploy` Step 10
does; (e) is the same question for the archetype page on its preview,
asked of the reskin page. The reskin gates are **source-vs-render** and byte-level; the
diff probes are render-vs-build and role-level. They answer different
questions; neither substitutes for the other.
