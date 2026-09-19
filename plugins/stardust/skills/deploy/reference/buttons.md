# Step 5 — Lean on EDS button conventions (full text)

Full text of deploy Step 5. Read:
- § 5 — before styling any CTA: what `decorateButtons()` emits (the markup → class table) and its two decode caveats;
- § Global button CSS — when restyling the boilerplate button rules in `styles/styles.css`;
- § Surface-aware variants — for any CTA on a dark block (#41);
- § Block JS — move the CTA paragraph — before writing a block that lays out CTAs (EW3);
- § When NOT to use the convention and § Multi-variant button systems — when a link is not a button, or the prototype has more than three variants (#25).

## 5. Lean on EDS button conventions — DO NOT manufacture button anchors in block JS

The boilerplate's `decorateButtons()` (in `scripts/scripts.js`) applies button classes when authors wrap a link in inline emphasis (D6). It runs in `decorateMain()`, BEFORE any block's `decorate()` — so by the time block JS sees a cell, its anchors already carry the button classes. Block JS **MOVES the CTA's paragraph** — `actions.append(a.closest('p') || a)` — never clones it: the index the workspace's inline editor keys on sits on the `<p>`, not the `<a>` (EW3), and a `cloneNode`/childNodes copy leaves the authored paragraph behind, dead. The `.button.*` classes die while editing; the foundation's edit-mode repaint (Step 3 (a)) covers that.

**Author markup → auto-applied class (current `adobe/aem-boilerplate` main — confirm per target in `runtime-contract.json`, older clones differ):**

| Author markup | Class applied | Visual |
|---|---|---|
| `<strong><a>` | `a.button.primary`, parent `p.button-wrapper` | brand fill |
| `<em><a>` | `a.button.secondary`, parent `p.button-wrapper` | transparent + outline (color-aware) |
| `<em><strong><a>` | `a.button.accent`, parent `p.button-wrapper` | high-impact CTA — sparingly |
| bare `<a>` alone in a `<p>` | nothing (current main requires emphasis) | plain link |

Two decode caveats: the decorator only matches `p a[href]` — a CTA must be paragraph-wrapped and alone in its paragraph (the ENCODE side already does this); and it REPLACES the emphasis tag with the classed anchor, so block JS must never assume a surviving `<strong>`/`<em>` wrapper — detect CTAs by `a.button` first, emphasis-wrapped `<a>` as the fallback for un-decorated shapes.

## Global button CSS

**Restyle the boilerplate's button rules in `styles/styles.css`** (keep its selectors, replace the demo paint with the brand system):

```css
a.button:any-link, button.button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 16px 26px;
  font-size: 12px;
  font-weight: var(--weight-bold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid transparent;
  transition: background 0.25s var(--ease-out), color 0.25s var(--ease-out), border-color 0.25s var(--ease-out);
}

a.button.primary { background: var(--color-wavelength); color: var(--color-ink-rich); border-color: var(--color-wavelength); }
a.button.primary:hover { background: var(--color-canvas); border-color: var(--color-canvas); }

a.button.secondary { background: transparent; color: currentcolor; border-color: rgb(255 255 255 / 40%); }
a.button.secondary:hover { border-color: currentcolor; background: rgb(255 255 255 / 5%); }

/* On light surfaces, secondary uses dark-tinted outline. List the dark sections explicitly. */
main .section:not(.dark, .closing, .hero, .team) a.button.secondary { border-color: var(--color-rule-strong); color: var(--color-ink-rich); }
main .section:not(.dark, .closing, .hero, .team) a.button.secondary:hover { border-color: var(--color-ink-rich); }

/* Trailing arrow on primary/accent. */
a.button.primary::after, a.button.accent::after { content: "→"; font-weight: 600; transition: transform 0.3s var(--ease-out); }
a.button.primary:hover::after, a.button.accent:hover::after { transform: translateX(4px); }

p.button-wrapper { display: inline-flex; flex-wrap: wrap; gap: 16px; align-items: center; margin: 0; }
```

(Adjacent CTAs land in separate `p.button-wrapper`s — one per authored paragraph — so group spacing rides the wrappers' shared flex row inside the block's `.actions` container, not a single group element.)

## Surface-aware variants (#41)

**Surface-aware variants: scope to the BLOCK class, not just the section (#41).** When a button/link/text treatment differs on dark vs light surfaces, the prototype's dark-surface cue (e.g. `.hero`, `.cta-dark`) becomes a **block class** after conversion — a `<div class="hero block">` nested inside the `<div class="section">`. So an override written as `main .section.hero a.button.secondary` never matches (the `.hero` is one level below `.section`), and the on-dark CTA silently renders dark-on-dark. Scope on-dark overrides to BOTH: `main .section.dark a.button.secondary, main .hero a.button.secondary { … }`. QA any block on a dark background for secondary/ghost-CTA contrast (light outline + light text) — the button "exists" in metrics, so only contrast/eyeball catches this.

## Block JS — move the CTA paragraph (EW3)

**Block JS pattern — MOVE the CTA paragraphs (EW3):**

```js
// Get the cell that holds the CTAs
const ctaCell = rows[N]?.firstElementChild;
if (ctaCell && ctaCell.querySelector('a')) {
  const actions = document.createElement('div');
  actions.className = 'actions';
  // the workspace's editor index is on the <p>, so move the paragraph, not the anchor;
  // capture the list BEFORE moving (append() ends a live sibling walk — EW1)
  [...ctaCell.querySelectorAll('a')].forEach((a) => actions.append(a.closest('p') || a));
  container.append(actions);
}
```

Never `cloneNode(true)` the anchor or copy `childNodes` — the clone renders identically and is dead in Experience Workspace (the authored `<p>` carrying `data-prose-index` was discarded). When the block itself needs a variant class on the CTA (#25 multi-variant systems), put it on the `.actions` wrapper and style `.actions.ghost a`, not on the authored anchor.

DO NOT manufacture anchors with `cta.className = 'btn-loud'` or inject custom SVG arrows. The global `::after` arrow + the convention's class system handle 95% of cases.

**Block CSS pattern — only override what's actually different:**

The `closing` block's CTA is slightly larger than the global default. That's a legitimate override:

```css
.closing .actions a.button.primary { padding: 22px 32px; font-size: 13px; }
```

Three lines. Targets the global class, not a custom one. This is the entire "blocks slightly augment defaults" pattern.

## When NOT to use the convention

**When NOT to use the convention:**

Some links are NOT buttons. Examples:
- A wavelength-underlined text link in a section footer ("How we work →"). It's a styled text link, not a chip.
- Whole-card anchors on tile grids (`<a class="tile">…</a>`). The whole tile is the click target.
- Channel values in a closing CTA (`<a href="tel:…">801-363-0101</a>`). It's a value, not a CTA.
- `mailto:` / `tel:` links inside prose.

For these: the author leaves the `<a>` as a plain anchor in content (no `<strong>` / `<em>` wrap), and the owning block styles it with per-block CSS. The convention is for buttons; if it's not a button, don't apply it.

## Multi-variant button systems (#25)

**Multi-variant button systems (#25).** The strong/em convention only names three slots (primary / secondary / accent — and D6 says needing more usually means a design-system decision was wrongly delegated to authors, so first try to consolidate). When a prototype genuinely has **more** context-specific variants — e.g. an airport prototype's `.btn--accent` (yellow), `.btn--primary` (blue), `.btn--ghost` (outline), `.btn--onblue` (white-on-blue) — author emphasis can't express them. Don't force it: **lift the prototype's full button-variant system into `styles/styles.css`** (keeping the prototype's own class names), author the CTAs as plain `<a>` in content, and have each block apply the right variant class to the cloned anchor (the block knows its section's variant — the choice stays with the design system, not the author). This is the same "if it doesn't fit, style it" escape hatch, applied at the button-system level rather than per-link.
