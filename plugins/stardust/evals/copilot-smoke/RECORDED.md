# Recorded Copilot smoke runs

One entry per run kept as release evidence. Full logs stay local under `results/`.

## 2026-09-17 — branch stardust/copilot-4-smoke (stardust 0.22.0 + PRs #368–#371), impeccable 4.3.1


- CLI: GitHub Copilot CLI 1.0.85.
- plugin: /Users/paolo/stardust/source/170926/skills/plugins/stardust
- plugins:  • impeccable@impeccable (v4.3.1) • stardust (v0.22.0) 


```
PASS  listing: all 15 stardust skills and impeccable present
PASS  skill(extract) loads by bare name
PASS  setup: impeccable found
PASS  setup: no missing file or command
PASS  setup: does not call the removed load-context.mjs
passed 5, failed 0 — log: /Users/paolo/stardust/source/170926/skills/plugins/stardust/evals/copilot-smoke/results/20260917T154251Z.md
```

Setup report returned by the model (test 3), abridged:

```
1. Verify impeccable is installed.
   Command: `node /Users/paolo/.copilot/installed-plugins/_direct/stardust/skills/stardust/scripts/impeccable-version-check.mjs`
   Outcome: `impeccable 4.3.1 installed (Claude Code) — current` and `impeccable 4.3.1 installed (GitHub Copilot) — current`
2. Check the target-state files.
   Command: `for f in PRODUCT.md DESIGN.md; do if [ -e "$f" ]; then echo "FOUND $f"; else echo "MISSING $f"; fi; done`
   Outcome: `MISSING PRODUCT.md`; `MISSING DESIGN.md`
3. Read stardust's state.
   Command: `for f in stardust/state.json; do if [ -e "$f" ]; then echo "FOUND $f"; else echo "MISSING $f"; fi; done`
   Outcome: `MISSING stardust/state.json`
4. Read impeccable's command registry.
   Command: `node -e "const fs=require('fs'); const m=require('/Users/paolo/.copilot/installed-plugins/impeccable/impeccable/skills/impeccable/scripts/command-metadata.json'); const keys=Object.keys(m
   Outcome: `command_count=24`; sample keys: `craft, init, document, extract, live`
5. Status ledger.
   Command: `mkdir -p /private/var/folders/w4/991rmymn68d9kd3xl7wgkh9r0000gp/T/tmp.48J0BGHsPr/stardust && TS=$(date -u +%Y-%m-%dT%H:%M:%SZ) && printf '%s\n' "{\"ts\":\"$TS\",\"skill\":\"stardust\",\"p
   Outcome: `2 /private/var/folders/w4/991rmymn68d9kd3xl7wgkh9r0000gp/T/tmp.48J0BGHsPr/stardust/status.jsonl`
6. Project hygiene.
   Command: `cp /Users/paolo/.copilot/installed-plugins/_direct/stardust/skills/stardust/reference/stardust.gitignore /private/var/folders/w4/991rmymn68d9kd3xl7wgkh9r0000gp/T/tmp.48J0BGHsPr/stardust/.
   Outcome: file created successfully at `.../stardust/.gitignore` (913 bytes)
STARDUST_SMOKE impeccable=found setup_failures=0
```

First attempt the same day scored 4/5: the model counted the legitimately absent `PRODUCT.md`/`DESIGN.md` of an empty project as a setup failure. The prompt now excludes absent project state; the recorded run is the second attempt.
