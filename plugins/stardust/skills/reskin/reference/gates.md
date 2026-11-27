# The reskin gates — commands, pass bars, tolerances, failure modes

Three gate families per page, plus (d) for a Figma donor and (e) for a
deployed page, run in Phase 5 after the programmatic render. All scripts
are run as project-local copies
(`stardust/scripts/reskin/`, § Project copies) — never from the
plugin tree (ESM playwright resolution). `--rendered` accepts a URL or
a file path (auto-converted to `file://`).

Run order: content gate first (a design-adopted page with dropped
content is worthless), then design adoption, then sanity, then (d),
then (e) once the page is deployed. Two fix iterations per gate family
(§ below); (e) has its own budget (`deployed-leg.md` § The fix budget).

## Install

SKILL.md Setup step 2. `node --version` must be 22 or later. Probe from `stardust/` (`mkdir -p stardust` first):

```bash
node -e "Promise.all(['playwright','pixelmatch','pngjs'].map(m=>import(m))).then(()=>process.exit(0),()=>process.exit(1))"
```

The copies live under `stardust/scripts/` and ESM resolves upward from there, so the probe sees both
`stardust/node_modules` and the project's. On failure install into `stardust/`, its own package root:

```bash
cd stardust && { [ -f package.json ] || echo '{"private":true}' > package.json; } && npm i -D playwright pixelmatch pngjs
```

and add `stardust/node_modules/` to `.gitignore`. An install at the project root can rewrite `package-lock.json` and
prune the project's own dev tooling (on the EDS boilerplate it dropped `@babel/core` and broke eslint); a `--no-save`
install is pruned by a later real `npm i`. If `git diff --stat package-lock.json` is not empty after an install,
`git checkout package.json package-lock.json` and install into `stardust/`.

## Project copies

SKILL.md Setup step 3. ESM resolves `import('playwright')` from the *script's* directory and the plugin tree ships no
`node_modules`: run byte-identical copies under `stardust/scripts/`, with `../stardust/`, `../diff/`, `../replica/` and `../deploy/`
siblings of `../reskin/`.

- `skills/reskin/scripts/` → `reskin/`, recursively except `test/` (`deployed/`, `figma/`, `figma-gate/` and `render/`
  travel with it).
- `skills/stardust/scripts/` → `stardust/` (`browser.mjs`, `live-session.mjs`; `figma-donor.mjs stamp`,
  `stream-render --register` and the canon bridge write through `state.mjs`).
- `skills/diff/scripts/` → `diff/`, all of it (`figma-gate` and `deployed-gate` measure through `measure-live.mjs`).
- `skills/replica/scripts/` → `replica/`: `pixel-compare.mjs`, `run-capped.mjs`, `run-bg.mjs`, `stitch-shot.mjs`,
  `crop-compare.mjs`, `chrome-parity.mjs`, `cap-probe.mjs` (`pixel-compare` and `run-bg` import `run-capped`;
  `stitch-shot`, `chrome-parity` and `cap-probe` need `stardust/browser.mjs`).
- `skills/deploy/scripts/` → `deploy/`: `eds-path.mjs`, `qa-gate.mjs` (finds `replica/cap-probe.mjs`),
  `ai-readability.mjs`: what `deployed-gate.mjs` resolves.
