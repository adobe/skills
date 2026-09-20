# Delivery gates + batched delivery (Phase C)

The per-page checks Phase C runs before flipping a page to `deployed`, and the
batched-delivery flow that runs them uniformly at scale. SKILL.md Phase C names
each gate in one line; the mechanics live here.

**Two halves.** The gates split into a **static** pre-PUT lint
(`reference/delivery-lint.md` → `scripts/delivery-lint.mjs`: wrapper,
one-CTA-per-`<p>`, trailing-slash, path-safety — deterministic and offline) and a
**dynamic** post-deploy check (`scripts/verify.mjs` § typed render-truth: does it
actually render, typed by page/fragment/index). Run the static lint first — it
catches the cheap failures before a network round-trip. Gate 2 (image-fidelity)
has its own network resolver, `scripts/media-reconcile.mjs`
(`migrate/reference/media-reconciliation.md`).

## Gate 1 — Source-fidelity ("don't add sections the source doesn't have")

A migration reproduces the source; it must not invent sections. Invented
sections render as empty placeholders or, worse, get back-filled with fabricated
facts. This recurs as trailing **cross-link rails** (`related-*`, `*-teasers`),
**specialist/teaser grids**, and generic **trailing CTAs** appended to leaf pages
regardless of source.

```bash
node skills/rollout/scripts/section-fidelity.mjs \
  --file <content.html> --source <sourceUrl>   # authored vs source, side-by-side
```

The helper is a scaffold, not a judge: it lists authored block sections
(pre-flagging known filler shapes as `⟵ REVIEW`) against the source heading
outline. For each authored section decide:
- **HARD-FAIL → remove before `deployed`:** the section carries FABRICATED facts
  (invented names, made-up events/dates, boilerplate not on the source).
  Fabricated content on a real site is the worst migration defect.
- **Soft call:** an invented rail whose links all point to REAL pages — prefer
  remove; keep only as a plain text link-row if cross-linking is explicitly
  wanted, never as an image-card grid that needs assets to exist.
- **Pass:** the section backs a real source region.

Delete the section from the content file (and `git rm` the block if it becomes
orphaned). Genuinely-missing *real* content is different: leave the block, render
gracefully, log it as a content gap — do NOT invent filler.

## Gate 2 — Image-fidelity (every `<img>` src must RESOLVE, or be omitted)

The #1 recurring defect at scale: an authored external image URL the preview
ingester can't fetch delivers as `<img src="about:error">` — a silent break that
"it renders" hides. The systematic resolver is `media-reconcile.mjs` (it decides
optimize/keep/rewrite/omit per image and can `--apply` the fix); the manual
form, for a single image, is a 200 check:

```bash
node skills/rollout/scripts/media-reconcile.mjs --file <html> --deploy-host <host>   # all images
curl -s -o /dev/null -w '%{http_code}' <url>                                          # one image
```

If it isn't 200, OMIT the image (the block renders without it) rather than ship
`about:error`. Never author a logo/placeholder stand-in as if it were editorial.
Two failure signatures where the asset exists behind a malformed URL — fix the
URL, don't drop the image:
- **Wrong rendition variant** — the source exposes only a derivative that 404s
  (e.g. a portrait's `…/4x3/768/…` 404s; the `…/original/768/…` sibling
  resolves). Rewrite to the resolving variant.
- **Missing query delimiter** — a CDN URL built as `…/<id>&wid=600&hei=…` (no
  `?`) makes the whole `<id>&wid=…` a bogus asset id → 403. Repair the first `&`
  after the id to `?`.

After preview, the authoritative check is `.plain.html`: 0 `about:error` and the
expected `<img>`+alt count (CSS-background images are absent from it).

## Gate 3 — Path-safety (source paths must be AEM-Edge-safe, or normalized + redirected)

Real source URLs are not always valid EDS resource paths; DA accepts the `PUT`
(201) but preview/serve then 404s/400s, so this is invisible until verify. Before
deploy, normalize each path and, when it changes, record the original→normalized
pair so the source URL can be redirected (a final migration must not 404 inbound
links). Rules:
- lowercase the whole path;
- trim a trailing `-`/`_` in any segment;
- collapse `_`→`-` and runs of `-`;
- replace the `--` segment delimiter (e.g. `klinik-st--anna`) — AEM reserves `--`
  as the `branch--repo--owner` host delimiter, so a `--` in a path 400s.

