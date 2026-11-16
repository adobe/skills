# stardust:prototype: phase 2.4, motion application

The text of this part of `skills/prototype/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 2.4 — Motion application (when `--cinematic`)

Fires only when `--cinematic` (with or without an explicit
register) was passed, OR when
`DESIGN.json.extensions.motion.register` was authored by `direct`
and the user did not opt out. Produces
`stardust/prototypes/<slug>-cinematic.html` **alongside** the static
`<slug>-proposed.html` — the static prototype is never replaced.

Procedure:

1. **Resolve the register.** For single-variant runs, read
   `DESIGN.json.extensions.motion.register`. **For multi-variant
   runs** (when `DESIGN-<id>.json` files exist at the project
   root), read `DESIGN-<id>.json.extensions.motion.register` for
   the variant currently being rendered — each variant may carry
   its own register, or omit it entirely (variant renders
   static). If `--cinematic=<register>` was passed at the CLI,
   the CLI value wins **only for the variants in scope** (every
   variant when no `<slug>` filter is set, otherwise the
   variant(s) matching the filter).

   Record the source in `_provenance.motion.registerSource`
   (`"direct"` for per-variant DESIGN-authored, `"user-override"`
   for CLI). If neither path resolved a register for this
   variant, fall through to the selection heuristic in
   `reference/motion-registers.md` § Selection heuristic. If the
   heuristic itself returns no register (e.g. the variant's
   PRODUCT.md Brand Personality maps to none of the five
   registers, and no evidence-shaped extension register applies
   per the bank's § Extension rule in
   `reference/motion-registers.md`), skip Phase 2.4 entirely for
   that variant — render it static.

   The per-variant resolution is what lets `uplift` produce a
   three-variant set where only variant C engages motion: `direct`
   writes the register into `DESIGN-C.json` only, and Phase 2.4
   fires for C alone (A and B render static).

2. **Stage Lenis assets.** Copy
   `skills/prototype/assets/motion/lenis.min.js` and `lenis.min.css`
   into `stardust/prototypes/` (idempotent — skip if shas match).
   Cinematic prototypes load these via relative paths.

3. **Read the canonical runtime.** Embed the inline script from
   `reference/motion-runtime.md` § The canonical script verbatim,
   with the `animConfig` constants rewritten per the active
   register's token defaults (`reference/motion-registers.md` §
   The five registers § Token defaults).

4. **Layer the register's CSS.** Append the register-specific
   keyframes and class rules (entrance keyframes, parallax CSS
   custom properties, marquee animations, pulse animations) to
   the file's `<style>` block. The set of keyframes is closed
   per register; see `reference/motion-runtime.md` § Per-register
   tuning.

5. **Annotate target HTML.** Walk the rendered DOM and emit the
   motion `data-*` attributes per the register's vocabulary:
   - `arrival`: `[data-anim]` on section heads, body copy,
     CTAs, and tile cards; `[data-countup]` on numeric values;
     `[data-parallax]` on the hero photograph.
   - `kinetic-display`: `[data-anim]` on most sections; `[data-split]`
     on display-cap headlines (`<h1 data-split>DINE</h1>`);
     `[data-flip]` on terminal codes / gate numbers; `.word`
     spans on display headlines for clip-path word wipes.
   - `live-systems`: `[data-tile-anim]` on every ops-tile and
     card; `[data-countup]` on every numeric data value;
     `[data-fill]` on every bar inner element; `.live-sweep`
     on the live-data container; `.marquee__track` on the top
     ticker.
   - `editorial`: `[data-anim]` only; `[data-parallax]` with
     reduced magnitude on hero imagery; never `[data-flip]` /
     `[data-fill]` / `[data-split]`.
   - `kinetic-grid`: `[data-tile-anim]` on cards; `[data-anim]`
     on section heads.

   Full per-register attribute matrix: `reference/motion-registers.md`
   § Data-attributes consumed.

6. **Inject the `<noscript>` fallback.** Add the no-JS override
   from `reference/motion-runtime.md` § No-JS fallback to `<head>`
   so the file degrades to its static-end state without
   JavaScript.

7. **Update `_provenance`.** Add the `motion` block:

   ```json
   "motion": {
     "register": "<register-name>",
     "registerSource": "direct | user-override | heuristic | extension",
     "runtimeVersion": "v1",
     "lenisAssets": { "js": "lenis.min.js", "css": "lenis.min.css" },
     "attributesEmitted": ["data-anim", "data-countup", ...]
   }
   ```

8. **Hand off to Phase 2.8** (motion validation). The cinematic
   gates in `reference/motion-validation.md` § Pass 6 fire
   automatically because the rendered file declares the
   `_provenance.motion.register` field.

The static `<slug>-proposed.html` is unaffected by this phase.
Both files are reviewable; the brand owner sees the cinematic
version when motion is part of the redesign brief, the static
version when migration / accessibility audit is the focus.

#### Output paths

| File                                | Owner phase           | When            |
|-------------------------------------|----------------------|-----------------|
| `stardust/prototypes/<slug>-proposed.html`   | Phase 2 (always)   | Always written. |
| `stardust/prototypes/<slug>-cinematic.html`  | Phase 2.4 (`--cinematic`) | Written alongside; static remains. |
| `stardust/prototypes/lenis.min.js`           | Phase 2.4 (`--cinematic`) | Copied from skill assets. |
| `stardust/prototypes/lenis.min.css`          | Phase 2.4 (`--cinematic`) | Copied from skill assets. |

#### When to use the static-only path

The static prototype remains the load-bearing artifact for:
- Brand-faithful inheritance reviews (motion is additive — the
  static prototype is the canonical "yes, that's us, refreshed"
  surface).
- Accessibility audits (motion-driven pages are harder to evaluate
  in their reduced-motion state).
- Migration consumption (`migrate` reads the static prototype as
  its primary source. It does **not** merge the cinematic layer —
  per `skills/migrate/SKILL.md` § Phase 2 → Cinematic sibling, it
  carries the motion assets (`lenis.min.*`) through to
  `migrated/assets/motion/` and records
  `cinematic-variant-not-consumed` in the sidecar).

The static prototype must pass every gate independently — the
cinematic layer cannot rescue a static prototype that fails
Phases 2.5–2.7.
