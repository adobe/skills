# Mobile nav collapse

The stock pattern stardust applies during `$impeccable adapt` (Phase 2.7)
when the header's horizontal nav cannot survive a 360px viewport. The
adapt step's audit refuses files that overflow, shrink nav type below
11px, or compress nav gap below 10px; this doc is the canonical
remediation the agent reaches for. Alternative patterns are
available on request (§ Alternative patterns).

## Why this exists

Captured site chrome typically carries 4–6 nav links plus a wordmark
plus a cart/account affordance. At desktop this fits; at 360px–430px
the nav competes with the wordmark for horizontal space. Two failure
modes recurred across brands before this pattern existed:

1. The adapt pass shrank `nav` font-size and `gap` until the row
   fit. The shrunk nav became unreadable (font ~9–10px, gaps 8–10px).
2. Some sites still horizontally overflowed despite the shrink. A
   real instance: the Wasatch Back Beerworks prototype derived from
   birrificiolambrate.com — header content totaled ~447px inside a
   430px viewport even after font and gap reductions, leaving a
   visible empty column.

Both are pipeline bugs, not site bugs. They recur on every brand
with a moderately-sized nav. This pattern centralises the fix.

## When this applies

`$impeccable adapt`, invoked from `stardust:prototype` Phase 2.7,
runs the Mobile-adapt audit (see `skills/prototype/SKILL.md`
§ Mobile-adapt audit). The audit refuses the file when, at 360px:

- A landmark causes `scrollWidth > clientWidth` on
  `document.documentElement` or `document.body`
  (`audit/responsive: horizontal-overflow-at-360px`).
- A `<nav>` descendant inside `<header>` has computed `font-size`
  below 11px (`audit/responsive: nav-readability-floor`).
- A flex/grid `<nav>` inside `<header>` has computed `gap` (or
  `column-gap`) below 10px (`audit/responsive: nav-readability-floor`).

On any refusal, the agent injects the stock pattern below into
the file, marks the header with `data-nav-collapse="hamburger"`,
and re-runs the audit. If the audit then passes, the run
continues. If it still fails (e.g. the wordmark itself is wider
than 360px), the agent surfaces the residual finding and waits
for direction. If the user wants a different collapse pattern,
they ask in chat and the agent reaches for an alternative
(§ Alternative patterns) — there is no flag to bypass the
auto-apply.

## The stock pattern

A CSS-only `<input type="checkbox">` + `<label for>` toggle plus a
≤10-line inline `<script>` that syncs `aria-expanded` and wires
Escape-to-close. Self-contained, no framework, no external CSS.

### HTML

The `<header>` carries `data-nav-collapse="hamburger"` so downstream
consumers (the audit re-run, future migrate steps) can detect the
pattern is already applied:

```html
<header data-section="header"
        data-intent="navigation"
        data-layout="contained"
        data-nav-collapse="hamburger">
  <a class="ds-wordmark" href="/">Brand</a>

  <input type="checkbox" id="ds-nav-toggle" class="ds-nav-toggle">
  <label class="ds-nav-burger"
         for="ds-nav-toggle"
         role="button"
         tabindex="0"
         aria-controls="ds-nav-list"
         aria-expanded="false">
    <span class="ds-nav-burger-icon" aria-hidden="true"></span>
    <span class="ds-nav-burger-label">Menu</span>
  </label>

  <nav id="ds-nav-list" class="ds-nav" aria-label="Main">
    <a href="/products">Products</a>
    <a href="/about">About</a>
    <a href="/visit">Visit</a>
    <a href="/contact">Contact</a>
  </nav>
</header>

<script>
(() => {
  const t = document.getElementById('ds-nav-toggle');
  const b = document.querySelector('.ds-nav-burger');
  if (!t || !b) return;
  const sync = () => b.setAttribute('aria-expanded', t.checked);
  t.addEventListener('change', sync); sync();
  addEventListener('keydown', e => { if (e.key === 'Escape' && t.checked) { t.checked = false; sync(); b.focus(); } });
})();
</script>
```

### CSS

The pattern reads tokens from the page's `:root` block (see
`skills/stardust/reference/token-contract.md`) and falls back to
system values for any token a project hasn't defined.

