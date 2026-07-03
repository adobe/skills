---
name: direct
description: Set a redesign direction for an existing website. Analyzes the user's intent, picks a palette and visual direction, and writes the target spec (PRODUCT.md, DESIGN.md, DESIGN.json) plus a reasoning trace at stardust/direction.md. Use when the user asks to redesign a site, refresh the design, set a new design direction, define a redesign target, or invokes /stardust:direct.
license: Apache-2.0
---

# stardust:direct

Resolve the user's freeform redesign intent into a complete **target specification**: project-root `PRODUCT.md` and `DESIGN.md` (impeccable format), a `DESIGN.json` sidecar with the divergence audit trail, and `stardust/direction.md` with the full reasoning trace. `direct` produces the spec `prototype` and `migrate` operate against; it never writes prototypes or migrates pages.

## Inputs

- `<phrase>` — optional positional freeform intent ("make it better", "more Linear less Salesforce"). If omitted, ask the user for one.
- `--re-direct` — replace the current direction. Stale-flags prototyped / approved / migrated pages per `skills/stardust/reference/state-machine.md`. Without the flag, behaviour is additive: if a direction exists, ask before replacing.
- `--rebrand` — force rebrand mode (full divergence-seed roll, no Mode A inheritance). Default is brand-faithful whenever `_brand-extraction.json` is `signal-strong` (§ Setup step 6, § Mode-detection precedence); pass `--rebrand` to opt out when the phrase is ambiguous between refresh and clean-slate redesign.
- `--prep` — migrate-prep mode. **When `--prep` is passed, READ `skills/direct/reference/prep-mode.md` and follow it end-to-end** on top of the standard procedure (type catalog, module catalog, color reservations, metadata defaults, wider re-evaluation). Typically invoked via the `prepare-migration` orchestrator.
- `--add-variant <name>` — add a variant against the existing direction without re-running intent reasoning or mode detection. **When `--add-variant` is passed, READ `skills/direct/reference/add-variant.md` and follow it end-to-end** (procedure, parentage, per-field inheritance, its failure modes). Writes `DESIGN-<name>.{md,json}`, appends a per-variant section to `stardust/direction.md`; the previous direction stays authoritative and existing prototypes are **not** stale-flagged.

## Setup

1. Run the master skill's setup (`skills/stardust/SKILL.md` § Setup): hard impeccable dep check, context loader, state read.
2. Verify `stardust/state.json` exists with ≥ 1 `extracted` page. If not → stop; recommend `$stardust extract <url>` first.
3. Read `stardust/current/_brand-extraction.json`. If absent → stop; extract did not complete brand-surface extraction; re-run extract.
3b. **Cross-site brand inputs** (when present):
   - `state.json.designSource` — design-donor mode. The donor's derived system at `stardust/canon-source/DESIGN.{md,json}` is the **target** the Mode A pins bind to: palette and type pin to the *donor* surface; content, IA priorities, and per-page evidence stay with the primary origin. Surface in the plan: *"Design-donor mode — target system inherited from <donor-url>."*
   - `_brand-extraction.json.origins[]` — sibling-property evidence (`--brand-source`). Sibling-origin traits count as **captured evidence** for trait amplification (variant B/C briefs, improvements items) exactly like primary-origin evidence; cite the origin. Under Mode A the *pins* still come from the primary origin unless designSource says otherwise — sibling evidence widens what can be amplified, not what is pinned.
4. Read `stardust/direction.md` if present. Prior direction exists and no `--re-direct` → ask whether to refine or replace.
5. **Prep mode only:** call `validateProvenance(page)` (per `skills/stardust/reference/state-machine.md` § Provenance validation) on every `extracted` page before typing or module detection. Any page lacking live-render evidence → abort with the helper's error. Surface `Provenance OK on N pages` in the prep summary. Discovery-mode runs do not validate (5-page sample; extract's write-time refusal suffices).
6. **Classify the captured brand signal** from `_brand-extraction.json`; stamp one of:
   - `signal-strong` — palette has ≥ 3 distinct colors (after near-duplicate clustering, excluding pure black/white if they are the only entries) **AND** ≥ 1 named type family in `type.headingFamily.name` or `type.bodyFamily.name`.
   - `signal-thin` — palette has 2 colors OR no captured type family OR `type.scaleAudit.kind === "ad-hoc"` with < 3 distinct heading sizes.
   - `signal-absent` — palette has ≤ 1 color, or `_provenance.notes` flags the extraction as failed / login-walled / iframe-dominated.

   The stamp feeds § Mode-detection precedence. Surface it in the plan when it would change the default mode.

## Procedure

### Phase 1 — Reasoning

Run the full intent-reasoning procedure from `skills/stardust/reference/intent-reasoning.md`, steps 1-6: restate the phrase in dimensional vocabulary, identify movement, identify gaps, ask **at most two** clarifying questions (hard ceiling, per turn, no exceptions), map to an impeccable command sequence, show the plan. Worked examples: `skills/stardust/reference/intent-examples.md`.

**Hands-off mode** (`state.json.handsOff: true`, per `skills/stardust/SKILL.md` § Hands-off mode): ask nothing, wait for nothing. Derive every answer from captured evidence — density and ia-fidelity from their documented defaults and triggers, audience and register from the captured surface — and record each as a named assumption in `direction.md` § Movements (e.g. `density: balanced (hands-off default — multi-audience floor fired)`). The plan is still written; execution proceeds without the confirmation gate. Every "ask the user" below resolves the same way: derive, stamp the assumption, proceed.

#### Density tuning (one-shot, only when unmoved)

When the phrase does **not** move `density` (`reference/intent-dimensions.md` § 4) and the resolved register is `brand`, ask one follow-up (counts within the two-question ceiling):

