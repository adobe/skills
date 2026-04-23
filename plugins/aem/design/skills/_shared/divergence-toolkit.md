# Divergence Toolkit

Shared inputs used by the `aem-design` pipeline (primarily `brand`, reached
by `prototype`) to push back against the assistant's recurring default moves.

Loaded whenever a skill is about to make a visual decision without a strong
external reference.

**Status:** v0.2 · self-audited · run-tested. The anti-toolbox list below
was compiled by the assistant as a self-audit of its own recurring moves
and expanded after a 4-run test surfaced additional defaults (triplet-
cadence copy, generic-2026-SaaS silhouette, stat-callout bar,
collage-maximalism kit, archival-editorial palette family,
cream-as-default page ground). It is deliberately imperfect. Designers
should add corrections in §6 over time; that section is authoritative when
it conflicts with §1.

**Changes from v0.1:**
- Retired the "3 free hits" budget. Every hit now needs a brand-specific
  justification (§ 1 Enforcement).
- Added self-audit rationalisation check (§ 1 Enforcement).
- Added Palette-family moves subsection (§ 1) covering
  archival-editorial palette, cream-as-default ground,
  brutalist-pomodoro, and dark-mode-editorial.
- Added Generic-2026-SaaS silhouette, Stat-callout bar, Collage-maximalism
  kit, and Triplet-cadence copy to § 1.
- Moved ban-marketing-adjectives, no-exclamation-points, and em-dash rules
  out of § 1 into new § 7 Optional House Standards — they're sensible
  universal conventions, not defaults to count against.
- Added § 2.5 Dimension Weighting — decade → type, craft → motif,
  register → voice — with within-run variant dominance and a *Ground color
  by seed* table (cream belongs to specific seeds, not as a default).

---

## 1. The Default-Moves List

These are recurring moves the assistant tends to reach for when asked to be
"distinctive", "anti-generic", or "unexpected" — regardless of the brand's
subject matter. Left unconstrained, they appear across unrelated brands and
produce visual convergence.

**Enforcement model (v0.2):** every move from this list that appears in a
profile requires a per-hit brand-specific justification. No free quota. See
the *Enforcement · per-hit justification* block at the bottom of this
section. In v0.1 there was a budget of 3 "free" hits; that budget was
retired after the 4-run test showed the LLM comfortably filled it with
defaults.

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

(The "ban marketing adjectives", "no exclamation points except …", and "em-dashes welcome / semicolons earned" rules were in v0.1. They are sensible universal voice rules and have moved to § 7 Optional House Standards. They no longer count against the budget.)

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

### Palette-role moves
- Role vocabulary: *Primary / Secondary / Alarm / Warning / Shadow / Hardware / Ink*
- "Alarm" as a distinct role name for a saturated accent
- "Shadow" as a distinct role name for a deepened primary

### Palette-family moves

Recurring *palette families* — not individual hex values, but combinations of ground + accent + secondary that the assistant reaches for across unrelated brands. A brand profile whose dominant tones fall into one of these families is a hit, even when individual hex values differ.

