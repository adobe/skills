# Runtime preflight — dependencies, browser, probes dir, environment record

## When to read what

- § What it does — at master Setup step 10 and as the first command of any delegated brief.
- § Contract — what a non-zero exit blocks, what it never blocks, the escape hatches, hands-off.
- § Files — `stardust/package.json`, `stardust/node_modules/`, `stardust/.work/env.json`, the probes dir.
- § Resolution chain — how every instrument finds `playwright` / `pixelmatch` / `pngjs` and a sibling skill's script.
- § Evals — the fixture test and the session eval that pin this file.

Browser instruments used to fail on `Cannot find package 'playwright'`
from `/tmp` probes and from project script copies whose dependencies an
EDS `npm i --no-save` had pruned; agents re-installed the same three
packages hundreds of times per project. The preflight replaces that with
one dependency dir stardust owns and one record of the environment.

---

## What it does

`node skills/stardust/scripts/preflight-runtime.mjs [--root <dir>] [--no-install] [--offline] [--skip] [--json]`
— idempotent, exit 0 / 1 / 2 (`--help` for the table). The root must
already hold a `stardust/` dir (Setup step 5 creates it): a `--root` or
cwd without one exits 2 and writes nothing — the preflight never seeds a
project. Steps:

1. Writes or merges `stardust/package.json` (private; devDependencies
   `playwright`, `pixelmatch`, `pngjs`) and runs **one**
   `npm i --prefix stardust` when any of the three fails to resolve from
   it. Node's parent walk then resolves `stardust/node_modules` from
   `stardust/scripts/**` and from `stardust/.work/<skill>/probes/**`.
2. Checks the resolved Playwright's `chromium.executablePath()` exists;
   downloads Chromium when it does not (skipped under `--no-install`).
3. Creates `stardust/.work/probes/` with a one-line README — ad-hoc
   Playwright / pngjs probes live there, never in `/tmp`
   (`harness-quirks.md` § Shell).
4. Records the environment in `stardust/.work/env.json` (§ Files).
5. Checks the EDS repo's lint setup: when `<root>/package.json` carries
   eslint, `node_modules/.bin/eslint` and `@babel/eslint-parser` must
   resolve from `<root>`, else `lint: "unavailable"` and one loud line
   naming `npm ci --legacy-peer-deps`. The preflight never installs the
   repo's own devDependencies (write boundary, master § Artifacts).

The EDS project's `package.json` and lockfile are never written. Zero
requests to the source site.

---

## Contract

An **instrument**, not a quality gate (`harness-permissions.md` § Two
classes): it changes no verdict, no threshold, no gate round.

