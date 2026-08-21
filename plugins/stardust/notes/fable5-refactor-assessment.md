# Stardust Fable 5 Refactor — Session Assessment

**Date:** 2026-07-02 · **Branch:** `fable5-refactor` · **Versions:** 0.14.0 → 0.14.2

The stardust plugin was authored with/for Opus 4.8. This session reviewed it
top to bottom, refactored it for Fable 5 (a more capable model), added three
new capabilities, and validated the whole surface end-to-end on **seven live
websites** — six paused mid-run on a spend limit and resumed on Opus, plus
stardust.style on Fable. All seven deployed to real AEM Edge Delivery pages.

---

## 1. The core thesis and whether it held

**Thesis:** the plugin's design-quality ceiling was capped by *generator*
guardrails written so a weaker model wouldn't wander — a deterministic MD5
"divergence seed" roll and closed creative catalogs. A stronger model does
better with **real reference research** than with injected entropy. Keep the
*detector* half (anti-slop lists, cream-ground hex test, reflex-font list) as
cheap validators; replace the generator half with grounded research.

**Held.** Refero reference-research fired at **tier 1 on all seven sites** and
materially shaped each redesign (decade/craft/register + the improvements list)
while Mode A kept palette and type pinned to the captured brand. Every redesign
reads a clear decade newer while staying unmistakably its own brand. This is
the single biggest quality change and it is now the default path, with the seed
roll demoted to a fallback/convergence-tiebreaker.

---

## 2. Improvements made (the refactor)

### Design quality
- **Reference-grounded direction** — new shared procedure
  `skills/stardust/reference/reference-research.md` (Refero MCP → WebSearch →
  seed fallback ladder). `direct` now researches real category references and
  records them as `picked_by: "reasoned: <anchor>"` with citations; the seed
  roll is the fallback, not the default.
- **Mode A+ brand-adjacent refinement tier** — a sanctioned middle between
  Mode A's hard pins and `--rebrand`: evidence-gated same-classification body
  face upgrade and single-role palette recolor (each requires an improvements
  -list citation). This is where "dramatically better while honoring the
  brand" actually lives for a median mediocre source.
- **Opened creative catalogs** — the what-if candidate list, non-template move
  bank, and motion registers became worked exemplars with an evidence-shaped
  **extension rule** (a novel move is admissible with the same citation shape),
  not closed sets.
- **Palette library reframed as an anchor bank** — the model derives a full
  role-ramped, AA-validated palette from an anchor instead of being restricted
  to five scraped hexes (determinism moved to the contrast math, not taste).

### Fidelity & safety
- **Vision gates** — extract Phase 2.5 (screenshot-verify each captured page
  against the record, re-capture on mismatch) and prototype Phase 2.5 (judge
  the proposed render against the source screenshot).
- **Runtime-contract detection** in deploy (AuthorKit vs vanilla), **atomic
  per-page delivery contract**, **DA_TOKEN lifecycle preflight**.
- **rollout hardening** — foundation-first gate, per-template headless render
  check, link-audit completeness, query-index resilience.
- **prepare-migration Phase 4.5** — dynamic-blocks pre-import gate (Tier 1/2/3
  metadata contract before bulk import).

### Performance & structure
- **Concurrency contracts** — state.json merge-by-slug with documented parallel
  lanes; crawl.mjs worker-pool concurrency; A-first-then-parallel variants.
- **Fixed the parallel-authoring drift** — 10 review findings (contract
  contradictions, dangling refs, real crawl.mjs bugs) all resolved before the
  first commit.

---

## 3. New capabilities

