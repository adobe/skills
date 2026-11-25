# stardust:direct: phase 2, mode detection and Modes A, B, C and default

The text of this part of `skills/direct/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

#### Mode-detection precedence (run first)

The default mode for `direct` is determined by whether an extracted
brand surface exists with usable signal — **not** by the user's
freeform phrase alone. Ambiguous refresh phrases ("make it modern",
"stunning new version", "design fatigue cure") are migration-shaped
asks, not rebrand triggers. The precedence is asymmetric on purpose:
the safer mode (Mode A — brand-faithful) catches ambiguous phrases;
the riskier rebrand mode requires the user to name it.

1. **Site migration / refresh — DEFAULT.** When the captured brand
   signal stamped in § Setup step 6 is `signal-strong`, Mode A is
   active by default. The user's phrase moves *expressive*,
   *distinctiveness*, *tone*, and *density* axes inside Mode A — but
   palette and type are pinned to the captured surface, and the
   image-reuse contract (below) holds. **Signature preservation also
   holds:** a captured signature hero medium (background video /
   canvas / Lottie / scroll-motion, elevated as
   `_brand-extraction.json#voice.heroMedium`) or a site-wide motif is
   reproduced, not flattened — per `skills/stardust/reference/
   intent-dimensions.md` § 8b, and exempt from the `surprise` budget.
   Surface in the plan:
   *"Brand-faithful mode active — palette and type pinned to the
   captured brand surface. Pass `--rebrand` to override."*

2. **Rebrand — explicit opt-in.** Mode A is overridden when **any**
   of the following triggers fire:
   - The user's phrase contains an explicit rebrand signal: any of
     `rebrand`, `new brand`, `clean slate`, `start over`,
     `from scratch`, `replace the brand`, `not brand-faithful`,
     `editorial reimagination`, `completely new`, `redo the brand`.
   - The `--rebrand` flag is passed.
   - Captured signal is `signal-absent` (no usable inheritance).
     Surface this case as an automatic switch with reason; the user
     can correct.

   In rebrand mode, run the standard divergence-seed roll per
   "Default mode (no constraints)" below. Surface in the plan:
   *"Rebrand mode active — full divergence-seed roll. Mode A
   bypassed because <reason>."*

3. **Brand-faithful + targeted exploration.** When the user requests
   N variants (e.g. *"3 variants"*, *"4 directions"*) and Mode A is
   active, the variant role contract in `reference/multi-variant.md`
   applies (trigger: § Phase 2.6). Variant A is locked to **strict Mode A** (palette and
   type pinned, IA preserved, every improvements-list item applied).
   Variants B+ may amplify one **captured** trait (a motif, a photo
   treatment, an IA priority the current site underplays) but
   cannot:
   - introduce a font outside the captured surface,
   - introduce a color outside the captured palette,
   - shift the register from PRODUCT.md.

4. **Signal-thin fallback.** When captured signal is `signal-thin`,
   Mode A activates but warns: *"Captured brand surface is thin —
   {reason}. Variants will inherit what is available; some
   dimensions will need to be filled by the divergence toolkit."*
   The user may either re-run extract with a wider crawl
   (`--cap 25`) or proceed with reduced fidelity.

After mode-detection completes, run the existing mode definitions
below (Mode A procedure, Mode B anchor-reference precedence, Mode C
ground-family override) as applicable.

#### Mode A — Brand-faithful mode

Triggered automatically when the captured brand signal is
`signal-strong` and no rebrand-mode override fired (see
§ Mode-detection precedence above), OR when the user pinned **both**
type and palette (via explicit phrase: "keep typography and palette",
"preserve the existing brand", "brand-faithful redesign"; or via
constraints listing both as anchors).

In this mode, direct does **not** roll the type or palette
dimensions of the seed — they are already locked.

The mode procedure:

1. Record `font_deck.name = "brand-inherited"` and
   `font_deck.picked_by = "user-constraint"`. Do not invoke
   `reference/palette-picker.md`.
2. Record `palette.source = "inherited from _brand-extraction.json"`
   and `palette.picked_by = "user-constraint"`. Apply role-renaming
   per toolkit § 4 if the inherited names violate the brand-native
   rule (this is still useful — role renaming is presentational,
   not a divergence choice).
3. **Still roll** the seed for the **non-locked** dimensions
   (decade, register, ground-family-as-applicable per Mode C
   below). These dimensions still drive divergence — the visual
   register and the era can shift even when type and palette are
   pinned.
4. Auto-emit the `brand_faithful_inversions[]` block in
   `extensions.divergence` per
   `reference/direction-format.md` § Brand-faithful inversions.
   The list is mostly mechanical (see § Brand-faithful inversions
   in direction-format.md for the canonical patterns).
5. Surface in the user report which dimensions had teeth and
   which were inert:

   ```
   Divergence (brand-faithful mode):
     decade           ✓ rolled    → 2025-now
     craft            ✓ rolled    → Riso print
     register         ✓ rolled    → Memoir-adjacent
     ground-family    inherited   → stark-white (brand-native)
     font deck        inherited   → existing site stack
     palette          inherited   → existing 5-color set
   ```

