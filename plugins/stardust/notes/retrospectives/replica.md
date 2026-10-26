# Retrospective of a `stardust:replica` run — agent brief

Hand this file to an agent together with a finished (or abandoned) replica run. The agent produces a
retrospective whose readers are **other agents that will fix and improve the stardust plugin**. Every
finding must therefore be a self-contained fix ticket: located, evidenced, reproducible, verifiable.

The agent writes a report and draft learnings. It never edits the plugin source, the CHANGELOG or the
run's delivered code.

Only the contract checklist is replica-specific; the rest fits any stardust flow. The brief stays
replica-only until a second flow needs a retrospective, then the shared part moves to its own file.

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
  project copy (`stardust/scripts/{replica,diff,stardust,migrate}`) against that worktree, setting
  aside files adapted as documented (next rule). If the version is missing or the remaining copies
  match no candidate, report the version as `unknown` and do not assign `agent-deviation` or
  `rule-salience` for rules that may postdate the run.
- **Fixed since the run?** Compare the run's version with `<plugin>` today (CHANGELOG sections
  after it, `git log <commit>..HEAD -- skills/<skill>`). Mark each ticket `open`,
  `fixed-since (<version>)` or `partly fixed`.
- **Script copies that differ.** `skills/replica/reference/source-fidelity-gate.md` § Script
  adaptations decides: an adaptation with the documentation that section requires is legitimate,
  and the instrument gap it works around is a ticket for upstreaming; an undocumented edit is a
  defect. Either way, report what the edit worked around.
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
| `scripts/` copies | plugin version; adaptations, with their comments and ledger lines |
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
   against the CHANGELOG, `learnings.md` entries and earlier retrospectives. Write one Analysis
   entry per group (template below); recurrence raises its priority.
7. **Tickets.** One per Analysis entry that needs a plugin change, ranked by impact, cost and
   recurrence. A ticket carries only what the fixing agent needs; the analysis stays in the report.
8. **Write the outputs** (below), then review them: every claim has evidence; no blame or
   counterfactual wording; no vague verbs; no site names; every ticket has a verifiable end state.

## Contract checklist (replica)

Each check points at the skill section that defines the rule; read the rule there, at the run's
version, never from this table. A pointer that no longer resolves is a finding against this file.
Short names: `S` = `skills/replica/SKILL.md`, `G` = `skills/replica/reference/source-fidelity-gate.md`,
`R` = `…/recreation-procedure.md`, `P` = `…/preserve-direction.md`, `H` = `…/handoff-contract.md`.
Evidence paths are under `<project>/stardust/` unless they start with `<project>/`.

