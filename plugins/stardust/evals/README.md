# Stardust v2 evals

### 0.14.0 rescope notes

The 0.14.0 (Fable 5) refactor changes contracts that several criteria below
hard-pin. The eval definitions are left as-is for now; these criteria need
rescoping before the suite is run against 0.14.0:

- **`no_eds_references` (every eval).** Written when the plugin was
  platform-agnostic end-to-end. The plugin now has an EDS delivery half
  (`deploy`, `rollout`, `diff`, `prepare-migration`), so a plugin-wide EDS ban
  is wrong. Rescope to: the *core* artifacts (extract/direct/prototype/migrate
  outputs under `stardust/current/`, the target spec, prototypes, migrated
  HTML) must stay free of EDS/CMS leakage; delivery skills are exempt.
- **Two-question ceiling (`direct-from-phrase`).** ~~Still valid for the
  interactive flow, but 0.14.0 adds a hands-off production mode that asks
  *zero* questions and resolves ambiguity from captured evidence. Rescope the
  criterion to interactive invocations only.~~ **Rescoped (2026-07-22):** the
  criterion now pins the interactive contract explicitly (self-answered
  "would have been" questions fail), and the eval runner presents sessions
  with an `answers.md` persona as interactive so headless runs exercise that
  branch (see `runner/README.md`).
- **Closed-catalog criteria (uplift/prototype).** Any criterion asserting the
  agent picks strictly from a fixed catalog (e.g. the what-if candidate list)
  conflicts with 0.14.0's opened catalogs, which allow evidence-gated
  extensions. Rescope to: catalog-first, extensions permitted only with cited
  evidence from the brand surface.
- **Seed-roll direction procedure (`direct-from-phrase`).** ~~Direction
  research is now reference-grounded via the optional refero MCP, with the
  seed roll demoted to fallback; criteria that pin the seed roll as *the*
  procedure should accept the reference-research path as the preferred
  branch.~~ **Rescoped (2026-07-22):** `divergence_resolved` is now
  mode-aware (Mode A pins from the captured surface; Mode B / default uses
  the research-first procedure with the seed roll as fallback).
- **Extract cap + wait mode (`extract-multipage`).** **Rescoped
  (2026-07-24):** the eval was written against the 25-page default cap
  with a confirmation gate and the `networkidle + 1.5s` recipe. 0.14.0
  changed the default cap to 5 with a silent-proceed contract (kept +
  cut lists are informational, no yes/no gate) and made the wait
  strategy modal (default `medium` = `domcontentloaded` + 2s grace).
  `page_cap_confirmation`, `playwright_over_webfetch`,
  `discovery_before_crawl`, `current_design_md_direct` (impeccable's
  document.md now specs eight canonical sections, not six; omission of
  irrelevant sections allowed), and `state_json_shape` (`direction`
  may be `null` or `{resolvedAt: null}` at the extracted stage) were
  rescoped accordingly; `answers.md` (defaults-only persona, declines
  sibling brand sources) was added so the runner presents the session
  as interactive.
- **Coverage gaps (informational).** The suite predates `audit`, cross-site
  extraction (`--brand-source` / `--design-source`), vision gates, and the
  merge-by-slug parallelism contract; new evals are needed rather than
  rescoped ones.

Evaluation suite for the four-phase redesign pipeline plus the
"open and reasoned" intent-reasoning principle that governs the
master skill.

The v1 evals (`brand-extract-from-url`, `briefings-from-prompt`,
`prototype-iterate`, `stardust-navigator`, `wireframes-render`) were
tied to v1's stage decomposition (`brand` → `briefings` →
`wireframes` → `prototype`) and have been replaced wholesale to
match the v2 surface.

## Format

Each eval lives in its own directory and contains exactly two files:

- `task.md` — Setup, User prompt, Expected behavior. Human-readable
  scenario specification.
- `criteria.json` — Weighted scoring rubric in the tessl `weighted_checklist`
  schema (`tessl plugin publish` validates it): `context`, `type`, and a
  `checklist` of `{ name, max_score, description }`. The runner reads `name` as
  the criterion id and `max_score` as its weight; the total is the sum. Used by the eval runner to score the agent's
  output.

This format mirrors v1's structure (and the format other Adobe-skills
plugins use), so the eval runner that worked for v1 should work for
v2 evals without modification.