- `skills/prototype/fixtures/mobile-nav-audit.mjs` → `prototype/`: `reskin-ledger.mjs record` runs it as the runtime
  mobile-adapt check; without it that check is `NOT-RUN`, which blocks the archetype until a residual is accepted.
  (`canon-from-reskin.mjs`'s visual record uses `replica/stitch-shot.mjs` and `pixel-compare.mjs`, listed above.)

Every gate script (`capture-content`, `dom-equality`, `donor-probe`, `slot-coverage`) needs `stardust/browser.mjs`
and exits 2 without it, even for a local file; only `capture-content` also fails `--help`.
`stitch-shot --hide` checks the unhidden page for late denial content before capturing.

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
(3) **image crop** (§ Image crop below): every rendered image shows
the area of it the source shows: at most `--crop-tolerance` (default
10%) of what it shows lies outside the source's region, and an
off-centre anchor the source sets is kept.
**Measured with behaviour kept** (`measurePrep` in
`source-normalize.mjs`, both gates, page restored after): closed
`<details>`, closed dialogs and `aria-controls` panels are opened on
both sides; on the rendered side a `/fragments/` or `/modals/` link is
resolved as EDS `fragment.js` does, and EDS sections outside `main`
(a sticky tray) join the scope. Revealed content is optional: it
counts only where the other side has the same words or images there,
so content visible at load can never be skipped. The report names what
was normalised (one line). An accordion hidden only by `display:none`
is not opened. `measurePrep` also sets `data-stardust-measure` on
`<html>`, which docks a kept tray, shows every tab panel and unclamps a
scroll box (`render.md` § Behaviour); `figma-gate` sets it too.
**Informational only:** element count and tag+class
sequence — a reskin re-structures markup by design; a tag-sequence
divergence at position 0 is expected and healthy.

#### Image crop

A donor frame has a fixed size: a Figma Text + Image frame is
574×324, a card's media 220px high, and the geometry gate (d) holds
a render to it. The frame stays; what must match the source is
**which area of the image it shows**. A content image rarely has the
frame's shape, so `object-fit: cover` crops it, and the source
crops it too, often off-centre: a component's `object-position`
(social post cards `50% 30%`, media cards `50% 0%`). A centred
crop then shows a part the source cut away (the middle of a post
the source frames at its upper third), and no other check sees it:
the image is present, in order, with its alt text and the frame's
width.

So the gate measures, on both sides, the region of each image's own
pixels its box shows: object-fit and object-position place the
drawn image, clipping ancestors (overflow other than `visible`)
narrow the box (`source-normalize.mjs` `visibleRegion` / `IMG_CROP`,
one definition run on both pages). Images pair by order, so the
check runs whenever the counts agree, with or without
`deltas.images`, and only images of the same shape pair (natural
ratios within 2%): a live feed that re-orders between capture and
gate leaves the pair unpaired, reported, never judged. A rendered
image fails when more than
`--crop-tolerance` (default 10%) of its region lies outside the
source's (per axis: where the rendered window is the larger one, it
must contain the source's, since a wider donor frame necessarily
shows more width), or when the source anchors it off-centre vertically, the
render crops it top and bottom, and the render's position is more
than 15 points from the source's (the designer's anchor holds even
where the source's own box shows the whole image). A smaller frame
inside the source's area passes; so does any position where the
source shows the whole image and sets no anchor. How much of the
image shows is reported, never gated: a donor frame may be tighter.
A lazy image that never loaded is unmeasured, never failed. Each
failure names the `object-position` that puts the rendered window on
the source's area.

Keep the frame; move the crop:

