---
name: brand
description: "Create, extract, refine, review, critique, or iterate on the brand identity at `aem-design/brand-profile.json` and `aem-design/brand-board.html` (and `.impeccable.md`) — philosophy, logo, colors, typography, componentStyle, motifs, photography direction, voice, tone, content pillars, personas, spacing. Ingests guidelines (PDF, URL, or conversation) or iterates on an existing profile. Use when the user provides brand guidelines, when the user asks to change, refine, refactor, review, improve, polish, critique, or iterate on any aspect of brand identity, or whenever the user asks to modify a file at `aem-design/brand-profile.json`, `aem-design/brand-board.html`, or `.impeccable.md`."
license: Apache-2.0
metadata:
  version: "0.1.0"
---

# Brand Extraction

Extract brand identity from guidelines and produce a visual brand board for designer approval.

## When to use this skill

- The user provides brand guidelines (URL, PDF, or conversational description) and asks to extract, create, or capture brand identity.
- The user asks to change, refine, review, critique, or iterate on `aem-design/brand-profile.json`, `aem-design/brand-board.html`, or `.impeccable.md`.
- The user types `/aem-design:brand`.

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
- `aem-design/brand-profile.json`
- `aem-design/brand-board.html`
- `aem-design/assets/logo.<ext>` (extracted or synthesized)
- `.impeccable.md` (created or updated)

**If missing:**
- No URL/PDF/anchor-set/description → deliver the "no reference" warning in the Inputs section below before synthesizing. If the designer proceeds without any reference, roll a deterministic random seed from [`../_shared/divergence-toolkit.md`](../_shared/divergence-toolkit.md) §2, stamp `_divergence.divergence_warning = true` on the profile, and use the seed as a hard constraint on visual decisions. Stamp provenance per [`../_shared/skill-contract.md`](../_shared/skill-contract.md).
- No `.impeccable.md` → prefer the designer-authored path (see Phase 2). Only fall back to synthesis after the "last chance" prompt has been declined, and stamp `authored_by: synthesized` in frontmatter.

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

1. **Inline `<svg>` inside the page header or `<nav>`** — look for `header svg`, `nav svg`, `[class*="logo" i] svg`. Serialize the outer HTML and save as `aem-design/assets/logo.svg`.
2. **`<img>` with a logo-shaped src or class** — `header img`, `nav img`, `img[src*="logo" i]`, `img[class*="logo" i]`, `img[alt*="logo" i]`. Download the resolved URL. Prefer SVG; fall back to the highest-resolution PNG or WebP.
3. **`<link rel="icon">`, `<link rel="apple-touch-icon">`, `og:image`** — in that order. These are branded marks even if not full wordmarks.
4. **Favicon** — `/favicon.ico` or `/favicon.svg` at the site root. Last resort.
5. **No logo found** — create a minimal placeholder SVG with the brand name as text, save to `aem-design/assets/logo.svg`, and add `"logo: synthesized placeholder — no mark found on source"` to `_provenance.synthesized_inputs`.

Save all downloads to `aem-design/assets/` (not `icons/` — the design phase is EDS-agnostic; `icons/` is an EDS convention that leaks structure into aem-design).

Record the outcome in the brand profile's `logo` object:

```json
"logo": {
  "path": "aem-design/assets/logo.svg",
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
- **Logo variants** — primary mark always saved to `aem-design/assets/logo.<ext>` (see Step 2.5). Additional variants (white-on-dark, mono, stacked) also go under `aem-design/assets/` with descriptive names like `logo-white.svg`.
- **Color roles** — don't just capture hex, capture what each color is FOR (CTAs, headings, backgrounds, on-blue text).
- **Motifs** — the non-obvious visual gestures. Without these the board reads as a generic palette.

### If no guidelines (conversational):

1. Run the soft-deps discovery decision before asking anything inline:

   **If `/brainstorm` is registered in this session** (detect per [`../_shared/soft-deps.md`](../_shared/soft-deps.md)): hand off to `/brainstorm` with a seeded prompt naming the brand (if known) and the discovery topics below. Wait for its output; use the result to populate `brand-profile.json`. Do NOT run an inline interview once this delegation is made.

   **Otherwise (superpowers not installed):** announce the fallback **exactly once per session**, using the verbatim text from [`../_shared/soft-deps.md`](../_shared/soft-deps.md) ("superpowers announcement"). Then run the inline interview.

   Either path covers the same topics: brand name, mission, target audience, personality (3-5 adjectives), colors they like/dislike, typography preference (serif/sans/mixed), photography style, competitive positioning.

   The user must be able to tell which path ran — either by `/brainstorm`'s visible hand-off UI or by the one-time announcement. Silent inline interviews are a bug.
2. From the conversation, construct `aem-design/brand-profile.json` with whatever was discussed.
3. Mark optional fields as null — the designer can fill them in later.

## Phase 2: Design Personality

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

## Phase 3: Render Brand Board

1. Read `aem-design/brand-profile.json`
2. Generate `aem-design/brand-board.html` following the template structure in [brand-board-template.md](reference/brand-board-template.md)
3. The board must:
   - Use the brand's own extracted colors and fonts
   - Include sticky navigation for section jumping
   - Render only sections that have data (omit sections for null fields)
   - Be self-contained HTML with embedded CSS (no external dependencies)
4. Tell the designer: "Your brand board is ready. Open `aem-design/brand-board.html` in a browser (`open aem-design/brand-board.html` on macOS, `xdg-open …` on Linux)."
   - In SLICC: the board renders in the browser panel automatically
   - In Claude Code: the designer opens the file directly; no dev server required

## Phase 4: Approval Gate

This is a **hard gate** in interactive mode. Do not proceed until the designer approves.

**Pipeline automation:** When invoked as part of a full pipeline run (e.g., the user asked to run all aem-design stages end-to-end with auto-approve), skip the interactive approval loop. Auto-approve and continue to the next stage. The user can always come back to refine later.

Present the brand board and ask: "Does this accurately represent your brand? What needs to change?"

Common feedback and how to handle it:
- **"That color is wrong"** → Update the hex in brand-profile.json, re-render the board
- **"The voice feels too [formal/casual/etc]"** → Update voice traits and examples, re-run `/teach` to update .impeccable.md
- **"Missing our secondary font"** → Add to typography section, re-render
- **"Photography direction is off"** → Update photography rules, re-render

Iterate until the designer says the board looks right. Then:
1. Confirm the brand profile is saved
2. Confirm .impeccable.md exists
3. Tell the designer: "Brand extraction complete. Run `/aem-design` to see your next step. Briefings (`/aem-design:briefings`) can be written in parallel; once brand and briefings are ready, choose `/aem-design:wireframes` for a grey structural pass, or jump straight to `/aem-design:prototype`."

## Artifacts Written

| File | Description |
|------|-------------|
| `aem-design/brand-profile.json` | Structured brand tokens (source of truth) |
| `aem-design/brand-board.html` | Visual brand board (rendered view) |
| `.impeccable.md` | Design personality for quality gates |
| `aem-design/assets/logo.<ext>` | Primary logo mark — SVG preferred, PNG fallback. Additional variants also under `aem-design/assets/`. |