## Evals in this suite

| Directory                    | Stage tested              | What it pins down                                                                                   |
|------------------------------|---------------------------|-----------------------------------------------------------------------------------------------------|
| `extract-multipage/`         | Phase 1 (`extract`)       | Multi-page crawl with cap + Playwright (not WebFetch) + correct file shapes + direct authoring of current PRODUCT.md / DESIGN.md. |
| `direct-from-phrase/`        | Phase 2 (`direct`)        | Dimensional restatement + at most two questions + plan-before-execution + direct authoring of target spec + direction.md trace. |
| `prototype-before-after/`    | Phase 3 (`prototype`)     | One proposed file per page + `:root` block + data attributes + content preserved + delegates to `$impeccable craft` + opens in browser. |
| `migrate-incremental/`       | Phase 4 (`migrate`)       | Both render paths (A and B) + nested index.html output + content preservation + idempotent skip on re-run.                 |
| `migrate-multi-template/`    | Phase 4 (`migrate`)       | Three render branches (Path A / A′ / B) + canon + modules + bespoke-slot promotion + broken-link reporting + color-reservation refusal. |
| `migrate-self-contained-bundle/` | Phase 4 (`migrate`)   | Self-contained zip-and-deploy bundle — six asset detection shapes, nine edge cases, six acceptance criteria, state.json `migrate` block with `selfContained: true`. |
| `intent-reasoning-style/`    | Master skill principle    | "Open and reasoned" — vague phrases get clarified, never silently mapped to commands. Pending direction persisted.          |
| `replica-source-fidelity/`   | Entry point (`replica`)   | Mechanical preserve direction (no `direct`) + inconsistency register + clean re-authoring + the measured source-fidelity gate at both breakpoints + standard handoff. |
| `reskin-content-fidelity/`   | Entry point (`reskin`)    | Donor via `--design-source` + content-model capture with scope guard + mapping-brief contract (≥80% mapped) + programmatic render + dual content/design-adoption gates. |
| `ew-editability/`            | Entry point (`deploy`)    | Experience Workspace editability contract (EW1–EW10): node-slotting not value-slotting, authored elements moved into wrappers, wrapper-descendant selectors, `block-roundtrip --ew` + probe evidence, exemptions declared, fidelity not traded. |
| `ai-readability/`            | Entry point (`deploy`)    | AI readability (#100): presentational carousel clones, document-first index-backed listing, explicit fragment decision, no generated visible text, gate run and reported, correct checker facts (no hidden-text or chrome work for the score). |
| `routing-migration-flow/`    | Master skill routing      | § Two migration flows enforced: keep-design phrases → `replica` without a question, plain asks → one keep-vs-redesign question, redesign phrases → redesign flow; `flow` recorded in state.json; `prepare-migration` never loaded for keep-design; `migrate` never first; no hand-built pipeline. |
| `resume-state-report/`       | Master skill resume       | § Routing "No argument" / resume: state report first (`Flow:` line + per-archetype gate numbers from `progress.json`), journal `Next:` quoted and checked against state, replica-flow recommendation (ungated archetype → `replica <archetype>`), nothing written, next phase entered through its skill, heading-list before any skill-file read (W1 target). |
| `runner-output-contract/`    | Batch reporting (`rollout` Phase E) | Runner-output contract on an offline full-site verify: ranked class table (class → count → worst example → file pointer) in the conversation, full per-page listing in `summary.json` + `summary.md` under `stardust/rollout/`, triage per class, hand-off names the summary files (rule: `context-hygiene.md` § Runner reports). |
| `preflight-credentials/`     | Entry point (`deploy`)    | W1 pre-flight: token (present, unexpired, looked up through env → `.env` → `~/.claude/.env`), pushable code branch and scaffold are checked before any conversion work; one consolidated missing-prerequisite list with exact remediation; token value never printed; no push, no DA write, no fabricated token, no silent skip; `blocked` recorded in status.jsonl. |
| `site-bootstrap-missing-origin/` | Entry point (`deploy`) | No EDS origin (no `fstab.yaml`, repo absent): the transport probe ran before any conversion work and reported the absent repo; `deploy/reference/site-bootstrap.md` was read before any `gh`/`curl` mutation; exactly one owner question carrying the `target` default; every remote-creating command printed before it ran; on the denial one `blocked` line whose `owner:` is the exact command, `Blocked on owner:` first in the reply, no variant retry, no fabricated preview URL, no DA `PUT`; no token value or env-file dump. |
| `preflight-credentials-expired/` | Entry point (`deploy`) | The instrument half of pre-flight: `da-token-check.mjs --credentials` runs before any conversion work and its verdict (exit 2, class-named refresh remedy) is the evidence; `state.json.credentials` written in the shipped shape (`da: expired`, `daSource: repo-env`, exact-match `siteTokenEnv`, `gh: skipped`); zero requests (decode proves expiry); one consolidated stop; no hand decode, no token value, no env dump. |
| `phase-checkpoint-next-command/` | Phase close (`direct`) | Checkpoint block at phase end: completed files (all `ls`-verifiable) + a verified part + ONE verbatim next command + what a re-run would skip; journal `Next:` and `status.jsonl` `next` carry the same command; pages `extracted` → `directed` (rule: `run-status.md` § Phase close). |

## Coverage map

| Layer of the v2 design                       | Covered by                                                       |
|----------------------------------------------|------------------------------------------------------------------|
| Layer 1 — intent abstraction (open + reasoned) | `intent-reasoning-style`, `direct-from-phrase`                  |
| Layer 2 — navigator orchestrator (4 phases)  | `extract-multipage`, `direct-from-phrase`, `prototype-before-after`, `migrate-incremental` |
| Layer 3 — migration tooling (per-page, incremental, idempotent) | `migrate-incremental`, `migrate-multi-template`                |
| Layer 3 — migrate output contract (self-contained bundle)   | `migrate-self-contained-bundle`                                 |

The cross-cutting properties are pinned across multiple evals:

- **Hard impeccable dependency** — every eval expects the master
  setup to verify impeccable before proceeding.
- **Direct authoring** (no interview duplication via `$impeccable
  teach` / `document` for files stardust seeds) — checked in
  `extract-multipage` and `direct-from-phrase`.
- **Provenance everywhere** — each eval has a provenance criterion.
- **No EDS / framework / CMS leakage** — every eval has a
  `no_eds_references` criterion.
- **Stale-on-direction-change** — covered in
  `migrate-incremental` (the eval can be extended later with a
  re-direct mid-run scenario; for v0.2.0 we test the idempotent
  baseline).

## Running

The eval runner is not bundled with this plugin (it lives elsewhere
in adobe/skills). Each eval is self-describing: a runner reads
`task.md` for the scenario, executes it against a clean stardust
project, and scores the output against `criteria.json`.

A criterion passes if its `description` is satisfied as judged by
the runner. Per-criterion verdicts are combined as a weighted sum
out of `total` (100 per eval).

### Lints

`npm run lint:stardust` (repo root) runs the static checks below over `skills/`,
each a plain ESM script under `lint/` that exits 1 with one line per finding,
then the fixture tests under `fixtures/` (plain `node:assert` scripts that
import a script's exported pure functions — no playwright needed), the
`*.test.mjs` runners beside the skill scripts, and one `node --test` suite
whose harness cases skip when Playwright is unresolvable:

- `harness-neutral.mjs` — no namespaced sibling-skill references or
  Claude-only tool names outside lines marked "Claude Code".
- `script-paths.mjs` — every plugin-internal script or reference path a
  skill doc names exists in the plugin tree. `--installed [<dir>] [--strict]`
  is the cross-plugin pass: the five impeccable cite forms (impeccable's
  `reference/<x>.md`, `scripts/command-metadata.json`, `scripts/impeccable
  <verb>`, `$impeccable <cmd>`, `npx impeccable`) resolve against an
  impeccable skill dir — the registry install locally (`<dir>` omitted),
  `.impeccable-upstream/skill` in CI (`validate.yml`, advisory
  `::warning` step), `--strict` (exit 1) on the release checklist; exit 2 =
  no skill dir found.
- `deploy-lint-fixtures.mjs` — runs `deploy/scripts/davids-model-lint.mjs` over
  `lint/fixtures/davids-model-lint-shapes/` and `deploy/scripts/block-lint.mjs`
  over `lint/fixtures/block-lint/`, pinning the pipeline-shape codes (TABLE,
  branch-host / protocol-relative D4, STYLE-SPACE, JSON, SOLE-EMPH, META,
  HBR, TEXT-LEAK, TEXT, CHROME, CONTENT) and the block codes (BL-CSS,
  BL-MEDIA, BL-GUARD, IMG-HARDCODED with `@fixed-asset`), their tiers and
  exit codes, against a clean page and a clean block that must stay silent.
- `block-lint-ew-fixtures.mjs` — runs `deploy/scripts/block-lint.mjs` over
  `lint/fixtures/block-lint/{fail-ew,pass-ew,exempt-ew}`: every EW-* code fires
  on its signature with the right tier and count (exit 2), the scaffold shape and
  the #79 classify-by-cell shapes (class from a cell word, attribute interpolation,
  empty-slot templates) stay silent (exit 0), and a declared item-level
  `@ew-exempt` caps a 🔴 to 🟡 with the reason appended (exit 0).
- `pipeline-mimic-fixture.mjs` — `deploy/scripts/pipeline-mimic.mjs --self-test`
  (the every-rule probe pair equal after normalisation, idempotent on both
  `.plain.html` fixtures, the recorded delivered shape passed through untouched,
  the normaliser hiding `<source>`/media hashes/dimensions), its `--help` and
  usage exits (0 / 1), `--no-<rule>`, `--style-split`, and `build-harness.mjs`
  emitting `<meta>` tags plus the counts line.
- `node --test deploy/scripts/test/ew-editability-probe.test.mjs` — the probe's
  pure parts (`@ew-exempt` parsing anywhere in the file, item matching, `--strict`
  findings) and `block-roundtrip --help` / flag-first parsing always run; the
  harness cases (real module install on the synthetic origin, external-origin
  abort ledger, 404 → exit 2, `--strict` exit 1) are SKIPPED, not failed, when
  `loadChromium()` cannot resolve Playwright.
- `node --test deploy/scripts/test/ai-readability-landmarks.test.mjs`,
  `node --test deploy/scripts/test/harness-skip.test.mjs` — the checker's
  `LANDMARKS` selector list (nav/header/footer plus `aside`, `complementary`,
  `search`; no duplicates) and the harness self-skip contract: a resolvable
  Playwright with no browser binary makes the probe suite print one `SKIP`
  line and exit 0 (its pure cases still run); the fixture itself SKIPs when
  Playwright is unresolvable.
- `deploy/scripts/test/pipeline-probe.test.mjs` — `pipeline-mimic.mjs --compare / --probe`:
  the shipped fixture pair → every rule `match`, `multiValueStyle comma`, `spaceStyle
  hyphen-joined`, `zwspSurvives true` merged into a contract whose other keys survive; a
  first-token-only plain → exit 3 with `sectionMeta differ` / `first-only` (D7's
  fixture-verify), split tokens → `spaceStyle split`, a dropped ZWSP paragraph → `false`;
  `--probe` without a token → exit 2 and the contract byte-identical; against the deploy-batch
  mock the request order is PUT → preview → GET → DELETE ×2 (never `/live/`), `--record`
  rewrites the fixture copy, preview 500 / plain 404 → exit 2; `contractStyleSplit()`.
- `deploy/scripts/test/lint-changed.test.mjs` — `code-sync-verify.mjs --lint` on a
  boilerplate-shaped temp project (no `"type":"module"`) with shim eslint/stylelint in
  `node_modules/.bin`: the ESM-safe syntax stage catches a duplicate `const` that plain
  `node --check` passes (pinned), a missing toolchain or a `Failed to load parser` is exit 2
  "unavailable" never clean, `--syntax-only` prints the journal line and still runs syntax,
  only the files the run touched (changed + untracked) reach the tools, findings in them
  block (exit 2) while warnings pass, `--fix` is forwarded.
- `deploy/scripts/test/code-sync-verify.test.mjs` — `code-sync-verify.mjs` against a temp
  git repo with a bare origin, a gzip origin and a fake admin: served == tree → 0 with one
  row per path and the `ok` record; a pushed change the origin serves stale → 124 (never 2)
  with `/code/` then `/cache/` for that path only; dirty or unpushed code paths → 3 with zero
  requests; admin 401 → 2; `--no-purge`; a served 404; missing token → 2 before any POST; and
  `deploy-batch --require-code-synced` refusing (exit 3, no ledger file) on a missing, other-ref
  or pending record while an `ok` record lets the drive run.
- `deploy/scripts/test/da-token-check.test.mjs` — `da-token-check.mjs` against a temp
  HOME and a mock DA list: resolution order (shell > `./.env` > `~/.claude/.env` >
  `~/.env`, class printed, value never), IMS `created_at`+`expires_in` vs plain `exp`
  vs undecodable (unknown → advisory), smoke 200 / 401 / 403 / 5xx / network (exit
  0 / 2 / 2 / 1 / 1), zero requests on a proven-expired token, `--need`, and the
  `--credentials` block (exact `SITE_TOKEN_<SLUG>` match — never a prefix — state
  merge keeping other keys, GH_PAT probe ok / expired / skipped).
- `doc-size.mjs` — byte caps on `SKILL.md` and `reference/*.md`, an
  `## Operator card` heading ahead of the procedure, the always-on total and
  the per-skill delta versus the last release tag; its temporary allowlist
  must shrink with each release.
- `davids-model-lint-fixtures.mjs` — runs `deploy/scripts/davids-model-lint.mjs`
  over `lint/fixtures/davids-model-lint/` and pins the icon/variant rule tiers
  (ICON-PREFIX, ICON-MISSING, VARIANT-COLLIDE), the once-per-token report and
  the exit codes (2 on 🔴, 1 on a usage error, 0 on a legitimate page).
- `impeccable-dep.mjs` — every `SKILL.md` declares `metadata.impeccable`
  (`required` | `optional` | `none`); a `none` skill's docs carry no
  `$impeccable <cmd>` invocation (lines or fences marked `impeccable-dep:
  ignore` exempt), a `required` skill's carry at least one, and the
  `compatibility:` clause matches the level.
- `permissions-shapes.mjs` — the permissions-snippet generator runs, emits
  valid JSON, and every script path it or the harness-permissions card names
  resolves to a shipped file.
- `flag-parity.mjs` — every `--flag` a doc passes to a `<skill>/scripts/*.mjs`
  (named with `.mjs`, or as a bare span-initial command such as
  `block-roundtrip --ew`) has a case in that script's parser; every backticked
  lint rule id on a lint/finding/script line is a string some script emits; a
  documented numeric default (the extract page cap) equals the parser's;
  `--docs <dir>` scans a fixture tree instead of `skills/`.
- `flag-parity.test.mjs` — drives `lint/fixtures/flag-parity/`: a bare-name
  flag, an unknown rule id and an `.mjs` flag with no parser case each fire
  once; basenames used as words (`plan`, `inventory`), caps tokens on prose
  lines, skill invocations (`$stardust qa`) and non-initial bare names are
  silent; a resolved `CROSS_LANE_PENDING` entry is stale (exit 1); `--help`
  prints the header only.
- `launch-ladder.mjs` — the bot-management ladder (`TIERS`, stealth and
  off-screen args, `launchTier`) is identical in `live-session.mjs` and
  `crawl.mjs`, and no other script contains `headless: false`.
- `broad-git-add.mjs` — no `SKILL.md`, `reference/*.md` or `scripts/*` file
  contains `git add -A` / `git add .` / `git add --all` (the master's own
  `never …` prohibition passes); the rule lives in stardust/SKILL.md § Hands-off
  mode.
- `forbidden-phrases.mjs` — no `skills/**/*.md` or `evals/**/*.md` line
  (recorded `runner/results/` excluded) contains the abolished over-bar
  wording "pass with an asterisk" (forbidden-phrases: ignore — this bullet);
  the rule now reads FAIL → blocked in replica's source-fidelity-gate.md.
- `fixtures/crawl-slugify.test.mjs`, `fixtures/crawl-log-merge.test.mjs` —
  pin crawl.mjs's slug derivation (root → `index`, 200-char cap, `-<hash4>`
  collision suffix) and the append-only `_crawl-log.json` merge.
