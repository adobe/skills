---
name: qa
description: Read-only automated QA sweep of a deployed stardust site on AEM Edge Delivery Services — validates routing, content fidelity vs the source capture, template conformance, rendered integrity (geometry, JS errors, broken images), visual regression vs baselines, metadata/SEO/JSON-LD, link integrity, accessibility (axe), and performance budgets, then emits a findings report with an allowlist for documented non-defects. Finds issues; never fixes them. Use when the user asks to "QA the site", "validate the migration", "check the live site for issues", "run a QA sweep/regression check", or invokes `$stardust qa` (`/stardust:qa` in Claude Code) <live-url>.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and playwright-cli on PATH.
metadata:
  impeccable: none
---

# stardust:qa — read-only site QA sweep

## Operator card

Steps, in order: Setup (base URL, inventory source, optional inputs) → 1 deterministic sweep → 2 triage the ambiguous flags → 3 report → allowlist workflow. Read-only throughout.

| Step | Command |
|---|---|
| Setup | base from the user or `stardust/rollout/rollout.json` (`site.liveHost`); inventory = `stardust/template-map.json` ∪ paths file ∪ live `sitemap.xml`; append a line to `stardust/status.jsonl` at start/end |
| 1 | `node <plugin>/skills/qa/scripts/qa.mjs --base <live-url> --template-map stardust/template-map.json --scrape stardust/scrape [--expected-blocks <json>] [--parity <json>] [--auth-header … | --token-env SITE_TOKEN] [--blocks-dir <dir> | --ew-exempt a,b]` — caps/gates: `--checks <modules, or preset: delivery · rendered · parity>`, `--max-pages <n>`, `--fail-on warn`, `--baseline-reset`; pacing: `--fetch-concurrency 4`, `--browser-concurrency 2`, `--throttle-max 5` |
| 1 (no playwright) | `--checks delivery` |
| 1 (fleet > 100 pages) | `--checks delivery`, `--checks rendered`, `--checks parity` as separate, sequential invocations |
| 2 | judge only `content/verbatim-below-threshold` (`evidence.missingNodes`) and `visual/visual-diff` (`evidence.baseline` vs `evidence.current`, `bands`) |
| 3 | classes first (ranked table, `stardust/qa/summary.md`) → `report.html`; recommend, never apply |
| allowlist | `stardust/qa/allowlist.json` entries with a reason, only for user-confirmed non-defects |

Exit codes: 0 no active errors · 1 active errors · 2 infra failure **or incomplete** (throttled pages > `--throttle-max`; exit 2 wins — re-run). Triage flags are marked in `report.json`; a crashed check reports as `<check>/check-crashed`, a throttled page as `<check>/unmeasured`.

Outputs (under `stardust/qa/`): `inventory.json` · `report.json` · `summary.json` · `summary.md` · `report.html` · `shots/` · `baselines/` (first run; local, untracked) · `allowlist.json` (tracked); plus the `stardust/status.jsonl` line.

| At step | Read |
|---|---|
| Setup | `../stardust/reference/run-status.md` § Line shape; `../stardust/SKILL.md` § Artifacts you read and write |
| 1 | `reference/checks.md` § routing · § content · § templates · § rendered · § dynamics · § visual · § metadata · § links · § a11y · § perf · § editability · § ai-readability · § Cross-cutting |
| 1 (dynamics check) | `../dynamics/reference/parity-report.md` § Schema · § Rules |
| 1 (editability check) | `../deploy/SKILL.md` § Experience Workspace editability contract (EW1–EW10) |
| 1 (ai-readability check) | `../deploy/reference/ai-readability.md` § 1 · § 2. Two metrics · § 3. Cause classes and remediation |
| 2 | `reference/checks.md` § content · § visual |
| allowlist | `schemas/qa-allowlist.schema.json` |

Sections: Setup · Procedure · Read-only contract · Scheduling/CI.

One live URL in, one evidence-bound findings report out. **This skill never
edits anything** — site content, DA documents, repo code; its only writes are
report artifacts under `stardust/qa/`.

`qa` is the post-deploy counterpart of `rollout`'s delivery verification: rollout asks "did
every page ship?", qa asks "is everything that shipped correct?" at three layers:

1. **delivery** — what the pipeline serves (`.plain.html`, full HTML, sheets, sitemap)
2. **rendered** — what a browser shows after block decoration
3. **regression** — what changed since the last approved state (visual baselines)

A green upper layer never implies the lower one: publish 200 ≠ delivered ≠
rendered correctly.

## Setup

1. Run the master skill's setup (`skills/stardust/SKILL.md` § Setup) if not
   already done this session; `qa` also works standalone from a live base URL.
2. Resolve the **base URL** (`*.aem.live` host or production domain): from the
   user, else `stardust/rollout/rollout.json` (`site.liveHost`), else ask.
3. Resolve the **inventory source** (Operator card Setup row); the live `sitemap.xml` is
   always fetched and parity mismatches become findings, so a wrong sitemap cannot
   silently shrink coverage.
