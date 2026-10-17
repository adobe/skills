# The reskin gates — commands, pass bars, tolerances, failure modes

Three gate families per page, plus (d) for a Figma donor and (e) for a
deployed page, run in Phase 5 after the programmatic render. All scripts
are run as project-local copies
(`stardust/scripts/reskin/`, per SKILL.md § Setup) — never from the
plugin tree (ESM playwright resolution). `--rendered` accepts a URL or
a file path (auto-converted to `file://`).

Run order: content gate first (a design-adopted page with dropped
content is worthless), then design adoption, then sanity, then (d),
then (e) once the page is deployed.
**One fix iteration per gate family** — content; design-adoption/sanity;
Figma fidelity — then residuals are logged (§ Residual logging). (e) has its
own budget (`deployed-leg.md` § The fix budget).

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

Live `--rendered` targets (a staged deploy on a real host) navigate
via the same shared `live-session.mjs` hardening as its siblings
(real-Chrome UA + standard headers, `domcontentloaded`, challenge
detection, webdriver spoof; `--ua` / `--wait-until` / `--headed` /
`--locale` flags). A byte-adjacent gate must never measure a
challenge interstitial or an error page: a bot challenge exits **3**
(never measured; escalate with `--headed`), a non-challenge
HTTP ≥ 400 exits 2. Local/file targets keep the legacy `networkidle`
path — rendered page files behave as before.

**Pass bar (content gate):** dom-equality exit 0 AND slot-coverage
exit 0. No partial credit — one dropped CTA is a fail. Exit codes:
0 pass, 1 fail, 2 setup error, 3 bot challenge / blocked live target.

#### Image paint — a PASSing image check is not a rendering image

Both image checks above compare **URL strings** (host+path). A
string can match perfectly while the pixel never arrives: a botanical garden's
image CDN returned HTTP 403 to any non-origin request, so the
reskin's 19 hotlinked `currentSrc` images all "passed" the string
gates while every one rendered as a broken-image icon. The gate was
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
- The **eyeball step must check paint explicitly**: open the
  rendered page (or the `--shot` capture) and look at the images
  themselves, not just the layout — a broken-image icon in a
  screenshot is easy to gloss over as "an image".
- When the source CDN is origin-locked, **Phase 6 asset
  localization is NOT optional** — it is the only fix. Hotlinking
  is not a deferrable "delivery concern" in that case: the page is
  broken *now*, in the gated artifact (see § Failure modes,
  Hotlinked source images).

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
extend with page-specific assertions — band palettes, card radii,
accent link color — as the experiment's 17-assertion probe did.

#### Rendered-page conventions

The default spec asserts against conventions the Phase 4 renderer
must follow: content in `<main>`; the page measure as `.container`
inside `main`; the donor primary button as `.btn` **inside `main`**
(the probe deliberately ignores chrome buttons — nav CTAs often carry
trimmed padding overrides and would fail the button spec spuriously).
A renderer that breaks a convention fails the probe with
`selector matched nothing` — a missing selector is a **FAIL, not a
skip**, because silent skips fake passes. A token path absent from
`donor-tokens.json` is a reported SKIP.

One default-spec blind spot to catch by eye: when the source's only
h1 is visually hidden (an sr-only a11y landmark — real sites do
this), the `main h1` display-weight assertion holds a token on an
**invisible** element and proves nothing about the page's display
face. Add a `--spec` entry asserting the display tokens on the
element that actually renders as the display headline (the hero h2,
typically) — the default assertion still passes, it just stops being
the evidence.

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
verdict and its weakest point in `ledger.json` (the experiment's
verdict named the hero gradient saturation and a fidelity-forced
uppercase headline — honest weak points, still "adopted").

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
match (type). Content-dependent measures (`top`, `height`) and any
tolerance above 1px need a `why`.

In a component kit the curated module frame is usually a documentation
frame (a title block, notation panels, the module at desktop, tablet and
mobile widths), and the module instance in it is content-width
(narrower than the page). Point each section's `node` at the desktop
instance (from the outline), `roots` at a smaller capture for entries
that set `width`, and set `"width": 1440`: the default width is the
root's, and the page is opened at it. The page section is full-bleed
while the instance is not, so `left`, `right` and `top` are offset by
the section's margins there; check widths, gaps and paddings instead.