- `fixtures/crawl-progress.test.mjs` — crawl.mjs's completion contract:
  `--progress` / `--no-progress` and the default
  `stardust/.work/extract/crawl.progress.json`, the progress helper
  resolving from the plugin tree; the one-page e2e (progress file + last-line
  `SUMMARY crawl …`) runs when playwright resolves, else one `SKIP` line.
- `sleep-poll.mjs --self-test` — no `skills/**/*.md` line teaches the
  `sleep N; tail|grep -c|cat|pgrep` poll (a line saying `never` is the
  prohibition and passes; `sleep-poll: ignore` exempts). 🟡 advisory this
  release (`--strict` fails); the self-test over `lint/fixtures/sleep-poll/`
  (bad.md fires, good.md silent) is the rule's own negative fixture.
- `gate-batch-fixtures.mjs` — `replica/scripts/gate-batch.mjs` over a stub
  gate.sh (`lint/fixtures/gate-batch/`): pairs.tsv parsing (duplicate
  slug@width refused), verdict mapping (0 ok · 2 failed · 124/3/5/6 noverdict,
  never failed), the pooled sweep's table + last-line `SUMMARY` + progress
  JSON, batch exit 2 over 124 over other codes, `--dry-run`, usage 125.
- `fixtures/live-budget.test.mjs`, `fixtures/live-session-flags.test.mjs`,
  `fixtures/live-session-goto.test.mjs` — the shared live budget / lock
  (pacing, bare-429 persist + TTL, lock refuse/force/stale), every
  live-session importer's session flags (`--storage-state` / `--fresh-state`
  / `--solve-wait`, trailing-flag guard, live-budget.mjs named in Setup),
  and gotoLive's duck-typed contract (429 path, edge-signed challenge,
  `--solve-wait` poll, challengeMarker mirror, captureSanity).