> Density tuning — (a) airy (NYT-Opinion-tier breathing, ~96px section padding), (b) balanced (calm but compact, ~64–72px), (c) packed (data-dense, ~40–48px). Default for brand-register sites with multi-audience IA is **(b) balanced**; pick (a) only when the page is editorial-led with deep per-section density.

Answered → stamp `density: <tier>` in `direction.md` § Movements. Unanswered → default **balanced** (not airy) for brand register, stamp `density: balanced (default)`.

Skip the question entirely when:
- The phrase already moved `density` ("denser", "more breathing room", "compact", "tight", "spacious" all count as movement).
- Register is `product` (default `packed` per § 4).
- Register is `ambiguous` and resolving it is the higher-value question — defer density to the next turn rather than burning a question slot.

The tier propagates deterministically to `DESIGN.md spacing.sectionPadding` (intent-dimensions § 4): airy = 96px, balanced = 64px, packed = 48px. Phase 4 reads the stamp; it never re-asks.

#### IA-fidelity tuning (one-shot, only when unmoved)

When the phrase does **not** auto-pin `ia-fidelity` (intent-dimensions § 9 — none of *"verbatim"*, *"same IA"*, *"keep the structure"*, *"swap the surface"*, *"don't rethink the IA"* [→ verbatim] and none of *"reimagine"*, *"rethink"*, *"deeper redesign"*, *"what if"* [→ reimagined]), ask one follow-up (counts within the ceiling):

> IA fidelity — (a) verbatim (same section sequence, same content beats; variants explore surface only: color, type, density, motion), or (b) reimagined (variants may demote / promote / drop sections, move IA priorities, take "what if" positions on the spine of the page). Default (b) for the typical refresh; pick (a) when the customer asked to keep the structure and only swap the surface.

Answered → stamp `ia-fidelity: <tier>`. Unanswered → default **reimagined**, stamp `ia-fidelity: reimagined (default)`.

Skip entirely when: the phrase already auto-pinned the axis, or an existing `direction.md` is being refined (active tier holds unless the user re-pins).

Propagates to `DESIGN.json.extensions.iaPriorities[].mutability`: `locked` under verbatim, `movable` under reimagined (stamped in Phase 4; `prototype` reads it).

**Pairing:** when both density and ia-fidelity are unmoved, ask them as one paired question to stay within the ceiling. If register (brand vs product) is also outstanding, resolve register first and defer one of density / ia-fidelity to the next turn.

**Gate:** wait for the user's confirmation (`"go"` or a correction) before Phase 2. If the phrase is still too vague after two questions → § Failure modes (vague phrase): persist partial reasoning, do not write specs.

### Phase 2 — Resolve the divergence inputs

Resolve the divergence-toolkit inputs (`skills/stardust/reference/divergence-toolkit.md`) — but first run mode detection to decide whether the seed needs rolling at all.

#### Mode-detection precedence (run first)

The default mode is determined by whether an extracted brand surface exists with usable signal — **not** by the user's phrase alone. The precedence is asymmetric on purpose: the safer Mode A catches ambiguous phrases; rebrand requires the user to name it. (Rationale and the 2026-04-29 default-flip provenance: `reference/mode-notes.md`.)

1. **Site migration / refresh — DEFAULT.** When the Setup-6 stamp is `signal-strong`, Mode A is active by default. The phrase moves *expressive*, *distinctiveness*, *tone*, and *density* inside Mode A — but palette and type are pinned to the captured surface and the image-reuse contract holds. **Signature preservation also holds:** a captured signature hero medium (background video / canvas / Lottie / scroll-motion, elevated as `_brand-extraction.json#voice.heroMedium`) or a site-wide motif is reproduced, not flattened — per intent-dimensions § 8b, exempt from the `surprise` budget. Surface in the plan: *"Brand-faithful mode active — palette and type pinned to the captured brand surface. Pass `--rebrand` to override."*
2. **Rebrand — explicit opt-in.** Mode A is overridden when **any** fires:
   - Phrase contains an explicit rebrand signal: `rebrand`, `new brand`, `clean slate`, `start over`, `from scratch`, `replace the brand`, `not brand-faithful`, `editorial reimagination`, `completely new`, `redo the brand`.
   - `--rebrand` passed.
   - Signal is `signal-absent` (no usable inheritance) — surface as an automatic switch with reason; the user can correct.

   Run the divergence-seed roll per § Default mode. Surface: *"Rebrand mode active — full divergence-seed roll. Mode A bypassed because <reason>."*
3. **Brand-faithful + targeted exploration.** User requests N variants while Mode A is active → the § Multi-variant fork contract applies. Variant A is locked to **strict Mode A** (palette/type pinned, IA preserved, every improvements item applied). Variants B+ may amplify one **captured** trait but cannot: introduce a font outside the captured surface, introduce a color outside the captured palette, or shift the register from PRODUCT.md.
4. **Signal-thin fallback.** `signal-thin` → Mode A activates but warns: *"Captured brand surface is thin — {reason}. Variants will inherit what is available; some dimensions will be filled by the divergence toolkit."* Offer: re-run extract with a wider crawl (`--cap 25`) or proceed with reduced fidelity.

Then apply the mode definitions below as applicable.

#### Mode A — Brand-faithful mode

Triggered automatically by precedence step 1, OR explicitly when the user pinned **both** type and palette (phrase: "keep typography and palette", "preserve the existing brand", "brand-faithful redesign"; or a constraints list with `brand-faithful` + explicit type + palette anchors). Always surface "Brand-faithful mode active" in the plan so the user can correct (e.g. "actually rebrand it") before it locks. Do **not** roll type or palette — they are locked (why: `reference/mode-notes.md`).