- **Carry the source's position.** Read it from the source
  (`getComputedStyle(img).objectPosition` of each content image, or
  the failure's Fix column). In EDS, a block whose images share a
  position takes it as an authorable option: `Cards (focus-upper)`
  for `50% 30%`, `Cards (focus-top)` for `50% 0%`, centre by default;
  the block CSS sets `object-position` per option. In the reskin
  renderer, the same position on each image.
- **A source that shows the image whole** sets no area to keep, but
  the donor frame must crop it: put the window in the upper third
  (`50% 30%`; the convention sources use for photo cards) so a
  portrait keeps the head. A centred 16:9 crop of a square portrait
  cut the top of the head off; the gate cannot see faces, so this is
  the rule, not a check.
- **Never grow the frame to show the whole image**: it breaks the
  donor's image-to-text proportions; the Figma geometry gate (d)
  holds the frame size, this check holds the area inside it.
- Pixel fidelity is unchanged: the frames keep the donor's size.

Measured on a 52-page school site reskinned to a Figma kit: the
source framed 74 of 213 images off-centre (62 at `50% 0%`, 12 at
`50% 30%`); centred crops showed the wrong area of 40 images on 5
pages (social posts, media cards). Carrying the source's position as
a block option (27 blocks on 19 pages) took that to 0 of 192, with
the frames unchanged. `--crops-out <json>` writes both sides'
framing per image: the source's is what a renderer or the DA
conversion copies. The gate waits (up to 8 s) for images to finish
loading before it measures; one that never loads stays unmeasured. The same
rule holds for the EDS blocks the deploy leg ships: the deployed
content gate runs this check on the preview. A crop the design truly
needs elsewhere is a residual with its cause, never a raised
`--crop-tolerance`.

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
`live-session.mjs` (real Chrome's own identity + the standard request headers —
a bare context still 403s on Akamai-class bot managers —
`domcontentloaded` on live targets, challenge detection). This is the
byte gate's own correctness: a gate that silently measured a
challenge interstitial or a degraded UA-served document as the
source would pass/fail the render against the wrong reference. A bot
challenge exits **3** (distinct from 1=FAIL, 2=setup), never
measured; a non-challenge HTTP ≥ 400 exits 2. Escalate bot-managed
sites with `--headed`; pin geo-redirecting sources with `--locale`.
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
- every embed in `content-model.json#embeds` (iframe, `<video>`,
  YouTube, Vimeo, Wistia, Brightcove) has a counterpart, matched by
  provider and video id, else host and path: a missing one is a FAIL
  (a video re-hosted on purpose is a residual);
- `altFlags` (generic, file-name or repeated alt text) listed as
  advisory, never a FAIL;
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
| `:root` custom properties | whitespace-collapsed, each colour in one notation; a `family` token on its first family | read as declared, not computed: `#fff` and `rgb(255 255 255)` are one value |
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
codes (0 / 1 / 2 / 3 / 124) and outputs: `figma-gate.mjs --help`.
Run it under `run-bg` and read it with `wait`, repeating while it exits
75 (no step blocks past ~110 s):

```bash
node stardust/scripts/replica/run-bg.mjs start --name figma-<slug> \
  --dir stardust/.work/reskin/bg -- \
  node stardust/scripts/reskin/figma-gate.mjs all --page <slug> \
  --url stardust/reskin/pages/<slug>.html
node stardust/scripts/replica/run-bg.mjs wait figma-<slug> --dir stardust/.work/reskin/bg
```

B4, the divergence register (`.work/reskin/gates/<slug>/figma/register.md`), is informational.

**Module type comes from Figma, never from tag tokens.** Once the checks
file is written, and after every change to it, run
`figma-gate.mjs type-css --page <slug> --url stardust/reskin/pages/<slug>.html`
before `all`. It writes each Type entry's style from its Figma text node to
`reskin/figma-type/<slug>.css` and into the page as its last
`<style data-figma-type>`; `stream-render.mjs` re-applies it on every
render, and deploy lifts each section's rules into that block's CSS. Never
hand-tune a Figma type value in page CSS. A B3 type FAIL after `type-css` is
an inline or `!important` rule outranking it, or an entry whose selector
misses the element: fix that, then re-run `type-css`.

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
`absent: [{ node, why }]` names a module part the slot's content does not
fill (a subhead the source lacks): it is not rendered, no content is written
for it, and its subtree leaves the floor without spending the waiver budget.
No entry may measure a node in it; a root whose every text part is absent is
a floor problem (the module does not fit: `mapping-brief.md` § Content fit).
The register names each absent part in its section's row.
A miss is exit 2, every one listed, in `floor-problems.txt` too (the error's
last line, for `run-bg wait`). A `boxes` TEXT line prints the colour and
letter spacing a style is keyed by.

**Chrome.** A `chrome` row of `mapping.md` that names an included module
(the page's header or footer drawn from the kit's Header / Footer component)
is joined like a section: its part comes from the slot id, then the module
cell, then Content (`header`, `nav`, `navigation`, `masthead` → `header`;
`footer` → `footer`), and the page element is the first of
`header[data-canon]`, `.site-header`, `#site-header`, `header` outside `main`
(the same for `footer`). `join.json` lists it as section `header` /
`footer` (`chrome` names the row), so the checks file needs
`sections.header` / `sections.footer` entries and the coverage floor counts
their text styles: a mapped part without an entry is a floor problem like any
section's, and its `skip` spends the waiver budget. A part the page lacks, a
module that is not included or two rows mapping one part are section drift.
A chrome row naming no module (`—`) needs nothing, as before.

**Waiver budget.** Per checks file, waivers and skips may excuse at most 25%
of the floor's items (each root's text styles, plus a waived mobile or
desktop root's and a skipped section's), and never every mobile root the
floor requires. Over it is a floor problem (exit 2). `--waiver-budget <pct>`
raises the share; `summary.json` and the fragment record it.

