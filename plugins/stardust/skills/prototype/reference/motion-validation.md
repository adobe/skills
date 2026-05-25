# Motion validation

Motion-specific validation discipline that runs after the impeccable
craft loop produces a proposed file with scroll-driven choreography,
rAF loops, or CSS `animation-timeline:` patterns. Sits alongside the
existing critique + audit + adapt gates as a separate pass because
motion failure modes are not detected by static-DOM gates.

Invoke this when the proposed file's `_provenance.motion` declares
≥ 1 named choreography (per the page-shape brief's motion stack) or
when ANY of the following CSS / JS patterns appear in the rendered
HTML:

- `animation-timeline: view(*)` or `animation-timeline: scroll(*)`
- `@scroll-timeline` rules
- `requestAnimationFrame` loops reading `getBoundingClientRect()` to
  drive transforms
- IntersectionObserver-driven entry triggers (anim-enter pattern)
- Lenis / Locomotive / GSAP ScrollTrigger choreographies declared
  in DESIGN.json's `extensions.motion`
- A `[data-anim]`, `[data-tile-anim]`, `[data-countup]`,
  `[data-flip]`, `[data-fill]`, or `[data-split]` attribute
  anywhere in the document (the cinematic vocabulary —
  `reference/motion-attributes.md`)
- A loaded `lenis.min.js` (cinematic feature signal —
  `reference/motion-stack.md`)

If none of these patterns appear in the rendered file, skip this
discipline.

## Cinematic-mode entry conditions

When the rendered file declares
`_provenance.motion.register ∈ { "arrival", "kinetic-display",
"live-systems", "editorial", "kinetic-grid" }`, the motion-validation
discipline runs in **cinematic mode** — every static-prototype gate
still applies, plus the cinematic-specific gates in § Pass 6 below.

The active register is read from
`DESIGN.json.extensions.motion.register` (written by `direct`) or
from the `--cinematic=<register>` CLI override recorded in
`_provenance.motion.registerSource`. The register name selects the
expected motion vocabulary against which Pass 6 audits.

## What motion validation catches (that static gates miss)

The existing gates (critique, audit, mobile-adapt audit, anti-toolbox
audit, content-sourcing scan) all read the rendered DOM at scrollY=0
with no time elapsed. They cannot catch:

1. **Content that is `opacity: 0` until a scroll event fires.** An
   anim-enter pattern with `opacity: 0` initial state is correct
   markup but invisible-on-first-paint. Whether it eventually reveals
   depends on the scroll timeline aligning with the user's actual
   scrolling — which is a runtime property, not a DOM property.
2. **Content that is `translateY(N)` outside its parent's clip
   region.** A garage-door reveal that translates the inner content
   by 50vh down works at small viewports (where N is modest) and
   breaks at large viewports (where N exceeds the parent's
   `overflow: clip` bound). The bounding-rect math still puts the
   element "in viewport" but the rendered output is empty.
3. **Choreographies whose animation-range completes too late.** A
   scroll-driven animation with `animation-range: cover -10% cover
   100%` reveals content only after the section has fully scrolled
   past — by which point the user has stopped reading. The DOM is
   correct; the timeline is wrong.
4. **rAF loops with stale baseline.** A parallax effect that reads
   `getBoundingClientRect()` once and never re-baselines after layout
   shifts produces drift on resize / font-load / lazy-image-load.
   Caught only by re-probing after layout settles.
5. **Section overlaps caused by transforms.** Two adjacent sections
   that don't overlap in document flow can overlap visually when one
   carries a translateY animation. The bounding-rect-based section-
   overlap detector flags this, but only if it probes during the
   scroll range where the transform is active.
6. **The `prefers-reduced-motion` regression.** A choreography that
   relies on `animation-timeline: view(*)` for both motion AND
   visibility (i.e., the keyframe's "to" state is the visible state)
   breaks under reduced-motion when the animation is disabled and
   the element is left at the "from" (hidden) state.

## Validation procedure

Run in order. Stop on the first failure that cannot be auto-recovered
and surface to the user; do not silently lower a gate.

### Pass 1 — Scroll-position probe

Scroll the rendered prototype through 8 standard probe positions:

- 0 (top of page)
- 0.5 × heroH (mid-hero, if hero present)
- 0.95 × heroH (hero finished)
- heroH + 200 (post-hero, first below-fold section)
- 0.45 × totalH (mid-page)
- 0.65 × totalH (featured / mid-late page)
- 0.85 × totalH (near-end)
- totalH - vh (footer)

At each position, after a 400-500ms settle delay (let rAF settle
+ any scroll-driven animations advance):

1. Walk every element under `<body>`. For each element whose bounding
   rect intersects the viewport AND has `width >= 80 && height >= 24`
   AND has visible text or is `img/svg/video/picture`:
   - Compute `opacity` from `getComputedStyle`.
   - If `opacity < 0.05` AND element is not `display: none` AND not
     `aria-hidden="true"` (without text), record as HIDDEN.
2. Walk every `[data-section]` and `[data-component]` element. Record
   their bounding rects (document coordinates). Compare adjacent
   sections: if `sectionA.bottom > sectionB.top + 1`, record as
   SECTION-OVERLAP.

Reference implementation: `tools/playwright/diagnose-motion.mjs` in
the redesign-adobecom project — reusable across variants.

### Pass 2 — Classify each finding

Every HIDDEN and SECTION-OVERLAP finding is either:

- **By design** — the choreography is supposed to produce this state
  at this scroll position. Examples: hero overlay opacity 0 at
  scrollY=0 (fades in mid-scroll); hero text opacity 0 at
  scrollY=heroH (faded out as scrolled past); garage-door negative-
  translate overlap with previous section (the reveal pattern).
- **Bug** — the choreography produces an unintended state. Examples:
  content stays translated below clip boundary; anim-enter never
  triggers because the trigger threshold is past the user's reading
  position; section overlaps because a transform was applied without
  accounting for the next section's start.

The classification requires reading the page-shape brief's motion
declarations. If `_provenance.motion.choreographies[]` does not name
a choreography that explains the finding, the finding is a bug.

### Pass 3 — Specific motion-bug checks

Run these four checks against the proposed file:

#### 3a. Clipped-container content reveal timing

For every `[data-section]` with `overflow: clip` (or `hidden`) and
an inner element with a `transform: translateY(*)` animation:

- Compute the maximum translate magnitude across the animation range.
- Compute the parent's content-box height minus the inner element's
  natural height (= the spare room for the inner element to translate
  while remaining within clip).
- If `max-translate > spare-room` at any frame of the animation,
  the inner element will be clipped during that range.
- Surface: "<element> can translate `<max-translate>px` but parent
  has only `<spare-room>px` of slack; content will be clipped between
  `<start-progress>` and `<end-progress>` of the animation range."

Worked example from this project: studio-banner garage-door at
≥1280px had `--gd-reveal-from: 50vh` (= 450px on 900vh viewport) and
parent banner had `overflow: clip` with no padding-bottom slack;
content was clipped through cover 0% to cover 50%.

#### 3b. Animation-range vs reading position

For every element with `animation-timeline: view(block)` and
`animation-range: <start> <end>`:

- Compute the scroll positions corresponding to `<start>` and `<end>`.
- Compute the scroll position where the element's parent section is
  visually centered in viewport (the natural reading position).
- If the reading position is *outside* `[<start>, <end>]` AND the
  animation's "from" state is the hidden state, the element is
  invisible at reading position. This is a bug.

Specifically refuse `animation-range: cover X% cover 100%` for any
reveal-the-content choreography — the animation only completes when
the section has fully scrolled past, which is after the user has
stopped reading.

#### 3c. anim-enter trigger reliability

For every `.anim-enter` (or equivalent universal entry-trigger
class) element:

- Compute the scroll position at which the trigger fires (based on
  the JS implementation's threshold, typically `sY + 0.85 * vh >
  triggerTop`).
- Verify the trigger position is REACHABLE by ordinary scroll.
  Specifically: if the element is below-fold but in the bottom 15%
  of the document, the trigger position may be `> document.maxScrollY`
  — the element will never reveal because the user can't scroll
  that far.

#### 3d. Reduced-motion override completeness

Re-render the prototype with Playwright `reducedMotion: 'reduce'`
context option. At scrollY=0 (no scroll), walk every element with
`.anim-enter` or scroll-driven `animation-timeline:` and verify:

- Computed opacity is ≥ 0.95.
- Computed transform contains no non-identity translate (no
  `matrix(1, 0, 0, 1, 0, <non-zero>)`).

If any element fails these checks under reduced motion, the
`@media (prefers-reduced-motion: reduce)` block is incomplete —
some choreographies were registered but no reduced-motion
override was provided. Add explicit overrides:

```css
@media (prefers-reduced-motion: reduce) {
  .ds-banner, .ds-banner__bg, .ds-banner__content {
    animation: none !important;
    animation-timeline: auto !important;
    transform: none !important;
  }
  .anim-enter { opacity: 1 !important; transform: none !important; }
}
```

### Pass 4 — No-JS state

Re-render the prototype with Playwright `javaScriptEnabled: false`.
At scrollY=0:

- Walk every element with motion-driven hidden initial states
  (`opacity: 0`, `transform: translateY(*)`, `clip-path: inset(*)`)
  and verify the computed style is the *visible* state.
- The mechanism is a `<noscript>` block in `<head>` overriding the
  initial state. Example:

```html
<noscript>
  <style>
    .anim-enter { opacity: 1 !important; transform: none !important; }
    .ds-news-item { opacity: 1 !important; transform: none !important; }
    [data-parallax-target] { transform: none !important; }
  </style>
</noscript>
```

If any motion-hidden element is still hidden under no-JS, the
prototype fails the no-JS contract. The proposed file must work
without JavaScript (screen readers, AMP, archive crawlers, search
indexers all see the no-JS state).

### Pass 5 — Multi-viewport scroll-driven check

For prototypes with scroll-driven choreographies that use viewport-
dependent magnitudes (`vh`, `vw`-based translates, percentage-based
animation-ranges), repeat passes 1–3 at three viewport widths:

- 1440 × 900 (canonical desktop)
- 1920 × 1080 (large desktop)
- 2560 × 1440 (extra-large desktop / external monitor)

Plus the standard mobile / tablet checks (390 × 844, 768 × 1024)
that the mobile-adapt audit already covers.

Choreographies tuned for one viewport often break at others because
the magnitude scales linearly with the viewport but the parent's
clip boundary scales with the layout. The studio-banner garage-door
example from redesign-adobecom: `--gd-grow-from: -110vh` worked on
narrow screens (where `-110 × 800 = -880px` was close to the
content-render window) but broke on wide screens (where `-110 × 1080
= -1188px` left the banner above viewport throughout the readable
scroll range).

Reference implementation: `tools/playwright/banner-all-widths.mjs`
in the redesign-adobecom project. The script (a) reads each
choreography's section in-flow position, (b) computes the
visually-centered scroll position per viewport, (c) verifies inner
content is visible at that position.

### Pass 6 — Cinematic-mode gates

Run only when the rendered file declares a register per § Cinematic-mode
entry conditions. Six sub-gates. All hard — block `prototyped` until
the agent either fixes the issue or the user explicitly acknowledges.

#### 6a. Lenis bootstrap is clean
- The rendered HTML loads `lenis.min.js` from a relative or root-
  relative path that resolves to a file in the bundle (the
  cinematic feature ships Lenis at
  `skills/prototype/assets/motion/lenis.min.js`).
- Page load produces no console errors during the first 1500ms.
- `window.__lenis` is defined and has a `scroll` accessor.

A Lenis bootstrap failure (404, MIME mismatch, missing API) breaks
every scroll-driven choreography. Refuse `prototyped` if this gate
fails — the page will appear broken to the brand owner.

#### 6b. Reduced-motion fallback is complete

Re-render with Playwright `reducedMotion: 'reduce'`. After 800ms
settle:

- Every `[data-anim]` and `[data-tile-anim]` has computed `opacity:
  1` and identity transform.
- Every `[data-countup]` has textContent equal to its
  `data-countup` integer.
- Every `[data-flip]` has textContent equal to its `data-flip`
  integer.
- Every `[data-fill]` has computed `width` matching its
  `data-fill` percentage.
- Every `[data-split] span` has computed `opacity: 1`, identity
  transform, `filter: none`.
- Every `.marquee__track` has paused animation
  (`animation-play-state: paused` or `animation: none`).
- Every `.live-sweep` has no active `.sweep` class and no
  recurring interval (the runtime's `setInterval` must be gated
  by the reduced-motion check).

Reference: `motion-attributes.md` § Reduced-motion contract and
`motion-runtime.md` § Reduced-motion: force final states.

#### 6c. Scroll-jack check

- The browser's native scroll still resolves anchor links (click
  on `<a href="#section">` scrolls to the section).
- Arrow-key scroll moves the page (keyboard accessibility).
- Browser back / forward preserves scroll position on navigation
  to the same page.
- The page is scrollable within 250ms of load (Lenis must not
  block initial scroll while booting).

Lenis is configured with `lerp: 0.1` and `smoothWheel: true`. If
the validation harness detects scroll trapping (a click on an
`<a href>` produces no scroll-position change after 1500ms), the
gate fails. The runtime should never intercept programmatic scroll
APIs.

#### 6d. Three-position screenshot pass

Capture full-page screenshots at three scroll positions:
- `desktop-top.png` — scrollY=0, after 1500ms entrance settle.
- `desktop-mid.png` — scrollY=900, after 800ms transient settle.
- `desktop-deep.png` — scrollY=2400, after 800ms transient settle.

Verify at each position:
- No element is `opacity < 0.05` that should be visible at this
  scroll depth (`mid` and `deep` should show their respective
  bands fully revealed; reveals firing at the wrong depth surface
  as HIDDEN findings).
- No section overlaps another by > 1px in document coordinates.
- The footer wordmark wipe-up has progressed proportionally to
  scrollY at `deep`.

Save the three PNGs to `stardust/validation/<slug>/cine-<position>.png`.

Plus a mobile capture at 390 × 844 (`mobile.png`) confirming the
register's mobile fallback (parallax off, marquee speeds halved,
configurator un-stickied).

#### 6e. Register-match audit

Read `_provenance.motion.register` and walk the rendered file:

- Every choreography present must be **emitted by** the declared
  register per `motion-registers.md` § The five registers § Data-
  attributes consumed.
- Specifically:
  - `editorial` forbids `[data-flip]`, `[data-fill]`, `.marquee__track`,
    `.live-sweep`, count-ups, parallax > 12vh.
  - `live-systems` forbids `[data-split]`, hero parallax,
    long-fade entrances.
  - `kinetic-display` forbids `[data-fill]`, weather-style ambient
    micro-anims.
  - `arrival` forbids `[data-flip]`, `[data-fill]`, `.live-sweep`,
    tickers.
  - `kinetic-grid` forbids page-level parallax, letter-by-letter
    reveals, tickers.

A register-mismatch finding fails the gate. The fix is one of:
(a) remove the off-register choreography, (b) change the register
(rare — register is a brand-faithful choice from `direct`),
(c) move the off-register element to a `data-motion-register`
section opt-out (allowed at most once per page; recorded in the
page-shape brief).

#### 6f. Motion C-cliff detector

Refuse the page if:
- More than 80 `[data-anim]` + `[data-tile-anim]` elements declared
  (animation overload).
- Total stagger duration in any single section exceeds 600ms
  (content unreadable for too long).
- Parallax translate exceeds 50vh on any axis (vestibular risk).
- More than two infinite-loop animations active simultaneously in
  the viewport (marquees, slowZoom, livePulse all running at
  once — cognitive overload).
- More than one `.live-sweep` interval registered (would compound).

This is the cinematic equivalent of the Variant-C overshoot
failure mode documented in
`skills/direct/SKILL.md` § The C-cliff. "More motion = more
cinematic" is the same kind of escalation trap the C-cliff
warns about.

The detector counts attributes and class instances against the
thresholds above and refuses with the offending count. The
remediation is to thin the motion — most cinematic prototypes
need fewer animations than they appear to.

## Output

Motion validation produces:

- A `_provenance.motionValidation` block on the proposed file's
  `_provenance` (added after the existing critique/audit blocks):

```json
{
  "motionValidation": {
    "passedAt": "<ISO-8601>",
    "probesRun": 8,
    "viewportsTested": [{ "width": 1440, "height": 900 }, ...],
    "findings": {
      "hiddenInViewport": [{ "section": "<key>", "scrollY": <N>, "classification": "by-design" | "bug", "explainedBy"?: "<choreography-name>" }, ...],
      "sectionOverlaps": [{ "a": "<key>", "b": "<key>", "by": <px>, "classification": "by-design" | "bug" }, ...],
      "clippedReveals": [...],
      "rangeMismatches": [...]
    },
    "fixesApplied": [
      "<short description of each fix>"
    ],
    "cinematic": {
      "register": "arrival | kinetic-display | live-systems | editorial | kinetic-grid",
      "registerSource": "direct | user-override",
      "lenisBoot": "ok | failed",
      "reducedMotionFallback": "complete | incomplete",
      "scrollJackCheck": "pass | fail",
      "registerMatchAudit": "pass | fail",
      "cliffDetector": {
        "animElementCount": <N>,
        "maxSectionStaggerMs": <N>,
        "maxParallaxVh": <N>,
        "activeInfiniteLoops": <N>,
        "verdict": "pass | refused"
      },
      "screenshots": {
        "desktopTop": "stardust/validation/<slug>/cine-top.png",
        "desktopMid": "stardust/validation/<slug>/cine-mid.png",
        "desktopDeep": "stardust/validation/<slug>/cine-deep.png",
        "mobile": "stardust/validation/<slug>/cine-mobile.png"
      }
    }
  }
}
```

- A clean-pass screenshot per viewport saved under
  `stardust/validation/<slug>/motion-<viewport>.png`.

## When motion validation cannot pass

If a finding is classified as a bug and the agent cannot reach a fix
within 3 iterations of the recursive loop, surface to the user with:

- The finding (specific element, scroll position, classification).
- The reasoning that classified it as a bug.
- The 3 fix attempts that were tried.
- A proposed remediation requiring user input (e.g., "the
  choreography's range is too long; halving the magnitude would
  preserve the gesture but lose the dramatic reveal — should I
  proceed?").

Do not mark the page `prototyped` while motion-bug findings are
unresolved. Per the no-opt-outs principle: the quality gates are
the product.