- `redirects-smoke.mjs` — runs `rollout/scripts/redirects.mjs` over
  `lint/fixtures/redirects/redirects.tsv`: the row expansion, the exit-2
  shadow verdict (a Source that is also a delivered page) and `--check`
  writing nothing.
- `replica-capture-fixtures.mjs` — static contracts always (`node --check`,
  `bash -n`, exit-5 / integer-scroll / opacity-hide / route.fallback greps,
  the pure live-session and review-image exports); browser fixtures for
  stitch-shot, dismissOverlays (incl. the sticky-header negative),
  `--block`, mask rects (`--mask-sel/--mask-iframes/--mask-images` → `masksRects[]`)
  and the compare side (`--mask-from`, paired images only, `photo-dominated`,
  `--masks-json` validation), pixel-compare offsets + review, anchor `--landmarks` and gate.sh
  (landmark cache, `anchor-live.skip`) when `STARDUST_GATE_DEPS=<dir>/node_modules`
  (or the repo-root `node_modules`) resolves playwright + pngjs + pixelmatch,
  else one `SKIP` line.
- `dynamics-recall.mjs` — detector recall over `_shared/dynamics-recall/`:
  the reach half (sidecar signals → `reach-only` rows, and the sidecar
  fields `crawl.mjs` must keep writing) always runs; the depth half
  (`dynamics-detect.mjs --urls --offline` over the fixture pages) runs only
  without `--static`, and is skipped with a notice when playwright is not
  resolvable from the cwd. `lint:stardust` chains it with `--static` — the
  chain mode, no browser and no SKIPPED line; run the full eval from an EDS
  project before a dynamics release.
