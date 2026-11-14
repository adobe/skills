# Motion registers

A catalog of choreography templates that `prototype --cinematic`
can apply to a proposed redesign. Each register is **a brand-faithful
motion personality**, not an aesthetic preset — the choice of register
is driven by the captured brand surface and the target PRODUCT.md
Brand Personality, the same way Mode A's palette + typography are
brand-faithful.

The five registers below cover the vast majority of redesign briefs.
They are worked exemplars, not a closed set: a bespoke register may
be derived per § Extension rule, and one that proves out graduates
into the catalog per § Adding a register. The existing five are
stable: prototypes from older runs render correctly against the
current register definitions.

## When to engage a register

`direct` picks a register and writes it into
`DESIGN.json.extensions.motion.register`. `prototype --cinematic`
reads that value, applies the register's choreography templates to
the rendered file, and runs the motion validation gate.

`prototype --cinematic=<register>` lets the user override at command
time. The override is recorded in the proposed file's
`_provenance.motion.registerSource = "user-override"` and surfaces in
the run summary so reviewers can spot when direction's heuristic
was bypassed.

## The five registers

### `arrival`
**Brand fit.** Civic, institutional, brand-led. Marketing surfaces
that introduce a place / a brand / an entity. Default when the
captured PRODUCT.md leans `brand` register with formal voice and
when no other register clearly fits.

**Signature moves.**
- Hero photograph parallaxes upward as you scroll (translateY −35vh
  end of range, easeOut3).
- Post-hero block rises faster than the hero, covering it (the
  "rising plate" gesture borrowed from the Acrobat plans page).
- Scrim deepens as you scroll past hero (`--parallax-progress`
  drives a `linear-gradient` opacity).
- Per-section entrances: fade + translateY(40px) on scroll trigger
  with stagger across peers in the same band.
- Hero text: `enterUp` keyframe on load with 90ms stagger across
  eyebrow → title → body.
- Live counters (any `[data-countup]`) tween 0 → target on IO
  trigger.
- Footer wordmark wipe-up via `clip-path: inset(N% 0 0 0)`
  driven by scroll progress.

**Data-attributes consumed.** `[data-anim]`, `[data-countup]`,
`[data-parallax]`.

**Token defaults.**
```json
{
  "easings": { "entrance": "cubic-bezier(0.25, 0.46, 0.45, 0.94)", "transition": "cubic-bezier(0.42, 0, 0, 1)" },
  "durations": { "enter": 700, "stagger": 90 },
  "parallax": { "translate": 35, "fade": 0.55, "rangeStart": 0, "range": 80 }
}
```

**Refuses.** Editorial-airy section padding (> 96px desktop).
Decorative motion on the captured configurator / search surface.

---

### `kinetic-display`
**Brand fit.** Signage-led, wayfinding-first, display-typography
brands. Use when the captured surface carries a defining
typographic signature (an airport monogram, a stadium identity, a
transport wordmark) AND the captured copy uses display caps as
structural language (terminal codes, gate numbers, section labels).

**Signature moves.**
- Hero monogram unmasks letter-by-letter on load via
  `clip-path: inset(0 0 100% 0)` staggered 120ms.
- Section heads wipe in left-to-right via `clip-path: inset(0 X% 0 0)`
  on word-span children, scroll-driven.
- Numeric "departure-board" flip — values cycle through random
  digits before landing on the target.
- Infinite signage marquees between bands (`@keyframes marqueeScroll`).
- Large display copy (titles, brand labels) reveals letter-by-letter
  with `filter: blur(8px → 0)` on scroll.
- Big numerals (counts, scores, codes) count up on IO trigger.

**Data-attributes consumed.** `[data-anim]`, `[data-split]`,
`[data-flip]`, `[data-countup]`, `.marquee__track`.

**Token defaults.**
```json
{
  "easings": { "entrance": "cubic-bezier(0.25, 0.46, 0.45, 0.94)", "expo": "cubic-bezier(0.16, 1, 0.3, 1)" },
  "durations": { "enter": 800, "stagger": 110, "letterStagger": 50 },
  "marquee": { "speed": 30 }
}
```

