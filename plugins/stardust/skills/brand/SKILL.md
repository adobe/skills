---
name: brand
description: "Create, extract, refine, review, critique, or iterate on the brand identity at `stardust/brand-profile.json` and `stardust/brand-board.html` (and `.impeccable.md`) — philosophy, logo, colors, typography, componentStyle, motifs, photography direction, voice, tone, content pillars, personas, spacing. Ingests guidelines (PDF, URL, or conversation) or iterates on an existing profile. Use when the user provides brand guidelines, when the user asks to change, refine, refactor, review, improve, polish, critique, or iterate on any aspect of brand identity, or whenever the user asks to modify a file at `stardust/brand-profile.json`, `stardust/brand-board.html`, or `.impeccable.md`."
license: Apache-2.0
metadata:
  version: "0.1.0"
---

# Brand Extraction

Extract brand identity from guidelines and produce a visual brand board for designer approval.

## When to use this skill

- The user provides brand guidelines (URL, PDF, or conversational description) and asks to extract, create, or capture brand identity.
- The user asks to change, refine, review, critique, or iterate on `stardust/brand-profile.json`, `stardust/brand-board.html`, or `.impeccable.md`.
- The user types `/stardust:brand`.

## Do NOT use this skill

- For page copy, headlines, or intent — those live in briefings. Hand off to `briefings`.
- For visual layout, spacing, or prototype styling — those belong to `prototype`.
- To render wireframes. Hand off to `wireframes`.

## Pre-flight

Run the procedure in [`../_shared/preflight.md`](../_shared/preflight.md) first.
`.impeccable.md` is optional input; if absent this skill may create it.

## Contract

**Needs (reads if present):**
- Brand URL, PDF, or conversational description from the user
- `.impeccable.md` (design personality, if any)

**Produces:**
- `stardust/brand-profile.json`
- `stardust/brand-board.html`
- `stardust/assets/logo.<ext>` (extracted or synthesized)
- `.impeccable.md` (created or updated)

**If missing:**
- No URL/PDF/anchor-set/description → deliver the "no reference" warning in the Inputs section below before synthesizing. If the designer proceeds without any reference, roll a deterministic random seed from [`../_shared/divergence-toolkit.md`](../_shared/divergence-toolkit.md) §2, stamp `_divergence.divergence_warning = true` on the profile, and use the seed as a hard constraint on visual decisions. Stamp provenance per [`../_shared/skill-contract.md`](../_shared/skill-contract.md).
- No `.impeccable.md` → prefer the designer-authored path (see Phase 3). Only fall back to synthesis after the "last chance" prompt has been declined, and stamp `authored_by: synthesized` in frontmatter.

---

## Inputs

The designer provides ONE of:

1. **Brand guidelines URL** — a web-based brand guide (Corebook, Frontify, Brandfolder) or a live marketing site.
2. **Brand guidelines PDF** — uploaded document.
3. **Reference anchor set** — a moodboard URL (Are.na, Pinterest, Dribbble collection) OR 3–5 uploaded reference images with short context notes. This is NOT a brand guideline — it is a visual anchor that keeps the extraction honest.
4. **No reference (conversational)** — the explicit escape hatch. See warning below.

### When the designer has no reference

The skill defaults to requiring at least option 3 (anchor set). Before proceeding without any reference, stop and say, verbatim:

> Without a reference, visual decisions will be synthesized from the assistant's defaults. The assistant has known recurring moves (see `../_shared/divergence-toolkit.md` §1) that tend to appear across unrelated brands.
>
> Options:
> - Provide a reference anchor set (option 3 above) — 2 minutes, biggest divergence payoff.
> - Run `/impeccable teach` yourself first — produces a personal `.impeccable.md` that pushes back on assistant defaults.
> - Proceed anyway with `source: conversation`. The profile will be stamped with a divergence warning and the skill will roll a random seed per `../_shared/divergence-toolkit.md` §2.

If the designer proceeds anyway, set `_provenance.source = "conversation"` and `_divergence.divergence_warning = true` in the emitted `brand-profile.json`. The skill then rolls a deterministic random seed from §2 of the toolkit (decade × craft × register) and uses it as a hard constraint on visual synthesis. Downstream skills read both flags and adjust.

