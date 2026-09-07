# Stardust improvement plan — harvest of rwe.com + centene.com sessions (2026-08-26/27)

**How to use this doc:** start a session with working directory
`/Users/paolo/stardust/source/260826/skills` (repo root, branch `main`) and work
the tiers in order. Every item is self-contained: evidence, target file, exact
change, risk, and acceptance check. All paths below are repo-relative.

## Inputs

- RWE ledger: `/Users/paolo/stardust/2026-08/rwe/rwe/stardust/learnings.md` (items RWE-1…12)
- Centene ledger: `/Users/paolo/stardust/2026-08/centene/centene/stardust/learnings.md` (items CEN-1…12)
- Reference implementation for RWE-1/2/3: `/Users/paolo/stardust/2026-08/rwe/rwe/scripts/replica/stitch-shot.mjs`
  (a modified copy of `plugins/stardust/skills/replica/scripts/stitch-shot.mjs`, +86 lines, commented; verified working in that session)

## Selection principles (agreed with Paolo)

1. **General improvements only.** Nothing site-specific ships. Items that
   generalize to a *class* of sources (e.g. "any AEM-classic site", "any
   bootstrap-era grid") qualify; single-site quirks do not.
2. **Conservative: low-risk × high-impact beats high-impact alone.**
   Doc-only additions and additive fallbacks first. Changes that alter existing
   behavior (shared classifier semantics, default ports, capture strategy) are
   deferred to a guarded tier with an explicit validation protocol, or dropped.
3. **Cross-session recurrence is the strongest signal.** Three failures
   recurred independently in both sessions (port collision, consent banners,
   live embeds) — those are Tier 1.

---

## Tier 1 — Recurred in BOTH sessions (do first; doc-only or additive)

### 1.1 Consent dismissal: visible-button text-match fallback
- **Evidence:** RWE-4 ⇄ CEN-2. Two different consent widgets (RWE custom
  dialog; centene cookieconsent `a.cc-btn`) were missed by the selector list.
  On centene the banner baked into ground truth AND repeated at all 7 stitch
  seams → 32% false pixel diff, one gate round invalidated.
- **Target:** `plugins/stardust/skills/extract/scripts/crawl.mjs`,
  `dismissConsent()` (~line 271).
- **Change (additive — runs only when the existing selector pass matched
  nothing):** scan visible `button, a, [role="button"]` elements for an exact,
  short-text match on Accept / Accept all / Allow all / Agree / OK / Decline /
  Alle akzeptieren / Accepter — click the first hit. Keep the length guard
  tight (≤ ~25 chars, visible, in a fixed/overlay container) so it can never
  hit an in-content link.
- **Risk:** low. Fallback only; existing selectors keep priority. Worst case =
  same behavior as today (banner stays).
- **Accept when:** the existing crawl selectors still fire on OneTrust/TrustArc
  test pages, and a synthetic page with only a text-labelled consent button
  gets dismissed.

### 1.2 Gate identity assertion — never diff an unverified localhost URL
- **Evidence:** RWE-11 ⇄ CEN-1. Identical incident, opposite directions: a
  stale `:8791` server from another stardust project served a foreign site into
  a gate round (73% diff misread as "prototype broke"; on centene the RWE
  prototype was measured as "the build"). Every skill doc suggests the same
  port, so cross-project collision is guaranteed on a shared machine.
- **Targets:**
  - `plugins/stardust/skills/replica/scripts/gate.sh` — before diffing, fetch
    the prototype URL and assert it contains a page-specific marker (the
    `<slug>` from the filename is already in the URL path; assert the fetched
    HTML title/body contains it, or accept a `--marker <string>` arg). Exit
    loudly with the `lsof -nP -iTCP:<port> -sTCP:LISTEN` owner on mismatch.
  - `plugins/stardust/skills/replica/SKILL.md` (~line 181),
    `plugins/stardust/skills/replica/reference/source-fidelity-gate.md` (~line 35),
    `plugins/stardust/skills/deploy/SKILL.md` (~line 820),
    `plugins/stardust/skills/diff/SKILL.md` (~line 49) — one added line each
    where `8791` is suggested: "verify the port is yours first
    (`lsof -nP -iTCP:8791 -sTCP:LISTEN`); prefer a per-project port."
- **Change is additive:** do NOT change the documented default port (11 files
  reference it; churn + retraining cost outweighs benefit). The assertion makes
  the collision loud instead.
- **Risk:** low. A false assertion failure is a 1-line marker fix; a missed
  collision today costs a full gate round.
- **Accept when:** gate.sh against a deliberately wrong server exits non-zero
  naming the process; against the right server it proceeds unchanged.

### 1.3 recreation-procedure.md: two new permanent-residual classes
- **Evidence:** RWE-12 ⇄ CEN-3 (live embeds, confirmed in both sessions) and
  RWE-12 (randomized decorative positions).
- **Target:** `plugins/stardust/skills/replica/reference/recreation-procedure.md`
  (residual-classes area, near the existing permanent-residual guidance at
  ~lines 155–187 and the class list at ~line 371).
- **Change (doc-only):** add two entries:
  1. **Live-data embeds** (stock tickers, YouTube, euroland-style widgets):
     the winning move is loading the SAME live embed (same src) on both sides
     so the data cancels out in the pixel diff — not freezing a snapshot.
     Centene's same-src YouTube iframe canceled to zero.
  2. **Randomized decorative elements** (inline positions regenerated per page
     load, e.g. generative line art): class-level permanent residual; log it,
     don't chase it.
- **Risk:** none (reference doc).

---

## Tier 2 — Single-session but general; additive script hardening

### 2.1 Capture freeze: pause videos + neutralize JS timers
- **Evidence:** RWE-1. The CSS-only freeze stops neither `<video>` playback nor
  slick-style autoplay timers — ~20% of the RWE page was video noise; every
  capture grabbed different frames/slides.
- **Target:** `plugins/stardust/skills/replica/scripts/stitch-shot.mjs`
  (freeze block, ~line 193). **Port from the RWE reference implementation**
  (path in Inputs) rather than rewriting.
- **Change:** after settle + CSS freeze: pause every `<video>` and seek `t=0`;
  clear all pending timeouts/intervals. Symmetric — applied identically to both
  sides of a diff, so it cannot bias the comparison.
- **Risk:** low-medium. Instrument change, but symmetric and already proven in
  a real session. Clearing timers *after* settle can't starve lazyload (settle
  already ran).