- `dynamics/scripts/test/reach-fields.test.mjs` — the sidecar contract without
  the eval (no browser): `objectLiteralKeys` over one-line / multi-line /
  nested / commented `dynamicDom` literals, the first-`}` regex it replaced
  (positive control and the miss), `REACH_SIDECAR_FIELDS` ⊆ `crawl.mjs`'s real
  literal, `maskLiterals` shape.
- `qa/scripts/test/throttle.test.mjs`, `qa/scripts/test/browse-throttle.test.mjs`
  — the 429/503-as-infrastructure path against a local `node:http` server:
  paced retries, `<check>/unmeasured`, the per-host limiter (AIMD, timeout
  armed after the slot), cache eviction, `report.infra` / exit 2, `gotoPaced`
  on a fake page (retries counted); the browser half of the second (document
  retried, throttled sub-resource → `rendered/unmeasured`) skips without
  playwright. `qa/scripts/test/browser-unmeasured.test.mjs` sits beside them:
  the browser checks beyond browse's document retry (decoration stall on a
  throttled page → one row, `perf/unmeasured`, ai-readability through the
  limiter, `infra.retries` from paced navigations) — SKIP + exit 0 without
  playwright.
- `diff/scripts/test/live-budget.test.mjs` — `live-budget.mjs`'s header claims
  (its `Importers:` line equals the scripts that import it; every listed
  export exists; importing runs nothing).
