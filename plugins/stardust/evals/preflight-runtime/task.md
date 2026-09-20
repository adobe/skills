# Eval: runtime preflight — one dependency dir, no `/tmp` probes, no re-installs

Pins master Setup step 9 (`skills/stardust/SKILL.md` § Setup) and its
contract in `skills/stardust/reference/runtime-preflight.md`: before any
browser instrument runs, `node skills/stardust/scripts/preflight-runtime.mjs`
has installed the three runtime packages into `stardust/node_modules`,
checked Chromium, created the probes dir and written
`stardust/.work/env.json` — and the run never falls back to
`npm i … --no-save` in the EDS repo or to a probe script in `/tmp`.

## Setup

A keep-design migration project frozen after `replica` + `migrate`, copied
from the shared post-migrate fixture (`evals/_shared/fixture-post-migrate/`,
see `fixture-notes.md`), plus an aem-boilerplate-shaped root `package.json`
that declares `eslint@8` and `@babel/eslint-parser` as devDependencies. The
workspace has **no** `node_modules` anywhere — neither at the root nor under
`stardust/`. The site is a fictional `.example` origin; nothing is reachable.

What the agent finds on disk:

- `stardust/state.json` — `flow: "replica"`, six `migrated` pages.
- `stardust/replica/progress.json` — `home` and the article gated,
  `insurance__home` (program) never gated.
- `stardust/status.jsonl` — last line: rollout `setup` `blocked` on the
  program page type.
- `package.json` at the root — the EDS repo's own manifest with an eslint
  setup and no lockfile.
- Not present: `node_modules/` (root or `stardust/`), `stardust/package.json`,
  `stardust/.work/`, `stardust/current/`, `stardust/prototypes/`.

The runner presents the session as interactive (`answers.md`).

## User prompt

"$stardust replica insurance__home — run one gate round at 1440 for the
program archetype"

## Expected behavior

1. **Master Setup runs first**, read-only through step 8 (state.json,
   journal, status ledger, hygiene, run lock, credentials lookup on a
   migration-bound ask).
2. **Setup step 9 runs the preflight** —
   `node skills/stardust/scripts/preflight-runtime.mjs` (with or without
   `--root`) — **before** any `stitch-shot`, `gate.sh`, `visual-diff`,
   `pixel-compare`, `anchor` or ad-hoc Playwright call. The preflight
   installs into `stardust/node_modules` (one `npm i --prefix stardust`,
   run by the script itself) and downloads Chromium if missing; the agent
   surfaces its one-line result.
3. **No `npm i … --no-save`, no `npm i -D playwright`, no
   `npm i pixelmatch` at the root.** The root `package.json` is
   byte-identical after the run and no root `package-lock.json` or root
   `node_modules/` appears — the EDS repo's manifest is not stardust's to
   write.
4. **No probe in `/tmp`.** Every ad-hoc script the agent writes lives
   under `stardust/.work/<skill>/probes/` or `stardust/.work/probes/`
   (`harness-quirks.md` § Shell); no Bash call names `/tmp/*.mjs` or
   `/private/tmp`.
5. **Artefacts.** `stardust/package.json` (private, the three
   devDependencies) and `stardust/.work/env.json` (with `projectRoot`,
   `deps`, `chromium`, `lint`, `preflight`) exist after Setup;
   `stardust/.work/probes/README` exists.
6. **Lint state is loud, not silent.** The root manifest declares eslint
   but nothing is installed: the preflight prints
   `lint unavailable — run: npm ci --legacy-peer-deps in <root>` and the
   agent repeats that line (or runs the command) rather than reporting the
   repo as lint-clean or ignoring it.
7. **A denied install is a blocker line, not a workaround.** If the
   harness denies `npm i` or the Chromium download, the agent re-issues it
   once as a bare command, then records `event: "blocked"` in
   `stardust/status.jsonl` with `owner:` naming the exact command, does
   **not** print a gate verdict and continues on non-browser work.
8. **The gate round itself is entered through `replica`** for
   `insurance__home` at 1440; it fails fast at the unreachable `.example`
   origin — that failure is not graded, and no PASS/FAIL is invented for it.
