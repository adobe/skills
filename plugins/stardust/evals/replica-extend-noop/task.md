# Replica: a session resumed on a delivered site

## Setup

A stardust `replica` run (same-design migration) of a small store site that
delivered one page, its home page, and ended. The site is served on this
machine: `http://localhost:8780/`. `setup.sh` puts the project in the work
directory as one git commit.

- `stardust/state.json`: `flow: replica`, hands-off, one page `index` in
  status `migrated`.
- `stardust/status.jsonl`: the run's ledger; its last replica line is
  `handoff end`.
- `stardust/current/`, the promoted spec, the progress files of replica,
  migrate and rollout (every unit `done`), the foundation manifest.
- `stardust/scripts/<skill>/`: the plugin's scripts, copied as the replica
  skill's Setup has it.

## User prompt

"Continue the stardust replica run in this project."