**Refuses.** Soft long-fade entrances (clashes with the signage
register's hard reveal vocabulary). Decorative serifs in the marquee
band. Editorial body copy as the canvas for the register — this is
display register first; body register is incidental.

---

### `live-systems`
**Brand fit.** Operational, dashboard-led, data-transparent. Brands
whose value proposition includes live state — airports, exchanges,
delivery, transit, weather, status pages. Use when the captured page
exposes real-time signals (wait times, availability, departures,
prices) as first-class content.

**Signature moves.**
- Top-of-page ticker marquee scrolling latest operational changes
  (continuous; freezes under reduced-motion).
- Tile cascade entrance with `translateY + rotateX(8deg)` settling
  to identity.
- Wait-time / count / availability values count up 0 → target on
  IO trigger.
- Parking / capacity / utilization **bars fill** from 0% → target
  with expo easing.
- Live "pulse" dots — `box-shadow: 0 0 0 8px rgba(...)` 1.6s
  ease-in-out infinite — on every realtime data row.
- Periodic "refresh sweep" gradient passes across the live tiles
  every 5–6s (mirrors the production data-refresh cadence).
- Subtle micro-anims on supporting widgets (e.g. animated wind
  lines on a weather tile).

**Data-attributes consumed.** `[data-tile-anim]`, `[data-countup]`,
`[data-fill]`, `.live-sweep`, `.live-strip__label::before`.

**Token defaults.**
```json
{
  "easings": { "entrance": "cubic-bezier(0.25, 0.46, 0.45, 0.94)", "expo": "cubic-bezier(0.16, 1, 0.3, 1)" },
  "durations": { "enter": 600, "stagger": 100, "fill": 1100 },
  "pulse": { "duration": 1600, "spread": 8 },
  "sweep": { "interval": 5400, "duration": 1700 }
}
```

**Refuses.** Long parallax pulls (operational pages should not
disorient the user). Marquees longer than one row (every infinite
scroll uses cache + cognitive load). Animated headings — operational
hierarchy stays still; the *data* is the choreography.

---

### `editorial`
**Brand fit.** Publication, long-form, slow-paced. Magazines, essay
sites, photography portfolios, document-shaped redesigns. Use when
the captured PRODUCT.md leans toward reading-paced consumption and
the captured photography / typography pulls a long-form register.

**Signature moves.**
- Long crossfades on imagery (700–1100ms opacity tweens).
- Reading-paced text reveals: `opacity 0 → 1` over 600ms with no
  translate (no kinetic verb).
- Soft micro-parallax: hero photo translates 8–12vh, never more.
- Caption / pull-quote reveals tied to viewport-center, not
  trigger-on-enter.
- Hover-driven detail: gentle image zoom (`transform: scale(1.02)`
  900ms) and link underline draw-in.
- No marquees. No split-flap. No tickers.

**Data-attributes consumed.** `[data-anim]`, `[data-parallax]`.

**Token defaults.**
```json
{
  "easings": { "entrance": "cubic-bezier(0.16, 1, 0.3, 1)", "transition": "cubic-bezier(0.42, 0, 0, 1)" },
  "durations": { "enter": 900, "stagger": 140 },
  "parallax": { "translate": 10, "fade": 0.20, "rangeStart": 0, "range": 90 }
}
```

**Refuses.** Bouncy easings (overshoot, anticipation-and-snap).
Count-ups (editorial doesn't count its readers). Tickers and
marquees. Anything that compromises text legibility for the first
500ms of reading.

---

### `kinetic-grid`
**Brand fit.** Product, SaaS, modular catalogues. Brands whose
identity is a grid of cards / tiles / features and whose voice is
transactional. Use when the captured page leans toward a modular
catalogue with repeated cards as primary IA.

**Signature moves.**
- Card grids cascade in with directional stagger (left-to-right
  across the row, then row-by-row down the grid).
- Hover lift system: cards translate −4px and pick up a lifted
  shadow on hover; 380ms `cubic-bezier(0.42, 0, 0, 1)`.
- Tab / segment transitions: indicator slides horizontally with
  `slideInH` scale-X transition.
- Configurator / form transitions: field focus rings draw in
  rather than pop in.
- Buttons gain a sheen on hover (`linear-gradient` translateX
  −100% → 100% over 700ms).
- Per-section entrances mirror `arrival` but tighter (slide 28px,
  stagger 70ms).

**Data-attributes consumed.** `[data-anim]`, `[data-tile-anim]`.

**Token defaults.**
```json
{
  "easings": { "entrance": "cubic-bezier(0.42, 0, 0, 1)", "transition": "cubic-bezier(0.42, 0, 0, 1)" },
  "durations": { "enter": 500, "stagger": 70 },
  "lift": { "translate": -4, "duration": 380 }
}
```

**Refuses.** Page-level parallax (modular grids should not move under
the user). Letter-by-letter reveals. Tickers. Anything that
distracts from the grid as the protagonist.

## Selection heuristic (used by `direct`)

`direct` writes one register into `DESIGN.json.extensions.motion.register`.
The selection follows the captured PRODUCT.md Brand Personality:

| Personality traits (any match)                                                | Register         |
|-------------------------------------------------------------------------------|------------------|
| `civic-formal` + (`institutional` OR `place-led`)                             | `arrival`        |
| `signage-led` OR `wayfinding-first` OR `display-typography-signature`         | `kinetic-display`|
| `operationally-transparent` OR `data-led` OR `dashboard-register`             | `live-systems`   |
| `editorial` OR `slow-paced` OR `publication-register`                         | `editorial`      |
| `product` OR `SaaS` OR `transactional` OR `modular-catalogue`                 | `kinetic-grid`   |
| (ambiguous / multiple equally fit)                                            | `arrival`        |

Tie-breaking rule: when two registers match, prefer the one whose
**refuses** clause does NOT conflict with a captured trait. (Example:
a brand that's both `civic-formal` and `signage-led` could take
`arrival` or `kinetic-display` — if the captured surface has a
defining monogram, take `kinetic-display`; otherwise `arrival`.)

## Mixing registers (refused by default)

A page renders against **one register**. Mixing — say, `kinetic-display`
hero + `live-systems` ops + `editorial` rail — produces motion
incoherence and a "motion C-cliff" failure (see
`motion-validation.md` § Register-mismatch detector).

The only exception: an isolated `data-section` may opt out of the
page's register by declaring `data-motion-register="<other>"`. The
opt-out is rare, must be justified in the page-shape brief, and
must not exceed one section per page.

## Extension rule

A **bespoke register derived from the site's own captured motion**
— for when the captured surface has a real motion identity none of
the five registers honors — is admissible for a run when it carries
the same evidence shape as the catalog entries:

1. **Captured-trait citation** — the captured motion behavior it
   derives from (scroll choreography, transitions, a kinetic
   signature observed at extract), cited into the capture.
2. **Signature moves + token defaults** — each move referencing a
   data-attribute or CSS pattern documented in
   `motion-attributes.md` / `motion-runtime.md` (new attributes go
   in those files first).
3. **A refuses list** — ≥ 3 behaviors the register explicitly
   excludes.
4. **Degradation fallbacks** — a complete `prefers-reduced-motion`
   neutralization and a no-JS static-end state, validated by the
   same `motion-validation.md` § Pass 6 gates as catalog registers.

Record the extension in `_provenance.motion` with
`registerSource: "extension"`, the derivation rationale, and the
citations. An extension register that proves out graduates to the
catalog via § Adding a register.

## Adding a register

A new register requires:

1. A **named brand fit** clause specifying which PRODUCT.md
   personality traits it serves.
2. A **signature-moves list** of 4–8 concrete behaviors. Each move
   must reference a data-attribute or CSS pattern documented in
   `motion-attributes.md` / `motion-runtime.md`. New attributes go
   in those files first.
3. A **refuses list** naming at least 3 behaviors the register
   explicitly excludes. A register without exclusions is too broad
   to be useful.
4. Token defaults.
5. A worked example: a published prototype that ships with the
   register applied, screenshot-validated, and motion-gate-passed.

The bar for adding a register is intentionally high. Most new
brands fit one of the five above; reach for a new register only
when none of them honor the captured surface.

## Where this register catalog is read

- **`direct`** writes `extensions.motion.register` based on the
  selection heuristic; the user may override at command time.
- **`prototype --cinematic`** reads it, applies the register's
  signature moves to the rendered file, and consumes the token
  defaults into the `:root` block.
- **Motion validation** reads the declared register to classify
  findings: `live-systems` allowing a `[data-anim]` to start
  hidden is by-design; `editorial` allowing it is a bug (editorial
  refuses kinetic entrances).
- **A future analyst** reading the proposed file's
  `_provenance.motion.register` can audit a published redesign
  against the register catalog to detect drift.
