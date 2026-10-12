# Deploy — local QA before deploy

Part of `../SKILL.md` (the deploy card), which says when to read it. Read by section.

## Local QA before deploy (no DA)

`aem up --html-folder content` is **not** a reliable way to preview new pages: it serves repo files statically and only renders a path through the full pipeline if that path is already in the remote routing index — brand-new paths 404 on the rendered route. To verify decoration locally, build a **self-contained harness** and open it through the dev server (which serves repo code at its real paths):

```bash
# 1. dev server (serves /scripts, /styles, /blocks, /fragments at their real paths)
npx -y @adobe/aem-cli up --no-open &

# 2. harness — use the committed helper (do NOT hand-roll the metadata strip, #46):
#    it removes the metadata block by balanced tag-counting and rewrites absolute
#    /img/ URLs to root-relative (#43), then emits the full harness doc.
node stardust/scripts/deploy/build-harness.mjs content/<path>.html stardust/.work/harness/page.html   # .work/ is gitignored via stardust/.gitignore
```

Open `http://localhost:3000/stardust/.work/harness/page.html` — `scripts.js` runs `loadPage()` (which adds `body.appear`, decorates, and loads sections), blocks load from the code origin, chrome loads via the `header`/`footer` blocks fetching `/nav` and `/footer`. Screenshot / inspect with headless Chrome (`--virtual-time-budget=9000 --screenshot` / `--dump-dom`) or Playwright — to confirm decoration ran, not to judge pixels: the visual verdict is Step 10's, on the deployed page.

**Before any DA push, run the whole-page round-trip gate (#94)** — `block-roundtrip.mjs` with no `--blocks` (all blocks, DA-free): it catches cross-block drops a per-block run can miss (a section head absorbed by the wrong block, an instance-count mismatch between authored blocks and prototype sections). Its `--ew` pass (default on) is the whole-page **Experience Workspace editability gate**: 0 dead texts outside declared `@ew-exempt`, 0 duplicated indices.

**Then the edit-mode simulation (Step 8 § contract)** — `node stardust/scripts/deploy/ew-editability-probe.mjs --content content/<page>.html --simulate-editor --verbose`: it performs the workspace's editor swap on every surviving text and reports font-family/size/weight, line-height and colour drift per text plus the per-block height delta. Target: no drift, block height Δ ≤ 2 px. Drift means a class sits on the authored element or its spans, or a `>`/`:first-child` path — move the selector to wrapper-descendant form (EW2). `render-harness.mjs --ew --simulate-editor` screenshots the same state for eyeballing (it hides `body > header`, so tall-block element shots are not polluted by a sticky header).

**Pixel parity of the published render before/after an editability conversion** — when converting an already-shipped block to the move-based pattern, capture element screenshots of every block instance at 1440 with `body > header` hidden and live-widget iframes excluded, convert, re-shoot, `pixelmatch` = 0 per instance. The gate must never trade fidelity for editability (a 27-instance conversion shipped 0 px difference).

**Then run the stock QA gate — do NOT hand-roll a probe script (#101):**

```bash
node stardust/scripts/deploy/qa-gate.mjs http://localhost:3000/stardust/.work/harness/page.html \
     --schema stardust/eds-schema/<page>.json     # exit 0 required
```

One run asserts the whole decoration contract: runtime booted (`body.appear`), exactly one `<h1>` with nothing nested (#35/#55), all blocks `loaded` and rendering non-empty, zero pageerrors/broken images, schema unit counts rendered (the 1-of-N segmentation collapse, #48/#52/#62), the content cap at DESIGN.json's derived `probeWidth` (#124, FAIL) and the per-block wrap check there (#13, warnings to cross-check). Pass `--full-bleed <block,block>` for the blocks the prototype renders edge-to-edge: the inverse of #13 — a template-level `max-width` cap squeezing a full-bleed wrapper — prints as a warning with the measured widths (Step 3 § template escape). Interactive drives (#28) are the one thing you still write by hand.

**Local-QA scope boundary (#101) — four things deliberately NOT verified against the harness, because three e2e runs showed they cost time and produce false confidence locally:**
- **CLS: deployed-URL ONLY.** Harness assets are local and instant — a real page measured 0.0007 locally vs 0.134 live (#100). Never conclude CLS from the harness.
- **`content-diff` (advisory): deployed-URL ONLY (Step 10).** With `block-roundtrip` green it finds nothing locally BY CONSTRUCTION (same classifier, same DOM); its only value is the DA-transport summary on the live page. Pre-running it against the harness is pure cost. (The pixel `visual-diff` probe is retired — see Step 10.)
- **Per-page chrome overrides (`nav:`/`footer:` metadata): deployed-URL only** — the harness has no pipeline to apply them.
- **Pixel / visual fidelity (replica's source-fidelity gate, the header/footer `crop-compare` bands, the full-page eyeball): deployed-URL ONLY (Step 10).** The harness is for the structural asserts (`qa-gate`, `block-roundtrip`); its pixel numbers are not a verdict — deploy first, judge on the preview origin. A recorded delivery session iterated CSS against a harness pixel diff for its whole budget and delivered no page.

**Capture at a real viewport and scroll — not one giant window (#19).** A `min-height:100vh` hero becomes *window-tall* under a huge capture window (e.g. 7800px), pushing its centered content far down and off the top crop — it looks like the hero text vanished. Instead, use Playwright at a normal viewport (e.g. 1440×900) and `scrollIntoView()` each section before each screenshot.

**The visual eyeball happens on the DEPLOYED page, not the harness (#23, #105, e2e benchmark).** The local harness is for the automated gates only (`qa-gate`, `block-roundtrip`); do NOT do the prototype↔harness full-page eyeball here — the harness serves the wrong chrome (reverse-proxy) and applies no server-side section-metadata styling, so it is unrepresentative and was actively misleading across the benchmark. The load-bearing visual comparison is Step 10's DEPLOYED full-page eyeball (desktop + mobile), which is the only place the harness blind spots (`<picture>`+`<img>` media-drop #72, un-buttonized multi-CTA, section-metadata layout, font swap) become visible. Programmatic checks still miss what the eye catches (header alignment, intentional `<br>`, heading **weight**, a section's **background/color**) — so save that eyeball for the deployed page.

**Drive interactive blocks and assert state changes (#28).** For any interactive block, don't stop at the static render — Playwright-drive each control and assert the result: click a selector/tab → expect the active item / filtered count to change; submit an invalid form → expect the error text; submit a valid one → assert the visible state changed (e.g. a balance went `$4,862.13 → $3,862.13`, a confirmation appeared). Run the same drive against the **deployed** preview too — block JS that worked in the harness can still trip on CSP or a missing dependency live.

**Wide pass at the derived width (#13 → #124).** A cap wider than the viewport is invisible, so `qa-gate.mjs --design DESIGN.json` resizes to DESIGN.json's derived `probeWidth` (never a fixed 1600 or 1920 — a probe at a cap's own width cannot see it), FAILS when the content cap does not hold within ±20 px of `containerMaxWidth` (or when the build caps a fluid source), then warns per block whose content runs past `--maxw`; cross-check each warn against the prototype — full-bleed is correct only where the prototype section has no inner max-width wrapper.
