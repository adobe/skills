# Changelog

This file starts at 0.14.0. Prior versions (0.3.0 – 0.13.1) are documented in
git history only (plus the branch-scoped notes in
`CHANGELOG-redesign-adobecom.md` and `CHANGELOG-delivery-media-fidelity.md`).

## 0.18.5 — migration-flow routing: replica subsumes prepare-migration

Routing-surface fix, no pipeline behaviour change. Field finding
(swacargo.com, 2026-09-03): asked "how do I migrate X to EDS with
stardust", the agent correctly proposed `replica` for the keep-the-design
route but could not say whether `prepare-migration` was also needed — the
subsumption fact lived only in `replica/SKILL.md`'s Phase 1–5 body, which
is never in context until replica is already invoked, and `replica` was
absent from the master skill's routing table altogether. One clarification
round-trip per migration conversation.

- **Master skill:** routing table gains the missing `replica` and `reskin`
  rows and marks `prepare-migration` as redesign-flow only. New § Two
  migration flows — pick one, never mix: redesign
  (`prepare-migration` → `migrate` → `deploy`/`rollout`) vs. keep-design
  (`replica` → `migrate` → `deploy`/`rollout`, where replica runs
  `extract --prep`, a mechanical direction-preservation step, and gated
  archetype recreation in place of the prep cascade), plus `reskin` for
  donor-design/same-content. Instructs stating the chosen flow — and that
  replica needs no separate prep — in the first response.
- **prepare-migration description:** "Redesign-flow only — for same-design
  migrations `stardust:replica` runs its own preserve-mode prep cascade;
  never chain prepare-migration with replica."
- **replica description:** "subsumes the `stardust:prepare-migration` prep
  cascade in preserve mode — no separate prep step; never chain the two."

Descriptions are the always-loaded routing surface, so the disambiguation
now holds even when only the sub-skill frontmatter is in context.

## 0.18.4 — wijnvoordeel/wijnbeurs field harvest: chrome crop gate, sizing-model lifts, EDS authoring traps

Harvest of three learnings ledgers from a five-design Magento-PageBuilder →
EDS migration (wijnvoordeel-be/nl + wijnbeurs-nl, 2026-08, published-origin
gated). The headline failure class: **small-area, high-salience defects that
pass the full-page bar** — both pilot runs shipped "green" pages whose
header/footer measured only 93–97% match, and a frozen `width:720px` lifted
from an authored `width:50%` passed both gate breakpoints byte-identically.
All changes are site-agnostic; deploy improvements #115–#122.

