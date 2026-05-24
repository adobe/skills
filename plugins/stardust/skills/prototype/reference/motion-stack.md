# Motion stack

The technology choice that powers `prototype --cinematic`. Documented
because the choice is intentional and load-bearing — every cinematic
prototype assumes the same primitives.

## The stack

1. **Lenis** for smooth scroll.
   - Pinned at `skills/prototype/assets/motion/lenis.min.js` (+ `.css`).
   - ~17 KB minified, MIT-licensed.
   - Replaces the browser's default scroll with an interpolated wheel
     handler so transforms driven by `scrollY` don't tear at high
     frame rates.
   - Initialized once per page (`new Lenis({ lerp: 0.1 })`) and parked
     on `window.__lenis` so the runtime + downstream code can both
     read it.

2. **CSS `@keyframes` for entrance animations.**
   - `enterUp`, `enterDown`, `letterReveal`, `slideInH`, `livePulse`,
     `warnPulse`, `tickerScroll`, `marqueeScroll`, `slowZoom`,
     `windFlow`, `pulseGlow`, `bounceY`, `sweep`.
   - Triggered by load (nav drop, hero text rise) or by class toggle.
   - Easing: `cubic-bezier(0.25, 0.46, 0.45, 0.94)` for entrances,
     `cubic-bezier(0.42, 0, 0, 1)` for transitions,
     `cubic-bezier(0.16, 1, 0.3, 1)` for expo-style settles.

3. **One `requestAnimationFrame` loop** for everything scroll-linked.
   - Subscribes to `lenis.scroll` via `lenis.on('scroll', ...)` for
     coarse state (e.g. nav scrolled class) and reads
     `window.__lenis.scroll` inside the tick for fine state
     (parallax, scroll-progress reveals).
   - Drives: hero parallax translate, post-hero riser translate,
     per-element scroll entrances (opacity + translateY from the
     "below" state to identity), display-head clip-path word
     wipes, split-letter scroll reveals, footer wordmark clip-path
     wipe-up.
   - Uses the **`easeOut3`** helper (`t => 1 - (1-t)^3`) for every
     scroll-progress curve. One easing across the page keeps motion
     coherent.
   - Re-measures on resize and on `window.load`.

4. **`IntersectionObserver` for one-shot reveals.**
   - Count-ups (`[data-countup]`), split-flap flips (`[data-flip]`),
     and bar fills (`[data-fill]`).
   - Threshold 0.4; once observed, the element is marked with a
     `dataset.seen` flag so re-entering the viewport doesn't replay.
   - Independent of the rAF loop — these are tween-once behaviors
     not scroll-progress behaviors.

5. **`prefers-reduced-motion: reduce` handling.**
   - Top-level CSS block neutralizes every keyframe and transition
     duration to 0.01ms.
   - The runtime checks `matchMedia('(prefers-reduced-motion: reduce)')`
     at boot and, on match, skips Lenis smooth wheel, freezes the
     rAF tick, jumps count-ups straight to their target, fills bars
     to their target width, and forces every `[data-anim]` to its
     final state.

## What is NOT in the stack

- **No GSAP.** GSAP is excellent but it ships with a commercial
  license for paid use of Bonus Plugins (SplitText, MorphSVG,
  ScrollTrigger Pro, etc.), is heavier (50–100 KB depending on
  imports), and binds prototype output to a vendor's runtime.
  Stardust prototypes are static HTML that must zip-and-deploy
  without rewriting; GSAP would either be inlined (license
  ambiguity) or fetched from a CDN (network dependency).
- **No Framer Motion / Motion One / Theatre.js.** Same rationale —
  they add framework coupling and runtime weight without expanding
  the choreography vocabulary the registers in
  `motion-registers.md` actually need.
- **No CSS scroll-driven animations (`animation-timeline: view(*)`).**
  Browser support is still partial; the existing motion-validation
  gate covers them when they DO appear (a craft-step may still
  reach for them when the target browser allows). The cinematic
  feature picks `scrollY + rAF + transforms` because it works
  everywhere Lenis works.
- **No JS framework.** Cinematic prototypes ship as a single HTML
  file with one `<script>` tag for Lenis and one inline `<script>`
  for the runtime. The static-site contract is preserved.

## Bundling policy

Lenis lives at `skills/prototype/assets/motion/`. At render time,
`prototype --cinematic` copies both files into the project's
`stardust/prototypes/` directory and the rendered HTML loads them
via relative path:

```html
<link rel="stylesheet" href="lenis.min.css" />
<script src="lenis.min.js"></script>
```

The copy keeps prototypes **self-contained** — the user can move the
entire `stardust/prototypes/` directory or zip it without breaking
references.

When `migrate` consumes a cinematic prototype, it copies the same
two files into `stardust/migrated/assets/motion/` and rewrites the
HTML references to root-relative paths (`/assets/motion/lenis.min.js`)
following the bundle-as-self-contained contract in
`skills/migrate/reference/asset-bundling.md`.

## Runtime script

The runtime is **inline in every cinematic prototype**, not loaded
from a shared `.js` file. The canonical text is in
`reference/motion-runtime.md`; `prototype --cinematic` embeds it
verbatim and customizes only the register-specific configuration
constants at the top.

Inline-not-external because:

1. Migrate's self-contained contract is easier to honor with one
   inline block than with another file in the bundle.
2. A reviewer reading the proposed file sees the entire motion
   contract without context-switching.
3. The runtime is small enough (~200 lines) that the duplication
   across prototypes is not a maintenance burden — when the
   reference doc changes, re-rendering every cinematic page updates
   them all.

## Pinning Lenis

Lenis version is pinned to the build copied into
`skills/prototype/assets/motion/`. Re-bundling requires:

1. Replace `lenis.min.js` and `lenis.min.css` together.
2. Re-validate against a known-good prototype (the JFK Airport
   cinematic A/B/C fixtures referenced in `motion-runtime.md` §
   Worked example).
3. Confirm `lenis.scroll` (read inside the rAF tick) and
   `lenis.on('scroll', ...)` (subscribed at boot) still resolve
   the same shape.
4. Add a CHANGELOG entry naming the pinned version.

The runtime never reaches for non-stable Lenis API surfaces.

## Why this much weight?

Combined cinematic-prototype overhead vs. the static prototype:

- `+17 KB` Lenis (cached after first prototype on the same origin).
- `+200 LOC` inline runtime.
- `+~40 lines` of CSS keyframes per register applied.

That's the budget. The motion-validation gate enforces that nothing
larger sneaks in.