1. Record `font_deck.name = "brand-inherited"`, `font_deck.picked_by = "user-constraint"`. Do not invoke `reference/palette-picker.md`.
2. Record `palette.source = "inherited from _brand-extraction.json"`, `palette.picked_by = "user-constraint"`. Apply role-renaming per toolkit § 4 if inherited names violate the brand-native rule (renaming is presentational, not a divergence choice).
3. **Still roll** the seed for non-locked dimensions (decade, craft, register, ground-family per Mode C) — era and visual register can shift even with type/palette pinned.
4. Auto-emit `brand_faithful_inversions[]` in `extensions.divergence` per `reference/direction-format.md` § Brand-faithful inversions (canonical patterns there).
5. Surface in the user report which dimensions had teeth and which were inert (rolled vs inherited, per dimension).
6. **Image-reuse contract.** Captured images are reused via their public URLs (or local copies in `stardust/current/assets/media/`) **at the same semantic position** as on the source site: hero stays hero, story-tile portrait stays story-tile portrait, program-card image stays program-card image, background motif stays background motif. (Why this is brand-faithful inheritance, not a content rule: `reference/mode-notes.md`.) The only legitimate deviations:
   - the captured image is broken (404, `referrer-policy` blocked, CORS-walled, or `localPath: null` with a `downloadError`);
   - the brand-review surfaced the image as a tension (e.g. `T-stock-photography` — obviously templated stock the brand team would replace anyway);
   - the improvements list (Phase 2.5) explicitly notes a crop or positioning fix — then the **same image** is reused at the corrected crop/position.

   Synthesised placeholders are **forbidden** under Mode A. When a captured image cannot be reused, the shape brief declares the gap and the prototype shows a placeholder-with-signature element — reviewers see the gap, never a fabricated photo.


Reference research (`skills/stardust/reference/reference-research.md`) still runs under Mode A for the **non-locked** dimensions — researched anchors may imply decade/craft/register exactly as in Mode B; only type and palette are pinned.

#### Mode A+ — Brand-adjacent refinement (bounded, evidence-gated)

The middle tier between Mode A pins and `--rebrand` (rationale: `reference/mode-notes.md`). Authorizes exactly two bounded upgrades, each gated on evidence:

- **Same-classification type upgrade.** Only when the improvements list names the captured *body or system* face as a weakness with evidence (illegibility at captured sizes, generic system stack where the brand deserves a voice, missing weights/axes the layout needs): upgrade the body face to a same-classification, deliverable face (humanist sans → humanist sans; grotesque → grotesque). **The display face stays pinned** — it carries brand recognition.
- **Single-role palette recolor.** Only when a specific captured color fails contrast or hierarchy *as evidenced* (computed ratio cited, or a `T-color-imbalance` tension): re-derive that one role (deepen, re-weight); every other role stays pinned. New hues from outside the captured family remain forbidden.

Contract: record each refinement in `DESIGN.json.extensions.divergence.brand_adjacent_refinements[]` as `{ kind, captured, replacement, evidence, improvementsItem }` — an inversion-style audit entry citing the improvements-list item that authorizes it. No evidence citation → no refinement. Mode A+ never activates by default: it requires the qualifying improvements-list item, and the plan surfaces each refinement explicitly (*"body face upgraded Arial → Hanken Grotesk per improvements #3; display face pinned"*) so the user (or the hands-off record) sees exactly what moved. Refinements do not run through reference research — their justification is the captured weakness, not an external anchor.

#### Mode B — Anchor-reference precedence

User-provided anchor references (Q1/Q2 answers like "Pentagram nonprofits, This American Life, NYT Opinion longform") **already imply** seed dimensions; rolling those dimensions and retro-justifying an accidental alignment is fragile.

**Agent-sourced anchors (default when the user provides none).** Run `skills/stardust/reference/reference-research.md` to source 3–5 real-world anchors matched to the brand's category, register, and the resolved movement. Researched anchors carry the same implied-dimension weight, recorded as `picked_by: "reasoned: <anchor>"` with full citation in `extensions.divergence.references_used[]`. User-provided references always outrank researched ones on conflict. Research unavailable (ladder exhausted per reference-research § 1) → degrade to the deterministic roll for un-implied dimensions.

Precedence rule:
1. Extract implied dimensions from anchors: **decade** from era (Pentagram → 2025-now; vintage Penguin → 1960s); **craft** from medium (Bandcamp → web-print hybrid; Riso anthology → Riso); **register** from cultural reference set (Memoir, Tabloid, Catalogue, …); **ground-family** from typical ground (NYT Opinion → cream/parchment; Pentagram nonprofit → stark-white or monochrome-tint).
2. Mark each implied dimension `picked_by = "anchor-reference: <ref-name>"`.
3. Roll the seed only for **un-implied** dimensions.
4. Record the anchor → dimension mapping in `extensions.divergence.seed.anchors[]`.

Mode B composes with Mode A: anchors narrow the seed, brand-faithful constraints lock type/palette, the roll covers whatever the anchors didn't imply.

#### Mode C — Brand-faithful ground-family override

When Mode A is active **and** the seed's `ground_family` roll disagrees with the brand's captured ground (e.g. seed rolled `monochrome-tint`, brand ground is `#ffffff` stark-white), the brand's ground wins. The seed roll is not discarded — it informs the **alt-section surface** (toolkit § 4 Color roles). Record `extensions.divergence.seed.ground_family.override` with exactly one of three mutually exclusive reasons, surfaced in the user report:

- `brand-faithful` — Mode A active, brand has a fixed ground.
- `print-paper` — manual override for print/paper categories (existing toolkit rule).
- `direction-driven` — seed wins (default; no override).

