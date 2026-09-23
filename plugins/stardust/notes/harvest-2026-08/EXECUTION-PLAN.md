> Copy of a working file from the 2026-08 learnings harvest, pushed to `stardust/next` on 2026-09-23 for reference. Real site names are replaced by generic sector descriptors (0.19.2 policy); local paths and `analysis/` pointers refer to the maintainer's machine and are not in this repo.

# Stardust learnings harvest 2026-08 — execution plan

Reference for turning the ranked candidates into a tested plugin release without shipping one item at a
time and without exposing users to untested changes. Agreed in conversation on 2026-09-19; this file is
the contract. The ledger of what actually happened is `PROGRESS.md`.

## 1. Goal and scope

- **Goal**: land the harvest's improvements as one validated release (`0.24.0` or `1.0.0`), measured against
  the harvest baseline on real migrations before any user sees it.
- **In scope**: the 139 candidates in `analysis/candidates-plan.tsv` (W1 51, W2 41, W3 36, W4 11), minus
  what G0 refutes.
- **Parked**: the 45 in `analysis/candidates-parked.tsv` (single-project occurrences; composite < 3.5).
  Listed at the end of `PROGRESS.md`. Return only with new recurrence evidence from a later harvest.
- **Already shipped on main**: T01.1 (0.22.2, PR #377), T11.1–T11.4 (0.23.0, PR #378). Baseline for
  everything below is 0.23.0.
- **Not in scope**: T01.2 / T01.3 stay validated-not-built until Paolo decides; the state-report-as-script
  half of T11.3 is folded into T13.1.

## 2. Isolation: the `next` channel

Users receive stardust from the `adobe-skills` GitHub marketplace, and semantic-release fires on every merge
to `main`. Nothing below touches `main` until § 7.

- Branch `stardust/next` off `main` after #378 merges. Version `0.24.0-next.N` (pre-release; nothing publishes).
- Paolo installs it as a `directory`-source marketplace pointing at the clone checked out on `next`
  (same pattern as his `nebula` / `paolomoz-skills` marketplaces) and disables `stardust@adobe-skills`
  while testing. Users keep 0.23.0.
- `main` is merged into `next` at every batch boundary so user hotfixes are never lost.
- Promotion is one PR `next` → `main`, batch commits preserved (per-batch revert on main is worth more than
  a tidy history), one consolidated changelog section, one version.

## 3. Units of work

**Batch** = one wave, reviewed as a unit. **PR** = one file cluster inside a batch. Every PR targets `next`
from a short branch cut from `next`.

| batch | wave | items | PRs (file clusters) | class |
|---|---|---|---|---|
| B0 | — | evals + fixtures + size foundation | 2 | no skill-text risk |
| B1 | W1 | 51 | ~7: master, deploy, replica, rollout/migrate, extract, dynamics/qa, evals/lint | doc-rule (patch) |
| B2 | W2 | 41 | ~6: deploy, replica, extract/crawl, evals/lint, rest | hardening (patch) |
| B3 | W3 + W4 | 36 + 11 | ~6 + 2: deploy, replica, dynamics/qa, rollout/migrate, rest; sub-flows | gates / flows (minor) |

Rules that keep the PRs independent:

- Within a batch PRs run in parallel from the same `next` commit; clusters are disjoint by construction.
  Across batches strictly sequential (B2 branches cut after every B1 PR merged).
- **Cross-cluster edits go to the owning PR**: a deploy item that needs one sentence in the master skill
  writes it into the batch's master PR.
- **Version and changelog are bumped once per batch** in a closing commit on `next`; PRs touch only skill
  files, scripts and evals.
- Items inside one cluster are built sequentially, each reading the file as the previous left it.
- The deploy and replica clusters hold 92 of 185 candidates and will be the largest PRs; they also have the
  most eval coverage (`replica-source-fidelity`, `ew-editability`, `ai-readability`).

## 4. B0 — foundation (one PR + one PR, before any doc rule)

**B0-a Evals.**
- Baseline run of the 12 existing evals + `routing-migration-flow` on 0.23.0, n = 2–3, label `baseline-0.23.0`.
  Produces the labels G1 compares against and the per-run cost figure the plan lacks.
- 3–4 new evals for W1 behaviours observable in one session, baselined before W1 runs: resume path + state
  report; runner output contract (≤ 60 ranked lines + summary file); credential / prerequisite pre-flight;
  phase checkpoint that prints the next command.
- Fixture hygiene: a post-migrate project fixture (`migrated/`, `progress.json`, a replica gate ledger) that
  deploy, rollout and the W3 gate evals can reuse.

**B0-b Size foundation (T03.1–T03.3, moved ahead of B1).**
- Split `deploy/SKILL.md` (27k words ≈ 47k tokens, injected whole per invocation, over the Read cap) into a
  core ≤ 40 KB plus step-scoped reference chapters.
- Operator card + section index at the top of every `SKILL.md`; TOCs on references > 20 KB.
- Doc-size lint in `npm run lint:stardust` — the mechanism behind the G1 size ratchet (§ 5).
- Retroactive slimming of #377/#378: evidence sentences move to `CHANGELOG.md`, the wait-rule mirrors
  collapse to one-line pointers (≈ 120 lines out of injected files).

## 5. Gates

**G0 — item validation (automated, per item, before building).** An agent re-checks the theme's cites
against the transcripts and re-measures the headline number; writes **confirmed / corrected / refuted**
with the evidence into the theme file (`analysis/themes/Tnn-*.md` § Validation) and a `PROGRESS.md` row.
Refuted → dropped. Corrected → built with the corrected prescription and flagged for G2. Calibration from
the two done so far: T01's addressable share was 46 % not 90 % and the prescription changed; T11's evidence
was two-thirds pre-fix. Expect 10–15 refutations out of 139, not 40.

**G1 — per PR, mechanical, automatic (green = merge to `next` by the agent; red = the item is pulled from the
PR, never patched blind).**
- `npm run lint:stardust` (harness-neutral, script-paths, and from B0-b the doc-size lint).
- Every new/changed script: `node --check` + a smoke run on fixture input (`--help`, one fixture page).
- Eval runner: the touched skill's eval(s) at n = 2 vs `baseline-0.23.0`; no criterion's pass rate may drop.
- Review agent: the diff against the theme's "Wins to protect" list as a checklist, plus the size rules.
- **Size ratchet**: no `SKILL.md` ends a PR larger than it started; deploy core ≤ 40 KB; a doc-rule PR that
  adds must compress or move; one rule lives in one file, others carry a pointer; evidence goes to the
  changelog with at most one number kept in the rule.
- **gate-new ⇒ eval-new**: a PR adding a gate ships the eval that exercises it.
- **Instrument over rule**: where G0 finds a doc-rule a lint/gate/script could enforce, flip the type.
- **Doc-vs-code disagreements** (added after B1): before making one side follow the other, check whether the doc encodes a product decision (a changelog rescope, an eval criterion, a D-decision). D6 "doc follows code" applies to the slug algorithm only.
- **Reference-file cap for B3** (added after the W3/W4 validation, 2026-09-19): a new reference file is ≤ 150 lines; longer material splits into a core rule the operator card points at and an appendix it does not. The W3/W4 prescriptions estimated 2,400 lines of reference text, seven items over 100 lines each.
- **Script-wave review** (added after B2's build, 2026-09-19): for script-heavy items the lane reviewer returns a per-item deliverable checklist (each prescription deliverable marked shipped / partial / missing with file:line), not prose findings; the fix pass must address every missing deliverable or record an explicit skip. A whole-batch deep read (the changelog drafter's diff-per-script pass) is a standard integration stage before the eval gate — it caught more than the nine lane reviewers combined.
- **Lint chain runtime** (added after B3): the chain exceeds the harness's 10-minute cap on background commands — run it detached (`nohup … ; echo exit=$? > file`) with a polling waiter, and assert the exit code from the file, never from a killed process.
- **Plugin-tree residue** (added after B3): tests and pre-flights run at the wrong cwd wrote package.json / node_modules / .work into the plugin dir and a broad `git add -A` tracked them; `evals/lint/plugin-tree.mjs` now fails on any of these at the plugin root, and the root-detection scripts refuse a plugin tree.
- **Judging** (added after B1): the eval judge runs once, after every run of a label has finished — a judge racing a live run produced a false 20/100.

**G2 — per batch, Paolo, ~10 minutes.** Reads only: the ledger diff (confirmed / corrected / refuted);
items whose prescription changed; new gates (condition + escape, not the diff). B1 and B2 may merge on green
G1 with no G2 if Paolo waives it after reading the B1 ledger once in full as calibration. B3 is always
reviewed.

**G3 — promotion, Paolo's migrations.** All batches are merged into `next` first; G3 runs on the assembled
`next` (improvements interact; partial runs cannot be attributed). Two or three real migrations: one replica,
one redesign, one rollout at scale. `analysis/compare-run.mjs` (to write; reuses `cache-miss.mjs`,
`context-profile.mjs`, `skill-reads.mjs`, `active-time`) computes the harvest KPIs for the new sessions:

| KPI | baseline source | must |
|---|---|---|
| cache hit %, full misses after ≥ 5-min gaps | `cache-miss.txt` | improve |
| `sleep` commands / minutes requested | `cache-miss.txt` | fall |
| tokens per delivered page, requests per page | `baseline-metrics.txt` | fall |
| gate pass at first publish; pages published over the bar | findings | not regress |
| hours to first page, hours to whole site | `active-time.txt` | not regress |
| agent-authored scripts / named deviations | findings | fall |
| plugin text read per run; tokens injected per skill invocation | `skill-reads.txt`, `context-profile.tsv` | not rise |

Promote only when nothing regresses and the targeted KPIs move. A failing G3 names a dimension; the ledger
names the items targeting it; bisect by reverting the batch commit or the item on `next`, re-run one
migration. Optional early signal: one small migration after B2, before B3's gates land.

## 6. Orchestration

Per batch PR, a Workflow script (explicit opt-in required; scale ≈ items × 3 agents): validate items in
parallel (G0, typed verdicts) → build per cluster sequentially → review agent per cluster → return ledger
rows. The eval gate, lint and the PR itself are run by the coordinating session, not inside the workflow.
Without the opt-in the same steps run with subagents driven in a long session, at higher context cost.

## 7. Paolo's review moments

1. **Once, up front**: the 17 owner decisions (`REPORT.md` § 6, each with a recommended default) or "take the
   defaults"; go on the `next` channel; eval-run budget; Workflow opt-in.
2. **Per batch (G2)**: as § 5. Two reviews if B1/B2 are waived, four otherwise.
3. **Exceptions**: a G1 red the workflow cannot resolve by dropping the item (ambiguous eval baseline, a
   "wins to protect" conflict between two items). A handful across the plan.
4. **Promotion (G3)**: the migrations and the KPI table; the one review that takes real time.

Never seen: individual item validations, per-PR eval runs, fixed review findings, merges into `next`.

## 8. Risk register

| risk | control |
|---|---|
| a rule regresses a passing run | risk ordering (doc → hardening → gates), gates only exercised at G3, per-batch revert |
| plugin size grows with 139 items | B0-b first, G1 size ratchet, evidence-to-changelog, instrument-over-rule, size KPIs in G3 |
| eval coverage is partial for W1/W2 | B0 baseline + 4 targeted evals; G1 for uncovered doc rules = lint + review; G3 is the test |
| theme claims are wrong | G0 mandatory; corrected items surfaced in G2 |
| parallel PRs collide | cluster split, owning-PR rule, once-per-batch version bump |
| users see untested changes | nothing merges to main before G3; `next` installed only by Paolo |
| D-decisions block items | answered once up front; dependents stay in their wave |

## 9. Status (2026-09-21)

B0–B3 closed; `stardust/next` = 0.24.0-next.4 (ea00c4f4, lint chain 113 exit 0) (5 pre-releases + 2 patch releases on main). 139 planned items: 135 built (T05.2 refuted as a duplicate; T01.2/T01.3 folded into B2; the four W4 sub-flows built in B3 remediation). Eval spend $879 / 126 runs. Waiting on G3 (Paolo) — `PROMOTION.md`.

## 9b. Open inputs (historical)

- ~~The 17 decisions~~ **Answered 2026-09-19: Paolo takes the recommended default on all twelve remaining (D1, D3, D4, D6–D11, D13, D15, D16); D2, D5, D12, D14, D17 dropped with their parked items.**
- Confirmation of the `next` channel and the directory-marketplace install.
- ~~Eval-run budget~~ **Measured 2026-09-19: one eval session ≈ $9.6 / 16 min (direct-from-phrase, 58 turns). Projection: baseline label 13 evals × n=2 ≈ $250 + judging; G1 per PR (touched skill, n=2) ≈ $20–40 → ≈ $600 over ~21 PRs; whole plan ≈ $1,000–1,500 in eval spend. Paolo's default: run and report.**
- Workflow opt-in.
