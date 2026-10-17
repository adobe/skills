# live-evals (plugins/web/live-evals)

Live, real-world evals for agent skills, run with promptfoo through Pi, plus a report of the
lowest model that is good enough per skill (`REPORT.md`). Fixture-based scenarios (Tessl) stay in
`plugins/web/evals`.

```
cd plugins/web/live-evals && npm ci
scripts/run.sh <skill> [ref] [provider-regex]       # ref defaults to HEAD of this repo; 3x per case
npm run report                                      # results/ -> REPORT.html, METHODOLOGY.html, REPORT.md, REPORT-detail.html
```

- `models.yaml`: model matrix, ranked low to high. Credentials come from your local Pi setup.
- `skills/<skill>/`: `promptfooconfig.mjs` (built with `lib/config.mjs`), cases, assertions and
  `skill.yaml` (the floor: pass rate and latency a model must reach; sibling skills to load).
- `scripts/setup.sh`: builds `workspace/<skill>` from a git ref of this repo
  (`SKILLS_REPO`, `SKILLS_PATH`), so the same suite compares a branch with `main`. It also extracts
  `plugins/web/cli/dist/web.mjs` from that ref to `workspace/<skill>/.web-cli/` with a `bin/web` shim, and installs the CLI's runtime dependencies (`cld3-asm`) there.
- `fixtures/`: controlled pages served on http://localhost:8765 by `scripts/fixtures-server.mjs`
  (started by `run.sh`). Each suite mixes fixtures (known ground truth) with real sites.
- `results/`: one summary per run. Raw promptfoo output stays in `output/` (gitignored); do not use
  `promptfoo share`, results contain real site names.

## Reports

Reports score the latest ref per skill; earlier refs are listed but not pooled.

- `REPORT.html`: the one-page gist, skills x models, coloured by whether the model meets the skill's floor.
- `METHODOLOGY.html`: how the evals work, the stack, what exists and what we added, what the numbers do and
  do not tell you. Published next to the report as `methodology.html`.
- `REPORT.md`: the gist plus per-skill tables, per-case matrices and common failure reasons.
- `REPORT-detail.html` (not committed, `npm run report` builds it): the per-case matrix rendered by
  promptfoo itself. `lib/replay-provider.mjs` replays stored results, so no model is called.
- `npx promptfoo view`: every raw run on this machine, with the agents' outputs and assertion reasons.

## Comparison arms

`ARM=skill|cli|none scripts/run.sh <skill> <ref>` (default `skill`; `SKILLS=off` is an alias for `ARM=none`).
`cli` and `none` run the same cases and graders without the skill, on the models marked `noskill` in
`models.yaml` unless a provider filter is given. They are comparisons, not benchmarks.

- `skill`: skill loaded, `web` CLI on PATH. The benchmark arm.
- `cli`: no skill loaded or on disk; the CLI is built into the workspace (`/tmp/skill-evals-cli/<skill>/.web-cli`)
  and on PATH. The prompt adds the output format, the headless line and `` A `web` CLI is installed; `web --help` documents it. ``
  Stored with `arm: cli`, file suffix `-cli`.
- `none`: no skill, no CLI, empty directory under `/tmp/skill-evals-noskill`. Stored with `arm: no-skill`,
  suffix `-noskill`.

Both use a private `$HOME` with no skills in it, and a grader fails any run that opens a skill file from disk.
Cases that hinge on a skill's own method have `metadata: { noskill: skip }`. `REPORT.md` shows the
"Skill, CLI, or neither" table, with `CLI used` from each run's `used_cli` flag (a `web browser|page|probe|ext|mask` command).

All browsers are headless in every arm: agent shells refuse `--headed` and `open`, a grader fails runs that
tried, and a sweeper kills automation browsers started without `--headless`.

## How a run is graded

- Every run gets its own copy of the workspace and its own `playwright-cli` session
  (`PLAYWRIGHT_CLI_SESSION=run-<id>`), so runs can execute in parallel. The copies are kept under
  `/tmp/skill-evals-live/<skill>` (outside the repo, so the agent's cwd never reveals it).
- Assertions are code, not an LLM judge: they read the files the agent wrote under `./out`, the
  reply, the tools' output, or the agent's own browser session, and compare with ground truth.
  Malformed output is a failure with a reason, never a harness error.
- A run that exceeds the time budget (`timeoutS`, 120 s by default) is aborted and counts as a
  failure. `skill-used` checks that the model really loaded the skill.
- Skills call the `web` CLI. The skill arm puts `workspace/<skill>/.web-cli/bin` on PATH (exported
  before every agent shell command), so `web` resolves first. The CLI takes its session from
  `PLAYWRIGHT_CLI_SESSION`, so each run's browser is `run-<id>`; the hook also closes leftover `web-*` sessions.
- All browsers are headless: `web ext launch` is headless by default; `cdp-connect`'s `pre.sh` starts its own
  headless Chrome on port 9222. Sessions are global per machine, not per workspace.

## Coverage of the web plugin

| Skill | Cases | Notes |
|---|---|---|
| browser-probe | 4 real sites | recipe must match the probe report and load the page |
| page-langs | 2 fixtures, 5 real | `langs.json` vs known languages and declarations |
| page-collect | 3 fixture tasks, 1 real | metadata, forms, videos, socials, icons vs the fixture markup |
| page-tree | 2 fixture, 1 real | grid, gradient, image background, fixed banner, `minWidth` |
| page-reduce | 2 fixture, 1 real | 5 sections, `{REPEAT:2}`, no scripts, phase 1 only |
| page-prep | 2 fixtures, 1 real | checked in the agent's own browser: overlay gone, nothing accepted |
| cdp-connect | 4 fixture tasks | pointer skill → `web browser attach/eval/cdp`; Chrome on 9222: form, screenshot, network, accessibility |
| cdp-ext-pilot | 3 fixture tasks | headless via the CLI, no shim; tiny MV3 extension: side panel, options page, extension id |
| domain-mask | none | needs sudo, `/etc/hosts` and port 443; not run unattended |

Add a model: one entry in `models.yaml`. Add a skill: `skills/<name>/` with a config, cases,
assertions and `skill.yaml`.

## Sources

No external sources. Provider behaviour follows https://www.promptfoo.dev/docs/guides/test-agent-skills/
and Pi's SDK docs (https://pi.dev/docs/latest/sdk).
