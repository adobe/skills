---
name: qa
description: Read-only automated QA sweep of a deployed stardust site on AEM Edge Delivery Services — validates routing, content fidelity vs the source capture, template conformance, rendered integrity (geometry, JS errors, broken images), visual regression vs baselines, metadata/SEO/JSON-LD, link integrity, accessibility (axe), and performance budgets, then emits a findings report with an allowlist for documented non-defects. Finds issues; never fixes them. Use when the user asks to "QA the site", "validate the migration", "check the live site for issues", "run a QA sweep/regression check", or invokes `$stardust qa` (`/stardust:qa` in Claude Code) <live-url>.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, playwright-cli on PATH, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
---

# stardust:qa — read-only site QA sweep

## Operator card

Steps, in order: Setup (base URL, inventory source, optional inputs) → 1 deterministic sweep → 2 triage the ambiguous flags → 3 report → allowlist workflow. Read-only throughout.

| Step | Command |
|---|---|
| Setup | base from the user or `stardust/rollout/rollout.json` (`site.liveHost`); inventory = `stardust/template-map.json` ∪ paths file ∪ live `sitemap.xml`; append a line to `stardust/status.jsonl` at start/end |
| 1 | `node <plugin>/skills/qa/scripts/qa.mjs --base <live-url> --template-map stardust/template-map.json --scrape stardust/scrape [--expected-blocks <json>] [--parity <json>] [--auth-header … | --token-env SITE_TOKEN] [--blocks-dir <dir> | --ew-exempt a,b]` — caps/gates: `--checks <subset or preset: delivery · browse · parity>`, `--max-pages <n>`, `--fail-on warn`, `--baseline-reset` |
| 1 (no playwright) | `--checks delivery` |
| 1 (fleet > 100 pages) | `--checks delivery`, `--checks browse`, `--checks parity` as separate, sequential invocations |
| 2 | judge only `content/verbatim-below-threshold` (`evidence.missingNodes`) and `visual/visual-diff` (`evidence.baseline` vs `evidence.current`, `bands`) |
| 3 | summarize by severity → `stardust/qa/report.html`; recommend, never apply |
| allowlist | `stardust/qa/allowlist.json` entries with a reason, only for user-confirmed non-defects |

Exit codes: 0 no active errors · 1 active errors · 2 infra failure. Findings that need triage are marked in `report.json`; a crashed check reports as `<check>/check-crashed`.

Outputs (under `stardust/qa/`): `inventory.json` · `report.json` · `report.html` · `shots/` · `baselines/` (first run; local, untracked) · `allowlist.json` (tracked); plus the `stardust/status.jsonl` line.

| At step | Read |
|---|---|
| Setup | `../stardust/reference/run-status.md` § Line shape; `../stardust/SKILL.md` § Artifacts you read and write |
| 1 | `reference/checks.md` § routing · § content · § templates · § rendered · § dynamics · § visual · § metadata · § links · § a11y · § perf · § editability · § ai-readability · § Cross-cutting |
| 1 (dynamics check) | `../dynamics/reference/parity-report.md` § Schema · § Rules |
| 1 (editability check) | `../deploy/SKILL.md` § Experience Workspace editability contract (EW1–EW10) |
| 1 (ai-readability check) | `../deploy/reference/ai-readability.md` § 1 · § 2. Two metrics · § 3. Cause classes and remediation |
| 2 | `reference/checks.md` § content · § visual |
| allowlist | `schemas/qa-allowlist.schema.json` |

Sections: Setup · Procedure · Read-only contract · Scheduling / CI.

One live URL in. One evidence-bound findings report out. **This skill never
edits anything** — not site content, not DA documents, not repo code. Its only
writes are report artifacts under `stardust/qa/`. If the user wants findings
fixed, that is a separate, explicit follow-up outside this skill.

`qa` is the post-deploy counterpart of `rollout`'s delivery verification: where
rollout asks "did every page ship?", qa asks "is everything that shipped
actually correct?" — at all three layers a deploy can silently break:

1. **delivery** — what the pipeline serves (`.plain.html`, full HTML, sheets, sitemap)
2. **rendered** — what a browser shows after block decoration
3. **regression** — what changed since the last approved state (visual baselines)

A green upper layer never implies the lower one: a publish 200 ≠ delivered,
delivered HTML ≠ rendered correctly.

## Setup