#### Default mode (no constraints)

Rebrand or thin-signal runs with no user anchors: **research-first, roll as fallback**.

- **Reference research first.** Run `skills/stardust/reference/reference-research.md`; derive the dimensions the anchors imply (`picked_by: "reasoned: <basis>"`) — Mode B's machinery applied to agent-sourced anchors.
- **Seed as fallback + tiebreaker.** Roll the 4-dimension seed (decade × craft × register × ground-family) per toolkit § 2 **only** for dimensions research left un-implied, or entirely when research is unavailable. The roll also remains a deliberate convergence-breaker when the self-audit catches the model reproducing its defaults despite research. Record `picked_by` per dimension.
- **Font deck.** Pick from the 10 named decks per toolkit § 3, letting researched anchors inform the pick as a seed implication would (editorial-serif anchors → `serif-luxury`). Neither research nor seed implies a deck → pick deterministically from the hash.
- **Palette.** If the direction moves color-energy or names the existing palette as part of the problem: derive a full role-ramped palette (text, grounds, borders, accents, states) from the primary researched anchor or a library candidate — `reference/palette-picker.md` is an **anchor bank**, not a closed menu; the model designs the ramp and validates every text-on-ground pair for WCAG AA before it lands in tokens (deterministic where it matters — math — not where it hurts — taste). Record the basis in `extensions.divergence.palette_source`. Otherwise inherit the palette from `_brand-extraction.json`, role-renaming per toolkit § 4 where inherited names violate the brand-native rule.

#### Always run

- **Anti-toolbox audit** (toolkit § 1 Enforcement + Self-audit) on the resolved direction, regardless of mode. Each anti-toolbox hit needs a brand-specific justification or it is removed. If the audit strips so much the direction collapses to defaults → § Failure modes (audit collapse).

Record every resolution in `DESIGN.json.extensions.divergence` per the v2 storage shape at the bottom of `divergence-toolkit.md`.

### Phase 2.5 — Improvements list (Mode A only)

Before any variant renders downstream, write `stardust/prototypes/<slug>-improvements.md` listing **3–5 specific weaknesses** of the captured site. This is the load-bearing brief variant A renders against (why: `reference/mode-notes.md`): it is descriptive of the gap to a competent 2026 execution of the same brand, never prescriptive of visual targets. Variant A closes the gap; variants B+ honor the list as a floor (may go further, may not contradict it).

**Skip this phase** when the resolved mode is rebrand — the list assumes brand-faithful inheritance; a rebrand replaces the site rather than fixing it.

**Audit reuse.** When `stardust/audit/<domain-slug>/audit.json` exists for this origin (written by `stardust:audit`), consume its design findings as candidate improvements instead of re-deriving; carry finding IDs into each item's evidence citation. The specificity bar still applies to every carried item.

**Five categories** (items must be citable by number from a prototype shape brief):
1. **Dated patterns** the design world has moved past — named pattern + vintage, e.g. *"centered hero with stock photo + double CTA in primary blue is the SaaS template circa 2019"*, not *"the hero feels dated"*.
2. **Cluttered IA / unclear hierarchy / weak CTAs / redundant sections** — e.g. *"4 donor CTAs with 4 different verbs (DONATE / GIVE / SUPPORT / CONTRIBUTE) fragment the conversion funnel"*.
3. **Contrast failures, accessibility gaps, density issues** — pull from `brand-review.html` Tensions when present (`T-color-imbalance`, `T-img-alt-empty`, …), with computed ratios (e.g. teal passes AA at 4.6:1 on white but drops to 3.1:1 on light-grey cards).
4. **Cliché conventions** the brand could move past while staying recognisably itself — e.g. all-caps-via-CSS headings where the voice survives mixed-case and mixed-case reads as more current.
5. **Missed opportunities** the site doesn't capitalise on — e.g. excellent named-participant photography rendered as 280×180 slider thumbnails when it supports full-bleed editorial treatment that would carry the trust signal.

**Specificity bar.** An item passes only when it cites all three:
- a measurable observation (size, ratio, contrast value, count, or named tension ID) from the per-page JSON, brand-review, or brand-extraction;
- the design pattern at fault, named (e.g. "centered hero + dual CTA");
- one concrete fix the variant-A brief will apply.

*"The hero needs work"* fails all three. *"Hero photo is cropped to 280×180 in a 1440-wide viewport when the captured source supports 16:9 full-bleed at 1440×810; fix: render full-bleed, headline in a left-anchored two-column overlay"* passes all three.

**Format.** Markdown with a `_provenance` frontmatter block per the artifact-map convention (writtenBy, writtenAt, readArtifacts, stardustVersion). Each item: numbered entry with a bracketed category tag, a weakness statement, and a one-line `*Fix:*`. Example item:

```markdown
3. **[contrast]** Brand teal on light-grey card surfaces resolves to 3.1:1 — fails
   WCAG AA. (See `T-color-imbalance` in brand-review.)
   *Fix:* Reserve teal for white-ground only; use deepened teal (#005a68) on grey surfaces.
```

**Stopping condition.** If, after reading the brand-review, per-page JSON, and brand-extraction, you cannot name **3 weaknesses meeting the bar** → stop; variant A has no brief and the "better" claim fails (§ Failure modes (d)). Do not rationalise — *"the hero is dated"* / *"the typography could be more modern"* are not items. Genuine empty lists mean the site is already executing well on observable dimensions: surface the empty list honestly and propose reduced scope (density + contrast adjustments only, or one exploratory variant instead of three).

### Phase 2.6 — Multi-variant fork (when N > 1)

When the user requests N variants (*"3 variants"*, *"4 directions"*), slots are **role-differentiated, not seed-differentiated** — each slot de-risks a distinct brand decision; variants are not N rebrand explorations (why the per-slot seed roll was retired: `reference/mode-notes.md`).

