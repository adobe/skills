# Eval: branded prototype + one iteration cycle

## Setup

Project contains:

- `aem-design/brand-profile.json` with a concrete palette (one primary, one accent, neutrals), one heading font, one body font, and a voice rubric.
- `aem-design/briefings/landing.md` with sections Intent, Audience, Key Messages, CTAs, and a `# Copy` subsection for hero headline and sub-headline.

No `aem-design/prototypes/` folder yet.

## User prompt (turn 1)

"Build the landing prototype."

## User prompt (turn 2, after the prototype is shown)

"Headlines feel too heavy — make them lighter and a touch smaller, and give the hero more breathing room."

## Expected behavior

Turn 1: The `prototype` skill is invoked. It:

1. Produces `aem-design/prototypes/landing.html` — self-contained, branded (brand palette + fonts), desktop fidelity.
2. Uses the briefing's `# Copy` values verbatim for the hero headline/sub-headline.
3. Exposes design tokens as CSS custom properties in `:root`.
4. Preserves or adds `data-section` / `data-intent` attributes per section.
5. No dev-server references; opens directly in a browser.

Turn 2: The same skill re-activates and:

6. Updates `--heading-weight` (or equivalent) and `--heading-scale` downward.
7. Updates hero section padding / `--section-padding`.
8. Does NOT rewrite the briefing copy.
9. Does NOT edit `brand-profile.json` (the change is prototype-local).
