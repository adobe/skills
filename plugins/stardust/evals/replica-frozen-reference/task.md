# Replica: the first gate round of a page and of its variant

## Setup

A stardust `replica` run (same-design migration) on one page of a small store
site, resumed at the start of Phase 4. The site is served on this machine:
`http://localhost:8780/`. It is the live site of this task: treat it as any
remote origin.

- `stardust/state.json`: `flow: replica`, hands-off, one page `visit` in
  status `prototyped`.
- `stardust/current/pages/visit.json` and `visit.html`: the capture.
  `stardust/direction.md` and an empty
  `stardust/replica/inconsistency-register.md`: Phases 1 and 2 are done.
- `stardust/prototypes/visit-proposed.html`: the prototype. Nothing serves it
  yet: serve `stardust/prototypes/` on a free port.
- `stardust/replica/spec/visit-1440.json`: the measured source at 1440.
- No `stardust/replica/gates/` yet: no round has run.
- `stardust/scripts/<skill>/`: the plugin's scripts, copied as the replica
  skill's Setup has it. No `node_modules`: the gate's dependencies and
  Chromium are not installed.

## User prompt

"Resume the stardust replica run in this project at the gate. Phases 1 to 3 are done, do not redo them. Run the first prototype gate round at 1440 only, for two pages against the same prototype: the visit page `http://localhost:8780/visit/` (slug `visit`), and its stock-count variant `http://localhost:8780/visit/?unstable=1` (slug `visit-notice`; pass `--marker "Visit the store"` to its round, because that slug is not a string of the prototype), which the owner wants gated too. One round each, no fixing, no second round. Then tell me, for each of the two, what the round was gated against and what its result is. Hands-off: do not ask me questions, decide and record."
