# Motion attributes

A small `data-*` vocabulary that cinematic prototypes apply to
elements they want the motion runtime to animate. The vocabulary is
the **declarative contract** between the rendered HTML (which states
intent) and the runtime (which executes it).

Mirrors the structural `data-section` / `data-intent` vocabulary in
`skills/stardust/reference/data-attributes.md` but lives in
**`prototype/reference/`** because motion attributes are scoped to
the cinematic feature, not to every prototype.

## Why declarative

Three reasons:

1. **The HTML carries the intent.** A reviewer reading
   `<span data-countup="27">0</span>` knows the value tweens 0 → 27
   without reading any JS. The motion contract is auditable from the
   markup.
2. **One runtime, many registers.** The same runtime serves all five
   registers in `motion-registers.md`. Registers differ in which
   attributes their templates *emit*, not in runtime code.
3. **Reduced-motion fallback is a single line of CSS.** When motion
   is off, the runtime walks every attribute and forces it to its
   final state. The vocabulary is the enumeration set.

## Where they go

On the **leaf element** whose visual property animates. Not on the
section. The leaf is what `getComputedStyle` reads, what the
IntersectionObserver observes, and what the rAF loop transforms.

Exception: `[data-tile-anim]` goes on a tile-shaped *container* (a
card, an ops-tile) so the entrance affects the whole tile rather
than its individual children.

## The vocabulary

### `[data-anim]`
**Type.** Scroll-triggered entrance.
**Effect.** Element enters with `opacity 0 → 1` and
`translateY(40px → 0)` over the scroll range
`[trigger - 0.85vh, trigger - 0.5vh]`.
**Stagger.** Peers within the same band stagger by ~90ms per index.
**Registers that emit.** `arrival`, `kinetic-display`, `editorial`,
`kinetic-grid`. Not `live-systems` (tiles use `[data-tile-anim]`).

### `[data-tile-anim]`
**Type.** Scroll-triggered entrance for card / tile containers.
**Effect.** Element enters with `opacity 0 → 1`,
`translateY(28px → 0)`, AND `rotateX(8deg → 0)` — the rotateX adds
depth on cascade-in.
**Registers that emit.** `live-systems`, `kinetic-grid`.

### `[data-countup="N"]`
**Type.** IO-triggered numeric tween (one-shot).
**Effect.** Element's textContent tweens from `0` to integer `N`
over a duration scaled by magnitude (target ≤ 5 → 600ms; target ≤
20 → 900ms; otherwise 1400ms). Uses `easeOut3`.
**Element shape.** Must contain only the integer; the runtime
replaces textContent on every frame. Use a wrapper for any units
(`<span data-countup="27">0</span><span> min</span>`).
**Registers that emit.** All five (every register has at least one
count-up surface — alerts, advisories, durations, percentages).

### `[data-flip="N"]`
**Type.** IO-triggered split-flap digit randomization (one-shot).
**Effect.** Element's textContent cycles through 8–12 random digits
(60ms per step) before settling on integer `N`. Evokes a flip-board
arrival.
**Element shape.** Same as `[data-countup]` — must contain only the
integer.
**Registers that emit.** `kinetic-display` only.

### `[data-fill="N"]`
**Type.** IO-triggered bar-fill (one-shot).
**Effect.** Element's CSS `width` tweens from `0%` to `N%` over
1100ms with expo easing.
**Element shape.** Must be an inner element of a bar container
(e.g. `<span class="park-bar"><i data-fill="78"></i></span>`).
**Registers that emit.** `live-systems` only.

### `[data-split]`
**Type.** Scroll-triggered letter-by-letter reveal.
**Effect.** At measure-time the runtime splits the element's text
into individual `<span>` children, sets each to `opacity 0`,
`translateY(60%)`, `filter: blur(8px)`. On scroll, each letter
unblurs and rises with 50ms stagger.
**Element shape.** Must contain plain text only (no nested
markup at write-time).
**Registers that emit.** `kinetic-display`.

### `[data-parallax]`
**Type.** Scroll-progress-driven translate.
**Effect.** Element translates `translateY(progress × -N vh)` where
`N` is the register-default `parallax.translate` (typically 35 for
`arrival`, 10 for `editorial`).
**Element shape.** Must be inside an `overflow: hidden` parent —
the parallax can move the element past its own bounds.
**Registers that emit.** `arrival`, `editorial`.