Append each change to `stardust/redirects.tsv` (`source<TAB>destination`);
Phase D's `scripts/redirects.mjs` turns the sheet into `site/redirects.json`
with one row per request FORM of each source (extensionless, trailing-slash,
and `.html` when the source carried it — the platform serves a folder root on
one slash form only and inbound links arrive on both), refuses (exit 2) a
Source whose exact form equals a delivered path (it can only shadow the page),
and `--post-publish` HEADs every page and both slash forms of every folder
root. `verify.mjs` fails a folder root whose other slash form 404s: the fix is the
redirect row for the failing form; internal links keep the D9 canonical form
(root-relative, no slash, no extension) and the redirect covers the other.
Sheets keep `.json` in admin paths — the DA protocol
owns that rule.

## Gate 4 — Source-content hygiene (a sitemap roster contains dead and bodyless URLs)

At ~1000-page scale the roster comes from the source sitemap, which includes URLs
that **404 on the source** (stale entries) and pages with **no HTML body**
(PDF-only publication entries — a title plus a PDF download). Two rules:
- **Verify the source returns 200 before authoring.** A dead source URL is not a
  page to fabricate — leave it un-authored and let it show as the lone gap in the
  dashboard (e.g. 814/815). Never invent a body to fill the slot.
- **Bodyless/PDF-only source → author metadata + hero + the real download link,
  then STOP.** Don't pad with invented prose; the faithful page is a thin one, and
  that is correct. (Same root rule as Gate 1: reproduce the source, never
  out-author it.)

## Batched delivery at scale (clusters of 6–20+ siblings)

Separate the concerns so an agent crash or token blowout can't corrupt state, and
so the gates run uniformly:
- **Author-only agents, central deploy.** Each cluster agent reads its work-list +
  the cleaned archetype template and *only writes content files* — it does NOT
  deploy. The orchestrator deploys centrally (one idempotent `PUT`+preview loop):
  token stays in one place, retries are trivial, and a sub-agent dying mid-response
  leaves its files already on disk.
  **Token-bound halts park, never re-author.** When the central deploy (or any
  agent still holding a publish step) hits the `DA_TOKEN` halt class: authored
  files stay exactly where the plan put them (`content/**`) — never `/tmp` or
  an ad-hoc staging dir (a staged copy outlives the CSS it was built against
  and regresses on publish); write nothing but the `blocked` status line, whose
  `next` (`stardust/reference/run-status.md`) is the exact re-drive — the same
  `deploy-batch.mjs` command, `--paths` for a partial wave. An agent blocked
  at publish hands back with its local-harness gate result and
  "published-origin gate NOT run"; it never invents a publish path. On
  re-auth the coordinator runs `next`, then the published-origin gate on the
  newly delivered pages, and only then flips coverage — the ledger's POST
  codes never flip state ("Admin 200 ≠ delivered" below). Halt classes, exit
  codes and remedies: `skills/deploy/da-deploy-protocol.md` § DA_TOKEN lifecycle.
  Two look-alikes: a delivered-host `401 x-error: access-not-allowed` is the
  `access-restricted` halt (remedy `SITE_TOKEN_<REPO>` via `--site-token-env`, then
  the same `next`); ≥ 3 previously delivered pages answering 404 at startup is a
  content-bus reset — self-healing: the driver warns and re-drives them, no halt.
- **Validate structure BEFORE deploy.** Cheap deterministic check on every authored
  file — exactly one `<h1>`, the body/`<main>`/`<footer>` wrapper, balanced
  `<div>`s — catches a truncated/garbled file before it reaches DA.
- **Verify-THEN-flip, never flip blind.** Only flip to `deployed` after the rendered
  `.plain.html` passes (HTTP 200, 0 `about:error`, `<h1>` present). Verify is where
  the image- and path-fidelity defects surface at scale — a 4-page sample won't show
  them; a 130-page batch will.
