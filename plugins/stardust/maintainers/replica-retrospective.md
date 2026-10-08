# Retrospective of a `stardust:replica` run — agent brief

Hand this file to an agent together with a finished (or abandoned) replica run. The agent produces a
retrospective whose readers are **other agents that will fix and improve the stardust plugin**. Every
finding must therefore be a self-contained fix ticket: located, evidenced, reproducible, verifiable.

The agent writes a report and draft learnings. It never edits the plugin source, the CHANGELOG or the
run's delivered code.

## Inputs

| input | required | what |
|-------|----------|------|
| `<project>` | yes | the run's project root, the one containing `stardust/` |
| `<plugin>` | yes | a checkout of the stardust plugin (`plugins/stardust/` of the skills repo) |
| transcript(s) | no, strongly preferred | the session log(s) of the run, any harness format |
| operator notes | no | what the human saw: interventions, complaints, what felt slow or wrong |
| earlier retrospectives | no | `retrospective.md` files of other replica runs, for recurrence |

Without a transcript, say so at the top of the report. Cost and deviation findings then rest on
artifacts alone and get confidence `low` unless the artifacts prove them.

## Ground rules (generic retrospective practice)

Drawn from blameless postmortems (Google SRE book ch. 15 and workbook ch. 10), the After Action
Review, the learning-from-incidents debriefing practice (Etsy's Debriefing Facilitation Guide,
Allspaw's "The Infinite Hows") and LLM error analysis (open and axial coding of traces).

1. **Expected vs actual (the After Action Review frame).** For the run and for each phase, state
   what was supposed to happen (the skill contract plus the user's ask), what actually happened,
   why the two differ, and what to keep or change. Every finding is a gap between the first two.
2. **Blameless and systemic.** The agent that ran the skill acted on the text and the tool output it
   had. Ask what in the skill, the instruments or the environment made the bad step likely. "The
   agent ignored rule X" is a symptom; the finding is why X lost (buried, contradicted, too long,
   not enforced by a script). Fixes change the system, not the agent's behaviour: "remind the agent
   to be careful" is never an action.
3. **Local rationality: reconstruct what the agent saw.** Unlike a human debrief, a transcript shows
   exactly what was in context at each decision: which doc sections were read (or never read), what
   an instrument printed, what had already scrolled out or been compacted. Describe the decision
   from inside that view. Write descriptions, not explanations; avoid counterfactuals ("should
   have", "failed to"). Describe what happened and what the agent was looking at.
4. **Timeline before judgement.** Reconstruct what happened, in order, before interpreting any of it.
5. **Evidence or it did not happen.** Every claim cites a file path (with line or JSON path), a ledger
   line (`ts`), a gate dir, or a transcript turn. Separate *observed* from *inferred*; mark inference.
6. **Trigger and contributing factors, not one root cause.** Name the trigger (the step where it went
   wrong) and ask "how" questions to find every condition that let it happen: doc wording, a
   missing check, a default, the site, the harness. A single linear why-chain hides the conditions
   that are cheapest to fix. Keep going until each factor lands on something a plugin change can
   fix, or on something outside the plugin (site, network, harness).
7. **First failure first.** In a cascade, the earliest deviation explains the later ones (a wrong
   `--main` scope makes every later pixel round noise). Ticket the upstream failure; list the
   downstream symptoms under it as cost, not as separate tickets.
8. **The fresh-agent test.** For each failure, ask: would a fresh agent that follows the skill text
   literally, at the run's plugin version, have done the right thing? Yes → `agent-deviation` or
   `rule-salience`. No → `doc-gap` / `doc-ambiguity` / `doc-conflict` / `instrument-*`.
9. **Detection.** For each problem, record who or what caught it (an instrument, a gate, the human,
   nobody yet) and how long after it began. Late or human-only detection is its own ticket: the
   cheapest fix is often an earlier, louder check, not prevention.
10. **Quantify impact and cost separately.** Impact: what reached the deliverable (pages shipped
    wrong, ungated, clipped, missing behaviour). Cost: minutes, gate rounds, re-runs, context
    characters, human interventions. Together they set priority, not how interesting a finding is.
11. **Keep what worked, and where it got lucky.** Record practices and instruments that clearly paid
    off, so a fix does not regress them. Record near misses: problems that did no harm only by
    chance (a site with no consent modal, a page that happened to fit). They are tickets too.
12. **One run is one sample.** Mark each finding `general`, `site-specific` or `unknown`. Never turn
    a site quirk into a global rule; prefer a flag or a detection over a new default. A finding that
    recurs across runs (see Procedure step 6) outranks one seen once.
13. **Hindsight is not evidence.** Judge decisions by what was knowable at the time, not by the
    final outcome.
14. **Neutral, factual language.** No drama, no blame words ("careless", "ridiculous"); give the
    numbers that justify a severity.
15. **Unknowns are output too.** What you could not determine goes in Open questions, with what
    evidence would settle it.
16. **Few, ranked, measurable actions.** Merge duplicates, rank by impact, cost and recurrence, and
    give every ticket a priority and a verifiable end state. Vague verbs ("improve", "make
    better", "clarify") are not an end state. Minor observations go in an appendix.

## Plugin-specific rules for proposed fixes

These come from `<plugin>/AGENTS.md` and apply to every ticket:

- **Mechanism over prose.** Prefer, in order: a script that fails loud or does the step itself; a
  lint or check; a changed default; a doc rule. Skill prose dilutes attention. A ticket that adds
  prose names what to fold or delete to pay for it (`evals/lint/prose-delta.mjs` will be quoted in
  the PR).
- **Known already?** Before proposing a rule, search `<plugin>/CHANGELOG.md` and the skill docs for
  it (`rg -n "<terms>"`) and list the terms you searched. An existing rule that was not followed is a
  `rule-salience` ticket (make it enforced or more visible), not a new rule.
- **Judge against the run's version.** Read it from `state.json` `_provenance.stardustVersion`
  (stamped by `state.mjs`). In `<plugin>`, the commit that set it is the oldest one
  `git log --format=%h -S '"version": "<v>"' -- .claude-plugin/plugin.json | tail -1` prints; it
  and the commits up to the next version bump are the candidates. Check the first out in a
  temporary worktree and read the skill text and scripts there. Confirm it with `diff -rq` of each
  project copy (`stardust/scripts/{replica,diff,stardust,migrate}`) against that worktree. If the
  version is missing or the copies match no candidate, report the version as `unknown` and do not
  assign `agent-deviation` or `rule-salience` for rules that may postdate the run.
- **Fixed since the run?** Compare the run's version with `<plugin>` today (CHANGELOG sections
  after it, `git log <commit>..HEAD -- skills/<skill>`). Mark each ticket `open`,
  `fixed-since (<version>)` or `partly fixed`.
- **Hand-edited script copies are findings.** A project copy that differs from the run's version is
  a defect per `skills/replica/reference/source-fidelity-gate.md` § Script adaptations. Report what
  the edit worked around; that is usually the real instrument gap.
- **No site names**, anywhere in the output: role names ("a commerce home page") and placeholders
  (`<site>`, `<slug>`). The output may become a CHANGELOG entry, where `evals/lint/site-names.mjs`
  will fail on them.
- **Harness-neutral** wording in any proposed doc text.
- **Name real targets.** `proposed change` points at a file and section that exist in `<plugin>`
  today (`skills/<skill>/…md § <heading>` or `skills/<skill>/scripts/<name>.mjs`).

## How to read the run (the context is your budget too)

Apply `skills/replica/reference/reading-discipline.md` to yourself: never `cat` a whole capture,
report or transcript. Run the project's own helpers from `<project>` (copies under
`stardust/scripts/`, or the `<plugin>/skills/*/scripts/` originals):

- `node stardust/scripts/stardust/ledger.mjs tail -n 200`: the phase timeline.
- `node stardust/scripts/stardust/state.mjs summary --slugs`: page status.
- `node stardust/scripts/replica/json-query.mjs <file> [--path … --fields …]`: `progress.json`,
  gate `summary.json`, `motion/*.json`.
- `node stardust/scripts/replica/section.mjs <doc> --list`, then one section: `journal.md`, skill
  docs, the register.
- `rg -n` over transcripts for tool errors, exit codes (gate.sh `124` deadline, `3` challenge page,
  `4` marker missing; run-bg `75` still running), retries, `sleep`, `cat `, `node -e`, user
  messages, and context-compaction or session-boundary markers (what was lost across them).
- Images: one crop per fact, only when a finding depends on it.

## Evidence map

| artifact (under `<project>/stardust/`) | answers |
|---|---|
| `status.jsonl` (ledger) | phase start/end order, durations, `blocked` lines, missing starts |
| `journal.md` | one section per phase? decisions and their stated reasons |
| `state.json` | `_provenance.stardustVersion`, `flow`, `flowSource`, page statuses, `approvedBy` |
| `direction.md`, root `PRODUCT.md`/`DESIGN.md`/`DESIGN.json` | promotion branch and provenance |
| `replica/inconsistency-register.md` | every design delta has an entry with evidence and status |
| `replica/breakpoint-map.md` | target breakpoints decided before CSS (only with `--target-breakpoints`) |
| `replica/progress.json` | iterations, pass/fail, residuals with cause, `captureState`, motion |
| `replica/gates/<slug>-<width>/` | per-round evidence; round labels show iteration count |
| `replica/gates/prototypes-<width>/`, `gates/all-<width>/summary.md` | prototype table, delivery gate |
| `replica/motion/<slug>.json`, `<slug>-build.json` | interaction parity actually observed and compared |
| `dynamic-features.md`, `-plan.md` | every dynamic row has a disposition |
| `rollout/progress.json`, `foundation-freeze.json`, `foundation-requests.md` | Phase 5 units |
| `learnings.md` | what the run itself already recorded |
| `scripts/` copies | plugin version, hand-edits |
| `migrated/**/_meta.json`, `migrated/**/<name>._meta.json` | per-page `gatesPassed`, `gateEvidence` |
| `migrate/progress.json` | sibling render units: status and verdict per unit |
| transcript | what was in context per decision, tool-output volume, errors, waits, interventions |

## Procedure

1. **Frame (expected).** One paragraph: the user's ask, site role (anonymised), entry mode
   (`--prep` vs `--single`/`--pages`), breakpoints, target breakpoints, hands-off or supervised,
   plugin version, and the intended end state (which phases, which gates).
2. **Timeline (actual).** A table, one row per phase (and per rollout unit): start, end, wall-clock,
   outcome, notable events. Mark gaps longer than 10 minutes, every resume or new session, every
   context compaction and every human message.
3. **Contract check.** Walk the checklist below. Each item: `held` / `broken` / `n/a` / `unknown`,
   with evidence. The skill text at the run's version is the authority. If this checklist disagrees
   with it, follow the skill and report the drift as a finding against this file.
4. **Metrics.** Fill the metrics table below.
5. **Open coding.** Walk the timeline and write one plain note per problem, near miss, expensive
   stretch and operator complaint: what happened, what the agent was looking at, who or what
   detected it and when. No categories yet. Note what worked as you go.
6. **Axial coding and recurrence.** Group the notes: chain downstream symptoms under their first
   failure, then give each group a category (ticket field below) and a count. Check each group
   against the CHANGELOG, `learnings.md` entries and earlier retrospectives; a recurring group
   gets `recurrence` filled and a higher priority.
7. **Tickets.** One per group: trigger, contributing factors, proposed change. Rank by impact, cost
   and recurrence.
8. **Write the outputs** (below), then review them: every claim has evidence; no blame or
   counterfactual wording; no vague verbs; no site names; every ticket has a verifiable end state.

## Contract checklist (replica)

Section names refer to `skills/replica/SKILL.md` unless another file is given.

**Setup**
- Flow guard: `flow` stamped `replica` (or a refused redesign flow); flow line shown first after extract.
- Playwright importable from the project root; gate deps (pixelmatch, pngjs, cheerio) probed before
  installing; installs as devDependencies, never `--no-save`.
- All four script dirs copied (`stardust/scripts/{replica,stardust,migrate,diff}`), `replica/` and
  `diff/` siblings, nothing in the project-root `scripts/`; no hand-edits.

**Phase 1–2: extract, preserve direction**
- Right extract mode for the ask; bounded runs took the bounded promotion branch
  (`reference/preserve-direction.md` § 1a), `--prep` runs promoted verbatim. Never mixed.
- `direct` never invoked; no divergence, no palette or type re-selection.
- Register exists (empty is valid); every non-register design change is a defect.
- Dynamics triage ran; every row has a disposition.

**Phase 3: recreate**
- Clean semantic HTML/CSS; no DOM copy, no page-level ported CSS; CSS portation only per section with
  a recorded reason (`reference/recreation-procedure.md` § CSS-portation fallback).
- Values lifted from source CSS and `measure.mjs`, not eyeballed; content verbatim from page JSON.
- Fonts: same source or metric-matched substitute surfaced to the user; no rehosted licensed kit.
- One standalone, cumulative prototype per archetype; none skipped straight to platform authoring.
- With target breakpoints: authored on target steps from the first line; `breakpoint-lint.mjs` clean.

**Phase 4: source-fidelity gate**
- Every breakpoint gated; first and confirmation rounds `--full`; everything through `gate.sh` +
  `run-bg.mjs`; no hand-written wrapper, no foreground long instrument, no `sleep` loops.
- Pass bar complete per breakpoint: structural, visual, pixel ≤ 10 % with bands explained,
  |Δh| ≤ 8 px, `Clipped: 0`, overflow assert. Once per archetype, after the 1440 pass: the
  content-cap row at the derived probe width prints `cap-probe: PASS`
  (`reference/source-fidelity-gate.md` § Pass bar).
- Iteration cap of 3 per breakpoint respected; residuals logged with band, %, cause and owner
  (§ Residual logging format).
- One prototype server per project, probed with `curl` first; a foreign server never killed.
- Inner loop as documented: chrome-parity before pixel rounds on header/footer/strips; anchor probe;
  the first hot band fixed top-down (§ Reading the band breakdown); fixes taken from instrument
  output, not screenshots.
- Hardening honoured: `--main` symmetric (never `body`), `--dismiss`, challenge pages failed loud
  rather than measured, `domcontentloaded`, fixed/sticky chrome replicated fixed.
- With target breakpoints: shifted-band failures logged as tier-shift against the register entry,
  never iterated (§ Target breakpoints — shifted bands).
- No impeccable craft, critique or divergence step anywhere in the recreation.
- Approval recorded with `state.mjs advance … --to approved` (`--by hands-off` when hands-off).
- Interaction parity ran per archetype (observe live → implement fired behaviour → observe build →
  `motion-compare.mjs`); `captureState[].restoreAtDelivery` filled.
- Every prototype has a row in the `gate-all --stage prototype` table.

**Phase 5: handoff**
- `reference/handoff-contract.md` read instead of whole sibling SKILL.md files.
- Units in order: C0 foundation (gated, frozen, committed) → C-archetype gated on the published
  origin before its siblings → C1…Cn per template cluster → C-final.
- `sibling-variance.mjs` run per template before cloning; content-fidelity measured at import.
- Fixed-composition sections decoded template-slotted, repeat groups reconstructive; blocks pass
  `block-roundtrip --ew`; no frozen file edited mid-wave; `foundation-requests.md` applied once at
  C-final.
- Cluster subagent briefs carried the evidence rule and instrument invocations verbatim; each
  subagent reported one verdict line and kept its own batch ledger.
- Published-origin gate in the ordinary gate dir under `pub<N>` with `--marker`; nothing
  pixel-shaped on the local harness.
- Delivery gate = `gate-all` on the published origin, four criteria; no page without a row;
  `gate-evidence.mjs` filled the `_meta.json` sidecars; `update-coverage.mjs --gate` run at C-final.
- The main agent stayed coordinator during the wave: no page instrument, no CSS edit, no foundation
  fix of its own (handoff contract § 3, row C records the context growth when it did not).
- `captureState[].restoreAtDelivery` promises implemented at delivery, not shipped frozen.
- Sibling render units recorded in `stardust/migrate/progress.json`, each after its archetype's
  C-archetype unit.
- Every rollout phase A–I has its ledger start/end pair and the artifacts the "Produces" column of
  `reference/handoff-contract.md` § 3 lists (D3 is `n/a` on a single-language site). A run that
  stopped after C-final is a broken item for each missing phase, not a pass.
- Rollout's report phase (H) wrote `stardust/learnings.md`.

**Bookkeeping and discipline (all phases)**
- Ledger `start` is the first command of each phase; `end` paired; a `journal.md` section per phase.
- `state.mjs` / `ledger.mjs` used, never hand-built JSON or `node -e` edits of `state.json`.
- Reading discipline: no whole-doc reads, no `cat` of captures or logs, one section per call.

## Metrics table

| metric | value | source |
|---|---|---|
| wall-clock total / per phase | | ledger |
| sessions / resumes | | ledger, transcript |
| archetypes; pages delivered / ungated | | progress.json, gates/all-* |
| gate rounds per archetype × breakpoint | | gate dirs |
| pixel % first round → last round, per archetype × breakpoint | | progress.json |
| residuals without a cause | | progress.json |
| problems by detector (instrument / gate / human / undetected) and detection delay | | open-coding notes |
| deadline exits (124) and re-queued captures | | run-bg logs |
| human interventions | | transcript, operator notes |
| tool calls; tool-output characters; largest single outputs | | transcript |
| whole-file reads of skill docs (characters) | | transcript |

Leave a cell `n/a (no transcript)` rather than estimating.

## Outputs

### 1. `<project>/stardust/replica/retrospective.md`

```markdown
# Replica retrospective — <role of the site>, <date>, plugin <version>

## Summary
Three to five lines: outcome, the biggest cost, the top two tickets.

## Frame
## Timeline
## Metrics
## Contract check
(table: item | held/broken/n/a/unknown | evidence)

## What worked
- <practice or instrument> — evidence — keep because …

## Where it got lucky
- <near miss> — what would have happened — ticket T<n>

## Tickets
### T1 <imperative title of the fix>
- priority: P0 (blocks delivery or ships defects) | P1 (large cost, recurs) | P2
- category: doc-gap | doc-ambiguity | doc-conflict | rule-salience | instrument-bug |
  instrument-gap | default-wrong | harness-env | site-edge-case | agent-deviation
- failure class: <the `learnings.md` vocabulary, e.g. silent-render, capture-gap, dynamic-gap>
- scope: general | site-specific | unknown; recurrence: <other runs/entries, or "first seen">
- status vs plugin: open | fixed-since <version> | partly fixed
- expected vs actual: <contract line> vs <what happened>
- evidence: <paths, ledger ts, transcript turns>
- what the agent saw: <the doc sections and tool output in context at the trigger>
- detected by: <instrument | gate | human | undetected>, <delay after the trigger>
- impact: <what reached the deliverable>; cost: <minutes, rounds, characters, interventions>
- trigger: <the step>; contributing factors: <each condition, each ending at a fixable cause>
- downstream symptoms: <later failures this one explains>
- already known: <CHANGELOG/doc refs, or "none" + search terms>
- proposed change: <file § section or script>; tier: script | lint | default | doc;
  type: prevent | detect earlier | mitigate
- sketch: <the rule text or behaviour change, short>
- prose budget: <what to fold or delete, or "script only">
- done when: <verifiable end state: a test in `scripts/test/`, a criterion in
  `evals/replica-source-fidelity/criteria.json`, a lint, or a re-run step and its expected output>
- confidence: high | medium | low

## Open questions
- <question> — evidence that would settle it

## Appendix: minor observations
## Draft CHANGELOG entry
(anonymised, in the CHANGELOG's own style: what the field showed, then one bullet per change,
with numbers)
```

### 2. Draft learnings in `<project>/stardust/learnings.md`

For each ticket whose `scope` is `general`, append one entry in the exact four-field shape of
`skills/stardust/reference/learnings.md` § Entry shape, with `status: pending`; `scope` is a ticket
field, not an entry field. Site-specific and unknown-scope tickets stay in the retrospective only.
One failure class per entry; `proposed change` copied from the ticket. Never delete or rewrite existing entries. If one
already covers a ticket, cite it in the ticket instead of duplicating.

### 3. Final reply

The report path, the ticket count by priority, the top three tickets in one line each, and what you
could not check.
