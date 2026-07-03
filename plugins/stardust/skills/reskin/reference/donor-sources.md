# Donor sources — capture recipes and donor artifacts

Reskin accepts three donor types. All three converge on the same
artifacts: a `stardust/canon-source/` capture (extract's
`--design-source` shape, `../../extract/SKILL.md` § Cross-site brand
sources) plus two reskin-owned curations — `donor-tokens.json` and
`donor-modules.md` (§ below). Downstream phases never care which
donor type produced them.

## 1. Live URL (`--donor <url>`)

The proven path — delegate entirely to the existing skill:

```
stardust:extract <content-url> --design-source <donor-url>
```

This captures the donor to `stardust/canon-source/` (pages, assets,
screenshots, `_brand-extraction.json`, `_crawl-log.json`, descriptive
`DESIGN.md`/`DESIGN.json`) and stamps `state.json.designSource`.
Everything in extract applies unchanged — bot-management fallback,
consent dismissal, vision verification, the default 5-page cap.
Widen the cap when the donor's module vocabulary looks thin: more
donor pages = more modules for the mapping brief to map onto (and
the ≥80% gate to clear).

### Bounded direct sampling (the token-evidence recipe)

`donor-tokens.json` values are **computed-style strings**, and the
extract crawl's artifacts are descriptive, not exhaustive — curating
the token sheet almost always needs raw `getComputedStyle` values
from the pinned reference page(s) that no shipped artifact contains.
Don't re-crawl for this and don't eyeball values: sample the N key
donor pages (the pinned reference page per module family — usually
1–3 pages) with a throwaway playwright script, project-local like the
gate scripts. Per page, after the usual load + lazy-scroll + settle:

- **body** — `backgroundColor, color, fontFamily, fontSize,
  lineHeight, fontWeight` → palette pageBg/bodyFg + type.body +
  the family token string;
- **first h1 and h2** — `fontSize, lineHeight, fontWeight,
  letterSpacing, color, textTransform` → type.display / type.h2;
- **candidate buttons** — every `a, button` in the first viewport
  with a real footprint (width > 40, height > 24) and a non-transparent
  `backgroundColor`; record tag, classes, trimmed text, and
  `backgroundColor, color, borderRadius, padding, fontSize,
  fontWeight, border, boxShadow` → buttons.primary/secondary (mind
  the composite-button trap, § donor-tokens.json below);
- **containers** — elements whose `maxWidth` computes to
  700–1500px; tally the values and take the modal one →
  layout.containerMaxWidth;
- **bands / sections** — the first ~10 `section`-level elements'
  `paddingTop, paddingBottom, backgroundColor` → sectionPaddingY +
  band palette;
- **accent links** — `a` whose color differs from body color →
  palette.accent;
- **a full-page screenshot** per sampled page — module-vocabulary
  evidence and the eyeball surface (mind the inner-scroll trap,
  § Screenshot trap below).

Record each sampled page in `donor-tokens.json`'s `curatedFrom` — the
values' provenance is the sampled page, exactly like crawl-derived
values.

### Screenshot trap: inner-scroll / fake-viewport donors

Some donors scroll an **inner container**, not the body — app-shell
sites, and at the extreme a whole "desktop OS" chrome where the page
is a window inside a fake viewport (the smoke's donor did exactly
this). `fullPage: true` sizes the shot from `body.scrollHeight`, so
it silently collapses to one viewport and your module-evidence
screenshots cover only the fold. Check before trusting any donor
shot: if `document.body.scrollHeight` ≈ the viewport height while
the page obviously continues, find the inner scroll container
(`overflow-y: auto|scroll` with `scrollHeight > clientHeight`) and
either scroll *it* while capturing stitched viewport slices, or
expand its height to `scrollHeight` before a single shot. A
fold-only screenshot poisons `donor-modules.md` — modules below the
fold never enter the vocabulary and the mapping ratio starves.

## 2. Local static prototypes (`--donor-dir <path>`)