- **Admin 200 ≠ delivered — verify the rendered URL, not the POST codes.** Some
  path-safety defects pass `PUT`+preview+live ALL 200 yet 404 at the delivery URL.
  The proven case: an **uppercase segment** (`.../CAR-T-Zellen`) — the admin API
  accepts and "publishes" it, but `*.aem.live/.../CAR-T-Zellen` 404s (delivery is
  lower-cased). The `PUT=201 PRE=4xx` heuristic MISSES it; Gate 3's "lowercase the
  whole path" prevents it at author time, and the GET-`.plain.html` verify is the
  only thing that catches it after the fact. Fix = rename to the lowercase path,
  redeploy, `DELETE` the stale uppercase DA source, add a redirect.
- **Long batches run in the background** (a 130-page `PUT`+preview loop exceeds a
  2-min foreground budget); the driver's ledger, repairs, progress file, `SUMMARY`
  line and exit codes (0/1/2/3): `skills/deploy/da-deploy-protocol.md` § Delivery
  pipeline and § DA_TOKEN lifecycle — read those, never `sleep N; grep -c` a log.
  Hash-skip: a `previewed`/`deployed` row whose ledger `bodyHash` equals the file's
  bytes is verified, never re-PUT (plan line `U unchanged (hash)`); a changed file
  always re-drives, a row without a hash is verified-then-skipped and backfilled.
  Gate mapping of the driver's verdicts: `PUT=201 PRE=4xx/400` → a path-safety case
  (Gate 3); a `200 + about:error` that PERSISTS after the driver's one re-preview →
  an image case (Gate 2); `body-invalid` / `overwrite-guard` → the authored file, not DA.
- **Shell and runner quirks** (zsh PATH loss in loops, bash 3.2, the 2-minute
  foreground cap): `../../stardust/reference/harness-quirks.md` § Shell · § Runner.

## Gate 8 — Published-origin page gate (the release condition; D1 instrument)

The archetype gate proves the recreation; **every delivered page** carries its
own published-origin number or is `ungated`. The instrument is
`scripts/gate-publish.mjs`; the release condition is the publish run reading
its report. The script never publishes. **Pending — deploy hunk:** the hold
inside `deploy-batch.mjs --publish` (report read, `held (gate: …)` plan
reasons, the two escape flags, the `held h` count) is the deploy cluster's
part of this gate and is not in this release; until it lands the operator (or
hands-off) reads `gate-report.md`'s held rows and passes `--paths` with the
PASS rows only — the condition below is the contract both halves implement.

```bash
node skills/rollout/scripts/gate-publish.mjs --all-delivered --origin https://<branch>--<repo>--<org>.aem.page   # every page (≤ 150 delivered)
node skills/rollout/scripts/gate-publish.mjs --sample 10 --seed <run-seed> --exclude <fix-loop slugs> --origin <preview>   # coverage regime, > 150
node skills/rollout/scripts/gate-publish.mjs --all-delivered --report      # offline: records → gate-report.{json,md} + delivery.gate
node skills/rollout/scripts/verify.mjs --gate-report stardust/rollout/gate-report.json   # Phase E: read, never re-judge
node skills/deploy/scripts/deploy-batch.mjs … --publish --paths <PASS rows>  # today: publish the PASS rows only; the report-driven hold is pending
```

- **Condition (what blocks).** On the explicit publish run a `previewed`
  ledger row is **held** — not `POST /live/`'d, status unchanged, plan reason
  `held (gate: 360 FAIL 12.4 % Δh -112)` / `held (gate: ungated)` / `held (gate:
  unmeasured — 124)` (pending, see above) — unless `gate-report.json`
  `pages[path].latest.pass === true`: PASS at **every configured breakpoint**, where PASS per breakpoint =
  the round record's own `pass` ∧ |Δh| ≤ 8 px ∧ header + footer crops pass
  `crop-compare` (no bar restated or configurable — B29). Already-`live` rows
  are never touched by the hold; their FAIL is reported `published-failing`
  (unpublishing is an owner decision). `gate-publish.mjs` exits 2 on any FAIL,
  0 when every measured page passes, 3 when a page is blocked (challenge /
  auth) — never on 124. Under `flow: replica` a row is `verified` only with
  `delivery.gate.status === 'pass'` (`coverage-model.md` § `delivery.gate`).