- **Accept when:** two consecutive captures of a video-heavy page are
  pixel-identical in the video regions; a static page's capture is unchanged
  vs current main.

### 2.2 Carousel t=0 determinism
- **Evidence:** RWE-3. Autoplay advances during settle → slide identity
  arbitrary per capture. Clicking the first slick-convention dot after the
  freeze (transitions frozen → instant reset, symmetric) took residual 4% → 0.8%.
- **Target:** same file/block as 2.1; also in the RWE reference implementation.
- **Change:** after freeze, click the first element matching the slick dot
  conventions (`.slick-dots li:first-child button` and equivalents) when
  present. No-op on pages without carousels.
- **Risk:** low. Convention-scoped selector; symmetric; no-op otherwise.
- **Accept when:** repeated captures of a slick-carousel page show the same
  slide; non-carousel pages byte-identical to pre-change captures.

### 2.3 Favicon on bounded extracts: cheap capture + loud skip
- **Evidence:** CEN-4. `--single`/`--pages` extracts skip Phase 3 (brand
  surface) where favicon capture lives; deploy's favicon step then skips
  *silently* ("never invent one") — deployed site ships the default icon.
- **Targets & change (two halves, both additive):**
  1. `plugins/stardust/skills/extract/scripts/crawl.mjs`: on the entry page,
     read `link[rel~="icon"]` (fall back to `/favicon.ico`) and fetch it to
     `stardust/current/assets/favicon.<ext>` — one cheap request, runs in all
     modes.
  2. `plugins/stardust/skills/deploy/SKILL.md` Favicon step (~line 308) and
     final checklist (~line 947): change the silent skip to a loud warning —
     "no favicon captured: WARN and record in the deploy log; likely a bounded
     extract."
