> Copy of a working file from the 2026-08 learnings harvest, pushed to `stardust/next` on 2026-09-23 for reference. Real site names are replaced by generic sector descriptors (0.19.2 policy); local paths and `analysis/` pointers refer to the maintainer's machine and are not in this repo.

# Stardust learnings harvest — 2026-08/09 migrations

Analysis of every stardust-driven project under `/Users/paolo/stardust/2026-08` (activity 2026-08-19 → 2026-09-18) against plugin **0.22.1** (adobe/skills `main` at cac8dc2, 2026-09-18). Working copy: `/Users/paolo/stardust/source/190926/skills`, branch `stardust/learnings-harvest-2026-08`. Report generated 2026-09-19. All supporting artefacts live in `/Users/paolo/stardust/source/190926/analysis/` (see Appendix).

## 1. Executive summary

**Scope.** 47 folders, of which 27 are distinct stardust runs with notes and/or transcripts (replica ×20, redesign ×3, figma ×1, other ×3). 74 Claude Code sessions (3.9 GB of JSONL, including sub-agent transcripts) were parsed programmatically; every notes file written during the runs (journal, learnings, conversion logs, plugin-improvement notes, dynamics hand-offs) was read. Fourteen analysis agents produced **791 findings** (263 from explicit notes, 440 hidden in transcripts, 88 mixed); nine consolidation agents verified them against the 0.22.1 source and the changelog and folded them into **39 themes** and **184 improvement candidates**, each a plausible single PR.

**Headline numbers (main sessions unless stated).**

| metric | value |
|---|---|
| API requests | 20,688 main + 20,790 in sub-agents |
| cache-read tokens | 7.96 B main + 4.10 B sub-agents |
| cache-creation tokens | 708 M — **90 % of it (640 M) is 1,222 requests that followed an idle gap ≥ 5 min** (prompt-cache TTL) at a 500–900k context; 2,655 `sleep` commands requested ≈ 110 h of waiting |
| average context per request in long sessions | 400–630k tokens |
| active agent time (sum of turn durations) | ≈ 511 h across all runs (wall-clock ≈ 2970 h, idle included) |
| human mid-flow interventions classified | 498 — 87 reported a defect the gates missed, 61 corrected wrong output, 90 unblocked an error |
| external live-vs-deployed pixel audit (32 random pages/site) | medians **4.2 % / 28.8 % / 49.4 %** on three sites whose in-project archetype gates were green |
| plugin documentation loaded per run | `deploy/SKILL.md` = 188 KB (≈ 47k tokens), injected whole on every deploy invocation and re-read in slices ~20×/run |

**What the evidence says, in one paragraph.** Quality is gated on one archetype per template and never re-measured on the delivered pages, so siblings, mobile and chrome states shipped unmeasured and owners found the defects (T15, T16, T18). Cost is dominated not by tool output but by context size × request count, and nine tenths of all cache writes come from waiting past the cache TTL with a huge context (T01–T03). Independence leaks are almost all procedural: credentials that expire predictably, decisions asked mid-flow that had defaults, turns that end to report, routing that never reached `replica` (T09–T11). Speed is lost to re-invented tooling: every run rewrote an importer, a wave driver, a media rehost, a lift script and 20–80 probe scripts because `crawl.mjs`, `migrate` and `rollout` ship prose where they should ship instruments (T23, T26, T27). David's Model compliance fails silently on vocabulary size, site-wide constants and presentation vehicles that no lint counts (T29–T31).

**Top improvements by composite score** (full ranking in § 4):

- **T01.1** Wait discipline: never block the conversation past the cache TTL — I5 G5 R1 E1, 18 projects, patch
- **T11.2** `direct` zero-movement → hand off to `replica`; keep-design phrases auto-select replica; named-deviation journal rule — I5 G5 R1 E1, 5 projects, patch
- **T04.2** Liveness and auto-resume contract for delegated agents — I5 G5 R1 E2, 10 projects, patch
- **T09.1** Ship `da-token-check.mjs` (resolve, decode, smoke, remaining hours) — I5 G5 R1 E2, 15 projects, minor
- **T09.2** Master Setup step 7: credentials preflight, `SITE_TOKEN_<SITE>` discovery, planning against the token window — I5 G5 R1 E2, 10 projects, patch
- **T35.1** Block JS runtime rules: never measure in `decorate()`, `loadCSS` builder deps, icon and fragment ordering — I5 G5 R1 E2, 2 projects, patch
- **T10.1** Turn-ending contract: never stop to report; chain waves; state the commit policy and the stop point — I5 G5 R2 E1, 13 projects, patch
- **T14.1** Reuse the admitted session: storageState clone + `--storage-state` in every live instrument — I5 G5 R1 E3, 6 projects, patch
- **T22.1** `code-sync-verify.mjs`: sync, purge, and prove the served code is HEAD before any capture — I5 G5 R1 E3, 6 projects, minor
- **T06.1** `deploy-batch` ledger: content hash, merge semantics, path normalisation — I5 G5 R2 E2, 8 projects, patch
- **T11.1** Flow selection recorded in state; sub-skill entry guards refuse a migration with no flow chosen — I5 G5 R2 E2, 6 projects, minor
- **T27.3** Pre-PUT path sanitisation with the real EDS rule, exported as `normalizeDaPath()`, wired into the driver — I5 G5 R2 E2, 7 projects, minor
- **T33.1** Wire the gate into replica hand-off, rollout Phase C/E/H and the qa severity — I5 G5 R2 E2, 5 projects, minor
- **T04.1** Agent-type rule: fresh-context workers by default, forks only for short conversational tasks — I4 G5 R1 E1, 6 projects, patch
- **T05.1** Cap semantics and composition-regime rules (doc) — I4 G5 R1 E1, 5 projects, patch
- **T07.2** Harness-quirks card — I4 G5 R1 E1, 15 projects, patch

## 2. How to read this report

