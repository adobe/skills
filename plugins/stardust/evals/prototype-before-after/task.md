# Eval: prototype writes the proposed file and opens it in the browser

## Setup

A project where extract + direct have completed:

- `stardust/state.json` lists 5 pages, all `directed`.
- `stardust/current/` populated (PRODUCT.md, DESIGN.md, pages/,
  assets/, _brand-extraction.json).
- Project-root `PRODUCT.md`, `DESIGN.md`, `DESIGN.json` exist (the
  target spec from direct).
- `stardust/direction.md` has an active direction.
- No `stardust/prototypes/` yet.
- Impeccable installed (with `$impeccable craft` and `$impeccable
  live` available).

## User prompt

"$stardust prototype home"

## Expected behavior

The `stardust:prototype` skill is invoked. It:

1. Runs the master setup (impeccable dep, context loader, state read).
2. Verifies the page is `directed` (and not `pending` direction).
3. Reads `stardust/current/pages/home.json`, `stardust/direction.md`
   Active section, project-root `DESIGN.md` and `DESIGN.json`.
4. **Renders `stardust/prototypes/home-proposed.html`** by
   delegating the creative lift to `$impeccable craft` with the
   page content + the resolved direction as constraints. The output:
   - Has the **`:root` token block** as the first content of the
     first `<style>` per `token-contract.md` (must include
     `--heading-*`, `--body*`, `--line-height-*`, `--color-*`,
     `--spacing-*`, `--section-padding`, `--max-width`, `--radius`).
   - Has **structural data attributes** (`data-section`, `data-intent`,
     `data-layout`) on every `<section>` per `data-attributes.md`.
   - Has a stardust:provenance block as the first child of `<head>`
     listing the page, source, active direction, divergenceVersion,
     fontDeck, paletteSource.
   - Is **self-contained** (no external CSS, no external JS).
   - Preserves content from `pages/home.json` (headlines, body copy,
     CTA labels, nav labels, link destinations).
   - Passes the divergence audit (every anti-toolbox hit recorded
     in `DESIGN.json.extensions.divergence.anti_toolbox_hits` with a
     brand-specific justification).
5. **Opens `stardust/prototypes/home-proposed.html`** in the
   default browser (`open` macOS, `xdg-open` Linux, `start ""`
   Windows). No separate viewer file is composed.
6. Marks the page `prototyped` in `state.json` (NOT `approved` —
   approval is a separate explicit step, signalled in chat by
   "approve home" or "approve").
7. Reports the proposed-file path and the next-step hint.
   Iteration happens through chat-driven impeccable commands
   ("make the hero bolder") that run against the proposed file
   on disk; the agent does not auto-launch any iteration loop.
