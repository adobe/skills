# Eval: briefing generated from a one-line prompt

## Setup

Project with no `stardust/` folder yet. No brand-profile.json.

## User prompt

"Write a briefing for a landing page that convinces VCs to fund our seed round."

## Expected behavior

The `briefings` skill is invoked. It:

1. Does NOT block on missing brand — it uses the soft-gate synthesis path.
2. Does NOT ask the user to pick a fidelity level (prompt-only / structured / full). It emits the structured shape directly.
3. Produces `stardust/briefings/landing.md` (or a similarly named file).
4. The briefing contains all five structured sections — Intent, Audience, Key Messages, Calls to Action, Tone — with `[TBD]` written verbatim in any section the user did not commit to. `# Copy` and `# Imagery` are added only if the user provided final words or image direction.
5. The briefing has a provenance stamp noting that brand was synthesized (since brand-profile.json is absent) and naming which sections are `[TBD]` for downstream synthesis.
6. Soft-deps honored: either `/brainstorm` was invoked with a visible hand-off (superpowers installed), or the superpowers fallback announcement appeared exactly once and the inline interview ran.
7. Does NOT write brand-profile.json or any other skill's artifacts.
