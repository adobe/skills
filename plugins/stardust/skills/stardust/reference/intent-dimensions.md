# Intent dimensions

Stardust does not classify a user's intent into a fixed list of categories.
Instead, every freeform phrase is mapped onto a small set of **dimensions**
that describe the directions a redesign can move along. The agent reasons
about which dimensions a phrase moves and in which direction, then composes
impeccable commands accordingly.

These dimensions are descriptive, not prescriptive. A real intent will move
some, leave others alone, and may pin one or two to a hard constraint.

---

## 1. Register

Inherited directly from impeccable. `brand` means *design IS the product*
(landing pages, marketing sites, brand showcases). `product` means *design
SERVES the product* (dashboards, tools, internal apps).

- Anchors: `brand`, `product`.
- Signals from user phrasing: "marketing site", "landing page", "showcase",
  "campaign" → brand. "Dashboard", "admin", "console", "internal tool",
  "ops" → product.
- Default if unstated: inherit from PRODUCT.md `register` field. If that is
  also unstated, ask.

## 2. Expressive axis

How loud, how committed, how visible the design is. The user's phrase often
moves this axis explicitly ("bolder", "quieter", "more refined").

- Anchors: `restrained`, `committed`, `drenched`.
- `restrained`: muted palette, narrow type scale, system-feeling. Default
  for product register.
- `committed`: distinct palette and type, clear point of view, but functional
  hierarchy intact.
- `drenched`: full saturation, full bleed, expressive type, designed
  surfaces.

## 3. Tone

Emotional register. Independent of expressive axis: a quiet design can still
be playful, a drenched one can still be serious.

- Anchors: `serious`, `neutral`, `playful`.
- Signals: "professional", "trust", "credible" → serious. "Friendly", "fun",
  "approachable" → playful.

## 4. Density

How much space and rhythm the design uses. Often stated as "airy" vs
"information-dense".

- Anchors: `airy`, `balanced`, `packed`.
- Tied to `layout` and `polish` impeccable commands.
- **Defaults:** `packed` for `product` register; **`balanced` for
  `brand` register.** `airy` is the right default only when the
  page is editorial-led with deep per-section density (NYT
  Opinion-tier longform, Pentagram nonprofit, This American Life
  editorial). For the more common brand-register cases —
  multi-audience IA, civic / direct-services nonprofits, B2B
  landing pages with multiple paths — `airy` produces visually
  inert pages where 96px section padding × 7+ short sections
  reads as whitespace-as-padding, not whitespace-as-breath. Pick
  `airy` only when the page genuinely has editorial-density per
  section.

  Tier-to-tokens propagation when direct authors `DESIGN.md`:

  | tier | `spacing.sectionPadding.desktop` | guidance |
  |---|---|---|
  | `airy` | 96px | editorial-led, deep per-section density |
  | `balanced` | 64–72px | brand-register default; multi-audience or short sections |
  | `packed` | 40–48px | `product` register or data-dense sites |

  See `direct/SKILL.md` § Phase 1 for the one-shot prompt direct
  uses when the user's phrase doesn't move the density axis.

  **Hard floor for brand-register multi-audience sites.** When the
  extracted page inventory shows **>5 sections on the home page**
  OR **>2 audience tracks** (e.g. donate × volunteer × help × about
  for nonprofits; product × careers × blog × support for B2B; shop
  × story × locations for retail), the per-variant
  `sectionPadding.desktop` is **bounded at ≤ 64px and ≥ 40px on
  every variant**, including the highest-divergence variant in a
  multi-variant fork.

  Editorial-airy (96px+) is **opt-in only** — explicit user
  instruction (*"make it airy"*, *"more breathing room"*,
  *"editorial spacing"*), or an explicit `direction.md` note
  (`density: airy (user-pinned)`). The agent does not pick `airy`
  on its own initiative for brand-register multi-audience sites.

  Tighter density (48–56px) is **preferred** when the existing
  site has commercial-conversion priority (a product grid, a
  configurator, a primary-CTA verb of `buy`/`shop`/`donate`/
  `apply`/`register`) or recipient-audience priority (a crisis
  affordance in the first viewport, a 211-shaped panel, a
  location-finder).

  Rationale: the brand-register sites that most need the migration
  path are nonprofits, civic orgs, and B2B with multi-audience IA.
  96px section padding × 7 short sections reads as
  whitespace-as-padding (visually inert), not whitespace-as-breath
  (visually generous). Worse, it pushes the load-bearing
  affordances below the fold — burying the crisis line, the
  conversion CTA, or the audience-routing UI under a stunning hero
  is a brand-fidelity failure regardless of how good the
  typography is.

## 5. Distinctiveness

How willing the design is to leave familiar territory. This is the axis the
divergence toolkit polices.

- Anchors: `familiar`, `distinctive`, `singular`.
- `familiar`: pattern-matched to category leaders. Lower risk, lower memory.
- `distinctive`: clearly itself, but legible to anyone in the category.
- `singular`: unmistakable. Reserved for brand register with strong
  conviction.
- Stardust *forbids* `familiar` from collapsing into AI-default training
  reflexes (cyan/purple gradient SaaS, dark-mode-by-reflex, glassmorphism
  hero). The divergence toolkit catches these.

## 6. Audience