| Capability | What it is | Validated |
|---|---|---|
| **`stardust:audit`** | One URL → 7-dimension scorecard (brand-expression, hierarchy, conversion, a11y, technical-SEO, LLM-visibility, performance) + prioritized findings + craft-rendered `report.html` + uplift-shaped closing directions. Optional Refero benchmarking, marketing-skills / modern-web-guidance / PageSpeed integration with graceful degradation. | ✅ ran on stardust.style: 68/100, 22 findings (5 P1/8 P2/9 P3), Refero benchmarks (Langbase/Eraser/Metaview), report.html craft-rendered + validated. audit.json matches the designed schema exactly. |
| **Cross-site same-brand** | `extract --brand-source <url>` (sibling-property enrichment) and `--design-source <url>` (design-donor mode, formalizing the canon.com pattern); sibling-site discovery; `origins[]` provenance. `direct` pins to the donor surface and can amplify traits captured on a sibling. | ✅ implemented + wired; not exercised in the E2E set (single-origin runs). |
| **Hands-off production mode** | Folds the external 298-line master migration prompt into the skills as enforced gates. `--hands-off` (or an explicit phrase): every interactive gate auto-resolves from captured evidence, quality gates never weaken, hard blockers still stop. | ✅ ran end-to-end on all 7 sites. |
| **Learnings + status contracts** | `stardust/learnings.md` per-run ledger and `stardust/status.jsonl` deterministic progress surface (the stardust app wanted the latter; no model-emitted milestones). | ✅ status.jsonl written by every skill; ~109 learnings captured across sites. |
| **modern-web-guidance consult** | prototype/audit query the Chrome-team guides for scroll/motion/CWV/modern-CSS best practices when the plugin is installed. | ✅ wired, optional. |

---

## 4. Test results — 7 sites, 13 pages, all live

Every page returns 200 on both the `.aem.page` (preview) and `.aem.live`
(production) trees of the test project
`github.com/paolomoz/stardust-plugin-refactor-fable`, each on its own branch
and DA folder. Diff verdict faithful/clean on all.

| Site | Model | Pages deployed (aem.page) | Diff | Highlight |
|---|---|---|---|---|
| **hirslanden.ch** | Fable | `/hirslanden/` | 0 structural | multilingual healthcare; 4 AA/nav defects caught by gates |
| **3m.com** | Opus | `/3m`, `/3m/abrasives` | faithful | recovered from a broken extract state **without re-crawling** an Akamai-walled site |
| **sliccy.com** | Opus | `/sliccy/`, `/sliccy/man/git` | 0 structural | hero demo **video reproduced** (static + reduced-motion fallback) |
| **virginatlantic.com** | Opus | `/virginatlantic`, `/virginatlantic/where-we-fly/north-america/usa/new-york` | 1 defect fixed | **anti-fabrication caught + dropped an invented section** at render |
| **festool.com** | Opus | `/festool/`, `/festool/products/saws` | 1 inline CTA caught | Usercentrics shadow-DOM consent; listing → real wayfinding |
| **theroadhome.org** | Opus | `/theroadhome/home`, `/theroadhome/get-help` | 8/8 headings, 0 dropped | nonprofit; **crisis/donation IA fully preserved** |
| **stardust.style** | Fable | `/stardust-style/`, `/stardust-style/docs` | clean + SEO/LLM green | **audit-first**; validated both 0.14.2 fixes live |

Base URL pattern: `https://test-<site>--stardust-plugin-refactor-fable--paolomoz.aem.page/<path>`

stardust.style audit report: `stardust/audit/stardust-style/report.html` (craft-rendered).

### What the gates caught (that nothing else would have)
- **Vision gate** — silent capture/render gaps on 3 sites (festool's `opacity:0`
  above-fold hero; sliccy's invisible demo video the record said didn't exist).
- **Anti-fabrication** — dropped an invented "atlantic-promo" section on
  virginatlantic that the shape brief had mislabeled `captured-verbatim`.
- **`stardust:diff` structural probe** — real content/decode defects (dropped
  CTAs, quote→heading role swaps) on all 6 EDS sites that the atomic
  `.plain.html` and pixel checks passed green. Strongest single argument for
  wiring diff into the deploy loop.

