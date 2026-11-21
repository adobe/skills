---
_provenance:
  writtenBy: stardust:replica
  writtenAt: 2026-11-21T07:08:24Z
  againstInput: https://markszulc.github.io/frescopa-atelier/index.html
  mode: bounded-single
  readArtifacts:
    - stardust/current/pages/frescopa-atelier-index-html.json
    - stardust/replica/lifted-tokens.json
---

# Direction — preserve mode (same-design migration)

Mode: PRESERVE. The target spec is the captured current state of https://markszulc.github.io/frescopa-atelier/index.html
(no direct invocation, no creative decisions).

Synthesized (bounded-single): current/pages/frescopa-atelier-index-html.json + Phase-3 CSS lift → PRODUCT.md · DESIGN.md · DESIGN.json (at 2026-11-21T07:08:24Z).

Permitted deltas: ONLY the entries of stardust/replica/inconsistency-register.md (empty — pure replica).

Fidelity: ia verbatim · design verbatim · content verbatim.

## Decision — link targets outside the one-page scope (rollout E2-link-audit, 2026-11-21)

The operator scoped this run to ONE page (`/frescopa-atelier/index.html` → `/`). The 5 header nav targets — `/frescopa-atelier/{landing,machines,beverages,cafe,blog}.html` — were never captured and are outside the declared caps: SCOPE EXTENSION → kept as absolute links to the source site (all 200 at audit time), not delivered, not 404. `localize-links --check` PASS (0 localizable). Re-run localize-links after any wave that ships them.
