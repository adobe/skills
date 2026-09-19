# Eval: replica — same-design migration with a measured source-fidelity gate

## Setup

A clean project (no `stardust/` directory; `fixture/` is empty). Impeccable
installed (master setup dependency check still applies). Node + Playwright
available.

This is a live-network eval. The entry URL is one small, stable page on the
suite's live crawl target: https://stripe.com/gb/about (locale-explicit so
the server does not geo-redirect; verified 200 with real server-rendered
HTML and no bot challenge). It is the archetype the gate measures;
`extract --prep` discovers the rest of the origin under its default cap.
Structure drift is expected maintenance, as with `extract-multipage`. The
persona in `answers.md` confirms plans and asks for a pure replica.

## User prompt

"$stardust replica https://stripe.com/gb/about — migrate this site to EDS
keeping its current design"

## Expected behavior

The stardust `replica` skill is invoked. It:

1. Runs `$stardust extract --prep` unchanged (full inventory, page types,
   screenshots, fonts, media, descriptive `stardust/current/` spec). No
   extract behavior is modified or bypassed.
2. **Preserve direction is mechanical**: `stardust/current/{PRODUCT,DESIGN}.{md,json}`
   are promoted verbatim to the project root as the target spec;
   `stardust/direction.md` records preserve mode. the stardust `direct` skill is NOT
   invoked; no divergence roll, no palette/type re-selection, no invented
   improvements.
3. Creates the **inconsistency register** at
   `stardust/replica/inconsistency-register.md`. Without audit findings or
   user-supplied items it is present and empty (pure replica); every entry, if
   any, carries captured evidence + the minimal change + status.
4. **Recreates one archetype per page type** as clean re-authored HTML/CSS:
   semantic markup, tokenized CSS with values lifted from the source site's
   own stylesheets; content verbatim from `stardust/current/pages/*.json`;
   fonts same-source or metric-matched substitute (never a rehosted
   commercial kit). No DOM copying (no source class-soup, no framework
   artifacts, no scraped inline styles).
5. Runs the **source-fidelity gate** per breakpoint (1440 and 360): diff's
   `content-diff.mjs` + `visual-diff.mjs` with `--profile generic` (live URL
   as source, served prototype as build) plus replica's
   `stitch-shot.mjs` + `pixel-compare.mjs`. Gate evidence (metrics per
   iteration, band breakdown, height delta) is recorded under
   `stardust/replica/`. Hard cap of 3 iterations per breakpoint; unresolved
   deltas land in the residual log, not in silence.
6. Hands off through the standard pipeline: archetypes at
   `stardust/prototypes/<slug>-proposed.html` so the stardust `migrate` skill Path A /
   sibling tier consume them unchanged; core `state.json` lifecycle is used,
   not redefined.

## Failure modes this eval pins against

- Invoking `direct` (or any redesign machinery) instead of mechanical
  promotion.
- "Improving" the design outside the inconsistency register.
- DOM-copying the source page instead of re-authoring.
- Declaring fidelity without gate evidence on disk (metrics, diff artifacts).
- Only gating desktop (mobile is not free — the 360 pass is required).
- Rehosting a licensed brand font.
