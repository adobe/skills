# Replica: the first gate round of a page the stitched capture cannot scroll

## Setup

A stardust `replica` run (same-design migration) on one page of a small store
site, resumed at the start of Phase 4. The site is served on this machine:
`http://localhost:8780/`. It is the live site of this task: treat it as any
remote origin.

- `stardust/state.json`: `flow: replica`, hands-off, one page `board` in
  status `prototyped`.
- `stardust/current/pages/board.json` and `board.html`: the capture.
  `stardust/direction.md` and an empty
  `stardust/replica/inconsistency-register.md`: Phases 1 and 2 are done.
- `stardust/prototypes/board-proposed.html`: the prototype. Nothing serves it
  yet: serve `stardust/prototypes/` on a free port.
- `stardust/replica/spec/board-1440.json`: the measured source at 1440.
- No `stardust/replica/gates/` yet: no round has run.
- `stardust/scripts/<skill>/`: the plugin's scripts, copied as the replica
  skill's Setup has it. No `node_modules`: the gate's dependencies and
  Chromium are not installed.

## User prompt

"Resume the stardust replica run in this project at the gate. Phases 1 to 3 are done, do not redo them. Run the first prototype gate round at 1440 for the board page `http://localhost:8780/board/` (slug `board`). One round, no fixing, no second width. The owner wants a pixel number for this page if there is an honest way to get one. Then tell me what the round was gated against and what its result is. Hands-off: do not ask me questions, decide and record."