- `rollout/scripts/delivery-lint.test.mjs`, `rollout/scripts/inventory.test.mjs`,
  `rollout/scripts/verify.test.mjs` — the pre-PUT mirror rules and the
  chrome-variant guard both directions (fires on the named shape, silent on a
  clean page); typed inventory rows seeded + preserved, `--redirects`
  deployedPath, sitemap = live page rows; the runner-output contract on the
  shared fixture, link classes, 429/503 retry → `unverified` / exit 2, and the
  last-line `SUMMARY verify …` (throttled rows as `noverdict`).
- `replica/scripts/gate-ledger-lint.test.mjs` — the gated-archetype
  precondition as an instrument over the shared post-migrate fixture (program
  never gated, article over the bar with unnamed residuals → blocked; landing
  ok) plus synthetic ledgers: `<bp> missing`, `pass: true` typed over |Δh| 8,
  `pageTypes{}` alias, unknown shape → exit 1, named-class residuals with
  `artifacts[]`/`acceptedBy` (hands-off-policy permanent only, `register:R-nn
  <description>`), motion + roster, `--published` coverage, and the gate doc's
  § Residual classes intro stating the same cause grammar.
- `rollout/scripts/update-coverage.test.mjs` — `--from-ledger`: the merge
  rules, `deployedPath` written only from a served (`live|previewed`) row,
  unmatched paths listed not invented, idempotence, exit codes; and that
  rollout/SKILL.md + da-deploy-protocol.md both name `--from-ledger` as the
  reconcile.