### The two 0.14.2 fixes, validated live on stardust.style
- **migrate canon auto-bootstrap** — status log: *"canon auto-bootstrapped from
  index (hands-off, Setup step 4)"*. On the six prior sites every agent had to
  bootstrap canon by hand; here it was automatic.
- **computed-layout gate** — status log: *"computed-layout gate pass (9
  decorated blocks/page, all index grids grid)"* — the assertion that would
  have caught 3m's silently-stacked layout.

---

## 5. Learnings loop

109 raw ledger entries → **42 distinct issues** after dedup (full digest:
`notes/e2e-learnings-consolidated.md`). The three blocking multi-site issues
were folded into the plugin this session (0.14.1 + 0.14.2):

1. **migrate canon dead-end** (4/6 sites) → auto-bootstrap from first approved
   prototype.
2. **authorkit bootstrap bricking on `main` drift** (2 sites) → transactional
   ordering + refuse unpinned default.
3. **silent stacked-layout ship** (the `.plain.html`-green-but-broken class) →
   headless computed-layout assertion in the atomic contract.

Plus 0.14.1 extract fixes confirmed by the runs: `_provenance` emission,
apex→www origin adoption, Usercentrics shadow-DOM consent, video/iframe
capture, and the playwright preflight guidance (`--no-save --legacy-peer-deps`
+ copy-to-project ESM resolution) that every run had paid for by hand.

### Confirmed wins (by sites confirming)
- Atomic DA deploy contract — 5 · Refero reference-research tier-1 — 5·
  hands-off pipeline end-to-end — 7 · Phase 2.5 vision gate — 3 ·
  `stardust:diff` structural probe — 6 · canon reuse across templates — 3 ·
  bot-management fallback ladder — 2 · anti-fabrication render catch — 1.

---

## 6. Backlog (documented, not yet folded)

From the consolidated digest, the highest-value remaining items:
- **Fold the mandatory capture fields into `crawl.mjs`** (heroHeadline, font
  intercept, forms, per-section style summary) so runs stop re-implementing a
  ~600-line extension. (4 sites)
- **Validator-enforce shape-brief lineage/voice against the page JSON** — make
  Discipline 1/5 mechanical substring checks so a brief cannot self-report
  `captured-verbatim` on invented copy. (high-leverage; virginatlantic)
- **Reconcile migrate's asset-rewrite vs portability contradiction**
  (depth-relative rewrite). (3 sites)
- **Wire `stardust:diff` into the deploy loop** as a per-page gate (it caught
  what nothing else did on every EDS site).
- Bundle a known-good `postlcp.js` as a deploy skill asset (removes the
  author-kit drift dependency entirely).
- Cross-site same-brand and the audit `--deploy` path are implemented but not
  yet exercised on a live multi-property run.

### Known caveats on the deployed pages
- A few sites self-hosted proprietary fonts (Metropolis, HarmoniaSans/DIN,
  Gotham, 3MCircular) for fidelity — each raised a licensing alert; confirm
  embedding rights before any production publish.
- Motion registers were selected but rendered static on most runs (the
  cinematic layer is opt-in); stardust.style produced an `index-cinematic.html`
  but migration ships the static prototype per contract.

---

## 7. Bottom line

The refactor is committed on `fable5-refactor` (0.14.0 → 0.14.2, ~40 files).
The design-quality thesis is validated: reference-grounded direction plus Mode
A pinning produces demonstrably better redesigns that stay on-brand, on seven
independent sites. Three new capabilities ship (audit, cross-site brand,
hands-off mode) and the audit skill self-validated against its own schema on a
live run. The pipeline runs fully hands-off from URL to deployed AEM page, and
the new safety gates (vision, anti-fabrication, computed-layout, diff) each
caught real defects the old text-level checks passed. The learnings loop is
closed: the runs' own findings became plugin fixes in the same session.

Ready to merge `fable5-refactor`; stardust.style is deployed to the test
project for you to move to production.
