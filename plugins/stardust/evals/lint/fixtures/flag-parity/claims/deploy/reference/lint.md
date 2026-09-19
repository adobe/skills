# Fixture: documented flags and rule ids that no script has (flag-parity.test.mjs)

Open each trigger (`chrome-parity --no-such-flag <sel>`) before chrome is signed off.
Run `node skills/rollout/scripts/delivery-lint.mjs --file <html> --allow-no-h1 --no-such-flag`.
The lint rule `D-NOPE` fires on constant rows; `D1-EMPTY` is advisory (🟡).
Dates in the ledger are `YYYY-MM-DD` (a caps token on a prose line is not a claim).
`node skills/deploy/scripts/block-lint.mjs blocks/ --styles styles/styles.css` (bare `blocks` is not rollout's blocks.mjs).
`chrome-parity --no-such-flag <sel>` flag-parity: ignore — fixture: the marker skips the line.
Pick the palette with `anchor --no-such-flag` (an unhyphenated basename in command position still counts).
