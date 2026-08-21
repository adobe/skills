---
name: qa
description: Read-only automated QA sweep of a deployed stardust site on AEM Edge Delivery Services — validates routing, content fidelity vs the source capture, template conformance, rendered integrity (geometry, JS errors, broken images), visual regression vs baselines, metadata/SEO/JSON-LD, link integrity, accessibility (axe), and performance budgets, then emits a findings report with an allowlist for documented non-defects. Finds issues; never fixes them. Use when the user asks to "QA the site", "validate the migration", "check the live site for issues", "run a QA sweep/regression check", or invokes /stardust:qa <live-url>.
license: Apache-2.0
---

# stardust:qa — read-only site QA sweep

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
     (otherwise derived by fleet consensus)
5. Browser checks need **playwright resolvable from the project** (`node_modules/playwright`).
   If missing, run the delivery-layer checks only (`--checks routing,content,templates,metadata,links`)
   and tell the user what was skipped.
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

Writes `stardust/qa/inventory.json`, `report.json`, `report.html`, screenshots
under `stardust/qa/shots/`, and (first run) visual baselines under
`stardust/qa/baselines/`. Exit 0 = no active errors, 1 = active errors,
2 = infra failure. `reference/checks.md` documents every check, its finding
ids, and severity rationale. Useful variants: `--checks <subset>`,
`--max-pages <n>` (smoke run), `--fail-on warn` (strict gate).

First run on a site: expect a wave of `visual/baseline-created` info findings —
that is the baseline being established, not a defect. Baselines should be
committed to the workspace repo so later runs diff against an approved state.

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
sets the gate. In CI without playwright, pin `--checks` to the delivery-layer
subset.