| check | rule | evidence in the run |
|---|---|---|
| flow guard, flow line | S § Setup (step 1), § Phase 1 | `state.json` `flow`, `flowSource`; transcript |
| deps and script copies | S § Setup (steps 2–4) | `<project>/package.json`; `scripts/*`; `<project>/scripts/` |
| copies unmodified, or adapted as documented | G § Script adaptations | `diff -rq` against the run's version; for each differing file, its comment and ledger line |
| extract entry mode | S § Phase 1 | ledger `extract` lines; `current/` contents |
| promotion branch | P § 1. Promotion contract, § 1a | `direction.md`; root `PRODUCT.md`, `DESIGN.*` |
| no redesign step | S § Phase 2, § What replica never does | transcript; ledger |
| inconsistency register | P § 3. The inconsistency register | `replica/inconsistency-register.md`; prototype deltas |
| target breakpoints | P § 4. Target breakpoints | `replica/breakpoint-map.md`; `DESIGN.json` |
| dynamic surface | S § Phase 2 (step 5) | `dynamic-features.md`, `dynamic-features-plan.md` |
| recreation, not copying | S § Phase 3; R § CSS-portation fallback | `prototypes/` |
| lifted values | R § CSS lifting | transcript (`css-rules.mjs`, `measure.mjs` calls) |
| fonts | R § Fonts policy | prototype `@font-face`; message to the user |
| cumulative prototypes | R § Cumulative archetype prototypes | `prototypes/`; `replica/progress.json` |
| capture state | R § Asset harvest and the capture-state policy | `replica/progress.json` `captureState` |
| fixed and sticky chrome | R § Fixed and sticky chrome | prototype CSS; chrome-parity output |
| gate procedure and server | G § Per-breakpoint procedure | run-bg job args and logs; transcript |
| pass bar and content-cap row | G § Pass bar | `replica/gates/<slug>-<w>/`; `cap-probe` output |
| iteration discipline | G § Iteration discipline | round labels in gate dirs; `progress.json` |
| inner loop | G § Reading the band breakdown | order of anchor, chrome-parity and pixel runs |
| hardening | G § Hardening rules | gate command flags in run-bg job args |
| shifted bands | G § Target breakpoints — shifted bands | `progress.json` `tierShift` |
| residuals | G § Residual logging format | `replica/progress.json` |
| interaction parity | R § Interaction parity | `replica/motion/*.json`; `progress.json` `motion` |
| prototype table, approval | S § Phase 4 (closing paragraphs) | `replica/gates/prototypes-<w>/`; `state.json` |
| sibling tier | H § 1. Migrate | `migrate/progress.json`; `sibling-variance.mjs` output |
| deploy per page | H § 2. Deploy | `block-roundtrip --ew` output; `_meta.json` sidecars |
| C-deliver units, fan-out | H § 3 (row C, Fan-out discipline) | `rollout/progress.json`, `foundation-freeze.json`, `foundation-requests.md` |
| published-origin gate | G § The published-origin gate | `replica/gates/<slug>-<w>/` `pub<N>` rounds |
| delivery gate | G § The all-pages published-origin gate | `replica/gates/all-<w>/summary.md`; sidecars |
| bookkeeping | H § 5. Bookkeeping; S § Phase 4 (ledger paragraph) | `status.jsonl`; `journal.md` |
| reading discipline | `skills/replica/reference/reading-discipline.md` | transcript |
| run learnings written | `skills/stardust/reference/learnings.md` § Who writes, who reads | `learnings.md` |

Checks only a retrospective makes, so they are stated here:

- **Phase coverage.** Every replica phase and every rollout phase A–I (H § 3) the run reached has a
  ledger `start` written before its first script and a paired `end`. D3 is `n/a` on a
  single-language site. A run that stopped early is `broken` once per missing phase, not a pass.
- **Ordering.** Each sibling render unit starts after its archetype's C-archetype unit is `done`.

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

## Analysis
### A1 <what happened, one line>
- expected vs actual: <contract line> vs <what happened>
- what the agent saw: <the doc sections and tool output in context at the trigger>
- detected by: <instrument | gate | human | undetected>, <delay after the trigger>
- impact: <what reached the deliverable>; cost: <minutes, rounds, characters, interventions>
- downstream symptoms: <later failures this one explains>
- already known: <CHANGELOG/doc/learnings refs, or "none" + search terms>
- recurrence: <other runs or entries, or "first seen">

## Tickets
### T1 <imperative title of the fix> (from A1)
- priority: P0 (blocks delivery or ships defects) | P1 (large cost, recurs) | P2;
  scope: general | site-specific | unknown; confidence: high | medium | low
- category: doc-gap | doc-ambiguity | doc-conflict | rule-salience | instrument-bug |
  instrument-gap | default-wrong | harness-env | site-edge-case | agent-deviation;
  failure class: <the `learnings.md` vocabulary, e.g. silent-render, capture-gap>
- status vs plugin: open | fixed-since <version> | partly fixed
- evidence: <paths, ledger ts, transcript turns>
- cause: <trigger step>; contributing factors: <each ending at a fixable cause>
- proposed change: <file § section or script>; tier: script | lint | default | doc;
  type: prevent | detect earlier | mitigate; sketch: <the rule or behaviour change, short>
- prose budget: <what to fold or delete, or "script only">
- done when: <a test in `scripts/test/`, a criterion in
  `evals/replica-source-fidelity/criteria.json`, a lint, or a re-run step and its expected output>

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