#### Branch on `ia-fidelity` first

Read the Phase 1 stamp and branch:

**Under `ia-fidelity: verbatim` — surface-tuning forks (A1/A2/A3).** Slots are A1…An, all surface forks of A's role ("different tunings of the same role", not different roles). N=1 → just A. Each pair must differ by **≥ 2 surface changes** drawn from:
- type-weight choice (e.g. 400 vs 600 vs 800 display)
- type-scale ratio (e.g. 1.2 vs 1.333 vs 1.5)
- density tier (within the § 4 multi-audience floor)
- motion energy (still vs gentle vs animated)
- color-temperature within the captured palette (warm-leaning vs cool-leaning vs neutral-balanced)
- spacing rhythm (compact vs even vs generous within the floor)

**Forbidden differentiation axes** under verbatim: section sequence, section presence/absence, IA priority, layout strategy of a major section. All of A1/A2/A3 apply **every** item from `<slug>-improvements.md`; they differ only in surface treatment of the same applied fixes. The convergence detector (`prototype/SKILL.md` Discipline 10) becomes its inverse: structural deltas **forbidden**, surface-only deltas **required**. The variant role contract below does **not** apply under verbatim.

**Under `ia-fidelity: reimagined` — A + B + C role-differentiated.** Slots follow the variant role contract; everything below applies as written.

#### Variant role contract

| Slot | Role | Brief |
|---|---|---|
| **A** | **Faithful + improvements** — *"this is what your site should be tomorrow."* | Same IA, same section sequence, same composition strategy. Apply every item from `<slug>-improvements.md` exactly — no extras, no embellishment, no creative reach. The brand team reacts *"yes, that's us, with the obvious fixes."* The variant a risk-averse stakeholder green-lights. |
| **B** | **One captured trait amplified** — *"what if we leaned into X?"* | Pick one trait already in the captured surface — an underused motif, an unexploited photographic treatment, an underplayed IA priority, a tonal register alive in copy but not layout. Justify in one sentence in the shape brief: *"This variant amplifies <captured trait> in service of <brand personality move from PRODUCT.md>."* |
| **C+** | **Different captured trait amplified** — *"what if we leaned into Y?"* | Different trait than B by definition, different brand-personality move. Forbidden definitions: *"B but more"*, *"bolder fonts"*, *"more empty space"*, *"more brutalist"*, *"more editorial"*. Each C+ must be a defensible standalone proposition. Variants beyond C (D, E, …) follow the same contract, each amplifying a distinct captured trait declared in the shape brief. |

#### Surface forks of role-differentiated variants (B1/B2/B3, …)

Under reimagined, a role variant may spawn **surface forks** — tunings of the *same role* across the same six surface axes as A1/A2/A3 (e.g. B = "scroll cinema amplified"; B1/B2/B3 all amplify scroll cinema, varying type-weight / type-scale / density / motion-energy / color-temperature / spacing-rhythm). The role contract binds the captured trait being amplified; the surface-fork delta governs how it reads in chrome.

Surface forks are **opt-in, not default** (the default fork under reimagined is still A + B + C). They appear only via:
1. explicit user request (*"design 5 variant directions for B"* → render B1…B5, each amplifying B's trait with distinct surface tunings); or
2. `--add-variant <name>` with a parent inferred from the letter prefix (`B3` → parent `B`) — see `reference/add-variant.md` § Variant parentage.

Rules: same **≥ 2 surface-changes** contract per pair; the amplified captured trait is **held constant** across the fork; structural differentiation (section sequence / presence / IA priority / layout strategy) between a parent and its surface forks is **forbidden** — the role IS the captured trait, and changing structure changes the role. The convergence detector reads the variant's parent slot: parent–child pairs (B vs B3) get the verbatim-style inverse rule (surface deltas required, structural forbidden); sibling role variants (B vs C) get the reimagined rule (structural deltas required). Amplified surface axes are capped at the parent role's cap; a fork exceeding it must declare a **cap override** in its DESIGN.json extensions with a one-sentence rationale citing a captured-source basis (e.g. *"B3 raises B's motion choreography count from ≤ 3 to ≤ 5 to accommodate the loud-register tuning of scroll cinema"*) — no captured-source rationale → refuse the override (it would be surface drift, not trait amplification).

#### Variant differentiation contract

Each pair of role-differentiated variants must differ by **≥ 2 substantive changes** drawn from:
- section sequence (which sections appear in which order),
- section presence / absence,
- layout strategy of a major section (hero split-half vs full-bleed-photo vs type-led),
- IA priority (which audience leads the home — donor vs recipient vs volunteer; product vs story).

Pairs failing the test are the same variant under different chrome — the published *"variants are barely different"* failure — and are grounds for **refusing render**. When only 1–2 captured traits are distinct enough to amplify, surface it and propose 1 or 2 variants instead of 3 weak ones (§ Failure modes (b)).

#### The C-cliff: render-refusal conditions

These C+ definitions are **render-refusal conditions** (name origin: `reference/mode-notes.md`):
- *"Everything from B but more"* — B+more is not a direction.
- *"120pt+ display fonts"* — size-as-personality is not a captured trait.
- *"96px+ section padding everywhere"* — padding-as-personality is not a captured trait, and conflicts with the intent-dimensions § 4 density floor.
- *"Extreme airy"* / *"extreme dense"* / *"extreme [axis]"* — slider positions pushed past the prior variant are not directions.
- Editorial-register vocabulary (*atelier*, *the studio*, *mise-en-place*, *the journal*) when the brand register is product / commerce / direct-services (toolkit § 1 → Voice-rule moves → `Editorial-register vocabulary applied to non-editorial brands`).

C+ must answer *"what if we leaned into Y?"* with a specific Y from the captured surface, not a slider pushed past B. The fix for a weak C is never to soften it — it is to define it against a captured trait instead of against B.

### Phase 3 — Author target PRODUCT.md

Write `PRODUCT.md` at the project root using impeccable's `reference/teach.md (current impeccable versions ship the same format spec in `reference/init.md`; use whichever exists)` as the **format spec** (not a runtime command to invoke — by now every answer impeccable's interview would surface has been resolved). Populate:

