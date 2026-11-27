---
_provenance:
  writtenBy: stardust:replica
  writtenAt: 2026-11-20T07:50:00Z
  againstInput: http://localhost:8780/visit/
  readArtifacts:
    - stardust/current/pages/visit.json
---

# Direction — preserve mode (same-design migration)

Mode: PRESERVE. The target spec is the captured current state of
http://localhost:8780/visit/ (no direct invocation, no creative decisions).

Synthesized (bounded-single): current/pages/visit.json + Phase-3 CSS lift
→ PRODUCT.md · DESIGN.md · DESIGN.json (pending: written with the Phase-3 lift).

Permitted deltas: ONLY the entries of stardust/replica/inconsistency-register.md
(empty — pure replica).

Fidelity: ia verbatim · design verbatim · content verbatim.