- **Risk:** low. One extra fetch; doc line.
- **Accept when:** `--single` extract of any site yields
  `assets/favicon.<ext>`; deploy without one prints the warning.

### 2.4 Deploy Step 3 (foundation) — two new warnings, one new pattern
- **Evidence:** CEN-7, RWE-6, RWE-7. All bit silently with green text gates.
- **Target:** `plugins/stardust/skills/deploy/SKILL.md`, Step 3 foundation
  section (~line 275) and the #81 chrome-reservation passage (~line 282).
- **Change (doc-only), three additions:**
  1. **box-sizing:** the boilerplate ships no global `border-box`. Any
     %-width + padding grid ported from a bootstrap-era source silently wraps
     every column (centene: cards 2+1, 2-col bands stacked, footer wrapped,
     +1731px doc height — all text gates green). Foundation should add the
     reset (or, minimum, warn when block CSS uses `width: N%` + padding).
  2. **Block-internal `<header>`:** boilerplate
     `header { height: var(--nav-height) }` collapses every semantic
     `<header>` a block emits (natural when porting prototypes; broke all such
     blocks at once on RWE). Scope the reservation to `body > header`, or warn
     against `<header>` in block DOM.
  3. **Overlay chrome pattern (#81 gap):** transparent header floating over
     the hero → `--nav-height: 0` + absolute header, no reservation needed
     (measured CLS 0.0004 with this pattern on RWE).
- **Risk:** none-to-low. Additions 2's *code* variant (scoping the stock CSS
  selector) would touch the boilerplate contract — ship the doc warning now;
  scoping change only if the boilerplate is already being edited for #1.

### 2.5 Deploy brief template + gate procedure — two cheap guards
- **Evidence:** RWE-9 (mobile override loses to desktop *variant* specificity
  regardless of media query — centene's `feature`/`panel` variants have exactly
  this shape, so it WILL recur on multi-variant rollouts) and RWE-10
  (byte-identical differing-pixel count after a "fix" = the rule was a no-op;
  a burned gate round).
- **Targets:** `plugins/stardust/skills/deploy/SKILL.md` brief template
  (~line 562) — add "mobile overrides must match variant specificity
  (`.cards.color .card-list` beats `.cards .card-list` in ANY media query)";
  gate/iteration guidance — add "before counting an iteration, verify the fix
  changed the render: an unchanged differing-pixel count means a no-op rule."
- **Risk:** none (doc-only).

---

## Tier 3 — Reference-doc batch (low individual impact, zero risk; ship as one commit)

All doc-only; each generalizes beyond its source site.

