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
- Ad-hoc Playwright / pngjs probes and their output live under `stardust/.work/<skill>/probes/`, never in `/tmp` (probe files in `/tmp` are lost to the next session and to the state report).

## Runner

- Waiting is the master skill's § Hands-off mode → Wait discipline: background plus progress file, checks at most every 4 minutes, never a fixed long `sleep`.
- macOS has no `timeout`: cap a command with `node skills/replica/scripts/run-capped.mjs --timeout <s> -- <cmd>`.
- The tool layer kills a foreground command at about 2 minutes with exit 143; exit 124/143 means *killed*, never *FAIL* — re-run it in the background, do not record a verdict.

## Delivery

- Bulk delivery is `node skills/deploy/scripts/deploy-batch.mjs` — never an ad-hoc `curl` loop; success is read from its ledger and the admin status line, never from a loop printing "done" (`../deploy/da-deploy-protocol.md` § Deploy, "use the bundled driver").

## Paths

- Every path is absolute from the project root recorded at Setup (`pwd` at Setup step 1; once the environment preflight lands it is `stardust/.work/env.json` `projectRoot`).
- Never `cd` inside a compound command (`cd x && …`): the working directory is reset between tool calls and a `cd` that survives poisons every relative path that follows.
- The state report warns when the current directory is not the project root (master § Setup step 7).

## Served assets

- Delivered `.plain.html` and assets come gzip-encoded: every `curl` that reads a served file carries `--compressed`, or byte counts and text asserts lie (`../deploy/da-deploy-protocol.md` § Deploy, step 3b).

## Local QA

- `aem up` serves single-page loops only: its proxy hangs under concurrent requests and may proxy the wrong branch — batch gates run against the branch preview (`<branch>--<repo>--<org>.aem.page`).
- A capture shorter than 60 % of the reference height is a failed capture: retry it, never measure it.

## Ports

- Before any gate round, assert the server on the port is yours — `skills/replica/scripts/gate.sh --marker <string>` (the identity assertion) — and free stale listeners with `lsof -i :<port>`; a port allocator will replace the fixed defaults later.
