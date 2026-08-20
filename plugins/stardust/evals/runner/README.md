# Stardust eval runner

Runs the stardust evals (`evals/*/task.md` + `criteria.json`) against a live
agent session, judges the result, and compares labeled variants. Built to gate
skill-abrasion work: take an N-run baseline of a skill, abrade it, rerun, and
diff per-criterion pass rates before accepting the cut.

## Pipeline

Each run goes through three phases:

1. **Fixture** — `evals/<name>/fixture/` is copied into a fresh workspace at
   `results/<label>/<name>/run-<i>/workspace/`. The fixture is the concrete
   realization of the "Setup" section in `task.md`.
2. **Session** — the "User prompt" from `task.md` is executed in the workspace
   via the Claude Agent SDK, with the stardust plugin loaded from this
   checkout (staged into a temp dir with the manifest's `dependencies` field
   stripped — the SDK silently drops a plugin whose dependencies reference an
   unregistered marketplace; the runner fails loudly if either plugin is
   missing from the session init) and every tool call allowed through
   the `canUseTool` callback (`permissionMode: "default"`, not
   `bypassPermissions` — that mode shadows the callback). If the agent asks
   clarifying questions (AskUserQuestion), they are answered automatically
   from the persona in `evals/<name>/answers.md`. When a persona exists, the
   session's system prompt states that a user is present, so skills exercise
   their interactive contract instead of drifting into hands-off branches
   (headless sessions otherwise read as unattended). The full
   message stream is persisted to `transcript.jsonl`, a condensed
   human/judge-readable log to `session.md`, and token/cost totals to
   `usage.json`.
3. **Judge** — a separate strong-model session reads `criteria.json`,
   `task.md`, `session.md` (with `transcript.jsonl` available for drill-down)
   and inspects the workspace artifacts, then writes `judgment.json` with a
   binary verdict + evidence per criterion. The weighted score is computed by
   the runner from the verdicts, not by the judge.

## Usage

```bash
cd plugins/stardust/evals/runner
npm install

# N runs of one eval under a label
node run.mjs --eval direct-from-phrase --n 3 --label baseline

# judge any unjudged runs under a label
node judge.mjs --label baseline

# compare two labels (per-criterion pass rates, score + token deltas)
node compare.mjs baseline abraded-v1
```

`run.mjs` flags:

- `--eval <name>` (required) — eval directory name under `evals/`
- `--label <label>` (required) — variant label; results land under
  `results/<label>/`
- `--n <N>` — repetitions (default 1). Runs are sequential to avoid
  cross-talk.
- `--model <model>` — session model (default: SDK default)
- `--plugin-dir <path>` — stardust plugin root (default: this checkout)

## Results layout

```
results/<label>/<eval>/run-<i>/
  criteria.json     # rubric snapshotted at run time — the judge grades
                    # against this copy, so later rubric edits can't skew
                    # cross-label comparisons
  workspace/        # final project state, inspected by the judge
  transcript.jsonl  # raw SDK message stream
  session.md        # condensed transcript (assistant text, tool calls, Q&A)
  usage.json        # tokens, cost, duration, model
  judgment.json     # per-criterion {id, pass, evidence} + computed score
```

`results/` is disposable local output; don't commit it.

## Interpreting comparisons

- Judge verdicts are binary per criterion (pass/fail); weights come from
  `criteria.json` and are applied in code.
- With small N, single-criterion flips can be run-to-run variance. Treat a
  criterion as regressed when its pass rate drops across runs (e.g. 3/3 →
  0/3 or 1/3), not on a single flip; raise N when a result is ambiguous.
- `compare.mjs` also reports session token usage: abrasion should show input
  token savings at equal-or-better pass rates.

## Per-eval requirements

An eval is runnable once it has, next to `task.md` and `criteria.json`:

- `fixture/` — starting project tree (may be empty for from-scratch evals)
- `answers.md` — persona + canned answers for clarifying questions
  (only needed for interactive evals)

## Known caveats

- **Multi-step evals** (`migrate-incremental`, `migrate-multi-template`,
  `migrate-self-contained-bundle`) define several `## User prompt (run N)`
  steps, some requiring manual workspace edits between runs. The runner
  currently executes only step 1; later steps need a per-step setup hook
  (future work).
- **Parameterized evals** (`replica-source-fidelity`,
  `reskin-content-fidelity`) have placeholder URLs (`https://<target-site>`)
  in their prompts; they need concrete targets before they're runnable.
- **Live-network evals** (`extract-multipage` crawls stripe.com) depend on
  the target site being reachable and stable.

- Several criteria are stale relative to the 0.14.0 skill contracts — see
  "0.14.0 rescope notes" in `../README.md`. Expect known-stale failures until
  rescoped; the compare report is still valid because both labels face the
  same criteria.
- The suite pins procedure and artifacts, not visual quality (see
  `../README.md`), so abrasion of design-judgment prose needs a separate
  check.