- **Escape hatches (operator / owner, never hands-off; both flags pending
  with the deploy hunk).** (a) `--publish-no-regression` — already-live rows only: a FAIL row whose every
  breakpoint is ≤ `bestOfLast3 + 1` point publishes, action recorded
  `published (no-regression: 1440 24.9→23.0)`, status stays
  `published-failing`. (b) `--publish-ungated` — rows with no report entry:
  redesign-flow sites and the `decisions.md` `publish` row owner-decided `live`
  (D16). (c) A named-class residual with `artifacts[]` + `acceptedBy`
  (`../../replica/reference/source-fidelity-gate.md` § Residual logging
  format) makes an over-bar breakpoint a PASS row in the report — the only
  residual door. No `--bar`, no threshold flag.
- **Hands-off.** Phase C previews, runs `gate-publish.mjs` over the delivered
  pages (the coverage regime below decides sample vs every page), then the
  publish run over exactly the PASS rows (today `--paths <PASS rows>`; the
  report-driven hold once the deploy hunk lands) and holds the rest; prints
  the report's coverage line `published-gated P of M · PASS p · FAIL f ·
  unmeasured u · ungated r` (+ `held h` from the publish run when shipped);
  writes `status: blocked` with the re-drive command when any row is held; **never** passes `--publish-ungated` or
  `--publish-no-regression`; never self-accepts an unnamed residual. D1 becomes
  mechanical, not judged; D16 kept — hands-off publishes only PASS rows.
- **No verdict ≠ FAIL (B32).** Exit 124 / 3 / 5 / 6 from an instrument →
  report status `unmeasured` (or `blocked`), row held with that reason, never
  counted as FAIL; `pixelPctUnmasked` is recorded beside the gated number as the
  `neutralDiff` KPI (reporting, not a bar — `handoff-report.md` § Reporting
  KPI), never substituted for it (B9).
- **Hit-minimisation.** Live side captured once per page × breakpoint
  (`gate.sh` `live.png` + sidecar, `anchor-live.json`), refreshed only by the
  24 h drift probe (`--refresh`); one `gate.sh` round at a time by default —
  `--concurrency 2` runs two rounds at once only over pages whose live capture
  is cached at every width (they run after the uncached pages); `--variance` (a second live hit) only
  where the gate doc names it. The prototype-regime cap and the published-origin
  cap are separate (labels `iter<k>` / `pub<k>` in the same gate dir).
- **Access-restricted previews.** `stitch-shot.mjs` accepts `--storage-state
  <file>` (an admitted session), but `gate.sh` and `gate-publish.mjs` do not
  forward it yet, so a site-token-protected preview cannot be stitched from
  the gate: gate on `aem.live` after an owner-decided publish, or wait for the
  pass-through — state the limitation in the report, never skip the gate.

### Coverage regime (which pages count as gated)

- **≤ 150 delivered pages:** the confirmation sweep (`sweep-protocol.md`
  step 5) is every page × every configured breakpoint through
  `gate-publish.mjs --all-delivered`.
- **> 150:** every archetype + a **seeded random sample per template**
  (`--sample <n ≥ 10> --seed <run seed> --exclude <fix-loop slugs>` — never the
  delivery-order head, never a page the fix loop touched; seed and draw recorded
  in the report), expanding n → 4n → all as class rounds close. Every other page
  is `ungated` until measured; a cheap geometry probe that ranks pages into the
  stitched gate is advisory until it lands.
- **A template is at the bar** when every sampled page PASSes at every
  configured breakpoint or carries a named-class residual; a template not at the
  bar is **not published** (its rows are held). Median / p90 / share < 10 % per
  template fill `neutralDiff` — reporting only; the pass bar stays per page with
  the existing bars (no aggregate threshold, B29). No-verdict rows are excluded
  from the sample counts.
- **Hands-off** stops at preview with the coverage line and the ranked class
  table (`stardust/scripts/class-report.mjs`), writes `status: blocked` with the
  exact re-drive, never publishes a template not at the bar.

## Gate 7 — Content-count acceptance (source vs imported role inventory, offline)

The cheapest gate in the flow and the one field runs skipped: static role
counts of the rendered source sidecar against the migrated page. Instrument:
`scripts/content-acceptance.mjs` (no browser, zero source hits). Hooks:
`migrate` Phase 2 after content preservation (a FAIL keeps the page out of
`migrated`), `rollout` Phase C step 2 beside `delivery-lint` (a FAIL is P1 →
no PUT).

```bash
node skills/rollout/scripts/content-acceptance.mjs --slug <slug>                 # one page (state.json pageMap → target)
node skills/rollout/scripts/content-acceptance.mjs --all --report-only          # bulk triage: records + summary.md, exit 0, no gatesPassed
node skills/rollout/scripts/content-acceptance.mjs --slug <s> --target-url https://<preview>/<path>.plain.html   # one delivery-origin hit
```

- **Condition (what blocks).** Source = `stardust/current/pages/<slug>.html`
  (from the capture JSON's `renderedHtml`) scoped to `main | [role=main]`
  (else `--source-main` + `--source-exclude`, recorded); target = the migrated
  HTML's `main` minus `.metadata` / `.section-metadata`. Classes: headings
  (level + text), links (text + normalised path), images (count — the pipeline
  renames `src`), list items, table rows, words. 🔴 = **any count drop** in a
  class not covered by a `_meta.json#contentDeviations[]` entry (the 0.18.2 rule,
  unchanged), or words ratio < 0.9; 🟡 = ratio > 1.1 (clones). Exit 2 on 🔴, 0
  pass, 1 usage / `unmeasured` (a side missing — never a pass, never a FAIL).
  PASS appends `"content-count"` to `gatesPassed[]` and writes
  `stardust/migrated/_acceptance/<slug>.json` `{class{source, emitted,
  dropped[], extra[]}, words{source, emitted, ratio}, tolerances, covered[],
  verdict}` + `_acceptance/summary.md` (classes ranked by pages affected).
