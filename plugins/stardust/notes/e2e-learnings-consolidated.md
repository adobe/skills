# Cross-site E2E learnings — stardust Fable 5 refactor (6 sites)

Sites: **hirslanden**, **3m**, **sliccy**, **virginatlantic**, **festool**, **theroadhome**. All runs 2026-07-02, hands-off mode.
Source: 6 ledgers, ~109 raw entries. After dedup: **42 distinct pending issues** (16 systemic/multi-site + 26 single-site) and **~14 win/observation classes**.

---

## 1. Ranked pending fixes (by cross-site frequency)

Systemic issues only (hit ≥2 sites), most-frequent first. Single-site issues are in §3.

| # | Issue (one line) | Skill/file + section | Sites hit | Severity | Proposed fix (one line) |
|---|---|---|---|---|---|
| 1 | Playwright not preinstalled; `npm i playwright` fails ERESOLVE on aem-boilerplate eslint peers | skills/extract/SKILL.md § Setup / prerequisites | hirslanden, 3m, sliccy, virginatlantic, festool, theroadhome (6) | high (blocks crawl start) | Preflight `require.resolve('playwright')` from project root; remediate with `npm i --no-save --legacy-peer-deps playwright` (document sibling-symlink / global-symlink fallback) |
| 2 | Bundled `.mjs` scripts can't resolve playwright from plugin path (ESM resolves from script dir) — must copy to project root; recurs at crawl, vision-gate, mobile-nav, migrate audits, diff, shot | skills/extract, skills/prototype (Phase 2.5/2.7 fixtures), skills/migrate (Phase 3 audits), skills/diff scripts | 3m, sliccy, virginatlantic, festool, theroadhome, hirslanden (6) | high | Add `createRequire(process.cwd())` shim to bundled scripts, or document copy-to-project-root once as a shared bundled-script rule |
| 3 | `crawl.mjs` writes no `_provenance` block (renderedBy/fetchedAt only; no waitMs/waitMode/httpStatus) — violates its own SKILL live-render contract; `validateProvenance()` would reject every page | skills/extract/scripts/crawl.mjs (capturePage/writer, ~L410) | 3m, sliccy, virginatlantic, theroadhome (4) | high | Emit `_provenance:{renderedBy,fetchedAt,waitMs,waitMode,httpStatus,finalUrl}` as first key; thread `resp.status()` + measured wait out of capturePage |
| 4 | `crawl.mjs` capture() covers ~1/4 of the mandatory recipe/schema (no heroHeadline/heroLede, font intercept, forms, per-section styles, videos/iframes, landmarks, resolves flags) — every run re-implements it by hand | skills/extract/scripts/crawl.mjs capture(); reference/current-state-schema.md + playwright-recipe.md | 3m, sliccy, virginatlantic, festool (4) | high | Fold the per-run extensions (festool's crawl-extended.mjs / VA heroHeadline+font+forms+styleSummary + sliccy videos[]/iframes[]) back into the shipped crawler |
| 5 | `migrate` hard-stops unless `DESIGN.json.extensions.canon` + `stardust/canon/{header,footer,canon.css}` exist — but core pipeline (extract→direct→prototype→migrate) and direction.md command sequence never run prepare-migration/`--prep`, so canon is always absent | skills/migrate/SKILL.md § Setup steps 3-4; skills/stardust/SKILL.md pipeline; skills/direct command-sequence | hirslanden, sliccy, virginatlantic, festool (4) | **blocking** | When canon absent but ≥1 approved prototype exists, auto-derive canon inline (same write-back as prototype --prep); OR insert prepare-migration as an explicit pipeline step |
| 6 | `resolves` probe (in-page fetch / bare HEAD) gives false-negatives — CORS-blocked cross-origin CDNs and mp4s served text/html on HEAD; migrate would omit/repair nearly every real image | skills/extract/reference/playwright-recipe.md § Capture list 11 (Source-URL fidelity) | 3m, sliccy, festool (3) | high | For `<img>` use `naturalWidth>2` after load (CORS-exempt) as resolution evidence; reserve GET-with-Range (`bytes=0-0`)+UA for backgrounds/srcset; never bare HEAD |
| 7 | Asset rewrite to root-relative `/assets/…` (asset-bundling) directly contradicts migrate Phase-3 portability audit which greps `(href\|src)="/[^/]` as FATAL — the two contracts can't both pass | skills/migrate/SKILL.md § Phase 2/3; reference/asset-bundling.md § Rewrite | virginatlantic, festool, theroadhome (3) | med | Specify depth-relative rewrite (`../`×depth) as the portable form, or gate `/assets/` behind a served-at-host-root profile the audit relaxes — make both docs agree |
| 8 | `direct` Phase 1 "wait for the user's confirmation" + one-shot tuning questions conflict with `state.json.handsOff=true`; no hands-off clause exists | skills/direct/SKILL.md § Phase 1 | sliccy, virginatlantic, theroadhome (3) | med | Add hands-off clause: when handsOff, take each question's documented default, stamp `(default, hands-off)` in direction.md, auto-confirm the plan |
| 9 | `impeccable` PostToolUse hook fires on the brand-review template's own mandated chrome (side-tab left-borders, single captured font, em-dash, numbered markers) — false positives on a descriptive artifact | skills/extract/reference/brand-review-template.md § Styling rules | sliccy, festool, theroadhome (3) | low | Restyle the mandated Components list off side-tab borders, or ship an inline `impeccable-disable` waiver header in the template |
| 10 | Extract "Phase 2.5 vision gate" is referenced by crawl.mjs/reference but absent from the (Skill-tool-served) extract SKILL.md; harness serves a stale revision vs on-disk | skills/extract/SKILL.md (add Phase 2.5); plugin release/skill-cache process | sliccy, festool, virginatlantic (3) | med | Add the Phase 2.5 section to SKILL.md; rebuild skill/tile cache on SKILL.md change; agents treat on-disk SKILL.md as authoritative |
| 11 | `impeccable` detector/hook false-positives on captured brand properties under Mode A (overused-font on pinned family, em-dash on captured voice, numbered-markers on real dates, repeated-eyebrow kicker system) | skills/prototype/SKILL.md § Phase 2.5 auto-dismiss / Discipline 9 captured-verbatim bypass | hirslanden, sliccy, theroadhome (3) | low-med | Extend captured-verbatim/reflexRejectAudit bypass to data-detector rules and declared `DESIGN.json.components[]` (eyebrow); let the hook read a `reflexRejectAudit.bypassed` marker |
| 12 | Consent/geo dismissal misses: runs before late-injected banners, no geo/locale-modal handling, no Usercentrics shadow-DOM traversal, no loose "agree/accept" matcher — pollutes vision-gate screenshots, forces recapture | skills/extract/scripts/crawl.mjs § dismissConsent; reference/playwright-recipe.md § Pre-flight | 3m, virginatlantic, festool (3) | high | Wait ~1.5-2s for late injection; add loose `/agree\|accept/i` text fallback; add geo/locale-gate handling; traverse `#usercentrics-root.shadowRoot`; assert no fixed cookie/privacy element remains pre-shot |
| 13 | `bootstrap-authorkit.mjs` default ref `main` fetches a DRIFTED (block-based `loadBlock(header)`) runtime; the mandatory static-fragment postlcp edit hard-fails AFTER files are deleted, bricking the repo with no rollback | skills/deploy/scripts/bootstrap-authorkit.mjs; deploy/SKILL.md § Runtime bootstrap | hirslanden, virginatlantic (2) | **blocking** | Pin `AUTHORKIT_REF` to a known-good static-fragment commit by default; make the port transactional (stage+swap, roll back on verify fail); bundle known-good postlcp.js as a skill asset |
| 14 | Block decode silently drops the CTA — authored `<strong><a>` arrives without a `<p>` wrapper and decorateButton unwraps the emphasis; `<p>`-scoped/`querySelector('a')` reads return null; passes lint+harness, only content-diff catches it | skills/deploy/SKILL.md § Block JS scaffold (#42/#79) | hirslanden, virginatlantic (2) | high (silent content drop) | Read CTA by cell and match self-OR-descendant (`block.querySelector('a')`, clone `.closest('div')`); ship a hardened `hero` block in a reference set |
| 15 | DA/AuthorKit delivery strips inner author `class=` and flattens nested divs, and the runtime doesn't add a `.block` class — so CSS keyed to author classes / `.<name>.block` silently no-ops; `.plain.html` assertions can't see the layout failure | skills/deploy/SKILL.md § ENCODE contract / Blocks | theroadhome, 3m (2) | high | LOUD up-front rule + worked fixture: author cells as SEMANTIC content only; block `decorate()` rebuilds all presentational DOM/classes; scope CSS under `.<block-name>` only; add a post-deploy screenshot/vdiff to the atomic contract |
| 16 | `content-diff` false-positives: whitespace run-on across element boundaries and curly-vs-straight quotes reported as paired 🔴 MISSING + 🟠 EXTRA | skills/diff/scripts/content-diff.mjs | hirslanden, 3m (2) | low (noise) | Normalize match keys (strip all whitespace; fold typographic punctuation); keep href as primary CTA key; downrank pure-glyph deltas to a single advisory |

---

## 2. Wins confirmed (capabilities that worked, by how many sites confirmed them)

| Capability | Sites confirming | What it caught / did |
|---|---|---|
| Atomic DA deploy contract (PUT 201 → preview 200 → live 200 → `.plain.html` 1×h1/0 about:error/imgs) | hirslanden, sliccy, virginatlantic, festool, theroadhome (5) | Clean end-to-end delivery every deploy; media rehost to DA 201 on first try; caught unwrapped-`<p>` copy drop via deployed-page count probe |
| refero reference-research **tier-1** (MCP loadable via ToolSearch, no fallback) | 3m, sliccy, virginatlantic, theroadhome (4) | On-brief anchors within ≤5 search/≤4 retrieval budget (Peloton/Airbnb/n26/Warp…); n26 Deep Teal #088177 ≈ TRH #008192 — validation the deterministic seed couldn't supply |
| **Phase 2.5 vision gate** catching silent capture/render gaps heuristics missed | 3m, sliccy, festool (3) | Consent+geo overlays over hero (records were clean); zero-media record vs on-screen demo video; missing hero headline; invisible Vue form; blank above-fold hero (opacity:0 reveal) that the deterministic detector passed |
| `stardust:diff` structural/content probe catching defects atomic+pixel+harness missed | hirslanden, sliccy, virginatlantic (3) | `.textContent` dropping inline CTAs; band/quote role-swap to `<h2>` inflating outline; dropped hero "Find your flight" CTA — all invisible to decoration/height/grid + pixel checks |
| Hands-off pipeline ran extract→deploy unattended | all 6 (6) | Whole redesign completed without a user (only gap: the direct §1 doc contradiction, §1 #8) |
| Canon reuse across multiple templates (`data-canon`/`data-module`/`data-slot`) | sliccy, theroadhome (2) | home+man-page / home+get-help read as one system; shared chrome transferred verbatim, per-band re-skin kept structure |
| customProps first-party token capture | sliccy, virginatlantic (2) | Complete `--color-*` / `--*-font-size` token sets cited verbatim instead of lossy frequency clustering; caught a `--swiper-theme-color` framework-default leak |
| Bot-management fallback ladder validated | 3m, virginatlantic (2) | 3m = class-2 per-request Akamai needing headed real Chrome (tier 2); VA = Akamai origin crawled headless 6/6 in ~40s (ladder never needed) |
| impeccable design hook catching real defects pre-deploy (deterministic) | 3m (1) | `layout-transition` compositor-thrash (nav underline animating `width`) → fixed to `transform:scaleX()` before any gate ceremony |
| Anti-fabrication catch | virginatlantic (1) | Render-step re-grep of page JSON caught a fully fabricated "atlantic-promo" section falsely labeled captured-verbatim |
| spec-plate fallback pattern | festool (1) | 15/25 saw cards missing renders got captured model-code spec-plates, not stock/placeholder/mismapped photos — grid stayed honest, no imagery invented |

---

## 3. Site-unique findings (one site only — worth keeping)

**skills/extract (crawl.mjs / recipe / schema):**
- 3m: `crawl.mjs` discover() doesn't recurse `<sitemapindex>` — would queue 6 XML files and fail each.
- 3m: wait-mode vocabulary mismatch — recipe `fast|medium|spec` vs crawl.mjs `fast|medium|slow`; `--wait spec` silently falls to medium.
- 3m: extract crash between Phase 2 and 3 leaves `state=extracted` but no `_brand-extraction.json`; no `--consolidate-only` resume seam, so direct hard-stops and forces a full re-crawl of a bot-protected origin.
- sliccy: discovery collapses to 1 page on apex→www redirect (same-origin filter uses pre-redirect origin; sitemap on apex returns the redirect body).
- sliccy: referenced media not saved to `assets/media/` (only screenshots); woff2 fonts not saved either.
- virginatlantic: `crawl.mjs` never sets `prefers-reduced-motion: reduce`; animated h1 captured at opacity:0 → dropped from heading outline; needs post-settle re-query.
- festool: heroHeadline resolver blind to styled-`div` stage headlines (falls to meta fallback) — add largest-visible-font-node candidate ≥28px.
- festool: Vue-managed forms render 6 fields with zero `<form>` elements → forms[] empty; emit synthetic `formless:true` entry when ≥3 inputs sit outside any form.
- festool: catalog/listing pages don't scroll to trigger lazy-load → 15/25 product cards had no captured image; also record per-card image association, not DOM-order guess.
- festool: extract SKILL.md § Phase 4 points at impeccable `reference/teach.md`, which no longer exists in impeccable 3.9.1 — inline the PRODUCT.md section list instead.

**skills/direct:**
- theroadhome: `DESIGN.json.systemComponentRoles.header` ("deep-harbor ground") contradicts the captured WHITE header in the screenshot; direct should cross-check role constraints against the screenshot; under Mode A the screenshot wins.

**skills/prototype (gates / disciplines):**
- hirslanden: contrast probe false-positives on image/gradient grounds (walks to BODY for a solid bg) — spec pixel-sampling or scrim-compositing math; classify nearest-ancestor misses as needs-vision-verify.
- hirslanden: LCP audit selects first-in-DOM image (the 139×40 logo), not the largest above-fold image / PerformanceObserver LCP entry.
- hirslanden: `detect.mjs` advisory noise — functional alpha ramps (scrim stops, hairline families) flagged as undocumented colors; allow a `divergence.functional_ramps[]` declaration.
- festool: side-tab detector fires on a CSS-triangle play glyph (`border-left` with other sides transparent) — exempt the width:0/height:0 triangle idiom.
- festool: reveal-on-scroll gated the above-fold hero to opacity:0 (blank hero) — escalate any JS-gated hidden initial state inside the first viewport band to P0.
- virginatlantic: shape-brief lineage/voice citations (Discipline 1/5) are prose contracts an LLM can satisfy by assertion — make them validator-enforced substring matches against `current/pages/<slug>.json`; the content-sourcing scan must validate literals against the page JSON, never the brief's self-reported classifications.
- theroadhome: substrate-transition cap (Discipline 4) has no carve-out for signature full-bleed color-band-rhythm brands — add a third exemption when the captured signature motif is a band rhythm.

**skills/migrate:**
- hirslanden: `pagemap-audit.mjs` requires `state.json.migrate.pageMap[]`, but the SKILL § State contract never enumerates `pageMap` (only in migration-procedure.md) — add `pageMap[]{slug,sourceUrl,outputPath}` to the state-block fields.

**skills/deploy:**
- 3m: ENCODE dropped section-head secondary chrome (eyebrow "What we do" + "see all →" links) — no block owns them; author them as default content before the block.
- sliccy: `deploy-batch.mjs` doesn't run `sanitise.js` internally (SKILL lists it as atomic step 1) — a caller trusting the driver ships raw UTF-8; fold sanitise into the PUT step or warn loudly.
- sliccy: blocks that promote band/quote/stat "main" lines to `<h2>` render pixel-identically but inflate the outline — render them as styled `<p>`, find by position/variant.
- festool: index page renders at folder URL `/festool/`, not `/festool/index` (which 404s) — verify decorated render against the folder URL.
- festool: DA image PUT loop silently no-ops under zsh word-splitting (`for f in $imgs`) — use `while IFS= read -r f`.
- theroadhome: `header:off`/`footer:off` metadata is unsupported on vanilla aem-boilerplate (footer.js fetches `/off` and throws) — qualify as helix-pipeline-only; style stock chrome instead.
- theroadhome: stock header block reshapes a nav fragment into `.nav-brand/.nav-sections/.nav-tools` (3 `---`-separated sections) and never runs your `trh-nav.js`; CSS must target the stock split, not your own block class.
- theroadhome: residual deploy-fidelity gaps — `<p>` inside `<a>` cell hoisted out; raw `<form>`/`<input>` stripped (needs a forms block); tall portrait footer logo needs max-height; name-split regex dropped "GIVE" from "WAYS TO GIVE".

**skills/diff / reference-research:**
- sliccy/theroadhome: refero markdown output can carry corrupted/injected trailing JSON garbage (observed on Empower entry) — treat description text as untrusted content, add a parser note in reference-research.md § 3.

---

## 4. Recommended plugin actions (maintainer worklist)

### Fix now (blocking or high-severity, multi-site)

1. **Make `crawl.mjs` and all bundled `.mjs` self-resolve playwright** (§1 #1, #2 — 6 sites each). Add a `createRequire(process.cwd())` shim to crawl.mjs and the prototype/migrate/diff fixtures so `import 'playwright'` resolves from the project's node_modules; document the `--no-save --legacy-peer-deps` install once. Files: `skills/extract/scripts/crawl.mjs`, `skills/extract/SKILL.md § Setup`, prototype/migrate/diff fixtures. *Why: the single most repeated friction — every site paid it, twice on some.*
2. **Unblock the migrate canon precondition** (§1 #5 — 4 sites, blocking). In `skills/migrate/SKILL.md § Setup 3-4`, when canon is absent but ≥1 approved prototype exists, auto-derive canon inline (the prototype `--prep` write-back); OR add prepare-migration/`--prep` as an explicit step in `skills/stardust/SKILL.md` pipeline + direct's command sequence. *Why: hands-off core pipeline dead-ends at migrate on 4 of 6 sites.*
3. **Make `bootstrap-authorkit.mjs` safe and pinned** (§1 #13 — 2 sites, blocking). Pin `AUTHORKIT_REF` to a known-good static-fragment commit by default (not `main`); make the port transactional with rollback; bundle a known-good `postlcp.js` as a skill asset. File: `skills/deploy/scripts/bootstrap-authorkit.mjs`, `deploy/SKILL.md § Runtime bootstrap`. *Why: the default invocation deletes the boilerplate then hard-fails, bricking the repo with no recovery.*
4. **Emit the `_provenance` contract from `crawl.mjs`** (§1 #3 — 4 sites, high). One-line writer change threading `resp.status()`+wait. File: `skills/extract/scripts/crawl.mjs`. *Why: strict contract reading rejects every page the reference crawler produces.*
5. **Fold the mandatory capture fields into `crawl.mjs`** (§1 #4 — 4 sites, high). Merge heroHeadline/heroLede, font intercept, forms[] (incl. formless), per-section styleSummary, videos[]/iframes[], landmarks, resolves flags. File: `skills/extract/scripts/crawl.mjs`. *Why: every run re-writes a ~600-line extension the bundled crawler exists to remove.*
6. **Fix the `resolves` probe to naturalWidth for `<img>`** (§1 #6 — 3 sites, high). File: `playwright-recipe.md § Capture list 11`. *Why: CORS/HEAD false-negatives would make migrate omit/repair nearly every real image on CDN-hosted sites.*
7. **Harden consent/geo dismissal** (§1 #12 — 3 sites, high). Late-injection wait, loose agree/accept matcher, geo/locale gate, Usercentrics shadow-DOM traversal, pre-shot assertion. Files: `crawl.mjs § dismissConsent`, `playwright-recipe.md § Pre-flight`. *Why: overlays pollute the vision gate and force full recaptures on bot-protected origins.*
8. **Ship hardened `hero`/CTA block decode + LOUD class-stripping rule** (§1 #14, #15 — 2 sites each, high, silent). Reference block set reading CTA by cell (self-or-descendant) and rebuilding presentational DOM in `decorate()`; add a post-deploy screenshot/vdiff to the atomic contract. Files: `skills/deploy/SKILL.md § Block JS / ENCODE`, reference block set. *Why: silent content/layout drops that pass lint+harness+`.plain.html`; only diff catches them.*

### Backlog (med/low, or single-site)

9. **Add a hands-off clause to `skills/direct/SKILL.md § Phase 1`** (§1 #8 — 3 sites, med): take documented defaults, stamp `(default, hands-off)`, auto-confirm.
10. **Reconcile the asset-rewrite vs portability contradiction** (§1 #7 — 3 sites, med): depth-relative rewrite in `asset-bundling.md` + `migrate/SKILL.md § Phase 3`.
11. **Add the Phase 2.5 section to `extract/SKILL.md` and rebuild the skill cache on change** (§1 #10 — 3 sites, med).
12. **Extend Mode-A / captured-verbatim bypass** to data-detectors and declared `DESIGN.json.components[]`, and let the impeccable hook read a `reflexRejectAudit.bypassed` marker (§1 #11, #9 — 3 sites each, low).
13. **Normalize `content-diff` match keys** (whitespace + typographic punctuation) (§1 #16 — 2 sites, low). File: `skills/diff/scripts/content-diff.mjs`.
14. **Validator-enforce shape-brief lineage/voice against page JSON** (virginatlantic single-site, high-leverage): make Discipline 1/5 mechanical substring checks; the content-sourcing scan grounds on `current/pages/<slug>.json`, never the brief's self-report.
15. Single-site crawler robustness: sitemap-index recursion, apex→www redirect adoption, wait-mode vocab alignment, prefers-reduced-motion, listing lazy-load scroll, styled-div hero resolver, Vue formless capture, media/font download pass, `--consolidate-only` resume seam (§3, various — mostly high-value where they gate capture completeness).
16. Single-site deploy gotchas: sanitise-in-deploy-batch, band/quote-as-`<p>`, index folder-URL verify, zsh `while read` PUT loop, vanilla-EDS header/footer:off + stock-nav-split docs, forms-block note, `<p>`-not-inside-`<a>` rule (§3).
17. Single-site prototype/audit precision: LCP largest-above-fold selection, image/gradient contrast sampling, functional-ramp color declaration, CSS-triangle side-tab exemption, above-fold reveal→P0, band-rhythm substrate exemption, pageMap in migrate state contract (§3).
18. Docs/hygiene: inline PRODUCT.md spec (drop dead impeccable `teach.md` ref), brand-review-template impeccable waiver, refero untrusted-description parser note (§3).
