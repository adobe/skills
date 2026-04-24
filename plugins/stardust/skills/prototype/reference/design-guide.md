# Prototype Guide

Prototypes are **branded, high-fidelity static HTML pages**. They are the user's visual decision-of-record per page, produced and iterated in the browser. Any downstream translation (to EDS CSS, another framework, a design handoff) reads tokens from the prototype.

## Fidelity Target

- **Desktop-first** at 1440px. Mobile and tablet are *not* required at this stage — they're derived from the approved desktop scale by the downstream implementation.
- **Real fonts** (web fonts imported), **real colors** (brand profile), **real copy** (briefing `# Copy` verbatim where present).
- **Real images** where the briefing provides a source hint; branded placeholders otherwise.

## HTML Structure

Each design is a self-contained HTML file with embedded CSS. No external JS. External font + image URLs are fine.

Preserve the wireframe's data attributes if a wireframe exists:

```html
<section data-section="hero" data-intent="emotional hook" data-layout="full-bleed">
  ...
</section>
```

If no wireframe exists, set these attributes based on the briefing + `/impeccable shape` output.

## The `:root` Token Block

Every prototype's `<style>` block must start with a `:root` block exposing desktop tokens. These are the authoritative values any downstream translation (e.g., EDS CSS, framework component library) will extract:

```css
:root {
  --heading-font-family: 'Brand Heading', serif;
  --body-font-family: 'Brand Body', sans-serif;

  --heading-xxl: 72px;
  --heading-xl: 56px;
  --heading-lg: 40px;
  --heading-md: 28px;
  --body: 18px;
  --body-sm: 15px;

  --line-height-heading: 1.1;
  --line-height-body: 1.55;

  --color-bg: #...;
  --color-fg: #...;
  --color-accent: #...;

  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 48px;
  --spacing-2xl: 96px;

  --section-padding: 96px;
  --max-width: 1200px;
  --radius: 8px;
}
```

Use these custom properties everywhere in the rest of the stylesheet. That keeps the design scannable and the downstream extraction reliable.

## Brand Fidelity

- Pull colors from `brand-profile.json` color roles — don't re-invent.
- Match the brand's `componentStyle.borderRadius.default`.
- Match the brand's button patterns verbatim (fill, text, border, radius, padding, font-family, weight).
- Apply brand motifs (e.g., strike-through rewrites, dashed dividers, tool-logo walls) where the briefing intent calls for them.
- Respect `.impeccable.md` rules — one joke per screen, deadpan, no AI tells, etc.

## Copy

- If the briefing's `# Copy` section has an entry for a section, use that text **verbatim**. Do not rewrite it.
- For sections without `# Copy`, generate copy following `brand-profile.json` voice (do/don't examples, banned words, tone rules).
- Never fill with Lorem ipsum. Generated placeholder copy should still sound like the brand.

## Imagery

Three paths, in priority order:

**(a) Briefing source hint.** If the briefing's `# Imagery` section provides a `Source hint` (a path to a real asset the designer already has), use that asset directly. Always highest priority.

**(b) Branded placeholder.** If the briefing gives style direction only (or nothing), and the designer chose `imagery_mode: placeholder` at Phase 0b (the default), render a branded placeholder: a rectangle at the right aspect ratio, filled with a brand-tinted gradient or a noise pattern, and labeled with the subject (e.g., `"PRODUCT CAPTURE · 16:9"`). Zero network, zero cost, fast iteration.

**(c) Generated image.** If the designer chose `imagery_mode: generated` at Phase 0b and provided a model + credential, invoke the `ai-image-generator` skill (from `eds-site-builder`, `sumi`, or `testing` plugin) with:
  - The section's `# Imagery` direction from the briefing
  - The brand's `photography.style` and `photography.rules` from `brand-profile.json`
  - The target aspect ratio for the section's image slot
  - The provider and credential captured in Phase 0b

Generated images land at `stardust/prototypes/images/{page}-{section}.png`. The prototype HTML `<img src>` points at the relative path. Cache by prompt hash to avoid regenerating on iterations — if the hash matches a previous run, reuse the cached image.

**Fallback** when path (c) fails: retry once with a simplified prompt, then fall back to path (b) for that slot only and stamp `imagery_fallback: true` in the provenance block. Never abort the whole page render over one failed image.

**Alt text** is always included, regardless of path:
- From the briefing's `# Imagery` section if specified
- Otherwise inferred from the subject label and section intent
- Never the word "image" or "photo" as the whole alt — describe the subject

See `prototype/SKILL.md` Phase 0b for how imagery mode is chosen per session.

## Iteration

Designs are rendered to be **edited in place**. When the user gives feedback:
- Change `:root` values for global tweaks (type scale, spacing, radius).
- Change per-section styles for local tweaks.
- Re-render the file and refresh the browser.

Keep the file self-contained — avoid inventing external dependencies that make iteration slower.

## What NOT to Include

- No JavaScript (except what's needed for a specific demo; keep it inline and minimal).
- No EDS block structures (`block.js`, section metadata tables). Those are the job of a downstream EDS build, not the prototype.
- No mobile breakpoints. Desktop only at this stage.
- No `@media print` or other edge cases. Focus on the primary viewing experience.

## Landing-page section rules

Regardless of visual direction, every prototype landing page obeys:

- **Every prototype has exactly one primary CTA** — the action the briefing declares as the page's reason for being.
- **The briefing's `# Copy` drives content selection** — sections the briefing doesn't mention are not invented.
- **Motifs and components** from `brand-profile.json` are applied within sections, never as a standalone "here are our motifs" section on the prototype (that's a brand-board concern).
- **Variants (from Phase 0)** differ on design-direction axes (type-voice, density, color-energy, imagery-role) chosen per the brand's load-bearing dimensions. Variants share the same briefing copy and brand tokens; they explore the same page with different emphasis.