- **Replica:** new `scripts/crop-compare.mjs` (per-y-band pixelmatch,
  per-side offsets, default bar 2%); the pass bar gains item 5 — header AND
  footer bands each ≥98% over the same stitched captures, no extra live hit
  (#115). New § Wide-viewport fluid check: a ≥1920 box-map spot check
  catches fluid-vs-fixed width freezes both standard breakpoints render
  identically (#116). Recreation procedure gains § Lift the sizing MODEL,
  not the resolved value (two-width lift diff; encode the authored
  `%`/`vw`/max-width rule, never the resolved px; layout models, not
  wrap outcomes). Iteration discipline gains geometry-fix verification
  hygiene — rule-bearing element, cache-free serving check
  (`curl --compressed | grep`), back-computed reviewer viewport (#117).
- **Deploy:** ENCODE contract — never author `<hr>` (it is the section
  delimiter; fractures the section at ingestion — lint 🔴, rule `HR`,
  #119); rehost assets only from the CAPTURED src and diff
  dimensions/bytes after fetch (commerce CDNs answer 200 with a generic
  fallback for guessed paths, #118). Step 3 — one section-metadata `style`
  value per section (multi-value delivered only the first class; anchor a
  second axis with content-scoped `:has()`, #120); empty-section
  `display` overrides must scope to `[data-section-status='loaded']` or
  they defeat pre-load hiding (measured 0.75 CLS, #121). Step 10 gains the
  chrome crop gate, the ≥1920 box check, and the verification-hygiene
  items. The deployed computed-style guard also asserts `clientWidth > 0`
  per visible loaded image — loaded ≠ rendered; circular flex sizing
  collapses an image to 0×0 with `naturalWidth` still > 0 (#122).
  `sanitise.js` now refuses >2 arguments: the two-arg <input> <output>
  convention made a 3-file batch silently overwrite the second file with
  the first's content.
- **QA:** new `zero-size-image` check (warn) — loaded image renders 0px
  wide while participating in layout (`getClientRects()` guards against
  display:none false-flags).
- **Reskin:** Image-paint gate documents the same loaded-≠-rendered blind
  spot (paint asserts `naturalWidth`, not rendered area).

## 0.18.3 — dual-session field harvest: consent fallback, gate identity assertion, capture-freeze hardening

Harvest of two independent replica+deploy sessions (rwe.com and centene.com,
2026-08-26/27, on 0.18.2). Three failures recurred in BOTH sessions and lead
the release: a stale cross-project `:8791` server silently gated a foreign
site (once in each direction — every skill doc suggests the same port, so
collision on a shared machine is guaranteed); consent widgets missed by the
selector list (on centene the banner baked into ground truth AND all 7 stitch
seams → 32% false pixel diff, one gate round invalidated); and live-data
embeds (mirroring the SAME src cancels the data out in the pixel diff —
freezing a snapshot guarantees a widget-sized residual). All changes are
site-agnostic and additive; the high-impact-but-not-low-risk items
(shared-classifier element-boundary separators, stitch-shot `--fullpage`,
per-project default ports) are deliberately deferred with rationale in
`notes/improvement-plan-2026-08-rwe-centene.md`.

- **Extract:** `crawl.mjs` consent dismissal gains a visible-button
  text-match fallback — exact short labels (Accept / Accept all / Allow all /
  Agree / OK / Decline / Alle akzeptieren / Accepter), overlay-container
  scoped, runs ONLY when the selector pass matched nothing, so existing
  selectors keep priority and an in-content link can never match. Favicon is
  now captured on the ENTRY page in every mode (bounded `--pages` extracts
  skip Phase 3 where favicon capture lived; deploy then skipped silently and
  shipped the default icon) via an in-page fetch that inherits the context's
  fingerprint. Bot-wall note: page-level walls usually do NOT gate assets —
  probe one asset with a browser-UA curl before building in-page-fetch
  machinery.
- **Replica scripts:** `gate.sh` asserts build-side identity BEFORE any
  capture — the fetched page must contain a marker (default: the `<slug>`;
  `--marker` overrides), exit 4 names the port listener via `lsof`; the
  documented default port is unchanged (the assertion makes collisions loud
  at near-zero cost). `stitch-shot.mjs`'s freeze now also pauses every
  `<video>` at t=0, clears all pending JS timers, and clicks the first
  slick-convention carousel dot — CSS-only freezing stopped neither video
  playback (~20% of one page was video noise) nor slick autoplay (slide
  identity arbitrary per capture; residual 4% → 0.8% once reset). Symmetric
  on both sides; a static page's capture is byte-identical to 0.18.2's.
- **Replica motion parity (observe, don't infer):** new
  `motion-observe.mjs` (sibling of stitch-shot, same live-session
  hardening, exit 3 on challenge) records what the live page actually
  DOES — animationstart/transitionstart events with element paths + text
  snippets, class mutations exposing the trigger mechanism, a down+up
  header-state timeline (dense near the top), `--click` widget frames,
  `--hover` computed-style diffs with the changed-property list
  precomputed. The interaction-parity pass is now a REQUIRED gate output
  per archetype — a motion inventory in `progress.json`
  (`motion: {observed, implemented, dead[]}`; live-classed-but-dead
  behaviors recorded as NOT implemented, the correct replica of a dead
  class) — because when optional it was skipped on 5 of 7 archetypes and
  every skipped one shipped visibly static. § Interaction parity is
  rewritten around the evidence rule: implement ONLY behaviors that
  measurably fired — static lifting invented motion three field-recorded
  ways (dead animation classes: 2 of 8 classed caption families ever
  fired; hover rules whose scope never matches at runtime; approximated
  chrome mechanisms allowing states impossible on live, e.g. a
  double-rendered header) — with static CSS remaining the authority for
  the exact keyframe/easing VALUES of fired animations, mechanisms cloned
  as the observed state machine, and a two-direction verification
  (pixel-compare must return to the gated number — field: 1.01% gated →
  1.06% with invented motion → 1.01% exact after the evidence-only
  rewrite — plus a behavior-match assertion off the observe JSON). Full
  spec: `notes/replica-motion-parity.md`.
- **Replica docs:** two new permanent-residual classes in the capture-state
  policy (live-data embeds — load the SAME embed same-src on both sides;
  randomized decorative elements — log, don't chase); AEM-classic richtext
  byte patterns are load-bearing (mirror them; diff `innerHTML` when a
  wrap-count mismatch survives width parity); `display: flow-root`
  reproduces clearfix margin containment (fixed −48/−20px per-section errors
  in one rule); iteration discipline gains the no-op-fix check (an unchanged
  differing-pixel count means the rule never applied — the round doesn't
  count); a "verify the port is yours" line wherever `:8791` is suggested
  (also in deploy Step 10 and the diff SKILL).
- **Deploy:** Step 3's reset now REQUIRES the global `border-box` the
  boilerplate doesn't ship — a bootstrap-era %-width+padding grid silently
  wrapped every column, +1731px doc height, all text gates green (#106);
  block DOM must not emit semantic `<header>` (the stock reservation clamps
  every one at once, #107); overlay chrome documented as the no-reservation
  #81 case (`--nav-height: 0` + absolute header, measured CLS 0.0004, #108);
  the block brief requires mobile overrides at the variant's own specificity
  (#109), `flow-root` on un-floating overrides (#113), and wrapper resets at
  lower specificity than the block's own rules (#114); never copy the
  pipeline's fallback `<img src>` (750px rendition) into a CSS background —
  rewrite `width=2000` (#110); `line-height: 0` on image paragraphs cancels
  the `<picture>` wrapper's baseline descender (#111); whitespace-only
  authored content is dropped by the pipeline — model live spacer line boxes
  as block CSS (#112); the no-favicon path is a loud WARN recorded in the
  deploy log, never a silent skip.

## 0.18.2 — replica field harvest: font-fork instrument fix, interaction parity, published-origin gate

Harvest of a full `stardust:replica` e2e run (broadridge.com → EDS,
2026-08-25/26, on 0.18.1): a home-page archetype gated to 3.55%/5.56% pixel
diff, then 8 pages published and gated against the live origin. All changes
are site-agnostic; the validated discipline (measure-first, fail-loud,
≤10% / Δ≤8px / 0-structural-red, hit minimization, no DOM copying) is
unchanged.

- **Instrument fix (diff `live-session.mjs`, F-B2):** the standard
  anti-bot header set now rides DOCUMENT requests only (via
  `context.route`), never subresources. Forced on every request it made
  cross-origin CORS-mode webfont fetches non-simple — they died with
  `net::ERR_FAILED` and every live capture silently rendered fallback type,
  poisoning the whole gate (live doc height moved 6669→6518 after the fix).
  Bot managers fingerprint the navigation request, which still carries the
  full set. Companion hardening: stitch-shot asserts fonts loaded after
  `document.fonts.ready` and warns loudly on any declared face with
  FontFace status `error` (gate doc rule 14 owns the instrument-induced vs
  capture-state decision).
- **Replica scripts:** new `anchor.mjs` (per-section `[y, height]` probe —
  run on both sides, fix the first mismatched section top-down; roughly
  halved iterations vs band-reading alone in the field) and `gate.sh` (one
  pixel round in one command, live capture cached, fail-loud on exit 3).
- **Replica gate doc:** new § The published-origin gate — only the
  published number counts for platform-delivered pages, with the three
  recurring EDS pipeline deltas (`<p><picture>` wrapping, empty
  metadata-section padding, `/media_<hash>` rewrites); calibration honesty
  (prototype-regime vs published-origin-regime numbers, same ≤10% bar);
  probe schedule per fix round (pixels every round, content/visual at
  milestones — content/visual re-runs cost 2 live hits each); iteration-cap
  bookkeeping (instrument-invalidated runs excluded once the defect is
  fixed and named; build-side-only probe passes are free); the script-edit
  rule narrowed (re-implementing retired adaptations stays a defect; a
  commented, ledgered, flagged-for-upstream instrument-bug fix is the
  correct move — fail-loud outranks script immutability).
- **Recreation procedure:** CSS lifting gains the text-rendering group
  (`text-rendering`, `-webkit-font-smoothing`, `font-synthesis`,
  `font-variant-numeric`, `font-kerning`) + the literal-string width
  diagnostic; new § Interaction parity (hover-diff and behavior-diff probe
  patterns, Swiper-lock semantics and the scroll-based replica that
  auto-degrades to the static case); new § Wrap-junction margins
  (collapsing-margin trap on cards-on-a-canvas sites); capture-state policy
  gains nondeterministic live elements (tickers, dates, counts — freeze a
  captured value, log as permanent residual); granularity parity states the
  widget policy: widgets are implemented, not justified away.
- **Replica SKILL:** archetype prototypes are per-archetype and CUMULATIVE
  (shared canon CSS + per-archetype CSS; never skip to direct platform
  authoring — prototyped archetypes held 3.5%/5.6% while direct-authored
  pages plateaued at 8–16%); Phase 5's final proof is now the mandatory
  published-origin gate.
- **Deploy:** preview `409 "error from content-bus"` gets a two-step
  fail-loud diagnosis (known-good doc to the same path, then a per-image
  sweep for SVGs over the ~40KB hard pipeline limit — rasterize to PNG);
  #99 extended accordingly.
- **Migrate:** sibling content-fidelity is now measured per page at import
  time — a role-classified node-count acceptance (headings / body / CTAs /
  images vs the captured page JSON; drops not covered by a logged
  `contentDeviations[]` entry fail the page), so dropped-content importer
  bugs surface while the importer is still cheap to fix.

## 0.17.0 — vanilla aem-boilerplate is the only deploy runtime; David's Model becomes a mechanical gate

The AuthorKit runtime dependency is removed end to end: `stardust:deploy`
targets stock `adobe/aem-boilerplate` — no runtime port, no vendored files,
no `.eslintignore`, no pinned author-kit ref. Validated by three full e2e
conversions onto a fresh boilerplate + DA site (6/11/13-section pages, root
and subfolder scopes); the third run shipped with zero live-only defects.

- **Runtime (deploy):** `bootstrap-authorkit.mjs` deleted; new "Target
  runtime" contract documents what stock boilerplate provides (never
  modified). Buttons are the vanilla family (`a.button.primary`/`.secondary`/
  `.accent` in `p.button-wrapper`; the probe records per-target drift —
  older clones emit `button-container`). Fonts move to `styles/fonts.css` +
  metric-matched `<brand>-fallback` faces (the stock convention); the
  `body.appear` gate is the runtime's and stays. Chrome is authored `/nav` +
  `/footer` documents fed to template-slotted `header`/`footer` blocks —
  nav links become authorable and interactive chrome is real block JS;
  per-page `nav:`/`footer:` metadata replaces `header: off` (and makes
  multilingual chrome routing a content concern, no runtime patching).
- **David's Model (deploy):** new `davids-model.md` maps all 15 rules to
  their enforcement points (`D#N` citations); the ENCODE contract gains the
  missing structural rules (D2 nested blocks, D3 spans, D4 URLs, D10
  columns, D13 alt-text, D15 code-as-text, D1 auto-blocked embeds); Step 2
  opens with D1/D11 triage (prose sections land as default content with a
  small closed section-`style` vocabulary; Block Collection patterns mirror
  collection models). New `davids-model-lint.mjs` gates the atomic delivery
  chain — three consecutive e2e runs produced 0 🔴 first-pass content
  structure with no model instruction in the run prompt.
- **New gates + findings from the validation runs:** `qa-gate.mjs` (stock
  Local-QA assertion run driven by the page's eds-schema — replaces
  hand-rolled probes); Local-QA scope boundary (CLS, `content-diff`/
  `visual-diff`, and chrome overrides are deployed-URL-only checks — the
  harness false-passes CLS); findings #96–#101 in `deploy/IMPROVEMENTS.md`,
  including: the pipeline `<p>`-wraps nav trigger links (#98),
  bitmap-embedding SVGs 409 the preview (#99, lint advisory added), and the
  metadata-first empty section defeats `waitForFirstImage` so hero blocks
  must eager-load their LCP image and reserve the media slot (#100).
- **Cross-skill:** rollout delivers chrome as published `/nav` + `/footer`
  documents (roster + coverage semantics updated; multilingual routing via
  per-language documents); diff's `BLANK_RENDER` hint now points at the
  runtime not booting instead of advising removal of the stock display gate;
  `edsName()` guards `-wrapper`/`-container` suffix collisions.

Measured effect across the validation runs: single-page conversion time fell
from ~74 to ~42 minutes as findings fed back into the skill, with fidelity
gates green throughout (content+roles matched 41/41, 94/94, 71/71 text
nodes; live CLS ≤ 0.01 after #100).

## 0.16.1 — container-width sizing guidance in the token contract

Docs only, no behavioral surface. New `## Sizing --max-width` section in
`skills/stardust/reference/token-contract.md`: stardust ships no default
container width — inherit the captured container when it holds up (widening
one step within the site's own framework vocabulary when it reads dated),
measure-first (1200–1280px) when the capture has no measurable container,
and persist the derived value to DESIGN.json
`extensions.breakpoints.containerMaxWidth` with the change flagged in the
page-shape brief. Cross-referenced from
`skills/prototype/reference/page-shape-brief.md` § Layout strategy.

## 0.16.0 — two new entry points: replica (same-design migration) and reskin (content × donor design)

Round-1 outcome of the three-new-use-cases exploration (research, candidate
designs, and validation evidence in `notes/new-use-cases/`). Both flows were
validated on real pages before codification — replica converged aesop.com to
a 1.31% pixel diff with zero structural findings in 3 measured iterations;
reskin carried hirslanden.ch content byte-identically (2281/2281 chars,
47/47 slots, 13/13 metadata) onto stripe.com's token system with 91% of
slots mapped to named donor modules. No existing skill was modified (round-2
synergy candidates are listed in `notes/new-use-cases/ROUND-1-REPORT.md`).

- **`stardust:replica`** (new): same-design migration to AEM EDS. extract
  `--prep` unchanged → mechanical preserve-direction (current-state spec
  promoted verbatim as target; deltas only via the inconsistency register) →
  clean re-authored archetype recreation (values lifted from the source
  site's own CSS, never DOM copies) → measured source-fidelity gate per
  breakpoint (diff's two probes `--profile generic` + new
  `stitch-shot.mjs`/`pixel-compare.mjs` stitched pixel probe with per-band
  breakdown, ≤3 iterations) → migrate sibling tier / deploy
  (template-slotted bias) / rollout unchanged.
- **`stardust:reskin`** (new): byte-faithful content onto a donor design
  system (live URL via extract `--design-source`, or local prototypes;
  Figma donor contract-defined, not implemented). Content-model capture with
  scope declaration + executable normalization ledger → mapping brief
  (≥80% slots mapped to named donor modules, no silent improvisation) →
  programmatic render from the model (never retyped) → dual gates: content
  (vendored `dom-equality.mjs`, Apache-2.0 attribution, structure
  informational + `slot-coverage.mjs` incl. metadata) and design-adoption
  (`donor-probe.mjs` token assertions; selector-missing = FAIL).
- Both skills were smoke-tested for generalization on fresh sites before
  shipping (replica: hay.dk, desktop converged to 1.06%; reskin:
  ethz.ch × posthog.com, 4883/4883 text bytes, 101/101 slot checks) and
  hardened from the findings: replica gained pointer-park capture hygiene,
  the fixed/sticky-chrome × stitched-capture procedure, per-breakpoint CSS
  lifting, and the full four-patch adaptation set for the diff probes
  (upstreaming them as diff flags is the recorded round-2 candidate);
  reskin gained the document-ordered render stream in the content model
  (`ordered` + tiling verification), root-kind slot classification, a
  shared image-visibility predicate across capture and gate, the
  scope-granularity smell check, and the bounded donor-sampling recipe.
  Smoke evidence: `/Users/paolo/stardust/smoke-{replica,reskin}/SMOKE-REPORT.md`.
- New evals: `replica-source-fidelity/`, `reskin-content-fidelity/`.

### Field-test hardening (5+5 home pages, findings ledger in the 2026-07 field report)

A 10-site field test (replica: fritzhansen, rimowa, carhartt-wip, polestar,
maisonkitsune; reskin: kew×linear PASS, moma×intercom PASS, redcross×vercel)
produced an 18-finding ledger; all skill-wrong findings are folded:

- **Shared live-measurement hardening (F-G, F-R1, rimowa-1; HIGH).** New
  `diff/scripts/live-session.mjs` — the one home for hitting live sites to
  *measure* them, as robust as extract's capture engine: real-Chrome UA
  **plus the standard request headers** (Akamai fingerprints on the absence
  of `Accept`/`Accept-Language`/`sec-ch-ua`, so UA alone still 403s —
  reproduced on redcross.org, fixed to HTTP 200; the same header set
  un-blocked rimowa's gate headlessly), challenge detection that **fails
  loud** (exit 3, never silently measured as the source), headed-stealth
  escalation, and two-class overlay dismissal (consent + timed marketing
  modals, the carhartt `#wps_popup` case — CH-1). Consumed by diff's two
  probes, replica's stitch-shot, and reskin's three live-hitting scripts.
- **diff flags replace replica's 10 hand-edits (F-B).** `--ua`,
  `--wait-until`, `--dismiss`, `--headed`, `--locale` on both probes and
  visual-diff `--main`, backward-compatible for local/deploy use;
  `source-fidelity-gate.md` § Script adaptations rewritten — a hand-edited
  project copy is now a defect.
- **replica:** bounded `--single` entry gets a satisfiable promotion
  contract (`bounded-single` synthesis branch — rimowa-3); `--main body`
  banned with the 103-false-🔴 reproduction (F-C); hit-minimization +
  media-density iteration budget (rimowa-2, CH-2); mobile-@media-first and
  role-parity recreation guidance (CH-3/FH-2); locale pinning for capture
  determinism.
- **reskin:** ordered stream is now `innerText`-consistent by construction
  (F-R2 — kew's a11y ghost labels eliminated at the source; 8/8
  `orderedVerified` vs 5 false in the field) with a sanctioned documented
  fallback; `formControl` stream nodes carry select/option/input text
  verbatim (F-R3 — redcross course form now fully reconstructable, 13/13
  verified); slot-coverage gains a paint assertion so an origin-locked CDN
  can't hide behind a passing URL-string gate (F-R4, kew's 19 unpainted
  images); zero-output scope errors now guide discovery (F-D); first-match
  scope semantics and bounded-donor token sourcing documented (F-R5, F-R6).
- Manifest version aligned (F-A).
- **PR-review P1 fixes** (multi-agent review of PR #238): donor-probe expands
  CSS box shorthands canonically (3-value `[t,r,b,r]`, not cyclic — a
  pixel-perfect render no longer false-fails the design gate); stitch-shot
  fails loud on scroll-stall (inner-scroller/scroll-jacked pages can no
  longer produce silent black-row captures); the diff probes regain their
  advisory exit contract for HTTP errors (`gotoLive httpError:'measure'` —
  a 404 build side reports flags at exit 0 again; challenges still exit 3;
  reskin's byte gate keeps fail-loud); `defaultWaitUntil` centralized in
  live-session with a three-tier rule (localhost and `*.aem.page/.aem.live/
  .hlx.page/.hlx.live` → networkidle, other live → domcontentloaded) so
  deploy Step 10 never measures a half-decorated EDS page.
- **PR-review P2/P3 fixes**: the challenge solve-window runs headed-only —
  a challenged headless run now costs exactly 1 hit (was 4, the entire
  recorded Akamai block budget) before exit 3; slot-coverage routes live
  `--rendered` targets through live-session like its siblings (challenge →
  exit 3, no more swallowed navigation errors); case-insensitive stream
  matching no longer reuses indexes across case-folded strings (Turkish İ
  class — corrupted stream bytes fixed at the source); bootstrap re-runs
  preserve the favicon `<link>` when overwriting head.html (idempotent
  re-injection); typo'd `--flags` now error loudly in dom-equality /
  donor-probe / slot-coverage; the QA harness derives its favicon link from
  the shipped `favicon.<ext>` (or keeps the request-free `data:,` no-op).
## 0.15.0 — deploy accuracy: close the ENCODE/DECODE round-trip at authoring time (#93–#95)

The six-site e2e campaign showed `stardust:diff`'s structural probe catching
real dropped-CTA / role-swap defects on every site — post-deploy, when each
fix costs a redeploy loop. Root cause: authored rows (ENCODE) and block
decode (DECODE) are written independently and hoped to be inverses. This
release moves the defect-finding to conversion time so `deploy` Step 10
becomes a proof, not a repair loop:

- **#93 `section-schema.mjs`** (deploy, new): the per-section ENCODE/DECODE
  shared contract — ordered role inventory + repeating-unit groups emitted
  from the rendered prototype; authored rows and block decode are both
  written from it (new Step 2b).
- **#94 `block-roundtrip.mjs`** (deploy, new): in-loop per-block gate —
  decorates the authored content locally with the block's own JS+CSS (no DA,
  no dev server), diffs the decorated section against the prototype section
  with content-diff's own classifier, exit 2 on structural 🔴 or on any
  decorate error (a block that throws or whose inlined JS fails to install
  must never pass — its raw rows can false-match the prototype). Required per
  block before deploy, plus one whole-page run before the DA push.
- **#95 decode tiers** (deploy): template-slotted (verbatim prototype DOM +
  role slots — fidelity by construction, for fixed-composition sections
  nobody structurally edits) vs reconstructive (for authorable repeat
  groups); tier recorded per block.
- **diff**: classifier + differ factored into
  `skills/diff/scripts/content-inventory.mjs`, shared by content-diff /
  section-schema / block-roundtrip so every fidelity gate measures with the
  same instrument (content-diff CLI behavior unchanged).

## 0.14.5 — crawler clears Cloudflare managed challenges

`extract/scripts/crawl.mjs` — the bot-management fallback now validates the
probe **response**, not just that the navigation resolved. A Cloudflare managed
challenge returns an HTTP 403 interstitial (`cf-mitigated: challenge`) *without
throwing* — `domcontentloaded` fires — so the old fallback (which only fired on
a thrown network-fingerprint error) sailed past it and the block surfaced later
as a fatal capture-time `HTTPError`. Observed on sagora.com during the 0.14.4
uplift validation batch, where it required hand-patching the crawler mid-run.

- **Challenge detection at the probe:** `isChallengeResponse()` flags an
  entry-URL 403/429/503 interstitial (`cf-mitigated`, `cf-ray`,
  `server: cloudflare`/`akamai`/edge markers). Either reject mode — a thrown
  fingerprint block *or* a challenge response — now triggers the headed
  fallback; the reason is recorded in `_crawl-log.json#discovery.botBlock`
  (`fingerprint | challenge`).
- **Stealth-hardened headed Chrome:** the fallback launches real Chrome with
  `--disable-blink-features=AutomationControlled` +
  `ignoreDefaultArgs: ['--enable-automation']` and spoofs
  `navigator.webdriver` via an init script on **every** context (probe +
  workers — the challenge re-fires per context, no cross-context cookie
  sharing). `fetchTechnique` becomes `headed-chrome-stealth`.
- **Challenge-solve window:** `clearChallenge()` waits for the non-interactive
  challenge's JS to set its clearance cookie and reloads before validating
  status — no-op on a normal 200, so zero overhead on the common path. If
  headed + stealth + the solve window still can't clear it, the run fails with
  a clear `BotChallengeError` (interactive solve required) rather than
  capturing the interstitial as content.
- Recipe doc (`extract/reference/playwright-recipe.md` § Bot-management
  fallback) updated with the two-reject-mode retry rule and the managed-
  challenge clearing procedure.

Validated end-to-end: patched crawler on sagora.com auto-detects the challenge,
switches to `headed-chrome-stealth`, and captures the homepage at HTTP 200
(2 headings, ~8.9k chars, 9 images); the common headless path (example.com) is
unchanged (no fallback, no botBlock).

## 0.14.4 — Tessl quality pass, part 1 (descriptions)

Description rewrites for the two skills whose tessl-review drag included
description criteria: `extract` (adds a "Use when…" clause + natural trigger
terms — analyze/reverse-engineer/capture design tokens — and a "Not for"
scraping disambiguation) and `prepare-migration` (plain-language framing of
the prep cascade + trigger phrases + "Not for" migrate/deploy
disambiguation). Body text untouched — zero behavioral surface; the
conciseness/progressive-disclosure restructuring of extract/deploy is a
separate follow-up with its own validation run.

## 0.14.3 — seventh-site validation harvest (stardust.style) + review fixes

Learnings L1–L9 from the final validation run (full pipeline on
stardust.style, hands-off) plus the PR-review findings, folded:

- **crawl.mjs:** trailing-slash forms kept verbatim with slash-insensitive
  dedupe + a guarded 404 slash-retry that records the resolved URL
  (`_crawl-log.json#crawl.slashRetries[]`); `reducedMotion: 'reduce'` on every
  context + an 800ms post-scroll settle (animated h1s were silently dropped);
  visible `<pre>` contents captured as `codeBlocks[]`; collision-safe slug
  assignment (query-variant / flattened-path pages no longer clobber one
  file); sitemap-index recursion (child-sitemap `.xml` locs no longer queued
  as pages); `page.close()` on every exit path via try/finally.
- **Specs:** playwright re-probe rule at the start of every rendering skill
  (`--no-save` installs are pruned by any later `npm i`); token-hygiene gate
  at the FIRST phase commit (master SKILL.md); partial-inventory broken-link
  carve-out reconciled across content-preservation / migration-procedure /
  template-and-module-rendering; cinematic sibling handling specced in
  migrate (assets carried, `cinematic-variant-not-consumed` recorded);
  key-facts-in-server-rendered-content ENCODE rule (#86) with the declaration
  site defined (`DESIGN.json.extensions.metadata.keyFacts[]`); stale
  "closed catalog / 5 weaknesses" references reconciled in the master skill,
  divergence-toolkit, and artifact-map; diff JOIN/SPLIT limitation documented
  (#87, code fix pending).
- **Versions realigned** across plugin.json / tile.json / marketplace.json /
  README / this file (the #230 drift class).

## 0.14.1 — six-site E2E hardening (round 1, folded into extract)

Released as part of the six-site validation cycle; the crawl.mjs items listed
under 0.14.2's last bullet were folded here first. Documented retroactively —
see git history (`4a61c83`) for the full diff.

## 0.14.2 — six-site E2E hardening (round 2)

Fixes folded from validating the pipeline end-to-end on six live sites
(virginatlantic, festool, hirslanden, theroadhome, 3m, sliccy), ranked by
cross-site frequency.

- **migrate no longer dead-ends on missing canon (blocking; 4 of 6 sites).**
  The documented `prototype → migrate → deploy` path never runs
  `prepare-migration`, so migrate arrived with no canon and hard-stopped.
  `migrate` § Setup now auto-bootstraps canon from the first approved
  prototype (the `prototype --prep` write-back, run on demand) when canon is
  absent and an approved prototype exists; it only stops when there is nothing
  to derive canon from. (`skills/migrate/SKILL.md`)
- **bootstrap-authorkit is transactional + refuses the drift-prone default
  (blocking; 2 sites).** Boilerplate removal now runs *after* the mandatory
  edits verify, so a drifted/incompatible source leaves the original runtime
  intact instead of bricking the repo; `author-kit@main` is refused unless
  `--ref <sha>`, `--from-sibling`, or `--allow-unpinned` is given.
  (`skills/deploy/scripts/bootstrap-authorkit.mjs`)
- **atomic delivery contract now asserts computed layout (silent-failure
  guard).** A `.plain.html` pass is not a layout pass — the AuthorKit
  `.<name>.block` scoping bug ships a stacked single-column page green. The
  contract's final gate is now a headless computed-style check (grid blocks
  must compute `display:grid`, blocks decorated, 0 pageerror) once per
  template. (`skills/deploy/SKILL.md`)
- **crawl.mjs, folded in 0.14.1 and confirmed by the runs:** five-field
  `_provenance` emission, apex→www origin adoption, Usercentrics shadow-DOM
  consent, `<video>`/`<iframe>` capture, and the playwright preflight
  (`--no-save --legacy-peer-deps`) + copy-to-project ESM-resolution guidance.

Backlog (single-site or lower-frequency) tracked in the consolidated E2E
learnings digest.

## 0.14.0 — Fable 5 refactor

### Design quality

- **Reference-grounded direction.** `direct` researches real-site references
  via the optional refero MCP (`skills/stardust/reference/reference-research.md`)
  before committing to a direction; the curated seed roll is demoted to the
  fallback when refero is absent.
- **Brand-adjacent refinement tier.** A directed middle ground between
  faithful reproduction and full re-direction, so "polish, don't reinvent"
  is a first-class target rather than an improvised compromise.
- **Opened catalogs.** The uplift/prototype candidate catalogs (what-if
  amplifications, motion registers) are no longer closed lists: the agent may
  extend them with evidence-gated entries justified from the captured brand
  surface.
- **Vision verification gates.** `extract` and `prototype` verify their own
  screenshots/renders with vision checks before a step may pass, catching
  blank captures, broken renders, and layout collapse early.

### New capabilities

- **`stardust:audit`** — new skill: a design + SEO + LLM-visibility audit of
  a site, producing a scored HTML report. Uses the marketing-skills
  `seo-audit` / `ai-seo` methodology when that plugin is installed and
  built-in heuristics otherwise.
- **Cross-site same-brand extraction.** `extract --brand-source` /
  `--design-source` capture brand and design evidence from a sibling property
  of the same brand, with automatic sibling discovery.
- **Hands-off production mode.** `skills/stardust/SKILL.md § Hands-off mode`
  runs the full migration chain without conversational gates, folding the
  previously external master migration prompt into the skills.
- **Run contracts.** A per-run learnings ledger plus a `stardust/status.jsonl`
  run-status contract, so long runs are observable and each run feeds the
  next.

### Fidelity

- **Runtime-contract detection** in deploy/rollout: probe what the target
  runtime actually serves instead of assuming the authored contract survived.
- **Atomic per-page delivery verify** — each page is verified as a unit
  immediately after delivery, not batched at the end.
- **Foundation-first gate** — global foundations (nav, footer, styles,
  indexes) must verify before page fan-out begins.
- **Link audit** across the delivered site.
- **Query-index resilience** — index delivery/verification no longer
  false-fails or silently drops rows on slow propagation.

### Performance

- **Parallelism contracts.** Concurrent agents coordinate through a
  state-machine merge-by-slug contract instead of last-writer-wins on
  `state.json`.
- **Parallel prototype variants** and **crawl concurrency** in `extract`.

### Fixed

- **Version/reference drift.** `plugin.json`, `tile.json`, and the README now
  carry one version, and the impeccable dependency is declared consistently
  as **hard** everywhere (tile.json previously listed it as a soft
  dependency).