| Step | Class | Asserts | Tolerance |
|---|---|---|---|
| B0 join | blocks | `mapping.md`'s rendered rows are exactly the page's top-level `section[data-slot]`s, in order, with the mapped `data-module` and the slot's first heading; a `chrome` row whose Donor module is an included module joins the page's header or footer as section `header` / `footer` | exact; drift names the slot |
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
- **Fonts are recorded, not failed — and never passed unserved.** B2
  names each font a section uses that the page does not render; B3
  compares the first family of the computed `font-family` and, when it
  matches Figma's, whether the page serves it (a loaded `@font-face` of
  that family covering the element's weight and style, an installed
  family, or a generic one). A declared family rendered from a fallback is
  `UNSERVED` (`declared Inter, served fallback`): no PASS, no FAIL, left
  out of `ramp PASS n/n` and counted as `(j unserved)`. First serve
  it: when the family's licence is open (OFL or Apache, from the
  Google Fonts metadata or the donor's licence file), self-host it and
  re-run the gate. Otherwise log a `font.unserved` residual
  (`accepted` when a licensed face's files aren't supplied,
  `needs-owner` when it is meant to be served or the licence is
  unknown).
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
Recipe, delta file, ledger, fix budget: `deployed-leg.md`; flags,
evidence, exit codes: `deployed-gate.mjs --help`. Command lines:

```bash
node stardust/scripts/reskin/deployed-gate.mjs preview --page <slug> \
  --org <o> --repo <r> --branch <b> --path /<ns>/<slug> --namespace <ns>   # or --sandbox
node stardust/scripts/reskin/deployed-gate.mjs content --page <slug>   # no delta file yet: it measures
# author stardust/reskin/deltas/<slug>.json, then the whole leg:
node stardust/scripts/replica/run-bg.mjs start --name deployed-<slug> \
  --dir stardust/.work/reskin/bg -- \
  node stardust/scripts/reskin/deployed-gate.mjs all --page <slug>
node stardust/scripts/replica/run-bg.mjs wait deployed-<slug> --dir stardust/.work/reskin/bg   # repeat while it exits 75
```

`all` writes `summary.json`; copy its `ledgerFragment` into `ledger.json` `pages.<slug>.gates.deployed`. `content`, `tokens`, `sanity` and `figma` first
settle the EDS decoration (`body.appear`, every section and block `loaded`,
within 20 s) and name a stall; in `all` a stall is that step's FAIL and the
run goes on. `parity`'s captures wait a fixed 3 s instead, and `inherited`
fetches `.plain.html` without a browser.