1. Run the master skill's setup (`skills/stardust/SKILL.md` § Setup) if not
   already done this session. `qa` works standalone too — it only needs a live
   base URL.
2. Resolve the **base URL** (the `*.aem.live` host or production domain). If
   the user didn't give one, look in `stardust/rollout/rollout.json`
   (`site.liveHost`) or ask.
3. Resolve the **inventory source** — what pages the sweep covers, merged from
   any of: `stardust/template-map.json` (also supplies template assignments for
   conformance), a paths file, and the live `sitemap.xml` (always fetched;
   parity mismatches become findings, so a wrong sitemap can't silently shrink
   coverage).
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
5. Browser checks need **playwright resolvable from the project** (`node_modules/playwright`).
   If missing, run `--checks delivery` and tell the user what was skipped.
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
`partial: true` until the sweep ends), `report.html`, screenshots under
`stardust/qa/shots/`, and (first run) visual baselines under
`stardust/qa/baselines/`. Exit 0 = no active errors, 1 = active errors,
2 = infra failure. `reference/checks.md` documents every check, its finding
ids, and severity rationale. Variants: Operator card row 1. The `ai-readability` check
reproduces Adobe's AI Content Visibility Checker per page (served words ÷ rendered words) and
attributes the gap per block (`deploy/reference/ai-readability.md`).

The `editability` check is the post-deploy **Experience Workspace editability gate**
(`skills/deploy/reference/block-js-scaffold.md` § Experience Workspace editability contract,
EW1–EW10); finding ids, severities and exemptions: `reference/checks.md` § editability.

First run on a site: expect a wave of `visual/baseline-created` info findings —
that is the baseline being established, not a defect. A page whose render was
not clean (collapsed `main`, a same-origin 429/503) gets `visual/baseline-skipped`
and no file — re-run. After an approved fix batch, `--baseline-reset` clears the
set so the fixes do not read as regressions. Baselines are screenshots and
therefore local (`stardust/.gitignore` excludes `qa/baselines/` and `qa/shots/`,
master skill § Artifacts): later runs on the same machine diff against them; a
fresh clone re-establishes them on its first sweep. `qa/allowlist.json` is the
tracked record of judgement.

### Phase 2 — triage the ambiguous flags (LLM judgment, still read-only)

The deterministic sweep marks two finding classes as *needs triage*; read
`report.json` and judge only those:

- `content/verbatim-below-threshold` — inspect `evidence.missingNodes` against
  the live page and the scrape capture: is copy actually lost/corrupted
  (defect) or acceptably transformed (candidate for the allowlist)?
- `visual/visual-diff` — open `evidence.baseline` and `evidence.current`
  side by side (they are PNGs; view them): real layout/style regression, or
  benign dynamism (carousel frame, loaded font, live embed)? Use the
  `bands` evidence to locate the changed region.

Record each verdict by **annotating the finding** in your summary to the user
(defect vs non-defect + why). Do not edit `report.json` scores and do not fix
anything.

### Phase 3 — report to the user

Summarize: totals by severity, the confirmed defects first (with page paths
and one-line evidence), then triaged-away flags with their rationale, then
notable warns. Point at `stardust/qa/report.html`. Recommend — but do not
apply — fixes.

### Allowlist workflow (documented non-defects)

`stardust/qa/allowlist.json` (schema in `schemas/qa-allowlist.schema.json`)
keeps known non-defects from drowning every future run — e.g. a source page
that itself ships placeholder copy, or a form endpoint deliberately awaiting a
client credential. Entries match on check/id/path/messagePattern and **must
carry a reason**. Allowlisted findings stay in the report, greyed out, so the
evidence is never deleted.

Only add an entry when the user confirms the flag is a non-defect (or it is
already documented as one in the project's records). Never allowlist to make
a run green.

## Read-only contract

- Writes only under `stardust/qa/` (plus the `status.jsonl` ledger line).
- Never invokes deploy/publish APIs, never PUTs to DA, never edits blocks,
  styles, or content — even for "trivial" fixes the sweep itself surfaced.
- Reports failure honestly: a crashed check appears in the report as
  `<check>/check-crashed` (error), never silently dropped.

## Scheduling / CI

The runner is plain node with no plugin-runtime dependency, so the same
command works from a GitHub Action or cron for drift monitoring; `--fail-on`
sets the gate. In CI without playwright, pin `--checks delivery`.
