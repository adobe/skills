# Divergence Toolkit

Shared inputs used by the `aem-design` pipeline (primarily `brand`, reached
by `prototype`) to push back against the assistant's recurring default moves.

Loaded whenever a skill is about to make a visual decision without a strong
external reference.

**Status:** v0.1 · self-audited. The anti-toolbox list below was compiled by
the assistant as a self-audit of its own recurring moves. It is deliberately
imperfect. Designers should add corrections in §6 over time; that section is
authoritative when it conflicts with §1.

---

## 1. The Default-Moves Budget

These are recurring moves the assistant tends to reach for when asked to be
"distinctive", "anti-generic", or "unexpected" — regardless of the brand's
subject matter. Left unconstrained, they appear across unrelated brands and
produce visual convergence.

**Budget rule:** any new `brand-profile.json` or `prototype` page may include
at most **3** moves from this list. Each inclusion past 3 requires an entry
in `_divergence.divergence_justifications` naming why this move is right for
*this specific brand*.

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

### Voice-rule moves
- "Ban marketing adjectives" list, naming *artisanal / crafted / premium / curated / beloved / cozy*
- "No exclamation points except …" rule
- "Em-dashes welcome / semicolons earned" rule
- "Sentences earn their length / a short one and a long one" cadence rule
- Quartermaster / examiner / curator register as the default voice stance

### Structural moves
- Sticky top navigation
- Numbered section eyebrows (§ 01 ·, § 02 ·, …)
- Masthead block with metadata stamp
- Palette swatch grid (equal-width cells, side-by-side)
- Two-column voice do / don't panel
- Motif card grid with fixed-size demo tiles
- Archival footer strip with batch + serial

### Palette-role moves
- Role vocabulary: *Primary / Secondary / Alarm / Warning / Shadow / Hardware / Ink*
- "Alarm" as a distinct role name for a saturated accent
- "Shadow" as a distinct role name for a deepened primary

### Enforcement

Before emitting `brand-profile.json`, the skill scans the profile against this
list, counts matches, and populates:

```json
"_divergence": {
  "anti_toolbox_count": <number>,
  "anti_toolbox_hits": ["string — which specific moves"],
  "divergence_justifications": [ { "move": "...", "reason": "..." } ]
}
```

If `anti_toolbox_count > 3` and `divergence_justifications` does not cover
each excess hit with a brand-specific reason, the skill retries the
generation with the hit list fed back in as a "do not repeat" constraint.

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