- `deploy/scripts/test/deploy-batch-ledger.test.mjs`, `…-repairs.test.mjs`,
  `…-halt.test.mjs`, `…-persist.test.mjs`, `deploy/scripts/test/served-check.test.mjs`
  — the driver against `mock-da.mjs`: ledger idempotence + SUMMARY / progress
  file, blip repairs, the 401 / access halt (and lib.mjs header claims naming
  only files that exist), a rejected checkpoint surviving the persist chain and
  webPath drive order, served-check's 124 (no verdict) vs 1 (served verdict).
- `impeccable-probe-fixtures.mjs` — runs `stardust/scripts/impeccable-version-check.mjs
  --probe/--state` and `script-paths.mjs --installed` over
  `lint/fixtures/impeccable-layout/` (4.1.3 legacy-launcher, 4.3.1 and a
  drifted layout; docs-fail / docs-pass cite sets; the real `skills/` tree):
  pins the probe line shape, `--local` accepting the plugin root or the skill
  dir itself, the `state.json#impeccable` keys (other keys preserved, an
  unparsable file untouched, an absent file never created), the rewrite rule
  (only on a changed probe, `probedAt` older than `--max-age` / 24 h, or
  `--refresh`; a non-numeric `--max-age` warns and falls back) and that
  `reference/state-machine.md` states it, the lint's launcher verbs derived
  from the install's own code (never a hard-coded list, never prose), cites
  read from code only (spans, fences, indented blocks; a stray backtick is a
  literal), and the exit codes (probe always 0; lint 0 advisory / 1 `--strict`
  / 2 no install dir).

## What stardust v2 evals deliberately do NOT test

- **Visual quality of the redesigned output.** That's
  `$impeccable critique` and `$impeccable audit` territory; running
  them as a side effect of a stardust eval is not the right boundary.
  A redesign that is technically correct (passes all criteria) can
  still be ugly; that's a different evaluation.
- **Specific brand outcomes.** The evals pin the *procedure* and the
  *artifacts*, not whether the resulting brand identity is "good for
  Stripe" or "young enough" — those are user judgements.
- **Live URL availability.** The `extract-multipage` eval uses
  stripe.com as a stable, public, well-structured target. If
  stripe.com changes structure dramatically the eval may need
  updating; that's expected maintenance.