The audience is not a slider. It is a tuple of demographics, context, and
reference set.

- Capture: who, in what context, with what cultural references.
- Examples: "young, urban, design-aware" / "enterprise procurement, on a
  27-inch monitor at 9 a.m." / "first-time API users, mostly mobile, mostly
  developing markets".
- Audience anchors a "scene sentence" (impeccable concept) — a one-line
  description of where, when, and how the design will be encountered.

## 7. Constraint set

Hard guardrails the redesign must respect. These are not directions; they
are walls.

- Common constraints: `a11y-first`, `perf-first`, `brand-faithful`,
  `clean-slate`, `legacy-content-preserved`, `RTL-required`, `print-ready`.
- Constraints take precedence over the user's stated direction. A
  `brand-faithful` constraint plus a "make it bolder" intent means *bolder
  within the existing brand palette*, not *swap the brand*.

## 8. IA-priority preservation (Mode A constraint)

Brand-faithful inheritance includes the *page's IA priority*, not just
its tokens. The IA priority is the visible answer the page gives to
"who is this for, and what should they do here?" For most extracted
sites that get a refresh, the IA priority is itself a brand asset —
sometimes the most load-bearing brand asset on the page. A redesign
that preserves the palette and the type while replacing the IA
priority misses the brand entirely.

#### Trigger conditions

When the captured page (`stardust/current/pages/<slug>.json`) shows
**any** of the following signals, the IA-priority preservation rule
fires for every Mode A variant:

- **Commercial conversion** — `>3 product/program/service cards above
  the fold`, or a configurator / product-finder component, or a
  primary-CTA verb of `buy`, `configure`, `shop`, `find your`,
  `add to cart`, `checkout`.
- **Search-led IA** — a search or filter row in the hero region (an
  `<input type="search">` or a `[role="search"]` element rendered
  above the fold).
- **Donation funnel** — primary CTA verb of `donate`, `give`,
  `support us`, `contribute` rendered as a styled button above the
  fold.
- **Crisis / safety affordance** — a phone number, hotline, or
  immediate-services panel rendered in the first viewport (the
  `T-cross-promo` cluster from extract often surfaces these as
  recurring page-level blocks; the Crisis-Line Block detected on
  theroadhome.org is the canonical example).
- **Audience routing** — multiple distinct audience CTAs rendered
  above the fold (e.g. *"Get help"* + *"Donate"* + *"Volunteer"* on
  a nonprofit home; *"Shop"* + *"Trade"* + *"Press"* on a retail
  home; *"For Developers"* + *"For Buyers"* + *"For Enterprise"* on
  a B2B home).

#### Rule

When the trigger fires, every Mode A variant must:

1. **Preserve the IA priority in the same first-viewport position.**
   The conversion path / crisis line / search row / audience router
   stays above the fold and remains the most visually prominent
   actionable element on the page. Variants may *change the visual
   treatment* of the IA priority (it can be redesigned) but cannot
   *replace it with a generic full-width hero* or *push it below the
   fold to make room for a stunning headline*.

2. **Not invert the audience hierarchy.** If the captured site
   leads with the recipient audience (crisis affordance first,
   donor band below), variants do not flip to donor-first. If the
   captured site leads with the donor audience, variants do not
   flip to recipient-first. The hierarchy is part of the brand —
   stardust does not reposition the brand strategically; that's
   a separate decision the customer makes outside the redesign loop.

3. **Reuse the existing IA verbs unless the improvements list calls
   them out.** When the captured site uses *"GET HELP"* / *"DONATE"*
   / *"VOLUNTEER"* / *"GIVE"*, variants reuse those verbs verbatim
   unless the improvements list (`<slug>-improvements.md`)
   explicitly flags one as a clutter / fragmentation tension and
   declares the canonical replacement. Renaming *"GET HELP"* to
   *"FIND HELP"* / *"FIND SHELTER"* / *"YOU CAN FIND HELP"*
   silently is an off-brand move under Mode A.

#### Render-refusal

A variant that:

- replaces a search-led hero with a full-width photo + headline,
- buries the crisis line in a sticky bottom bar to make room for
  display type,
- demotes the donation funnel to a footer link,
- silently rewrites the audience-router verbs,

is rejected at the Phase 4 / prototype shape-brief audit stage.
Surface the violation explicitly and either revise the variant or
demote it to a *"rebrand-shaped"* slot (which requires `--rebrand`
to be set — under default Mode A, the violation simply fails).

#### Note for product-register sites

The IA-priority preservation rule applies primarily to brand-register
sites (the common stardust use case). For product-register sites
(dashboards, admin tools, internal apps), the equivalent rule is
*workflow-priority preservation*: the primary task path on the page
stays the primary task path. The same principle, different surface.

---

## Reading a phrase

When reasoning about a user's phrase:

1. List the dimensions it explicitly mentions.
2. List the dimensions it implicitly moves (e.g., "more expressive" almost
   always moves the **expressive axis** and often **distinctiveness**).
3. List the dimensions it leaves alone — those keep their current value
   from PRODUCT.md, the existing site, or the prior `direction.md`.
4. Identify the constraint set if any constraint is implied or stated.
5. Identify what is missing. Audience and constraints are the most
   commonly underspecified — these are the questions worth asking.

The full reasoning procedure lives in `intent-reasoning.md`.
