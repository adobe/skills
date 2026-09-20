---
_provenance:
  writtenBy: stardust:rollout
  writtenAt: 2026-09-14T09:02:00Z
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
| publish | when do pages go live | preview; live on gate PASS | D1/D16 | owner-decided | owner | plan reply 2026-09-14 09:02 ("publish on pass") |
| lockdown | is the target locked before the hand-off | on — private repo + `access/site.json` allow list `*@operator.example` with a site token, after the last anonymous gate, before the hand-off | a served site is public until locked; operator domain from `git config user.email` | default-applied | default | plan reply 2026-09-14 09:02 (row printed, no answer) |