## Phase 1: Extract

### If guidelines URL or PDF provided:

**Always use a real browser (Playwright or equivalent) to extract brand signals from a URL. Do NOT rely on WebFetch or raw HTML — it misses JS-rendered copy, computed styles, and the visual identity cues that actually make a brand recognizable.**

WebFetch inference produces generic brand profiles ("Inter body, pill buttons, deep blue accent") that could describe any product. The goal here is *specificity* — the quirks that make the brand itself, not a generic version of its category.

#### 1. Drive a real browser

Use Playwright (Chromium, viewport 1440×900, deviceScaleFactor 2) to load the URL, wait for network idle + ~1.5s, then both:

- **Take screenshots** — a hero clip (1440×900) and a full-page screenshot. Save to a scratch dir.
- **Evaluate computed styles in the page context** and capture:
  - `:root` / `html` CSS custom properties (brand often exposes design tokens here)
  - `<body>` computed `background-color`, `color`, `font-family`
  - All unique `font-family` values in use (walk `body, body *`)
  - First 10 headings: tag, text, `font-family`, `font-weight`, `font-size`, `line-height`, `letter-spacing`, `color`
  - First `<p>` body sample with the same style props — note `color` carefully (Arc uses `rgba(0,0,0,0.65)`, not pure ink)
  - `<em>`, `<i>`, or `[class*="italic"]` elements — the italic display accent often lives here and is brand-specific (Exposure VAR, etc.)
  - First 8 CTAs (`a[class*="button"]`, `button`, `[class*="cta"]`): text, `background-color`, `color`, `border-radius`, `padding`, `font-family`, `font-weight`. Capture **multiple CTA variants** — primary/inverted/inked patterns matter.
  - Section background colors (walk `section, header, main > div`) — surface a variant cream, a variant ink, or an off-white you'd otherwise miss
  - `<img>` and `<svg>` with logo/brand/hero classes — source paths
  - Meta tags, especially `theme-color` (the brand's official color), `description`, `og:*`
  - Hero copy text (first 6 h1/h2/p contents)

#### 2. Identify identity traits, not just tokens

After extraction, explicitly look for and record:

- **Signature border-radius** — brands often pick a specific non-round value (10px, 14px). Record it as `componentStyle.borderRadius.default`.
- **Body text opacity** — is body copy at full ink or softened (e.g. 65%)? This is a recurring brand trait.
- **Display metrics** — if headings run tight (`line-height < 1.0`, `letter-spacing < -0.03em`), capture both values verbatim. These feel-of-type details are what separate a real brand from a generic clone.
- **Multiple CTA patterns** — if you see inked-black, branded-color, and inverted buttons, record all three with their exact styles.
- **Color variants for context** — capture "cream on blue" as a separate color if the value differs from "cream on cream" (e.g. `#FFFADD` vs `#FFFCEC`).
- **Visual motifs beyond logos/colors** — look at the screenshot and name them: dashed dividers, aurora gradients, squiggle separators, noise textures, hand-drawn elements. Add a `motifs` array to the brand profile with `name`, `description`, `usage`. These motifs are what signal the brand before a word is read.

#### 2.5 Locate and save the real logo

The logo is a real asset — download it, don't synthesize it. Walk this fixed order and stop at the first hit:

1. **Inline `<svg>` inside the page header or `<nav>`** — look for `header svg`, `nav svg`, `[class*="logo" i] svg`. Serialize the outer HTML and save as `stardust/assets/logo.svg`.
2. **`<img>` with a logo-shaped src or class** — `header img`, `nav img`, `img[src*="logo" i]`, `img[class*="logo" i]`, `img[alt*="logo" i]`. Download the resolved URL. Prefer SVG; fall back to the highest-resolution PNG or WebP.
3. **`<link rel="icon">`, `<link rel="apple-touch-icon">`, `og:image`** — in that order. These are branded marks even if not full wordmarks.
4. **Favicon** — `/favicon.ico` or `/favicon.svg` at the site root. Last resort.
5. **No logo found** — create a minimal placeholder SVG with the brand name as text, save to `stardust/assets/logo.svg`, and add `"logo: synthesized placeholder — no mark found on source"` to `_provenance.synthesized_inputs`.

Save all downloads to `stardust/assets/` (not `icons/` — the design phase is platform-agnostic; `icons/` is a convention some downstream systems use, e.g. AEM Edge Delivery Services, which would leak structure into stardust).

Record the outcome in the brand profile's `logo` object:

```json
"logo": {
  "path": "stardust/assets/logo.svg",
  "format": "svg",
  "source": "inline svg in <header> | <img src=...> | apple-touch-icon | favicon | synthesized"
}
```

For the PDF path, extract embedded images — prefer vector — and save the same way.

For the conversational path, synthesize a placeholder as described above and stamp `_provenance.synthesized_inputs`.

#### 3. Voice examples from live copy

Pull real copy from the rendered page (hero headlines, CTAs, micro-copy) for `voice.examples.do`. Real examples beat invented ones. Note rhetorical devices — em-dashes, rhythmic triplets, single-word italic accents — and call them out in `voice.rules`.

#### 4. PDFs and non-URL sources

If the input is a PDF or uploaded asset, read it directly (PDF viewer / Read tool) and extract palette, typography, and voice cues inline from the rendered pages. Playwright is the primary path for URLs; direct read is the path for static assets.

#### 5. Write the profile

Map everything to the brand profile schema — consult [brand-profile-schema.md](reference/brand-profile-schema.md).

**Every `brand-profile.json` MUST start with a `_provenance` block** per [`../_shared/skill-contract.md`](../_shared/skill-contract.md). Populate:

- `generated_by: "brand"`
- `date` — today, ISO format
- `source` — URL, PDF path, or `"conversation"`
- `extraction_method` — the actual method used (e.g. Playwright string, PDF read, conversation only)
- `synthesized_inputs` — enumerate **every field the skill filled in but did not extract from source**. Examples: "personas (mottos, values) — composed from extracted voice signals, not read from the page"; "contentPillars descriptions — inferred from nav + hero copy"; "voice.examples.dont — LLM-composed to match extracted voice rules". If you genuinely extracted every field from source, pass an empty array and note it.
- `screenshots` — scratch paths

Readers use `synthesized_inputs` to decide what to trust. Be honest and specific. "Some fields" is not acceptable — list each one.

Do **not** emit a separate `extraction` block. All source-of-extraction info lives inside `_provenance`.

Pay special attention to:
- **Voice examples** — do/don't copy pairs. Critical for content generation. Extract from live copy.
- **Photography direction** — style rules, composition, subject matter. Feeds image generation.
- **Logo variants** — primary mark always saved to `stardust/assets/logo.<ext>` (see Step 2.5). Additional variants (white-on-dark, mono, stacked) also go under `stardust/assets/` with descriptive names like `logo-white.svg`.
- **Color roles** — don't just capture hex, capture what each color is FOR (CTAs, headings, backgrounds, on-blue text).
- **Motifs** — the non-obvious visual gestures. Without these the board reads as a generic palette.

### If no guidelines (conversational):

1. Run the soft-deps discovery decision before asking anything inline:

   **If `/brainstorm` is registered in this session** (detect per [`../_shared/soft-deps.md`](../_shared/soft-deps.md)): hand off to `/brainstorm` with a seeded prompt naming the brand (if known) and the discovery topics below. Wait for its output; use the result to populate `brand-profile.json`. Do NOT run an inline interview once this delegation is made.

   **Otherwise (superpowers not installed):** announce the fallback **exactly once per session**, using the verbatim text from [`../_shared/soft-deps.md`](../_shared/soft-deps.md) ("superpowers announcement"). Then run the inline interview.

   Either path covers the same topics: brand name, mission, target audience, personality (3-5 adjectives), colors they like/dislike, typography preference (serif/sans/mixed), photography style, competitive positioning.

   The user must be able to tell which path ran — either by `/brainstorm`'s visible hand-off UI or by the one-time announcement. Silent inline interviews are a bug.
2. From the conversation, construct `stardust/brand-profile.json` with whatever was discussed.
3. Mark optional fields as null — the designer can fill them in later.

## Phase 2: Palette Selection

Before writing the palette into `brand-profile.json`, the designer picks from a set of candidate palettes pulled from the bundled library at [`../_shared/palettes/`](../_shared/palettes/). Every candidate palette's colors come from [coolors.co/palettes/trending](https://coolors.co/palettes/trending) and carry a source URL back to the original — zero assistant-invented hexes.

See [`../_shared/palette-picker.md`](../_shared/palette-picker.md) for the full classifier vocabulary, filter scoring rules, and HSL helpers. See [`reference/pick-ui-template.md`](reference/pick-ui-template.md) for the UI structure and template.

### Skip this phase when

- The brand has authoritative guidelines and the URL/PDF extraction produced a real palette — use the extracted palette as-is (record `_divergence.palette_source.method = "extracted-from-source"`).
- The designer explicitly provides a palette file at `stardust/palettes/brand.json` — use it verbatim (`method = "designer-provided"`).
- Running in fully-automated pipeline mode with no description — fall back to auto-classification from brand voice + seed (`method = "auto-classified"`).

Otherwise, run all six steps below.

### Step A · Derive the palette description

1. **If the designer provides a natural-language palette brief** (e.g. *"freaking bold and shocking"*, *"clean and superbly engineered"*, *"muted sage, considered"*), use it verbatim.
2. **Otherwise synthesize one short descriptor** from:
   - the brand's content pillars,
   - the brand voice traits,
   - the seed triple from `_divergence.seed` (decade × craft × register),
   - any ground-family hint from `_divergence.seed.ground`.

   Example: for a Lagos dance collective with seed `1960s × folded-paper × travel-brochure × saturated`, a reasonable synthesized description is *"bold youthful outdoor, 1960s travel brochure, saturated"*.

Stamp the description in `_divergence.palette_source.description_used`.

### Step B · Classify the description

Apply the keyword vocabulary from [`../_shared/palette-picker.md`](../_shared/palette-picker.md) § 1 to extract the five descriptor dimensions:

- `energy` (1–5)
- `contrast` (1–5)
- `saturation_level` (1–5)
- `hue_bias` (hot / warm / mustard / green / teal / cool / violet / neutral / rainbow)
- `ground_family` (cream / stark-white / pale-gray / saturated / dark / monochrome-tint)

Any dimension the description doesn't trigger keywords for stays `null` (no constraint). Keyword matching is whole-word, case-insensitive. Record the full classification in `_divergence.palette_source.classification`.

### Step C · Filter and score the library

Load palettes from `../_shared/palettes/` — either from the consolidated `library.json` or by walking each `<ground-family>/*.json` file. Apply the filter scoring from [`../_shared/palette-picker.md`](../_shared/palette-picker.md) § 2:

- `ground_family` exact match: +100
- `hue_bias` exact match: +50 / loose match (hue group): +20
- `saturation_level` difference: `max(0, 30 − 10·diff)`
- `energy` difference: `max(0, 20 − 8·diff)`

Keep palettes with score > 0. Sort descending by score. Take the top 5 as candidates.

Compute the recommended pick via `byte[0]` of `MD5(description + YYYY-MM-DD)` mod `len(top_5)`. This is the default the designer can accept with a single keypress; the others are alternatives at the same score tier.

### Step D · Render the pick UI

Write `stardust/_palette-pick.html` following the template structure in [`reference/pick-ui-template.md`](reference/pick-ui-template.md):

- Shows the description and the classifier output at the top
- Renders the 5 candidates as numbered cards (1 = recommended, 2–5 = alternatives)
- Card 1 gets a gold border and larger swatches
- Each card: swatches with hex labels, anchor marker (★), cream-family flag if present, palette name linked to Coolors source, classification tags
- Footer instruction: "Tell the assistant a number (1–5), a palette name, or 'refine' to change the description."

**Immediately after writing the file**, open it in the designer's default browser per [`../_shared/skill-contract.md`](../_shared/skill-contract.md) *Opening HTML artifacts*. On macOS: `open stardust/_palette-pick.html`. Do not require the designer to open it manually.

Then say:

> "Your palette pick UI is open. Five candidate palettes from the library. Tell me a number (1–5), a palette name, or 'refine' to change the description."

### Step E · Designer picks

Wait for the designer's input. Valid responses:

- Integer 1–5 → pick that card
- Palette name substring match → pick the matching card
- `refine` / `none` → re-ask Step A for a new description, re-run B–D
- `pick` / Enter → accept the recommended (index 1)

**Pipeline automation:** when invoked as part of a full end-to-end pipeline run (no interactive designer), auto-accept the recommended pick and continue.

### Step F · Record and write to brand-profile

Write the chosen palette into the in-memory brand profile (not yet on disk — Phase 4 writes the file). Each Coolors hex becomes a `colors.primary[]` entry:

```json
{
  "name": "Ankara Burnt Orange",   // brand-native if the designer names it, else derived from Coolors palette name + swatch-role
  "hex": "#DD5B26",                 // from the picked palette
  "role": "Ankara",                 // brand-native role (see brand-profile-schema.md token-level enforcement)
  "use": "primary saturated ground, CTA fill"  // technical qualifier
}
```

Role-naming rule from `reference/brand-profile-schema.md` Role Naming — enforced applies: no `Primary` / `Accent` / `Brand` / `Background` / `Neutral` tokens in the `role` field. If the designer hasn't provided brand-native role names, derive from the brand's subject matter (e.g., "Bar Beach", "Grove", "Lamination").

Record the full chain in `_divergence.palette_source`:

```json
"palette_source": {
  "method": "library-pick",
  "library_version": "v0.6.0",
  "library_source": "coolors.co/palettes/trending (scraped 2026-04-24)",
  "description_used": "freaking bold and shocking",
  "classification": {
    "energy": 5, "contrast": 5,
    "saturation_level": null, "hue_bias": null,
    "ground_family": "saturated"
  },
  "candidates_shown": [
    { "index": 1, "name": "...", "source": "https://coolors.co/..." },
    { "index": 2, "name": "...", "source": "..." },
    "...up to 5..."
  ],
  "recommended_index": 1,
  "picked_index": 1,
  "picked_palette_name": "Autumn Glow",
  "picked_palette_source": "https://coolors.co/780116-f7b538-db7c26-d8572a-c32f27"
}
```

Leave the `_palette-pick.html` file on disk as an audit record.

## Phase 3: Design Personality

`.impeccable.md` captures the designer's *taste* — references, pet peeves, which rules to bend — signal that can't be inferred from the brand profile alone. It's produced by an interactive interview and used as a quality gate by downstream skills.

### Authorship matters

`.impeccable.md` has two authorship paths that downstream skills treat differently:

- **Designer-authored** (via `/impeccable teach` or the inline interview answered by the designer) — strong quality gate. Downstream skills enforce its rules.
- **Synthesized** (fallback, LLM-authored without designer input) — weak hint. Downstream skills render a visible banner on brand boards and prototypes: *"Design personality was synthesized by the assistant, not authored by the designer. The rules below reflect assistant defaults. Run `/impeccable teach` to replace."*

Every `.impeccable.md` file MUST open with frontmatter that declares authorship:

```yaml
---
authored_by: designer       # or: synthesized
author_date: YYYY-MM-DD
source: "/impeccable teach interview"   # or: "brand skill inline interview" | "brand skill synthesis fallback"
strength: strong             # designer → strong; synthesized → weak
---
```

Downstream skills key off `strength`. A file without this frontmatter is treated as weak.

### Path selection

This phase is delegated when possible; otherwise it runs a lighter inline interview.

**If the `impeccable` plugin is installed** (`/impeccable teach` is registered), pause and recommend to the designer:

> Before we render the brand board, run `/impeccable teach` in the prompt. It will interview you about design personality (references, do's and don'ts, taste) and write `.impeccable.md`. Downstream quality gates read this file.
>
> This is optional but recommended. You can also skip it — we can always run `/impeccable teach` later and re-refine. Reply "skip" to continue without it, or run the command now and then ask me to continue.

Wait for the designer to either run `/impeccable teach` (then resume) or explicitly say "skip". When `teach` runs, it stamps `authored_by: designer`. On "skip" without `teach` running, proceed to the "last chance" prompt below.

**If `impeccable` is not installed**, use the "For brand discovery" variant in [`../_shared/fallback-brainstorm.md`](../_shared/fallback-brainstorm.md) to run a short personality interview. The designer answers — stamp `authored_by: designer`, `source: "brand skill inline interview"`.

### Last-chance prompt before synthesis

Before the skill synthesizes `.impeccable.md` on its own (no designer interview), stop and ask:

> Before I synthesize `.impeccable.md` myself, would you rather answer three quick questions? References you like, things that annoy you, one rule you want broken. Three minutes, and the file reflects your taste instead of my defaults. Reply "ok" to do the interview, or "synthesize" to proceed without.

- Reply "ok" → run the three-question inline interview, write the file with `authored_by: designer`.
- Reply "synthesize" → write the file with `authored_by: synthesized`, `strength: weak`, and include the banner language in its body so downstream skills surface it.

**Never invent `.impeccable.md` content from the brand profile alone without declaring it synthesized** — that provides no signal beyond what's already captured, and stamping it as "designer" would mislead downstream quality gates into enforcing assistant defaults as if they were designer taste.

### Skip this phase when

- `.impeccable.md` already exists. (Read its frontmatter; do not overwrite.)
- Invoked as part of a full end-to-end pipeline run — but still present the last-chance prompt before synthesis unless the designer has explicitly opted out of it for the pipeline run.

## Phase 4: Render Brand Board

1. Read `stardust/brand-profile.json`.
2. Generate `stardust/brand-board.html` following the template in [`reference/brand-board-template.md`](reference/brand-board-template.md). Render the data contract sections in the canonical order.
3. The board must:
   - Use the brand's own extracted colors and fonts
   - Derive the page ground from the brand palette (see [`../_shared/divergence-toolkit.md`](../_shared/divergence-toolkit.md) § 2.5 Ground-color seed). **Do not default to cream** or any cream rebrand (vellum, kami, bone, ivory, eggshell).
   - Include sticky navigation for section jumping on long boards
   - Render only sections that have data (omit sections for null fields)
   - Be self-contained HTML with embedded CSS (no external JS)
4. Render the logo with `<img src="assets/logo.svg">` per `reference/brand-board-template.md` — never inline the SVG.
5. **Open the file in the designer's default browser** per [`../_shared/skill-contract.md`](../_shared/skill-contract.md) *Opening HTML artifacts*. On macOS: `open stardust/brand-board.html`.
6. Then say: "Your brand board is open. Review and approve, or tell me what to change."
   - In SLICC: the board also renders in the browser panel automatically; the open command is harmless.
   - In pipeline-automation mode (end-to-end auto-approve): skip the open.

## Phase 5: Approval Gate

This is a **hard gate** in interactive mode. Do not proceed until the designer approves.

**Pipeline automation:** When invoked as part of a full pipeline run (e.g., the user asked to run all stardust stages end-to-end with auto-approve), skip the interactive approval loop. Auto-approve and continue to the next stage. The user can always come back to refine later.

Present the brand board and ask: "Does this accurately represent your brand? What needs to change?"

Common feedback and how to handle it:
- **"That color is wrong"** → Update the hex in brand-profile.json, re-render the board
- **"The voice feels too [formal/casual/etc]"** → Update voice traits and examples, re-run `/teach` to update .impeccable.md
- **"Missing our secondary font"** → Add to typography section, re-render
- **"Photography direction is off"** → Update photography rules, re-render

Iterate until the designer says the board looks right. Then:
1. Confirm the brand profile is saved
2. Confirm .impeccable.md exists
3. Tell the designer: "Brand extraction complete. Run `/stardust` to see your next step. Briefings (`/stardust:briefings`) can be written in parallel; once brand and briefings are ready, choose `/stardust:wireframes` for a grey structural pass, or jump straight to `/stardust:prototype`."

## Artifacts Written

| File | Description |
|------|-------------|
| `stardust/brand-profile.json` | Structured brand tokens (source of truth) |
| `stardust/brand-board.html` | Visual brand board (rendered view) |
| `.impeccable.md` | Design personality for quality gates |
| `stardust/assets/logo.<ext>` | Primary logo mark — SVG preferred, PNG fallback. Additional variants also under `stardust/assets/`. |
