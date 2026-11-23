# Eval: replica — same-design migration with a measured source-fidelity gate

## Setup

A clean project (no `stardust/` directory). The target is the fixture site of
this suite, served on this machine: `http://localhost:8780/` (a store home
page and a visit page; `setup.sh` starts it from `../fixture-site/`, no
external network is needed for the target). It is the live site of this task.
Impeccable installed (master setup dependency check still applies). Node +
Playwright available.

## User prompt

"$stardust replica http://localhost:8780/ — migrate this site to EDS keeping
its current design"

## Expected behavior

The stardust `replica` skill is invoked. It:

1. Runs `$stardust extract --prep` unchanged (full inventory, page types,
   screenshots, fonts, media, descriptive `stardust/current/` spec, and the
   header contract `stardust/chrome/header-contract.json`). No extract
   behavior is modified or bypassed.
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
   the source is measured first (`source-spec.mjs capture` at every gate
   width, before any CSS), then semantic markup and tokenized CSS from the
   measured values, with the source site's own stylesheets for what the
   spec cannot name; `source-spec.mjs compare` exits 0 against the served
   prototype before the first gate round. Content verbatim from
   `stardust/current/pages/*.json`. Fonts: the source's captured faces
   self-hosted as-is, proprietary ones included, with the licensing alert
   and one register entry; a substitute only for a face with no captured
   file, declared in `stardust/replica/font-subst.txt`. No DOM copying (no
   source class-soup, no framework artifacts, no scraped inline styles).
5. Runs the **source-fidelity gate** per breakpoint (1440 and 360): diff's
   `content-diff.mjs` + `visual-diff.mjs` with `--profile generic` (live URL
   as source, served prototype as build) plus replica's
   `stitch-shot.mjs` + `pixel-compare.mjs`. Gate evidence (metrics per
   iteration, band breakdown, height delta) is recorded under
   `stardust/replica/`. Hard cap of 3 rounds per page, breakpoint and stage
   (`rounds.mjs` counts them, `gate.sh` exits 6 at the cap until a decision
   is recorded); unresolved deltas land in the residual log, not in silence. After the 1440 pass the
   **content-cap row** runs once per archetype: replica's `cap-probe.mjs`
   live `--against` the served prototype at the derived `probeWidth` that
   extract wrote to DESIGN.json (never a pinned width), PASS required.
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
- A crafted prototype with no row in `stardust/replica/gates/prototypes-<width>/summary.json`
  (the pixel table is the source of record; a sidecar claim alone is not evidence).
- Only gating desktop (mobile is not free — the 360 pass is required).
- Skipping the content-cap row — a container cap wider than 1440 is invisible to both pixel gates.
- Authoring from the stylesheets alone: no source spec captured before the CSS, or a first gate
  round with no `source-spec.mjs compare` exit 0 before it.
- Substituting a face whose file was captured, or self-hosting a proprietary face with no
  licensing alert and register entry.
- Treating the header as a picture: no header contract, so its menus, drawer and search go unchecked.
