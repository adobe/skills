# Prototype Guide

Prototypes are **branded, high-fidelity static HTML pages**. They are the user's visual decision-of-record per page, produced and iterated in the browser. Any downstream translation (to EDS CSS, another framework, a design handoff) reads tokens from the prototype.

Prototypes use the same **chassis library** as brand boards, shared at [`../../_shared/chassis/`](../../_shared/chassis/). The chassis is a presentation pattern (nav, hero pattern, eyebrows, spacing, type register, demo style) that is artifact-agnostic — the brand board and the prototype for the same brand typically share a chassis. See [Chassis selection](#chassis-selection) below.

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

- If the briefing's `# Imagery` section provides a `Source hint`, use that asset.
- If it provides style direction only, render a branded placeholder: a rectangle at the right aspect ratio, filled with a brand-tinted gradient or a noise pattern, and labeled with the subject (e.g., "PRODUCT CAPTURE · 16:9").
- Always include alt text — from the briefing if specified, otherwise inferred.

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

---

## Chassis selection

The prototype's chassis is picked in Phase 2 of `prototype/SKILL.md`. Selection order:

1. **Designer override** — if `_divergence.prototype_chassis` is set on `brand-profile.json`, use it. This is the designer saying "the prototype should use a different chassis than the brand board."
2. **Inherit from brand** — if `_divergence.chassis` is set on `brand-profile.json` (picked by the brand skill in Phase 3), use it. This is the default — a brand's prototype shares the brand's chassis for visual coherence.
3. **Fallback** — `classic-archive`.

Record the chosen chassis in the prototype's provenance block: `prototype_chassis: <name> — <reason>` (reason = `designer-override` / `inherited-from-brand` / `fallback`).

The four chassis live at [`../../_shared/chassis/`](../../_shared/chassis/):
- `broadcast-grid.md` — top bar + ticker, multi-pane flat grid, monospace-led
- `classic-archive.md` — editorial long-form, sticky top nav, text-first hero
- `dashboard.md` — fixed sidebar, card-cluster hero, widget demos
- `magazine.md` — masthead + columns, pull quotes, department heads

Read the chosen chassis's full `.md` spec before rendering.

## Prototype section order per chassis

The chassis specifies the presentation pattern; this section specifies which sections a landing page (or any prototype page) typically renders, and in what order, under each chassis. The briefing and `# Copy` sections drive the concrete content — this table only gives the structural ordering.

**broadcast-grid** — multi-pane landing:
Top bar (channel identifier + LIVE indicator + section tabs + clock) → Ticker (key announcements scrolling) → Hero pane (page-title + sub + chip row: LIVE / BATCH / STATUS) → Feed panes 2–3 (tables or compact lists with source labels) → Wide event pane (schedule / timeline with timecodes) → Status strip (4–6 stat callout cells across the bottom) → Compact footer row

**classic-archive** — editorial long-form:
Masthead (page-title + descriptor + metadata) → Argument section (long-form body with italic accents) → Metadata block (specs, provenance, dates) → Dispatch / Process (how the service / product / method works) → Proof (testimonial, quote, or signed letter) → Contact / Reservation (single CTA, no pill row)

**dashboard** — stat-first landing:
Hero cluster (page-title card + live-stat card + identity card + primary-action card) → Feature grid (cards, each a value prop rendered as a widget-like tile) → Live status strip (counters, progress, availability) → Reservation / form card (single-focus CTA inset into the grid) → FAQ tray (compact card list) → Compact footer

**magazine** — magazine landing:
Masthead (page-title + volume-issue-date + kicker) → Contents / Section links (optional) → Feature story (long-form with drop cap + pull quote) → Letter from founder (signed, italic) → Object / Product catalogue (magazine-panel per item) → Photo essay (if imagery is available) → Colophon (dense metadata footer with stock, printer, typography credits)

## Prototype section order · cross-chassis rules

Regardless of chassis:

- **Every prototype has exactly one primary CTA** — the action the briefing declares as the page's reason for being. It appears at least once, in a position appropriate to the chassis (hero pane for broadcast-grid; hero cluster for dashboard; later blocks for classic-archive / magazine).
- **The briefing's `# Copy` drives content selection** — if the briefing doesn't mention "Letter from founder", the magazine chassis doesn't render one. The chassis describes a maximal structure; the briefing prunes it.
- **Motifs and components** from `brand-profile.json` are applied within sections per the chassis's demo style — widgets for dashboard, magazine panels for magazine, live-feed panes for broadcast-grid, inline card grid for classic-archive. Never as a standalone "here are our motifs" section on the prototype — that's a brand-board concern.
- **Variants (from Phase 0)** apply within the chosen chassis. A brand on `magazine` chassis producing two variants might vary the column count (A: 2-column, B: 3-column) or the pull-quote style, but both stay magazine. Switching chassis mid-variant is a separate explicit override.