| Step | Class | Asserts | Bar |
|---|---|---|---|
| `content` A1 | blocks; advisory while the delta file says `"blocking": false` | `dom-equality` and `slot-coverage` on the preview, through `--deltas` | both exit 0; unused deltas warn |
| `tokens` A2 | blocks | `donor-probe`: palette and type on `body`, `main h1`, `main h2`, the primary button on `main a.button.primary`, `layout.sectionPaddingY` on every non-empty `main > .section` (top and bottom; with the page's Figma checks file a kit pads per module, so those rows are a SKIP and the `figma` step's geometry holds each section to its module), every `:root` token verbatim, with the optional `--card-bg`, `--card-radius`, `--card-padding`, `--card-title-color`, `--button-height`, `--section-padding-mobile`, `--gutter-mobile` when the sheet carries `cards.primary.*`, `buttons.primary.height`, `layout.mobile.*` (the probe runs at 1440 only: the mobile ones are asserted as `:root` values) | exact, first font family only (a font declared but not served is an `ADVISORY tokens font.unserved` line, left out of n, never a FAIL); sections ±16px; container width is `parity`'s cap row |
| `parity` A3 | blocks | at 1440 and 360 the preview against the reskin page (replica's instruments); at 1440 also `chrome-parity` and `cap-probe` | pixels ≤ 10% and Δh ≤ 5% of the reskin page's height; per section (`section[data-slot]` paired in order with non-empty `main > .section`) the worst Δh ≤ 10% of its height, n/a when the counts differ; a header or footer the reskin page lacks left out of the preview's capture; on a `--sandbox` preview a header or footer `mapping.md` maps no chrome row to is the boilerplate's own: hidden on both sides, its crop n/a and recorded (`parity.json` `ignored`); header and footer crops ≤ 2%; caps ±20px, a missing cap fails; `chrome-parity` advisory |
| `sanity` A4 | **hard**: no delta file or residual waives it | at 1440 and 360 overflow, decoration, images, page errors; at 1440 `clip-probe` and `content-presence` | overflow ≤ 4px; every `data-section-status` and `data-block-status` `loaded`; broken images 0; page errors 0; `clip-probe` 0; HIDDEN + MISSING 0; a page answering HTTP 400 or more is no verdict (exit 124), never a pass |
| `inherited` A5 | blocks | `.plain.html`, `ai-readability`, `qa-gate` (with `eds-schema/<slug>.json` and `design.json`) | `.plain.html` 200, one `<h1>`, no `about:error`, no `/img/` src, a top-level `<div>`; `ai-readability` ≥ 98; `qa-gate` exit 0 on the inputs there are, a missing one (`eds-schema/<slug>.json`, `design.json`) being a FAIL row `incomplete: no …`, never `n/a`. `localize-links --check`, `davids-model-lint` and `block-roundtrip --ew` ran in `deploy`'s loop: "by deploy", not in the verdict |
| figma B | as (d) | `figma-gate all --target preview`, when `figma-checks/<slug>.json` exists | as (d) |

- **Protected preview.** Out of scope: the preview must be reachable without
  auth. A 401 or 403 stops `preview` with exit 2 (`deployed-leg.md`).
- **Nav depth.** `parity` also counts the source header's nav groups
  (a list item holding a nested list, or a labelled toggle with 2+
  links) against the preview's `.nav-sections` items holding a list,
  at 1440 (`nav-depth.json`, `chrome.navDepth`), and the header's
  link rows (overlapping link lists and runs are one row). Fewer groups,
  a flat list of the group links, fewer rows (a utility bar merged into
  the menu) or a dropdown open at load is a parity FAIL; a source with
  no groups and one row is n/a.
- **Step 10 stays.** The verdict replaces only `deploy` Step 10's automated
  reconcile; its eyeball, CLS and header-behavior checks stay mandatory before
  handoff (`deployed-leg.md` § Recipe, step 7).
- **Figma on a preview.** Sections are the preview's authored
  `.plain.html` sections, found again as `main > div:nth-child(k)` of the
  decorated page (decoration can prepend or drop sections; a moved slot
  gets a note in `join.json`). A slot is found by its first heading; an
  image-only slot (no text in the content model) by its image (alt text
  or file name) among the free sections between its neighbours, else by
  document order there, with a note. Each slot whose authored section does not
  hold the EDS block its module maps to (deploy Step 2,
  [`../../deploy/SKILL.md` § 2](../../deploy/SKILL.md#2-decide-names--reuse--lock-before-writing-any-code),
  applied by `scripts/figma/eds-map.mjs`; a default-content module holds
  none) gets an advisory `naming` line, never a FAIL. An entry is measured by its
  `previewSelector`, else one derived from its text on the reskin page
  (`preview-selectors.json`, a `warn:` line per miss), else its
  `selector`; no match is "unmeasurable", a FAIL. Evidence goes to `gates/<slug>/figma-preview/`, so a local run's
  `figma/` survives it.
- **No verdict, exit 3.** As (d); the budget is in `deployed-leg.md`.

## Two fix iterations per gate family, then residuals

The budget is **two fix iterations per gate family**: two for the
content gate (dom-equality + slot-coverage), two for
design-adoption/sanity (donor-probe + overflow), and for a Figma donor
two for (d) (B0, B1, B3 failures). On a failure: diagnose, fix, and
**re-run every gate family** after each fix (a fix for one gate can break another).
When a family's two iterations are spent and it still fails, stop iterating
that family and log. On the preview each round costs a push and a Code
Sync, so (e) re-runs a matrix instead (`deployed-leg.md`).

Per family, not per page: the families fail for unrelated reasons
(emission bugs, responsive chrome, measure mismatches), so a per-page
budget would push independent cheap fixes into residuals.

### Residual logging

The ledger is written by script, never by hand:

```bash
node stardust/scripts/reskin/reskin-ledger.mjs record <slug> [--stage migrated]
node stardust/scripts/reskin/reskin-ledger.mjs eyeball <slug> --verdict pass --note "…"
node stardust/scripts/reskin/reskin-ledger.mjs residual <slug> --gate <g> --cause "…" --verdict accepted|needs-owner|blocked|fallback [--note "…"] [--by <who>]
node stardust/scripts/reskin/reskin-ledger.mjs step10 <slug> --eyeball pass --cls 0.04 --header "n/a: <why>" --by user   # (e) only
node stardust/scripts/reskin/reskin-ledger.mjs flag <slug> --note "…"
node stardust/scripts/reskin/reskin-ledger.mjs delivery --scope full-site|archetypes-only|subset [--pages a,b] --requested-by user|runner --reason "…"
```

**An agent never accepts its own blocking failure.** A residual on a
(d) `figma.join`, `figma.geometry` or `figma.ramp` class, an `exact`
check, `step10`, or the header or footer (chrome) is accepted only
`--by user`; any other `--by`, or none in a hands-off run, exits 1:
record it `--verdict needs-owner`. The
predicate (`gatesOk`) counts such a residual as covering its gate only
when it carries `by: "user"`, so an older ledger with no `by` fails
closed, and `state.mjs --to approved --by hands-off` refuses while
`gatesOk` is false. `delivery`'s `runner` is a scope the hosting runner
imposed (a page cap), named in the handoff like a user's opt-out.

### Fallback ladder (hands-off)

In a hands-off run (`state.json` `handsOff: true`) nobody can accept an
owner-only residual. The page is the kit's modules filled with the
source's content; the source's own block is the last resort, for content
no module fits, never for a check that still misses. No gate is lowered:
each step renders the new mapping and re-runs every gate. A step is not a
fix iteration.

- A section whose module fits its content (`mapping-brief.md` § Content
  fit) but still fails (d) `figma.geometry` or `figma.ramp` after its two
  fix iterations **keeps its module**: record a fallback residual (below)
  naming each slot and what still misses. Its layout may differ from the
  source's to fit the content.
- A section failing `figma.join`, or whose content fits no part of its
  module (every text part `absent`), is remapped:

1. **Closest kit module.** Remap the slot in `mapping.md` to the included
   module, other than the failing one and its `variantOf` rows, that the
   slot's content fits best (`mapping-brief.md` § Content fit). Rewrite
   its checks-file entries from `figma-gate.mjs boxes --module <new>`.
   One remap per slot.
2. **The source's own block.** Only if no module fits the content, the
   row becomes `new-module`: the source section's own layout,
   composed from donor tokens (name them, as for any new-module row), its
   checks-file entries removed. (d) joins it as `out-of-kit` (B4), B3's
   `:root` block still holds, and (a) to (c) hold as for any section.
   Geometry and ramp name the share, `PASS 12/12 (3 of 8 sections out-of-kit)`;
   with no checks left they read `NOT CHECKED 0/0 (…)`, never `PASS`. The
   ledger shows `NOT-CHECKED` and does not block on it: nothing failed.
3. **Record each step** before re-rendering:
   `reskin-ledger.mjs flag <slug> --note "fallback <slot>: <from> → <to> (<gate>: <cause>)"`.
   The handoff lists every fallback and the share of content slots that
   left the kit.

A header or footer failing (d) takes the kit's other Header / Footer
module if there is one, then a `chrome` row naming no module (`—`): the
source's own header or footer, restyled with donor tokens.

A section failing (a) after its two fix iterations takes step 2 directly:
the source's block, its text carried verbatim.

What no section remap fixes takes a recorded fallback,
`reskin-ledger.mjs residual <slug> --gate <g> --cause "…" --verdict fallback --note "<what was used>"`
(hands-off only; the script refuses any other gate):

- **`figma.geometry`**: the fitting module is kept; the note names each
  slot and the entries that still miss after two fix iterations.
- **`figma.ramp`** on a `:root` token or a font: that one token takes
  the source page's computed value; the note names the token and both values.
- **`exact`**: the section carries the source's text verbatim, never
  donor or filler copy.
- **`step10`**: re-run `step10` once after a fix; if it still fails or
  stays unresolved, the run finishes on it (the script needs two runs).

A fallback covers its gate; the handoff lists each one under "Fallbacks"
with its note, so the owner sees every check the run finished past.

`record` reads the three gate reports (`reports/<slug>-{content-gate,slot-coverage,donor-probe}.md` or
`gates/<slug>/{dom-equality,slot-coverage,donor-probe}.md`, `**Overall: PASS|FAIL**`), runs the prototype's
mobile-adapt audit (static rules + `mobile-nav-audit.mjs`), reads (d)'s `.work/reskin/gates/<slug>/figma/summary.json`
into `gates.figma` and (e)'s `…/deployed/summary.json` into `gates.deployed`, and sets the page `gated` or `failing`.
A Figma donor with no figma fragment records `figma.*` NOT-RUN. A Figma residual's `--gate` is its class
(`figma.geometry`, …). On an approved page `record` fills `handoff.<type>` (the archetype, its prototype sha and the
tier record), which `reskin-preflight` and `migrate` read (`handoff.md`). Re-run `record` after the approval and after
every fix; it keeps the `gates.step10` receipts `step10` wrote.

The resulting `stardust/reskin/ledger.json`, per page:

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
`figma.ramp` | `font.unserved`, an UNSERVED ramp result or tokens line); a deployed one's classes are in `deployed-leg.md` § The ledger. Residuals are never silently absorbed:
each names the gate, the check, and a human-readable verdict (`accepted` | `needs-owner` |
`blocked` | `fallback`). The Phase 6 handoff report lists every residual and flag.

## Failure modes

- **Content-root drop (the top one).** Byte equality "passes" against
  an incomplete reference because the scope missed content (the 30%
  drop). Defense: the scope-discovery procedure + coverage line
  (`reference/content-model.md` § Scope discovery) runs *before*
  rendering; the gate inherits the verified scope verbatim.
- **The donor frame crops the wrong area.** A Figma image frame with
  `object-fit: cover` crops from the centre; the source framed its
  social post cards at `50% 30%` and its media cards at `50% 0%`, so
  the render showed the parts the source cut away; every other gate
  passed. Defense: the content gate's image-crop check (§ Image crop),
  and carry the source's `object-position` (a block option in EDS).
  Growing the frame to show whole images is not a fix: it broke the
  donor's image-to-text proportions.
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
