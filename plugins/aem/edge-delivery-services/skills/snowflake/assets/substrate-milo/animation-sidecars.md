# Animation sidecars — the `--pa-*` vocabulary (Milo block-level)

Reference for Phase 3 step **B.5b** (Milo flavor, block-level). Scroll animations are
authored as a sibling **`animation` block** inside a section, NOT as bundled JS. The
vendored runtime — `blocks/animation/animation.js` + `tools/page-animator/controls.js`
(shipped by the Milo substrate, from `milo @ page-animator-poc`) — reads the block's
key/value rows, finds the target block by class name, and emits a CSS scroll-driven
animation (`animation-timeline: view()`). The **page-animator panel** reads/writes the
exact same keys, so anything emitted here is adjustable in the Animator and round-trips
via the panel's "Copy to DA".

## Block shape

```html
<div class="animation {target-block} [index]">
  <div><div>{key}</div><div>{value}</div></div>
  …
</div>
```

- **Target:** the class after `animation` names the block in the same section
  (`animation forge-hero`). Append an index for the Nth match of that class
  (`animation forge-card 2`). **No class → animate the whole section.**
- **Values are bare numbers** — the runtime does `parseFloat`, so write `24`, not `24px`.
  Select-type keys take their string value (`entry 0%`). Emit only the keys you change;
  omitted keys use the defaults below.
- The block hides itself at runtime; it is pure config.

## Keys and defaults

Mirror of `tools/page-animator/controls.js` `CONTROLS` (the source of truth — keep this
table in sync if that file changes).

| Key | Type | Default | Notes |
|---|---|---|---|
| `--pa-opacity-from` | number 0–1 | `1` | start opacity (`0` = fade in) |
| `--pa-translate-y` | number px | `0` | start Y offset (`24` = rise up) |
| `--pa-translate-x` | number px | `0` | start X offset (±, slide in) |
| `--pa-scale` | number | `1` | start scale (`1.05` / `0.95`) |
| `--pa-blur` | number px | `0` | start blur (`8` = blur-in) |
| `--pa-easing` | select | `cubic-bezier(0.42,0,0,1)` | `ease` \| `ease-in-out` \| `cubic-bezier(0.42,0,0,1)` \| `linear` |
| `range-start` | select | `entry 0%` | scroll range start: `entry 0%` \| `entry 25%` \| `entry 50%` |
| `range-end` | select | `entry 100%` | scroll range end: `entry 75%` \| `entry 100%` \| `cover 50%` |
| `timing-opacity-start` | % | `0` | keyframe % where opacity begins moving |
| `timing-opacity-end` | % | `100` | keyframe % where opacity finishes |
| `timing-transform-start` | % | `0` | same for translate/scale |
| `timing-transform-end` | % | `100` | same for translate/scale |
| `timing-blur-start` | % | `0` | same for blur |
| `timing-blur-end` | % | `100` | same for blur |

The `from` values animate to their rest state (opacity→1, transform→none, blur→0) over
the scroll `range`. The `timing-*` keys let each property move on a different slice of
the range (e.g. opacity 0–40%, transform 0–100%).

## Recipes

- **Fade-up (default reveal):** `--pa-opacity-from 0`, `--pa-translate-y 24`,
  `range-start entry 0%`, `range-end entry 60%`.
- **Slide-from-left:** `--pa-opacity-from 0`, `--pa-translate-x -80`, `range-end entry 75%`.
- **Blur-reveal:** `--pa-opacity-from 0`, `--pa-blur 12`, `range-end entry 60%`.
- **Scale-in:** `--pa-opacity-from 0`, `--pa-scale 0.92`, `range-end entry 70%`.
- **Stagger across sections:** keep the same params but step `range-start` later per
  sibling section (`entry 0%`, `entry 10%`, `entry 20%`, …).

## Notes

- `animation-timeline: view()` requires Chrome 115+ / Safari 18+. No JS polyfill is
  vendored. Acceptable for prototypes/demos.
- Above-the-fold sections are already past their entry range at scroll 0, so they render
  settled (no visible motion, no LCP cost). Emit them for consistency regardless.
- Cinematics that don't reduce to these properties (Lenis/GSAP scrub, pinning) stay as
  the bundled `scripts/<page>-animations.js` (page-level) — they are not adjustable.
