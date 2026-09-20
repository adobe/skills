---
_provenance:
  writtenBy: stardust:replica
  writtenAt: 2026-09-14T08:40:00Z
  againstInput: https://www.larkspurmutual.example
  readArtifacts:
    - stardust/direction.md
    - stardust/state.json
---

# Decisions — Larkspur Mutual

| id | question | default | rationale | status | decided-by | evidence |
|---|---|---|---|---|---|---|
| target | deploy target | `larkspur/sdt-larkspur-mutual`, private, DA folder of the same name | the run's `gh` identity's org; one convention across projects | default-applied | default | `stardust/direction.md` 2026-09-14 |
| branch | which branch serves | `main` | boilerplate default; Code Sync builds it | default-applied | default | — |
| publish | when do pages go live | preview; live on gate PASS | D1/D16 | default-applied | default | — |