4. Optional inputs that unlock deeper checks:
   - `--scrape stardust/scrape` — verbatim fidelity vs the extraction capture
   - `--expected-blocks <json>` — explicit per-template block expectations
   - `--parity <json>` — dynamic parity file to replay (default
     `stardust/dynamics/parity.json`; the `dynamics` check reports
     `parity-missing` when absent)
   - `--auth-header "token …"` / `--token-env SITE_TOKEN` — protected
     origins; the secret is sent to the base origin only
     (otherwise derived by fleet consensus)
   - `--blocks-dir <dir>` — the site's `blocks/` checkout, so the
     `editability` check can honour `@ew-exempt` JSDoc tags (otherwise
     pass `--ew-exempt a,b` for index-driven blocks)
5. Browser checks need **playwright resolvable from the project** (`node_modules/playwright`);
   if missing, run `--checks delivery` and say what was skipped.
   The runner paces itself against the published origin (per-host cap, back-off on 429/503,
   `report.infra`); never run a gate and a sweep against the same host at once.
6. Append a phase-transition line to `stardust/status.jsonl` per
   `reference/run-status.md` (master skill) at sweep start/end.

## Procedure

### Phase 1 — deterministic sweep

```bash
node <plugin>/skills/qa/scripts/qa.mjs \
  --base https://main--<site>--<org>.aem.live \
  --template-map stardust/template-map.json \
  --scrape stardust/scrape
```

Writes `stardust/qa/inventory.json`, `report.json` (rewritten after every check,
`partial: true` until the sweep ends), `summary.json` + `summary.md` (class roll-up),
`report.html`, `shots/`, and (first run) `baselines/`. Exit codes: Operator card. Checks,
finding ids, severities: `reference/checks.md`; variants: Operator card row 1. `ai-readability` reproduces Adobe's AI Content Visibility Checker
per page (served ÷ rendered words), gap attributed per block (`deploy/reference/ai-readability.md`).

The `editability` check is the post-deploy **Experience Workspace editability gate**
(`skills/deploy/reference/block-js-scaffold.md` § Experience Workspace editability contract,
EW1–EW10); finding ids, severities and exemptions: `reference/checks.md` § editability.

First run on a site: a wave of `visual/baseline-created` info findings is the
baseline being established, not a defect. A page whose render was
not clean (collapsed `main`, a same-origin 429/503) gets `visual/baseline-skipped`
and no file — re-run. After an approved fix batch, `--baseline-reset` clears the
set so the fixes do not read as regressions. Baselines are local screenshots
(`stardust/.gitignore` excludes `qa/baselines/` and `qa/shots/`, master skill
§ Artifacts): later runs on the same machine diff against them; a fresh clone
re-establishes them. `qa/allowlist.json` is the tracked record of judgement.

### Phase 2 — triage the ambiguous flags (LLM judgment, still read-only)

The deterministic sweep marks two finding classes as *needs triage*; read
`report.json` and judge only those:

- `content/verbatim-below-threshold` — inspect `evidence.missingNodes` against
  the live page and the scrape capture: is copy actually lost/corrupted
  (defect) or acceptably transformed (candidate for the allowlist)?
- `visual/visual-diff` — open `evidence.baseline` and `evidence.current`
  side by side (they are PNGs; view them): real layout/style regression, or
  benign dynamism (carousel frame, loaded font, live embed)? `bands`
  evidence points the crop — read the band, never the stitched capture
  (`../stardust/reference/context-hygiene.md` § Image reads).

Record each verdict by **annotating the finding** in your summary to the user
(defect vs non-defect + why). Do not edit `report.json` scores; fix nothing.

### Phase 3 — report to the user

Report classes first, from the ranked table `qa.mjs` prints; page paths live in
`report.json` / `summary.md` (`../stardust/reference/context-hygiene.md` § Runner
reports and session hand-off) and are never listed in the conversation. Then
confirmed defects with one-line evidence, triaged-away flags with their
rationale, notable warns. Point at `stardust/qa/report.html`. Recommend — but
do not apply — fixes.

### Allowlist workflow (documented non-defects)

`stardust/qa/allowlist.json` (schema in `schemas/qa-allowlist.schema.json`)
keeps known non-defects from drowning every future run. Entries match on
check/id/path/messagePattern and **must carry a reason**. Allowlisted findings stay in the report, greyed out, so the
evidence is never deleted.

Only add an entry when the user confirms the flag is a non-defect (or it is
already documented as one in the project's records). Never allowlist to make
a run green.

## Read-only contract

- Writes only under `stardust/qa/` (plus the `status.jsonl` ledger line).
- Never invokes deploy/publish APIs, PUTs to DA, or edits blocks, styles or content.
- A crashed check appears in the report as `<check>/check-crashed` (error),
  never silently dropped.

## Scheduling / CI

Plain node, no plugin-runtime dependency: the same command runs from a GitHub Action or
cron for drift monitoring; `--fail-on` sets the gate. In CI without playwright, pin `--checks delivery`.