- **Register** — from the resolved `register` axis.
- **Users** — resolved audience tuple + tone signals from the extracted brand surface.
- **Product Purpose** — user's phrase + extracted hero copy + resolved tone; one-line value statement, then one-line scope.
- **Brand Personality** — resolved expressive axis + tone + reference set. Weight axes the user explicitly moved over inherited values.
- **Anti-references** — the user's stated anti-refs **plus** anti-toolbox guardrails relevant to the direction (e.g. "modernise" triggers the Generic-2026-SaaS silhouette guardrail; list it explicitly so prototype and polish enforce it).
- **Design Principles** — 3-5, each mapping to a specific axis movement; one verb-led principle + one-line elaboration.
- **Accessibility & Inclusion** — populated when constraints include `a11y-first`, `RTL-required`, or similar; otherwise inherit impeccable's defaults.

A section that cannot be populated with confidence gets `<!-- _provenance: inferred -->` + a one-line basis sentence. Never invent strategy.

### Phase 4 — Author target DESIGN.md and DESIGN.json (site-level only)

Write `DESIGN.md` at the project root using impeccable's `reference/document.md` as format spec — Stitch YAML frontmatter + the 6 canonical sections in fixed order.

**Site-level only.** `direct` authors the design **system**; page-level deployments live in `stardust/prototypes/<slug>-shape.md` (written by `prototype` Phase 1, per `skills/prototype/reference/page-shape-brief.md`). The boundary is **abstract role vs literal deployment**:

