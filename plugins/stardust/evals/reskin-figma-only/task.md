# Eval: reskin — Figma-only site, content from the page frames

## Setup

A clean project with no `stardust/state.json`. A Figma file (the eval runner pins it) whose page holds
two page frames (a sign-in page and a multi-field form page) built from the file's own component kit,
plus header and footer instances. `FIGMA_TOKEN` set with `file_content:read`. Node + Playwright
available. There is no live site.

## User prompt

"$stardust reskin — build our site from these Figma pages: <figma-url>. There's no existing site."

## Expected behavior

The stardust `reskin` skill is invoked on the Figma-only path. It:

1. Runs `figma-donor.mjs init <url>` (state `flowSource: "figma-only"`, no origin), then captures and
   curates the same file as the donor (tokens, modules).
2. Runs `figma-donor.mjs content <url> --frame <id> --slug <slug>` per page frame; NODE links between
   the frames resolve via `--pages`. Each model has `source.kind: "figma"`, with `text-ops.json`,
   `flags.json` and `assets/` beside it and `reskin/deltas/<slug>.json` seeded, and the shared `_chrome` model is written once.
3. Maps and renders as for any reskin page; runs `figma-text-gate.mjs` in place of `dom-equality` and
   `slot-coverage --deltas`, then donor-probe and `figma-gate all`.
4. Lists `figma-donor.mjs blocklist`; does not invent alt text, link targets or SEO metadata — each open
   item is fixed in Figma or acknowledged with `ack --why`.
5. Hands off to an isolated preview deploy; does not run `migrate` (no origin).
