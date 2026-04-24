# Fallback: Brainstorm / Discovery

Inline substitute for `/brainstorm` from the `superpowers` plugin. Produces a lighter discovery pass — enough to unblock a stage, not as thorough as the real thing.

## When to use

When a skill (`brand`, `briefings`, `wireframes`, `prototype`) needs to discover user intent but `/brainstorm` is not available.

## Interview shape

Ask **one question at a time.** Prefer multiple-choice over open-ended when possible. Close the loop with a synthesized summary the user can accept, amend, or reject.

### For `brand` discovery (no URL/PDF)

1. *"In one sentence: what does your brand stand for?"*
2. *"Which of these best describes your visual feel? (A) minimal/editorial (B) bold/expressive (C) warm/human (D) technical/utilitarian (E) something else — describe"*
3. *"Which of these best describes your voice? (A) direct/no-nonsense (B) warm/conversational (C) authoritative/expert (D) playful/irreverent (E) something else — describe"*
4. *"Do you have brand colors or fonts in mind? (if yes, list them; if no, I'll suggest a palette)"*

Synthesize: a neutral `brand-profile.json` with the user's answers informing `philosophy`, `visualStyle.feel`, `voice.tone`, and (when provided) `colorPalette` and `typography`. Stamp provenance per `skill-contract.md`.

### For `briefings` discovery (no brief provided)

1. *"Which page should we plan first? (if multi-page site: home / about / services / contact / other — pick one)"*
2. *"In one sentence: what should this page accomplish for the visitor?"*
3. *"Who is the visitor? (one-line persona)"*
4. *"What's the one action you most want them to take?"*
5. *"Do you have copy already, or should I draft on-brand placeholders?"*

Synthesize: a briefing at `stardust/briefings/{page}.md` with sections `# Intent`, `# Audience`, `# Key CTA`, and either `# Copy` (when provided) or no `# Copy` section (synthesis downstream).

### For wireframe section planning

When `wireframes` would normally delegate section planning to `/shape`:

1. *"What are the 3–6 sections this page needs? (list them, or say 'suggest')"*
2. For each section: *"What's this section's job — inform, persuade, convert, reassure?"*

Map each answer to a `data-section` name and `data-intent` attribute on the wireframe.

### For `prototype` iteration discovery

When the user says something vague like *"this feels off"* and no peer is available:

1. *"What's the one thing that feels most off? (A) type sizes or hierarchy (B) spacing or density (C) color or contrast (D) copy tone (E) component styling (buttons, borders) (F) something else"*
2. *"Is it too much of something, or too little? (bolder/quieter/other)"*

Map the answer to the appropriate edit (heading scale, section padding, accent color swap, etc.) and re-render.

## Rules

- **One question per message.** Do not batch.
- **Default + opt-out.** Always offer a default the user can accept with *"yes"* or *"proceed"*.
- **No blocking.** The skill's soft-gate model says missing inputs become synthesized with provenance. Fallback discovery is *best-effort* — if the user wants to skip, proceed with sensible defaults and stamp provenance.
- **Announce once per session** (not per fallback call) per `soft-deps.md` policy.