```css
/* Header positioning anchor for the slide-down panel */
header[data-nav-collapse="hamburger"] {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md, 16px);
}

/* The checkbox is the state holder; never visible */
.ds-nav-toggle {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* Above 640px: horizontal nav, no burger */
.ds-nav-burger {
  display: none;
}
.ds-nav {
  display: flex;
  align-items: center;
  gap: var(--spacing-md, 16px);
  font-family: var(--body-font-family, system-ui, sans-serif);
}
.ds-nav a {
  color: var(--color-fg, #111);
  text-decoration: none;
  font-size: var(--body, 1rem);
}

@media (max-width: 640px) {
  /* Show burger button */
  .ds-nav-burger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    padding: 10px 14px;
    font-family: var(--body-font-family, system-ui, sans-serif);
    font-size: var(--body-sm, 0.9375rem);
    color: var(--color-fg, #111);
    background: transparent;
    border: 1px solid currentColor;
    border-radius: var(--radius, 8px);
    user-select: none;
  }
  .ds-nav-burger-icon {
    width: 16px;
    height: 12px;
    position: relative;
  }
  .ds-nav-burger-icon::before,
  .ds-nav-burger-icon::after {
    content: "";
    position: absolute;
    left: 0; right: 0;
    height: 2px;
    background: currentColor;
  }
  .ds-nav-burger-icon::before { top: 0; }
  .ds-nav-burger-icon::after  { bottom: 0; }

  /* Slide-down panel — full-width, anchored to header bottom */
  .ds-nav {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    padding: var(--spacing-md, 16px);
    background: var(--color-bg, #fff);
    border-top: 1px solid var(--color-fg, #111);
    transform: translateY(-8px);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: transform var(--dur-state, 180ms) var(--ease-snap, cubic-bezier(0.2, 0, 0, 1)),
                opacity   var(--dur-state, 180ms) var(--ease-snap, cubic-bezier(0.2, 0, 0, 1)),
                visibility 0s linear var(--dur-state, 180ms);
  }
  .ds-nav a {
    padding: 12px 0;
    font-size: var(--body, 1rem);
    border-bottom: 1px solid color-mix(in srgb, var(--color-fg, #111) 12%, transparent);
  }
  .ds-nav a:last-child { border-bottom: 0; }

  /* Open state — sibling selector off the checkbox */
  .ds-nav-toggle:checked ~ .ds-nav {
    transform: translateY(0);
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition: transform var(--dur-state, 180ms) var(--ease-snap, cubic-bezier(0.2, 0, 0, 1)),
                opacity   var(--dur-state, 180ms) var(--ease-snap, cubic-bezier(0.2, 0, 0, 1)),
                visibility 0s linear 0s;
  }

  /* Focus-visible — brand accent for the focus ring */
  .ds-nav-burger:focus-visible {
    outline: 2px solid var(--color-accent, #f4c01b);
    outline-offset: 2px;
  }
  .ds-nav a:focus-visible {
    outline: 2px solid var(--color-accent, #f4c01b);
    outline-offset: 2px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ds-nav,
  .ds-nav-toggle:checked ~ .ds-nav {
    transition: none;
  }
}
```

Only `transform`, `opacity`, and `visibility` are animated — no
layout properties — per impeccable's motion rules.

## Source order (load-bearing)

The base `.ds-nav-burger { display: none; ... }` block **must
precede** the `@media (max-width: 640px) { ... }` block that flips
it to `display: inline-flex`. Same selector, same specificity →
the later declaration wins. If the base is appended *after* the
media query, the burger stays hidden at every viewport, no
warning, no error — the file silently regresses to the bare-nav
failure mode this whole pattern exists to fix.

Place the stock pattern's CSS at the **top of the stylesheet**,
right after the `:root` token block and before any existing
`@media` rules. Concretely:

```
<style>
  :root { ... }                       /* tokens */
  /* === Stock mobile-nav-collapse pattern === */
  header[data-nav-collapse="hamburger"] { ... }
  .ds-nav-toggle { ... }
  .ds-nav-burger { display: none; ... }     /* base — first */
  .ds-nav { ... }
  /* ...component styles for the rest of the page... */
  @media (max-width: 640px) { ... }         /* override — later */
  @media (prefers-reduced-motion: reduce) { ... }
</style>
```

When `$impeccable adapt` injects the stock pattern, it must place
the base rules above the file's existing `@media` rules — not at
the bottom of the `<style>` block where most agents would
naturally append.

