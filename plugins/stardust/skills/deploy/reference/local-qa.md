# Local QA before deploy (no DA) — full text

Full text of the deploy skill's Local QA section. Read:
- § Local QA — before the first harness render: why `aem up --html-folder` is not a preview, how to build the harness;
- § Gates — before any DA push: whole-page round-trip, edit-mode simulation, pixel parity, `qa-gate.mjs`;
- § Local-QA scope boundary — before concluding anything about CLS, `content-diff` or chrome overrides locally (#101);
- § Capture, eyeball, drives, wide viewport — when screenshotting or driving interactive blocks (#19, #23, #28, #13).

## Local QA before deploy (no DA)

`aem up --html-folder content` is **not** a reliable way to preview new pages: it serves repo files statically and only renders a path through the full pipeline if that path is already in the remote routing index — brand-new paths 404 on the rendered route. To verify decoration locally, build a **self-contained harness** and open it through the dev server (which serves repo code at its real paths):

```bash
# 1. dev server (serves /scripts, /styles, /blocks, /fragments at their real paths)
npx -y @adobe/aem-cli up --no-open --port $(node skills/replica/scripts/port.mjs harness) &   # per-project 3100–3199 slot, never 3000; build-harness writes the identity marker

# 2. harness — use the committed helper (do NOT hand-roll the metadata strip, #46):
#    it removes the metadata block by balanced tag-counting and rewrites absolute
#    /img/ URLs to root-relative (#43), then emits the full harness doc.
node skills/deploy/scripts/build-harness.mjs content/<path>.html stardust/.work/harness/page.html   # .work/ is gitignored via stardust/.gitignore
```

Open `http://localhost:3000/stardust/.work/harness/page.html` — `scripts.js` runs `loadPage()` (which adds `body.appear`, decorates, and loads sections), blocks load from the code origin, chrome loads via the `header`/`footer` blocks fetching `/nav` and `/footer`. Screenshot / inspect with headless Chrome (`--virtual-time-budget=9000 --screenshot` / `--dump-dom`) or Playwright.

## Gates — round-trip, edit-mode simulation, qa-gate

**Before any DA push, run the whole-page round-trip gate (#94)** — `block-roundtrip.mjs` with no `--blocks` (all blocks, DA-free): it catches cross-block drops a per-block run can miss (a section head absorbed by the wrong block, an instance-count mismatch between authored blocks and prototype sections). Its `--ew` pass (default on) is the whole-page **Experience Workspace editability gate**: 0 dead texts outside declared `@ew-exempt`, 0 duplicated indices. This gate plus `davids-model-lint` exit 0 is the DA-write bar: once both are clean, PUT + preview the branch before any harness pixel iteration — the preview URL goes in the first status line, and the same gates re-run on the preview origin as the gate.

**Then the edit-mode simulation (Step 8 § contract)** — `node skills/deploy/scripts/ew-editability-probe.mjs --content content/<page>.html --simulate-editor --verbose`: it performs the workspace's editor swap on every surviving text and reports font-family/size/weight, line-height and colour drift per text plus the per-block height delta. Target: no drift, block height Δ ≤ 2 px. Drift means a class sits on the authored element or its spans, or a `>`/`:first-child` path — move the selector to wrapper-descendant form (EW2). `render-harness.mjs --ew --simulate-editor` screenshots the same state for eyeballing (it hides `body > header`, so tall-block element shots are not polluted by a sticky header).

**Pixel parity of the published render before/after an editability conversion** — when converting an already-shipped block to the move-based pattern, capture element screenshots of every block instance at 1440 with `body > header` hidden and live-widget iframes excluded, convert, re-shoot, `pixelmatch` = 0 per instance. The gate must never trade fidelity for editability (a 27-instance conversion shipped 0 px difference).

**Then run the stock QA gate — do NOT hand-roll a probe script (#101):**

```bash
node skills/deploy/scripts/qa-gate.mjs http://localhost:3000/stardust/.work/harness/page.html \
     --schema stardust/eds-schema/<page>.json     # exit 0 required
```

Served identity comes first: the marker `build-harness.mjs` wrote to `stardust/.work/harness/marker.txt` (or `--marker <s>`) must be on the served page — exit 4 = not ours, no verdict; with neither the run prints `identity: not asserted` and continues. The URL is the one positional argument; every value flag refuses a following `--flag` (usage, exit 2).

One run asserts the whole decoration contract: runtime booted (`body.appear`), exactly one `<h1>` with nothing nested (#35/#55), all blocks `loaded` and rendering non-empty, zero pageerrors/broken images, schema unit counts rendered (the 1-of-N segmentation collapse, #48/#52/#62), `generic-with-structure` (a default-content schema section with interactive or ≥ 2-column facts rendering as prose — FAIL; the recorded `defaultContent.reason` / `dynamicsRow` prints ⚠ — `audit-and-naming.md` § 2b), `h1Section` (the `<h1>` still in its authored section — FAIL when `runtime-contract.json#autoBlocks` names a builder, else WARN), and the wide-1600 wrap check (#13, as warnings to cross-check). The full-bleed pass — the inverse of #13: a template-level `max-width` cap squeezing a full-bleed wrapper prints as a warning with the measured widths (Step 3 § template escape) — derives its block list from block CSS (`max-width: none` on the block or its wrapper); `--full-bleed <block,block>` overrides. Interactive drives (#28) are the one thing you still write by hand. Before the harness, `node skills/deploy/scripts/block-lint.mjs blocks/ scripts/scripts.js` exits 0 (runtime-order facts: builder CSS, double image collection, fragment re-decoration — `block-js-scaffold.md` § Runtime order).

## Local-QA scope boundary (#101)

**Local-QA scope boundary (#101) — three things deliberately NOT verified against the harness, because three e2e runs showed they cost time and produce false confidence locally:**
- **CLS: deployed-URL ONLY.** Harness assets are local and instant — a real page measured 0.0007 locally vs 0.134 live (#100). Never conclude CLS from the harness.
- **`content-diff` (advisory): deployed-URL ONLY (Step 10).** With `block-roundtrip` green it finds nothing locally BY CONSTRUCTION (same classifier, same DOM); its only value is the DA-transport summary on the live page. Pre-running it against the harness is pure cost. (The pixel `visual-diff` probe is retired — see Step 10.)
- **Per-page chrome overrides (`nav:`/`footer:` metadata)** — `render-harness` resolves them from `content/` with `--fragments`; the dev-server harness still cannot, so the deployed URL confirms them.

## Capture, eyeball, drives, wide viewport

**Capture at a real viewport and scroll — not one giant window (#19).** A `min-height:100vh` hero becomes *window-tall* under a huge capture window (e.g. 7800px), pushing its centered content far down and off the top crop — it looks like the hero text vanished. Instead, use Playwright at a normal viewport (e.g. 1440×900) and `scrollIntoView()` each section before each screenshot.

**The visual eyeball happens on the DEPLOYED page, not the harness (#23, #105, e2e benchmark).** The local harness is for the automated gates only (`qa-gate`, `block-roundtrip`); do NOT do the prototype↔harness full-page eyeball here — the dev-server harness serves the wrong chrome (reverse-proxy); the local harness emulates the pipeline (`pipeline-mimic.mjs`, counts printed per run; `reference/pipeline-facts.md` § Local emulation) and its number stays provisional — only the published gate counts (A116), one reconcile round is budgeted (A61). The load-bearing visual comparison is Step 10's DEPLOYED full-page eyeball (desktop + mobile), the only place the remaining blind spots (font swap, real chrome) become visible. Programmatic checks still miss what the eye catches (header alignment, intentional `<br>`, heading **weight**, a section's **background/color**) — so save that eyeball for the deployed page.

**Image reads** follow `../../stardust/reference/context-hygiene.md` § Image reads: numbers first, then a band crop; never the stitched capture whole.

**Drive interactive blocks and assert state changes (#28).** For any interactive block, don't stop at the static render — Playwright-drive each control and assert the result: click a selector/tab → expect the active item / filtered count to change; submit an invalid form → expect the error text; submit a valid one → assert the visible state changed (e.g. a balance went `$4,862.13 → $3,862.13`, a confirmation appeared). Run the same drive against the **deployed** preview too — block JS that worked in the harness can still trip on CSP or a missing dependency live. One playback drive per video/embed block: the `<video>` must advance (`currentTime` ≥ 0.5 s) or the vendor playback request must return < 400 — the `video-plays` shape of `../../dynamics/scripts/dynamics-check.mjs`; a poster that renders is not playback.

**Wide-viewport layout check (#13).** Always QA at a **wide** viewport (≥1600px), not just 1440 — a missing max-width container is invisible where the 1320 max ≈ the viewport. `qa-gate.mjs` runs this pass automatically (its second-viewport warnings); cross-check each flag against the prototype — full-bleed is correct only where the prototype section has no inner max-width wrapper.