| Step | Class | Asserts | Tolerance |
|---|---|---|---|
| B0 join | blocks | `mapping.md`'s rendered rows are exactly the page's top-level `section[data-slot]`s, in order, with the mapped `data-module` and the slot's first heading | exact; drift names the slot |
| B1 geometry | blocks | width, height, left, right, top, gaps, paddings of page boxes against Figma nodes (relative to the module root) or a token | ±1px (Figma has half pixels, `measure-live` rounds) unless an entry says why |
| B3 ramp | blocks | the `:root` block `donor-tokens.json` yields, and per type entry fontSize, fontWeight, lineHeight, letterSpacing, first fontFamily, color against the Figma text node | exact; lineHeight and letterSpacing ±0.1px |
| B2 pixel | advisory | the section's slice of the frame image against the section's screenshot | none: orientation only; reference classes (light text 3%, inverted 3.5%, raster ground 4%) are uncalibrated |
| B4 register | informational | mandated, unmandated, out-of-kit, conflict and pre-existing divergences, with Figma node links | none |

- **`n/a: frame content differs`.** B2 compares pixels only where the
  frame's copy is the section's copy (visible text, whitespace and
  case ignored). Reskin keeps the *source's* bytes, so a section
  whose copy differs is n/a; geometry and ramp carry it. A `fixture`
  pixel mode screenshots a hand-made stand-in with the frame's copy.
- **Fonts are recorded, not failed.** B2 names each font a section
  uses that the page does not render (no loaded `@font-face`, not
  installed where it is measured; a generic family is served); B3 compares the first
  family of the computed `font-family`. A font the page cannot serve
  never fails a check.
- **UNASSERTED.** A property the Figma node gives no value for is
  listed in `ramp.json` and never fails.
- **No verdict.** Exit 124 (a crashed step, a `pixel-compare`
  deadline): re-run once, never a fix iteration; the same 124 twice is
  a residual (needs-owner). Exit 3 (bot challenge on a live target)
  outranks 124 and 1 in `all`'s exit, and exit 2 outranks both.

## (e) Deployed acceptance (aem.page preview)

`deployed-gate.mjs` holds the page `deploy` made to the local reskin
page and the donor, on `https://<branch>--<repo>--<org>.aem.page`.
Recipe, delta file, ledger, fix budget: `deployed-leg.md`; command
lines: SKILL.md Phase 5 (e); flags, evidence, exit codes:
`deployed-gate.mjs --help`. `content`, `tokens`, `sanity` and `figma` first
settle the EDS decoration (`networkidle`, `body.appear`, every
`[data-section-status]` and `[data-block-status]` `loaded`, within 20 s) and
name a stall, never waiting silently; in `all` a stall is that step's FAIL
and the run goes on. `parity`'s captures wait a fixed 3 s instead (only its
header and footer band measure settles), and `inherited` fetches
`.plain.html` without a browser.

