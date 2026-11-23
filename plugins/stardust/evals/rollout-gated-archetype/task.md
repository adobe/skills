# Rollout: preparing the delivery of a small migrated site

## Setup

A stardust `replica` run (same-design migration) on a small store site of six
pages, at the point where the migrated tree is ready and the rollout to AEM
Edge Delivery Services starts. Nothing of the rollout has run yet.

- `stardust/state.json`: `flow: replica`, hands-off, six pages in status
  `migrated`, of three page types (`home`, `product`, `info`).
- `stardust/migrated/`: the six migrated pages, each with its `_meta.json`
  sidecar, and `assets/`.
- `stardust/replica/progress.json`: the gate results of the three archetypes
  (`home`, `products-mug`, `visit`) at 1440 and 360.
- `stardust/direction.md`, `stardust/dynamic-features.md` and an empty
  `stardust/replica/inconsistency-register.md`: the earlier phases are done.
- `stardust/scripts/<skill>/`: the plugin's scripts, copied as the master
  skill's Setup has it. No `node_modules`: Playwright and Chromium are not
  installed.
- No AEM project, no `DA_TOKEN` and no code repository on this machine. The
  source site (`https://shop.example.com/`) is not reachable from it.

## User prompt

"Roll out this migrated site to AEM Edge Delivery with the stardust rollout skill. The AEM project and the DA credentials are not on this machine yet, I will add them tomorrow, and the source site is not reachable from here. Do everything of the rollout that can be done before delivery, then tell me exactly what will ship, in what order, and where each page type stands. Hands-off: do not ask me questions, decide and record."