## Companion CSS hooks

These are **class names** rather than data-attributes because they
participate in CSS selector matching (keyframe animations, hover
states). Documented here for completeness.

### `.live-sweep`
A container that opts into the periodic refresh sweep. The runtime
adds `.sweep` every ~5.4s for 1.7s; the CSS rule paints a moving
linear-gradient via a `::after` pseudo-element.
**Registers.** `live-systems` only.

### `.marquee__track`
A flex-row of duplicated content. Animates with `@keyframes
marqueeScroll` (translateX 0 → -50%) infinite.
**Registers.** `kinetic-display`, `live-systems` (top ticker).

### `.monogram-mask span` (and equivalents)
Display-monogram letters whose `clip-path: inset(0 0 100% 0)`
animates to `inset(0 0 0 0)` via `@keyframes letterReveal`.
Apply to letter spans inside a hero-monogram container when the
register is `kinetic-display`.
**Registers.** `kinetic-display`.

## Reduced-motion contract

Every attribute and class above must respect
`@media (prefers-reduced-motion: reduce)`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  [data-anim], [data-tile-anim], [data-split] span {
    opacity: 1 !important;
    transform: none !important;
    filter: none !important;
    clip-path: none !important;
  }
  .marquee__track, .brand-band__photo { animation: none !important; }
}
```

The runtime additionally:

- jumps `[data-countup]` and `[data-flip]` to their target integer;
- sets `[data-fill]` width to the target percentage;
- skips the rAF tick loop entirely.

The motion-validation gate's reduced-motion check
(`motion-validation.md` § Pass 3d) verifies that every attribute is
neutralized.

## Examples

```html
<!-- arrival hero -->
<h1 class="hero-marquee__title">BRAND</h1>
<p class="hero-marquee__body">Brand tagline goes here…</p>

<!-- live data chip with count-up -->
<span class="data-chip">
  <span class="t">A1</span>
  <span class="v" data-countup="27">0</span>
  <span style="opacity:0.7">unit</span>
</span>

<!-- live-systems tile -->
<article class="tile warn" data-tile-anim>
  <span class="tile__id">A1</span>
  <div class="tile__metric">
    <span class="v" data-countup="27">0</span>
    <span class="u">unit</span>
  </div>
</article>

<!-- bar fill -->
<span class="capacity-bar warn">
  <i data-fill="78"></i>
</span>

<!-- kinetic-display split-flap -->
<span class="big-id" data-flip="5">0</span>

<!-- editorial scroll entrance -->
<p data-anim>Headline copy reveals on scroll.</p>

<!-- kinetic-display letter reveal -->
<h3 class="trio__title" data-split>WORD</h3>
```

## Who reads, who writes

- **`prototype --cinematic`** writes the attributes into the
  rendered file based on the active register's template. The
  attribute set is deterministic per register; the rendered HTML
  is auditable.
- **Motion runtime** reads them at boot, registers handlers, and
  drives the animations.
- **Motion validation** reads them to know what to verify (every
  `[data-countup]` reaches its target; every `[data-anim]` ends
  visible at appropriate scroll positions; every `[data-fill]`
  has a finite target).
- **`migrate`** preserves them when re-deriving from the
  prototype. Cinematic prototypes carry their motion contract
  through to the deployed bundle.

## What this vocabulary is NOT

- It is **not** a substitute for the structural `data-section` /
  `data-intent` vocabulary. They coexist. Structural attributes
  describe what the section is *for*; motion attributes describe
  what the element *does* under scroll.
- It is **not** a generic animation framework. The vocabulary is
  scoped to the five registers and the choreographies they need.
  Adding a new attribute requires (a) a register that emits it,
  (b) a runtime change in `motion-runtime.md`, (c) a
  motion-validation gate update.

## Versioning

**v1 base set** — ships with stardust v0.9.0 (the `--cinematic`
feature): `[data-anim]`, `[data-tile-anim]`, `[data-countup]`,
`[data-flip]`, `[data-fill]`, `[data-split]`, `[data-parallax]`,
`.live-sweep`, `.marquee__track`.

New attributes are added in a backward-compatible way; renaming
existing ones requires a minor version bump.
