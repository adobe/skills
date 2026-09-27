# Batteries — the decision layer's question files

One JSON file per decision the pipeline delegates to a System One model through
`../decide.mjs` (#127). Code builds the state, the battery names the judgments, the model
answers with probabilities, code routes. Nothing here generates text.

## Shape

```json
{
  "name": "page-type", "version": 1, "description": "one line",
  "state": { "fields": { "page": "what the caller puts there", "types": "…" } },
  "questions": {
    "type":  { "type": "choice", "instructions": "…", "criteriaFrom": "types", "appendNone": { "none": "…" } },
    "flag":  { "type": "noul",   "instructions": "…", "criteria": { "true": "…", "false": "…" } },
    "level": { "type": "score",  "instructions": "…", "criteria": ["low situation", "mid situation", "high situation"] }
  },
  "route": { "type": { "confident": 0.9, "review": 0.6, "noneIs": "none" }, "flag": { "yes": 0.8, "no": 0.2 } }
}
```

- `instructions` and every criterion may be a string or an object (`question`, `focus`,
  `what`, `not_for`, `examples`, `summary`, `signals`); field names are free, the model sees
  names and values. Reference state fields in backticks: `` `section` ``, `` `page.path` ``.
- `criteriaFrom` takes a choice's options (array → names, object → name: description) or a
  score's levels from the state; `appendNone` adds the no-match option. Choice: 2–255
  options; score: 2–10 levels.
- `route`: per question, `confident` / `review` for choice and score (on the answer's
  confidence), `yes` / `no` for a noul; `noneIs` names the option that turns an `act` into
  `review`. Overall verdict = the worst routed question. Anything not routed is advisory.
- `state.fields` documents the contract for the caller; it is not sent.

## Authoring rules (the vendor's, kept short)

One proposition per noul, and a high value must mean yes. Levels describe situations, not
degrees, and never refer to each other. Options that are confused get `what` / `not_for` /
`examples`. Every choice that might not cover its input has a no-match option. Pass existing
JSON (a schema section, a registry, a triage row) as the state or as criteria instead of
templating it into prose. A choice ranks *which*; a noul decides *whether* — a shortlist is
re-checked with nouls (`block-fit`). Anything graded is a score, never a noul (0.5 is
"split", not "medium"). Keep the state under 32k tokens: slice with the reading helpers.

Wording is part of the model: two phrasings of one question can behave differently. Change a
battery's `version` when its wording or thresholds change, so the ledger stays comparable.

## Measuring a battery

`evals/jev-batteries/` harvests recorded decisions from past runs into a labelled set and
replays them: agreement with the recorded answer, agreement per confidence bin, the share
routed `act` / `review` / `escalate`. A battery gates nothing until it has been measured
there; until then callers run it beside their own judgment and compare.

| battery | decision it carries | caller | status (BASELINE.md) |
|---|---|---|---|
| `flow-routing` | replica / redesign / reskin + stated arguments | master skill entry | shadow (hands_off go) |
| `page-type` | archetype per captured page; confidence → fidelity tier | extract prep, migrate | go — shadow wired |
| `dynamics-triage` | class, disposition, reproducibility, PII flag | dynamics Phase 2 | class go — shadow wired; other axes agent |
| `block-triage` | block vs default content, collection, reuse, decode tier, shape | deploy Step 2 | reuse shadow candidate; tier agent |
| `block-fit` | re-check one shortlisted block | deploy Step 2 | unmeasured |
| `red-adjudication` | one content-diff red: lost, transformed, covered | migrate, qa | unmeasured (no label source) |
| `residual-causes` | causes of an over-cap residual, multi-label | replica Phase 4 | no verdict (state) |
| `section-alignment` | same block / variant / different | rollout B, sibling variance | not yet |
| `metadata-select` | title or description from found candidates | rollout optimize | rubric decision first |
| `flag-justify` | a gate flag: artefact, intended per policy, or defect | replica Phase 4, published gate | pre-sort go — wired in gate.sh |
| `repair-priority` | reader harm, scope and template-wide for a failing all-pages row | rollout after gate-all | demo (Spearman 0.56 vs baseline) |
| `valid-round` | fix-loop: does this gate round count against the cap? | gate.sh --full via gate-flags --round | fixtures 6/6 invalidated caught; advisory |
| `fix-pattern` | fix-loop: which catalogue pattern explains the first hot section | gate.sh --full via gate-flags --round | fixtures top-1 15/15; advisory |
| `phase-claim` | supervisor: a phase-end claim cites evidence, or asserts / skips | `ledger.mjs end` | gate go — wired in ledger end |
| `brief-check` | supervisor: a subagent brief carries the phase's checklist | before a fan-out | shadow, no verdict |
| `plan-vs-flow` | supervisor: the proposed next step is legal for the flow and state | routing, resume | shadow |
| `decision-batch` | supervisor: the owner message is one named batch with interims | dynamics decision batch | shadow (small n) |
