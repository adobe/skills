# Eval: branded prototype + one iteration cycle

This eval runs two scenarios. Both start from the same project setup; they differ in whether the user asks for a single prototype or a set of variants.

## Setup

Project contains:

- `stardust/brand-profile.json` with a concrete palette (one primary, one accent, neutrals), one heading font, one body font, and a voice rubric.
- `stardust/briefings/landing.md` with sections Intent, Audience, Key Messages, CTAs, and a `# Copy` subsection for hero headline and sub-headline.

No `stardust/prototypes/` folder yet.

---

## Scenario A — Single variant

### User prompt (turn 1)

"Build the landing prototype."

When the skill asks how many variants, the user answers **"1"** (or the skill's default of 1 is accepted).

### User prompt (turn 2, after the prototype is shown)

"Headlines feel too heavy — make them lighter and a touch smaller, and give the hero more breathing room."

### Expected behavior

Turn 1: The `prototype` skill is invoked. It:

1. Asks the user how many variants they want (Phase 0), then proceeds.
2. Produces `stardust/prototypes/landing.html` — self-contained, branded (brand palette + fonts), desktop fidelity.
3. Uses the briefing's `# Copy` values verbatim for the hero headline/sub-headline.
4. Exposes design tokens as CSS custom properties in `:root`.
5. Preserves or adds `data-section` / `data-intent` attributes per section.
6. No dev-server references; opens directly in a browser.

Turn 2: The same skill re-activates and:

7. Updates `--heading-weight` (or equivalent) and `--heading-scale` downward.
8. Updates hero section padding / `--section-padding`.
9. Does NOT rewrite the briefing copy.
10. Does NOT edit `brand-profile.json` (the change is prototype-local).

---

## Scenario B — Multi-variant

### User prompt (turn 1)

"Build the landing prototype. Give me 3 variants to choose from."

### User prompt (turn 2, after the variants are shown)

"Let's go with variant B. Headlines there feel too heavy — make them lighter and a touch smaller, and give the hero more breathing room."

### Expected behavior

Turn 1: The `prototype` skill is invoked. It:

1. Acknowledges the requested variant count (3) and proceeds without re-asking.
2. Produces three files: `stardust/prototypes/landing-a.html`, `landing-b.html`, `landing-c.html` — each self-contained, branded, desktop fidelity.
3. Each variant carries a `variant_direction` line in its provenance block naming a distinct design direction (e.g. "editorial, Fraunces-forward, quiet" / "software-catalog, Inter-dense" / "consumer-warm, photography-heavy"). Directions differ on load-bearing axes, not cosmetic tweaks.
4. All variants use the briefing's `# Copy` values verbatim — variants share copy and differ in design.
5. Presents a short comparison table to the user and asks which variant to take forward.

Turn 2: The same skill re-activates and:

6. Iterates **only** on `landing-b.html`. `landing-a.html` and `landing-c.html` are untouched (mtimes unchanged, no overwrites).
7. Updates `--heading-weight` / `--heading-scale` downward and hero `--section-padding` upward in `landing-b.html`.
8. Does NOT rewrite the briefing copy.
9. Does NOT edit `brand-profile.json`.
