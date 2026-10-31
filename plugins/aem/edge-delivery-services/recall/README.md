# Recall probe

Decides which lines of a skill are worth their tokens: test what current models already know without the skill and without search, then keep only what they get wrong or don't know. Method from https://github.com/adobe/aem-boilerplate/pull/655.

## Steps

1. **Inventory.** Split the skill's factual content (SKILL.md + references) into atomic facts: one key point per claim. Skip workflow and best-practice opinions not documented on aem.live (see below). If a claim has a main point plus a secondary detail worth knowing, make two facts; if the detail is noise, drop it. Classify each:
   - `eds` — Edge Delivery Services specific
   - `generic` — general web/JS/CSS practice
2. **Verify.** Check every `eds` fact against a live source (aem-boilerplate `main`, aem.live docs, aem-cli source). Record the source. If the skill is wrong, correct the claim, fix the skill to match, record the old wording in `skillSays`, and quiz the corrected fact to justify keeping it.
3. **Quiz.** One open, non-leading question per fact, framed in EDS terms. Questions must not contain the answer.
4. **Recall.** Ask 5-8 models from at least three vendors, once each, no tools, no skill text. Save raw answers. Answers vary between runs, so breadth replaces repeats: a fact is cut only if every model gets it right.
   - The full set in one prompt, no context. Facts visible in the boilerplate (scripts, lint config) are classed `eds` and quizzed the same way; it's open source and documented, so models can learn it; those facts just take longer to be cut.
5. **Score.** Each answer vs. its fact's key point: `correct`, `wrong` (confident and incorrect, incl. stale), `missing` (no answer, vague, or misses the key point). Omitting a minor detail of the claim is still `correct`. Two scorers from different vendors score independently; disagreements go to a human.
6. **Decide.**

| Condition | Decision |
|---|---|
| `generic`, `correct` in all models | cut |
| `eds`, `correct` in all models | cut, unless forgetting it is costly and silent (e.g. unscoped CSS, editing `aem.js`): then keep as a one-line `reminder` |
| `wrong` in any model | keep, state sharply |
| `missing` in any model | keep |

Workflow (step order, when to invoke other skills) isn't recall: no fact, no quiz, never trimmed by this probe. Best practices documented on aem.live are facts: quiz them, with the doc as `verified`. Best-practice opinions found only in the skills aren't quizzed; keep them until the tessl eval, run after all skills' facts are done, shows whether they're still needed.

- Never trim factual content that no fact covers. To trim it, add a fact and quiz it first.
- Trimming a line doesn't remove its fact. Keep it in `facts.json` so a re-run with newer models shows when it should come back.

## Regression check

Before trimming a skill:

1. Write at least one eval scenario aimed at facts the recall quiz showed models get `wrong`, and one at the skill's workflow where that is testable.
2. Run the scenario without the skill first. If the no-skill baseline scores above ~90, rework the scenario until it discriminates; a scenario every model passes can only show nothing broke, not that the skill helps.
3. Use 3 repeats on the skill's own scenarios; single runs swing widely. The shared CI workflow runs once, so run these locally from the plugin directory (`tessl eval run . -n 3`, needs `tessl login` to the `adobe` workspace).

After the trim, run the same eval again and compare with `tessl eval compare <before-run> <after-run> --full`. The trimmed skill should score no lower on the skill's scenarios.

## Files

```
recall/<skill>/
  facts.json          { sourceRef, sourceRoot, facts: [{ id, claim, source, kind, verified, question, quiz? }] }
                      sourceRef: commit the inventory was taken from; source paths (`file:line`) are relative to sourceRoot at that commit
                      kind: eds | generic; all kinds live in one file
                      goal: goals.md entry the fact supports (optional)
                      skillSays: current skill wording where it contradicts the claim (optional)
                      quiz: reason a fact is excluded from the quiz (optional)
  answers/<model>.md  raw model output (gitignored)
  scores.json         { models: [...], facts: { <id>: { <model>: score, decision, note } } } (gitignored)
```

Only `facts.json` is committed. Answers and scores go stale with each model release and are cheap to regenerate; summarize models, totals and per-fact decisions in the PR body.

## Models

5-8 current models from at least three vendors, e.g. `claude-sonnet-5.5`, `gemini-4-argon`, `gpt-6.1-sol`; list the set used in `scores.json` and the PR body. Re-run when models change; cuts that depended on a removed model's recall should be re-checked.