- **Escape hatch.** A `contentDeviations[]` entry `{kind, source, target,
  reason}` whose `source` matches the dropped text / href / src downgrades it to
  `covered` — recorded, never silent. Tolerances only as explicit flags
  (`--tolerance links=0.1,words=0.1`), echoed in the record and the summary; no
  default relaxation. `--report-only` writes records and never `gatesPassed`. A
  compiler record with `skipped[]` fails on any class not in `--skipped-allow`.
- **Hands-off.** Nothing to resolve interactively: a failed page stays
  `failed` with the reason, is listed under `content-count: P passed · C covered
  · F failed · U unmeasured` in Phase H, and the run continues (one page never
  aborts the rollout). Hands-off cannot author deviations or tolerances.
- **Protected.** Zero source hits; ≤ 1 delivery-origin hit only with
  `--target-url`; bulk `--all` over thousands of pages runs in the background
  (exit 124 / 143 = killed, no verdict); no threshold changes (B29); the deploy
  ledger is untouched (pre-PUT); role-level drill-down of a failed page is
  `diff`'s `content-diff.mjs` (today against the live source URL — one source
  hit per drill-down; a capture-as-source mode is pending), not a second
  classifier (B26).

## Gate 5 — AI-readability (`code ≥ 98` on the delivered origin, per page)

Deploy's atomic contract names the gate per page; rollout runs it per wave and
ingests the artifact — never a typed number. Instrument:
`skills/deploy/scripts/ai-readability.mjs`; ingest: `update-coverage.mjs --gate
ai-readability <json>` (Phase C, preview origin) and `verify.mjs
--ai-readability <json>` (Phase E, live origin).

```bash
node skills/deploy/scripts/ai-readability.mjs --origin https://<branch>--<repo>--<org>.aem.page --paths <wave-paths> --min 98 --json stardust/rollout/ai-readability-<wave>.json
node skills/rollout/scripts/update-coverage.mjs --gate ai-readability stardust/rollout/ai-readability-<wave>.json
node skills/rollout/scripts/verify.mjs --ai-readability stardust/rollout/ai-readability-live.json   # Phase E, over every verified page (≤ 150) or listing pages + the Gate 8 sample
```

- **Condition.** After each Phase C wave's preview run, every page of the wave
  is scored on the **preview** origin (D1); `code < 98` → the row is `failed`
  (`error: "ai-readability code N < 98 — top: <blocks>"`) and is not in the
  `--publish` set. Phase E re-runs on **live** over every verified page (≤ 150;
  above: every listing/index page + the Gate 8 sample per template) and flips
  `code < 98` to `failed`. The bar is the artifact's own `min` (never retyped).
