# Deploy — Step 10: reconcile on the deployed URL

Part of `../SKILL.md` (the deploy card), which says when to read it. Read by section.

## Step 10 — Reconcile on the DEPLOYED URL (content-diff ADVISORY + eyeball + CLS)

After deploy, reconcile the EDS page against the source prototype on the **DEPLOYED URL only** (#78, #101). The load-bearing *automated* deployed gates already ran in the per-page atomic-delivery contract: the **computed-style guard** (grids compute `grid`, blocks decorated, 0 broken imgs, 0 pageerrors — the silent grid→block scoping collapse) and the **`.plain.html` verify** (one `<h1>`, 0 `about:error`, authored img/alt count). Step 10 adds a structural summary, an eyeball, a CLS probe, a chrome crop gate, and the content-cap row on top.

> **QA-scope note (e2e benchmark, 5 pages).** Across the benchmark the real defects were caught by
> `block-roundtrip` (A6, pre-deploy, in-block content), the computed-style guard + `.plain.html`
> (grid/section-layout + image landing), the deployed eyeball (harness blind spots), and the deployed
> CLS probe. `content-diff` produced **zero unique catches** (its per-node 🔴 was systematically
> false on auto-generated href schemes and typography), and the pixel `visual-diff` probe was
> **retired** (0 unique catches; its flags were lazy-load-timing artifacts and object-fit
> false-positives needing separate refutation). So `content-diff` is now an **advisory summary**, not
> a blocking gate, and the deployed eyeball is the load-bearing visual check.

**1. `content-diff` — advisory structural summary (`skills/diff/scripts/content-diff.mjs`).** Extracts an ordered, role-classified inventory ({heading, eyebrow, cta+href, body}) from each `<main>` (computed-style + tag, so the prototype's `.ds-*` DOM and the EDS block DOM compare symmetrically) and diffs them. **Read the SUMMARY line first** — a large per-role or `img` count delta is a fast dropped-section signal. Treat its per-node `MISSING`/`ROLE SWAP` findings as **advisory leads to verify by eye**, NOT auto-blocking: `block-roundtrip` (#94, A6) already gated in-block content fidelity with the same classifier PRE-deploy, so a Step-10 🔴 that #94 did not show is either a real DA-transport reshape (a stripped tag, an unwrapped `<p>` #79, a flattened row #50/#62 — fix it) **or** a known false-positive class (auto-generated TOC/anchor href schemes; verbatim-vs-authored typography — now largely folded out by apostrophe/quote/ellipsis/dash normalization in the classifier). Confirm which by eye before acting; the script exits 0 (advisory) regardless.

**2. Deployed full-page eyeball, desktop + mobile (#23/#105) — the load-bearing visual check.** Open the DEPLOYED page (NOT the harness — the harness serves the wrong chrome and applies no server-side section-metadata styling) at two viewports and compare to the prototype. This is the only step that reliably catches the harness blind spots the benchmark exposed: `<picture>`+`<img>` media-drops (#72 — invisible to the bare-`<img>` harness), un-buttonized multi-CTA paragraphs (`decorateButtons` doesn't run in the harness), server-side section-metadata layout, and font-swap effects. Per-section shots only where a probe/gate flagged (roundtrip 🟡, qa-gate warn, fingerprint group) or for bespoke/cinematic sections.

**3. CLS probe on the DEPLOYED URL (#100/#101).** Run the CLS probe with the woff2/nav fetches delayed to reproduce the slow-network swap; target < 0.1. Deployed-only by construction (a harness CLS number is meaningless — local assets load instantly). This is the only step that catches font-fallback-metric shift (compute the fallback `size-adjust` from the **measured rendered width ratio**, not `xAvgCharWidth` alone — a wrong value shipped CLS 0.60 on a benchmark page) and late-chrome shift.

**4. Chrome crop gate — header + footer bands at ≥98% (#115).** The full-page bar dilutes the chrome, which repeats on every page (`../../replica/reference/source-fidelity-gate.md` § Pass bar). Crop reference vs deployed (the reference side is the live original in replica/migration flows, the prototype in redesign flows) at the header band (y `0..nav-height`) and the footer band (bottom footer-height rows) over the same stitched captures and hold each to **≤2% diff**: `node stardust/scripts/replica/crop-compare.mjs live.png deployed.png --y 0 --height <nav-h>` (then the footer band with `--y <docH-footerH>`; pass `--y-b` for a per-side offset when doc heights differ by a few px — otherwise a ±1px delta contaminates the footer crop with a false full-band diff). Run it once per template at minimum — chrome is shared, so one failing band means every page ships it. **Diagnose with styles before iterating pixels:** `node stardust/scripts/replica/chrome-parity.mjs <reference> <deployed> --region header=header --region footer=footer` pairs the chrome's text elements and prints only the computed-style, rect, button-box and icon deltas — clear those, then let the crop gate confirm. **The bands are the header at rest; its behaviour is the header contract** (`../../diff/SKILL.md` § The header contract): explore the deployed header at 1440 and 390 and `chrome-compare` it against the contract; exit 2 blocks the foundation like a failing band.

**5. Content-cap row on the deployed URL (#116 → #124).** Both gate widths are narrower than most caps, so a dropped container cap or a resolved-px lift diverges only on wider screens. Run `node stardust/scripts/replica/cap-probe.mjs <live> --against <deployed-url> --design DESIGN.json --slug <slug> --label deployed` once per template: PASS required (every live cap held within ±20 px by kind, nothing capped only on the build). A ✗ is a sizing-rule fix on the scaffold or the block wrap (Step 3), re-lifted per `replica/reference/recreation-procedure.md` § Lift the sizing MODEL — never a pixel nudge.

**6. Geometry-fix verification hygiene (#117).** One field "parity verified" claim was wrong three ways at once; when verifying any geometry fix: (a) probe the **rule-bearing element**, not a heuristic match ("white column wider than 400px" happened to select a different box than the one carrying the lifted rule) — pair the element the fixed rule targets on the build with the element whose source rule was lifted on live; (b) verify **serving cache-free** — a reviewer's DevTools showed the old rule at its old line number while both hosts already served the fix; check out-of-band with `curl --compressed <css-url> | grep '<new-rule>'` (block CSS is gzip-encoded — a bare `curl | grep` scans binary and silently matches nothing) and re-render in a **fresh headless context**, telling any human reviewer to hard-refresh before re-judging; (c) a reviewer's screenshot encodes their zoom — **back-compute their CSS viewport** from any element with a known percentage rule (a card at 851px under `width: 50%` → viewport 1702px) and reproduce THAT viewport headlessly; judged at face value their numbers contradicted a correct fix, reproduced at 1702 live and build matched to the pixel.

**7. All-pages published-origin gate at delivery (#125).** Step 10 is per page; once the roster is deployed, run `node stardust/scripts/replica/gate-all.mjs` (project root, through `run-bg.mjs`). DELIVERED = pixel % ≤ 10 AND |Δh| ≤ 5 % AND 0 clipped text / controls AND 0 MISSING / HIDDEN links / headings — a recorded page passed the pixel bar with every card clipped and its links hidden by a fixed-height `overflow: hidden` block. `clip.json` groups name the clipper (fix that block's CSS); `content.json` HIDDEN = CSS, MISSING = encoder. Rules: `../../replica/reference/source-fidelity-gate.md` § The all-pages published-origin gate.

The retired `visual-diff` classes are covered elsewhere: stretched images by the `img { height:auto }` reset (#36) + eyeball; dropped max-width wraps and the outer cap by the qa-gate wide pass (#13/#124); blank/broken renders by the computed-style guard; imagery gaps by the `.plain.html` img/alt count (#75) + eyeball.

`content-diff` is stack-agnostic via `skills/deploy/scripts/diff-profiles.mjs` (`--profile eds | generic`); it shares the role classifier with `block-roundtrip`/`section-schema` in `skills/deploy/scripts/content-inventory.mjs`.

```bash
# Prereq: a RENDERABLE prototype. Static → serve from its own dir so relative
# ../assets resolve. JSX → pre-render first (#24/#27). ONE server, ONE port —
# probe before starting one (curl is always present, lsof is not):
curl -sI localhost:8791/ | head -1                   # 200/404 = something serves the port; no line = free
curl -sI localhost:8791/<prototype>.html | head -1   # 200 = it serves YOUR dir: reuse it
command -v lsof >/dev/null && lsof -nP -iTCP:8791 -sTCP:LISTEN   # optional: names the pid
( cd <prototype-dir> && python3 -m http.server 8791 & )   # only when nothing answered
# Answers but not your file → a foreign server: never kill a listener you did not
# start; prefer a per-project port — a stale server from another project makes the
# diff below silently measure a foreign prototype. `lsof … || echo free` is not a
# probe — without lsof it prints "free" beside a live listener (recorded: a second
# server on the same port died at once and the round chased 404s).

# Structural content + typography diff — ADVISORY summary. Use the DEPLOYED EDS URL
# so blocks are decorated; a raw content .plain.html has no roles to classify.
node stardust/scripts/diff/content-diff.mjs \
  "http://localhost:8791/<prototype>.html" \
  "https://<branch>--<repo>--<owner>.aem.page/<path>" \
  --profile eds   # --json to dump both inventories; exits 0 (advisory)
```

`content-diff` shares its role classifier + profiles with `block-roundtrip`/`section-schema`
(`skills/deploy/scripts/content-inventory.mjs`, `diff-profiles.mjs`); `--profile generic` for non-EDS builds.

**Also still run the standalone fixed-asset URL grep (#44)** — independent of any probe:
`grep -rn "http://localhost\|aem\.page/img\|aem\.live/img" blocks/` MUST be empty. Block JS/CSS that injects fixed imagery (logos/icons/watermarks) must reference assets root-relative `/img/...`; an absolute origin passes local QA (the dev server is localhost:3000) but 404s in every real environment.

**Reading `content-diff` (advisory leads, #78):**
- **The summary line first** — per-role + `img` counts on each side; a large delta is the fast dropped-section signal. This was the most reliable part of the probe in the benchmark.
- **`MISSING CTA/HEADING/EYEBROW` / `ROLE SWAP`:** an advisory lead, not an auto-block. If `block-roundtrip` (#94) was green pre-deploy, a fresh finding here is EITHER a DA-transport reshape (segmentation drop #76, unwrapped `<p>` #79, flattened row #50/#62 — real, fix the decode) OR a known false-positive (auto-generated href schemes; residual typography). **Verify by eye on the deployed page** before changing code.
- **`MISSING BODY` / `EXTRA` (🟡):** body prose dropped, or EDS copy with no proto source — usually a prototype placeholder legitimately rewritten. Confirm it's intended.
- **`FONT FORK` (🟠):** matched lines whose rendered FACE differs (width probe). `proto X→sys` = the prototype named X but fell back to system; EDS self-hosting the intended fallback is CORRECT (#77). Short-string forks (single-word headings, numerals) are width-probe noise — confirm against the deployed eyeball before acting.

Confirm the deployed eyeball is faithful and the CLS probe is < 0.1; the content-diff summary + the atomic-contract computed-style guard + `.plain.html` are the automated backstops. The flag lists double as a regression checklist — a new silent regression is worth adding both a fix AND a gate signal.

**Step 10 is a per-page, during-conversion reconcile against the PROTOTYPE — not the whole-site sweep.** For a comprehensive post-rollout check of the DEPLOYED site against its extraction capture + visual baselines (routing, content fidelity, template conformance, rendered integrity, metadata/SEO, links, accessibility, performance budgets), use the read-only **the stardust `qa` skill** skill after `rollout`. The two are complementary: Step 10 asks "does this converted page match its prototype?", the stardust `qa` skill asks "is everything that shipped across the site actually correct?" — different reference, scope, and phase; they share no code.