Static HTML prototypes (claude-design, Mobirise, Relume, Lovable, v0,
Figma-derived hand-coded pages) are a live site that isn't being
served yet. Serve them and run the exact same path:

```bash
# 1. Serve the directory (any static server; python3 ships everywhere)
python3 -m http.server 8793 --directory <path> &

# 2. Verify it renders (a browser-visible check, not just a 200)
#    open http://localhost:8793/  — or curl -sI http://localhost:8793/

# 3. Same capture path as a live donor
stardust:extract <content-url> --design-source http://localhost:8793/
```

Recipe notes:

- **No index.html** → extract's discovery has nothing to BFS from.
  List the prototype files explicitly:
  `--design-source http://localhost:8793/ --pages <file,file,...>`
  (slugs per `../../extract/reference/ia-extraction.md`), or add a
  throwaway `index.html` linking every prototype so BFS finds them.
- **Relative assets** must resolve — serve from the prototypes' own
  root so `./assets/…` paths work (the same rule as
  `../../diff/SKILL.md` § Run it applies to serving prototypes).
- **Provenance**: record in `canon-source/_crawl-log.json` (a
  `notes` field is enough) that the donor origin is a localhost
  serve of `<path>` — a future re-capture needs the directory, not
  the dead localhost URL. The `state.json.designSource.url` will be
  the localhost origin; add the directory path alongside it.
- **Port hygiene**: kill the server when the capture ends; a stale
  server on the port silently serves an old donor to a re-run.

## 3. Figma (`--donor-figma <url>`) — FUTURE, contract defined

**Not implemented.** When a user asks for a Figma donor, say exactly
what SKILL.md § Inputs prescribes (export as static HTML →
`--donor-dir`, or a live staging URL → `--donor`) and stop. Do not
improvise a partial capture from Figma screenshots.

The adapter contract, so round-2 implements against a fixed shape —
it must produce the same `canon-source/` artifacts as the other two
donor types:

| Figma source | Maps to | Canon-source artifact |
|---|---|---|
| Variables (color collections) | palette roles | `_brand-extraction.json#palette` → `DESIGN.json` colors |
| Text styles | type ramp (families, sizes, weights, line-heights) | `_brand-extraction.json#type` → `DESIGN.json` typography |
| Effect styles / corner radii on components | motifs (shadows, radii) | `_brand-extraction.json#motifs` |
| Frame screenshots (per top-level frame) | vision references | `canon-source/assets/screenshots/<frame-slug>.png` — the module vocabulary evidence and the side-by-side eyeball surface |
| Components / component sets | module vocabulary candidates | rows in `donor-modules.md` |

Provenance class: **`figma-mcp`** — every derived value cites the
Figma node id it came from, and `canon-source/_crawl-log.json`
records `fetchTechnique: "figma-mcp"` in place of a crawl. Pages
have no `renderedBy: "playwright"` — the adapter is exempt from the
live-render contract but must say so explicitly per artifact, not
silently. One gap the contract acknowledges: Figma has no computed
styles, so `donor-tokens.json` values are authored from
variables/text styles rather than sampled — the probe still works
because the tokens are exact strings either way.

## Pin one reference page (hard rule)

Real donors run **multiple design systems concurrently** — a
redesigned homepage next to older product pages (the validation
donor: radius 4px / 1266px / weight-300 display on the homepage;
pill radius / 1080px on `/payments`). Aggregating tokens across them
produces a chimera no live page ever shipped, and the design-adoption
probe then asserts against nothing.

When donor pages disagree on a token: pick **ONE donor reference page
per module family**, take every token from it, and demote the other
pages to corroboration (shadows/radii sampling is fine; primary
tokens are not). Record the pick in `donor-tokens.json` —
`curatedFrom` + a `note` naming the reference page and what the
demoted pages contributed. Locale differences on the donor
(geo-served language) are irrelevant to token capture; note and move
on.

## donor-tokens.json — the probe-able token sheet

