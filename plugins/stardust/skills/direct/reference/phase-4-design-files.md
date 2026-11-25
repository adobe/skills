# stardust:direct: phase 4, DESIGN.md and DESIGN.json

The text of this part of `skills/direct/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 4 — Author target DESIGN.md and DESIGN.json (site-level only)

The boundary is **abstract role vs literal deployment**:

| In DESIGN.md / DESIGN.json (site system) | In `<slug>-shape.md` (page deployment) |
|---|---|
| Token vocabulary (colors, typography, spacing, radii) | Per-page section list and order |
| Voice rules ("Mixed-Case-Headlines"), anti-refs | Literal copy per section (sourced from current/pages/<slug>.json) |
| Anti-toolbox audit, divergence trace | Page-specific layout decisions ("hero is 5/3 split on home") |
| Abstract component vocabulary: `button-primary`, `button-secondary`, `card`, `input`, `badge`, `link` (default treatment, density, sizing — NO page-specific dimensions or content) | Section-level component dimensions (`the211Panel` at 320×260 with dock points per viewport) |
| Named system-component **roles** (a `header` exists, a `footer` exists, a `cta-band` pattern exists) | System-component **deployment** (literal tile labels in fixed order, link targets, copy variants) |
| Default visual treatment for each abstract component | Per-page composition (statRow with literal "100 YEARS · 18,400 PEOPLE HOUSED · …") |
| Voice samples (do/don't, tone exemplars) | Per-page interaction model and key states |

Concrete examples of items that **must not** appear in DESIGN.md /
DESIGN.json:

- Literal tile labels for any system-component pattern.
- Section-level pixel dimensions, dock points, breakpoint-specific
  widths.
- Stat numbers, addresses, quotes, named-person references.
- "On home, the hero is X" — that's a home-page deployment.
- Per-page copy variants ("on the donate page the CTA reads Y").

If a redesign demands a section-level dimension or a literal label
that feels site-wide ("every page has a 211 panel docked at the
bottom-right"), encode it as an **abstract role** in DESIGN.json
(e.g. `extensions.systemComponentRoles.persistent-help` with
purpose / position-class but no literal copy or dimensions) and let
each page's shape brief specify the deployment.

Token sources:

- **`colors`** — from the picked palette (palette-picker.md output)
  or the inherited palette with role-renaming. Role names must
  satisfy toolkit § 4 (brand-native, no `Primary` / `Secondary` /
  `Alarm` etc. as sole role names).
- **`typography`** — from the chosen font deck. Sizes scaled by the
  resolved expressive axis (drenched → ratio ≥ 1.333; committed →
  ratio 1.25; restrained → ratio 1.125-1.2). Heading vs body
  assignments inherit from the deck.
- **`rounded`** — derived from extracted brand-surface
  `borderRadius.primary` mode, unless the direction moves
  distinctiveness toward `singular` (in which case re-derive from the
  font deck's tonal cousins).
- **`spacing`** — 4pt base scale; `sectionPadding` propagated from
  the density tier stamped in Phase 1 (`reference/intent-dimensions.md`
  § 4):
  - `airy` → `sectionPadding.desktop: 96px`, `tablet: 72px`, `mobile: 48px`
  - `balanced` → `sectionPadding.desktop: 64px`, `tablet: 48px`, `mobile: 32px`  ← brand-register default
  - `packed` → `sectionPadding.desktop: 48px`, `tablet: 36px`, `mobile: 24px`  ← product-register default

  The agent does **not** re-ask the density question here — the tier
  was resolved in Phase 1 (asked once when the phrase didn't move
  the axis, defaulted to balanced for brand register if unanswered).
  Pick the value deterministically from the stamp.

  **Hard floor enforcement.** When the captured page inventory shows
  >5 sections OR >2 audience tracks (per
  `reference/intent-dimensions.md` § 4 → "Hard floor for
  brand-register multi-audience sites"), the resolved
  `sectionPadding.desktop` is bounded at ≤ 64px and ≥ 40px on every
  variant including the highest-divergence one. If Phase 1 stamped
  `airy` despite the trigger conditions firing, surface the conflict
  before writing tokens — *"density tier `airy` was selected but the
  captured inventory triggers the multi-audience hard floor; pick (a)
  override floor (`density: airy (user-pinned)` in direction.md) or
  (b) accept the floor (sectionPadding capped at 64px)."* Default to
  (b) when the user does not respond.
- **`components`** — 4-6 canonical components (`button-primary`,
  `button-secondary`, `card`, `input`, `badge`, `link`) populated
  from extracted brand-surface `componentStyle`, with values
  adjusted for direction movements.

Write `DESIGN.json` (schemaVersion 2) with:

- `extensions.colorMeta`, `typographyMeta`, `shadows`, `motion`,
  `breakpoints` — filled from the same sources as DESIGN.md. The
  `motion` block carries the **register selection** (when
  cinematic motion may be applied at prototype time):

  ```json
  "motion": {
    "register": "arrival | kinetic-display | live-systems | editorial | kinetic-grid",
    "registerRationale": "<one-line citation back to PRODUCT.md Brand Personality trait that selected this register>",
    "easings":   { "entrance": "...", "transition": "...", "expo": "..." },
    "durations": { "enter": <ms>, "stagger": <ms> },
    "parallax":  { "translate": <vh>, "fade": <0-1>, "rangeStart": <%>, "range": <%> }
  }
  ```

  Picked per the **register selection heuristic** in
  `skills/prototype/reference/motion-registers.md` § Selection
  heuristic, reading the resolved `PRODUCT.md` § Brand Personality:

  | Personality traits (any match)                                            | Register          |
  |---------------------------------------------------------------------------|-------------------|
  | `civic-formal` + (`institutional` OR `place-led`)                         | `arrival`         |
  | `signage-led` OR `wayfinding-first` OR `display-typography-signature`     | `kinetic-display` |
  | `operationally-transparent` OR `data-led` OR `dashboard-register`         | `live-systems`    |
  | `editorial` OR `slow-paced` OR `publication-register`                     | `editorial`       |
  | `product` OR `SaaS` OR `transactional` OR `modular-catalogue`             | `kinetic-grid`    |
  | (ambiguous / no clear match)                                              | `arrival`         |

  Token defaults per register are sourced from
  `skills/prototype/reference/motion-registers.md` § The five
  registers; `direct` copies them verbatim into the `motion`
  block unless the user has provided overrides during intent
  reasoning. The `registerRationale` field records the one-line
  justification so reviewers can audit the choice. **`direct`
  does not apply the motion** — that happens at prototype time
  under `--cinematic`. `direct` only **selects** the register.
  Pages whose redesign does not need motion can leave
  `register` absent; cinematic prototype will then either ask or
  pick from the heuristic at render time.

  **Per-variant placement (when N > 1 variants).** The `motion`
  block goes into the variant-specific `DESIGN-<id>.json` files,
  not site-level `DESIGN.json` — variants without a `register`
  render static. See `reference/multi-variant.md` § Per-variant
  motion placement.

  When the user's intent phrase contains explicit motion direction
  ("make it cinematic", "feel alive", "move like signage"),
  `direct` picks the register and notes the source in
  `registerRationale` as `"user-phrase: <verbatim>"`.
- `extensions.divergence` — full audit trail per the v2 storage shape
  in `divergence-toolkit.md`. Includes the brand-faithful inversion
  log (per `reference/direction-format.md` § Divergence inputs)
  capturing pure-color or hex-format retentions.
- `extensions.componentStyle` — the **abstract** v1 fields
  (`buttons`, `cards`, `inputs`, `dualCTAPattern`). **Default**
  treatment per component, no per-page dimensions or literal copy.
- `extensions.systemComponentRoles` — the **abstract roles** for
  named cross-page patterns (e.g. `persistent-help`, `cta-band`,
  `header`, `footer`). Each role carries purpose, position class,
  and any site-wide constraint — **not** literal copy, dimensions,
  or per-viewport dock points (those are page-deployment, in
  `<slug>-shape.md`).
- `extensions.voice` — sampled DOs and DON'Ts derived from
  `_brand-extraction.json` voice samples + the resolved tone.
- `narrative.northStar`, `overview`, `keyCharacteristics`, `rules`,
  `dos`, `donts` — derived from the resolved direction. Toolkit § 7
  Optional House Standards land here in `narrative.rules[]`.

Every component HTML/CSS snippet in `components[]` must be
self-contained, use `ds-` class prefixes, and respect impeccable's
hard rules (OKLCH only, no pure black/white, no glassmorphism, no
side stripes, no gradient text, ≥ 1.25 type ratio for brand
register).

#### IA-priority preservation audit (Mode A)

After tokens are drafted but before they land in the variant DESIGN
files, run the IA-priority preservation audit per
`reference/intent-dimensions.md` § 8. For each captured signal that
fires a trigger condition (commercial conversion, search-led IA,
donation funnel, crisis affordance, audience routing), record an
`extensions.iaPriorities[]` entry in `DESIGN.json`:

```json
[
  {
    "signal": "crisis-affordance",
    "evidence": "pages/home.json#landmarks[hero] contains heading 'Looking for immediate shelter?' + phone 801-990-9999",
    "preserveAs": "first-viewport",
    "scope": "site-wide",
    "mutability": "movable"
  }
]
```

Each entry is a constraint that downstream `prototype` and `migrate`
must honor — a variant whose home shape brief omits the crisis
affordance from the first viewport fails the audit and is rejected.
The audit is the structural enforcement of § 8; without it, IA-
priority preservation is a guideline rather than a contract.

The `mutability` field reflects the `ia-fidelity` stamp from Phase 1
(per `reference/intent-dimensions.md` § 9): `locked` under verbatim
(variants may not move the priority at all — A1/A2/A3 are surface
forks), `movable` under reimagined (variants may demote / promote /
re-shape the priority's deployment, but the § 8 floor still fires).
The field is stamped once at Phase 4 and is the source of truth
prototype reads.
