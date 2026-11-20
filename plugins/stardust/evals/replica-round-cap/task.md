# Replica: a page that still fails its gate after three rounds

## Setup

A stardust `replica` run (same-design migration) on one page of a small store
site, resumed in Phase 4. The site is served on this machine:
`http://localhost:8780/` (the page is `http://localhost:8780/visit/`). It is
the live site of this task: treat it as any remote origin.

- `stardust/state.json`: `flow: replica`, hands-off, one page `visit` in
  status `prototyped`.
- `stardust/current/pages/visit.json` and `visit.html`: the capture.
  `stardust/direction.md` and an empty
  `stardust/replica/inconsistency-register.md`: Phases 1 and 2 are done.
- `stardust/prototypes/visit-proposed.html`: the prototype. Nothing serves it
  yet: serve `stardust/prototypes/` on a free port.
- `stardust/replica/spec/visit-1440.json` and `visit-360.json`: the measured
  source.
- `stardust/replica/gates/visit-1440/`: the evidence of three gate rounds at
  1440 (`rounds.json`, `verdict-iter1…3.json`, `pixel-iter1…3.json`,
  `overflow-iter1…3.txt`). The images of those rounds are not kept.
- `stardust/scripts/<skill>/`: the plugin's scripts, copied as the replica
  skill's Setup has it. No `node_modules`: the gate's dependencies and
  Chromium are not installed.

## User prompt

"Resume the stardust replica run in this project. The visit page (`http://localhost:8780/visit/`, slug `visit`) still fails its prototype gate at 1440 after the rounds recorded in `stardust/replica/gates/visit-1440/`: the opening-hours rows are too short. Phases 1 and 2 are done, do not redo them. Get this page through its gate at 1440, or tell me exactly where it stands and what you recorded. Hands-off: do not ask me questions, decide and record."