`stardust/reskin/donor-tokens.json`, curated by the agent in Phase 1
from `canon-source/DESIGN.json` + `_brand-extraction.json` + raw
computed styles. Every value is a **computed-style string** the
Phase 5 probe can assert verbatim (`rgb(…)`, `px` values, the exact
font-family string). The shape (paths are what
`scripts/donor-probe.mjs`'s default spec reads; extend freely — extra
keys feed `--spec` assertions):

```json
{
  "donor": "<origin or dir>",
  "curatedFrom": "<evidence trail>",
  "note": "<the pinned reference page + what other pages contributed>",
  "palette": {
    "pageBg": "rgb(255, 255, 255)", "headingFg": "rgb(…)", "bodyFg": "rgb(…)",
    "mutedFg": "rgb(…)", "accent": "rgb(…)", "accentHover": "rgb(…)",
    "darkBandBg": "rgb(…)", "darkBandFg": "rgb(…)", "lightBandBg": "rgb(…)"
  },
  "type": {
    "family": "<exact computed font-family string>",
    "familyNote": "<licensing: adopted as token string with local fallback>",
    "display": { "fontSize": "56px", "lineHeight": "1.1", "fontWeight": "300", "letterSpacing": "-0.02em" },
    "h2": { }, "h3": { }, "h4": { },
    "body": { "fontSize": "18px", "lineHeight": "28px", "fontWeight": "300" },
    "eyebrow": { "fontSize": "15px", "fontWeight": "425", "color": "rgb(…)", "style": "<casing idiom note>" }
  },
  "layout": { "containerMaxWidth": "1266px", "containerPadding": "0 32px", "sectionPaddingY": "96px", "navHeight": "76px", "grid": "<prose note>" },
  "buttons": {
    "primary":   { "background": "rgb(…)", "color": "rgb(…)", "borderRadius": "4px", "padding": "15.5px 24px 16.5px", "fontSize": "16px", "fontWeight": "400" },
    "secondary": { }
  },
  "radii": { "card": "6px", "media": "8px", "button": "4px" },
  "shadows": { "cardResting": "…", "cardFloating": "…" },
  "motifs": [ "<prose: the donor's signature gestures — gradient heroes, arrow-suffixed links, band rhythm>" ]
}
```

`motifs` and other prose fields are for the renderer and the eyeball
judgment, not the probe — the probe only reads paths its spec names.

**The composite-button trap.** Donor primary buttons are often TWO
elements: an outer `<a>` carrying border/shadow/radius with
`padding: 0px`, and an inner `<span>` carrying the padding,
background, and label (the smoke's donor). Sampling "the button"
naively yields `padding: 0px` and a token sheet the probe asserts
against nothing real. Convention: **flatten the composite into one
probe-able spec** — take each property from the layer that actually
paints it (padding/bg from the inner span, border/shadow/radius from
the outer `<a>`), record the flattening in the button's spec as a
note, and have the renderer emit a single `.btn` element carrying
the flattened values. The probe asserts the flattened spec on
`.btn`; it never needs to know the donor used two elements.

## donor-modules.md — the enumerated module vocabulary

`stardust/reskin/donor-modules.md` — the closed set the mapping brief
maps onto. One row per module:

```markdown
| # | Module | Where seen | Description |
|---|--------|-----------|-------------|
| M1 | Gradient hero | home top (screenshot slice ref) | anatomy: display headline + lede + primary/secondary CTA + media object right… |
```

Rules:

- **Evidence-bound**: every module cites the donor screenshot
  (`canon-source/assets/screenshots/…`) it was observed in. No module
  enters the vocabulary from memory of what the donor "probably has".
- **Anatomy, not vibes**: the description names the slots the module
  carries (eyebrow / heading level / body / CTA kind / media) —
  that's what the mapping brief matches slot anatomy against.
- **Closed set**: Phase 3 maps onto these ids only; anything else is
  an explicit new-module entry (`reference/mapping-brief.md`
  § Status semantics).
- End with a **notes-for-reskin** line capturing the donor's idiom
  (casing conventions, link suffix glyphs, band rhythm) — the
  renderer's cheat sheet.
