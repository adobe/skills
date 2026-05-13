# Divergence Toolkit

Shared inputs used by the `stardust` pipeline (primarily `direct` when it
authors the target `DESIGN.md` / `DESIGN.json`, and `prototype` when it
generates variants) to push back against the assistant's recurring default
moves.

Loaded whenever a skill is about to make a visual decision without a strong
external reference.

**Status:** v1.0 (stardust v2). The anti-toolbox list below was
compiled as a self-audit of recurring assistant moves and expanded
across successive test runs. It is deliberately imperfect.
Designers should add corrections in §6 over time; that section is
authoritative when it conflicts with §1.

Storage location: `DESIGN.json.extensions.divergence` (impeccable's
sidecar reserves the `extensions` block for tool-specific data).
§7 Optional House Standards land in `DESIGN.json.narrative.rules[]`
(impeccable's canonical voice-rules slot).

---

## 1. The Default-Moves List

These are recurring moves the assistant tends to reach for when asked to be
"distinctive", "anti-generic", or "unexpected" — regardless of the brand's
subject matter. Left unconstrained, they appear across unrelated brands and
produce visual convergence.

**Enforcement model:** every move from this list that appears in a
profile requires a per-hit brand-specific justification. No free
quota. See the *Enforcement · per-hit justification* block at the
bottom of this section.

### Typography moves
- Stencil display type (Big Shoulders Stencil Display, Oswald Stencil, similar)
- Monospace used for body microcopy / metadata as a load-bearing device
- Italic expressive serif used for single-word accents (Fraunces italic, similar)
- Blackletter used as a display accent (UnifrakturMaguntia, similar)
- Handwritten / caveat used as marginalia (Caveat, Homemade Apple, similar)
- UPPERCASE condensed sans as the primary display register

### Motif moves
- Rotated circular stamps with perimeter text
- 45° hazard stripes (yellow + ink, or similar two-tone alternation)
- Hard non-blur drop shadow on display headlines (offset 6–14px)
- SVG noise / grain overlay on backgrounds
- Oversized display numerals as section markers (§ 01 ·, 01, etc.)
- Coordinate / lat-long / serial metadata stamps
- Redacted black-bar censor over words
- Serial-number stamping in footers ("BATCH 0712")
- Ticker / marquee band scrolling across top or bottom
- "MOD. YYYY · City" archival stamp in mastheads
- **Collage-maximalism kit** — combination of any 3 of these 6 moves in one layout: rubber/wet-paint stamps · handwritten annotations · pinned cards with drop shadows · rotated date-blocks · ripped/torn paper edges · typewriter-style captions. This is the assistant's own maximalism archetype, not a neutral default.

### Voice-rule moves
- "Sentences earn their length / a short one and a long one" cadence rule
- Quartermaster / examiner / curator register as the default voice stance
- Triplet-cadence pull-quote or section-headline copy — three short clauses of comparable length separated by period or em-dash (e.g. *"Same press. Same shop. Same eight years."* · *"Dated, classified, cross-linked."* · *"Saturday. Bar Beach. We dance."*). Detection: a display-level sentence that breaks into exactly 3 clauses with no subordinate structure. At most one per page before it becomes a tell.
- **Editorial-register vocabulary applied to non-editorial brands** — *"atelier"*, *"the studio"*, *"the journal"*, *"mise-en-place"*, *"dispatches"*, *"catalogue"*, *"the field guide"*, *"the manifesto"*, *"the broadcast"*, *"the bulletin"* applied to product-commerce, direct-services, civic, B2B, or healthcare brands whose register is not editorial. The assistant reaches for editorial vocabulary regardless of the brand's actual register; the result reads as cosplay, not as voice. Detection: any of the listed terms appears in `voice.do` / section eyebrows / nav labels / page sub-titles when `register != editorial` and `register != memoir-adjacent` per the resolved direction.

(The "ban marketing adjectives", "no exclamation points except …", and "em-dashes welcome / semicolons earned" rules are sensible universal voice rules and live in § 7 Optional House Standards rather than § 1. They do not count toward the divergence audit.)

### Structural moves
- Sticky top navigation
- Numbered section eyebrows (§ 01 ·, § 02 ·, …)
- Masthead block with metadata stamp
- Palette swatch grid (equal-width cells, side-by-side)
- Two-column voice do / don't panel
- Motif card grid with fixed-size demo tiles
- Archival footer strip with batch + serial
- **Generic-2026-SaaS silhouette** — oversized sans-serif hero (clamp(72px, 10vw, 140px)) + two-button CTA pair (solid primary + outlined secondary) + sticky top-nav + serial-marker footer, rendering as a Linear / Notion / Stripe / Arc landing page. This is a composite move: **any 3 of those 4 together** counts as a hit.
- **Stat-callout bar** — 3–4 large numbers with short all-caps labels arranged horizontally as a "trust bar" ("61 firms · 34 patents · 17 years"). Very Stripe press page.
- **Hero text on photographic background without contrast scrim** — display headline overlaid on a photographic image without a darkening scrim (≥0.4 opacity black layer, or a directional gradient that brings the headline area to ≥4.5:1 contrast against the photo's average luminance under the headline). Almost always fails WCAG AA on photos with high-luminance regions (sky, snow, faces). Cheap to enforce: any hero where computed contrast under the headline drops below 4.5:1 against the rendered background pixel average is a hit. Add a scrim or move the headline off the photo.

### Multi-variant moves

Failure modes specific to multi-variant forks (`direct` invoked with N>1
variants, per `direct/SKILL.md` § Phase 2.6 — Multi-variant fork). These
fire on the *definition* of a variant, not on its rendered output, so
they are caught by reading the variant's shape brief / direction
section rather than scanning the prototype HTML.

- **C-cliff overshoot** — variant N>1 defined as *"everything from B
  but more"*, *"120pt+ display fonts"*, *"96px+ section padding
  everywhere"*, *"extreme airy"*, *"more brutalist"*, *"more
  editorial"*, or any *"more <axis>"* framing. Slider positions
  pushed past the previous variant are not directions. C+ must
  amplify a specific captured trait, not push a slider further. The
  failure mode is named for the observed pattern where a 3-variant
  fork has A defensible, B defensible, and C reading as
  *"unprofessional"* rather than *"a third proposition"*. The fix
  is not to soften C — it is to redefine C against a captured trait
  instead of against B.

- **Anonymous middle variant** — variant B (or any non-A variant)
  whose shape brief does not declare *which* captured trait is being
  amplified *in service of which* brand-personality move. *"B leans
  into IA rearrangement"* is not a declaration — *"B amplifies the
  named-people story treatment that the captured site underplays
  (rendered as 280×180 thumbnails) in service of the
  trust-through-faces personality trait from PRODUCT.md"* is. Refuse
  render until the declaration lands in the variant's shape brief or
  in `direction.md` § Variants.

- **Variant homogeneity** — two variants in the same fork that
  differ by fewer than 2 substantive changes (section sequence,
  section presence, layout strategy of a major section, IA priority).
  Per `direct/SKILL.md` § Variant differentiation contract,
  variants that differ by < 2 changes are the same variant under
  different chrome. Refuse render and either collapse the redundant
  pair into one variant or redefine one of them against a different
  captured trait.

### Universal hardening

- **Fabricated content** — stats, addresses, named-customer logos,
  named-person quotes, dollar amounts, percentages, and dates
  invented to fill design space. Detection: any number, name, or
  citation in the rendered prototype that does not appear in
  `stardust/current/pages/<slug>.json`,
  `stardust/current/_brand-extraction.json`, or the user's explicit
  input. Placeholders are mandatory when real data is absent — use
  an explicit `data-placeholder="true"` attribute and a visible
  signature treatment (dashed outline, "PLACEHOLDER" eyebrow label,
  or thevisual signature when defined) so reviewers see the
  gap rather than a fabricated value. *"100 YEARS · 18,400 PEOPLE
  HOUSED · 87% STABLY HOUSED"* invented for a stat-row when the
  captured site doesn't carry those numbers is the canonical
  violation; it surfaces in the prototype as a confident claim that
  the brand team will then have to disavow to a stakeholder.

### Palette-role moves
- Role vocabulary: *Primary / Secondary / Alarm / Warning / Shadow / Hardware / Ink*
- "Alarm" as a distinct role name for a saturated accent
- "Shadow" as a distinct role name for a deepened primary

### Palette-family moves

Recurring *palette families* — not individual hex values, but combinations of ground + accent + secondary that the assistant reaches for across unrelated brands. A brand profile whose dominant tones fall into one of these families is a hit, even when individual hex values differ.

- **"Archival editorial palette"** — cream/paper ground + warm-family saturated accent (rust / brick / pomodoro / burnt-orange / oxblood) + muted earth-tone secondary (olive / mustard / ochre / fennel). The assistant's "serious-but-warm editorial" default; recurs across unrelated brands even when nothing in the brief calls for it.

- **Cream-family page ground — INCLUDING ALL REBRANDS.** The page body background is in the cream / paper / warm-neutral family, regardless of what the brand-native role name calls it. This is the single most-abused default — cream was rationalised across test runs as `vellum`, `kami`, `parchment`, `washi`, `bone`, `oatmeal`, `eggshell`, `ivory`, `biscuit`, `tan`, `wheat`, `fawn`, `sand`, `linen`, `canvas`, `manila`, `calfskin`, `morocco-cream`. Renaming cream does not change what it is.

  **Deterministic hex test.** A page-body ground is a cream-family hit when ALL of the following are true:
  - Hex lightness (HSL `L`) is between **80 and 97** (exclusive of pure white)
  - **Warm bias**: in raw RGB channels, `R − B ≥ 5` — the color is measurably warmer on the red side than the blue side
  - Hex saturation (HSL `S`) is below **40%**

  The raw-channel warm-bias check (`R − B ≥ 5`) is a strict discriminator that catches subtle warms (vellum, kami, oatmeal, bone) while keeping pure grays out — pure grays are routed to pale-gray or stark-white instead.

  Examples that hit: `#F3EAD2` (R−B=33), `#F0E8D5` (R−B=27), `#F5EED8` (R−B=29), `#EDE0B9` ("kami", R−B=52), `#F0E5C8` (R−B=40), `#FBF1D9` (R−B=34), `#EADDB7` (R−B=51), `#F8F1DE` (R−B=26).
  Examples that pass (are NOT cream): `#FFFFFF` (pure white — L too high), `#F5F5F5` (pure neutral gray — R−B=0), `#CCCCCC` (pure gray — R−B=0), `#D4E2E8` (cool gray — R<B), `#E8ECEE` (cool near-white — R<B), `#1E1A17` (dark — L too low), `#C23B33` (saturated red — S too high).

  **Justification bar.** The only acceptable justification is: "the brand's primary business is *literally* printing, publishing, paper goods, binding, or stationery — cream is the substrate of the product, not a mood choice." *Adjacent registers* (liturgical program, field guide, museum didactic, auction catalogue, travel brochure) are NOT sufficient on their own — they must combine with the brand being in that category.

  When in doubt, pick a non-cream ground from the §2 ground-family seed.

- **"Brutalist pomodoro palette"** — ink-black primary + cream/bone ground + one saturated red/orange alarm. The Nonna's Arsenal baseline palette; appears whenever the brand is "serious" or "archival". A hit specifically when the saturated accent occupies < 5% of surface area (used only for alerts / CTAs) — at that dose it reads as the assistant's signature.

- **"Dark mode editorial"** — ink/black ground + cream/bone text + one saturated accent. The inverted version of the brutalist pomodoro.

### Enforcement · per-hit justification

Before emitting `brand-profile.json`, the skill scans the profile against the
lists above and populates:

- `_divergence.anti_toolbox_count` — total count of moves matched
- `_divergence.anti_toolbox_hits[]` — each hit as `{ move: string, justification: string }`

**No free quota.** Every hit requires a per-entry justification naming why
this specific brand warrants this specific move. "Fits the aesthetic" is not
a justification. "Feels right" is not a justification. A justification names
a brand-specific reason that would not transfer unchanged to an arbitrary
other brand. For example:

- ✅ "the 11-ply deck structure makes the 11-stacked-hairlines motif a direct
  product reference, not a generic divider"
- ✅ "letterpress traditionally prints on cream stock, and the brand IS a
  print-publishing category, so cream is the substrate of the craft, not an
  assistant default"
- ❌ "a travel decal, not an archival stamp" (wording change, not a reason)
- ❌ "feels right for the brand" (no brand-specific reason)

If the assistant cannot write a brand-specific justification for a hit, the
move must be removed or replaced with an off-toolbox alternative. Populate
`_divergence.off_toolbox_moves[]` with the replacement.

### Self-audit · rationalisation check

Before finalising the profile, the assistant asks itself three questions
and records the answers in `_divergence.audit_adjustments[]` when any
adjustment is made.

1. **Hit audit.** For each entry in `_divergence.anti_toolbox_hits`, would a
   reviewer who knows the assistant's defaults agree this is a hit or a
   near-hit? A "travel decal" that is a rotated circular stamp with
   perimeter text IS a rotated circular stamp. Rewording the motif to sound
   brand-specific does not change what it is. If you cannot answer "yes, a
   reviewer would call this a hit" for an entry, the justification is
   probably cover for a rationalisation — strengthen it or remove the move.

2. **Off-toolbox audit.** For each entry in `_divergence.off_toolbox_moves`,
   would a reviewer call it a genuine invention or a dressed-up default?
   A "ply-strata rule divider" with 11 stacked hairlines specific to an
   11-ply product is a genuine invention — it could not exist for any other
   brand. A "dispatch decal" that happens to look like a rotated circular
   stamp is a dressed-up default. Be strict. If the move could transfer
   unchanged to another brand in another category, it is not really
   off-toolbox — demote it to `anti_toolbox_hits` with a justification, or
   remove it.

3. **Triplet-copy audit.** Scan all headline, pull-quote, and marketing copy
   for the triplet cadence (X. Y. Z. — three short clauses of similar
   length). At most one triplet per page. Any second triplet on the same
   page is rewritten.

When the self-audit moves an entry between lists, record the move in
`_divergence.audit_adjustments[]` with `{ from: "off_toolbox_moves",
to: "anti_toolbox_hits", move: "...", reason: "..." }` — or the reverse, or
`{ from: <list>, to: "removed", ... }` when the self-audit deletes a move
outright.

---

## 2. Seed Lists

When the user has not provided a strong external reference (no brand URL, no
moodboard, no uploaded images), the `brand` skill picks one seed from each
list below and injects them as hard constraints into the generation prompt.

### Decade
1920s · 1930s · 1950s · 1960s · 1970s · 1980s · 1990s · 2000s · 2010s · 2025-now

### Craft tradition
Letterpress · Riso print · Embossed leather · Woodblock poster · Terrazzo ·
Enamel sign · Ceramic transfer · Cross-stitch sampler · Technical illustration ·
Field guide · Map engraving · Tailor's pattern paper · Wood-veneer marquetry ·
Folded-paper ephemera · Neon bending · Photogram · Plaster cast · Mosaic tile

### Cultural register
Tabloid · Memoir · Field guide · Legal contract · Zine · Broadcast captioning ·
Railway timetable · Museum didactic · Repair manual · Liturgical program ·
Supermarket flyer · Real-estate listing · Pharmacy insert · Auction catalogue ·
Travel agency brochure · Sports scorecard · Hospital discharge paperwork

### Ground family · the 4th dimension

Cream is the assistant's most-abused default — test runs converged on cream grounds across unrelated brands (rebranded as "kami" or rationalised by chassis carveouts). This dimension caps cream mathematically at **1 in 6 runs** by deterministic random.

Six options:

- **`cream`** — warm-neutral ground (cream / paper / warm off-white). The assistant's default instinct — now one option among six rather than the invisible substrate.
- **`stark-white`** — true white (#FDFDFD–#FFFFFF), high-contrast mode. Often paired with saturated accents. Good for medical / editorial / minimalist registers.
- **`pale-gray`** — cool neutral, low-saturation gray-blue (#E8ECEE / #F0F2F5 / #DDE2E6). Good for legal / technical / ops registers where cream is a cliché.
- **`saturated`** — the brand's own saturated color as the page ground, not as an accent. Orange page / teal page / oxblood page / avocado page. Forces the accent-family to become the *substrate*.
- **`dark`** — ink / deep charcoal / true black as the page ground. High-contrast text in bone, cream, or a saturated accent. Good for broadcast / night / editorial-noir registers.
- **`monochrome-tint`** — a tinted neutral that is NOT cream. Cool slate, warm gray-rose, sage-adjacent gray, dusk-blue gray. Anything whose saturation is 5–20% and whose hue is outside the 20°–60° warm-yellow band.

The picker is a deterministic-random pick from these six (byte[3] of the seed hash mod 6), weighted equally. Cream therefore lands on ~1/6 of no-reference runs. Designer override is allowed and recommended for brands in print/paper/publishing categories (manually set `ground: cream`).

### Picking a seed

**Deterministic random (4 dimensions now):** concatenate `brand.name + ISO-date (YYYY-MM-DD)`, compute an MD5 hash, then index into each list using successive bytes of the hash modulo list length:

- `byte[0] % len(Decade)` → decade
- `byte[1] % len(Craft)` → craft
- `byte[2] % len(Register)` → register
- `byte[3] % 6` → ground-family (0=cream, 1=stark-white, 2=pale-gray, 3=saturated, 4=dark, 5=monochrome-tint)

Designers can reproduce the seed for audit by running the same concatenation through any MD5 utility.

**Manual override:** a designer may pick any dimension explicitly; in that case set `_divergence.seed.picked_by = "designer"`. Mixed picks (some dimensions hashed, some designer-picked) are valid — record per-dimension overrides in `_divergence.seed.overrides[]`.

The full seed quadruple is stamped in `_divergence.seed` and forwarded to every downstream skill as a constraint.

### How the seed is used

The seed is not decoration. It is a hard constraint on the brand profile's
visual translation:

- **Decade** guides typography register and motif idiom (a 1977 seed → retro
  magazine slab; a 1990s seed → rough-edged early-web; a 1930s seed →
  Bauhaus functional; a 2025-now seed → current editorial).
- **Craft tradition** guides texture, print artifacts, and motif vocabulary
  (letterpress → ink bleed and kiss-impression; Riso → off-register color;
  terrazzo → speckled ground; folded-paper ephemera → creases and flaps).
- **Cultural register** guides voice tone and structural metaphor (legal
  contract → dense clauses, signed; tabloid → bold headlines, quoted
  outbursts; repair manual → numbered steps, warnings).

A profile whose visual moves cannot be traced to the seed is suspect. In
that case, either regenerate or pick a different seed with designer
awareness.

---

## 2.5 · Dimension Weighting

The four seed dimensions govern different layers of the visual system. This makes the seed load-bearing and enables meaningful within-run variant divergence.

| Dimension | Governs |
|---|---|
| **Decade** | Type deck selection (see § 3), period-appropriate cultural references, display-type register, image/photography era |
| **Craft tradition** | Texture, motif idiom, print artifacts (misregistration, ink bleed, folds, embossing), material metaphor |
| **Cultural register** | Voice stance, structural metaphor (table · manifest · itinerary · ledger · docket · inventory), information architecture |
| **Ground family** | Page body background family. Constrains the actual hex picked for the ground — a `saturated` ground means the ground IS the brand's saturated color (not a cream plus saturated accent); a `dark` ground means bone/cream text on ink (inverting the default). See § 2 *Ground family · the 4th dimension* for the six options and how the hex picker resolves within each. |

### Within-run variant variance via dimension dominance

When producing multiple prototype variants for the same brand, each variant should let one seed dimension dominate while the others recede. Stamp the dominant dimension in each prototype's header comment.

Example (Yadda Dey · seed = 1960s × folded-paper × travel brochure × ground: cream):
- Variant A — **decade-dominant** (1960s Africa-modernist palette and type lead; craft and register recede; ground respected)
- Variant B — **craft-dominant** (folded-paper physicality leads — actual fold-crease shadows, die-cut dog-ears, serrated edges)
- Variant C — **register-dominant** (travel brochure idiom leads — itinerary tables, route maps, ticket edges)

This is a structural tool, not a rigid rule. A variant may combine two dimensions if the brand warrants it; pure single-dimension dominance is the starting configuration, not the endpoint.

### Note on the retired "Ground color by seed" table

An earlier toolkit version shipped a table that mapped decade+craft+register combinations to appropriate grounds, with cream permitted for many combinations. In testing, that table became a carveout the LLM used to justify cream on most brands. It was replaced with the **ground-family seed dimension** in § 2 so the ground is picked *before* the LLM reasons about the brand — removing the opportunity for post-hoc rationalisation.

If a designer is confident cream is right for a specific brand (print-publishing category, paper-goods product), manually override `_divergence.seed.ground = "cream"`.

---

## 3. Font Decks

Named decks of 3–5 fonts. The skill picks one deck per run (or the designer
picks); cross-deck mixing requires `_divergence.divergence_justifications`
entries naming why a specific out-of-deck face belongs.

- **editorial-archival** — Fraunces · Big Shoulders Stencil Display · JetBrains Mono
- **tactile-humanist** — Plus Jakarta Sans · Inter · Geist Mono
- **retro-italian** — Alfa Slab One · Yeseva One · VT323
- **zine-maximalist** — Homemade Apple · Special Elite · Abril Fatface · Bungee Shade · DM Serif Display
- **swiss-modernist** — Inter Tight · Inter · Iosevka
- **bauhaus-functional** — Space Grotesk · Martian Mono · Roboto Slab
- **serif-luxury** — DM Serif Display · Cormorant Garamond · IBM Plex Sans
- **bureaucratic** — IBM Plex Serif · IBM Plex Mono · IBM Plex Sans Condensed
- **broadcast** — Source Sans 3 · Courier Prime · Georgia
- **handmade-signwriter** — Rubik Wet Paint · Libre Caslon Text · Syne Mono

The chosen deck is recorded in `_divergence.font_deck`. Fonts outside the
deck must each be justified in `_divergence.divergence_justifications`.

When the seed from §2 strongly implies a deck (e.g., 1977 + letterpress +
tabloid → `retro-italian` or `handmade-signwriter`), pick from the implied
set. When multiple decks fit, pick deterministically from the hash.

### Reflex-reject fonts

A family of fonts the assistant reaches for across unrelated brands
because they read as "modern editorial" in current training data.
Drawn from cross-brand dogfood evidence: when no captured surface
pins the type, these are the families that recur regardless of
brand register. Used by `prototype` Discipline 6 (the reflex-reject
font pre-flight) — `≥ 3` hits in a single page's declared
`font-family` declarations refuses the file with a substitute
proposal.

```
Fraunces, Cormorant Garamond, Space Grotesk, IBM Plex Sans,
Instrument Serif, Inter, DM Sans, Lora, Playfair, Crimson,
Newsreader, Syne, Outfit, Plus Jakarta Sans, Instrument Sans,
Sora, Manrope
```

Substitute table (dimensional equivalents, off the reflex list):

| Reflex | Dimensional role | Substitutes |
|---|---|---|
| Fraunces | serif-luxury display | GT Sectra · Eczar · Sorts Mill Goudy |
| Cormorant Garamond | serif-luxury editorial | Spectral · Reckless · Editorial New |
| Space Grotesk | geometric-sans display | Bricolage Grotesque · GT Standard · Söhne |
| IBM Plex Sans | workhorse body | Hanken Grotesk · Söhne · Diatype |
| Inter | utility body | Hanken Grotesk · GT America · Söhne |
| Playfair | high-contrast serif display | Tiempos Headline · Domaine Display · GT Super |
| DM Sans | neutral display sans | Söhne · GT Walsheim · Mona Sans |
| Plus Jakarta Sans / Manrope / Outfit | rounded humanist sans | Hanken Grotesk · GT Walsheim · Bricolage Grotesque |
| Instrument Serif | display editorial | Reckless · GT Sectra · Editorial New |
| Newsreader / Crimson / Lora | reading serif | Spectral · Source Serif · Tiempos Text |

**Refusal contract.** When prototype's reflex-reject pre-flight
counts `≥ 3` hits, refuse to write and surface the substitute
proposal with the dimensional role each substitute fills.
Mode-A renders with captured display + body families pinned bypass
the check entirely (the families are inherited, not chosen) — the
check fires only on rendered files whose `font-family` declarations
the agent had freedom to pick.

### Font deck — expressive positions

Off-deck accent fonts ship with named **expressive positions**, not
just style-class slots. The vocabulary below is the authoritative
list `prototype` Discipline 7 reads when an expressive accent face
is engaged on a page:

- **`marginal-tag`** — hand-drawn annotation in a 0–4° rotation,
  ≤ 2 per page. Caveat / Homemade Apple / Reenie Beanie shapes,
  pointing at a heading or sitting in a margin gutter.
- **`pointer-scribble`** — directional arrow + ≤ 3-word callout
  pointing at a heading or a key beat. Typically Caveat or a
  hand-drawn SVG; the arrow is part of the lockup, not a separate
  ornament.
- **`headline-callout`** — single-line emphasis inside or beside a
  Display headline. The expressive face is the only italic / cursive
  word in the line; the rest stays in the display deck.
- **`badge-fill`** — short uppercase label inside a yellow / colored
  chip. Acts as eyebrow chrome rather than as headline.

Any off-deck face that doesn't fit one of these positions is a
reflex pick, not an expressive position; the divergence-justification
slot must name the position explicitly when introducing it.

### Non-template move bank

The closed list of non-template moves `prototype` Discipline 3
draws from when a per-page `surprise` tier is `medium` or `high`.
Each move is a substitution for a captured cliché pattern; pages
declare which move they're applying in
`<slug>-shape.md#surpriseMoves[]` with a captured-source citation.

- **Typographic substitution** — text-line / ledger-row replacing
  a tile grid. The captured 5-up image-card grid becomes a typed
  index, ledger, or running list. Carries the same content set.
- **Substrate-promotion** — background color promoted from accent
  (≤ 10% surface area) to page ground (≥ 50%). The brand's accent
  becomes the substrate; the prior ground becomes the accent.
- **Inversion** — negative-space dominant where original was
  content-dominant. Hero is mostly empty; the headline anchors a
  composition framed by ground rather than supporting copy.
- **Document-shape** — table / ledger / index card / poster /
  docket / zine spread replacing a card grid. The page adopts the
  document's structural rhythm (per-block substrate, per-spread
  layout, etc.).
- **Scale-displacement** — one element rendered at 4–8× normal
  size; others at 0.5×. The display headline becomes the page's
  primary structural element, with body text receding to caption
  scale.

Worked examples per move live in
`skills/prototype/reference/anti-template-bank.md`.

---

## 4. Role-Naming Rule

Palette `role` values in `brand-profile.json` MUST be named in the brand's
own language, drawn from its subject matter, content pillars, or founder
biography. Generic role slots from the assistant's mental model are
forbidden on new writes.

### Forbidden generic role names

If any of these appear as the sole role name (not as a qualifier in a
separate `use` field), the skill refuses to emit and retries:

- Primary · Secondary · Tertiary
- Alarm · Warning · Danger
- Shadow · Hardware · Ink (as roles; as color *names* they are fine)
- Accent · Background (as roles; as technical tokens they are fine)

### Accepted — brand-native role names

Role names that reference the brand's world. Examples:

- A tomato brand: "Pomodoro", "Grove", "Crate", "Dispatch", "Kitchen counter"
- A horror publisher: "Wormsalt Black", "Oxblood", "Sulphur", "Bone", "Tooth"
- A bank: "Ledger", "Receipt", "Vault", "Drawer", "Coin"
- An astronomy club: "Zenith", "Perigee", "Penumbra", "First light"
- A municipal skate park: "Deck", "Coping", "Bowl", "Rail", "Sticker"

The role may carry a technical qualifier in a separate `use` field — that
field is where "background", "primary text", "CTA fill" live:

```json
{ "name": "Pomodoro", "hex": "#C13A1D", "role": "Pomodoro", "use": "accents, CTAs, tomatoes" }
```

### Why this rule exists

When role names are generic, the palette is ported from the assistant's
mental model; only the hex values differ between brands. When role names are
brand-native, the palette must be reasoned about in the brand's terms, which
makes the brand harder to interchange.

---

## 5. Reference-Use Discipline

When the designer provides a listicle or trend-article as a reference (e.g.,
"web design trends 2026", "best websites of the year"), the skill does NOT
ingest it uncritically. It:

1. **Extracts all** named trends/examples from the reference, not a subset.
2. **Tags** each trend against §1 as either "in-toolbox" (matches a default
   move) or "off-toolbox" (a move the assistant does not usually reach for).
3. **Requires** at least **one off-toolbox trend per variant** when multiple
   variants are being produced.
4. **Refuses** a variant whose trends are a subset of the toolbox —
   confirmation-biased reference use that justifies the defaults with the
   article's vocabulary.

The tagged trend list is stored in `_divergence.references_used[]` with each
entry carrying `{ source, trend, tag }`.

### Why this rule exists

Reference articles are easy to cherry-pick. The assistant can highlight the
4–5 trends that align with its existing toolbox and ignore the 10+ that
would disrupt it, then claim the result is "trend-informed". Forcing the
full list to be extracted — and at least one off-toolbox item to be used —
prevents the reference from becoming rubber-stamp validation.

---

## 6. Designer Corrections

This section is authoritative over §1 when they conflict.

Designers should add, remove, or annotate moves here as they notice patterns
the self-audit missed. Format each entry as:

```markdown
- **[add|remove|annotate]** `<move name>` · <date> · <designer>
  — <one-line reason>
```

### Entries

_None yet. This section is intentionally empty on the first release and
grows as designers notice defaults the assistant didn't self-identify._

---

## 7. Optional House Standards

Rules that are defensible for many brands but should not be counted against
the divergence budget. Brands that opt in stamp them in
`DESIGN.json.narrative.rules`. They do NOT appear in
`anti_toolbox_hits[]`.

These rules are sensible universal voice conventions — not slop
defaults. The LLM reaches for them across brands because they're
correct for most editorial/considered brands, so they don't
count against the divergence audit.

### 7.1 · Banned marketing adjectives

Voice rule forbidding: *artisanal · crafted · premium · curated · beloved ·
cozy · warm · inviting · thoughtfully · delightfully · lovingly ·
uncompromising · bespoke*.

**Opt in when:** the brand's voice resists marketing boilerplate.
**Opt out when:** the brand's category actually uses these words (luxury
hospitality sometimes wants "crafted"; boutique cosmetics sometimes want
"delightfully"). Removing the rule is a positive choice, not a slip.

### 7.2 · No exclamation points except …

Voice rule forbidding exclamation points outside of quoted outbursts in
italic.

**Opt in when:** the brand voice is terse / editorial.
**Opt out when:** the brand is youth-oriented, energetic, or enthusiasm is
a genuine brand value.

### 7.3 · Em-dashes welcome, semicolons earned

Punctuation rule preferring em-dashes and discouraging semicolons.

**Opt in when:** voice aims at editorial / literary register.
**Opt out when:** the brand writes technical documentation where semicolons
clarify list structure.

### How opt-in works

When a designer opts in (or the brand skill auto-opts-in because the seed's
register strongly implies it — e.g. `legal contract` register → 7.3 is
natural), the rule is copied verbatim into the emitted profile's
`voice.rules[]`. It is NOT recorded in `_divergence.anti_toolbox_hits` and
does NOT contribute to `_divergence.anti_toolbox_count`.

---

## How skills consume this toolkit (stardust v2)

- **`direct`** reads the toolkit when it authors the target `DESIGN.md` /
  `DESIGN.json` from the resolved direction. It uses §2 to roll a seed
  (when reference is weak or missing), §3 to pick a font deck, §4 to
  validate role names in the palette frontmatter, §5 to handle listicle
  references the user supplied. It writes the choices into
  `DESIGN.json.extensions.divergence` (the v2 home for what v1 called
  `_divergence`).
- **`prototype`** reads the toolkit at the start of its render pass. It
  uses §1 to count anti-toolbox moves in the candidate prototype and §4
  to validate palette role names used in the `:root` token block. It
  refuses to emit without a populated
  `DESIGN.json.extensions.divergence.font_deck`.
- **`migrate`** does not consult the toolkit directly — it consumes the
  approved DESIGN.md tokens, which already reflect the divergence choices
  baked in by `direct`.
- Other skills may reference the toolkit advisorily; they are not required
  to enforce it.

Always stamp the toolkit version in
`DESIGN.json.extensions.divergence.toolkit_version` so future runs can tell
which version of §1 was in effect.

### v2 storage shape (`DESIGN.json.extensions.divergence`)

```json
{
  "extensions": {
    "divergence": {
      "toolkit_version": "v1.0 (stardust v2)",
      "seed": {
        "input": "Example Brand|2026-04-25",
        "decade": "1970s",
        "craft": "Riso print",
        "register": "field guide",
        "ground_family": "monochrome-tint",
        "picked_by": "deterministic",
        "overrides": []
      },
      "font_deck": "tactile-humanist",
      "anti_toolbox_count": 1,
      "anti_toolbox_hits": [
        { "move": "Sticky top navigation",
          "justification": "..." }
      ],
      "off_toolbox_moves": [],
      "audit_adjustments": [],
      "references_used": [],
      "palette_source": {
        "library_version": "v0.7.0",
        "candidates": [],
        "recommended_index": 2,
        "picked_index": 2
      }
    }
  }
}
```

The shape mirrors v1's `_divergence` block one-to-one. Only the parent
key path changed (`brand-profile.json._divergence` →
`DESIGN.json.extensions.divergence`).
