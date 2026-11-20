# Replica: recreate one page and take it to its first gate round

## Setup

A stardust `replica` pilot (same-design migration) on one page of a small
store site, resumed at Phase 3. The site is served on this machine:
`http://localhost:8780/`. It is the live site of this task: treat it as any
remote origin.

- `stardust/state.json`: `flow: replica`, hands-off, one page `visit` in
  status `extracted` (a bounded, single-page entry).
- `stardust/current/pages/visit.json`, `visit.html` and
  `stardust/current/assets/screenshots/visit.png`: the capture.
  `stardust/direction.md` and an empty
  `stardust/replica/inconsistency-register.md`: Phases 1 and 2 are done.
- No prototype, no `stardust/replica/spec/`, no `stardust/replica/gates/`.
- `stardust/scripts/<skill>/`: the plugin's scripts, copied as the replica
  skill's Setup has it. No `node_modules`: the gate's dependencies and
  Chromium are not installed.

## User prompt

"Resume the stardust replica pilot in this project at Phase 3. Phases 1 and 2 are done, do not redo them. Recreate the visit page (`http://localhost:8780/visit/`, slug `visit`) as `stardust/prototypes/visit-proposed.html`, serve it on a free port, and take it to its first prototype gate round at 1440 and at 360. Stop after the first round at each width: no fix rounds, no interaction parity, no handoff. Then tell me the numbers of the two rounds and what you did before them. Hands-off: do not ask me questions, decide and record."
