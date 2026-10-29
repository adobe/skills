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
5. **Score.** Each answer vs. its fact: `correct`, `wrong` (confident and incorrect, incl. stale), `missing` (no answer, vague, or partial).
6. **Decide.**

| Condition | Decision |
|---|---|
| `generic` or `repo` | cut |
| `eds`, `correct` in all models | cut |
| `eds`, `wrong` in any model | keep, state sharply |
| `eds`, `missing` in 2+ models | keep |
| otherwise | judgement, note why |

Facts that steer workflow (step order, when to invoke other skills) aren't recall; the tessl regression eval covers those.

## Files

```
recall/<skill>/
  facts.json        [{ id, claim, source, kind, verified, question }]
  answers/<model>.md  raw model output
  scores.json       { models: [...], facts: { <id>: { <model>: score, decision, note } } }
```

## Models

`claude-sonnet-5.5`, `gemini-4-argon`, `gpt-6.1-sol`. Re-run when models change; cuts that depended on a removed model's recall should be re-checked.
