---
_provenance:
  writtenBy: stardust:replica
  writtenAt: 2026-11-21T18:33:17Z
  againstInput: https://markszulc.github.io/frescopa-atelier/
  readArtifacts:
    - stardust/current/PRODUCT.md
    - stardust/current/DESIGN.md
    - stardust/current/DESIGN.json
---

# Direction — preserve mode (same-design migration)

Mode: PRESERVE. The target spec is the captured current state of https://markszulc.github.io/frescopa-atelier/, promoted verbatim (no direct invocation, no creative decisions).

Promoted: current/PRODUCT.md → PRODUCT.md · current/DESIGN.md → DESIGN.md · current/DESIGN.json → DESIGN.json (at 2026-11-21T18:33:17Z).

Permitted deltas: ONLY the entries of stardust/replica/inconsistency-register.md (empty — pure replica).

Fidelity: ia verbatim · design verbatim · content verbatim.

Hands-off: activated 2026-11-21T18:33:17Z (--hands-off). Roster: 6 of 8 planned URLs (the other 2 are source 404 template literals); no caps applied. One canonical direction: the captured state.

## Decision — E2 link targets outside the page scope (2026-11-21)
- Scope extension, repointed to the source site (not delivered): `atelier.html` (7 links, from landing + machines), `coffee.html` (2, beverages + café), `article.html` (1, blog). The run's page scope is fixed by stardust/.labs/site-plan.json (8 selected, 6 real pages); these targets are not in it. Each GETs 200 on markszulc.github.io, so no link 404s. Deliver them in a later wave to bring them in-house; localize-links then rewrites them.

## Decision — the 2 discovered URLs not delivered (2026-11-21)
- `/{{ featured.href }}` and `/{{ post.href }}` (selected in the site plan) are unrendered template literals from the source's client templates; both answer 404 on the source, so there is nothing to deliver. Recorded in state.json `site.sourceNotFound` at extract (journal § extract). The delivered roster is the 6 real pages.

## Decision — home delivered as the folder index /frescopa-atelier/ (2026-11-21)
- The source home is `/frescopa-atelier/` (a folder index). It was first delivered as the leaf `/frescopa-atelier`; at H-report it was re-homed to the DA document `frescopa-atelier/index` (served `/frescopa-atelier/`, the source's own address and the delivery tooling's folder-index convention). The leaf was unpublished and deleted; the redirects sheet sends `/`, `/index.html`, `/frescopa-atelier` and `/frescopa-atelier/index.html` there. Nav and machines links point to `/frescopa-atelier/`. Re-gated on aem.live: 1440 6/6, 360 6/6.
