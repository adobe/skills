# Harness quirks — the runner, the shell, the paths

One rule per line. Read before writing any shell loop, runner command,
delivery step or ad-hoc probe; every brief to a delegated agent points
here ("follow `harness-quirks.md`"). The field counts behind each rule
are in the CHANGELOG, not here.

## Shell

- The default shell is zsh and drops `PATH` inside multi-line `while`/`for` bodies: any loop longer than one line goes into a bash file under `stardust/.work/<skill>/` with `#!/usr/bin/env bash` and `PATH=/usr/bin:/bin:/usr/local/bin:$PATH` on line 2 — or into a node script.
- Quote every URL and every word that starts with `=`; write `echo "---"`, never `echo ===` (zsh expands a leading `=` as a command lookup).
- zsh does not word-split an unquoted `$LIST`: iterate with `${=LIST}`, pipe through `xargs`, or read a paths file one line at a time.
- macOS ships bash 3.2: no `declare -A`, no `mapfile`, no `read -a`, no GNU `cat -A` / `sed -i` without a suffix argument.
- Heredocs that carry control characters or very long lines are rejected by the tool layer: write the file with the editor tool or a small patch script.
- After patching CSS or JS by script, check brace balance and never append `//` to an existing line (it comments out the rest of a minified line).
- Ad-hoc Playwright / pngjs probes and their output live under `stardust/.work/<skill>/probes/` (created by `preflight-runtime.mjs`; they resolve `stardust/node_modules` — `runtime-preflight.md`), never in `/tmp` (probe files in `/tmp` are lost to the next session and to the state report).

## Runner

- Waiting: master § Hands-off mode → Wait discipline (pointer only; no numbers here).
- macOS has no `timeout`: `node skills/replica/scripts/run-capped.mjs` — `../replica/reference/source-fidelity-gate.md` § Iteration discipline.
- The tool layer kills a foreground command at about 2 minutes with exit 143; exit 124/143 means *killed*, never *FAIL* — re-run it in the background, do not record a verdict.

## Delivery

- Bulk delivery is `node skills/deploy/scripts/deploy-batch.mjs` — never an ad-hoc `curl` loop; success is read from its ledger and the admin status line, never from a loop printing "done" (`../deploy/da-deploy-protocol.md` § Delivery pipeline, "use the bundled driver").

## Paths

- Every path is absolute from the project root confirmed at Setup step 7.
- Never `cd` inside a compound command (`cd x && …`): the working directory is reset between tool calls and a `cd` that survives poisons every relative path that follows.
- The state report warns when the working directory is not the project root (`state-machine.md` § State report).

## Served assets

- Served files are gzip: `--compressed` on every `curl` that reads one — `../deploy/da-deploy-protocol.md` § Deploy, step 3b.

## Local QA

- `aem up` serves single-page loops only: its proxy hangs under concurrent requests and may proxy the wrong branch — batch gates run against the branch preview (`<branch>--<repo>--<org>.aem.page`).
- A capture shorter than 60 % of the reference height is a failed capture: retry it, never measure it.

## Ports

- Ports are allocated, never typed: `node skills/replica/scripts/serve.mjs <dir> --role proto` / `port.mjs proto|harness` pick a per-project slot in 8800–8899 (prototypes) / 3100–3199 (the `aem up` harness) — never 8791, 3000 or 8765 (the documented fallbacks other tools default to); `stardust/.work/ports.json` + `<role>.pid` record the slot. A foreign listener on the slot is **listed, never killed** — the allocator moves on; `port.mjs stop <role>` ends only this project's server.
- Before any gate round, assert the server on the port is yours — `skills/replica/scripts/gate.sh --marker <string>` / `served-identity.mjs <url> --marker <s>` (exit 4 = no verdict) — rather than freeing listeners by hand.
