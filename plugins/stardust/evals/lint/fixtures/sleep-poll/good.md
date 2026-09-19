# Fixture — nothing below may fire (sleep-poll lint self-test)

Read the driver's progress file (`node skills/stardust/scripts/progress.mjs read
stardust/.work/deploy/deploy-batch.progress.json`) at most every 4 minutes; the
last stdout line is `SUMMARY deploy-batch ok=<n> failed=<n> exit=<code> …`.

Never `sleep N; grep -c` a log — the prohibition line passes.

An instrument deadline is not a poll: `run-capped.mjs --timeout 300 -- node stitch-shot.mjs`.
A retry pause is not a poll either: `sleep 2` between attempts, then the next PUT.
The historical shape, marked: `sleep 240; tail -f batch.log` <!-- sleep-poll: ignore — quoted as the anti-pattern -->
