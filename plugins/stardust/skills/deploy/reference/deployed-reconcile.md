# Step 10 — Reconcile on the DEPLOYED URL (full text)

Full text of deploy Step 10. Read:
- § Step 10 — after a page is `deployed`: what the atomic contract already proved, the QA-scope note;
- § The six reconcile checks — served-check first (gate after the origin serves the round), then the per-page procedure: content-diff summary, deployed eyeball, CLS probe, chrome crop gate (#115), ≥1920 box check (#116), geometry-fix hygiene (#117);
- § Running content-diff — the commands and the fixed-asset URL grep (#44);
- § Reading content-diff — how to triage its flags (#78);
- § Scope — when to hand over to the site-wide `qa` sweep or the rollout fix loop instead.

## Step 10 — Reconcile on the DEPLOYED URL (content-diff ADVISORY + eyeball + CLS)

After deploy, reconcile the EDS page against the source prototype on the **DEPLOYED URL only** (#78, #101). The load-bearing *automated* deployed gates already ran in the per-page atomic-delivery contract: the **computed-style guard** (grids compute `grid`, blocks decorated, 0 broken imgs, 0 pageerrors — the silent grid→block scoping collapse) and the **`.plain.html` verify** (one `<h1>`, 0 `about:error`, authored img/alt count). Step 10 adds a structural summary, an eyeball, a CLS probe, a chrome crop gate, and a wide-viewport box check on top. When the replica pixel gate re-runs on the deployed origin (`skills/replica/scripts/gate.sh`, regime `published-origin`), a live reference older than `GATE_REF_MAX_AGE_H` (24 h) is re-probed before the compare and recaptured on `LIVE DRIFT` — an event on the round record (`liveDrift{}`), never a residual; the rollout report's `Live drift` line counts those recaptures and the masks kept.

> **QA-scope note (e2e benchmark, 5 pages).** Across the benchmark the real defects were caught by
> `block-roundtrip` (A6, pre-deploy, in-block content), the computed-style guard + `.plain.html`
> (grid/section-layout + image landing), the deployed eyeball (harness blind spots), and the deployed
> CLS probe. `content-diff` produced **zero unique catches** (its per-node 🔴 was systematically
> false on auto-generated href schemes and typography), and the pixel `visual-diff` probe was
> **retired** (0 unique catches; its flags were lazy-load-timing artifacts and object-fit
> false-positives needing separate refutation). So `content-diff` is now an **advisory summary**, not
> a blocking gate, and the deployed eyeball is the load-bearing visual check.

## The six reconcile checks

**Gate only after the origin serves what you shipped.** Run the checks below only after `node skills/deploy/scripts/served-check.mjs <css-or-js-url> --same-as <local-file> --wait 180` exits 0 for every block CSS/JS the round touched (served bytes equal the file you pushed) and `served-check.mjs <page-url> --grep '<marker>' --wait 180` exits 0 for the page — a gate run earlier measures yesterday's code; the wait is the helper's capped poll, never `sleep N; <gate>`. Exit 124 is no verdict (the cap expired: re-run or check the Code Sync POST), exit 1 is served-but-wrong; neither is a gate result.

**1. `content-diff` — advisory structural summary (`skills/diff/scripts/content-diff.mjs`).** Extracts an ordered, role-classified inventory ({heading, eyebrow, cta+href, body}) from each `<main>` (computed-style + tag, so the prototype's `.ds-*` DOM and the EDS block DOM compare symmetrically) and diffs them. **Read the SUMMARY line first** — a large per-role or `img` count delta is a fast dropped-section signal. Treat its per-node `MISSING`/`ROLE SWAP` findings as **advisory leads to verify by eye**, NOT auto-blocking: `block-roundtrip` (#94, A6) already gated in-block content fidelity with the same classifier PRE-deploy, so a Step-10 🔴 that #94 did not show is either a real DA-transport reshape (a stripped tag, an unwrapped `<p>` #79, a flattened row #50/#62 — fix it) **or** a known false-positive class (auto-generated TOC/anchor href schemes; verbatim-vs-authored typography — now largely folded out by apostrophe/quote/ellipsis/dash normalization in the classifier). Confirm which by eye before acting; the script exits 0 (advisory) regardless.

**2. Deployed full-page eyeball, desktop + mobile (#23/#105) — the load-bearing visual check.** Open the DEPLOYED page (NOT the harness — it serves the wrong chrome) at two viewports and compare to the prototype. This is the only step that catches the two blind spots left after the harness's pipeline emulation (`reference/pipeline-facts.md` § Local emulation): font-swap effects and the real chrome. Per-section shots only where a probe/gate flagged (roundtrip 🟡, qa-gate warn, fingerprint group) or for bespoke/cinematic sections.

**3. CLS probe on the DEPLOYED URL (#100/#101).** Run the CLS probe with the woff2/nav fetches delayed to reproduce the slow-network swap; target < 0.1. Deployed-only by construction (a harness CLS number is meaningless — local assets load instantly). This is the only step that catches font-fallback-metric shift (compute the fallback `size-adjust` from the **measured rendered width ratio**, not `xAvgCharWidth` alone — a wrong value shipped CLS 0.60 on a benchmark page) and late-chrome shift.

**4. Chrome crop gate — header + footer bands at ≥98% (#115).** The full-page pixel bar dilutes the chrome: header/footer are a small share of page pixels but carry disproportionate visual weight, and they repeat on EVERY page of the rollout — two field runs shipped full-page-green pages whose chrome measured only 93–97% match (hand-drawn lookalike icons, wrong micro-weights, off-by-10px nav rows all pass a ≤10% full-page bar). Crop reference vs deployed (the reference side is the live original in replica/migration flows, the prototype in redesign flows) at the header band (y `0..nav-height`) and the footer band (bottom footer-height rows) over the same stitched captures and hold each to **≤2% diff**: `node skills/replica/scripts/crop-compare.mjs live.png deployed.png --y 0 --height <nav-h>` (then the footer band with `--y <docH-footerH>`; pass `--y-b` for a per-side offset when doc heights differ by a few px — otherwise a ±1px delta contaminates the footer crop with a false full-band diff). Run it once per template at minimum — chrome is shared, so one failing band means every page ships it. **Diagnose with styles before iterating pixels:** `node skills/replica/scripts/chrome-parity.mjs <reference> <deployed> --region header=header --region footer=footer` pairs the chrome's text elements and prints only the computed-style, rect, button-box and icon deltas (one field run: an italic note, a regular-vs-bold link, a wrong link colour, a 97×40 vs 71×32 button and six missing icons in one pass) — clear those, then let the crop gate confirm. A chrome band over the 2 % bar that is not a defect cites a residual class id from `../../replica/reference/source-fidelity-gate.md` § Residual classes (e.g. `glyph-antialiasing`) in the page's ledger entry — never prose alone.

**5. Wide-viewport box check at ≥1920 (#116).** Both standard gate widths render a frozen `width: 720px` and an authored `width: 50%` byte-identically — a computed-style lift that recorded the resolved px instead of the sizing MODEL diverges only on wider screens (recorded: live hero card 940px at 1920 vs a frozen 720px; the CTA row wrapped as a side effect). Sample the text-bearing elements' x/width at ≥1920 on live and deployed and compare — a box-map spot check, no full pixel gate needed. Compare the same DOM tier: EDS section wrappers are full-width by design and false-flag against live INNER containers. On a mismatch, the fix is upstream — re-lift the authored rule (`%`/`vw`/max-width model) per `replica/reference/recreation-procedure.md` § Lift the sizing MODEL. Sample section heights and overlaps too, at one intermediate width (1280 or 1680): a fixed-px hero that live scales with the viewport is identical at 1440 and visibly off at 1512 (recorded) — encode it vw-proportional (`px@1440 ÷ 14.4`).

**6. Geometry-fix verification hygiene (#117).** One field "parity verified" claim was wrong three ways at once; when verifying any geometry fix: (a) probe the **rule-bearing element**, not a heuristic match ("white column wider than 400px" happened to select a different box than the one carrying the lifted rule) — pair the element the fixed rule targets on the build with the element whose source rule was lifted on live; (b) verify **serving cache-free** — a reviewer's DevTools showed the old rule at its old line number while both hosts already served the fix; check out-of-band with `node skills/deploy/scripts/served-check.mjs <css-url> --grep '<new-rule>'` (served assets are gzip; the helper decodes, prints `last-modified`/`age` and the grep count — never grep a bare `curl` body) and re-render in a **fresh headless context**, telling any human reviewer to hard-refresh before re-judging; (c) a reviewer's screenshot encodes their zoom — **back-compute their CSS viewport** from any element with a known percentage rule (a card at 851px under `width: 50%` → viewport 1702px) and reproduce THAT viewport headlessly; judged at face value their numbers contradicted a correct fix, reproduced at 1702 live and build matched to the pixel.

The retired `visual-diff` classes are covered elsewhere: stretched images by the `img { height:auto }` reset (#36) + eyeball; dropped max-width wraps by the qa-gate wide-viewport pass (#13); blank/broken renders by the computed-style guard; imagery gaps by the `.plain.html` img/alt count (#75) + eyeball.

## Running content-diff

`content-diff` is stack-agnostic via `skills/deploy/scripts/diff-profiles.mjs` (`--profile eds | generic`); it shares the role classifier with `block-roundtrip`/`section-schema` in `skills/deploy/scripts/content-inventory.mjs`.

```bash
# Prereq: a RENDERABLE prototype. Static → serve from its own dir so relative
# ../assets resolve. JSX → pre-render first (#24/#27).
( cd <prototype-dir> && python3 -m http.server 8791 & )
# verify the port is YOURS first (lsof -nP -iTCP:8791 -sTCP:LISTEN); prefer a
# per-project port — a stale server from another project makes the diff below
# silently measure a foreign prototype

# Structural content + typography diff — ADVISORY summary. Use the DEPLOYED EDS URL
# so blocks are decorated; a raw content .plain.html has no roles to classify.
node skills/diff/scripts/content-diff.mjs \
  "http://localhost:8791/<prototype>.html" \
  "https://<branch>--<repo>--<owner>.aem.page/<path>" \
  --profile eds   # --json to dump both inventories; exits 0 (advisory)
```

`content-diff` shares its role classifier + profiles with `block-roundtrip`/`section-schema`
(`skills/deploy/scripts/content-inventory.mjs`, `diff-profiles.mjs`); `--profile generic` for non-EDS builds.

**Also still run the standalone fixed-asset URL grep (#44)** — independent of any probe:
`grep -rn "http://localhost\|aem\.page/img\|aem\.live/img" blocks/` MUST be empty. Block JS/CSS that injects fixed imagery (logos/icons/watermarks) must reference assets root-relative `/img/...`; an absolute origin passes local QA (the dev server is localhost:3000) but 404s in every real environment.

## Reading content-diff (#78)

**Reading `content-diff` (advisory leads, #78):**
- **The summary line first** — per-role + `img` counts on each side; a large delta is the fast dropped-section signal. This was the most reliable part of the probe in the benchmark.
- **`MISSING CTA/HEADING/EYEBROW` / `ROLE SWAP`:** an advisory lead, not an auto-block. If `block-roundtrip` (#94) was green pre-deploy, a fresh finding here is EITHER a DA-transport reshape (segmentation drop #76, unwrapped `<p>` #79, flattened row #50/#62 — real, fix the decode) OR a known false-positive (auto-generated href schemes; residual typography). **Verify by eye on the deployed page** before changing code.
- **`MISSING BODY` / `EXTRA` (🟡):** body prose dropped, or EDS copy with no proto source — usually a prototype placeholder legitimately rewritten. Confirm it's intended.
- **`FONT FORK` (🟠):** matched lines whose rendered FACE differs (width probe). `proto X→sys` = the prototype named X but fell back to system; EDS self-hosting the intended fallback is CORRECT (#77). Short-string forks (single-word headings, numerals) are width-probe noise — confirm against the deployed eyeball before acting.

Confirm the deployed eyeball is faithful and the CLS probe is < 0.1; the content-diff summary + the atomic-contract computed-style guard + `.plain.html` are the automated backstops. The flag lists double as a regression checklist — a new silent regression is worth adding both a fix AND a gate signal.

## Scope — per-page reconcile vs the site-wide sweep

**Step 10 is a per-page, during-conversion reconcile against the PROTOTYPE — not the whole-site sweep.** For a comprehensive post-rollout check of the DEPLOYED site against its extraction capture + visual baselines (routing, content fidelity, template conformance, rendered integrity, metadata/SEO, links, accessibility, performance budgets), read-only sweep of what shipped → the stardust `qa` skill; fix loop at site scale (template sample → class rounds → per-page tail → one confirmation sweep against preview) → the rollout skill's `../../rollout/reference/sweep-protocol.md`. Step 10 stays per-page against the prototype; both sit after it. The two are complementary: Step 10 asks "does this converted page match its prototype?", the stardust `qa` skill asks "is everything that shipped across the site actually correct?" — different reference, scope, and phase; they share no code.