| In DESIGN.md / DESIGN.json (site system) | In `<slug>-shape.md` (page deployment) |
|---|---|
| Token vocabulary (colors, typography, spacing, radii) | Per-page section list and order |
| Voice rules ("Mixed-Case-Headlines"), anti-refs, anti-toolbox audit, divergence trace | Literal copy per section (from `current/pages/<slug>.json`); page-specific layout decisions ("hero is 5/3 split on home") |
| Abstract component vocabulary (`button-primary`, `button-secondary`, `card`, `input`, `badge`, `link`): default treatment, density, sizing — NO page-specific dimensions or content | Section-level component dimensions (e.g. `the211Panel` at 320×260 with dock points per viewport) |
| Named system-component **roles** (a `header` exists, a `footer` exists, a `cta-band` pattern exists) + default visual treatment per component | System-component **deployment**: literal tile labels in fixed order, link targets, copy variants; per-page composition (statRow with literal "100 YEARS · 18,400 PEOPLE HOUSED · …") |
| Voice samples (do/don't, tone exemplars) | Per-page interaction model and key states |

**Must not appear** in DESIGN.md / DESIGN.json: literal tile labels for system-component patterns; section-level pixel dimensions, dock points, breakpoint-specific widths; stat numbers, addresses, quotes, named-person references; "on home, the hero is X" (a home-page deployment); per-page copy variants ("on the donate page the CTA reads Y"). If a section-level dimension or literal label feels site-wide ("every page has a 211 panel docked bottom-right"), encode an **abstract role** in `DESIGN.json extensions.systemComponentRoles` (e.g. `persistent-help` with purpose / position-class but no literal copy or dimensions) and let each page's shape brief specify the deployment.

Token sources:

- **`colors`** — the picked palette (palette-picker output) or the inherited palette with role-renaming. Role names must satisfy toolkit § 4 (brand-native; no `Primary` / `Secondary` / `Alarm` etc. as sole role names).
- **`typography`** — the chosen font deck. Sizes scaled by the resolved expressive axis: drenched → ratio ≥ 1.333; committed → 1.25; restrained → 1.125-1.2. Heading vs body assignments inherit from the deck.
- **`rounded`** — from extracted brand-surface `borderRadius.primary` mode, unless the direction moves distinctiveness toward `singular` (then re-derive from the font deck's tonal cousins).
- **`spacing`** — 4pt base scale; `sectionPadding` picked deterministically from the Phase 1 density stamp — never re-ask here:
  - `airy` → desktop 96px / tablet 72px / mobile 48px
  - `balanced` → 64 / 48 / 32  ← brand-register default
  - `packed` → 48 / 36 / 24  ← product-register default

  **Hard floor enforcement.** When the captured page inventory shows > 5 sections OR > 2 audience tracks (intent-dimensions § 4 → "Hard floor for brand-register multi-audience sites"), `sectionPadding.desktop` is bounded to ≤ 64px and ≥ 40px on **every** variant including the highest-divergence one. If Phase 1 stamped `airy` despite the trigger firing → surface the conflict before writing tokens: *"density tier `airy` was selected but the captured inventory triggers the multi-audience hard floor; pick (a) override floor (`density: airy (user-pinned)` in direction.md) or (b) accept the floor (sectionPadding capped at 64px)."* No answer → default (b).
- **`components`** — 4-6 canonical components (`button-primary`, `button-secondary`, `card`, `input`, `badge`, `link`) populated from extracted brand-surface `componentStyle`, adjusted for direction movements.

Every component HTML/CSS snippet in `components[]` must be self-contained, use `ds-` class prefixes, and respect impeccable's hard rules (OKLCH only, no pure black/white, no glassmorphism, no side stripes, no gradient text, ≥ 1.25 type ratio for brand register).

Write `DESIGN.json` (schemaVersion 2) with:

- `extensions.colorMeta`, `typographyMeta`, `shadows`, `motion`, `breakpoints` — filled from the same sources as DESIGN.md. The `motion` block carries the **register selection** (whether cinematic motion may apply at prototype time):

  ```json
  "motion": {
    "register": "arrival | kinetic-display | live-systems | editorial | kinetic-grid",
    "registerRationale": "<one-line citation to the PRODUCT.md Brand Personality trait that selected it>",
    "easings":   { "entrance": "...", "transition": "...", "expo": "..." },
    "durations": { "enter": <ms>, "stagger": <ms> },
    "parallax":  { "translate": <vh>, "fade": <0-1>, "rangeStart": <%>, "range": <%> }
  }
  ```

  Pick the register per `skills/prototype/reference/motion-registers.md` § Selection heuristic, reading the resolved PRODUCT.md § Brand Personality:

  | Personality traits (any match) | Register |
  |---|---|
  | `civic-formal` + (`institutional` OR `place-led`) | `arrival` |
  | `signage-led` OR `wayfinding-first` OR `display-typography-signature` | `kinetic-display` |
  | `operationally-transparent` OR `data-led` OR `dashboard-register` | `live-systems` |
  | `editorial` OR `slow-paced` OR `publication-register` | `editorial` |
  | `product` OR `SaaS` OR `transactional` OR `modular-catalogue` | `kinetic-grid` |
  | (ambiguous / no clear match) | `arrival` |

  Copy the register's token defaults verbatim from motion-registers.md § The five registers unless the user provided overrides during intent reasoning. `registerRationale` records the one-line justification so reviewers can audit the choice. **`direct` selects the register; it never applies motion** — that happens at prototype time under `--cinematic`. Pages whose redesign needs no motion leave `register` absent; cinematic prototype then asks or picks from the heuristic at render time. When the intent phrase contains explicit motion direction ("make it cinematic", "feel alive", "move like signage"), pick the register and set `registerRationale: "user-phrase: <verbatim>"`.

  **Per-variant placement (N > 1):** the `motion` block goes into the variant-specific `DESIGN-<id>.json` files (§ Multi-variant DESIGN files), not the site-level `DESIGN.json`. Static variants omit the block entirely; cinematic variants declare a `register` — this is what lets one variant (typically C) be cinematic while siblings stay static (`prototype` Phase 2.4 reads `DESIGN-<id>.json.extensions.motion.register` per variant and fires only where present).
- `extensions.divergence` — full audit trail per the v2 shape in `divergence-toolkit.md`, including the brand-faithful inversion log (per `reference/direction-format.md` § Divergence inputs) capturing pure-color or hex-format retentions.
- `extensions.componentStyle` — the **abstract** v1 fields (`buttons`, `cards`, `inputs`, `dualCTAPattern`): default treatment per component, no per-page dimensions or literal copy.
- `extensions.systemComponentRoles` — abstract roles for named cross-page patterns (`persistent-help`, `cta-band`, `header`, `footer`): purpose, position class, site-wide constraints — **not** literal copy, dimensions, or per-viewport dock points (page-deployment, in `<slug>-shape.md`).
- `extensions.voice` — sampled DOs and DON'Ts from `_brand-extraction.json` voice samples + the resolved tone.
- `narrative.northStar`, `overview`, `keyCharacteristics`, `rules`, `dos`, `donts` — from the resolved direction. Toolkit § 7 Optional House Standards land in `narrative.rules[]`.

#### IA-priority preservation audit (Mode A)

After tokens are drafted but **before** they land in the variant DESIGN files, run the audit per intent-dimensions § 8. For each captured signal that fires a trigger condition (commercial conversion, search-led IA, donation funnel, crisis affordance, audience routing), record an `extensions.iaPriorities[]` entry:

```json
{ "signal": "crisis-affordance",
  "evidence": "pages/home.json#landmarks[hero] contains heading 'Looking for immediate shelter?' + phone 801-990-9999",
  "preserveAs": "first-viewport", "scope": "site-wide", "mutability": "movable" }
```

Each entry is a constraint `prototype` and `migrate` must honor — a variant whose home shape brief omits the crisis affordance from the first viewport **fails the audit and is rejected**. The audit is the structural enforcement of § 8; without it, IA-priority preservation is a guideline rather than a contract. `mutability` comes from the Phase 1 `ia-fidelity` stamp (§ 9): `locked` under verbatim (variants may not move the priority at all — A1/A2/A3 are surface forks), `movable` under reimagined (variants may demote / promote / re-shape the deployment, but the § 8 floor still fires). Stamped once here; prototype reads it as source of truth.

#### Multi-variant DESIGN files (when N > 1)

Phase 2.6 active → write per-variant files at the project root instead of a single pair:

```
PRODUCT.md                  ← shared (audience, register, content strategy are per-brand, not per-variant)
DESIGN-A.md / DESIGN-A.json ← variant A (faithful + improvements)
DESIGN-B.md / DESIGN-B.json ← variant B (one captured trait amplified)
DESIGN-C.md / DESIGN-C.json ← variant C (different captured trait amplified)
```

Each variant's files inherit the shared `extensions.iaPriorities[]` audit — variants cannot opt out of IA-priority preservation under Mode A. Under rebrand mode (`--rebrand` or trigger phrase) the fork still writes per-variant DESIGN files but PRODUCT.md may also vary — rebrand permits the strategy to shift, not just the visual treatment.

### Phase 5 — Write direction.md and update state

Write `stardust/direction.md` per `skills/direct/reference/direction-format.md` — the full reasoning trace: phrase, restatement, movements, gaps, questions and answers, resolved axes, divergence inputs, command sequence proposed, user confirmation, every assumption that defaulted in. Re-directs **append** a new section; prior direction stays as history.

Update `stardust/state.json`:
- `direction.resolvedAt` = now; `direction.phrase` = the user's verbatim phrase; `direction.directionFile` = `"stardust/direction.md"`.
- Each in-scope page: `status` `extracted` → `directed`.
- On `--re-direct`, each page already `prototyped` / `approved` / `migrated`: set `stale: true`, `staleReason: "direction changed at <ts>"`. Do **not** change the status itself — the on-disk artifact is still valid, just out of step.

Print a one-screen summary and recommend the next step — phrase, audience, register, per-axis movements (moved / unchanged / resolved), divergence resolutions (seed, font deck, palette), files written, state changes (N pages `extracted → directed`, stale-prototype count), then `Next: $stardust prototype` (defaults to home page).

## Outputs

| Path | Purpose |
|---|---|
| `PRODUCT.md` | Target strategy (impeccable format). Shared across variants when N > 1 under Mode A. |
| `DESIGN.md` / `DESIGN.json` | Target visual system (Stitch frontmatter + 6 sections) + sidecar with extensions (divergence, componentStyle, voice, iaPriorities) and narrative. Single-variant runs only. |
| `DESIGN-{A,B,C,…}.md` / `.json` | Per-variant DESIGN files + sidecars when N > 1 (Phase 2.6 active). |
| `stardust/prototypes/<slug>-improvements.md` | Improvements list (Mode A only, Phase 2.5). Load-bearing artifact for variant A. |
| `stardust/direction.md` | Resolved direction + full reasoning trace + per-variant resolutions when N > 1. |
| `stardust/state.json` | Direction block + per-page status changes + `direction.variantMode` + `direction.variants[]` when N > 1. |

## Failure modes

- **No extracted state.** → Abort; recommend `$stardust extract`.
- **Phrase too vague after two questions.** → Persist the partial reasoning to `stardust/direction.md` under a `# Pending` section, ask the user to refine; do **not** write PRODUCT.md / DESIGN.md / DESIGN.json from incomplete reasoning.
- **Re-direct with prior approved or migrated pages.** → Always confirm before stale-flagging: the flag is visible and reversible (cleared automatically on successful re-run of prototype or migrate), but a re-direct invalidates work the user may have signed off on.
- **Anti-toolbox audit collapse.** Direction collapses to defaults after the audit strips unjustifiable hits → surface it and re-prompt for reference anchors before writing tokens.
- **(b) Insufficient brand signal for N variants.** Fewer than 3 distinct captured traits to amplify (monochrome palette, single type face, no distinctive motifs, or `signal-thin` per Setup 6) → refuse to render N ≥ 3 variants under Mode A. Say so plainly: *"the captured surface has 2 distinct traits to amplify; producing 3 variants would force one to invent moves not present in the brand."* Propose 1–2 variants and let the user choose, or recommend extract with a wider crawl. One strong variant beats three weak ones.
- **(c) Hard rule conflict.** Mode A active *and* the phrase requires violating a pin (e.g. *"a completely different palette"* without `--rebrand`) → stop and name the conflict: *"You asked to keep the brand and to change the palette — those are not compatible. Did you mean (a) keep the current palette and only refresh execution, (b) rebrand (`--rebrand`) and roll a new palette, or (c) Mode A with a targeted palette move (single role recolored, rest pinned)?"* Wait for an explicit answer.
- **(d) Empty improvements list.** Phase 2.5 yields < 3 weaknesses meeting the specificity bar → stop before rendering any variant (A has no brief; the *"better"* claim fails). Surface honestly (*"the captured site is already at a competent execution level on observable dimensions — variant A would reduce to spacing and contrast adjustments only"*) and offer: (a) reduced scope (density + contrast only), (b) `extract --cap 25` or higher to surface more weaknesses, (c) pivot to `--rebrand` where the brand-fidelity floor doesn't apply.

Add-variant-specific failure modes: `reference/add-variant.md` § Failure modes.

## References

- `skills/stardust/reference/intent-dimensions.md` — the 8 axes (7 axes + § 8 IA-priority preservation, § 8b signature preservation, § 9 ia-fidelity).
- `skills/stardust/reference/intent-reasoning.md` — the Phase 1 procedure. Worked examples: `intent-examples.md`.
- `skills/stardust/reference/impeccable-command-map.md` — when to reach for each impeccable command (used when building the plan).
- `skills/stardust/reference/reference-research.md` — research-first anchor procedure (refero MCP → WebSearch → seed fallback) for Mode B and Default mode; evidence shape and budgets.
- `skills/stardust/reference/divergence-toolkit.md` — anti-mediocrity inputs, v2 audit-trail storage shape, anti-toolbox additions for multi-variant moves (`C-cliff overshoot`, `Anonymous middle variant`, `Variant homogeneity`) and universal hardening (`Fabricated content`, `Hero text on photographic background without contrast scrim`, `Editorial-register vocabulary applied to non-editorial brands`).
- `skills/stardust/reference/artifact-map.md` — provenance shape.
- `reference/direction-format.md` — schema for `stardust/direction.md`.
- `reference/palette-picker.md` — palette resolution procedure.
- `reference/prep-mode.md` — `--prep` modal flow (read gate at § Inputs).
- `reference/add-variant.md` — `--add-variant` modal flow: procedure, parentage/inheritance tables, failure modes (read gate at § Inputs).
- `reference/mode-notes.md` — rationale and provenance for mode defaults (2026-04-29 default flip, C-cliff origin, role-contract history). No rules live there.