- **Unmeasured ≠ FAIL.** An `error` row (`served fetch HTTP 429`, a timeout) is
  `delivery.gates.ai-readability.unmeasured: true`: the row's status is
  untouched, it is counted, `verify` exits 2 ("incomplete") while any remain —
  a re-drive (sequentially, after the throttle window), never a pass, never a
  FAIL. The qa `ai-readability/unmeasured` severity stays `info`.
- **Escape hatch.** Per page: none. Per block: the instrument's `--allowlist`
  (block + string, never a page) and `--exclude-blocks`. A page that stays
  unmeasured is reported as such; the owner may close with a named `interim`
  line in `decisions.md` only for pages the report lists.
- **Hands-off.** No new auto-resolution: a `failed` readability page stays at
  preview (D16), the wave continues on the other pages, the close-out leads
  with the Readability line and the `failed` slugs go to `verify/summary.md`.
- **Phase H line** — computed from `rollout.json.lastRun.gates.ai-readability`,
  never typed: `Readability  strict median <n> · code median <n> · pages < 98:
  <n> · unmeasured: <n>`; the report cannot close with `< 98` or `unmeasured` > 0
  unless `decisions.md` names them. One instrument, one pass per phase (qa's
  check K remains the drift monitor).

## Gate 6 — Editability (Experience Workspace: dead non-exempt text = 0, duplicated index = 0)

The EW contract is measured, not asserted: every converted block passes
`block-roundtrip --ew` in deploy's Step 8 loop **and** the page passes one
whole-page probe. Instrument: `skills/deploy/scripts/ew-editability-probe.mjs`;
ingest: `update-coverage.mjs --gate editability <probe.json>` (page rows +
block rows in one call, T33.1's generic flag).

```bash
node skills/deploy/scripts/ew-editability-probe.mjs --content content/<page>.html --blocks-dir blocks --json > stardust/rollout/ew/<slug>.json   # harness
node skills/deploy/scripts/ew-editability-probe.mjs https://<preview>/<path> --blocks-dir blocks --json > stardust/rollout/ew/<slug>.json      # URL mode (a block imports modules)
node skills/rollout/scripts/update-coverage.mjs --gate editability stardust/rollout/ew/<slug>.json
```

- **Condition.** A page flips to `deployed` (and, transitively, into the
  `--publish` set) only with `totals.dead === 0` (dead text outside a declared
  `@ew-exempt`) and `totals.duplicated === 0`; `dead > 0` or `duplicated > 0` →
  `failed` (`error: "editability: dead N in <block>"`). The pass bar is deploy's
  own (`deploy/SKILL.md` Step 8 row), unchanged. Block rows: `blocks.json`
  `delivery.ewGate = pass | fail | exempt | unmeasured` (+ `ew{authored,
  editable, dead, exempt, duplicated}`) derived from the probe's `blocks[]` by
  `edsBlockName`, a block's worst page verdict winning; `coverage-model.md`
  § Block delivery status lifecycle: `converted` requires `ewGate ∈ {pass, exempt}`.
- **No verdict ≠ FAIL.** Probe exit 2 (a block failed to install / decorate —
  today every block with a static `import`) → `delivery.gates.editability.unmeasured:
  true`, status untouched, the page un-flippable, Phase E/H count it. Resolution
  until the harness resolves imports: URL mode against the dev-server harness or
  the **preview** origin (our host — never the source site) produces the verdict.
- **Escape hatch.** Only the declared one — `@ew-exempt` in the block JSDoc
  (EW5 categories; item-level tags). No `--skip-ew` / `--no-ew` on the contract
  row (`--no-ew` stays a `block-roundtrip` diagnostic). A CLI `--exempt a,b` is
  recorded `exemptSource: cli` and printed in Phase H, never silent.
- **Hands-off.** A failing block is a code defect fixed in the Step 8 loop ("fix
  by moving, never by weakening"); at the iteration cap the page records
  `--status failed --error "editability: dead N in <block>"` and the rollout
  continues, the page out of `--publish`. Hands-off runs the URL-mode fallback
  itself; unmeasured is never auto-resolved to pass. No owner decision involved.
- **Phase H line** — `Editability  <editable>/<authored> · dead <n> · exempt <n>
  · unmeasured <n>` from `rollout.json.lastRun.gates.editability`, never blank.
  Single-page deploy keeps its artifact at `stardust/deploy/ew-<page>.json`.