6. **Image-reuse contract.** Captured images are reused via their
   public URLs (or the local copies in
   `stardust/current/assets/media/` written by extract Phase 2)
   **at the same semantic position** as on the source site. Hero
   stays hero. Story-tile portrait stays story-tile portrait.
   Program-card image stays program-card image. Background-motif
   image stays background motif.

   This is part of brand-faithful inheritance: swapping a captured
   portrait for a placeholder, or demoting the hero photo to a
   thumbnail, erases the brand's most load-bearing trust signal.

   The only legitimate ways to deviate from semantic
   position-preservation under Mode A:

   - The captured image is broken (404, blocked by `referrer-policy`,
     CORS-walled, or recorded with `localPath: null` and a
     `downloadError`).
   - The brand-review surfaced the image as a tension (e.g.
     `T-stock-photography` when added — flagging the captured
     image as obviously templated stock that the brand team would
     replace anyway).
   - The improvements list (Phase 2.5) explicitly notes a crop or
     positioning fix for that image — in which case the same
     image is reused at the corrected crop or position.

   Synthesised placeholders are forbidden under Mode A. When a
   captured image cannot be reused, the prototype shape brief
   declares the gap explicitly and the rendered prototype shows a
   placeholder-with-signature element so reviewers see the gap
   rather than a fabricated photo.

The user can correct the mode at the plan-confirmation gate (e.g.
"actually let me move the palette" or "actually rebrand it")
before it locks.

#### Mode B — Anchor-reference precedence

When the user provides anchor references (Q1/Q2 answers like
"Pentagram nonprofits, This American Life, NYT Opinion longform"),
those references **already imply** seed dimensions (Pentagram →
decade `2025-now` editorial; This American Life → register
`Memoir`-adjacent). Do not roll dimensions the references already
imply.

**Agent-sourced anchors (default when the user provides none).**
Mode B no longer waits for the user to name references: run the
reference-research procedure
(`skills/stardust/reference/reference-research.md`) to source 3–5
real-world anchors matched to the brand's category, register, and the
resolved direction movement. Researched anchors carry the same
implied-dimension weight as user-provided ones and are recorded as
`picked_by: "reasoned: <anchor>"` with the full citation in
`extensions.divergence.references_used[]`. User-provided references
always outrank researched ones on conflict. When research is
unavailable (ladder exhausted per reference-research.md § 1), Mode B
degrades to the deterministic roll for the un-implied dimensions.

Precedence rule:

1. If anchor references are present, extract their implied
   dimensions:
   - **Decade** from era of the references (Pentagram → 2025-now;
     vintage Penguin → 1960s).
   - **Craft** from medium of the references (TAL → audio editorial
     ≠ a craft per se, but Bandcamp → web-print hybrid; Riso-print
     anthology → Riso).
   - **Register** from cultural reference set (Memoir, Tabloid,
     Catalogue, etc.).
   - **Ground-family** from typical ground of those references
     (NYT Opinion → cream/parchment; Pentagram nonprofit →
     stark-white or monochrome-tint).
2. Mark each implied dimension as
   `picked_by = "anchor-reference: <ref-name>"`.
3. Roll the seed only for **un-implied** dimensions.
4. Record the anchor → dimension mapping in
   `extensions.divergence.seed.anchors[]`.

Mode B can compose with Mode A: anchor-references narrow the seed,
brand-faithful constraints lock type/palette, the remaining roll
is whatever the anchors didn't already imply.

#### Mode C — Brand-faithful ground-family override

When Mode A is active **and** the seed's `ground_family` roll
disagrees with the brand's existing ground (e.g. seed rolled
`monochrome-tint` but the brand's captured background is
`#ffffff` stark-white), the brand's ground wins. The seed roll is
not discarded — it informs the **alt-section surface** instead
(per `divergence-toolkit.md` § 4 Color roles). Record the override
in `extensions.divergence.seed.ground_family.override` with one
of three reasons:

- `brand-faithful` — Mode A active and brand has a fixed ground.
- `print-paper` — manual override for print/paper categories
  (existing toolkit rule).
- `direction-driven` — seed wins (default; no override).

The three reasons are mutually exclusive; surface the chosen one
in the user report.

#### Default mode (no constraints)

When neither Mode A nor Mode B applies (rebrand or thin-signal runs
with no user anchors), the procedure is **research-first, roll as
fallback**:

- **Reference research first.** Run
  `skills/stardust/reference/reference-research.md` to source
  anchors for the brand's category and the resolved direction, and
  derive the dimensions they imply (`picked_by: "reasoned: <basis>"`).
  This is Mode B's machinery applied to agent-sourced anchors — see
  § Mode B above.
- **Seed as fallback + tiebreaker.** Roll the 4-dimension seed
  (decade × craft × register × ground-family) per § 2 of the toolkit
  **only** for dimensions research left un-implied, or entirely when
  research is unavailable. The roll also remains available as a
  deliberate convergence-breaker when the self-audit catches the
  model reproducing its defaults despite research. Record
  `picked_by` per dimension.
- **Font deck.** Pick from the 10 named decks per § 3, letting the
  researched anchors inform the pick the same way a seed implication
  would (e.g. an editorial-serif anchor set → `serif-luxury`). When
  neither research nor seed implies a deck, pick deterministically
  from the hash.
- **Palette.** If the resolved direction moves the color-energy
  axis or names the existing palette as part of the problem: derive
  a full role-ramped palette (text, grounds, borders, accents,
  states) from the primary researched anchor or a library candidate
  — the library (`skills/direct/reference/palette-picker.md`) is an
  **anchor bank**, not a closed menu; the model designs the ramp and
  validates every text-on-ground pair for WCAG AA before it lands
  in tokens (deterministic where it matters — math — not where it
  hurts — taste). Record the derivation basis in
  `extensions.divergence.palette_source`. Otherwise inherit
  the existing palette from
  `stardust/current/_brand-extraction.json`, applying role-renaming
  per toolkit § 4 if the inherited names violate the brand-native
  rule.
