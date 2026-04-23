# Eval: briefing generated from a one-line prompt

## Setup

Project with no `aem-design/` folder yet. No brand-profile.json.

## User prompt

"Write a briefing for a landing page that convinces VCs to fund our seed round."

## Expected behavior

The `briefings` skill is invoked. It:

1. Does NOT block on missing brand — it uses the soft-gate synthesis path.
2. Produces `aem-design/briefings/landing.md` (or a similarly named file).
3. The briefing has sections for Intent, Audience, Key Messages, CTAs, Tone, and optional Copy/Imagery hints.
4. The briefing has a provenance stamp noting that brand was synthesized (since brand-profile.json is absent).
5. If the superpowers plugin is absent, the skill announces exactly once per session that it is using the inline fallback-brainstorm interview pattern.
6. Does NOT write brand-profile.json or any other skill's artifacts.
