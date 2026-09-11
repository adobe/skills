# Changelog

This file starts at 0.14.0. Prior versions (0.3.0 – 0.13.1) are documented in
git history only (plus the branch-scoped notes in
`CHANGELOG-redesign-adobecom.md` and `CHANGELOG-delivery-media-fidelity.md`).

## 0.20.0 — dynamics: the dynamic surface of a migration

Three real migrations (a US health insurer's employers section rebuilt greenfield, a UK
package-holiday site on an existing EDS library, a consumer-credit site re-platformed at
~5,900 URLs) found the same thing: a site's dynamic surface — modals, players, forms,
search, tags, APIs, client-rendered and sheet-backed content — is invisible to a
block-scoped, pixel-verified pipeline, and invisible in a way every gate certifies as
correct. This release makes it visible, forces a decision per row before import, and
proves the behaviour after delivery. Migration-bound by design: default-on in both
migration flows, never for redesign-only work.

- **New sub-skill `stardust:dynamics`** (`skills/dynamics/`): detect → classify → triage →
  implement → verify. Triage on **four axes** — class (`L S F M V T A R X I18N CR D`),
  disposition (`rebuild-native · index-backed · data-fed · embed-passthrough · client-only ·
  static-snapshot · decided-out`), reproducibility (`self · needs-credential ·
  needs-human-capture · needs-backend · needs-business-decision`), status. Only `self` ships
  autonomously; the rest is one owner decision batch. Hard rules: reconcile against the
  migrated output first, never fabricate a blank client-rendered page, never auto-wire a
  regulated-PII form, a search box implies a results page, decided-out is explicit.
- **References** (loaded on demand, not in the always-on skills): classes-and-signals,
  triage (+ the `stardust/dynamic-features.md` inventory format, which subsumes the former
  dynamic-blocks map), patterns (catalogue with contracts and three embedded example
  mechanisms — modal loader, index search, JSON post with honeypot), listings (folded from
  rollout's dynamic-listings), off-origin-data (host-keyed endpoint indirection, code-bus
  snapshots, fetch shim, per-state rendered snapshots + `Source` row, sheet sync, chrome URL
  space), forms (controls not form tags; intake by content source; regulated data),
  parity-report, locale-trees. The plugin ships **contracts and tooling, not blocks**: no
  block was reused as-is across the three cases and an existing library must be fed, not
  forked.
