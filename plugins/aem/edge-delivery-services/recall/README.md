# Recall probe

Decides which lines of a skill are worth their tokens: test what current models already know without the skill and without search, then keep only what they get wrong or don't know. Method from https://github.com/adobe/aem-boilerplate/pull/655.

## Steps

1. **Inventory.** Split the skill (SKILL.md + references) into atomic facts. Classify each:
   - `eds` — Edge Delivery Services specific
   - `generic` — general web/JS/CSS practice
   - `repo` — visible in the project (`ls`, `cat package.json`, lint config, existing blocks)
2. **Verify.** Check every `eds` fact against a live source (aem-boilerplate `main`, aem.live docs, aem-cli source). Record the source. Wrong facts get fixed in the skill, not quizzed.
3. **Quiz.** One open, non-leading question per `eds` fact. Questions must not contain the answer.
4. **Recall.** Ask each model the full quiz in one prompt, no tools, no skill text. Save raw answers.
5. **Score.** Each answer vs. its fact: `correct`, `wrong` (confident and incorrect, incl. stale), `missing` (no answer, vague, or partial). Two scorers from different vendors score independently; disagreements go to a human.
6. **Decide.**

| Condition | Decision |
|---|---|
| `generic` or `repo` | cut |
| `eds`, `correct` in all models | cut, unless forgetting it is costly and silent (e.g. unscoped CSS, editing `aem.js`): then keep as a one-line `reminder` |
| `eds`, `wrong` in any model | keep, state sharply |
| `eds`, `missing` in 2+ models | keep |
| otherwise | judgement, note why |

Facts that steer workflow (step order, when to invoke other skills) aren't recall; the tessl regression eval covers those.

## Regression check

Before trimming a skill:

1. Write at least one eval scenario aimed at facts the recall quiz showed models get `wrong`, and one at the skill's workflow where that is testable.
2. Run the scenario without the skill first. If the no-skill baseline scores above ~90, rework the scenario until it discriminates; a scenario every model passes can only show nothing broke, not that the skill helps.
3. Use 3 repeats on the skill's own scenarios; single runs swing widely. The shared CI workflow runs once, so run these locally from the plugin directory (`tessl eval run . -n 3`, needs `tessl login` to the `adobe` workspace).

After the trim, run the same eval again and compare with `tessl eval compare <before-run> <after-run> --full`. The trimmed skill should score no lower on the skill's scenarios.

## Files

```
recall/<skill>/
  facts.json          [{ id, claim, source, kind, verified, question, quiz? }]  (quiz: reason a fact is excluded, e.g. wrong claim)
  answers/<model>.md  raw model output (gitignored)
  scores.json         { models: [...], facts: { <id>: { <model>: score, decision, note } } } (gitignored)
```

Only `facts.json` is committed. Answers and scores go stale with each model release and are cheap to regenerate; summarize models, totals and per-fact decisions in the PR body.

## Models

`claude-sonnet-5.5`, `gemini-4-argon`, `gpt-6.1-sol`. Re-run when models change; cuts that depended on a removed model's recall should be re-checked.
