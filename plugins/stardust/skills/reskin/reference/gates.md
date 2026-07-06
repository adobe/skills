# The reskin gates — commands, pass bars, tolerances, failure modes

Three gate families per page, run in Phase 5 after the programmatic
render. All scripts are run as project-local copies
(`stardust/scripts/reskin/`, per SKILL.md § Setup) — never from the
plugin tree (ESM playwright resolution). `--rendered` accepts a URL or
a file path (auto-converted to `file://`).

Run order: content gate first (a design-adopted page with dropped
content is worthless), then design adoption, then sanity. **One fix
iteration per gate family** — content; design-adoption/sanity — then
residuals are logged (§ Residual logging).

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

**Pass bar (content gate):** dom-equality exit 0 AND slot-coverage
exit 0. No partial credit — one dropped CTA is a fail.

#### Image paint — a PASSing image check is not a rendering image

Both image checks above compare **URL strings** (host+path). A
string can match perfectly while the pixel never arrives: kew's
image CDN returns HTTP 403 to any non-kew-origin request, so the
reskin's 19 hotlinked `currentSrc` images all "passed" the string
gates while every one rendered as a broken-image icon. The gate was
provably right and the page was provably broken.

Defenses, in order:

- `slot-coverage.mjs` asserts **paint** per present content image —
  after a lazy-load scroll pass, the matching rendered `img` must
  have `naturalWidth > 0`. A zero-painted image is a named **FAIL**
  line (`--paint warn` downgrades to a warning; do that only with a
  recorded reason in the ledger).
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

## One fix iteration per gate family, then residuals

The budget is **one fix iteration per gate family**: one for the
content gate (dom-equality + slot-coverage), one for
design-adoption/sanity (donor-probe + overflow). On a failure:
diagnose, fix once, **re-run all three gate families** (a fix for one
gate can break another). When a family's iteration is spent and it
still fails, stop iterating that family and log.

Why per family, not per page: the two families fail for unrelated
reasons — content failures are renderer emission bugs, sanity
failures are almost always responsive chrome — and both field runs
bear this out. The validation experiment needed exactly one sanity
iteration (360px nav CTA); the smoke run needed exactly one of
*each* (a separator-emission fix for the content gate, then the same
360px chrome class for sanity). A single per-page budget would have
forced the smoke's second, independent, one-edit fix to be logged as
a residual; per-family keeps the loop just as bounded without
absorbing real, cheap fixes.

### Residual logging

`stardust/reskin/ledger.json`, per page:

```json
{
  "pages": {
    "<slug>": {
      "status": "gated",
      "gates": { "domEquality": "PASS", "slotCoverage": "PASS", "donorProbe": "PASS", "eyeball": "adopted", "sanity": "PASS" },
      "fixIteration": "hid nav CTA + lang switch below 560px; stacked hero form",
      "residuals": [ { "gate": "donorProbe", "check": "section rhythm", "detail": "72px vs 96px on s05 — donor's own short sections do this too", "verdict": "accepted" } ],
      "flags": [ "source JSON-LD Organization URLs are broken upstream — carried verbatim, needs owner decision" ]
    }
  }
}
```

Residuals are never silently absorbed: each names the gate, the
check, and a human-readable verdict (`accepted` | `needs-owner` |
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
  **origin-locked CDN** (kew: 403 to every non-origin request,
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

## Relationship to stardust:diff

`../../diff/SKILL.md`'s two probes (pixel + structural) remain the
**build-side** check after Phase 6 deploys the page to EDS — run them
prototype-vs-build with `--profile eds`, exactly as `deploy` Step 10
does. The reskin gates are **source-vs-render** and byte-level; the
diff probes are render-vs-build and role-level. They answer different
questions; neither substitutes for the other.