- **"Archival editorial palette"** — cream/paper ground (#F0–F8 on the L axis) + warm-family saturated accent (rust / brick / pomodoro / burnt-orange / oxblood) + muted earth-tone secondary (olive / mustard / ochre / fennel). The assistant's "serious-but-warm editorial" default; recurs across unrelated brands even when nothing in the brief calls for it.
- **Cream/paper as the default page ground.** If the brand's seed does NOT call for letterpress / riso / field-guide / archival / print-ephemera, and the brand's category is NOT print-publishing-adjacent, then cream is a default substrate, not a reasoned choice. See § 2.5 *Ground color by seed* for what belongs where.
- **"Brutalist pomodoro palette"** — ink-black primary + cream/bone ground + one saturated red/orange alarm. The Nonna's Arsenal baseline palette; appears whenever the brand is "serious" or "archival". A hit specifically when the saturated accent occupies < 5% of surface area (used only for alerts / CTAs) — at that dose it reads as the assistant's signature.
- **"Dark mode editorial"** — ink/black ground + cream/bone text + one saturated accent. The inverted version of the brutalist pomodoro.

### Enforcement · per-hit justification (v0.2)

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

### Picking a seed

**Deterministic random:** concatenate `brand.name + ISO-date (YYYY-MM-DD)`,
compute an MD5 hash, then index into each list using successive bytes of
the hash modulo list length. Designers can reproduce the seed for audit by
running the same concatenation through any MD5 utility.

**Manual override:** a designer may pick seeds explicitly; in that case set
`_divergence.seed.picked_by = "designer"`.

The seed triple is stamped in `_divergence.seed` and forwarded to every
downstream skill as a constraint.

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

The seed triple is not uniform — each dimension governs a different layer of
the visual system. This makes the seed load-bearing and enables meaningful
within-run variant divergence.

| Dimension | Governs |
|---|---|
| **Decade** | Type deck selection (see § 3), period-appropriate cultural references, display-type register, image/photography era |
| **Craft tradition** | Texture, motif idiom, print artifacts (misregistration, ink bleed, folds, embossing), material metaphor |
| **Cultural register** | Voice stance, structural metaphor (table · manifest · itinerary · ledger · docket · inventory), information architecture |

### Within-run variant variance via dimension dominance

When producing multiple prototype variants for the same brand, each variant
should let one seed dimension dominate while the other two recede. Stamp the
dominant dimension in each prototype's header comment.

Example (Yadda Dey · seed = 1960s × folded-paper × travel brochure):
- Variant A — **decade-dominant** (1960s Africa-modernist palette and type
  lead; craft and register recede)
- Variant B — **craft-dominant** (folded-paper physicality leads — actual
  fold-crease shadows, die-cut dog-ears, serrated edges)
- Variant C — **register-dominant** (travel brochure idiom leads —
  itinerary tables, route maps, ticket edges)

This is a structural tool, not a rigid rule. A variant may combine two
dimensions if the brand warrants it; pure single-dimension dominance is the
starting configuration, not the endpoint.

### Ground color by seed

Page ground color is seed-driven, not a template default. The assistant's
recurring instinct is cream/paper/warm-neutral as the substrate, which
belongs only to a specific subset of seeds.

| Seed signal | Appropriate page ground |
|---|---|
| Decade 1920s–1960s × letterpress / riso / folded-paper / field-guide / travel brochure / museum didactic | Cream, paper, warm neutral (this is where cream *belongs*) |
| Decade 1970s × enamel-sign / neon-bending / ceramic-transfer | Saturated ground (burnt orange, teal, oxblood, avocado) |
| Decade 1990s × legal-contract / repair-manual / hospital-discharge | Stark white, pale gray — NOT cream |
| Decade 2000s–2025 × broadcast-captioning / sports-scorecard / railway-timetable | True black, true white, or saturated monotone — NOT cream |
| Craft terrazzo / mosaic tile | Speckled or patterned ground, not flat cream |
| Craft photogram / plaster cast | Deep monochrome (black, bone) |
| Craft technical-illustration / map-engraving | White or blueprint-blue |

If the selected seed would naturally suggest a non-cream ground, using cream
anyway requires a per-instance justification in
`_divergence.anti_toolbox_hits` (see § 1 *Palette-family moves* — the
"Cream/paper as default page ground" entry).

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
`brand-profile.json → voice.rules`. They do NOT appear in
`_divergence.anti_toolbox_hits`.

These rules moved out of § 1 in v0.2 because they're not defaults — they're
sensible universal voice conventions. The LLM reaches for them across
brands, but that's because they're correct for most editorial/considered
brands, not because they're slop.

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

## How skills consume this toolkit

- `brand` reads the toolkit at the start of Phase 1 when reference is weak
  or missing. It uses §2 to roll a seed, §3 to pick a font deck, §4 to
  validate role names, §5 to handle listicle references. It writes the
  choices into `_divergence` on the emitted profile.
- `prototype` reads the toolkit at the start of its render pass. It uses §1
  to count anti-toolbox moves in the prototype and §4 to validate palette
  role names used in `:root` tokens. It refuses to emit without a populated
  `_divergence.font_deck`.
- Other skills may reference the toolkit advisorily; they are not required
  to enforce it.

Always stamp the toolkit version in `_divergence.toolkit_version` so future
runs can tell which version of §1 was in effect.