- **Scores.** Impact, Genericity, Risk-to-output-quality and Effort are each 1–5 (calibration in `analysis/CONSOLIDATION-BRIEF.md`). Composite = 0.40·Impact + 0.25·Genericity + 0.20·(6−Risk) + 0.15·(6−Effort), so a doc-only rule that recurred everywhere ranks above a risky new gate of equal impact. Tiers: **A** ≥ 4.40, **B** 4.00–4.39, **C** 3.60–3.99, **D** < 3.60.
- **Bump.** `patch` = doc rules, reference docs, instrument hardening; `minor` = a new gate, qa check or script surface (the plugin's own precedent, see `analysis/baseline-implemented.md` § C.4).
- **Wave.** A suggested PR wave (§ 7): W1 doc-only, W2 hardening, W3 new gates/scripts, W4 sub-flows and large builds. Dependencies are listed per candidate in the theme files.
- **Where to verify.** Every candidate lives in `analysis/themes/<Tnn>-<slug>.md` with an evidence table (project, finding id, what happened, file path or session id + UTC timestamp), an "Already in the plugin" section with file:line cites into 0.22.1, and the change description. Each finding id `<project>:<Fn>` resolves to `analysis/findings/<project>.md`, which quotes the note or transcript. Session digests are in `analysis/sessions/<project>/<session>.digest.md`; raw transcripts in `~/.claude/projects/-Users-paolo-stardust-2026-08-<project>/`.
- **Site names** appear here because the report is internal and you asked for verifiable evidence; nothing site-specific is proposed, and anything that goes into a PR is scrubbed per the 0.19.2 policy.

## 3. Quantitative baseline per project

Main-session numbers from the transcripts (`analysis/sessions/summary.tsv`, `context-profile.tsv`, `cache-miss.txt`); interventions from the per-project ledgers in `analysis/findings/`. "TTL-miss M" = cache-creation tokens (millions) spent on requests that followed a ≥ 5-min gap. "Interv." = classified human mid-flow prompts (a answered a skill question, b corrected output, c scope/redirect, d unblocked an error, e reported a defect the gates missed).

| project | flow | sess. | wall h | active h | requests main+sub | cache hit % | cache-create M | TTL-miss M | sleep min | interv. (b/d/e) | tool errors | sub-agents | findings |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| credit-bureau | replica | 1 | 247 | 47.1 | 2,387+4 | 94.0 | 46.4 | 37.2 | 1463 | 25 (3/4/1) | 47 | 1 | 37 |
| energy-utility | replica | 12 | 395 | 52.6 | 2,353+802 | 93.1 | 75.2 | 69.0 | 481 | 37 (8/6/9) | 110 | 10 | 40 |
| entertainment-venues | replica | 4 | 195 | 32.9 | 1,688+114 | 90.2 | 79.5 | 74.1 | 696 | 48 (1/13/7) | 72 | 5 | 37 |
| pharma-manufacturer | custom compiler → replica (late) | 7 | 121 | 18.0 | 1,387+431 | 89.5 | 19.8 | 17.0 | 402 | 24 (6/3/4) | 61 | 23 | 31 |
| us-airline | redesign prep → replica | 2 | 182 | 12.7 | 1,180+0 | 96.0 | 23.4 | 20.9 | 98 | 23 (0/2/6) | 33 | 0 | 33 |
| cancer-center | replica | 4 | 212 | 52.6 | 1,045+8,270 | 90.6 | 34.6 | 32.1 | 48 | 32 (7/7/6) | 43 | 96 | 37 |
| eda-software-vendor | replica | 2 | 181 | 27.4 | 991+0 | 86.2 | 62.7 | 58.7 | 566 | 30 (5/9/5) | 31 | 0 | 42 |
| beverage-brand | replica | 3 | 88 | 23.2 | 952+12 | 87.4 | 63.6 | 59.7 | 820 | 26 (1/4/7) | 46 | 2 | 38 |
| health-insurer-a | replica | 2 | 119 | 20.1 | 921+0 | 95.6 | 20.5 | 18.6 | 82 | 23 (1/4/6) | 20 | 0 | 39 |
| fintech-services | migrate → replica → figma | 4 | 48 | 13.1 | 863+0 | 95.5 | 18.3 | 16.5 | 108 | 31 (3/3/7) | 33 | 0 | 24 |
| health-insurer-b | replica | 2 | 169 | 17.8 | 777+0 | 92.3 | 31.8 | 28.1 | 373 | 23 (4/5/3) | 49 | 0 | 38 |
| leisure-airline | replica | 1 | 170 | 12.3 | 638+41 | 84.4 | 52.4 | 48.8 | 344 | 26 (2/6/4) | 56 | 4 | 43 |
| regional-bank | replica | 2 | 32 | 12.4 | 614+1,451 | 96.3 | 10.9 | 8.7 | 59 | 12 (2/2/4) | 23 | 21 | 35 |
| contact-lens-retailer | replica | 1 | 28 | 9.7 | 595+307 | 95.0 | 3.2 | 1.5 | 5 | 19 (1/3/4) | 12 | 10 | 25 |
| wine-retailer | replica | 3 | 149 | 13.6 | 594+741 | 93.7 | 16.1 | 13.7 | 19 | 24 (4/3/3) | 34 | 4 | 30 |
| nordic-bank | replica + redesign | 2 | 35 | 28.3 | 540+2,061 | 88.1 | 34.8 | 30.7 | 47 | 18 (3/6/2) | 32 | 45 | 40 |
| fintech-services-figma | - | 1 | 292 | 38.0 | 538+2,696 | 88.9 | 26.0 | 25.3 | 3 | - (-/-/-) | 46 | 38 | - |
| it-software-vendor | replica | 1 | 79 | 13.1 | 519+0 | 96.5 | 8.7 | 7.6 | 14 | 7 (1/2/1) | 14 | 0 | 21 |
| pharmacy-retailer | replica | 2 | 11 | 8.2 | 304+461 | 92.8 | 8.9 | 7.4 | 32 | 10 (2/0/0) | 11 | 8 | 30 |
| tennis-club | replica | 2 | 23 | 8.1 | 282+303 | 86.5 | 15.7 | 14.5 | 261 | 7 (2/1/1) | 7 | 7 | 27 |
| media-network | replica | 2 | 18 | 7.0 | 263+1,436 | 92.8 | 9.4 | 8.5 | 83 | 6 (0/1/0) | 13 | 26 | 26 |
| semiconductor-vendor | replica | 1 | 20 | 5.0 | 255+0 | 88.4 | 11.7 | 10.4 | 146 | 13 (1/0/3) | 13 | 0 | 21 |
| sports-car-maker | replica | 1 | 10 | 13.5 | 245+818 | 90.8 | 12.6 | 11.8 | 139 | 12 (1/4/3) | 15 | 22 | 30 |
| tennis-campus | - | 2 | 5 | 4.2 | 233+641 | 98.3 | 2.0 | 1.9 | 134 | 9 (2/0/0) | 11 | 11 | 22 |
| fintech-redesign | redesign (extract→direct→prototype→deploy) | 2 | 4 | 4.0 | 198+201 | 93.3 | 4.1 | 3.3 | 7 | 8 (0/1/1) | 9 | 8 | 24 |
| stardust-cost-study | analysis only | 1 | 26 | 4.6 | 143+0 | 77.6 | 11.4 | 10.9 | 139 | 5 (1/1/0) | 8 | 0 | 9 |
| pharma-manufacturer-analysis | - | 2 | 15 | 10.7 | 139+0 | 87.8 | 3.4 | 3.0 | 22 | - (-/-/-) | 2 | 0 | - |
| clover-blog | - | 1 | 1 | 0.9 | 36+0 | 86.2 | 0.2 | 0.1 | 42 | - (-/-/-) | 2 | 0 | - |
| swcargo | - | 1 | 96 | 0.0 | 8+0 | 78.2 | 0.1 | 0.0 | 0 | - (-/-/-) | 2 | 0 | - |

**Coverage notes.** `regional-bank-wt-*`, `leisure-airline-holidays`, `nordic-bank-redesign`, `cancer-center-horizon` and `credit-bureau-eds` have no transcript folder of their own; their runs were located inside the parent project's sessions and are covered in the parent's findings file. `stardust-dynamics-learnings` is a hand-built consolidation (no session). Raw "user prompt" counts in `summary.tsv` are inflated by harness echoes (image annotations, skill injections, compaction summaries): entertainment-venues's 166 prompts are 45 human ones; the ledgers above count only human prompts. Thinking tokens are not recorded in transcripts, so output cost is a lower bound.

### 3.1 Cost: where the tokens go
- Context size × request count is the cost driver, not tool output: all tool-result text across all sessions is ≈ 47 M chars (≈ 12 M tokens) against 12 B cache-read tokens.
- **Prompt-cache misses after idle gaps are 90 % of all cache-creation** (`analysis/cache-miss.txt`): 1,222 of 20,693 requests; gap buckets 5–10 min ≈ 500 (pure polling past TTL), 10–60 min ≈ 530 (gates, waits), > 60 min ≈ 190 (user away). Median context at a miss 500–800k tokens, so each miss re-writes 0.5–0.9 M tokens. Confirmed independently in beverage-brand (87 misses = 94 % of that session's cache-creation, 79 after a ≥ 5-min gap) and entertainment-venues (49 of 51 top cache-creation requests after a > 5-min gap).
- Sub-agents consumed 4.1 B cache-read tokens, a third of the total; forks inherit the whole orchestrator transcript (pharmacy-retailer 4 fork agents ≈ 107 M cache-read vs 4–6 M each for fresh agents in tennis-campus; pharma-manufacturer 110 M; nordic-bank 124 M for 269 requests).
- Documentation is the largest recurring context item: `deploy/SKILL.md` 188 KB is the biggest single Read result in sports-car-maker, tennis-club, semiconductor-vendor, cancer-center, entertainment-venues and credit-bureau (`analysis/skill-reads.txt`; 16 Read-tool reads, 0.68 M chars, plus `cat` reads not counted). Total always-on skill text is 566 KB.

### 3.2 Independence: why humans intervened

Of 498 classified human interventions, 87 reported a defect after gates were green (class e), 61 corrected wrong output (b) and 90 unblocked an error (d). The recurring mechanisms: expired `DA_TOKEN` (17 projects), stop-to-report or ask-with-a-derivable-default (20 projects, 127 bare "continue/yes/retry" acknowledgements in 16 sessions per the stardust-cost-study cost study), permission-classifier denials (7 projects, 40+ denials), bot-management windows (12 projects), and routing that never reached `replica` (6 projects).

### 3.3 Quality: what the gates did not see
- External live-vs-deployed pixel diff (stardust-cost-study, 32 random pages per site, 1440, unmasked): beverage-brand median 4.2 % (p90 42.8), entertainment-venues 28.8 %, energy-utility 49.4 % — while the in-project gates were green. The projects' own late ad-hoc instruments agree (entertainment-venues 122 published-failing vs 20 migrated; beverage-brand 356 pass / 80 residual / 132 fail of 583; energy-utility 6 pass / 45 fail on a careers sample). Root cause: the gate runs prototype-vs-live on one archetype per template, siblings "inherit" the pass, publish precedes any deployed number, and over-bar results are self-downgraded to "documented residual".
- Content loss was the largest single height-delta cause and no shipped script counts it (eda-software-vendor 4,184 pages with 1,145 fewer images and 1,016 dropped links; nordic-bank zero-row blocks passing four gates).
- Chrome open states (mega-menus, search, drawers) were never captured or gated; six projects shipped inert menus that owners found.
- AI readability: the 0.21.0 gate existed but was never run in two rollouts (regional-bank, media-network); Experience Workspace editability was never wired into delivery (1,992 dead texts on 125 pages in entertainment-venues).
- David's Model: 25–62 section-style tokens per site, 60–186 block+variant combinations, site-wide strings authored per page, `<u>`/`<code>`/ZWSP used as layout vehicles — all passing `davids-model-lint` with 0 red.

## 4. Ranked improvement candidates

184 candidates. Columns: composite, scores (Impact/Genericity/Risk/Effort), number of distinct projects with evidence, bump, wave, theme. Titles link to the theme file section.

### Tier A — 34 candidates (≥ 4.40)

| # | id | improvement | comp. | I/G/R/E | proj. | type | bump | wave | dimensions |
|---:|---|---|---:|---|---:|---|---|---|---|
| 1 | T01.1 | Wait discipline: never block the conversation past the cache TTL | 5.00 | 5/5/1/1 | 18 | doc-rule | patch | W1 | cost, speed-flow |
| 2 | T11.2 | `direct` zero-movement → hand off to `replica`; keep-design phrases auto-select replica; named-deviation journal rule | 5.00 | 5/5/1/1 | 5 | doc-rule | patch | W1 | pixel, independence, speed-flow |
| 3 | T04.2 | Liveness and auto-resume contract for delegated agents | 4.85 | 5/5/1/2 | 10 | reference-doc (+ optional script-new for | patch | W1 | speed-flow, reliability, independence, cost |
| 4 | T09.1 | Ship `da-token-check.mjs` (resolve, decode, smoke, remaining hours) | 4.85 | 5/5/1/2 | 15 | script-new | minor | W3 | independence, reliability, speed-flow |
| 5 | T09.2 | Master Setup step 7: credentials preflight, `SITE_TOKEN_<SITE>` discovery, planning against the token window | 4.85 | 5/5/1/2 | 10 | doc-rule | patch | W1 | independence, reliability |
| 6 | T35.1 | Block JS runtime rules: never measure in `decorate()`, `loadCSS` builder deps, icon and fragment ordering | 4.85 | 5/5/1/2 | 2 | doc-rule | patch | W1 | pixel \| reliability \| speed-flow \| ai-readability |
| 7 | T10.1 | Turn-ending contract: never stop to report; chain waves; state the commit policy and the stop point | 4.80 | 5/5/2/1 | 13 | doc-rule | patch | W1 | independence, speed-flow |
| 8 | T14.1 | Reuse the admitted session: storageState clone + `--storage-state` in every live instrument | 4.70 | 5/5/1/3 | 6 | script-change | patch | W2 | independence, reliability, speed-flow, pixel |
| 9 | T22.1 | `code-sync-verify.mjs`: sync, purge, and prove the served code is HEAD before any capture | 4.70 | 5/5/1/3 | 6 | script-new + gate-change (pre-capture pr | minor | W3 | speed-flow, reliability, pixel, cost |
| 10 | T06.1 | `deploy-batch` ledger: content hash, merge semantics, path normalisation | 4.65 | 5/5/2/2 | 8 | script-change | patch | W2 | reliability, speed-flow, cost |
| 11 | T11.1 | Flow selection recorded in state; sub-skill entry guards refuse a migration with no flow chosen | 4.65 | 5/5/2/2 | 6 | gate-new | minor | W3 | independence, pixel, speed-flow, cost |
| 12 | T27.3 | Pre-PUT path sanitisation with the real EDS rule, exported as `normalizeDaPath()`, wired into the driver | 4.65 | 5/5/2/2 | 7 | gate-change | minor | W3 | reliability \| speed-flow |
| 13 | T33.1 | Wire the gate into replica hand-off, rollout Phase C/E/H and the qa severity | 4.65 | 5/5/2/2 | 5 | gate-change \| flow-change | minor | W3 | ai-readability \| independence |
| 14 | T04.1 | Agent-type rule: fresh-context workers by default, forks only for short conversational tasks | 4.60 | 4/5/1/1 | 6 | doc-rule | patch | W1 | cost, speed-flow |
| 15 | T05.1 | Cap semantics and composition-regime rules (doc) | 4.60 | 4/5/1/1 | 5 | doc-rule | patch | W1 | speed-flow, pixel, cost |
| 16 | T07.2 | Harness-quirks card | 4.60 | 4/5/1/1 | 15 | reference-doc | patch | W1 | reliability, speed-flow |
| 17 | T10.3 | Phase checkpoints with the next command, and a resume rule that never re-runs finished steps | 4.60 | 4/5/1/1 | 8 | doc-rule | patch | W1 | independence, speed-flow, cost |
| 18 | T16.2 | Zero-row blocks and empty module sections are red | 4.60 | 4/5/1/1 | 4 | script-change (lint rules) | patch | W2 | pixel, davids-model, reliability |
| 19 | T33.3 | Shipped-instrument-first rule; chrome inlining is an owner decision, never autonomous | 4.60 | 4/5/1/1 | 3 | doc-rule \| script-change | patch | W1 | independence \| ai-readability \| davids-model |
| 20 | T07.1 | One Setup preflight: dependencies, probes dir, environment record | 4.50 | 5/5/2/3 | 16 | script-new + default-change (`--no-save` | minor | W3 | reliability, speed-flow, cost |
| 21 | T16.1 | Ship `content-acceptance.mjs`: the offline source-vs-imported role inventory gate | 4.50 | 5/5/2/3 | 8 | gate-new | minor | W3 | pixel, ai-readability, speed-flow, independence |
| 22 | T18.1 | Chrome archetype: inventory chrome states and variants before fan-out, gate each once | 4.50 | 5/5/2/3 | 11 | flow-change | minor | W3 | pixel, dynamics, independence |
| 23 | T21.1 | Make the local harness apply the pipeline's transforms (one shared `pipelineMimic`) | 4.50 | 5/5/2/3 | 11 | script-change | patch | W2 | pixel, reliability, speed-flow, cost |
| 24 | T30.2 | Content-loss detectors: zero-row block, chrome leak, table/serialised list in a cell, non-block wrapper | 4.50 | 5/5/2/3 | 5 | script-change \| doc-rule | patch | W2 | reliability \| pixel \| davids-model \| ai-readabilit |
| 25 | T15.3 | Residual discipline: named classes only, over-bar is FAIL, mobile never skipped, honest reports | 4.45 | 5/5/3/2 | 10 | doc-rule + schema change (ledger fields) | patch | W2 | pixel, independence, reliability |
| 26 | T02.3 | Runner output contract and long-session hand-off | 4.45 | 4/5/1/2 | 9 | doc-rule | patch | W1 | cost, speed-flow, reliability |
| 27 | T08.1 | Privileged-transport preflight in the first minutes, with a "blocked-on-owner" surface | 4.45 | 4/5/1/2 | 5 | doc-rule + flow-change (Setup step) (+ o | patch | W1 | independence, speed-flow |
| 28 | T11.3 | First gate asks keep-vs-redesign; planning aids named per flow; resume enters through the master skill and each phase through its Skill; routing eval | 4.45 | 4/5/1/2 | 5 | doc-rule | patch | W1 | independence, speed-flow, cost |
| 29 | T17.1 | Name the residual classes and make the gate report carry regime, masks, unmasked number and reference date | 4.45 | 4/5/1/2 | 11 | reference-doc | patch | W1 | pixel, reliability, speed-flow |
| 30 | T21.3 | ENCODE contract additions + davids-model-lint rules for pipeline-sensitive shapes | 4.45 | 4/5/1/2 | 11 | doc-rule + gate-change (lint additions,  | patch | W1 | pixel, editability-EW, davids-model, reliability |
| 31 | T30.3 | Icon-token and variant-collision guards | 4.45 | 4/5/1/2 | 2 | script-change \| doc-rule | patch | W1 | pixel \| reliability \| davids-model |
| 32 | T06.2 | Site-scale fix loop: template sample → class triage → one confirmation sweep | 4.40 | 5/4/2/2 | 4 | reference-doc + flow-change (rollout Pha | patch | W1 | speed-flow, cost, pixel |
| 33 | T02.1 | Image budget: read crops and sheets, never the stitched page | 4.40 | 4/5/2/1 | 9 | doc-rule | patch | W1 | cost, reliability, speed-flow |
| 34 | T29.1 | Budget the authoring vocabulary: named section styles ≤ 12, ≤ 2 variant tokens, no layout numbers | 4.40 | 4/5/2/1 | 11 | doc-rule | patch | W1 | davids-model \| editability-EW |

### Tier B — 75 candidates (4.00–4.39)

| # | id | improvement | comp. | I/G/R/E | proj. | type | bump | wave | dimensions |
|---:|---|---|---:|---|---:|---|---|---|---|
| 35 | T03.1 | Split deploy/SKILL.md into a ≤ 40 KB core plus step-scoped reference chapters | 4.35 | 5/5/2/4 | 14 | reference-doc (structure change to the a | patch | W4 | cost, speed-flow, reliability |
| 36 | T18.2 | `chrome-states.mjs`: enumerate triggers, open every state, emit crops, computed styles and a nav document model | 4.35 | 5/5/2/4 | 8 | script-new | minor | W4 | pixel, dynamics, editability-EW (nav authored as s |
| 37 | T23.1 | Emit the documented per-page schema from `capture()` | 4.35 | 5/5/2/4 | 9 | script-change | minor | W4 | cost, speed-flow, reliability, pixel, davids-model |
| 38 | T15.2 | Every delivered page gets a number: coverage regime and sibling sampling | 4.30 | 5/5/3/3 | 9 | gate-change + doc-rule | minor | W3 | pixel, independence, speed-flow |
| 39 | T19.1 | `stitch-shot.mjs`: pinned chrome per chunk, integer scroll, decode/visibility/short-capture guards, tail and exclude | 4.30 | 5/5/3/3 | 11 | script-change | patch | W2 | pixel, reliability, speed-flow |
| 40 | T19.2 | `live-session.mjs` `dismissOverlays`: visible-match, text fallback, late mount, frames, shadow roots, persistent widgets, fail-loud | 4.30 | 5/5/3/3 | 11 | script-change | patch | W2 | pixel, reliability, speed-flow |
| 41 | T20.2 | `motion-assert.mjs` behaviour-match + `click-control` check in `dynamics-check` and `qa-gate` | 4.30 | 5/5/3/3 | 5 | script-new + gate-change (replica approv | minor | W3 | dynamics, pixel, independence |
| 42 | T32.1 | Make the EW gate a row in the deploy atomic contract and the rollout ledger | 4.30 | 5/5/3/3 | 2 | gate-change \| flow-change | minor | W3 | editability-EW \| independence |
| 43 | T01.2 | Completion contract for batch drivers: progress file + one summary line, run in background | 4.30 | 4/5/1/3 | 9 | script-change | patch | W2 | cost, speed-flow, reliability |
| 44 | T02.2 | `review-image.mjs`: contact sheets and stacked band strips from the gate outputs | 4.30 | 4/5/1/3 | 7 | script-new | patch | W2 | cost, speed-flow, reliability |
| 45 | T03.2 | Operator card + section index at the top of every SKILL.md; "read § X at step Y" TOCs on references > 20 KB | 4.30 | 4/5/1/3 | 11 | doc-rule | patch | W2 | cost, speed-flow, reliability |
| 46 | T05.3 | Landmark Δy table as the first diagnostic of every round | 4.30 | 4/5/1/3 | 4 | script-change (new flag) + doc-rule | patch | W2 | speed-flow, pixel |
| 47 | T13.1 | `stardust status`: a deterministic, read-only progress surface (script) + tracking-issue convention | 4.30 | 4/5/1/3 | 9 | script-new | minor | W3 | independence, speed-flow, reliability |
| 48 | T23.2 | Media and font harvest (`--assets`, default on for `--prep`/replica) | 4.30 | 4/5/1/3 | 3 | script-change (new pass in an existing s | minor | W3 | reliability, speed-flow, pixel |
| 49 | T29.2 | `davids-model-lint` vocabulary census and token-shape rules | 4.30 | 4/5/1/3 | 10 | script-change | patch | W2 | davids-model \| editability-EW |
| 50 | T32.3 | Static block-JS/CSS lint for the EW anti-patterns (mechanise checklist `:1080`) | 4.30 | 4/5/1/3 | 4 | script-new | patch | W2 | editability-EW \| davids-model |
| 51 | T34.5 | Query-index registration on config-service sites, with read-back | 4.30 | 4/5/1/3 | 2 | script-new \| reference-doc \| doc-rule | minor | W3 | dynamics \| independence \| reliability \| pixel |
| 52 | T34.7 | Detection recall on every roster page and a recall eval | 4.30 | 4/5/1/3 | 5 | script-change \| doc-rule \| eval | patch | W2 | dynamics \| reliability |
| 53 | T35.2 | CSS selector and class-hygiene lint for blocks and foundation | 4.30 | 4/5/1/3 | 1 | script-new \| gate-new \| doc-rule | minor | W3 | pixel \| reliability \| speed-flow |
| 54 | T30.1 | "Site-wide strings are never page rows": D-CONST detector and the template-shell tier | 4.25 | 5/4/2/3 | 6 | doc-rule \| script-change | patch | W2 | davids-model \| editability-EW \| ai-readability |
| 55 | T05.2 | Mechanical iteration counter in `gate.sh` | 4.25 | 4/5/2/2 | 4 | gate-change | minor | W3 | speed-flow, cost |
| 56 | T09.3 | `deploy-batch.mjs`: preflight, halt on auth failure, sentinel for site-level 401/404 | 4.25 | 4/5/2/2 | 7 | script-change | patch | W2 | reliability, independence |
| 57 | T10.2 | Decision register `stardust/decisions.md` and a plan-time decision batch with derivable defaults | 4.25 | 4/5/2/2 | 11 | reference-doc | patch | W1 | independence, davids-model, speed-flow |
| 58 | T14.2 | Escalation ladder: headless real Chrome before any window, windows off-screen and opt-in | 4.25 | 4/5/2/2 | 6 | script-change + doc-rule | patch | W1 | independence, reliability, speed-flow |
| 59 | T15.5 | `gate-ledger-lint.mjs` before rollout Phase C | 4.25 | 4/5/2/2 | 3 | script-new (gate) | minor | W3 | pixel, independence |
| 60 | T19.3 | Capture provenance sidecar and consent as one instrument parameter | 4.25 | 4/5/2/2 | 7 | script-change + doc-rule | patch | W1 | reliability, pixel, speed-flow |
| 61 | T20.1 | `motion-observe.mjs`: observe style, aria, hidden and childList mutations; entrance families; hover probe hardening | 4.25 | 4/5/2/2 | 4 | script-change | patch | W2 | dynamics, pixel |
| 62 | T31.1 | Inline-vehicle contract: which tags round-trip, what each may mean, and the spacer remediation ladder | 4.25 | 4/5/2/2 | 9 | doc-rule | patch | W1 | davids-model \| editability-EW \| ai-readability |
| 63 | T34.1 | Make dynamics Phase 4/5 a close-out condition, not a suggestion | 4.25 | 4/5/2/2 | 7 | gate-change \| flow-change \| doc-rule | minor | W1 | dynamics \| independence \| reliability |
| 64 | T26.3 | Make "flatten to prose" and unmapped modules a hard import failure; widen content-count classes | 4.20 | 5/4/3/2 | 6 | gate-change | minor | W3 | pixel \| davids-model \| dynamics \| reliability |
| 65 | T04.4 | Ownership, registries and merge protocol for parallel writers | 4.20 | 4/4/1/2 | 4 | doc-rule | patch | W1 | reliability, speed-flow, editability-EW, davids-mo |
| 66 | T08.2 | Harness-permissions card with the plugin's command shapes and a pre-approval snippet | 4.20 | 4/4/1/2 | 7 | reference-doc | patch | W1 | independence, reliability |
| 67 | T26.2 | Write the importer rules reference (numbered, site-agnostic) | 4.20 | 4/4/1/2 | 7 | reference-doc | patch | W1 | pixel \| davids-model \| ai-readability \| speed-flow |
| 68 | T39.1 | Replica/reskin install a scoped impeccable ignore set once, at Setup | 4.20 | 4/4/1/2 | 3 | doc-rule \| flow-change | patch | W1 | speed-flow \| cost \| independence |
| 69 | T07.4 | `served-check` helper and the `--compressed` rule where agents read it | 4.20 | 3/5/1/1 | 5 | script-new (tiny) + doc-rule | patch | W1 | reliability, speed-flow |
| 70 | T08.4 | Credential hygiene in commands and interactive auth hand-off | 4.20 | 3/5/1/1 | 1 | doc-rule | patch | W1 | reliability, independence |
| 71 | T09.4 | Park / stage / resume contract for token-bound work | 4.20 | 3/5/1/1 | 4 | doc-rule | patch | W1 | independence, reliability |
| 72 | T12.4 | Time-to-first-URL: publish a preview before pixel iteration | 4.20 | 3/5/1/1 | 3 | flow-change | patch | W2 | independence, speed-flow, pixel |
| 73 | T31.4 | Decide the link-form policy for rule #4 once, and lint mixed forms | 4.20 | 3/5/1/1 | 6 | doc-rule \| script-change | patch | W1 | davids-model \| ai-readability \| reliability |
| 74 | T28.1 | Cluster the corpus by rendered layout signature and gate one exemplar per cluster | 4.10 | 5/4/2/4 | 5 | script-new (+ flow-change in migrate/rep | minor | W4 | pixel \| speed-flow \| independence |
| 75 | T12.1 | `deploy/reference/site-bootstrap.md` + a Setup hook that provisions repo, Code Sync, config and DA seed before the first deploy | 4.10 | 4/5/2/3 | 5 | reference-doc | minor | W3 | independence, reliability, speed-flow |
| 76 | T12.2 | Lockdown step: private repo + site auth, default on for customer-domain migrations | 4.10 | 4/5/2/3 | 2 | script-new | minor | W3 | reliability, independence |
| 77 | T13.2 | Wave-close checklist in rollout Phase H, enforced, with `open-review-pairs.mjs` | 4.10 | 4/5/2/3 | 10 | flow-change | minor | W3 | independence, pixel, speed-flow |
| 78 | T14.4 | Per-host live budget: pacing, one-live-tool lock, 429 handling | 4.10 | 4/5/2/3 | 5 | script-change + default-change (crawl co | patch | W2 | reliability, speed-flow, independence |
| 79 | T17.2 | `gate.sh`: reference freshness and live self-variance before the first round | 4.10 | 4/5/2/3 | 8 | script-change | patch | W2 | pixel, reliability, speed-flow |
| 80 | T18.4 | Deploy Step 6 / rollout: chrome delivery contract — states, variants, guard set | 4.10 | 4/5/2/3 | 8 | doc-rule (deploy) + script-change (deliv | patch | W2 | pixel, editability-EW, davids-model, reliability |
| 81 | T19.4 | `crawl.mjs` captures: 360 shot, long-page clipping, quirks mode, DPR decision, vision-gate recapture, brand-surface exclusions | 4.10 | 4/5/2/3 | 7 | script-change (crawl.mjs) + doc-rule (ex | patch | W2 | pixel, reliability, speed-flow |
| 82 | T21.2 | Stored pipeline-facts contract: `reference/pipeline-facts.md` + `pipeline-probe.mjs` + `runtime-contract.json#pipeline` | 4.10 | 4/5/2/3 | 8 | reference-doc + script-new | minor | W3 | reliability, speed-flow, pixel, davids-model |
| 83 | T24.1 | Implement the documented discovery in `discover()`: robots sitemaps, full index recursion, subtree scoping, BFS `--depth`, `--cookie` | 4.10 | 4/5/2/3 | 3 | script-change | patch | W2 | independence, reliability, speed-flow |
| 84 | T26.6 | Ship the prototype→content transcriber and the thin-tier converter in deploy | 4.10 | 4/5/2/3 | 6 | script-new | minor | W3 | speed-flow \| cost \| editability-EW \| davids-model |
| 85 | T27.2 | Harden `deploy-batch.mjs`: content hash, merge-safe ledger, re-preview on `about:error`, size guard, `--paths` file/list, `--report`, `update-coverage --from-ledger` | 4.10 | 4/5/2/3 | 10 | script-change | patch | W2 | reliability \| speed-flow \| cost |
| 86 | T27.5 | Ship `deploy/scripts/rehost-media.mjs` with a media ledger as the default ENCODE behaviour for external imagery | 4.10 | 4/5/2/3 | 10 | script-new | minor | W3 | reliability \| speed-page \| pixel \| independence |
| 87 | T27.6 | Ship `deploy/scripts/deploy-page.mjs` — the per-page chain — and make `localize-links --check` a hard gate (promote D4 LOCALIZE to 🔴) | 4.10 | 4/5/2/3 | 8 | script-new (+ gate-change for the lint p | minor | W3 | speed-flow \| reliability \| independence |
| 88 | T32.2 | Probe and round-trip hardening: import stubs, item-level exemptions, strict listing, ledger JSON | 4.10 | 4/5/2/3 | 2 | script-change | patch | W2 | editability-EW \| reliability |
| 89 | T35.3 | Image rendition and CLS guards as instruments, not rules | 4.10 | 4/5/2/3 | 1 | gate-change \| doc-rule \| default-change  | minor | W3 | pixel \| speed-page |
| 90 | T37.1 | 429/503 as infrastructure state: back-off, shared budget, `unmeasured`, `infra-degraded` verdict | 4.10 | 4/5/2/3 | 3 | script-change \| default-change (concurre | patch | W2 | reliability \| speed-flow \| cost |
| 91 | T14.3 | Challenge classifier + interactive human-solve mode + capture sanity | 4.05 | 4/4/1/3 | 5 | script-change | patch | W2 | reliability, independence, pixel |
| 92 | T23.5 | `replica/scripts/lift.mjs` — the per-breakpoint computed-style lift, plus recreation one-liners | 4.05 | 4/4/1/3 | 9 | script-new + doc-rule | minor | W3 | speed-flow, pixel, cost |
| 93 | T24.2 | Classify every roster URL: page / redirect / off-origin / gated / dead / app-shell, with a per-URL platform | 4.05 | 4/4/1/3 | 1 | script-change (crawl) + script-new (rost | minor | W3 | independence, reliability, dynamics, speed-flow |
| 94 | T28.2 | Variant census before styling a block, with descendant-class coverage per component | 4.05 | 4/4/1/3 | 4 | script-new | minor | W3 | pixel \| speed-flow |
| 95 | T34.2 | Ship the runtime mechanisms as fenced examples (≤ 80 lines each) | 4.05 | 4/4/1/3 | 1 | reference-doc \| script-change (`localize | minor | W3 | dynamics \| speed-flow \| pixel |
| 96 | T01.3 | `wait-for-origin.mjs`: a capped propagation waiter replacing sleep-then-regate | 4.05 | 3/5/1/2 | 5 | script-new | patch | W2 | speed-flow, cost, reliability |
| 97 | T03.3 | Doc-size lint in `npm run lint:stardust` | 4.05 | 3/5/1/2 | 1 | gate-new (CI lint on the plugin, not a d | patch | W2 | cost, reliability |
| 98 | T13.3 | Hand-off report template: gate table first, one reporting KPI, provenance, before/after evidence | 4.05 | 3/5/1/2 | 6 | reference-doc | patch | W1 | independence, pixel, reliability |
| 99 | T18.3 | `chrome-parity.mjs`: scroll state, open state, list-style, stacking and alignment checks | 4.05 | 3/5/1/2 | 5 | script-change | patch | W2 | pixel, reliability |
| 100 | T21.4 | Bulk delivery drivers are node scripts that prove the write landed | 4.05 | 3/5/1/2 | 1 | script-change + doc-rule | patch | W1 | reliability, independence |
| 101 | T22.3 | Syntax and lint gate before any code push | 4.05 | 3/5/1/2 | 2 | gate-new | minor | W3 | reliability, speed-page |
| 102 | T23.3 | Slug, flags and log: make `crawl.mjs` and `ia-extraction.md` agree | 4.05 | 3/5/1/2 | 4 | script-change + reference-doc | patch | W1 | reliability, speed-flow, cost |
| 103 | T26.5 | Generated content is never hand-edited: patch files and out-of-tree generated artifacts | 4.05 | 3/5/1/2 | 4 | doc-rule | patch | W1 | speed-flow \| reliability \| cost |
| 104 | T30.4 | Fix the lint rules that fire falsely | 4.05 | 3/5/1/2 | 5 | script-change | patch | W2 | speed-flow \| reliability \| davids-model |
| 105 | T31.2 | D15-VEHICLE lint rules | 4.05 | 3/5/1/2 | 7 | script-change | patch | W2 | davids-model \| editability-EW \| ai-readability |
| 106 | T26.4 | One shared `hiddenLive()` visibility test for importer and gates (additive, opt-in on the diff side) | 4.00 | 4/4/2/2 | 3 | script-change | patch | W2 | pixel \| ai-readability \| davids-model |
| 107 | T28.4 | Rollout Phase B/C rules: interactive or multi-column `generic` sections need a block; a template's blocks are not verified before its own archetype passes; encoder-vs-generic count check | 4.00 | 4/4/2/2 | 2 | gate-change | minor | W3 | pixel \| dynamics \| reliability |
| 108 | T33.4 | Document-first for programmatic families, forms and UI labels — enforce what 0.21.0 stated | 4.00 | 4/4/2/2 | 4 | doc-rule \| script-change | patch | W1 | ai-readability \| dynamics \| davids-model |
| 109 | T29.3 | Re-verify rule #120 and split it into "comma = N classes, space = one class" | 4.00 | 3/5/2/1 | 3 | doc-rule \| script-change | patch | W1 | reliability \| editability-EW \| davids-model |

### Tier C — 45 candidates (3.60–3.99)

| # | id | improvement | comp. | I/G/R/E | proj. | type | bump | wave | dimensions |
|---:|---|---|---:|---|---:|---|---|---|---|
| 110 | T15.1 | Ship `gate-publish.mjs`: the published-origin gate as a script and as the release condition | 3.95 | 5/5/4/4 | 13 | gate-new + flow-change | minor | W4 | pixel, independence, reliability |
| 111 | T34.3 | Pattern catalogue additions and triage defaults | 3.95 | 4/3/1/2 | 1 | reference-doc \| doc-rule | patch | W1 | dynamics \| davids-model \| pixel \| ai-readability |
| 112 | T14.5 | `--block <substr,...>` route-abort in the shared live session | 3.95 | 3/4/1/1 | 2 | script-change | patch | W2 | pixel, reliability |
| 113 | T32.4 | EW2 wrapper-rhythm, exact tracking, per-row asset authorability, composition-keyed CSS audit | 3.95 | 3/4/1/1 | 4 | doc-rule | patch | W1 | editability-EW \| pixel |
| 114 | T39.4 | Detect DEGRADED is a gate failure; `@font-face` never through the Write hook | 3.95 | 3/4/1/1 | 1 | gate-change \| doc-rule | patch | W1 | reliability \| pixel |
| 115 | T06.4 | Change detection upstream of deploy: re-gate list, importer coverage index, patch file | 3.90 | 4/4/1/4 | 4 | script-new + doc-rule | minor | W4 | speed-flow, cost, reliability |
| 116 | T05.4 | pixel-compare emits offsets and crop stacks so PNGs are rarely opened | 3.90 | 3/5/1/3 | 3 | script-change | patch | W2 | cost, speed-flow |
| 117 | T04.3 | Concurrency budget and machine-wide browser semaphore | 3.85 | 4/4/2/3 | 5 | script-new + default-change (budget) + d | minor | W3 | reliability, speed-flow |
| 118 | T07.3 | Port allocator and server identity for every localhost URL a gate consumes | 3.85 | 4/4/2/3 | 13 | script-new + script-change (gate.sh, qa- | minor | W3 | reliability, speed-flow, pixel (false gate reads) |
| 119 | T16.3 | content-diff hardening: offline source side, per-side roots, href normalisation, register awareness, shadow roots | 3.85 | 4/4/2/3 | 5 | script-change | patch | W2 | pixel, speed-flow, independence |
| 120 | T27.4 | Media pre-flight stage: SVG scan/rasterise, size and count caps, liveness HEAD with browser UA | 3.85 | 4/4/2/3 | 10 | script-change | minor | W3 | reliability \| speed-flow \| pixel |
| 121 | T27.8 | Link completeness: alias map, inverse pass, dead-same-origin qa check, and the one link-policy decision written down | 3.85 | 4/4/2/3 | 6 | script-change | minor | W3 | reliability \| independence \| davids-model \| ai-rea |
| 122 | T15.4 | `gate.sh` counts iterations and enforces the cap | 3.85 | 3/5/2/2 | 3 | script-change | patch | W2 | speed-flow, cost, pixel |
| 123 | T27.7 | Fix the rollout ledger scripts: typed rows for chrome/fragments/sheets, `content-pending` guard, host normalisation, pending-vs-failed link targets | 3.85 | 3/5/2/2 | 5 | script-change | patch | W2 | reliability \| speed-flow |
| 124 | T39.2 | Per-skill impeccable dependency level | 3.85 | 3/5/2/2 | 4 | default-change \| doc-rule | patch | W1 | speed-flow \| cost \| reliability |
| 125 | T23.4 | Ship extract Phases 3–6 as scripts (`brand-surface.mjs`, `brand-review.mjs`, `state-update.mjs`) | 3.80 | 4/5/2/5 | 7 | script-new | minor | W4 | cost, speed-flow, reliability, independence |
| 126 | T24.3 | Roster extension from dynamic evidence, parameterised states, link audit and freshness | 3.80 | 4/3/1/3 | 1 | flow-change + script-change | minor | W3 | independence, reliability, dynamics, pixel (conten |
| 127 | T28.3 | Site-fingerprint gate before fleet fan-out (design similarity decides canon groups) | 3.80 | 4/3/1/3 | 1 | gate-new | minor | W3 | pixel \| independence \| speed-flow |
| 128 | T33.2 | Excluded blocks must carry an authored fallback; unowned strict gaps fail | 3.80 | 4/4/3/2 | 3 | gate-change \| doc-rule | minor | W3 | ai-readability \| independence |
| 129 | T04.5 | Run lock and multi-session write safety | 3.80 | 3/4/1/2 | 3 | doc-rule + gate-new (lock check is a sof | patch | W1 | reliability, independence |
| 130 | T13.4 | Optional usage ledger per phase/wave (`token-ledger.mjs`) | 3.80 | 3/4/1/2 | 3 | script-new | minor | W3 | cost, independence |
| 131 | T14.7 | Capture provenance: technique, date, variant markers — and dated references in the gate | 3.80 | 3/4/1/2 | 5 | script-change + doc-rule | patch | W1 | pixel, independence, reliability |
| 132 | T22.2 | Ordering rules: code first, then content, then gate on the ref the user will look at; compatibility window for shape refactors | 3.80 | 3/4/1/2 | 2 | doc-rule + script-change (one WARN) | patch | W1 | reliability, independence, pixel |
| 133 | T27.9 | Redirects, folder indexes, sheets, listing order, `og:image` and JSON-LD delivery — the small delivery rules | 3.80 | 3/4/1/2 | 9 | doc-rule | patch | W1 | reliability \| dynamics \| davids-model \| ai-readabi |
| 134 | T28.5 | Replica sibling-tier rules: module-kind × breakpoint lift ledger, sequence-driven generators, per-theme bindings | 3.80 | 3/4/1/2 | 4 | doc-rule | patch | W1 | pixel \| speed-flow |
| 135 | T30.5 | Text-hygiene lints and one JSON-LD path | 3.80 | 3/4/1/2 | 4 | script-change \| doc-rule | patch | W1 | ai-readability \| davids-model \| reliability |
| 136 | T30.6 | Content imagery hard-coded in block JS is a 🔴 (JS-side detector) | 3.80 | 3/4/1/2 | 2 | script-change \| doc-rule | patch | W1 | davids-model \| editability-EW \| ai-readability |
| 137 | T31.3 | Fragments: the D12 decision rule, the per-document ingestion limit, and content-bearing-fragment detection | 3.80 | 3/4/1/2 | 3 | doc-rule \| script-change | patch | W1 | davids-model \| ai-readability |
| 138 | T34.6 | Search parity replay and results-page verification | 3.80 | 3/4/1/2 | 4 | script-change \| doc-rule | patch | W1 | dynamics \| reliability |
| 139 | T37.2 | Baseline discipline and fleet presets | 3.80 | 3/4/1/2 | 3 | script-change \| doc-rule | patch | W1 | reliability \| speed-flow |
| 140 | T38.3 | Crawl hardening for locale twins: consent labels, redirected twins, context-destroyed retry | 3.80 | 3/4/1/2 | 1 | script-change \| doc-rule | patch | W1 | pixel \| reliability \| speed-flow |
| 141 | T26.1 | Ship a DOM-based importer skeleton driven by a vocabulary map | 3.75 | 5/4/3/5 | 11 | script-new | minor | W4 | speed-flow \| cost \| pixel \| davids-model \| reliabi |
| 142 | T27.1 | Ship a resumable wave driver in rollout (stage classes, per-page state, park/unpark, hash re-gate) | 3.75 | 5/4/3/5 | 8 | script-new | minor | W4 | speed-flow \| independence \| cost \| reliability |
| 143 | T07.5 | Plugin scripts resolve dependencies and sibling skills from a fallback chain | 3.75 | 4/5/3/4 | 7 | script-change (cross-cutting) | minor | W4 | reliability, cost |
| 144 | T08.3 | One sanctioned path for privileged actions | 3.75 | 3/4/2/1 | 4 | doc-rule + default-change (hands-off pub | patch | W1 | independence, reliability |
| 145 | T38.1 | Locale-tree wave procedure with the hooks it needs | 3.70 | 4/4/2/4 | 2 | reference-doc \| flow-change \| doc-rule ( | minor | W4 | independence \| pixel \| ai-readability \| editabilit |
| 146 | T17.3 | Masks from selectors, images, iframes and the dynamics inventory | 3.65 | 4/4/3/3 | 7 | script-change | patch | W2 | pixel, dynamics, speed-flow |
| 147 | T12.3 | `deploy/reference/project-move.md`: relocate/rename an EDS project to another org/site | 3.65 | 3/4/1/3 | 3 | reference-doc | minor | W3 | speed-flow, reliability |
| 148 | T25.2 | `block-parity.mjs`: per-block computed-style parity with base-CSS survivor attribution | 3.65 | 3/4/1/3 | 1 | script-new | patch | W2 | pixel, speed-flow |
| 149 | T34.4 | Dynamics tooling: state snapshots, source-row applier, new check types, noise controls | 3.65 | 3/4/1/3 | 1 | script-new \| script-change | minor | W3 | dynamics \| reliability \| pixel |
| 150 | T39.3 | Cross-plugin path probe and drift list (no pin) | 3.65 | 2/5/1/2 | 4 | script-change \| gate-change (lint) | patch | W2 | reliability \| cost |
| 151 | T29.4 | Rhythm engine reference: section-per-module, majority rhythm in CSS, adjacency classifiers | 3.60 | 4/3/2/3 | 5 | reference-doc | patch | W2 | pixel \| davids-model \| editability-EW |
| 152 | T36.3 | Redesign delivery on a replica repo: template scoping, branch-demo mode, box-compare gate | 3.60 | 4/3/2/3 | 1 | doc-rule \| gate-new \| flow-change | minor | W3 | pixel \| davids-model \| editability-EW \| independen |
| 153 | T11.4 | Fan-out / publish precondition: a gated archetype must exist before siblings ship | 3.60 | 3/4/2/2 | 2 | gate-new | minor | W3 | pixel, independence |
| 154 | T37.3 | Finding semantics: platform facts, language, encoded fragments, sanctioned no-h1 | 3.60 | 3/4/2/2 | 1 | script-change \| doc-rule | patch | W1 | reliability \| independence |

### Tier D — 30 candidates (< 3.60)

| # | id | improvement | comp. | I/G/R/E | proj. | type | bump | wave | dimensions |
|---:|---|---|---:|---|---:|---|---|---|---|
| 155 | T04.6 | Parallel-worktree recipe | 3.55 | 3/3/1/2 | 1 | reference-doc | patch | W1 | speed-flow, reliability |
| 156 | T20.4 | Media playability proof: HLS pattern, ranged-GET media probe, `video-plays` asserts playback | 3.55 | 3/3/1/2 | 2 | reference-doc + script-change + doc-rule | patch | W1 | dynamics, independence |
| 157 | T38.2 | Locale folder structure in the prep decision batch | 3.55 | 2/4/1/1 | 1 | doc-rule | patch | W1 | independence \| davids-model (#8 group like authori |
| 158 | T16.4 | Rendered-only inventory (guarded) and the element-boundary separator (B8, re-proposed with new evidence) | 3.45 | 4/4/4/3 | 3 | script-change (guarded default-change in | patch | W4 | pixel, speed-flow, ai-readability |
| 159 | T17.4 | Viewport regimes and pass-bar honesty: tablet structural pass, ≥1920 canvas assertion, footer-crop shift search, relative Δh | 3.45 | 4/4/4/3 | 6 | gate-change | minor | W4 | pixel, independence |
| 160 | T20.3 | Port the observed motion at deploy and re-assert on the published origin — decide the "no motion library" rule | 3.45 | 4/4/4/3 | 4 | flow-change + default-change (scoped car | minor | W4 | dynamics, pixel, independence |
| 161 | T25.1 | Source-already-on-EDS path: `sourcePlatform: eds`, `clone-eds-content.mjs`, `harvest-library.mjs`, library smoke gate | 3.45 | 4/3/2/4 | 1 | flow-change + script-new | minor | W4 | independence, speed-flow, cost, davids-model, edit |
| 162 | T36.1 | `direct --brand-docs <dir>`: brand guideline documents as a first-class design input, plus a content-compliance ledger | 3.45 | 4/3/2/4 | 1 | flow-change \| reference-doc | minor | W4 | independence \| pixel \| davids-model \| editability- |
| 163 | T06.3 | Live-variance grading in the stitched-capture instruments | 3.45 | 3/4/2/3 | 2 | script-change | patch | W2 | reliability, speed-flow |
| 164 | T10.4 | Self-proposed next wave from the link graph | 3.45 | 3/4/2/3 | 3 | flow-change | patch | W2 | independence, speed-flow |
| 165 | T35.4 | Fonts: measured-width `size-adjust`, verified harvest, exact-case paths | 3.45 | 3/4/2/3 | 1 | script-new \| doc-rule \| script-change (s | minor | W3 | speed-page \| pixel |
| 166 | T14.6 | Record-once/replay for bot-managed vendor scripts (`--har`) and the empty-vs-empty rule | 3.40 | 3/3/1/3 | 1 | script-new + script-change + doc-rule | patch | W2 | pixel, dynamics, reliability |
| 167 | T15.6 | Redesign flow: the approved prototype is the reference, same bar, not "advisory" | 3.40 | 3/4/3/2 | 3 | gate-change | minor | W3 | pixel, editability-EW, independence |
| 168 | T35.5 | Foundation scope rules: `border-box` per region, boundary margins, button alignment, helpers | 3.35 | 3/3/2/2 | 1 | doc-rule | patch | W1 | pixel \| davids-model \| reliability |
| 169 | T27.10 | Code-tier asset validation: fonts, icon glyphs, favicon reachability | 3.35 | 2/4/2/1 | 2 | doc-rule | patch | W1 | pixel \| reliability |
| 170 | T36.2 | `deploy --restyle`: restyle an existing customised EDS repo in place | 3.30 | 4/3/2/5 | 1 | flow-change \| script-new (`cls-probe.mjs | minor | W4 | independence \| editability-EW \| pixel \| speed-page |
| 171 | T07.6 | Measurement contexts bypass CSP and fail loud on injection | 3.30 | 2/3/1/1 | 1 | script-change | patch | W2 | pixel, reliability |
| 172 | T38.5 | Captured chrome link classes: templates, per-page alternates, resource paths | 3.30 | 2/3/1/1 | 1 | doc-rule | patch | W1 | davids-model \| reliability |
| 173 | T36.4 | Divergent concepts from measured references; mechanical sameness and fold checks | 3.25 | 4/3/3/4 | 1 | flow-change \| default-change \| gate-chan | minor | W4 | pixel \| independence \| cost \| speed-flow |
| 174 | T38.4 | Multi-site / second-origin delivery mode | 3.25 | 3/3/1/4 | 1 | reference-doc \| script-new | minor | W4 | dynamics \| editability-EW \| speed-flow |
| 175 | T33.5 | `hydrate-listings.mjs`: a generator stage that writes and replaces marked rows | 3.20 | 3/3/2/3 | 3 | script-new | minor | W3 | ai-readability \| dynamics \| speed-flow |
| 176 | T26.8 | Deploy-side importer guards: runtime auto-block contract and the in-page anchor regime | 3.20 | 2/4/2/2 | 2 | gate-change | minor | W3 | pixel \| davids-model \| dynamics \| reliability |
| 177 | T33.6 | Instrument hardening from the field (gate gotchas) | 3.15 | 2/3/1/2 | 3 | script-change \| doc-rule | patch | W1 | ai-readability \| reliability |
| 178 | T25.5 | Land the Figma donor (PR adobe/skills#315) and reconcile it with reskin's `--donor-figma` contract — re-proposal of deferred B15 with new evidence | 3.05 | 4/2/2/5 | 1 | flow-change (new sub-skill) + reference- | minor | W4 | pixel, independence, editability-EW, reliability |
| 179 | T25.3 | Structured SSR payload compile path (`structuredSource`, `structured-source.md`, `ssr-grammar.mjs`) | 3.05 | 3/3/2/4 | 1 | reference-doc + script-new | minor | W4 | speed-flow, cost, pixel, davids-model |
| 180 | T36.6 | Image sourcing ladder and "no foreign fixed art on reusable variants" | 3.05 | 2/2/1/1 | 1 | doc-rule | patch | W1 | independence \| speed-flow \| editability-EW |
| 181 | T25.4 | Fleet / multi-site reference and scoping instrument | 3.00 | 3/2/1/4 | 1 | reference-doc + script-new | minor | W4 | independence, speed-flow, reliability |
| 182 | T39.5 | External tools are optional: refero probe-once, no Turnstile trigger words | 2.90 | 1/3/1/1 | 1 | doc-rule | patch | W1 | reliability \| cost |
| 183 | T26.7 | DOM-mirror page generator as the documented reserve path (re-proposal of a deferred/rejected item with new evidence) | 2.85 | 3/3/3/4 | 3 | script-new | minor | W4 | speed-flow \| pixel \| cost |
| 184 | T36.5 | Promote an out-of-pipeline prototype and generate/parity-check the canon → EDS foundation | 2.80 | 3/2/2/4 | 1 | flow-change \| script-new | minor | W4 | speed-flow \| pixel \| cost |

## 5. Themes — where each improvement was identified

One entry per theme: what recurred, in which projects, and the candidates it produced. Full evidence tables and the "already in the plugin" verification are in `analysis/themes/<file>`.

### A — Cost and flow speed

**T01 Cache-TTL misses from blocking waits (sleep-polling gates, crawls, deploys)** — `analysis/themes/T01-cache-ttl-blocking-waits.md`  
Long-context stardust sessions (400–630k tokens per request in most long runs) block the conversation on fixed `sleep N` polls and blocking `TaskOutput` calls while a gate, crawl, Code Sync landing or deploy batch runs; every wait that crosses the 5-minute prompt-cache TTL forces the next request to re-write the whole prefix. System-wide (`analysis/cache-miss.txt`): 20,693 main-session requests, 708 M cache-creation tokens; 1,259 requests are full misses carrying 649 M tokens (92 % of all cache-creation); **1,222 of them (97 %) follow a gap ≥ 5 min and carry 640 M tokens = 90 % of all cache-creation**; median context at a miss is 500–800k (tennis-campus 990k, semiconductor-vendor 853k, …  
Projects (18): fintech-services, beverage-brand, credit-bureau, sports-car-maker, media-network, leisure-airline, pharma-manufacturer, entertainment-venues, cancer-center, tennis-club, energy-utility, small-runs, us-airline, nordic-bank, stardust-cost-study, eda-software-vendor, tennis-campus, wine-retailer.  
Candidates: **T01.1** Wait discipline: never block the conversation past the cache TTL (5.00, patch); **T01.2** Completion contract for batch drivers: progress file + one summary line, run in background (4.30, patch); **T01.3** `wait-for-origin.mjs`: a capped propagation waiter replacing sleep-then-regate (4.05, patch)

**T02 Context hygiene: full-page image reads, streamed probe dumps, fresh-session triage** — `analysis/themes/T02-context-hygiene-images-reports.md`  
Agents feed the wrong artefacts into a long-lived context: stitched full-page PNGs (1440×5,000–23,554 px, rendered to the model at 122–400 px wide and therefore unreadable), hand-cropped bands one Read at a time, raw gate/probe dumps and blocking `TaskOutput` transcripts. Two sessions died on the API's 32 MB request limit after 101 and 197 PNG reads (eda-software-vendor, entertainment-venues) and had to be rebuilt by hand; beverage-brand rode at 800–930k tokens for ~30 h and its own report says fidelity passes 7–8 cost 37.7 M cache-write tokens vs 8 M for passes 1–6 because probe dumps accumulated.  
Projects (13): contact-lens-retailer, fintech-services, beverage-brand, fintech-redesign, leisure-airline, entertainment-venues, cancer-center, tennis-club, energy-utility, it-software-vendor, us-airline, eda-software-vendor, pharmacy-retailer.  
Candidates: **T02.3** Runner output contract and long-session hand-off (4.45, patch); **T02.1** Image budget: read crops and sheets, never the stitched page (4.40, patch); **T02.2** `review-image.mjs`: contact sheets and stacked band strips from the gate outputs (4.30, patch)

**T03 Skill-document size and read discipline (deploy/SKILL.md 188 KB, whole-reference reads, operator cards)** — `analysis/themes/T03-skill-doc-size-read-discipline.md`  
The plugin's documentation is its largest recurring context cost. `skills/deploy/SKILL.md` is 188,377 bytes / 1,133 lines (≈ 47k tokens; measured 2026-09-18) — 2.6× the next skill — and the Skill tool injects it whole on every `stardust:deploy` invocation (141,908–184,734 chars recorded in health-insurer-a, it-software-vendor, us-airline, fintech-redesign, beverage-brand); it also exceeds the Read tool's 25,000-token cap (26,431 tokens: media-network, regional-bank), so agents re-read it in 3–6 slices, ~20 times per run once per dispatched agent (`analysis/skill-reads.txt`: 16 Read-tool reads and 0.68 M chars delivered across the sample, plus `cat` reads not counted).  
Projects (15): health-insurer-a, health-insurer-b, beverage-brand, sports-car-maker, regional-bank, media-network, fintech-redesign, leisure-airline, pharma-manufacturer, entertainment-venues, cancer-center, tennis-club, it-software-vendor, us-airline, tennis-campus.  
Candidates: **T03.1** Split deploy/SKILL.md into a ≤ 40 KB core plus step-scoped reference chapters (4.35, patch); **T03.2** Operator card + section index at the top of every SKILL.md; "read § X at step Y" TOCs on references > 20 KB (4.30, patch); **T03.3** Doc-size lint in `npm run lint:stardust` (4.05, patch)

**T04 Fan-out protocol** — `analysis/themes/T04-fan-out-protocol.md`  
Every long migration fans work out to parallel agents (replica archetypes, deploy §7 block agents, rollout waves), but the plugin says almost nothing about *how*: which agent type, how the coordinator learns an agent is alive, what happens when the harness kills one, how many browsers one laptop can carry, who owns which files, and how two sessions on one checkout coexist. The result is the largest cost and speed leak after cache misses: fork-spawned workers replayed 107–356 M cache-read tokens per fan-out (5 projects), watchdog stalls and lost transcripts cost 3–4 h of wall-clock per run in at least 6 projects, file/registry collisions forced re-work rounds in 4 projects, and Chromium …  
Projects (16): contact-lens-retailer, fintech-services, beverage-brand, credit-bureau, sports-car-maker, regional-bank, media-network, leisure-airline, pharma-manufacturer, cancer-center, tennis-club, energy-utility, nordic-bank, tennis-campus, pharmacy-retailer, wine-retailer.  
Candidates: **T04.2** Liveness and auto-resume contract for delegated agents (4.85, patch); **T04.1** Agent-type rule: fresh-context workers by default, forks only for short conversational tasks (4.60, patch); **T04.4** Ownership, registries and merge protocol for parallel writers (4.20, patch); **T04.3** Concurrency budget and machine-wide browser semaphore (3.85, minor); **T04.5** Run lock and multi-session write safety (3.80, patch); **T04.6** Parallel-worktree recipe (3.55, patch)

**T05 Iteration discipline — numeric first** — `analysis/themes/T05-iteration-discipline-numeric-first.md`  
The replica gate doc names a hard cap of 3 iterations per breakpoint and a rich inner loop (anchor probe, band table, row-profile landmarks, no-op check), but nothing *counts* — the cap lives in prose, the agent writes `progress.json` itself, and in four projects a single breakpoint ran 8–16 rounds (2–5 h each) before anyone noticed. In the same runs the diagnosis that finally converged was always numeric-first — a landmark/heading Δy table or a paired-box table read off text — while the default path (open crops, eyeball PNGs, hand-roll numpy/PIL band histograms) burned dozens of turns and repeatedly killed sessions. 10 findings in 9 projects; dimensions: speed-flow, cost, pixel.  
Projects (9): health-insurer-b, credit-bureau, regional-bank, entertainment-venues, cancer-center, energy-utility, it-software-vendor, us-airline, eda-software-vendor.  
Candidates: **T05.1** Cap semantics and composition-regime rules (doc) (4.60, patch); **T05.3** Landmark Δy table as the first diagnostic of every round (4.30, patch); **T05.2** Mechanical iteration counter in `gate.sh` (4.25, minor); **T05.4** pixel-compare emits offsets and crop stacks so PNGs are rarely opened (3.90, patch)

**T06 Sweep protocol and change detection** — `analysis/themes/T06-sweep-protocol-and-change-detection.md`  
Once a site is delivered, the plugin has no protocol for finding and fixing residual defects at site scale, so runs fell back to the most expensive loop available: gate every page, fix, re-gate every page (beverage-brand: 8 full-site passes, ~19 h, stopped by the user; eda-software-vendor: 13 full re-imports and 7 full deploys in one day; regional-bank: 7 full publishes in one evening). The batch driver makes this worse than it needs to be: `deploy-batch.mjs` keys its ledger on path + status with no content hash, so changed pages are skipped, and `--force` starts from an empty ledger that then overwrites the site record (verified at `deploy-batch.mjs:191-206`; two site ledgers lost). 13 findings in 9 projects; …  
Projects (10): semiconductor-vendor, health-insurer-a, health-insurer-b, beverage-brand, regional-bank, entertainment-venues, us-airline, nordic-bank, eda-software-vendor, pharmacy-retailer.  
Candidates: **T06.1** `deploy-batch` ledger: content hash, merge semantics, path normalisation (4.65, patch); **T06.2** Site-scale fix loop: template sample → class triage → one confirmation sweep (4.40, patch); **T06.4** Change detection upstream of deploy: re-gate list, importer coverage index, patch file (3.90, minor); **T06.3** Live-variance grading in the stitched-capture instruments (3.45, patch)

**T07 Environment preflight and runner** — `analysis/themes/T07-environment-preflight-and-runner.md`  
Forty-nine findings in 24 projects describe the same eight tooling failure classes recurring run after run: probe scripts written to `/tmp` (or run from the plugin path) that cannot resolve `playwright`/`pngjs` (~90 errors, 14 projects), `--no-save` installs pruned mid-run and lint deps missing (8 projects), a stale foreign server on the documented gate/harness port measured as the build (~30 collisions, 13 projects), zsh/bash-3.2 shell traps inside inline loops (~55 errors, 12 projects), `curl \| grep` on gzip bodies misread as "CSS not live" (5 projects), the harness's 2-minute foreground budget, cwd drift in nested repos, and orphan/memory-starved browser processes. Each is documented …  
Projects (25): contact-lens-retailer, semiconductor-vendor, fintech-services, health-insurer-a, health-insurer-b, beverage-brand, credit-bureau, sports-car-maker, regional-bank, media-network, fintech-redesign, leisure-airline, pharma-manufacturer, entertainment-venues, cancer-center, tennis-club, energy-utility, it-software-vendor, us-airline, nordic-bank, stardust-cost-study, eda-software-vendor, tennis-campus, pharmacy-retailer, wine-retailer.  
Candidates: **T07.2** Harness-quirks card (4.60, patch); **T07.1** One Setup preflight: dependencies, probes dir, environment record (4.50, minor); **T07.4** `served-check` helper and the `--compressed` rule where agents read it (4.20, patch); **T07.3** Port allocator and server identity for every localhost URL a gate consumes (3.85, minor); **T07.5** Plugin scripts resolve dependencies and sibling skills from a fallback chain (3.75, minor); **T07.6** Measurement contexts bypass CSP and fail loud on injection (3.30, patch)

**T08 Permission classifier and privileged-transport preflight** — `analysis/themes/T08-permission-classifier-and-privileged-preflight.md`  
In hands-off runs under a harness permission layer (Claude Code auto mode), the classifier denied the plugin's own crawler as "challenge evasion" (entertainment-venues: 14 denials, ~2 h before the first crawl), refused repo creation / live publish as "Create Public Surface" / "Production Deploy" (fintech-services, beverage-brand, nordic-bank, regional-bank, energy-utility: discovered 8 h into the run, after migrate), and flagged credential handling ("Credential Materialization", a PAT pasted into chat) — 40+ denials across 8 findings in 7 projects. The plugin neither tells the user what to pre-approve, nor probes privileged transports in the first minutes, nor routes privileged actions through one recognisable command; every denial …  
Projects (7): fintech-services, beverage-brand, regional-bank, entertainment-venues, cancer-center, energy-utility, nordic-bank.  
Candidates: **T08.1** Privileged-transport preflight in the first minutes, with a "blocked-on-owner" surface (4.45, patch); **T08.2** Harness-permissions card with the plugin's command shapes and a pre-approval snippet (4.20, patch); **T08.4** Credential hygiene in commands and interactive auth hand-off (4.20, patch); **T08.3** One sanctioned path for privileged actions (3.75, patch)

### B — Independence

**T09 Credentials preflight and park** — `analysis/themes/T09-credentials-preflight-and-park.md`  
Every DA-backed migration longer than a working day crosses the ~24 h IMS token horizon, and in 17 of the analysed projects the run discovered it the hard way: a 401 mid-batch, hand-rolled JWT decoding, pages flipped red, subagents dying while probing for workarounds, and the run idling 20 min to 5 days until a human typed "token refreshed". Two sibling credential classes recur with the same shape — `SITE_TOKEN_<SITE>` for protected origins (declared as a blocker although the token was already in `.env`) and `GH_PAT` for Code Sync (4 h lost at kick-off).  
Projects (16): contact-lens-retailer, health-insurer-b, beverage-brand, credit-bureau, regional-bank, leisure-airline, pharma-manufacturer, entertainment-venues, cancer-center, tennis-club, energy-utility, it-software-vendor, us-airline, nordic-bank, eda-software-vendor, tennis-campus.  
Candidates: **T09.1** Ship `da-token-check.mjs` (resolve, decode, smoke, remaining hours) (4.85, minor); **T09.2** Master Setup step 7: credentials preflight, `SITE_TOKEN_<SITE>` discovery, planning against the token window (4.85, patch); **T09.3** `deploy-batch.mjs`: preflight, halt on auth failure, sentinel for site-level 401/404 (4.25, patch); **T09.4** Park / stage / resume contract for token-bound work (4.20, patch)

**T10 Hands-off contract** — `analysis/themes/T10-hands-off-contract.md`  
Under an explicit "not monitoring / never stop" mandate the runs still ended turns to report, ask, or wait for a nudge: the stardust-cost-study cost analysis counts 127 bare acknowledgements across 16 sessions (73 "continue", 14 "retry", 11 "yes", 10 "token refreshed"), and single projects show 9–20 pauses with idle gaps of 25 min to 41 h. Three mechanisms explain almost all of them: decisions that had derivable defaults were asked mid-flow (deploy target, fonts, link boundary, chrome inlining, locale structure, scope), wave/phase ends were treated as report points instead of chaining, and harness stalls forced a human "continue" because no checkpoint said what the next command was.  
Projects (20): contact-lens-retailer, semiconductor-vendor, health-insurer-a, health-insurer-b, beverage-brand, credit-bureau, sports-car-maker, regional-bank, fintech-redesign, leisure-airline, pharma-manufacturer, entertainment-venues, cancer-center, tennis-club, energy-utility, it-software-vendor, us-airline, stardust-cost-study, eda-software-vendor, pharmacy-retailer.  
Candidates: **T10.1** Turn-ending contract: never stop to report; chain waves; state the commit policy and the stop point (4.80, patch); **T10.3** Phase checkpoints with the next command, and a resume rule that never re-runs finished steps (4.60, patch); **T10.2** Decision register `stardust/decisions.md` and a plan-time decision batch with derivable defaults (4.25, patch); **T10.4** Self-proposed next wave from the link graph (3.45, patch)

**T11 Routing enforcement** — `analysis/themes/T11-routing-enforcement.md`  
0.18.5 fixed the routing *surface* (master table, "two flows, never mix", descriptions), yet in six later projects a same-design mandate never reached `replica`: `direct` was invoked with "exact replica" and continued into a redesign prep, `migrate`/`extract` accepted a raw URL and the agent built a custom compiler, `prepare-migration` was loaded for a keep-design site, and long resume sessions never invoked any skill at all. The cost is the worst in the corpus for pixel and speed: 2,207 pages published at 24–28 % diff, 3.5 h discarded at a mode switch, two runs re-implementing the pipeline by hand.  
Projects (9): semiconductor-vendor, fintech-services, credit-bureau, pharma-manufacturer, tennis-club, it-software-vendor, us-airline, eda-software-vendor, pharmacy-retailer.  
Candidates: **T11.2** `direct` zero-movement → hand off to `replica`; keep-design phrases auto-select replica; named-deviation journal rule (5.00, patch); **T11.1** Flow selection recorded in state; sub-skill entry guards refuse a migration with no flow chosen (4.65, minor); **T11.3** First gate asks keep-vs-redesign; planning aids named per flow; resume enters through the master skill and each phase through its Skill; routing eval (4.45, patch); **T11.4** Fan-out / publish precondition: a gated archetype must exist before siblings ship (3.60, minor)

**T12 Site bootstrap, relocate, lockdown** — `analysis/themes/T12-site-bootstrap-relocate-lockdown.md`  
The plugin's delivery chain starts at "an EDS project at the repo root with `DA_TOKEN`" and ends at the rollout report; everything before (create the repo from the boilerplate, Code Sync installation, admin config / `fstab.yaml`, DA folder seed) and after (make the repo private, put both origins behind site auth) is outside it. Paolo's personal `eds-new-site` skill fills the front gap — so runs that did not invoke it halted for "credentials/repo only you can provide", discovered a missing fstab mid-run, or waited 25 h for a first URL — and nothing fills the back gap: 76 customer repos accumulated public and unprotected in one month.  
Projects (10): contact-lens-retailer, semiconductor-vendor, fintech-services, dynamics-learnings, regional-bank, media-network, fintech-redesign, pharma-manufacturer, cancer-center, it-software-vendor.  
Candidates: **T12.4** Time-to-first-URL: publish a preview before pixel iteration (4.20, patch); **T12.1** `deploy/reference/site-bootstrap.md` + a Setup hook that provisions repo, Code Sync, config and DA seed before the first deploy (4.10, minor); **T12.2** Lockdown step: private repo + site auth, default on for customer-domain migrations (4.10, minor); **T12.3** `deploy/reference/project-move.md`: relocate/rename an EDS project to another org/site (3.65, minor)

**T13 Progress surface and close deliverables** — `analysis/themes/T13-progress-surface-and-close-deliverables.md`  
Owners asked the same questions in almost every project — "where are we?", "is anything running?", "are any pages live?", "open N pages next to their originals", "how many tokens?", "write it in the issue" — because the plugin's progress surface is the LLM-rendered state report (no live probe, no gate numbers, no running phase) and its close-out artefacts are produced only at the very end (dashboard, Phase I) or only when asked (learnings ledger, review pairs, token ledger, tracking comment). Independence and speed-flow suffer twice: the questions themselves (7–8 status prompts per project) and the hand-built recap tables.  
Projects (14): health-insurer-b, beverage-brand, dynamics-learnings, credit-bureau, regional-bank, fintech-redesign, entertainment-venues, cancer-center, energy-utility, small-runs, us-airline, stardust-cost-study, eda-software-vendor, wine-retailer.  
Candidates: **T13.1** `stardust status`: a deterministic, read-only progress surface (script) + tracking-issue convention (4.30, minor); **T13.2** Wave-close checklist in rollout Phase H, enforced, with `open-review-pairs.mjs` (4.10, minor); **T13.3** Hand-off report template: gate table first, one reporting KPI, provenance, before/after evidence (4.05, patch); **T13.4** Optional usage ledger per phase/wave (`token-ledger.mjs`) (3.80, minor)

**T14 Bot management and live budget** — `analysis/themes/T14-bot-management-and-live-budget.md`  
Bot-managed origins (Cloudflare, Akamai, PerimeterX/HUMAN, Turnstile) turned the live side of every instrument — crawl, stitch-shot, content-diff, anchor, chrome-parity, motion-observe — into the dominant source of hand interventions, wasted windows and false measurements in 12 of the analysed projects. The plugin's ladder (real-Chrome UA + standard headers → headed stealth Chrome → "the gate cannot run", `diff/scripts/live-session.mjs:51-53`) has four structural gaps: a cleared session is never reused (every new context is re-challenged, 6+ hand solves on one project), headed Chrome is the only escalation (visible windows on the owner's laptop, four interrupts), the challenge classifier …  
Projects (12): contact-lens-retailer, fintech-services, credit-bureau, regional-bank, media-network, leisure-airline, pharma-manufacturer, entertainment-venues, energy-utility, it-software-vendor, stardust-cost-study, pharmacy-retailer.  
Candidates: **T14.1** Reuse the admitted session: storageState clone + `--storage-state` in every live instrument (4.70, patch); **T14.2** Escalation ladder: headless real Chrome before any window, windows off-screen and opt-in (4.25, patch); **T14.4** Per-host live budget: pacing, one-live-tool lock, 429 handling (4.10, patch); **T14.3** Challenge classifier + interactive human-solve mode + capture sanity (4.05, patch); **T14.5** `--block <substr,...>` route-abort in the shared live session (3.95, patch); **T14.7** Capture provenance: technique, date, variant markers — and dated references in the gate (3.80, patch); **T14.6** Record-once/replay for bot-managed vendor scripts (`--har`) and the empty-vs-empty rule (3.40, patch)

### C — Pixel fidelity and gates

**T15 Published gate for every page** — `analysis/themes/T15-published-gate-every-page.md`  
The plugin's fidelity proof is a prototype-vs-live gate on **one archetype per page type**, after which "siblings inherit the archetype's source-fidelity gate" (`replica/SKILL.md:284`) and the published-origin gate is prose with no script, no ledger writer and no caller in `deploy` or `rollout`. The consequence recurred in 16 projects and was measured from outside: an independent live-vs-deployed pixel diff found medians of 4.2 / 28.8 / 49.4 % on three sites whose in-project archetype gates were green (stardust-cost-study E1), and the projects' own ad-hoc instruments agreed (entertainment-venues 122 published-failing vs 20 migrated; beverage-brand 132 fail of 583; energy-utility 6 pass / 45 fail on a careers sample).  
Projects (18): fintech-services, health-insurer-a, beverage-brand, credit-bureau, regional-bank, fintech-redesign, entertainment-venues, cancer-center, tennis-club, energy-utility, it-software-vendor, us-airline, nordic-bank, stardust-cost-study, eda-software-vendor, tennis-campus, pharmacy-retailer, wine-retailer.  
Candidates: **T15.3** Residual discipline: named classes only, over-bar is FAIL, mobile never skipped, honest reports (4.45, patch); **T15.2** Every delivered page gets a number: coverage regime and sibling sampling (4.30, minor); **T15.5** `gate-ledger-lint.mjs` before rollout Phase C (4.25, minor); **T15.1** Ship `gate-publish.mjs`: the published-origin gate as a script and as the release condition (3.95, minor); **T15.4** `gate.sh` counts iterations and enforces the cap (3.85, patch); **T15.6** Redesign flow: the approved prototype is the reference, same bar, not "advisory" (3.40, minor)

**T16 Content-parity gate** — `analysis/themes/T16-content-parity-gate.md`  
Content-count acceptance is the cheapest gate in the flow — a static role inventory of the captured source against the imported/delivered page, no browser, no live hit — and the plugin documents it as mandatory for every sibling (`migrate/reference/fidelity-tiers.md:70-98`, `migrate/SKILL.md:208-217`) but ships no script for it: `content-diff.mjs` takes two URLs, both re-fetched, and Step 10 declares it advisory. Ten projects paid for the gap: 4,184 pages with 1,145 fewer images and 1,016 dropped links found only by a one-off acceptance round (eda-software-vendor), 510 pages imported with no content signal (energy-utility), zero-row blocks passing every gate four times in one run (nordic-bank), 472 of 479 …  
Projects (12): contact-lens-retailer, semiconductor-vendor, credit-bureau, media-network, leisure-airline, pharma-manufacturer, energy-utility, us-airline, nordic-bank, stardust-cost-study, eda-software-vendor, wine-retailer.  
Candidates: **T16.2** Zero-row blocks and empty module sections are red (4.60, patch); **T16.1** Ship `content-acceptance.mjs`: the offline source-vs-imported role inventory gate (4.50, minor); **T16.3** content-diff hardening: offline source side, per-side roots, href normalisation, register awareness, shadow roots (3.85, patch); **T16.4** Rendered-only inventory (guarded) and the element-boundary separator (B8, re-proposed with new evidence) (3.45, patch)

**T17 Gate-stack redesign — what the pixel gate measures, not how** — `analysis/themes/T17-gate-stack-redesign.md`  
The single page-level pixel percentage is the wrong denominator for the defects human reviewers actually find: a 64 px hero offset is 1 % of a page, a wrong header 1.5 %, an inert menu 0 % (beverage-brand:F6), and an external unmasked live-vs-deployed audit read 4 / 29 / 49 % medians on three sites whose archetype gates were green (stardust-cost-study:E1). Across 15 projects the same four gaps recur: the live reference is treated as constant (index-fed tiles, footers, promo strips and campaign heroes drift between capture and gate, and the live page does not even pixel-match itself); masks are manual row bands with no link to what is known to be dynamic; the pass bar is absolute (\|Δh\| ≤ 8 px, …  
Projects (16): health-insurer-b, beverage-brand, credit-bureau, sports-car-maker, regional-bank, leisure-airline, entertainment-venues, cancer-center, tennis-club, energy-utility, us-airline, nordic-bank, stardust-cost-study, eda-software-vendor, pharmacy-retailer, wine-retailer.  
Candidates: **T17.1** Name the residual classes and make the gate report carry regime, masks, unmasked number and reference date (4.45, patch); **T17.2** `gate.sh`: reference freshness and live self-variance before the first round (4.10, patch); **T17.3** Masks from selectors, images, iframes and the dynamics inventory (3.65, patch); **T17.4** Viewport regimes and pass-bar honesty: tablet structural pass, ≥1920 canvas assertion, footer-crop shift search, relative Δh (3.45, minor)

**T18 Chrome state matrix — chrome is many states and several variants, not one resting crop** — `analysis/themes/T18-chrome-state-matrix.md`  
Every gate in the plugin measures chrome at rest, at t=0, on the archetype's page: header/footer crops (0.18.4), computed-style parity (0.19.4) and canon re-verification per archetype (0.19.1). In 15 projects the defects the gates missed were exactly the states and variants they never looked at — mega-menus that shipped inert because the panel is off-DOM until hovered (sports-car-maker:F1, energy-utility:F6, beverage-brand:F7, health-insurer-b:F12/F13), search overlays and mobile drill-downs (eda-software-vendor:F12), sticky/scrolled behaviour invented or dropped (pharma-manufacturer:F8, regional-bank:F26), dropdowns painted behind content (pharma-manufacturer:F8), and chrome that varies by URL depth, template family, theme or generation while one canon was assumed …  
Projects (15): contact-lens-retailer, health-insurer-a, health-insurer-b, beverage-brand, credit-bureau, sports-car-maker, regional-bank, pharma-manufacturer, cancer-center, energy-utility, it-software-vendor, eda-software-vendor, tennis-campus, pharmacy-retailer, wine-retailer.  
Candidates: **T18.1** Chrome archetype: inventory chrome states and variants before fan-out, gate each once (4.50, minor); **T18.2** `chrome-states.mjs`: enumerate triggers, open every state, emit crops, computed styles and a nav document model (4.35, minor); **T18.4** Deploy Step 6 / rollout: chrome delivery contract — states, variants, guard set (4.10, patch); **T18.3** `chrome-parity.mjs`: scroll state, open state, list-style, stacking and alignment checks (4.05, patch)

**T19 Capture-instrument hardening — stitch-shot, live-session overlays, capture provenance, crawl captures** — `analysis/themes/T19-capture-instrument-hardening.md`  
Every false pixel number that cost a diagnosis round in 2026-08/09 traces to one of four instruments measuring something other than the page: `stitch-shot.mjs` baking pinned chrome, a fractional last chunk, undecoded images or a load-raced short capture into the PNG; `live-session.mjs` `dismissOverlays` missing late-mounting, non-English, iframe-hosted, shadow-DOM or hidden-duplicate consent controls and persistent floating widgets; captures with no provenance, so PNGs from different instruments, consent states or dates were compared; and `crawl.mjs` shooting desktop-only, wrapping > 16,384 px pages, and passing consent-covered screenshots as ground truth. Twenty-two projects hit at least …  
Projects (19): contact-lens-retailer, fintech-services, health-insurer-a, health-insurer-b, beverage-brand, credit-bureau, sports-car-maker, regional-bank, leisure-airline, pharma-manufacturer, entertainment-venues, cancer-center, tennis-club, energy-utility, it-software-vendor, nordic-bank, tennis-campus, pharmacy-retailer, wine-retailer.  
Candidates: **T19.1** `stitch-shot.mjs`: pinned chrome per chunk, integer scroll, decode/visibility/short-capture guards, tail and exclude (4.30, patch); **T19.2** `live-session.mjs` `dismissOverlays`: visible-match, text fallback, late mount, frames, shadow roots, persistent widgets, fail-loud (4.30, patch); **T19.3** Capture provenance sidecar and consent as one instrument parameter (4.25, patch); **T19.4** `crawl.mjs` captures: 360 shot, long-page clipping, quirks mode, DPR decision, vision-gate recapture, brand-surface exclusions (4.10, patch)

**T20 Motion and interaction parity — observe more, assert the behaviour, port it, prove it on the published page** — `analysis/themes/T20-motion-and-interaction-parity.md`  
0.18.3 made interaction parity a required per-archetype gate output and shipped `motion-observe.mjs` with the evidence rule "implement only what fired". The 2026-08/09 runs show three remaining gaps.  
Projects (7): contact-lens-retailer, health-insurer-b, beverage-brand, credit-bureau, sports-car-maker, tennis-club, energy-utility.  
Candidates: **T20.2** `motion-assert.mjs` behaviour-match + `click-control` check in `dynamics-check` and `qa-gate` (4.30, minor); **T20.1** `motion-observe.mjs`: observe style, aria, hidden and childList mutations; entrance families; hover probe hardening (4.25, patch); **T20.4** Media playability proof: HLS pattern, ranged-GET media probe, `video-plays` asserts playback (3.55, patch); **T20.3** Port the observed motion at deploy and re-assert on the published origin — decide the "no motion library" rule (3.45, minor)

**T21 Pipeline-true harness and stored pipeline facts** — `analysis/themes/T21-pipeline-true-harness-and-facts.md`  
The local QA harness (`build-harness.mjs` / `render-harness.mjs`) renders authored content through the *client* runtime only; the EDS *server* pipeline (helix-html-pipeline / md2html) applies a further dozen transforms that the harness never sees — emphasis hoisted out of anchors (→ buttonized), `<img>` → `<p><picture>`, section-metadata applied server-side, whitespace/NBSP/`<br>` trimming, top-level `<table>` → block, `:icon:` spans, fragments. In 17 projects pages passed the local gate and failed only at the published origin, each transform costing one publish-and-diagnose round and, in three projects, ~10 wasted nested gate-agent runs (regional-bank F14 ≈ 400 requests).  
Projects (17): health-insurer-a, health-insurer-b, beverage-brand, credit-bureau, regional-bank, media-network, leisure-airline, pharma-manufacturer, entertainment-venues, tennis-club, energy-utility, it-software-vendor, nordic-bank, eda-software-vendor, tennis-campus, pharmacy-retailer, wine-retailer.  
Candidates: **T21.1** Make the local harness apply the pipeline's transforms (one shared `pipelineMimic`) (4.50, patch); **T21.3** ENCODE contract additions + davids-model-lint rules for pipeline-sensitive shapes (4.45, patch); **T21.2** Stored pipeline-facts contract: `reference/pipeline-facts.md` + `pipeline-probe.mjs` + `runtime-contract.json#pipeline` (4.10, minor); **T21.4** Bulk delivery drivers are node scripts that prove the write landed (4.05, patch)

**T22 Code and content on different cache clocks** — `analysis/themes/T22-code-content-cache-clocks.md`  
EDS serves code (`blocks/**`, `styles/**`, `scripts/**`) with `cache-control: max-age=7200` and through AEM Code Sync, while content previews are near-instant. Every gate round that captures the published origin right after a code push therefore risks measuring a stale mixture: "phantom" no-op rounds, worse-then-better verdicts, a 2-hour user-visible regression window when the content shape changes before the code that reads it is served, and — in the other direction — 40-minute hunts for a "stuck" Code Sync that was working (gzipped bytes compared to raw sizes).  
Projects (8): contact-lens-retailer, semiconductor-vendor, health-insurer-a, sports-car-maker, regional-bank, pharma-manufacturer, cancer-center, energy-utility.  
Candidates: **T22.1** `code-sync-verify.mjs`: sync, purge, and prove the served code is HEAD before any capture (4.70, minor); **T22.3** Syntax and lint gate before any code push (4.05, minor); **T22.2** Ordering rules: code first, then content, then gate on the ref the user will look at; compatibility window for shape refactors (3.80, patch)

### D — Extract and discovery

**T23 `crawl.mjs` implements the extract contract** — `analysis/themes/T23-crawl-implements-extract-contract.md`  
The extract skill documents a rich per-page schema (`current-state-schema.md`), a 17-item capture list (`playwright-recipe.md`) and six phases, but the only shipped instrument, `crawl.mjs`, emits a small subset: headings as `{tag,text}`, flat body text, flat link list, image `{src,alt,w,h}`, CSS-background URL strings, videos/iframes, custom props, provenance, the rendered-DOM sidecar and (opt-in) the dynamic section. No landmarks, no computed styles, no media/font download, no forms/widgets outside `--dynamics`, DPR 1, shadow roots invisible, a slug algorithm that contradicts the reference, `_crawl-log.json` overwritten per run, and Phases 3–6 (brand surface, DESIGN.json, brand-review, …  
Projects (12): health-insurer-a, health-insurer-b, beverage-brand, credit-bureau, media-network, leisure-airline, entertainment-venues, cancer-center, tennis-club, us-airline, pharmacy-retailer, wine-retailer.  
Candidates: **T23.1** Emit the documented per-page schema from `capture()` (4.35, minor); **T23.2** Media and font harvest (`--assets`, default on for `--prep`/replica) (4.30, minor); **T23.5** `replica/scripts/lift.mjs` — the per-breakpoint computed-style lift, plus recreation one-liners (4.05, minor); **T23.3** Slug, flags and log: make `crawl.mjs` and `ia-extraction.md` agree (4.05, patch); **T23.4** Ship extract Phases 3–6 as scripts (`brand-surface.mjs`, `brand-review.mjs`, `state-update.mjs`) (3.80, minor)

**T24 Discovery and roster** — `analysis/themes/T24-discovery-and-roster.md`  
`crawl.mjs discover()` implements a fraction of the documented discovery procedure: `/sitemap.xml` and `/sitemap_index.xml` only (no `robots.txt` `Sitemap:` lines, one-level index recursion capped at 8 children), BFS depth 1 from the entry page, no subtree scoping despite the `<url>` path contract, no per-URL classification (redirects, off-origin bounces, gated stubs, dead URLs and already-EDS destinations all enter the roster as pages), no `--cookie` for server-side gates, and no way to extend the roster from client-rendered listings or query-string page states. In 12 projects the agent hand-built the inventory (curl BFS scripts, `_classify.mjs`, `discover-bfs.mjs`, `news-liveness.mjs`), …  
Projects (12): semiconductor-vendor, fintech-services, health-insurer-a, health-insurer-b, beverage-brand, credit-bureau, sports-car-maker, leisure-airline, pharma-manufacturer, tennis-club, energy-utility, tennis-campus.  
Candidates: **T24.1** Implement the documented discovery in `discover()`: robots sitemaps, full index recursion, subtree scoping, BFS `--depth`, `--cookie` (4.10, patch); **T24.2** Classify every roster URL: page / redirect / off-origin / gated / dead / app-shell, with a per-URL platform (4.05, minor); **T24.3** Roster extension from dynamic evidence, parameterised states, link audit and freshness (3.80, minor)

**T25 Source-shape paths** — `analysis/themes/T25-source-shape-paths.md`  
Four source shapes recur in the 2026-08 runs that neither migration flow (redesign, keep-design) has a path for: (a) the source is already on EDS or the customer runs an EDS block library the sandbox cannot see except as served code; (b) the site is a Next/Nuxt SSR app whose `__NEXT_DATA__`/`__NUXT__` payload is a complete, typed content model; (c) a fleet/family of sibling sites (35 locales, 185 sites, dealer estates) to migrate onto one library; (d) a Figma web kit as the design donor. In each case the agent improvised a whole sub-flow — 156 harvested library files (leisure-airline), three deterministic compilers (pharma-manufacturer), a 709-line Python renderer (fintech-redesign), 20 hand-run sync commits (energy-utility), a 12-day …  
Projects (7): fintech-services, sports-car-maker, fintech-redesign, leisure-airline, pharma-manufacturer, energy-utility, pharmacy-retailer.  
Candidates: **T25.2** `block-parity.mjs`: per-block computed-style parity with base-CSS survivor attribution (3.65, patch); **T25.1** Source-already-on-EDS path: `sourcePlatform: eds`, `clone-eds-content.mjs`, `harvest-library.mjs`, library smoke gate (3.45, minor); **T25.5** Land the Figma donor (PR adobe/skills#315) and reconcile it with reskin's `--donor-figma` contract — re-proposal of deferred B15 with new evidence (3.05, minor); **T25.3** Structured SSR payload compile path (`structuredSource`, `structured-source.md`, `ssr-grammar.mjs`) (3.05, minor); **T25.4** Fleet / multi-site reference and scoping instrument (3.00, minor)

### E — Migrate, importer, rollout

**T26 Importer skeleton and rules** — `analysis/themes/T26-importer-skeleton-and-rules.md`  
Every same-design migration of a templated site needs the same tool — "captured rendered DOM → EDS content documents via a block vocabulary and a transform table" — and the plugin ships none (`skills/migrate/` has no `scripts/` directory, only two audit fixtures). Ten projects wrote it from scratch (34 KB Python in health-insurer-a, 13+ Python generators in us-airline, four 94 KB generators at the it-software-vendor root, a copied `stardust/scripts/eds/` toolchain in nordic-bank, `generic.mjs` in pharmacy-retailer, regex importers in energy-utility/eda-software-vendor/leisure-airline/entertainment-venues/semiconductor-vendor), and each re-learned the same defect classes: markers matched on descendants instead of the element, wrappers flattened before pattern-matching, …  
Projects (14): semiconductor-vendor, fintech-services, health-insurer-a, health-insurer-b, credit-bureau, media-network, leisure-airline, entertainment-venues, energy-utility, it-software-vendor, us-airline, nordic-bank, eda-software-vendor, pharmacy-retailer.  
Candidates: **T26.3** Make "flatten to prose" and unmapped modules a hard import failure; widen content-count classes (4.20, minor); **T26.2** Write the importer rules reference (numbered, site-agnostic) (4.20, patch); **T26.6** Ship the prototype→content transcriber and the thin-tier converter in deploy (4.10, minor); **T26.5** Generated content is never hand-edited: patch files and out-of-tree generated artifacts (4.05, patch); **T26.4** One shared `hiddenLive()` visibility test for importer and gates (additive, opt-in on the diff side) (4.00, patch); **T26.1** Ship a DOM-based importer skeleton driven by a vocabulary map (3.75, minor); **T26.8** Deploy-side importer guards: runtime auto-block contract and the in-page anchor regime (3.20, minor); **T26.7** DOM-mirror page generator as the documented reserve path (re-proposal of a deferred/rejected item with new evidence) (2.85, minor)

**T27 Rollout wave driver and delivery chain** — `analysis/themes/T27-rollout-wave-driver-and-delivery-chain.md`  
Between "content file on disk" and "page verified live" the plugin ships pieces — `deploy-batch.mjs` (PUT→preview→live with a path+status ledger), `delivery-lint.mjs`, `media-reconcile.mjs`, `localize-links.mjs`, `verify.mjs`, `update-coverage.mjs` — but no driver that chains them per page or per wave, no content hash in the ledger, no pre-PUT media/SVG/path stage that uses the real EDS naming rule, and no bundled media rehost. Twenty projects filled the gaps with their own shell chains and drivers (credit-bureau `wave-run.mjs`, sports-car-maker `deploy-page.sh`, nordic-bank `_pm-*.mjs`, pharmacy-retailer `lib.externalMedia()`, tennis-campus `news-media-check.mjs`, leisure-airline `batch-import.mjs`) and re-learned the same failure …  
Projects (21): contact-lens-retailer, semiconductor-vendor, fintech-services, health-insurer-a, health-insurer-b, beverage-brand, credit-bureau, sports-car-maker, regional-bank, media-network, leisure-airline, pharma-manufacturer, entertainment-venues, tennis-club, energy-utility, us-airline, nordic-bank, eda-software-vendor, tennis-campus, pharmacy-retailer, wine-retailer.  
Candidates: **T27.3** Pre-PUT path sanitisation with the real EDS rule, exported as `normalizeDaPath()`, wired into the driver (4.65, minor); **T27.2** Harden `deploy-batch.mjs`: content hash, merge-safe ledger, re-preview on `about:error`, size guard, `--paths` file/list, `--report`, `update-coverage --from-ledger` (4.10, patch); **T27.5** Ship `deploy/scripts/rehost-media.mjs` with a media ledger as the default ENCODE behaviour for external imagery (4.10, minor); **T27.6** Ship `deploy/scripts/deploy-page.mjs` — the per-page chain — and make `localize-links --check` a hard gate (promote D4 LOCALIZE to 🔴) (4.10, minor); **T27.4** Media pre-flight stage: SVG scan/rasterise, size and count caps, liveness HEAD with browser UA (3.85, minor); **T27.8** Link completeness: alias map, inverse pass, dead-same-origin qa check, and the one link-policy decision written down (3.85, minor); **T27.7** Fix the rollout ledger scripts: typed rows for chrome/fragments/sheets, `content-pending` guard, host normalisation, pending-vs-failed link targets (3.85, patch); **T27.9** Redirects, folder indexes, sheets, listing order, `og:image` and JSON-LD delivery — the small delivery rules (3.80, patch); **T27.1** Ship a resumable wave driver in rollout (stage classes, per-page state, park/unpark, hash re-gate) (3.75, minor); **T27.10** Code-tier asset validation: fonts, icon glyphs, favicon reachability (3.35, patch)

**T28 Sibling variance and layout clusters** — `analysis/themes/T28-sibling-variance-and-layout-clusters.md`  
"Same template" as recorded by the CMS label or by `state.json.type` is a hypothesis, not a layout fact: siblings of a gated archetype differ in section composition (326 signatures among 1,411 "program" pages in eda-software-vendor; 2 of 2 model siblings broke the archetype's module sequence in sports-car-maker), in component variants never seen on the archetype (`.horizontal-tabs` on 293 pages vs the lifted `.vertical-tabs` on 39), in module kinds the archetype never carried (nordic-bank product siblings 13–30 % off at 360), in theme bindings (beverage-brand's dark header on Fanta/Fuze), and — at fleet scale — in the whole design (pharma-manufacturer's 11 Vue locales re-skinned into the pilot's canon, 700 pages redone). The …  
Projects (9): health-insurer-b, beverage-brand, credit-bureau, sports-car-maker, pharma-manufacturer, us-airline, nordic-bank, eda-software-vendor, pharmacy-retailer.  
Candidates: **T28.1** Cluster the corpus by rendered layout signature and gate one exemplar per cluster (4.10, minor); **T28.2** Variant census before styling a block, with descendant-class coverage per component (4.05, minor); **T28.4** Rollout Phase B/C rules: interactive or multi-column `generic` sections need a block; a template's blocks are not verified before its own archetype passes; encoder-vs-generic count check (4.00, minor); **T28.3** Site-fingerprint gate before fleet fan-out (design similarity decides canon groups) (3.80, minor); **T28.5** Replica sibling-tier rules: module-kind × breakpoint lift ledger, sequence-driven generators, per-theme bindings (3.80, patch)

### F — Authoring model and AI readability

**T29 Section-style vocabulary and variant budget** — `analysis/themes/T29-section-style-and-variant-budget.md`  
Pixel-parity pressure pushes per-band geometry into author-facing knobs: section-metadata `style` tokens that name spacing/width/layout (`pb-sm`, `u-p-4`, `separator-60`, `cols-8-4`, `after-boundary`), 25–62 distinct tokens per site, 4–8 section-metadata blocks per page, and 60–186 block+variant combinations per site. This is David's Model #1 ("section-metadata that influence layout should be limited by a design system"), #9 (few blocks, few variants), #14 (name/value only for configuration) and #15 (no CSS in content) failing at once, and every one of these trees passed `davids-model-lint` with 0 🔴 because the lint has no vocabulary-size or token-shape rule.  
Projects (13): semiconductor-vendor, health-insurer-a, health-insurer-b, beverage-brand, credit-bureau, regional-bank, entertainment-venues, cancer-center, energy-utility, us-airline, nordic-bank, eda-software-vendor, wine-retailer.  
Candidates: **T29.1** Budget the authoring vocabulary: named section styles ≤ 12, ≤ 2 variant tokens, no layout numbers (4.40, patch); **T29.2** `davids-model-lint` vocabulary census and token-shape rules (4.30, patch); **T29.3** Re-verify rule #120 and split it into "comma = N classes, space = one class" (4.00, patch); **T29.4** Rhythm engine reference: section-per-module, majority rhythm in CSS, adjacency classifiers (3.60, patch)

**T30 David's Model lints — new detectors for the content-structure gate** — `analysis/themes/T30-davids-model-lints.md`  
`davids-model-lint.mjs` (0.17.0, hardened through 0.19.5) blocks the DA write on eleven structural shapes, and in every project it exited 0 while the delivered trees carried classes of David's Model violations it does not look at: site-wide constant strings authored as rows on every page (#14, #1, #12), zero-row blocks and importer chrome leaks (content loss that no gate counted), `<table>`s and `\|`-joined lists inside cells (#2, #5, #15), raw JSON-LD rows (#15), icon tokens that 404 or double-prefix, variant tokens colliding with foundation utilities, content imagery index-mapped in block JS (#13/#1), plus two lint rules that fire falsely (`one-cta-per-p`, D1 on breadcrumbs). 24 findings …  
Projects (17): contact-lens-retailer, semiconductor-vendor, fintech-services, health-insurer-a, health-insurer-b, beverage-brand, credit-bureau, sports-car-maker, regional-bank, leisure-airline, pharma-manufacturer, entertainment-venues, cancer-center, tennis-club, nordic-bank, eda-software-vendor, pharmacy-retailer.  
Candidates: **T30.2** Content-loss detectors: zero-row block, chrome leak, table/serialised list in a cell, non-block wrapper (4.50, patch); **T30.3** Icon-token and variant-collision guards (4.45, patch); **T30.1** "Site-wide strings are never page rows": D-CONST detector and the template-shell tier (4.25, patch); **T30.4** Fix the lint rules that fire falsely (4.05, patch); **T30.5** Text-hygiene lints and one JSON-LD path (3.80, patch); **T30.6** Content imagery hard-coded in block JS is a 🔴 (JS-side detector) (3.80, patch)

**T31 D15 markup vehicles, fragments carrying content, and the link-form policy** — `analysis/themes/T31-d15-markup-vehicles-and-fragments.md`  
Encoders that must reproduce a live line box, a centred cell, a strike price or a footnote reach for whatever survives the DA/pipeline round-trip and repurpose it as a presentation vehicle: `<u>` as a centring marker (5,485 uses), `<p><code>&nbsp;</code></p>` spacers (529), zero-width-space paragraphs (926 pages), `:spacer:` icons, `<code>` strike prices, Unicode superscripts, `<br>` runs for wrap outcomes, spacer-only sections and breakpoint-duplicate rows. Each is David's Model #15 ("HTML/CSS in content") or #1/#14 in spirit, every one adds noise to served text and to the EW canvas, and none is caught by the D15 lint.  
Projects (11): contact-lens-retailer, health-insurer-a, beverage-brand, credit-bureau, sports-car-maker, regional-bank, media-network, energy-utility, us-airline, eda-software-vendor, wine-retailer.  
Candidates: **T31.1** Inline-vehicle contract: which tags round-trip, what each may mean, and the spacer remediation ladder (4.25, patch); **T31.4** Decide the link-form policy for rule #4 once, and lint mixed forms (4.20, patch); **T31.2** D15-VEHICLE lint rules (4.05, patch); **T31.3** Fragments: the D12 decision rule, the per-document ingestion limit, and content-bearing-fragment detection (3.80, patch)

**T32 Experience Workspace editability gate — wired into delivery, hardened, mechanised** — `analysis/themes/T32-ew-editability-gate-wired.md`  
The EW1–EW10 contract, the probe and `block-roundtrip --ew` (0.19.0) exist and are cited in deploy, replica, rollout and qa prose, but the gate is not a row in the per-page atomic delivery contract nor in rollout's Phase C gate list or `blocks.json` ledger — so a run that never invokes it ships green: 1,992 of 4,476 authored texts dead on 125 of 143 pages in one project, 27/27 blocks skipped in another. Three smaller residual classes recur: the harness cannot run blocks with module-scope imports, the static "value-slotting" review is a manual checklist item, and EW2 misses the wrapper-rhythm/variant-collision/asset-authorability rules. 5 findings, 5 projects; the largest cost a day of …  
Projects (5): fintech-redesign, entertainment-venues, energy-utility, it-software-vendor, nordic-bank.  
Candidates: **T32.1** Make the EW gate a row in the deploy atomic contract and the rollout ledger (4.30, minor); **T32.3** Static block-JS/CSS lint for the EW anti-patterns (mechanise checklist `:1080`) (4.30, patch); **T32.2** Probe and round-trip hardening: import stubs, item-level exemptions, strict listing, ledger JSON (4.10, patch); **T32.4** EW2 wrapper-rhythm, exact tracking, per-row asset authorability, composition-keyed CSS audit (3.95, patch)

**T33 AI-readability gate — enforced in every delivery, with honest semantics for excluded blocks** — `analysis/themes/T33-ai-readability-gate-enforced.md`  
0.21.0 shipped the exact checker reimplementation, the block rule "decorate() adds no words", document-first listings and the reference doc, and placed the gate in deploy's atomic delivery contract. The migrations then show the enforcement gap: two rollout waves and a 101-page site never ran it (the qa check graded "unmeasured" as *info*), replica's hand-off and rollout's Phase C/E/H do not name it, one run wrote its own probe and inlined chrome into 122 documents against the reference's own advice, and the gate's `code` score let vendor widgets be excluded while the customer's checker counted their words (16 % on calculator pages).  
Projects (9): beverage-brand, credit-bureau, regional-bank, media-network, leisure-airline, entertainment-venues, us-airline, nordic-bank, eda-software-vendor.  
Candidates: **T33.1** Wire the gate into replica hand-off, rollout Phase C/E/H and the qa severity (4.65, minor); **T33.3** Shipped-instrument-first rule; chrome inlining is an owner decision, never autonomous (4.60, patch); **T33.4** Document-first for programmatic families, forms and UI labels — enforce what 0.21.0 stated (4.00, patch); **T33.2** Excluded blocks must carry an authored fallback; unowned strict gaps fail (3.80, minor); **T33.5** `hydrate-listings.mjs`: a generator stage that writes and replaces marked rows (3.20, minor); **T33.6** Instrument hardening from the field (gate gotchas) (3.15, patch)

### G — Dynamics, block code, redesign, QA, i18n, impeccable

**T34 Dynamics executes, and ships its mechanisms as examples** — `analysis/themes/T34-dynamics-executes-and-examples.md`  
The `dynamics` sub-skill (0.20.0) made the dynamic surface visible and forced a disposition per row, but three gaps recur: (1) Phases 4–5 do not reliably *execute* — inventories close with `self` rows still `pending`, plan rows fall through, and a hands-off search interim shipped a 404; (2) the runtime mechanisms every migration re-writes (fetch shim, `Source`-row reader with authored fallback, definition-driven form renderer, sandbox link rewrite, HLS player) exist only as prose while the drafts had working code; (3) the query-index registration path on config-service sites (`content/query.yaml` + bulk index + read-back) was rediscovered by trial on four projects. Detection also misses …  
Projects (17): semiconductor-vendor, health-insurer-a, health-insurer-b, beverage-brand, dynamics-learnings, credit-bureau, media-network, leisure-airline, pharma-manufacturer, entertainment-venues, cancer-center, tennis-club, energy-utility, it-software-vendor, nordic-bank, eda-software-vendor, tennis-campus.  
Candidates: **T34.5** Query-index registration on config-service sites, with read-back (4.30, minor); **T34.7** Detection recall on every roster page and a recall eval (4.30, patch); **T34.1** Make dynamics Phase 4/5 a close-out condition, not a suggestion (4.25, minor); **T34.2** Ship the runtime mechanisms as fenced examples (≤ 80 lines each) (4.05, minor); **T34.3** Pattern catalogue additions and triage defaults (3.95, patch); **T34.6** Search parity replay and results-page verification (3.80, patch); **T34.4** Dynamics tooling: state snapshots, source-row applier, new check types, noise controls (3.65, minor)

**T35 Block JS and CSS rules for EDS delivery** — `analysis/themes/T35-block-js-and-css-rules.md`  
Generated block code fails in ways every gate certifies as correct: geometry cached in `decorate()` while the section is still hidden (dead carousel, −245 px), CSS that Chrome silently drops (`:where()` zero specificity, nested `:has()`, `-container` marker collisions, ID resets), variant tokens colliding with boilerplate utilities, chrome fragments double-decorated, images painted from the 750 px fallback rendition, and fallback fonts calibrated from `xAvgCharWidth` (CLS 0.39). Dimensions: pixel, reliability, speed-page (CLS/LCP), editability-EW.  
Projects (11): contact-lens-retailer, health-insurer-a, health-insurer-b, beverage-brand, sports-car-maker, regional-bank, media-network, cancer-center, it-software-vendor, nordic-bank, pharmacy-retailer.  
Candidates: **T35.1** Block JS runtime rules: never measure in `decorate()`, `loadCSS` builder deps, icon and fragment ordering (4.85, patch); **T35.2** CSS selector and class-hygiene lint for blocks and foundation (4.30, minor); **T35.3** Image rendition and CLS guards as instruments, not rules (4.10, minor); **T35.4** Fonts: measured-width `size-adjust`, verified harvest, exact-case paths (3.45, minor); **T35.5** Foundation scope rules: `border-box` per region, boundary margins, button alignment, helpers (3.35, patch)

**T36 Redesign-flow gaps (brand docs, restyle-in-place, prototype↔deployed reconcile, divergent concepts)** — `analysis/themes/T36-redesign-flow-gaps.md`  
Three redesign runs on existing sites had to improvise outside the plugin: a brand-guideline document set as the design input (no `direct` input exists), a restyle of an already-customised EDS repo (deploy targets vanilla boilerplate only), redesign demos on a replica repo that inherited the replica's foundation CSS and bypassed migrate/rollout, and a redesign whose hands-off direction converged on "the same suggestions" until the user authored divergent concepts himself. Dimensions: independence (the user did the missing step), pixel (deployed page diverged from the approved prototype with no gate), editability-EW, speed-flow/cost.  
Projects (4): fintech-redesign, cancer-center, nordic-bank, wine-retailer.  
Candidates: **T36.3** Redesign delivery on a replica repo: template scoping, branch-demo mode, box-compare gate (3.60, minor); **T36.1** `direct --brand-docs <dir>`: brand guideline documents as a first-class design input, plus a content-compliance ledger (3.45, minor); **T36.2** `deploy --restyle`: restyle an existing customised EDS repo in place (3.30, minor); **T36.4** Divergent concepts from measured references; mechanical sameness and fold checks (3.25, minor); **T36.6** Image sourcing ladder and "no foreign fixed art on reusable variants" (3.05, patch); **T36.5** Promote an out-of-pipeline prototype and generate/parity-check the canon → EDS foundation (2.80, minor)

**T37 QA runner at fleet scale (429 as infra state, baselines, finding semantics)** — `analysis/themes/T37-qa-runner-fleet-scale.md`  
On fleets of 100+ pages the `qa` runner rate-limits itself on `aem.live` (HTTP 429 at ~3 concurrent headless crawlers) and reports the throttled pages as hundreds of defects (`page-not-200`, `og-image-broken`, `redirect-not-firing`, `unknown-block`), invalidating whole sweeps; visual baselines are created on that first defective run; and several checks fire on platform facts rather than defects (`x-robots-tag: noindex` on every `.aem.live` host, `TODO` matching Spanish "todo", a sanctioned no-`h1` template, percent-encoded fragments). Dimension: reliability (false findings), independence (hand allow-listing), speed-flow (discarded passes).  
Projects (6): contact-lens-retailer, health-insurer-b, credit-bureau, media-network, tennis-club, pharmacy-retailer.  
Candidates: **T37.1** 429/503 as infrastructure state: back-off, shared budget, `unmeasured`, `infra-degraded` verdict (4.10, patch); **T37.2** Baseline discipline and fleet presets (3.80, patch); **T37.3** Finding semantics: platform facts, language, encoded fragments, sanctioned no-h1 (3.60, patch)

**T38 Multilingual trees and multi-site delivery** — `analysis/themes/T38-multilingual-and-multisite.md`  
Locale twins and second origins were delivered by improvisation on five projects: `<html lang>`/hreflang hooks patched by hand into `scripts.js`, generated chrome left in English on German pages, a locale supplement that overwrote the English chrome capture, twins that 301'd relaunching the crawl four times, the locale folder structure decided implicitly ("German at root") and questioned later, and a second origin run as a nested stardust tree with body-class chrome dispatch. `rollout/reference/multilingual.md` (39 lines) and `dynamics/reference/locale-trees.md` describe the target in prose but ship no hook, no manifest schema and no wave procedure.  
Projects (5): health-insurer-b, sports-car-maker, pharma-manufacturer, energy-utility, nordic-bank.  
Candidates: **T38.3** Crawl hardening for locale twins: consent labels, redirected twins, context-destroyed retry (3.80, patch); **T38.1** Locale-tree wave procedure with the hooks it needs (3.70, minor); **T38.2** Locale folder structure in the prep decision batch (3.55, patch); **T38.5** Captured chrome link classes: templates, per-page alternates, resource paths (3.30, patch); **T38.4** Multi-site / second-origin delivery mode (3.25, minor)

**T39 Impeccable integration friction in replica-class runs** — `analysis/themes/T39-impeccable-hooks-in-replica.md`  
Impeccable's design hook fires on every `Write`/`Edit` (`hooks/hooks.json`) and flags lifted values in keep-design runs — captured colours, measured sizes, source fonts, verbatim marketing copy — so replica sessions spend turns suppressing findings one `ignore-value` call at a time (≥ 14 on one project, 9 on another) and end each triage with "suppressed, nothing fixed". Around it: `detect` runs DEGRADED without parser deps and reports "clean" (4 vs 55 findings), the Write hook stripped `@font-face` from a `fonts.css`, Setup runs the impeccable check for sub-skills that never invoke impeccable, and cross-plugin file names drift because the dependency is unpinned by design.  
Projects (11): fintech-services, health-insurer-b, media-network, fintech-redesign, leisure-airline, entertainment-venues, cancer-center, us-airline, eda-software-vendor, pharmacy-retailer, wine-retailer.  
Candidates: **T39.1** Replica/reskin install a scoped impeccable ignore set once, at Setup (4.20, patch); **T39.4** Detect DEGRADED is a gate failure; `@font-face` never through the Write hook (3.95, patch); **T39.2** Per-skill impeccable dependency level (3.85, patch); **T39.3** Cross-plugin path probe and drift list (no pin) (3.65, patch); **T39.5** External tools are optional: refero probe-once, no Turnstile trigger words (2.90, patch)

## 6. Decisions only you can make

The consolidation surfaced points where projects disagreed or where a change would alter a shared gate's semantics. Each is written up with a recommendation in the theme file; none is assumed in the ranking.

| # | decision | where | recommendation in the theme file |
|---|---|---|---|
| D1 | Gate on **preview** and publish only on pass (publish stops being the default in deploy/rollout) — the query-index rationale for "publish in the loop" | T15.1 | gate on preview, publish on pass; index build already follows Phase C |
| D2 | Pass-bar for long pages: keep absolute \|Δh\| ≤ 8 px or add a relative rule; tablet structural pass and ≥ 1920 canvas assertion | T17.4 | relative rule only in the published-origin regime, after one rollout |
| D3 | Consent reference state for captures: `accept` (crawl/dismissOverlays today) vs `deny` (playwright-recipe) | T19.3 | `accept` default, `deny` per project, recorded in provenance |
| D4 | Crawl `deviceScaleFactor` 1 vs 2 | T19.4 | keep 1 for gate symmetry, record it; `--dpr 2` for icon harvest only |
| D5 | Deploy's "no motion library / no reveal-on-scroll" vs replica's observed-motion port | T20.3 | keep the redesign-flow ban, add a replica-flow carve-out |
| D6 | Slug algorithm: code (`-`/`index`/hash) vs reference (`__`/`home`/`-2`) | T23.3 | doc follows code + 200-char cap (changing code re-keys every project) |
| D7 | Rule #120 (multi-value section `style`): 140 live comma-separated sections contradict it | T29.3 / T21.2 | fixture-verify, then "comma = N classes, space = one class" + lint |
| D8 | Zero-width-space / `<code>&nbsp;` spacers: allow as ledgered residual or forbid | T21.2 / T31.1 | keep #112 CSS default (David #15), ZWSP only as ledgered residual + 🟡 lint |
| D9 | Rule #4 link form: root-relative canonical (plugin today) vs fully-qualified literal | T31.4 / T27.8 | root-relative canonical, three link classes in D4, lint mixed forms |
| D10 | JSON-LD: raw `json-ld` metadata row vs runtime composition from metadata rows | T30.5 | runtime composition; lint 🔴 raw JSON row |
| D11 | AI-readability gate: `code ≥ 98` (excludes vendor widgets) vs `strict` (the customer's checker) | T33.2 | keep `code` as block bar; require an owned decision for every exclusion |
| D12 | Content inventory: rendered-only default vs "DOM parity" mandated by recreation-procedure | T16.4 | rendered-only for the fidelity verdict, `--include-hidden` for DOM parity, under B8's protocol |
| D13 | Query index on config-service sites: admin API (200 in two projects, 403 in one) vs repo `helix-query.yaml` | T34.5 | try config service with DA token, fall back loudly to repo yaml |
| D14 | Figma donor: land PR adobe/skills#315 as a separate skill or as a reskin adapter (deferred item B15, open 20 days) | T25.5 | separate skill + routing |
| D15 | Re-propose deferred items with new evidence: DOM-mirror generator as reserve path (B17), `motion-assert` (B30), element-boundary separator (B8), D4 LOCALIZE 🟡→🔴 (B7 trigger met) | T26.7, T20.2, T16.4, T27.6 | all four flagged as re-proposals; your call |
| D16 | Hands-off publish default: preview-only with explicit publish, vs publish by default | T08.3 | preview-only in hands-off |
| D17 | `border-box` reset: global (#106) vs per-region mirroring of the source sizing model | T35.5 | mirror the source per region, global default kept |

## 7. Proposed PR plan

One PR per candidate, grouped in waves ordered by risk and dependency; every wave ends with a version bump (patch after W1/W2, minor after W3/W4 — new gates and script surfaces). Within a wave, land the highest composite first. Dependencies named in the theme files are listed in the "after" column; land those first.

Ordering rationale: W1 changes only always-on prose and reference docs, so it can ship immediately and already removes the largest cost and independence leaks (wait discipline, agent-type rule, credentials step, turn-ending contract, routing hand-off). W2 hardens existing instruments without changing verdict semantics. W3 adds the missing gates and scripts (published gate, content acceptance, token check, code-sync verify, chrome archetype). W4 is the larger builds (deploy/SKILL.md split, crawl schema, importer skeleton, wave driver, sub-flows) and anything with Risk ≥ 4.

### Wave 1 — doc rules and cards (patch, doc-only, low risk) — 65 PRs

| order | id | PR | comp. | bump | after |
|---:|---|---|---:|---|---|
| 1 | T01.1 | Wait discipline: never block the conversation past the cache TTL | 5.00 | patch |  |
| 2 | T11.2 | `direct` zero-movement → hand off to `replica`; keep-design phrases auto-select replica; named-deviation journal rule | 5.00 | patch |  |
| 3 | T04.2 | Liveness and auto-resume contract for delegated agents | 4.85 | patch |  |
| 4 | T09.2 | Master Setup step 7: credentials preflight, `SITE_TOKEN_<SITE>` discovery, planning against the token window | 4.85 | patch | T09.1 first (the step calls it) |
| 5 | T35.1 | Block JS runtime rules: never measure in `decorate()`, `loadCSS` builder deps, icon and fragment ordering | 4.85 | patch |  |
| 6 | T10.1 | Turn-ending contract: never stop to report; chain waves; state the commit policy and the stop point | 4.80 | patch | T10.2 (the register defines what is owner-only) |
| 7 | T04.1 | Agent-type rule: fresh-context workers by default, forks only for short conversational tasks | 4.60 | patch |  |
| 8 | T05.1 | Cap semantics and composition-regime rules (doc) | 4.60 | patch |  |
| 9 | T07.2 | Harness-quirks card | 4.60 | patch |  |
| 10 | T10.3 | Phase checkpoints with the next command, and a resume rule that never re-runs finished steps | 4.60 | patch | T13.1 renders the field; T09.4 writes it on halts |
| 11 | T33.3 | Shipped-instrument-first rule; chrome inlining is an owner decision, never autonomous | 4.60 | patch |  |
| 12 | T02.3 | Runner output contract and long-session hand-off | 4.45 | patch | T01.1 (same bullet family); T13 (progress surface / hand-off bundle) f |
| 13 | T08.1 | Privileged-transport preflight in the first minutes, with a "blocked-on-owner" surface | 4.45 | patch | T09 (credential validity) should be the sibling step; T10 (plan-time d |
| 14 | T11.3 | First gate asks keep-vs-redesign; planning aids named per flow; resume enters through the master skill and each phase through its Skill; routing eval | 4.45 | patch | T13.1 for the enriched state report; T11.1 for the `flow` key the eval |
| 15 | T17.1 | Name the residual classes and make the gate report carry regime, masks, unmasked number and reference date | 4.45 | patch |  |
| 16 | T21.3 | ENCODE contract additions + davids-model-lint rules for pipeline-sensitive shapes | 4.45 | patch | T21.2 (the reference the bullets point at); can ship first as bullets |
| 17 | T30.3 | Icon-token and variant-collision guards | 4.45 | patch | shares `--styles` plumbing with T29.2 |
| 18 | T06.2 | Site-scale fix loop: template sample → class triage → one confirmation sweep | 4.40 | patch | T06.1 (changed-only re-drive), T06.4 (mapped re-gate list), T06.3 opti |
| 19 | T02.1 | Image budget: read crops and sheets, never the stitched page | 4.40 | patch |  |
| 20 | T29.1 | Budget the authoring vocabulary: named section styles ≤ 12, ≤ 2 variant tokens, no layout numbers | 4.40 | patch |  |
| 21 | T10.2 | Decision register `stardust/decisions.md` and a plan-time decision batch with derivable defaults | 4.25 | patch |  |
| 22 | T14.2 | Escalation ladder: headless real Chrome before any window, windows off-screen and opt-in | 4.25 | patch |  |
| 23 | T19.3 | Capture provenance sidecar and consent as one instrument parameter | 4.25 | patch | land before or with T17.2, T17.3, T19.1 (they extend the sidecar). |
| 24 | T31.1 | Inline-vehicle contract: which tags round-trip, what each may mean, and the spacer remediation ladder | 4.25 | patch | T29.1 (budget for the "named style" rung), T29.4 (adjacency technique) |
| 25 | T34.1 | Make dynamics Phase 4/5 a close-out condition, not a suggestion | 4.25 | minor |  |
| 26 | T04.4 | Ownership, registries and merge protocol for parallel writers | 4.20 | patch |  |
| 27 | T08.2 | Harness-permissions card with the plugin's command shapes and a pre-approval snippet | 4.20 | patch |  |
| 28 | T26.2 | Write the importer rules reference (numbered, site-agnostic) | 4.20 | patch |  |
| 29 | T39.1 | Replica/reskin install a scoped impeccable ignore set once, at Setup | 4.20 | patch |  |
| 30 | T07.4 | `served-check` helper and the `--compressed` rule where agents read it | 4.20 | patch |  |
| 31 | T08.4 | Credential hygiene in commands and interactive auth hand-off | 4.20 | patch | T09 (env lookup) — land together or T09 first. |
| 32 | T09.4 | Park / stage / resume contract for token-bound work | 4.20 | patch | T09.3 (the halt writes the file); T13.1 reads it |
| 33 | T31.4 | Decide the link-form policy for rule #4 once, and lint mixed forms | 4.20 | patch |  |
| 34 | T13.3 | Hand-off report template: gate table first, one reporting KPI, provenance, before/after evidence | 4.05 | patch |  |
| 35 | T21.4 | Bulk delivery drivers are node scripts that prove the write landed | 4.05 | patch |  |
| 36 | T23.3 | Slug, flags and log: make `crawl.mjs` and `ia-extraction.md` agree | 4.05 | patch |  |
| 37 | T26.5 | Generated content is never hand-edited: patch files and out-of-tree generated artifacts | 4.05 | patch |  |
| 38 | T33.4 | Document-first for programmatic families, forms and UI labels — enforce what 0.21.0 stated | 4.00 | patch | T30.1 (placeholders), T30.2 (D1-EMPTY) |
| 39 | T29.3 | Re-verify rule #120 and split it into "comma = N classes, space = one class" | 4.00 | patch |  |
| 40 | T34.3 | Pattern catalogue additions and triage defaults | 3.95 | patch | T34.2 for (1)/(2) example code if wanted |
| 41 | T32.4 | EW2 wrapper-rhythm, exact tracking, per-row asset authorability, composition-keyed CSS audit | 3.95 | patch |  |
| 42 | T39.4 | Detect DEGRADED is a gate failure; `@font-face` never through the Write hook | 3.95 | patch |  |
| 43 | T39.2 | Per-skill impeccable dependency level | 3.85 | patch |  |
| 44 | T04.5 | Run lock and multi-session write safety | 3.80 | patch |  |
| 45 | T14.7 | Capture provenance: technique, date, variant markers — and dated references in the gate | 3.80 | patch | T14.1 (state pin) makes the variant record actionable |
| 46 | T22.2 | Ordering rules: code first, then content, then gate on the ref the user will look at; compatibility window for shape refactors | 3.80 | patch | T22.1 (the verify step it sequences) |
| 47 | T27.9 | Redirects, folder indexes, sheets, listing order, `og:image` and JSON-LD delivery — the small delivery rules | 3.80 | patch |  |
| 48 | T28.5 | Replica sibling-tier rules: module-kind × breakpoint lift ledger, sequence-driven generators, per-theme bindings | 3.80 | patch |  |
| 49 | T30.5 | Text-hygiene lints and one JSON-LD path | 3.80 | patch |  |
| 50 | T30.6 | Content imagery hard-coded in block JS is a 🔴 (JS-side detector) | 3.80 | patch | T32.3 (the static block-JS lint surface) |
| 51 | T31.3 | Fragments: the D12 decision rule, the per-document ingestion limit, and content-bearing-fragment detection | 3.80 | patch |  |
| 52 | T34.6 | Search parity replay and results-page verification | 3.80 | patch | T34.5 (index must be readable) |
| 53 | T37.2 | Baseline discipline and fleet presets | 3.80 | patch | T37.1 (clean-run flag) |
| 54 | T38.3 | Crawl hardening for locale twins: consent labels, redirected twins, context-destroyed retry | 3.80 | patch | overlaps T19 (capture hardening) and T23 (crawl contract) — land once, |
| 55 | T08.3 | One sanctioned path for privileged actions | 3.75 | patch | T06.1 (`deploy-batch` ledger fixes) makes the driver trustworthy enoug |
| 56 | T37.3 | Finding semantics: platform facts, language, encoded fragments, sanctioned no-h1 | 3.60 | patch |  |
| 57 | T04.6 | Parallel-worktree recipe | 3.55 | patch | T04.4 (ownership + registries), T07.1 (preflight per worktree), T06.4  |
| 58 | T20.4 | Media playability proof: HLS pattern, ranged-GET media probe, `video-plays` asserts playback | 3.55 | patch |  |
| 59 | T38.2 | Locale folder structure in the prep decision batch | 3.55 | patch |  |
| 60 | T35.5 | Foundation scope rules: `border-box` per region, boundary margins, button alignment, helpers | 3.35 | patch |  |
| 61 | T27.10 | Code-tier asset validation: fonts, icon glyphs, favicon reachability | 3.35 | patch |  |
| 62 | T38.5 | Captured chrome link classes: templates, per-page alternates, resource paths | 3.30 | patch |  |
| 63 | T33.6 | Instrument hardening from the field (gate gotchas) | 3.15 | patch |  |
| 64 | T36.6 | Image sourcing ladder and "no foreign fixed art on reusable variants" | 3.05 | patch |  |
| 65 | T39.5 | External tools are optional: refero probe-once, no Turnstile trigger words | 2.90 | patch |  |

### Wave 2 — instrument and lint hardening (patch) — 47 PRs

| order | id | PR | comp. | bump | after |
|---:|---|---|---:|---|---|
| 1 | T14.1 | Reuse the admitted session: storageState clone + `--storage-state` in every live instrument | 4.70 | patch |  |
| 2 | T06.1 | `deploy-batch` ledger: content hash, merge semantics, path normalisation | 4.65 | patch |  |
| 3 | T16.2 | Zero-row blocks and empty module sections are red | 4.60 | patch |  |
| 4 | T21.1 | Make the local harness apply the pipeline's transforms (one shared `pipelineMimic`) | 4.50 | patch | T21.2 first (the fact list is the spec for the mimic); the fixture dou |
| 5 | T30.2 | Content-loss detectors: zero-row block, chrome leak, table/serialised list in a cell, non-block wrapper | 4.50 | patch |  |
| 6 | T15.3 | Residual discipline: named classes only, over-bar is FAIL, mobile never skipped, honest reports | 4.45 | patch |  |
| 7 | T19.1 | `stitch-shot.mjs`: pinned chrome per chunk, integer scroll, decode/visibility/short-capture guards, tail and exclude | 4.30 | patch | T19.3 (sidecar) to persist `pinnedHidden[]`, `pendingDecodes`, `tail`; |
| 8 | T19.2 | `live-session.mjs` `dismissOverlays`: visible-match, text fallback, late mount, frames, shadow roots, persistent widgets, fail-loud | 4.30 | patch |  |
| 9 | T01.2 | Completion contract for batch drivers: progress file + one summary line, run in background | 4.30 | patch | T01.1 first (the rule), then this; T04 (fan-out protocol) reuses the s |
| 10 | T02.2 | `review-image.mjs`: contact sheets and stacked band strips from the gate outputs | 4.30 | patch | ship with or right after T02.1; T05 (numeric-first iteration) and T15/ |
| 11 | T03.2 | Operator card + section index at the top of every SKILL.md; "read § X at step Y" TOCs on references > 20 KB | 4.30 | patch | T03.1 first for deploy (its card describes the split); other skills ca |
| 12 | T05.3 | Landmark Δy table as the first diagnostic of every round | 4.30 | patch |  |
| 13 | T29.2 | `davids-model-lint` vocabulary census and token-shape rules | 4.30 | patch | T29.1 (the numbers it enforces) |
| 14 | T32.3 | Static block-JS/CSS lint for the EW anti-patterns (mechanise checklist `:1080`) | 4.30 | patch |  |
| 15 | T34.7 | Detection recall on every roster page and a recall eval | 4.30 | patch |  |
| 16 | T30.1 | "Site-wide strings are never page rows": D-CONST detector and the template-shell tier | 4.25 | patch | T29.2 (same tree-aggregation pass) — land together or T29.2 first |
| 17 | T09.3 | `deploy-batch.mjs`: preflight, halt on auth failure, sentinel for site-level 401/404 | 4.25 | patch | T09.1 |
| 18 | T20.1 | `motion-observe.mjs`: observe style, aria, hidden and childList mutations; entrance families; hover probe hardening | 4.25 | patch |  |
| 19 | T12.4 | Time-to-first-URL: publish a preview before pixel iteration | 4.20 | patch | T12.1 (an origin must exist) |
| 20 | T14.4 | Per-host live budget: pacing, one-live-tool lock, 429 handling | 4.10 | patch |  |
| 21 | T17.2 | `gate.sh`: reference freshness and live self-variance before the first round | 4.10 | patch | T19.3 (sidecar format) first or bundled; T17.1 for the `live-drift` cl |
| 22 | T18.4 | Deploy Step 6 / rollout: chrome delivery contract — states, variants, guard set | 4.10 | patch | T18.3 (`--open`) for the deployed open-state gate; T18.1 for the varia |
| 23 | T19.4 | `crawl.mjs` captures: 360 shot, long-page clipping, quirks mode, DPR decision, vision-gate recapture, brand-surface exclusions | 4.10 | patch | T19.2's shared label set for crawl's `dismissConsent`; independent oth |
| 24 | T24.1 | Implement the documented discovery in `discover()`: robots sitemaps, full index recursion, subtree scoping, BFS `--depth`, `--cookie` | 4.10 | patch | T23.3 (log `runs[]`, flag conventions) first so the new `discovery` bl |
| 25 | T27.2 | Harden `deploy-batch.mjs`: content hash, merge-safe ledger, re-preview on `about:error`, size guard, `--paths` file/list, `--report`, `update-coverage --from-ledger` | 4.10 | patch |  |
| 26 | T32.2 | Probe and round-trip hardening: import stubs, item-level exemptions, strict listing, ledger JSON | 4.10 | patch |  |
| 27 | T37.1 | 429/503 as infrastructure state: back-off, shared budget, `unmeasured`, `infra-degraded` verdict | 4.10 | patch |  |
| 28 | T14.3 | Challenge classifier + interactive human-solve mode + capture sanity | 4.05 | patch | T14.2 (tier 3 launch) and T14.1 (state save) should land first or toge |
| 29 | T01.3 | `wait-for-origin.mjs`: a capped propagation waiter replacing sleep-then-regate | 4.05 | patch |  |
| 30 | T03.3 | Doc-size lint in `npm run lint:stardust` | 4.05 | patch | after T03.1 (or ship with the allowlist); pairs with T03.2's card head |
| 31 | T18.3 | `chrome-parity.mjs`: scroll state, open state, list-style, stacking and alignment checks | 4.05 | patch |  |
| 32 | T30.4 | Fix the lint rules that fire falsely | 4.05 | patch |  |
| 33 | T31.2 | D15-VEHICLE lint rules | 4.05 | patch | T31.1 (defines the rules it enforces); shares the tree pass with T29.2 |
| 34 | T26.4 | One shared `hiddenLive()` visibility test for importer and gates (additive, opt-in on the diff side) | 4.00 | patch | before T26.1 |
| 35 | T14.5 | `--block <substr,...>` route-abort in the shared live session | 3.95 | patch |  |
| 36 | T05.4 | pixel-compare emits offsets and crop stacks so PNGs are rarely opened | 3.90 | patch |  |
| 37 | T16.3 | content-diff hardening: offline source side, per-side roots, href normalisation, register awareness, shadow roots | 3.85 | patch | T16.1 shares the capture-JSON reader; land the reader once |
| 38 | T15.4 | `gate.sh` counts iterations and enforces the cap | 3.85 | patch |  |
| 39 | T27.7 | Fix the rollout ledger scripts: typed rows for chrome/fragments/sheets, `content-pending` guard, host normalisation, pending-vs-failed link targets | 3.85 | patch |  |
| 40 | T17.3 | Masks from selectors, images, iframes and the dynamics inventory | 3.65 | patch | T19.3 (sidecar) for rect storage; T17.1 for reporting fields. Independ |
| 41 | T25.2 | `block-parity.mjs`: per-block computed-style parity with base-CSS survivor attribution | 3.65 | patch |  |
| 42 | T39.3 | Cross-plugin path probe and drift list (no pin) | 3.65 | patch |  |
| 43 | T29.4 | Rhythm engine reference: section-per-module, majority rhythm in CSS, adjacency classifiers | 3.60 | patch | T29.1 (the budget it serves) |
| 44 | T06.3 | Live-variance grading in the stitched-capture instruments | 3.45 | patch | coordinate with T17; T19 (capture hardening) may share the `--twice` f |
| 45 | T10.4 | Self-proposed next wave from the link graph | 3.45 | patch | T10.1 (chaining), T13.2 (wave-close checklist prints it) |
| 46 | T14.6 | Record-once/replay for bot-managed vendor scripts (`--har`) and the empty-vs-empty rule | 3.40 | patch | T14.2 (off-screen tier-3 launch) |
| 47 | T07.6 | Measurement contexts bypass CSP and fail loud on injection | 3.30 | patch |  |

### Wave 3 — new gates and scripts (minor) — 48 PRs

| order | id | PR | comp. | bump | after |
|---:|---|---|---:|---|---|
| 1 | T09.1 | Ship `da-token-check.mjs` (resolve, decode, smoke, remaining hours) | 4.85 | minor |  |
| 2 | T22.1 | `code-sync-verify.mjs`: sync, purge, and prove the served code is HEAD before any capture | 4.70 | minor |  |
| 3 | T11.1 | Flow selection recorded in state; sub-skill entry guards refuse a migration with no flow chosen | 4.65 | minor |  |
| 4 | T27.3 | Pre-PUT path sanitisation with the real EDS rule, exported as `normalizeDaPath()`, wired into the driver | 4.65 | minor | before T27.1/T27.6 |
| 5 | T33.1 | Wire the gate into replica hand-off, rollout Phase C/E/H and the qa severity | 4.65 | minor |  |
| 6 | T07.1 | One Setup preflight: dependencies, probes dir, environment record | 4.50 | minor |  |
| 7 | T16.1 | Ship `content-acceptance.mjs`: the offline source-vs-imported role inventory gate | 4.50 | minor |  |
| 8 | T18.1 | Chrome archetype: inventory chrome states and variants before fan-out, gate each once | 4.50 | minor | T18.2 provides the probe evidence; can ship first with the manual `mot |
| 9 | T15.2 | Every delivered page gets a number: coverage regime and sibling sampling | 4.30 | minor | T15.1 |
| 10 | T20.2 | `motion-assert.mjs` behaviour-match + `click-control` check in `dynamics-check` and `qa-gate` | 4.30 | minor | T20.1 (`stateMachines[]`, `entrances[]`) for assertions (c)/(a); can s |
| 11 | T32.1 | Make the EW gate a row in the deploy atomic contract and the rollout ledger | 4.30 | minor | T32.2 (a) first, or ship with the URL-mode fallback stated |
| 12 | T13.1 | `stardust status`: a deterministic, read-only progress surface (script) + tracking-issue convention | 4.30 | minor | T10.3 (`next` field); T09.2 (token for bulk-status); T10.2 (decision r |
| 13 | T23.2 | Media and font harvest (`--assets`, default on for `--prep`/replica) | 4.30 | minor | independent of T23.1 (touches `capturePage`/`main`, not `capture()`) |
| 14 | T34.5 | Query-index registration on config-service sites, with read-back | 4.30 | minor |  |
| 15 | T35.2 | CSS selector and class-hygiene lint for blocks and foundation | 4.30 | minor |  |
| 16 | T05.2 | Mechanical iteration counter in `gate.sh` | 4.25 | minor | T05.1 gives the reasons `--over-cap` accepts. |
| 17 | T15.5 | `gate-ledger-lint.mjs` before rollout Phase C | 4.25 | minor | T15.3 (ledger schema), T15.1 (published field) |
| 18 | T26.3 | Make "flatten to prose" and unmapped modules a hard import failure; widen content-count classes | 4.20 | minor | T26.1 (report shape) or, standalone, the acceptance doc + the `_meta.j |
| 19 | T12.1 | `deploy/reference/site-bootstrap.md` + a Setup hook that provisions repo, Code Sync, config and DA seed before the first deploy | 4.10 | minor | T09.1/T09.2 (`GH_PAT`, `DA_TOKEN` probes); T10.2 for the slug default |
| 20 | T12.2 | Lockdown step: private repo + site auth, default on for customer-domain migrations | 4.10 | minor | T09.2 (`SITE_TOKEN_<SLUG>` discovery), T09.3 (batch driver honours the |
| 21 | T13.2 | Wave-close checklist in rollout Phase H, enforced, with `open-review-pairs.mjs` | 4.10 | minor | T13.1 (recap), T10.4 (next wave), T13.3 (report shape) |
| 22 | T21.2 | Stored pipeline-facts contract: `reference/pipeline-facts.md` + `pipeline-probe.mjs` + `runtime-contract.json#pipeline` | 4.10 | minor |  |
| 23 | T26.6 | Ship the prototype→content transcriber and the thin-tier converter in deploy | 4.10 | minor | independent of T26.1 (different input: prototype vs live capture) |
| 24 | T27.5 | Ship `deploy/scripts/rehost-media.mjs` with a media ledger as the default ENCODE behaviour for external imagery | 4.10 | minor |  |
| 25 | T27.6 | Ship `deploy/scripts/deploy-page.mjs` — the per-page chain — and make `localize-links --check` a hard gate (promote D4 LOCALIZE to 🔴) | 4.10 | minor | T27.2, T27.3, T27.4, T27.5 first |
| 26 | T35.3 | Image rendition and CLS guards as instruments, not rules | 4.10 | minor |  |
| 27 | T23.5 | `replica/scripts/lift.mjs` — the per-breakpoint computed-style lift, plus recreation one-liners | 4.05 | minor |  |
| 28 | T24.2 | Classify every roster URL: page / redirect / off-origin / gated / dead / app-shell, with a per-URL platform | 4.05 | minor | T24.1 (list to classify); feeds T25.1 (`sourcePlatform: eds` fast path |
| 29 | T28.2 | Variant census before styling a block, with descendant-class coverage per component | 4.05 | minor | after T28.1 (cluster scoping) but usable standalone |
| 30 | T34.2 | Ship the runtime mechanisms as fenced examples (≤ 80 lines each) | 4.05 | minor |  |
| 31 | T22.3 | Syntax and lint gate before any code push | 4.05 | minor |  |
| 32 | T28.4 | Rollout Phase B/C rules: interactive or multi-column `generic` sections need a block; a template's blocks are not verified before its own archetype passes; encoder-vs-generic count check | 4.00 | minor | T28.1 optional (signature source) |
| 33 | T04.3 | Concurrency budget and machine-wide browser semaphore | 3.85 | minor | T04.2 first (so waiting on a slot is reported through the progress fil |
| 34 | T07.3 | Port allocator and server identity for every localhost URL a gate consumes | 3.85 | minor | T07.1 (writes `env.json`, where `ports.json` lives); T04.3 (reaper sco |
| 35 | T27.4 | Media pre-flight stage: SVG scan/rasterise, size and count caps, liveness HEAD with browser UA | 3.85 | minor | pairs with T27.5 (rehost target); before T27.6 |
| 36 | T27.8 | Link completeness: alias map, inverse pass, dead-same-origin qa check, and the one link-policy decision written down | 3.85 | minor | after T27.3 (shared path normaliser) |
| 37 | T24.3 | Roster extension from dynamic evidence, parameterised states, link audit and freshness | 3.80 | minor | T24.2 (roster artifact to extend); (a) needs the `--dynamics` recorder |
| 38 | T28.3 | Site-fingerprint gate before fleet fan-out (design similarity decides canon groups) | 3.80 | minor | coordinate with T38 (fleet manifest shape) |
| 39 | T33.2 | Excluded blocks must carry an authored fallback; unowned strict gaps fail | 3.80 | minor | T33.1 (so the report line reaches rollout) |
| 40 | T13.4 | Optional usage ledger per phase/wave (`token-ledger.mjs`) | 3.80 | minor |  |
| 41 | T12.3 | `deploy/reference/project-move.md`: relocate/rename an EDS project to another org/site | 3.65 | minor | T12.1, T12.2 |
| 42 | T34.4 | Dynamics tooling: state snapshots, source-row applier, new check types, noise controls | 3.65 | minor |  |
| 43 | T36.3 | Redesign delivery on a replica repo: template scoping, branch-demo mode, box-compare gate | 3.60 | minor |  |
| 44 | T11.4 | Fan-out / publish precondition: a gated archetype must exist before siblings ship | 3.60 | minor | T11.1 (`flow` tells the Setup the check applies) |
| 45 | T35.4 | Fonts: measured-width `size-adjust`, verified harvest, exact-case paths | 3.45 | minor |  |
| 46 | T15.6 | Redesign flow: the approved prototype is the reference, same bar, not "advisory" | 3.40 | minor | T15.1 |
| 47 | T33.5 | `hydrate-listings.mjs`: a generator stage that writes and replaces marked rows | 3.20 | minor | T33.4 (contract); T33.1 (the gate that verifies it) |
| 48 | T26.8 | Deploy-side importer guards: runtime auto-block contract and the in-page anchor regime | 3.20 | minor |  |

### Wave 4 — sub-flows and large builds (minor, higher effort or risk) — 24 PRs

| order | id | PR | comp. | bump | after |
|---:|---|---|---:|---|---|
| 1 | T03.1 | Split deploy/SKILL.md into a ≤ 40 KB core plus step-scoped reference chapters | 4.35 | patch | land before T03.3 (the lint would fail on the current file); T03.2's o |
| 2 | T18.2 | `chrome-states.mjs`: enumerate triggers, open every state, emit crops, computed styles and a nav document model | 4.35 | minor | T20.1 (widened observer) shares the trigger enumeration; T18.1 consume |
| 3 | T23.1 | Emit the documented per-page schema from `capture()` | 4.35 | minor |  |
| 4 | T28.1 | Cluster the corpus by rendered layout signature and gate one exemplar per cluster | 4.10 | minor |  |
| 5 | T15.1 | Ship `gate-publish.mjs`: the published-origin gate as a script and as the release condition | 3.95 | minor | T14.1/T14.7 (dated reference, session reuse) help but are not required |
| 6 | T06.4 | Change detection upstream of deploy: re-gate list, importer coverage index, patch file | 3.90 | minor | T06.1 first; T26 (importer skeleton) should host the coverage index an |
| 7 | T23.4 | Ship extract Phases 3–6 as scripts (`brand-surface.mjs`, `brand-review.mjs`, `state-update.mjs`) | 3.80 | minor | T23.1 (input shape), T23.2 (fonts), T23.5 (computed samples) |
| 8 | T26.1 | Ship a DOM-based importer skeleton driven by a vocabulary map | 3.75 | minor | T26.2 (rules the skeleton encodes), T26.4 (visibility classifier it im |
| 9 | T27.1 | Ship a resumable wave driver in rollout (stage classes, per-page state, park/unpark, hash re-gate) | 3.75 | minor | T27.2 (hash ledger), T27.3 (pre-PUT stage), T27.6 (per-page chain it c |
| 10 | T07.5 | Plugin scripts resolve dependencies and sibling skills from a fallback chain | 3.75 | minor | T07.1 first; coordinate with B25/B26 (diff/deploy shared copies). |
| 11 | T38.1 | Locale-tree wave procedure with the hooks it needs | 3.70 | minor |  |
| 12 | T16.4 | Rendered-only inventory (guarded) and the element-boundary separator (B8, re-proposed with new evidence) | 3.45 | patch | after T16.3 (so the flags and reader exist); separate PRs for (1) and  |
| 13 | T17.4 | Viewport regimes and pass-bar honesty: tablet structural pass, ≥1920 canvas assertion, footer-crop shift search, relative Δh | 3.45 | minor | T18.1 (chrome archetype) defines the chrome states the tablet pass gat |
| 14 | T20.3 | Port the observed motion at deploy and re-assert on the published origin — decide the "no motion library" rule | 3.45 | minor | T20.2 (the assertion) must exist; T20.1 improves the inventory it port |
| 15 | T25.1 | Source-already-on-EDS path: `sourcePlatform: eds`, `clone-eds-content.mjs`, `harvest-library.mjs`, library smoke gate | 3.45 | minor | T24.2 (per-URL platform), T21.1 (harness renders library blocks faithf |
| 16 | T36.1 | `direct --brand-docs <dir>`: brand guideline documents as a first-class design input, plus a content-compliance ledger | 3.45 | minor | T35.4 for the font-metrics script |
| 17 | T36.2 | `deploy --restyle`: restyle an existing customised EDS repo in place | 3.30 | minor | T36.3 (shared template-scoping checklist) can land first |
| 18 | T36.4 | Divergent concepts from measured references; mechanical sameness and fold checks | 3.25 | minor |  |
| 19 | T38.4 | Multi-site / second-origin delivery mode | 3.25 | minor | T38.1 (manifest) |
| 20 | T25.5 | Land the Figma donor (PR adobe/skills#315) and reconcile it with reskin's `--donor-figma` contract — re-proposal of deferred B15 with new evidence | 3.05 | minor | independent; reskin routing edit is a one-liner after landing |
| 21 | T25.3 | Structured SSR payload compile path (`structuredSource`, `structured-source.md`, `ssr-grammar.mjs`) | 3.05 | minor | T24.2 (platform per URL); independent of T25.1 |
| 22 | T25.4 | Fleet / multi-site reference and scoping instrument | 3.00 | minor | T24.2 (per-URL platform and census); T25.3 for `structuredSource` |
| 23 | T26.7 | DOM-mirror page generator as the documented reserve path (re-proposal of a deferred/rejected item with new evidence) | 2.85 | minor | after T26.1/T26.6; requires Paolo's explicit go given B17 |
| 24 | T36.5 | Promote an out-of-pipeline prototype and generate/parity-check the canon → EDS foundation | 2.80 | minor | T36.4 (produces the rounds that need promoting) |

## 8. Already implemented or explicitly not adopted (not re-proposed)

`analysis/baseline-implemented.md` lists 139 shipped capabilities (0.14.0 → 0.22.1, every changelog bullet from 0.18.2 with keywords and cites) and 33 items recorded as not adopted, deferred or superseded, with the stated reasons. The consolidation dropped every finding matching Section A and respected Section B. Notable drops: pixel-compare hang and deadlines (0.22.1), `/index → /` (0.22.1), chrome-parity text pairing (0.19.4), sibling-variance probe (0.19.7), consent text fallback and gate identity assertion (0.18.3), EW contract (0.19.0), AI-readability formula and gate (0.21.0), dynamics procedure and hooks (0.20.0), the wine-retailer/us-airline/health-insurer-a/energy-utility explicit ledgers already harvested in 0.18.3–0.19.7, and the stale impeccable pointers fixed on 2026-09-17. Items rejected on evidence and **not** re-proposed: clip-instead-of-hide and nav/footer inlining for AI readability, per-project default ports, dynamic blocks/vendor adapters, stitch-shot `--fullpage`, multi-harness renaming. Four deferred items are re-proposed with new evidence and flagged as such (decision D15).

Analysts' claims that turned out wrong on verification (corrected in the theme files): "0.22.1 decodes `exp` and halts on 401" (prose only, `deploy-batch.mjs` fails pages red); "leading hyphen not covered by delivery-lint" (it is, `:99`); "`localize-links` skips chrome docs" (it includes `*.html`; sports-car-maker's chain filtered the dir); "long batches in background not documented" (it is, `rollout/reference/delivery-gates.md:124`); the `hidden-text` AI-readability theory (superseded by 0.21.0's formula).

## 9. Caveats

- Five folders have no transcript of their own (listed in § 3); `swcargo` and `clover-blog` were not migrations. Sessions run on other machines or pruned by the harness (transcripts are kept ~30 days) are not visible; the stardust-cost-study study counted 16 sessions, we found 74 in 2026-08.
- Wall-clock includes idle time; "active" is the sum of turn durations and is the fairer speed measure. Thinking tokens are redacted from transcripts.
- Scores are the consolidation agents' calibrated judgement, checked for consistency but not independently re-scored; treat the ranking as an order of attack, not a measurement.
- The external pixel audit used a different method (unmasked, fullPage, 32 random pages) from the plugin gate; its absolute numbers are not comparable to gate percentages, but its direction was confirmed by three projects' own instruments.
- Projects ran on plugin versions 0.18.1 → 0.22.1; where a finding was fixed in a later version it was dropped, but runs on 0.21.x–0.22.1 (regional-bank, pharmacy-retailer, tennis-club, tennis-campus, fintech-redesign) still exhibit T01, T09, T10, T15, T19, T21 and T33.

## Appendix — artefact index (`/Users/paolo/stardust/source/190926/analysis/`)

| artefact | content |
|---|---|
| `AGENT-BRIEF.md`, `CONSOLIDATION-BRIEF.md`, `THEME-MAP.md` | the instructions the analysis and consolidation agents followed; the finding → theme map |
| `findings/<project>.md` (26 files) | per-project story, intervention ledger, findings with evidence, wins, baseline |
| `findings-index.tsv`, `idx-high.txt`, `idx-mid.txt`, `idx-low.txt` | flat index of the 791 findings by impact |
| `themes/T01…T39-*.md` (39 files) | consolidated themes: summary, evidence, already-in-plugin (file:line), candidates, wins to protect |
| `candidates.tsv`, `candidates-ranked.tsv` | the 184 candidates with scores, composite, wave |
| `baseline-implemented.md` | 139 implemented rows, 33 not-adopted rows, selection principles, skill map |
| `sessions/<project>/<session>.digest.md` + `.json`, `sessions/summary.tsv` | per-session digests (prompts, errors, timeline, sub-agents) and the summary table |
| `baseline-metrics.txt`, `context-profile.tsv`, `cache-miss.txt`, `skill-reads.txt`, `interventions.txt`, `cost-observations.md` | quantitative baseline and the cache-miss / skill-read / intervention analyses |
| `extract.mjs`, `context-profile.mjs`, `cache-miss.mjs`, `skill-reads.mjs`, `index-findings.py`, `index-candidates.py`, `build-report.py` | the scripts that produced everything above (re-runnable) |
| `davids-model.txt` | the 15 rules of David's Model as fetched from aem.live |