| # | Evidence | Target | Addition |
|---|----------|--------|----------|
| 3.1 | CEN-8 | `deploy/SKILL.md` images→background-LAYER rule | Never copy the pipeline's fallback `<img src>` into CSS `background` — it's the 750px rendition; rewrite `width=2000`. `<picture>`-rendered images unaffected. |
| 3.2 | CEN-9 | `deploy/SKILL.md` | `<picture>` wrapper adds an inline baseline descender (+6/7px per image paragraph vs bare `<img>` source); `line-height: 0` on the image paragraph restores parity. |
| 3.3 | CEN-10 | `deploy/SKILL.md` | Pipeline drops whitespace-only authored content (`<p>&nbsp;</p>`, trailing `<br>&nbsp;`): model those live line boxes as block CSS, never authored whitespace. |
| 3.4 | CEN-6, CEN-11 | `replica/reference/recreation-procedure.md` + `deploy/SKILL.md` | `display: flow-root` reproduces clearfix margin containment (fixed −48/−20px per-section errors in one rule); un-floating columns in a media query loses the float's BFC — add `flow-root` to the mobile override. |
| 3.5 | CEN-5 | `replica/reference/recreation-procedure.md` | AEM-classic richtext byte patterns are load-bearing (`<p><br>\r\n </p>` = TWO line boxes; headings lead `<br>`; trailing `&nbsp;` = real line). Mirror byte patterns; diff `innerHTML` when a wrap-count mismatch survives width parity. General to the AEM-classic source class. |
| 3.6 | CEN-12 | `deploy/SKILL.md` block-CSS guidance | A wrapper reset can out-specify the block's own rules (`footer .footer > div` beats `footer .f-root`) — padding silently 0. |
| 3.7 | RWE-5 | `extract/SKILL.md` bot-wall section | Page-level bot walls (Cloudflare challenge) usually do NOT gate assets: media/CSS/fonts return 200 to a browser-UA curl. Say so before reaching for in-page-fetch machinery. |

---

## Deferred — high impact but NOT low risk (needs a decision + validation protocol)

### D.1 Shared classifier: element-boundary separators in textContent joins
- **Evidence:** RWE-8, corroborated on centene (all `append()`-built blocks).
  JS-built DOM concatenates textContent without separators
  ("...MediaLinkedIn...") → mismatch vs live HTML newlines → **13 false reds**
  in one session. Highest-impact single fix in this harvest.
- **Why deferred:** the change lands in the shared classifier
  (`plugins/stardust/skills/diff/scripts/content-inventory.mjs`, textContent
  reads at ~lines 92/100, mirrored in `deploy/scripts/content-inventory.mjs`)
  and alters diff keys **globally** — every round-trip and content-diff
  comparison shifts. A bug here silently green-lights real content losses.
- **If taken up:** normalize at *both* read sites identically (separator at
  element boundaries, then whitespace-collapse) so keys move in lockstep;
  validate by running the eval suite (`plugins/stardust/evals/`, esp.
  `replica-source-fidelity`, `reskin-content-fidelity`) plus a round-trip on
  one existing deployed project before/after — zero verdict changes expected
  on the fixtures.

### D.2 stitch-shot `--fullpage` escape hatch
- **Evidence:** RWE-2. Chunked stitching reproducibly corrupted the last chunk
  (scroll-state header baked into a seam + 720px horizontal wrap). fullPage
  fixed it, but needs three bundled mitigations (entrance-animation final
  state, iframe height locks, `img.decode()`).
- **Why deferred:** it's an alternative capture *strategy*, not a hardening of
  the current one — a bigger behavioral surface than 2.1/2.2, and it was needed
  on one site. The RWE reference implementation exists if a second session
  hits seam corruption; harvest then.

### D.3 Repo-wide per-project port defaults
- Superseded by 1.2 (identity assertion makes collisions loud at near-zero
  cost). Changing the documented port in 11 files is churn without removing
  the underlying failure mode (any port can go stale).

## Explicitly not harvested (site-specific)

None of the 24 ledger items was purely site-specific; the closest (CEN-5
AEM-classic byte patterns) generalizes to a source-CMS class and ships as a
scoped doc note (3.5).

## Suggested execution order

1. Tier 1 (three commits: 1.1 crawl fallback, 1.2 gate assertion + doc lines, 1.3 doc).
2. Tier 2 (2.1+2.2 together — one stitch-shot commit ported from the RWE
   reference; 2.3; 2.4+2.5 as one deploy-doc commit).
3. Tier 3 as a single reference-doc commit.
4. Decide on D.1 separately — it's the highest-impact remaining item but the
   only one that can silently change gate verdicts. Do not bundle it.

After each script change, both learnings ledgers' "Status: pending harvest"
lines should be updated to record what was harvested where.
