# resolve-chain fixture

A project root whose `stardust/package.json` + `stardust/node_modules/` hold
three stub packages (`playwright` exporting `chromium: {}`, `pixelmatch`,
`pngjs`) — the layout `skills/stardust/scripts/preflight-runtime.mjs`
creates. `evals/lint/resolve-chain-smoke.mjs` runs
`skills/stardust/scripts/lib/resolve.mjs` against it. No real dependency is
installed here; nothing in this tree is executable beyond the stubs.
