# skill-eval

Runs Tessl-format eval scenarios locally with pi, isolated by nono. It uses no
Tessl credits.

## Requirements

- Node 24+
- [pi](https://pi.dev/docs/latest/quickstart) on `PATH`, logged in to the
  providers you use (`~/.pi/agent/auth.json`)
- [nono](https://nono.sh/docs/cli/getting_started/installation) on `PATH`
  (macOS / Linux)

## Usage

```bash
npm run eval:local -- <plugin-or-scenario-dir>... [options]
```

Each source is a plugin root (every scenario in its `evals/`), an `evals/` dir,
or a single scenario dir. Mix sources and plugins freely.

```bash
# Whole plugin, 3 repeats, baseline vs plugin
npm run eval:local -- plugins/aem/edge-delivery-services

# One scenario, one run
npm run eval:local -- plugins/aem/edge-delivery-services/evals/analyze-hero-variant -n 1

# Scenarios by name across plugins, narrowed to one skill
npm run eval:local -- plugins/aem/edge-delivery-services --scenario 'analyze-*' --skill analyze-and-plan

# Three worker models, 2 repeats each
npm run eval:local -- plugins/aem/edge-delivery-services -n 2 \
  --model github-copilot/claude-sonnet-5.5,github-copilot/gpt-6.1-sol,github-copilot/kimi-k3

# Compare skill versions: baseline vs main vs a branch checked out in a worktree
git worktree add --detach /tmp/skills-branch my-branch
npm run eval:local -- /tmp/skills-branch/plugins/aem/edge-delivery-services \
  --context main=plugins/aem/edge-delivery-services \
  --context branch=/tmp/skills-branch/plugins/aem/edge-delivery-services
```

Variants are `baseline` (no skills) plus `with-plugin` (the source's plugin),
or, with `--context`, one variant per label. A context is a plugin root; it
applies to the source plugin with the same manifest name (repeat the label for
several plugins). Scenarios always come from the sources. The report records
each context's dir and git commit.

| Option | Default | |
|---|---|---|
| `-n, --runs` | `3` | Repeats per variant, scenario and model (1-10) |
| `--scenario` | all | Scenario name, `*` wildcards, repeatable |
| `--skill` | all | Narrow every context to these skills, repeatable |
| `--context` | | `<label>=<plugin-dir>` variant, repeatable; replaces `with-plugin` |
| `--skip-baseline` | | Skip the no-skills baseline variant |
| `--baseline-from` | | Reuse ok baseline attempts from an earlier run (repeatable): same scenario files (fingerprint of everything in the scenario dir), model, run number, thinking and judge. Runs made before this flag have no fingerprint and are never reused. Reused attempts are logged as `reused` and recorded in `meta.baselinesReused` |
| `--skip-scoring` | | Skip the judge |
| `--force-activation` | off | Tell the agent to read the skills first |
| `--model` | `github-copilot/claude-sonnet-5.5` | Worker model(s), comma-separated or repeatable |
| `--thinking` | pi default | Worker thinking level |
| `--scorer-model` | `github-copilot/gemini-4-argon` | Judge model |
| `--scorer-thinking` | pi default | Judge thinking level |
| `--label` | | Run label |
| `--concurrency` | `5` | Parallel attempts (same default for `quiz`, `trigger` and `report --rejudge`) |
| `--timeout` | `10` | Worker timeout per attempt, minutes |
| `--out` | `.skill-eval/runs` | Output root |
| `--resume` | | Continue an earlier run (same sources and options): keeps its ok and timed-out attempts, redoes the rest |
| `--dry-run` | | List scenarios and attempt count |

## How it works

Each attempt (scenario × variant × repeat × model):

1. Builds a fresh workdir per Tessl's
   [scenario.json](https://docs.tessl.io/reference/configuration#eval-scenario-configuration)
   order: fixtures (`commit`, `directory`), then `include` (default `resources/`),
   then `setup` scripts (`setup.sh` last). A `commit` fixture is a fresh git repo
   with one commit; an optional `remote` (e.g. the project's GitHub URL) becomes
   `origin`, so tools that read the remote (`aem up`) work. No credentials are
   available, so pushes still fail. This is a local extension, not Tessl's format.
2. Runs `pi -p` in a fresh `HOME` and `PI_CODING_AGENT_DIR`, with no extensions,
   discovered skills, MCP, prompt templates or themes. `AGENTS.md` / `CLAUDE.md`
   inside the workdir (e.g. from a cloned project) are loaded, as in real use;
   your home dir and the repo above the workdir are not readable. `baseline`
   gets no skills; every other variant gets its plugin's skills and plugin
   rules via `--append-system-prompt`.
3. Wraps everything in `nono`. Each attempt runs in a fresh, randomly named
   dir in the OS temp dir (outside the repo, so tools that search parent dirs
   such as ESLint, git or npm find nothing above the project). The agent can
   write to that dir and to the shared temp dirs (`/tmp`, `$TMPDIR`), and
   reach only the hosts listed under [Network](#network). A variant's skills are copied into the
   project's `.agents/skills/` (the Agent Skills location pi and other agents
   read), hidden from git via `.git/info/exclude`, and removed again before the
   changes are computed and judged. Paths the agent and judge see never name
   the run, scenario or variant. Plugin rules go to the sandbox's
   `~/.pi/agent/rules/`. The
   agent cannot read your home dir, other repos, or the scenario's
   `criteria.json`. Global npm installs land in the sandbox `HOME`. When the
   worker ends, any process still running with its working directory inside
   the attempt dir (e.g. a backgrounded `aem up`) is killed; the count is
   saved as `strayProcesses` in the attempt's result. After
   judging, the workdir is moved into the run's `attempts/` folder.
4. Skills are not forced on by default, so scores include whether the agent
   picks the skill up itself. Activation = a tool result showed the first three
   lines of `SKILL.md` in order, or at least 3 of the skill's distinctive lines
   (lines shared between skills don't count). That works however the agent
   read it (`read`, `cat`, `cat -n`, partial or tail-truncated output). Pi has
   no skill tool; models read `SKILL.md` directly.
5. A judge (separate isolated pi session, read-only tools, read-only workdir)
   scores each `criteria.json` checklist item from 0 to `max_score`, with partial
   credit. Score = awarded / max, as a percentage. The judge gets the files the
   agent added, modified or deleted since setup and their diff (capped at
   120k characters), not the whole boilerplate. A scenario can set
   `"judge": { "commands": true }` in `scenario.json` to also give the judge
   the shell commands the agent ran (capped at 20k characters), for checks
   on what the agent did rather than what it wrote. Only attempts that finished
   cleanly are judged; errors and timeouts count as failed and are left out of
   averages.

`auth.json` is copied into each sandbox for the run and deleted afterwards.

nono's default profile also denies credentials (`~/.ssh`, `~/.aws`, `~/.npmrc`,
...), keychains, browser data and shell history, and allows read-only access
to system paths, Homebrew and Node/Python toolchains.

Not isolated: parallel attempts share the OS temp dir, so one attempt can read
or change another's workdir and `auth.json` copy.

## Network

nono's proxy enforces a host allowlist (`lib/sandbox.mjs`); every other
host is refused.

- Judge and `quiz`: model APIs only (`*.githubcopilot.com`, `api.github.com`,
  `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`).
- Worker, setup scripts and `trigger`: model APIs plus npm, PyPI, GitHub
  (`github.com`, `codeload`, `raw`/`objects.githubusercontent.com`),
  `*.aem.live`, `*.aem.page`, `*.hlx.live`, `*.hlx.page`, `da.live`,
  `*.da.live` and `*.adobe.io`.
- Worker, setup scripts and `trigger` also get localhost TCP on ports
  1024-17000 and 35729 (bind and connect), for `aem up` and other dev
  servers. That includes services on your machine listening on those ports.

Fixture repos are fetched outside the sandbox. A scenario that needs another
host fails until it is added to `WORKER_DOMAINS`.

## Output

`.skill-eval/runs/<timestamp>[-label]/`:

- `report.md`: per plugin summary (avg score, Δ vs baseline with worst / best
  scenario, skills used, failures, time, turns, tokens, cost), per scenario
  score avg (min–max), SD and Δ on avg / min / max, a per-solve table (status,
  score, skills used, time, turns, tokens in / out / total, cost), and per
  check averages. Every row is per worker model; with several models, `pooled`
  rows combine them (check averages are pooled only)
- Lift and noise: each skill variant is compared with `baseline`, and each
  later `--context` with the first one. Per scenario, the report shows Δ and
  noise band (√(SD₁² + SD₂²) over repeats, as Tessl does) for score, time,
  turns, tokens and cost, and labels the result:
  - vs baseline: *lift* if score rises beyond noise, or stays flat while time
    and turns both drop beyond noise; *degraded* if score drops beyond noise;
    else *flat*
  - vs another version: *lift* if any metric improves beyond noise and none
    gets worse; *degraded* if one gets worse and none improves; *mixed* if
    both; else *flat*
  - *n/a* when a side has fewer than 2 solves

  A pooled difference also needs the same sign on at least ⅔ of the models.
  The plugin summary counts labels per comparison. Time, turns, tokens and
  cost include solves that errored or timed out; score uses judged solves only.
- `results.json`: the same data plus every attempt
- `context/<variant>/<plugin>/`: the skills and rules each variant got
- `attempts/<plugin>/<scenario>/<model>/<variant>-<n>/`: `work/`, `session.jsonl`,
  `changes.json` + `changes.diff` (what the agent changed),
  `judge-*/session.jsonl`, `result.json` (per check scores and reasoning)

Exit code is 1 when any attempt errors, times out, or can't be scored.

## Network failures

Attempts that fail on a network or provider error (`Connection error`, `ECONN*`,
rate limits, 5xx, a stream cut off before `finish_reason`, a failed `git clone` in setup) are retried twice, after 5 s
and 20 s. After 5 attempts in a row fail that way the run stops, writes what it
has and prints the `--resume` command. Timeouts are results, not retried.

## Rebuilding a report

```bash
# Recompute metrics and skills used from saved sessions; scores are kept
npm run eval:local -- report .skill-eval/runs/<run>

# Also re-score every attempt whose worker finished (e.g. new judge model)
npm run eval:local -- report .skill-eval/runs/<run> --rejudge [--scorer-model <id>]
```

`--rejudge` copies each attempt's `work/` into a fresh sandbox and uses the
`task.md` / `criteria.json` copies saved in the run's `scenarios/` folder, so
it works after the source checkout is gone. Runs made before this command
existed keep their old scores.

## Differences from `tessl eval run`

- Skills are not forced on by default (Tessl forces them unless
  `--skip-forced-context-activation`).
- Agent is pi, not Claude Code / Codex; numbers are not comparable with Tessl's.
- Not supported yet: `--variant-json`, bundled MCP servers, hooks,
  `--env-file`, `--quality-check`, publishing results.

## Tests

```bash
npm run test:skill-eval
```

## Quiz

Asks each fact's question to models with no tools, skills or context files
(`pi -p --no-tools --no-skills --no-context-files`), then has the judge grade
the answer against the fact's `claim`: ✓ known, ~ partial, ✗ unknown.

```bash
npm run eval:local -- quiz plugins/aem/edge-delivery-services/facts.yaml \
  --model github-copilot/claude-sonnet-5.5,github-copilot/gpt-6.1-sol,github-copilot/kimi-k3
```

Prints the markdown table used in PR bodies and writes `quiz.md` and
`results.json` (answers and judge reasoning) under `.skill-eval/quizzes/<run>/`.
Options: `--fact <id>` (wildcards, repeatable), `-n` (asks per cell; cells show
one symbol each), `--scorer-model`, `--thinking`, `--concurrency`, `--label`, `--out`.

`facts.yaml` is a list of entries with `id`, `claim` and `question` (required),
plus `source` and `used_by`. Only the YAML subset the existing files use is
parsed: plain/quoted scalars, `>`/`|` block scalars, `- item` lists and `[]`.

## Trigger

Probes whether the agent picks up a skill for realistic prompts, without
solving them. All of the plugin's skills are installed so they compete. Each
run stops at the first skill file the agent opens (tool call path or tool
result content), the first `write`/`edit`, or `--max-turns` (default 6).

```bash
npm run eval:local -- trigger plugins/aem/edge-delivery-services \
  --queries queries/building-blocks.json -n 3 \
  --model github-copilot/claude-sonnet-5.5,github-copilot/gpt-6.1-sol,github-copilot/kimi-k3
```

Query set (JSON): `{"name", "fixture": {"repoUrl", "ref", "remote"?}, "queries": [{"id", "query", "should_trigger", "skill", "split"}]}`.
`skill` is the skill under test; `split` (`train`/`test`) is optional, select with `--split`.
`--context <label>=<plugin-dir>` probes other versions of the plugin (e.g. alternative descriptions).

`--keep-going` lets each run continue past the first skill and the first write, up to
`--max-turns` (default 12 in this mode) or the end. A skill then counts if it was opened at any
point, so a skill that usually opens second (e.g. building-blocks after content-driven-development)
is not hidden. Each result records `order` (`[{skill, turn}]`) and tokens; the report adds a
"First opened" column. Within one tool call or one tool result, skills are ordered by where they
appear; a path match and a content-only match in the same turn share that turn's number and are not
ordered against each other. `--timeout <min>` sets the per-run limit (default 3, 10 with `--keep-going`).

The report gives, per query: the trigger rate pooled and per model (triggered
= rate ≥ 50%), and which other skills fired instead. Per skill: precision and
recall over the queries whose `skill` it is. Output goes to
`.skill-eval/triggers/<run>/` (`trigger.md`, `results.json`).

## Contexts from git refs

```bash
npm run eval:local -- ctx --base origin/main \
  --take eds-da-skills-cleanup:plugins/aem/edge-delivery-services \
  --out /tmp/skills-final --name skills-final
npm run eval:local -- ctx rm /tmp/skills-final        # keeps refs/skill-eval/ctx/skills-final
```

Builds a plugin tree for `--context`: a detached worktree at `--base`, then each
`--take <ref>:<path>` replaces `<path>` with its state at `<ref>`, so files the ref deleted
do not linger (a plain `git checkout <ref> -- <dir>` keeps them). The result is committed,
verified against each ref, and kept reachable as `refs/skill-eval/ctx/<name>` so removing
the worktree loses nothing. The manifest (base and take shas, resulting commit) goes to
`.skill-eval/ctx/<name>.json` and is printed as JSON. Takes apply in order.

## Summary

```bash
npm run eval:local -- summary .skill-eval/runs/<run> [--variant <label>] [--out .skill-eval]
```

Scripted, no model calls. Writes `<run>-summary.md` (bucket counts per model and
pooled, per-scenario buckets and scores, observed noise per metric and how many
labels the floors change, failures) and copies the run's `report.md` next to it.
Buckets: skill helps / no signal / flat, headroom / not picked up / skill hurts /
broken; the rule is printed at the top of the summary.

## Helper scripts

In `tools/skill-eval/scripts/`, built on the harness:

- `battery.mjs`: standard final run for a branch. Builds `main` and branch contexts with `ctx`, runs the named trigger sets, then the named solve scenarios, and writes an index to `.skill-eval/<label>-battery.md`.
- `census.mjs <run-dir> <plugin-root> [--out <file.md>]`: skill open order, references and scripts read, tokens, turns and actions (npm ci, `aem up`, lint, tests) per attempt. For unscored runs of `plugins/aem/edge-delivery-services/census/` (`--skip-scoring`).
- `review-pack.mjs <run-dir> --scenario <name> --out <dir>`: pilot of a blinded human review page (best, median and worst attempts per arm, rendered with Playwright). Needs Playwright; starts a local HTTP server on a free port.