- **Tooling** (`skills/dynamics/scripts/`, verified end to end on a local fixture):
  `dynamics-detect.mjs` (network log by host, first-party API paths with status, POST
  bodies, forms **and form-less control groups**, the trigger → dialog → content graph,
  player ids, iframes without src, tag-manager mount divs, settings-object keys, framework,
  auth/commerce/locale, client-rendered slots and pages, listing candidates; `--from-state`
  for one page per type; `--reach` folds the crawl's per-page signals in),
  `dynamics-plan.mjs` (four-axis draft per finding, `--target-origin` **host-bound** probe of
  every recorded API path, `--migrated` reconcile against delivered output, regulated-PII
  flag), `dynamics-check.mjs` (parity replay over a closed set of check types —
  `fetch-json`, `dom-count`, `click-dialog`, `search-query`, `form-flow`, `video-plays`,
  `consent-gate`, `no-page-errors` — third-party request statuses recorded per check),
  `snapshot-api.mjs`, `snapshot-forms.mjs`, `sync-sheets.mjs`, `vendors.json` (the
  classification engine: host pattern → class + role, product names only).
- **Hooks in the existing skills, ≤15 lines each:** `extract --dynamics` (opt-in per-page
  reach signals; never set by a bare extract, `uplift` or `audit`); `prepare-migration`
  Phase 4.5 and `replica` Phase 2 run Phases 1–3 as the pre-import gate; `migrate` Phase 1
  is the safety net for the hand-run flow; `deploy` reads the inventory as brief input and
  never flattens `client-only` / modal-bearing sections into prose; `rollout` B2 verifies the
  inventory against fresh evidence, D2 implements the `self` set and batches the rest, H
  reports parity; `qa` gains the `dynamics` check (`parity-missing` / `parity-failed` /
  `parity-env-limit` / `parity-unchecked`); master routing + both flows name it.
- **Origin-scoped site auth everywhere.** `resolveSiteAuth` / `attachOriginAuth` in the shared
  live-session helper and the qa runner (`--auth-header` / `--token-env`, default
  `SITE_TOKEN`): the secret rides a route filter on the base origin only — a context-wide
  header leaked it to a video vendor's playback API, whose CORS check then produced a player
  error real users never see.
- **Learnings ledger** failure classes `dynamic-gap` / `api-dependency` now point at the
  dynamics references. Removed: `rollout/reference/dynamic-listings.md` and the 0.19.9
  `dynamic-capabilities.md` (folded into `skills/dynamics/reference/`).

## 0.19.8 — impeccable dependency: unpinned by design, with an update hint

- **Dependency declaration** moves to the documented cross-marketplace object
  form — `{ "name": "impeccable", "marketplace": "impeccable" }` — still with
  NO version range, on purpose: impeccable's design craft should always be
  the current one. (The root marketplace's `allowCrossMarketplaceDependenciesOn`
  already lists `impeccable`.)
- **New `stardust/scripts/impeccable-version-check.mjs`** — Claude Code only
  announces plugin updates through marketplace auto-update, which is off by
  default for third-party marketplaces, so a user can sit on an old
  impeccable indefinitely. Setup step 1 now runs this check once per session
  and surfaces its one line when a newer impeccable exists (installed
  version from the plugin registry or `--local <dir>`; latest from the
  upstream manifest with a 6s timeout, falling back to the cached
  marketplace catalog; `--offline`, `--json`). Advisory only: always exits 0,
  fails silently to "unknown" — the registry paths it reads are Claude Code
  implementation details, not an API.
- **Manifest drift fixed:** the adobe-skills marketplace entry and the Tessl
  manifest both still said 0.18.1 while `plugin.json` was at 0.19.7 (the
  validator warned; `plugin.json` wins at install, so users were unaffected,
  but `claude plugin tag` requires agreement). All three now read 0.19.8.

## 0.19.7 — sibling variance probe (P12)

- **New `replica/scripts/sibling-variance.mjs`** — before cloning a gated
  archetype onto its siblings, probe the template-defining computed values on
  every sibling's LIVE page and diff against the archetype: per `--probe
  name=<sel>` the match count, first match's box + computed group (background
  layers incl. gradient scrims, colour, padding, font, radius), first heading
  and image, list-style and `::before` mechanism, and the number of distinct
  style families among matches; plus the top-level section list. Defaults
  (first section, most-repeated class, `li`) when no probes are given.
  Live-session hardening as the other replica instruments. Exit 0 constant,
  2 variance found. Read-only — it never edits the clone.
  Field evidence: eight "same-template" siblings varied in hero template
  (441 vs 528px), scrim direction, bullet mechanism and terms shape — all
  found late at the pixel gate.
- **Fidelity tiers:** the sibling tier is "variance-probed" first; new
  § Sibling variance probe — every delta is budgeted as a block VARIANT class
  emitted on the sibling's content (blocks stay generic, never forked per
  page); `gatesPassed` gains `variance-probe`, `_meta.json` gains
  `variants[]`. Replica Phase 5 and migrate's A′ branch point at it.

## 0.19.6 — replica: glyph-dense chrome noise floor, evidence-gated (P6)

- **`crop-compare.mjs` reports the diff TEXTURE** — the share of differing
  pixels with ≥5 differing neighbours: thin-edge = glyph-antialiasing noise,
  thick = blocks/bands (misalignment, missing paint). Reported in text and
  `--json`; never changes the exit code.
- **Gate doc, pass bar item 5:** a glyph-dense chrome band that fails the 2%
  bar may be logged as a justified residual (`cause: "glyph-antialiasing"`)
  — never a pass — only when all three hold and are attached as artifacts:
  `chrome-parity.mjs` exit 0 for the region at 1px tolerance, crop-compare
  texture thin-edge (≤15% thick), and a text-dense region (no imagery/icons).
  Field evidence: a ~50-link footer bottomed out at ~5% with every metric
  numerically identical; a hinted licensed face vs a self-hosted webfont
  rasterise differently per glyph. The 2% bar is unchanged; residual logging
  format gains the entry shape.

## 0.19.5 — deploy: link localization as a pipeline stage (P24)

- **New `deploy/scripts/localize-links.mjs`** — dependency-free, idempotent.
  Builds the URL map from the content tree (every served path, extensionless,
  `x/index.html` → `/x`) plus `--redirects` (rollout's `stardust/redirects.tsv`
  or a JSON map), rewrites every source-host `<a href>` (with/without `www.`,
  http/https/protocol-relative) whose path resolves in the map to the
  canonical root-relative form — no `.html`, no trailing slash, query and
  fragment preserved — and normalizes root-relative internal hrefs the same
  way. Everything else stays absolute and is REPORTED (the not-yet-migrated
  boundary). `--dry-run`, `--json`, and `--check` (write nothing, exit 2 when
  localizable links remain — the pre-deploy assertion).
  Field evidence: ~500 source-domain links across ~150 pages bounced visitors
  back to the live site for pages that existed on the new origin.
- **Deploy stage:** the Deploy table and the per-page atomic delivery contract
  gain the stage (run after every generator and before every write, over the
  WHOLE tree; re-run after every wave). The ENCODE D4 bullet and
  `davids-model.md` now say what D4 is — a capture-fidelity rule for media and
  external targets — and that internal links to migrated pages are
  root-relative. Checklist item added. Rollout Phase E2 points at the stage
  instead of a hand rewrite.
- **Lint (advisory):** `davids-model-lint.mjs --source-host <host[,host]>
  [--content-root <dir>]` flags a source-host `<a href>` whose path exists in
  the content tree as 🟡 D4 LOCALIZE. Advisory by design in this release;
  promote to 🔴 after one rollout has run the stage cleanly.

## 0.19.4 — replica: chrome-parity probe (P3)

- **New `replica/scripts/chrome-parity.mjs`** — computed-style parity for
  chrome. Probes the same regions on live and build (default header +
  footer; `--region strip=<liveSel>|<buildSel>` for sticky strips), pairs
  every text-bearing element by text, and prints only the deltas: font
  family / size / weight / style / line-height / letter-spacing / transform /
  colour / background / padding / radius, element rect, the clickable box
  of links and buttons, plus an icon inventory (count, size, signature)
  paired by order; MISSING / EXTRA texts on either side. Live-side hardening
  via the shared `live-session.mjs` (UA + headers, challenge fail-loud exit
  3, overlay dismissal, `--headed`, `--locale`). Exit 0 quiet, 2 deltas.
  Field evidence: one run found what many pixel-band rounds had not
  (italic-vs-normal note, regular-vs-bold link, wrong nav link colour, 12px
  row offsets, 97×40 vs 71×32 button, six missing icons).
- **Gate doc, pass bar item 5:** styles diagnose, pixels confirm — run the
  probe BEFORE any pixel iteration on chrome and clear its deltas; iteration
  discipline gains the same rule. Replica SKILL setup copies the script and
  the Phase 4 snippet shows the call; deploy Step 10 item 4 points at it for
  the deployed-origin chrome gate. The ≥98% crop gate remains the pass bar —
  the probe is a diagnostic, not a new threshold.

## 0.19.3 — replica field harvest, part 2: row-level instruments, masks, detectors (P1, P11, P22, P16, P19, P15, P20)

Second fold of the 2026-09 same-design-migration ledger: the entries that
needed a flag or a small script. Each is additive — a new instrument, a new
flag, or a lint/gate DETECTOR; nothing changes what the pipeline emits.

- **Replica — pass bar item 5 (chrome crop gate):** chrome means every
  site-wide repeating band (header, sticky strips, footer); crops are
  element-anchored PER SIDE (fixed-y crops false-read the moment one side's
  rhythm shifts — a strip read 66% mis-anchored, 1.6% re-anchored); and
  authored-volatile regions (campaign heroes) are masked out of the number.
  `pixel-compare.mjs --mask <yA:h[@yB]>` neutralises the row band on both
  sides, removes it from the denominator and prints every mask on the
  verdict line (P1).
- **Replica — new `scripts/row-profile.mjs`:** (1) a per-column colour-class
  scan (white/dark/brand/photo run lengths at N x positions) to establish
  section boundaries from the capture instead of eyeballing crops (P11);
  (2) brand-colour landmarks — rows dominated by a saturated brand colour,
  paired live-vs-proto in order, with per-pair delta and `gapShift` naming
  the one inter-landmark gap that absorbed a vertical offset (P22). Gate doc
  § Reading the band breakdown documents both; replica SKILL setup copies it.
- **Extract — `crawl.mjs` saves the settled rendered DOM** as
  `pages/<slug>.html` (`renderedHtml` field): capture once, parse offline;
  migrate's inputs name it as the structure source for importers (P16).
- **Deploy — Step 3:** page templates that cap `main > .section > div`
  define ONE full-bleed escape at template specificity; `qa-gate.mjs
  --full-bleed a,b` warns when a listed block's section wrapper computes
  narrower than the viewport (P19).
- **Deploy — D15 lint:** inline-script text lifted as copy (`window.`,
  `try {`, `function (`) is 🔴; ALL_CAPS_TOKEN tracking lookalikes are 🟡
  advisory. Detector only — no capture-time filtering was added (P15).
- **Deploy — `block-roundtrip`:** a dead text whose words are absent from
  the decorated unit is reported as **DROPPED CONTENT** (the decoder never
  consumed that element type) rather than DEAD TEXT; Step 8 names the full
  default-content set every decorate() must consume. Detector only — no
  leftovers pass was added to the scaffold (P20).

Deferred by design: P3 (chrome-parity probe), P6 (depends on P3), P12
(sibling variance probe), P24 (link-localization stage + lint tier).

## 0.19.2 — housekeeping: no site names in the plugin

Every reference to a real customer, test or donor site — in skill text,
reference docs, script comments, the deploy IMPROVEMENTS log, the notes
folder and this changelog — is replaced by a generic sector descriptor
("a financial-services site, 8 pages", "a fashion retailer's newsletter
modal"). Numbers, dates, finding IDs and technical content are unchanged;
no script logic was touched (comment lines only, syntax-checked). Kept as
is: vendor/platform names (Akamai, Cloudflare, OneTrust, Typekit, Shopify,
DA/EDS), Adobe's own properties, fictional sample brands (Wasatch Back,
Ledgerline, Evergreen Bank, Meridian Airways), design-vocabulary brands used
as aesthetic references, and the eval suite's live crawl target.
`notes/improvement-plan-2026-08-rwe-centene.md` is renamed to
`notes/improvement-plan-2026-08-replica-deploy.md`.

## 0.19.1 — replica field harvest (2026-09), part 1: one-bullet learnings (P2, P4, P5, P7–P10, P13, P14, P17, P18, P21, P23, P25)

First fold of a 25-entry learnings ledger from a same-design migration of
a large vendor-templated site (2026-08/09, published-origin gated, ~150
pages). This part ships
only the findings that scored 3/3/3 on general / safe / small — each is a
single bullet or an edit to an existing one; no scripts, no new sections.
The remaining entries (element-anchored + masked chrome crops, a
computed-style chrome-parity probe, sibling variance probing, capture-time
code-artifact filtering, rendered-DOM capture, a bundled link-localization
stage + lint tier) follow in separate PRs.

- **Replica — recreation procedure:** authoring step 1 reconciles component
  COUNTS from the capture before authoring (vendor templates repeat whole
  widgets; a big height delta with matching section order is a duplicate,
  not a missing section) and points at the paragraph-boundary rule; canon
  chrome is re-verified against EACH new archetype's live page before page
  content is iterated, with page-level compensation flagged for canon
  back-port; no foundation `text-wrap: balance` in replica prototypes/block
  CSS; the overlay-scrim bullet now reads the full computed
  `background-image` layer list FIRST and luminance-fits only when the scrim
  is genuinely undiscoverable; the sizing-MODEL lift covers heights and
  overlaps at two or three widths with the vw encoding formula; icons and
  vectors are harvested from the live DOM (`svg.outerHTML`), never
  approximated.
- **Replica — gate:** iteration discipline gains the post-pass typography
  spot-check (a pixel pass at the wrong base metric is latent sibling
  debt; compensating spacing is the tell); the wide-viewport check samples
  heights and one intermediate width; the published-origin gate gains two
  rules — re-probe live chrome metrics at deploy time (crawl captures are
  the content source, live-now the chrome source; mask authored-volatile
  regions) and budget one anchors-driven reconcile round at the published
  origin (the harness number is provisional); the EDS transform list notes
  that authored inner blocks may flatten, so `:has()`/block-class selectors
  are verified against the delivered `.plain.html`.
- **Migrate — content preservation:** paragraph boundaries come from the
  source's block-level nodes, never from splitting captured text on
  newlines (inline elements fragment a 5-paragraph disclaimer into 16
  `<p>`s and double the section height).
- **Deploy:** favicon delivery is verified with a `HEAD` at the published
  origin; Step 3 section styles that paint several wrappers as one surface
  contain child margins with `display: flow-root` (margin collapse through
  an unpadded wrapper paints a ground-colored stripe inside a "card");
  Step 6 chrome rows never pair a fixed `height` with vertical `padding`
  under the border-box reset; the Step 7 brief bans `<br>` inside flex/grid
  containers (it becomes a sized item) and bare `> span`-style child rules
  in variant CSS (they resurrect hidden elements); Step 10 item 5 samples
  section heights at an intermediate width.

## 0.19.0 — Experience Workspace editability contract (EW1–EW10) + gate

Every text an author wrote in a DA document must be inline-editable in
Experience Workspace (da.live canvas, "quick-edit") once generated block JS
has decorated the page — and the block must look the same while it is being
edited. Field finding (an energy-company site, 2026-09-03, two rounds: 3 blocks, then 17):
over a 29-page covering sample only 841 of 1452 authored texts were
editable; every template-slotted block was 0 %. The generated blocks were
correct implementations of the skill's own guidance (value-slotting,
`text(cell)`, clone-the-anchor) — the guidance was the bug. Mechanism
verified against da.live `editor-utils.js`/`prose2aem.js` and da-nx
`quick-edit.js`/`prose.js`; deploy improvement #123. Minor bump: new gate +
new qa check.

- **Deploy:** § Target runtime documents the workspace instrumentation
  (`data-prose-index` on outermost editables, `decorate()` re-runs over it,
  only surviving indices become editors). § 2b redefines template-slotted as
  **node-slotting** and bans value-slotting. § 3 ships three edit-mode
  foundation snippets (CTA repaint from `<strong>/<em>` marks under
  `.prosemirror-editor`, card-as-link inner anchor, `:where()` wrapper
  variants at equal specificity) + EW10 for section prose. § 5 Buttons,
  #55, #62/#71, #70 and § Section heads rewritten to MOVE authored elements.
  § 8 gets a move-based scaffold (`wrapNode`, `labelWrap`,
  `stripInstrumentation`) and the named **Experience Workspace editability
  contract (EW1–EW10)** with the gate command; Step-7 brief carries the
  contract; Local QA + Checklist gain the EW gate, edit-mode simulation,
  static review and pixel-parity lines; anti-patterns 18 (value-slotting)
  and 19 (class on the authored element); References cite the da.live/da-nx
  sources.
- **Scripts:** new `deploy/scripts/ew-editability-probe.mjs` (URL and
  `--content` harness modes, `--simulate-editor` drift report, `@ew-exempt`
  JSDoc tags); `block-roundtrip.mjs --ew` (default on) fails dead
  non-exempt texts and duplicated indices 🔴; `render-harness.mjs --ew
  --simulate-editor` + hides `body > header`; `section-schema.mjs` emits
  `editableTexts` per section; `content-inventory.mjs` exports the
  outermost-editable classifier and `content-diff` reports an
  `EDITABLE COUNT` advisory.
- **qa:** new `editability` check (`editability/dead-text` error,
  `editability/duplicated-index` warn, per-page summary; `--blocks-dir` /
  `--ew-exempt` for exemptions).
- **replica / rollout / reskin / migrate fidelity-tiers:** every block-authoring
  handoff cites the contract and the EW gate (the brief skipped it on 27/27
  blocks because it did not carry it).
- **Evals:** new `ew-editability` (node-slotting, move-not-rebuild,
  wrapper-descendant selectors, gate evidence, fidelity not traded).
- **Ledger:** deploy `IMPROVEMENTS.md` #123; master `reference/learnings.md`
  example entry.

## 0.18.5 — migration-flow routing: replica subsumes prepare-migration

Routing-surface fix, no pipeline behaviour change. Field finding
(an air-cargo site, 2026-09-03): asked "how do I migrate X to EDS with
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

## 0.18.4 — commerce-site field harvest: chrome crop gate, sizing-model lifts, EDS authoring traps

Harvest of three learnings ledgers from a five-design Magento-PageBuilder →
EDS migration (two sibling commerce sites, be/nl + nl, 2026-08, published-origin
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

Harvest of two independent replica+deploy sessions (an energy-company site and a healthcare-insurer site,
2026-08-26/27, on 0.18.2). Three failures recurred in BOTH sessions and lead
the release: a stale cross-project `:8791` server silently gated a foreign
site (once in each direction — every skill doc suggests the same port, so
collision on a shared machine is guaranteed); consent widgets missed by the
selector list (on the healthcare-insurer site the banner baked into ground truth AND all 7 stitch
seams → 32% false pixel diff, one gate round invalidated); and live-data
embeds (mirroring the SAME src cancels the data out in the pixel diff —
freezing a snapshot guarantees a widget-sized residual). All changes are
site-agnostic and additive; the high-impact-but-not-low-risk items
(shared-classifier element-boundary separators, stitch-shot `--fullpage`,
per-project default ports) are deliberately deferred with rationale in
`notes/improvement-plan-2026-08-replica-deploy.md`.

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

Harvest of a full `stardust:replica` e2e run (a financial-services site → EDS,
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
validated on real pages before codification — replica converged a typographic retail home page to
a 1.31% pixel diff with zero structural findings in 3 measured iterations;
reskin carried a healthcare site's content byte-identically (2281/2281 chars,
47/47 slots, 13/13 metadata) onto a payments-company donor's token system with 91% of
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
  shipping (replica: a furniture retailer, desktop converged to 1.06%; reskin:
  a university site × an analytics-vendor donor, 4883/4883 text bytes, 101/101 slot checks) and
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

A 10-site field test (replica: a furniture maker, a luggage brand, a fashion
retailer, an EV maker, a fashion house; reskin: botanic-garden×SaaS-donor PASS,
museum×messaging-vendor PASS, humanitarian-nonprofit×hosting-vendor)
produced an 18-finding ledger; all skill-wrong findings are folded:

- **Shared live-measurement hardening (F-G, F-R1, luggage-brand-1; HIGH).** New
  `diff/scripts/live-session.mjs` — the one home for hitting live sites to
  *measure* them, as robust as extract's capture engine: real-Chrome UA
  **plus the standard request headers** (Akamai fingerprints on the absence
  of `Accept`/`Accept-Language`/`sec-ch-ua`, so UA alone still 403s —
  reproduced on the humanitarian nonprofit's origin, fixed to HTTP 200; the same header set
  un-blocked the luggage brand's gate headlessly), challenge detection that **fails
  loud** (exit 3, never silently measured as the source), headed-stealth
  escalation, and two-class overlay dismissal (consent + timed marketing
  modals, the fashion retailer's `#wps_popup` case — CH-1). Consumed by diff's two
  probes, replica's stitch-shot, and reskin's three live-hitting scripts.
- **diff flags replace replica's 10 hand-edits (F-B).** `--ua`,
  `--wait-until`, `--dismiss`, `--headed`, `--locale` on both probes and
  visual-diff `--main`, backward-compatible for local/deploy use;
  `source-fidelity-gate.md` § Script adaptations rewritten — a hand-edited
  project copy is now a defect.
- **replica:** bounded `--single` entry gets a satisfiable promotion
  contract (`bounded-single` synthesis branch — luggage-brand-3); `--main body`
  banned with the 103-false-🔴 reproduction (F-C); hit-minimization +
  media-density iteration budget (luggage-brand-2, CH-2); mobile-@media-first and
  role-parity recreation guidance (CH-3/FH-2); locale pinning for capture
  determinism.
- **reskin:** ordered stream is now `innerText`-consistent by construction
  (F-R2 — the botanic-garden site's a11y ghost labels eliminated at the source; 8/8
  `orderedVerified` vs 5 false in the field) with a sanctioned documented
  fallback; `formControl` stream nodes carry select/option/input text
  verbatim (F-R3 — the humanitarian nonprofit's course form now fully reconstructable, 13/13
  verified); slot-coverage gains a paint assertion so an origin-locked CDN
  can't hide behind a passing URL-string gate (F-R4, the botanic-garden site's 19 unpainted
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
as a fatal capture-time `HTTPError`. Observed on a bot-challenged site during the 0.14.4
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

Validated end-to-end: patched crawler on the bot-challenged site auto-detects the challenge,
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
(site D (airline), site E (tools retailer), site A (healthcare), site F (nonprofit
shelter), site B (industrial conglomerate), site C (agency)), ranked by
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