### Post-injection grep check

After injection, the agent runs this one-shot check to confirm
ordering. Exit 0 = correct, exit 1 = base appears after the media
query (regression):

```bash
awk '
  /@media[[:space:]]*\(max-width:[[:space:]]*640px\)/ && !media_line {
    media_line = NR
  }
  /\.ds-nav-burger[[:space:]]*\{/ && depth == 0 && !base_line {
    base_line = NR
  }
  /\{/ { depth += gsub(/\{/, "{") }
  /\}/ { depth -= gsub(/\}/, "}") }
  END {
    if (!base_line)  { print "MISSING base .ds-nav-burger rule";          exit 1 }
    if (!media_line) { print "MISSING @media (max-width: 640px) rule";    exit 1 }
    if (base_line > media_line) {
      print "WRONG ORDER: base at line " base_line ", @media at " media_line
      print "Base must appear BEFORE the media query — same specificity = later wins."
      exit 1
    }
    print "OK: base at " base_line ", @media at " media_line
  }
' "$file"
```

Run this as the last step of the injection. A failure here means
the agent placed the base block in the wrong spot — fix the
ordering and re-run rather than shipping a silently-regressed
file.

Caught during manual dogfood on
`stardust/prototypes/home-proposed-C2.html` (greenfield-beermaker)
where an early draft appended the base block after the media
queries and the burger never appeared at 360px. The audit's
overflow check would still fail in that case (the bare nav still
overflows), but the operator wastes a cycle diagnosing what
should be a deterministic ordering bug.

## Token inheritance

The pattern reads the following from the page's `:root` block. Every
reference includes a fallback so the pattern stays self-sufficient
when a project hasn't declared the token.

| Token                   | Fallback                         | Where used                |
|-------------------------|----------------------------------|---------------------------|
| `--color-bg`            | `#fff`                           | Open-panel background     |
| `--color-fg`            | `#111`                           | Nav link, divider, border |
| `--color-accent`        | `#f4c01b`                        | Focus ring                |
| `--body-font-family`    | `system-ui, sans-serif`          | Nav + burger label        |
| `--body`                | `1rem`                           | Nav link size             |
| `--body-sm`             | `0.9375rem`                      | Burger label size         |
| `--spacing-md`          | `16px`                           | Panel padding, header gap |
| `--radius`              | `8px`                            | Burger button corner      |
| `--dur-state`           | `180ms`                          | Open/close transition     |
| `--ease-snap`           | `cubic-bezier(0.2, 0, 0, 1)`     | Open/close easing         |

`--dur-state` and `--ease-snap` are **not** in the stardust `:root`
token contract — they are inherited from impeccable's motion
defaults when present, and the inline fallback covers the case
where they aren't.

## Accessibility checklist

The stock pattern satisfies:

- **Labelled control.** The visible burger (`<label>`) is associated
  with the state checkbox via `for="ds-nav-toggle"`. Click and
  keyboard activation both toggle the checkbox.
- **`aria-controls`.** The label points at the nav list ID
  (`aria-controls="ds-nav-list"`) so assistive tech can announce
  the controlled region.
- **`aria-expanded`.** Synced to the checkbox's `:checked` state by
  the inline script. Without the script the attribute would never
  update; documented as the rationale for bending the no-JS
  preference here.
- **Focus visible.** The burger and every nav link have a brand
  `--color-accent` focus ring; `:focus-visible` so keyboard users
  see it and pointer users don't.
- **Keyboard escape.** Pressing Escape while the menu is open
  closes it and returns focus to the burger button (≤3 lines of
  the inline script).
- **Reduced motion.** `@media (prefers-reduced-motion: reduce)`
  drops the transition.
- **Tab order.** Wordmark → burger label → (open) nav items. The
  hidden checkbox is not focusable (visually-hidden + label
  delegation).
- **No focus trap leak.** The pattern doesn't trap focus inside the
  open panel — Tab continues into the rest of the page. This is
  deliberate; trapping focus requires more JS and complicates the
  static contract. A future variant can add a trap if needed for
  modal-style behavior.

## When to reach for an alternative

If the brand calls for a non-hamburger pattern (priority+overflow,
bottom nav, bespoke drawer), the user says so in chat and the
agent applies that instead. See § Alternative patterns below for
the vocabulary. The agent records the choice in
`_provenance.adapt[]` as `navCollapse: <pattern> (chat-requested)`
so downstream consumers see the deliberate substitution.

