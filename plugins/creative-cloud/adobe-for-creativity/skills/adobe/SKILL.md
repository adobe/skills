---
name: adobe
description: "Show an onboarding tour of the Adobe for creativity connector: what capabilities are available, an example workflow for each, and which Adobe product powers it. Trigger when the user invokes /adobe by name, or asks what they can do with Adobe, what Adobe skills or tools exist, or wants a tour or overview of Adobe capabilities. Do NOT trigger this for a request to actually create/edit/design something (e.g. 'make me a flyer') — that goes straight to the matching Adobe skill or tool instead."
license: Apache-2.0
metadata:
  version: 1.0.0
  visibility: public
  surface: [claude]
---

## Purpose

A one-glance orientation to the Adobe for creativity connector: how the flow works, what's available, and a concrete example prompt for each capability so the user can just try one. This skill is informational only — it never edits, generates, or exports anything itself.

## Render, in order

### 1. How it works — step card

Call `step_card_display_v0` with `view: "list"` (list lets the user scan all three at once) and this content, adjusted only if the account is already connected (drop step 1 in that case) or permissions are already set to Always allow (drop step 2):

1. **Sign in to your Adobe account** — The plugin's installed, but it still needs your Adobe login to read and edit your files. Go to **Customize > Connectors**, find **Adobe for creativity**, and select Connect to sign in.
2. **Allow Adobe tools** — Under **Customize > Connectors**, open **Adobe for creativity** and set each tool to **Always allow**. On Team or Enterprise plans, you can update them all at once from the connector-level dropdown. This prevents approval prompts from interrupting your work.
3. **Add your files through the Adobe file picker** — When you ask for something like "make me a flyer," a file picker will pop up — use it to upload your images or documents instead of dragging them into the chat. This makes sure Adobe can actually read and edit them.
4. **Choose what to create** — Browse the tiles below and pick what inspires you. Try the example prompt as-is or make it your own.

> **Text-only fallback** *(only if `step_card_display_v0` is unavailable)* — render the same
> content as a plain numbered markdown list: bold the step title, then its description on the same
> line or immediately after. Apply the same drop-step-1/drop-step-2 logic based on connection and
> permission state.

### 2. What's available — capability grid

Call `visualize:read_me` with `modules: ["mockup"]`, then `visualize:show_widget` with a responsive card grid (`repeat(auto-fit, minmax(280px, 1fr))`), one card per capability below. Follow the design-system rules from `read_me` (flat surfaces, CSS variables, sentence case, no gradients), with this Adobe-branded, premium treatment:

- **Icon stays neutral** (`var(--text-secondary)`), not red. Repeating the brand red on every element reads busy, not premium.
- **Adobe's red (`#FA0F00`) appears exactly once per card**, as a short 2px accent rule (~28px wide) directly under the capability name — a quiet signature, not a highlight color.
- Capability name: 15px/500, `var(--text-primary)`.
- Description: 13px, `var(--text-secondary)`.
- Example prompt: rendered as a quote in `font-family: var(--font-voice)` italic, `var(--text-secondary)` — this is the "editorial moment" the design system reserves the serif for, and it reads calmer than bold sans quotes.
- Skill name: relabeled as an optional shortcut, not a mystery tag — prefix with "Or type:" in `var(--text-muted)`, no background pill. Only the slug itself is colored: `<span style="color: #FA0F00; font-family: var(--font-mono); font-size: 11px;">/adobe-design-from-template</span>` — Adobe's exact accent red, matching the rule under the title, applied only to the command text so it stands out without adding a chip. In dark mode the same hex still reads fine against dark surfaces; no swap needed. This is the one exception to "skill name stays neutral" above — the slug earns color because it's now a clickable/typeable affordance, not a label.
- Powered-by line: smallest text, `var(--text-muted)`.
- Generous padding (`1.25rem 1.5rem`+) and avoid stacking too many small text lines tightly — whitespace is what makes it feel premium, not more color.

Keep this table as the source of truth — update it if the underlying `adobe-for-creativity` skills change:

| Capability                      | Icon               | Description                                         | Example prompt                                       | Skill                             | Powered by                   |
| ------------------------------- | ------------------ | --------------------------------------------------- | ---------------------------------------------------- | --------------------------------- | ---------------------------- |
| Design from a template          | `ti-layout-grid`   | Flyers, posters, social posts, invites, resumes.    | "make me a flyer for a farmers market"               | `/adobe-design-from-template`     | Adobe Express                |
| Batch edit photos               | `ti-wand`          | A consistent look across a whole set of images.     | "give these travel photos a warm, cohesive look"     | `/adobe-batch-edit-photos`        | Photoshop, Lightroom presets |
| Retouch portraits               | `ti-users`         | Walk-away batch processing for shoots and events.   | "batch process this folder of wedding portraits"     | `/adobe-retouch-portraits`        | Lightroom, Photoshop         |
| Resize photos and videos        | `ti-crop`          | Exact pixel dimensions or aspect ratios, on demand. | "resize this video to 1080x1920 for reels"           | `/adobe-resize-photos-and-videos` | Photoshop, Premiere          |
| Prep for social platforms       | `ti-device-mobile` | Platform-ready crops and exports in one pass.       | "get this ready for Instagram, TikTok, and LinkedIn" | `/adobe-create-social-variations` | Adobe Express, Photoshop     |
| Highlight reels                 | `ti-movie`         | Cut long footage into a punchy sizzle reel.         | "turn this hour of footage into a 60-second reel"    | `/adobe-edit-quick-cut`           | Premiere (Quick Cut)         |
| Personalize a document at scale | `ti-file-text`     | Merge a CSV into badges, certificates, mailers.     | "merge this CSV into event badges"                   | `/adobe-create-pdfs-from-data`    | InDesign                     |

> **Text-only fallback** *(only if `visualize:read_me`/`visualize:show_widget` are unavailable)* —
> skip both `visualize` calls and render the same table as a plain markdown list, one entry per
> capability, in this order: bold capability name; the description on the next line; the example
> prompt as an italic quote; then the skill slug as inline code with "— powered by `<Powered by>`"
> after it, e.g. `` `/adobe-design-from-template` — powered by Adobe Express``. Drop the icon and
> the red accent rule — there's no styling to carry over in plain text.

### 3. Close with a nudge, in prose (not a tool)

One short sentence inviting the user to just try one of the example prompts verbatim. Don't restate the grid content — the cards already show it.

## Tool Reference

| Step                               | Tool                    | Notes                                                        |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------ |
| How it works — step card           | `step_card_display_v0`  | `view: "list"`; drop step 1 or 2 per connection/permission state; falls back to a plain numbered list if unavailable |
| What's available — capability grid | `visualize:read_me`     | `modules: ["mockup"]`, called before `show_widget`; skip both `visualize` calls if unavailable |
| What's available — capability grid | `visualize:show_widget` | Renders the responsive capability card grid; falls back to a plain markdown list if unavailable |

## Ground rules

- This skill only renders the tour. Never call `adobe_mandatory_init` or any other Adobe tool while onboarding — those fire only once the user actually asks for a workflow.
- If the user's next message is a real request (not a question about the tour), hand off to the matching `adobe-for-creativity` skill/tool rather than re-showing the grid.
- Try each widget tool first. Only drop to its text-only fallback when the tool call is genuinely unavailable in the current environment (e.g. absent from the tool list) — not merely because a call failed once.
- Keep card copy to one line each; put any nuance in your own prose outside the tool calls, not inside the widget.
- If a capability in the table above no longer matches what's installed, drop or update that row rather than describing a tool that isn't actually available.