| Step | Class | Asserts | Bar |
|---|---|---|---|
| `content` A1 | blocks; advisory while the delta file says `"blocking": false` | `dom-equality` and `slot-coverage` on the preview, through `--deltas` | both exit 0; unused deltas warn |
| `tokens` A2 | blocks | `donor-probe`: palette and type on `body`, `main h1`, `main h2`, the primary button on `main a.button.primary`, every `:root` token verbatim | exact, first font family only (a font not served fails nothing); container width is `parity`'s cap row, `layout.sectionPaddingY` a SKIP |
| `parity` A3 | blocks | at 1440 and 360 the preview against the reskin page (replica's instruments); at 1440 also `chrome-parity` and `cap-probe` | pixels ≤ 10%; Δh ≤ 5% of the reskin page's height; header and footer crops ≤ 2%; caps ±20px, a missing cap fails; `chrome-parity` advisory |
| `sanity` A4 | **hard**: no delta file or residual waives it | at 1440 and 360 overflow, decoration, images, page errors; at 1440 `clip-probe` and `content-presence` | overflow ≤ 4px; every `data-section-status` and `data-block-status` `loaded`; broken images 0; page errors 0; `clip-probe` 0; HIDDEN + MISSING 0; a page answering HTTP 400 or more is no verdict (exit 124), never a pass |
| `inherited` A5 | blocks | `.plain.html`, `ai-readability`, `qa-gate` (with `eds-schema/<slug>.json` and `design.json`) | `.plain.html` 200, one `<h1>`, no `about:error`, no `/img/` src, a top-level `<div>`; `ai-readability` ≥ 98; `qa-gate` exit 0. `localize-links --check`, `davids-model-lint` and `block-roundtrip --ew` ran in `deploy`'s loop: "by deploy", not in the verdict |
| figma B | as (d) | `figma-gate all --target preview`, when `figma-checks/<slug>.json` exists | as (d) |

- **Protected preview** (`preview.json` `auth: true`, `deployed-leg.md`).
  `parity`, `sanity` and the `qa-gate` and `ai-readability` rows are
  `n/a: protected preview`: their instruments
  carry no site auth, and `ai-readability` sets its header on its whole
  browser context, so the token would reach every origin the page loads.
  `content`, `tokens`, the `.plain.html` row and `figma` authenticate, and
  `content`, `inherited` and `all` stop with exit 2 when given no token.
- **Figma on a preview.** B0 finds each slot in the preview's
  `.plain.html`, then in the decorated page: the section is
  `main > div:nth-child(k)` of the decorated div, since decoration can
  prepend or drop sections (a moved slot gets a note in `join.json`). An
  entry is measured by its `previewSelector`, else its `selector`, scoped
  to that section; no match is "unmeasurable", a FAIL. Register rows
  point at the checks root.
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

Why per family, not per page: the families fail for unrelated
reasons — content failures are renderer emission bugs, sanity
failures are almost always responsive chrome, Figma failures are
section drift or measure mismatches — and the field runs bear this
out (the validation experiment needed one sanity iteration, the smoke
run one of each). A single per-page budget would force independent,
one-edit fixes to be logged as residuals; per-family keeps the loop
just as bounded without absorbing real, cheap fixes.

### Residual logging

`stardust/reskin/ledger.json`, per page:

```json
{
  "pages": {
    "<slug>": {
      "status": "gated",
      "gates": { "domEquality": "PASS", "slotCoverage": "PASS", "donorProbe": "PASS", "eyeball": "adopted", "sanity": "PASS",
                 "figma": "<summary.json ledgerFragment, Figma donor only>",
                 "deployed": "<deployed-gate summary.json ledgerFragment: deployed-leg.md § The ledger>" },
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
- **Multi-design-system donors.** Donor pages disagree on tokens
  (radius 4px/1266px on the homepage vs pill/1080px on older pages).
  Consolidating produces a chimera the probe asserts against nothing
  real. Defense: pin ONE reference page per module family
  (`reference/donor-sources.md` § Pin one reference page);
  `donor-tokens.json` names it.
- **Casing fork.** `innerText` reflects `text-transform`;
  `textContent` doesn't. Comparing across the two silently fails (or
  silently passes the wrong thing). Defense: both capture and gate
  use `innerText`; casing is reproduced via CSS
  (`reference/mapping-brief.md` § Casing policy).
- **Icon-font ligature text.** Same family as the casing fork:
  Material-Symbols-class icon fonts put the ligature *name*
  ("chevron_right") in the DOM as text, so it is part of the
  source's `innerText` and therefore of the byte-gate reference. The
  reskin must carry it as text — where it renders as the literal
  word unless the icon font is adopted — or declare a normalization
  for it in the shared ledger. Never edit it out of the string.
  Guidance on the carry-vs-normalize call:
  `reference/mapping-brief.md` § Icon-ligature text.
- **Source drift.** The gate re-crawls the live source; on newsy
  pages that update daily, a byte-perfect render fails tomorrow
  through no fault of its own (new teaser text, rotated images). A
  gate failure whose divergence is *new source content* means the
  capture is stale: **a stale capture is a re-capture** (then
  re-render from the fresh model) — **not a fix iteration**, and
  never a residual.
- **Faithful ≠ clean.** Source defects (broken JSON-LD, wrong-locale
  labels) are carried verbatim and the gate is *right* to enforce
  that. Defense: the flags list — surface to the human, never
  silently fix, never silently keep.
- **Licensed donor fonts.** The donor's font files (Sohne-class
  licensing) cannot be rebundled. Defense: adopt the font-family
  **token string** with a local fallback stack; the probe asserts the
  string, which is the honest, probe-able contract.
- **Hotlinked source images.** `currentSrc` URLs point at the
  source's CDN — a delivery liability always, and on an
  **origin-locked CDN** (recorded: 403 to every non-origin request,
  verified with curl, real-Chrome UA, with and without referrer) a
  broken page *now*: the URL-string checks pass while nothing
  paints. slot-coverage's paint assertion (§ Image paint) catches
  it; when it fires, Phase 6 asset localization is **mandatory**,
  not optional (migrate's asset bundling,
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
