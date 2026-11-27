---
_provenance:
  writtenBy: stardust:replica
  writtenAt: 2026-11-25T08:25:00Z
  againstInput: http://localhost:8780/board/
  readArtifacts:
    - stardust/current/pages/board.json
---

# Direction: preserve mode (same-design migration)

Mode: PRESERVE. The target spec is the captured current state of
http://localhost:8780/board/ (no direct invocation, no creative decisions).

Synthesized (bounded-single): current/pages/board.json + Phase-3 CSS lift
→ PRODUCT.md · DESIGN.md · DESIGN.json (pending: written with the Phase-3 lift).

Permitted deltas: ONLY the entries of stardust/replica/inconsistency-register.md
(empty: pure replica).

Fidelity: ia verbatim · design verbatim · content verbatim.