- **Condition → blocks.** Exit 1 with one actionable line per item when
  a dependency does not resolve from `stardust/node_modules` after the
  install (a copy reachable only through Node's parent walk from
  `<root>/node_modules` — a past `--no-save` install — is `missing`: the
  EDS repo's next `npm i` prunes it), Chromium is missing,
  or lint is unavailable in a repo that declares it (`env.json.preflight`
  is then `partial`; the lines are also `env.json.missing`, and go to
  stderr under `--json` — the state report's `Preflight:` line copies
  them). A non-zero exit blocks **only the browser-instrument
  phases** (replica / diff gates, deploy Local QA and `ai-readability`,
  dynamics, qa, reskin probes) and the deploy lint step — deploy never
  reports "eslint clean" while `env.json.lint` is `unavailable`. Extract
  fallbacks, routing, the state report and author-only work continue.
- **Never a PASS by absence.** An instrument that cannot load its browser
  exits 2 with the preflight command — no verdict, the same class as
  exit 124 ≠ FAIL.
- **Escape hatch.** `--skip` records `preflight: "skipped"` (the state
  report prints it); `--no-install` checks only and writes nothing
  tracked — no `stardust/package.json`, no install; its missing lines
  name the full preflight command (read-only sessions, `run-lock` exit
  3, delegated agents); `--offline` accepts a pre-populated
  `stardust/node_modules`. No flag makes a missing dependency count as
  present.
- **Hands-off.** The preflight IS the auto-resolution: it installs, it
  does not ask. `npm i --prefix stardust` and the Chromium download are
  instrument-class actions; on a harness denial re-issue once as a bare
  command, then `Blocked on owner: <exact command>` + `event: "blocked"`
  and continue on unblocked work (master § Hands-off mode). Hands-off
  never weakens a gate here — nothing is skipped, only installed.
- **Protected.** Exit 124 semantics, gate thresholds (B29), the
  deploy-batch ledger, default ports (`env.json.ports` is an empty
  placeholder for the port allocator), hit-minimisation on the source
  site, D1 / D16 — all untouched.

---

## Files

| path | tracked | who writes | contents |
|---|---|---|---|
| `stardust/package.json` | yes | preflight (merge; not under `--no-install`) | `{ name: "stardust-deps", private, type: "module", devDependencies }` |
| `stardust/node_modules/`, `stardust/package-lock.json` | **never** (`stardust/.gitignore` lists both; `.gitignore` = `*` written inside the dir for older project copies) | npm via the preflight | the three runtime packages |
| `stardust/.work/env.json` | no | preflight + `preflight-transports.mjs` (merged) | `projectRoot`, `nodeBin`, `nodeVersion`, `shell`, `bash32`, `pathSnapshot`, `tools`, `deps`, `chromium`, `lint`, `ports`, `envFile`, `preflight`, `missing`, `writtenAt`, `transports` |
| `stardust/.work/probes/` | no | preflight (dir + README); agents (scripts, output) | every ad-hoc probe; skill-scoped variants `stardust/.work/<skill>/probes/` |

`env.json.preflight` is `ok`, `partial` (something missing, listed on
stdout) or `skipped`; the state report's `Preflight:` line copies it
(`state-machine.md` § State report).

---

## Resolution chain

Every plugin script that needs `playwright`, `pixelmatch` or `pngjs`
resolves it through the same additive chain — a script that resolved
yesterday resolves today from the same link:

1. the script's own directory (Node default — legacy project copies);
2. `process.cwd()`;
3. the nearest `stardust/package.json` walking up from `cwd` (the
   preflight's dir, found from any sub-directory);
4. `npm root -g`.

Missing at every link → exit 2 with one line:
`<script>: cannot resolve 'playwright' from <cwd> — run node skills/stardust/scripts/preflight-runtime.mjs (master § Setup step 10)`.
The shared helper `skills/stardust/scripts/lib/resolve.mjs` (`resolveDep`,
`resolveDeps`, `siblingScript`) implements the chain for scripts run from
the plugin tree; `siblingScript(skill, file)` tries the plugin layout,
`$STARDUST_SKILLS_DIR/<skill>/scripts/<file>`, then the flat copy layout
(`../<skill>/<file>`), and exits 2 naming the three when none resolves. A
`check-crashed` finding in qa stays an `error` row, never a pass.

Through the helper today: `dynamics/scripts/lib.mjs` and
`qa/scripts/lib.mjs` (`loadPlaywright()`), `extract/scripts/crawl.mjs`
(lazily — a lone project copy without `stardust/lib/resolve.mjs` beside
it falls back to the bare import). Still on their own imports, each to
convert in its own skill's change: replica, diff, reskin and deploy
scripts and the migrate / prototype fixtures — `evals/lint/resolve-chain-smoke.mjs`
`ALLOW` is the ledger and must shrink. Until then a project copy stays
runnable only when copied **as a set** (`harness-permissions.md` § Two
classes): the skill's `scripts/` plus `skills/stardust/scripts/` (with
`lib/`), because the scripts import `../stardust/<x>.mjs` siblings.

---

## Evals

- `skills/stardust/scripts/test/preflight-runtime.test.mjs` — empty
  project → exit 1 naming exactly the three packages + chromium, nothing
  tracked written under `--no-install`; stubbed `stardust/node_modules` →
  exit 0 and the `env.json` keys; idempotent; `<root>/package.json` never
  touched; lint `unavailable` → the loud line, exit 1, `partial` (and exit
  0 once eslint resolves); `--json` keeps the lines (stderr) and the
  `missing` key; a `--root` without `stardust/` exits 2, nothing
  created; `--skip`.
- `evals/lint/resolve-chain-smoke.mjs` — the chain's links and the exit-2
  line, from the plugin tree and from a flat copy layout.
- `evals/preflight-runtime/` — a replica gate round on the shared fixture:
  the preflight runs before any browser instrument, no `npm i … --no-save`,
  no `/tmp/*.mjs`, root `package.json` byte-identical. Every eval that
  runs master Setup names step 10's writes: `runner-output-contract`
  `read_only_inputs` allows `stardust/package.json` + `node_modules/`;
  `resume-state-report` `nothing_written` allows only the two `.work/`
  files `--no-install` writes.