There is no flag to bypass the auto-apply. If a project is
desktop-only by design and the audit refusal is acceptable, the
user edits `_provenance.adapt[]` to record
`adapt: deliberately desktop-only (<reason>)` — the explicit
acknowledgement satisfies the downstream gates without lowering
the bar by default.

## Alternative patterns (not stocked)

The stock template is the **default**. Other collapse patterns are
valid and have their place, but stardust doesn't auto-apply them —
the agent reaches for them only when the user asks. They're listed
here so the agent has a vocabulary to suggest when the stock pattern
doesn't fit.

### Priority + overflow

The nav keeps the top N items horizontally and pushes the rest
behind a "More" trailing button that opens a small dropdown. Works
well when there's a clear primary-vs-secondary order in the nav
items and a strong reason to keep the visible items inline.
Costs more CSS than the stock pattern and needs JS to compute the
overflow boundary on resize. Not stocked because the boundary
computation has no idiomatic CSS-only equivalent.

### Bottom nav

A fixed-position nav band at the bottom of the viewport carrying
3–5 top-level icons. App-shell territory; appropriate for sites
designed around frequent navigation (e-commerce, news indexes).
Costs a permanent ~56px of viewport. Not stocked because it changes
the page's information architecture, not just its responsive
behavior — that's a direction-level decision, not an adapt-pass
decision.

### Side drawer

A horizontal slide-in from the left or right edge of the viewport.
Visually a stronger reveal than the slide-down panel, common in
SaaS and editorial sites. Stocked alternative considered; rejected
for v1 because swipe-to-dismiss requires more JS than the stock
pattern's ≤10 lines, and CSS-only slide-in feels uncanny without
the swipe affordance. Revisit when the JS budget changes.

## Constraints the pattern respects

- **No glassmorphism.** Open panel is a solid `--color-bg`, not a
  blurred backdrop.
- **No gradient text.** Burger label is a flat color.
- **No side-stripe borders.** Panel uses a single hairline top
  border, not a decorative side stripe.
- **No shadow-as-elevation.** Panel separates from page content via
  the hairline border and the `--color-bg` color block, not a
  drop shadow.
- **No layout-property animation.** Only `transform`, `opacity`,
  and `visibility` transition.
- **No new dependencies.** No npm package; no external CSS or JS.

## Files involved

- `skills/prototype/reference/mobile-nav-collapse.md` — this doc.
- `skills/prototype/fixtures/mobile-nav-collapse-example.html` —
  a complete fixture demonstrating the pattern. Use as a visual
  reference and as the positive case for the audit smoke test.
- `skills/prototype/fixtures/mobile-nav-broken-example.html` —
  the same page without the collapse. Negative case: the audit
  must refuse it at 360px.
- `skills/prototype/fixtures/mobile-nav-audit.mjs` — Playwright
  smoke test. Renders a file at 360px, evaluates the three
  conditions, exits 0 on clean and 1 on findings.

## Running the smoke test

```
cd plugins/stardust
node skills/prototype/fixtures/mobile-nav-audit.mjs \
     skills/prototype/fixtures/mobile-nav-collapse-example.html
# → exit 0, no findings

node skills/prototype/fixtures/mobile-nav-audit.mjs \
     skills/prototype/fixtures/mobile-nav-broken-example.html
# → exit 1, prints overflow + nav-readability-floor findings
```

Requires Playwright (`npm i -D playwright`) and a Chromium install
(`npx playwright install chromium`). The script is a thin wrapper —
the audit conditions are the load-bearing piece, and they're
literal CSSOM reads against the rendered DOM.

## Provenance

When the stock pattern is applied, `_provenance.adapt[]` records:

```yaml
- at: 2026-05-13T10:42:00Z
  by: impeccable:adapt (via stardust:prototype Phase 2.7)
  breakpoints: [360, 640, 768, 1024, 1280]
  rules: 6
  navCollapse: hamburger (stock)
  audit:
    - pre:   horizontal-overflow-at-360px (147px overflow)
    - pre:   nav-readability-floor (font 10px, gap 6px)
    - post:  pass
```

The pre/post entries let a reviewer see what triggered the
remediation and that the remediation cleared the audit.
