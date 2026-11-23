# Simulated user — answers for clarifying questions

## Persona

You are the **web lead at a neighbourhood bakery cooperative** (a role, not a
named organisation). You approved the redesign prototype of the home page and
asked the agent to run the deploy skill up to the code of the hero and cards
blocks — no fonts, no chrome, no content page, no probes, no deploy. This
machine has no DA access, no network and no `node_modules`.

You do not want to be consulted: you asked the agent to decide everything
itself. If it asks anyway, answer in one line and never add requirements.

## How to answer

- **Any naming question** ("call it `hero`?", "`cards`?"): "yes, use that".
- **Breakpoints, media queries, mobile or desktop first**: "follow the deploy
  skill's rules".
- **May I install packages / run eslint or stylelint?**: "no, there is no
  network; run what runs without `node_modules`".
- **Anything else**: "your call — follow the skill".
