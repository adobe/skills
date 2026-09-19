# Run status — `stardust/status.jsonl`

A deterministic progress surface for a stardust run. Every stardust
skill appends one JSON line to `stardust/status.jsonl` at each phase
start and end, so any harness — a Claude Code session, the stardust
app, CI — can tail the run without parsing model output. Progress is
a file contract, not a model-emitted milestone.

## Line shape

One JSON object per line (JSONL — no wrapping array, no pretty-print):

```json
{ "ts": "2026-07-02T14:03:11Z", "skill": "stardust:migrate", "phase": "render", "event": "start" }
{ "ts": "2026-07-02T14:09:47Z", "skill": "stardust:migrate", "phase": "render", "event": "end", "detail": "12 pages rendered", "artifact": "stardust/migrated/", "next": "$stardust deploy home" }
{ "ts": "2026-07-02T14:11:02Z", "skill": "stardust:rollout", "phase": "C-deliver", "event": "blocked", "detail": "DA_TOKEN expired (401) — ledger checkpointed, awaiting re-auth" }
{ "ts": "2026-07-02T09:12:40Z", "skill": "stardust:stardust", "phase": "setup", "event": "blocked", "detail": "repo creation denied by the permission layer", "owner": "gh repo create <org>/sdt-<slug> --template adobe/aem-boilerplate --private" }
```

| field | required | contents |
|---|---|---|
| `ts` | yes | ISO 8601 timestamp |
| `skill` | yes | the skill writing the line (`stardust:extract`, `stardust:deploy`, …) |
| `phase` | yes | the skill's own phase name, as its SKILL.md names it |
| `event` | yes | `start` \| `end` \| `blocked` |
| `detail` | no | one human-readable line (counts, blocker reason) |
| `artifact` | no | path to the phase's primary output, when one exists; on the `start` line of a long step, its progress or log file |
| `next` | on `end` | the one pasteable command that continues the run; allowed on `blocked` and on the `start` line of a long-running phase |
| `owner` | no | on `blocked` only: the exact command the owner runs to unblock — the `Blocked on owner:` line in the state report, journal and turn-ending reply is rendered from it (master § Hands-off mode) |

## Rules

- **Append-only, never rewritten.** A correction is a new line, not an
  edit of history.
- **Absent file = created on first write.** No setup step owns
  creation; the first skill to reach a phase boundary creates it.
- **Failures still emit.** A phase that halts appends
  `event: "blocked"` with the reason in `detail` *before* stopping —
  the ledger never goes silent on the failure path.
- **One line per phase start, one per end.** No intermediate spam;
  per-page progress lives in each phase's own ledgers (e.g., rollout's
  `coverage/pages.json`). The `start` line of any step expected to run
  over ~2 minutes is written *before* the step, with `artifact` naming
  the progress or log file the step appends to.
- **The phase `start` line carries the session lock.** Before the
  first `start` line run
  `node skills/stardust/scripts/run-lock.mjs acquire --skill <name>`;
  before every later phase line `refresh --skill <name>`; after the
  run's last `end` line `release` (`state-machine.md` § Concurrency →
  Session advisory lock).
- **Harness-agnostic.** Plugin skills must never reference
  harness-specific progress mechanisms (no `emit_milestone`, no
  session APIs). `stardust/status.jsonl` is the only progress
  contract; anything that wants milestones tails this file.

## Phase close

Every phase `end` line carries `next`; the report that closes the phase
ends with this block and nothing after it:

```
Completed: <phase> — <one-line result with the numbers re-read from the artifact>
Verified:  <what was checked and how — paths ls-verified>
Next:      <one verbatim, pasteable command>
On re-run: <what is skipped because its `end` line exists>
```

The journal entry's `Next:` line is the same command as `next`
(`journal-format.md` § Entry format). On resume, the master skill
executes the last `next`; a phase whose `end` line exists is neither
re-run nor re-narrated — a deliberate re-run asks before replacing its
outputs. Under hands-off the block is written and the next step starts
in the same turn (master § Hands-off mode → Turn-end contract).

## Long-running steps

Master § Hands-off mode sets the wait rule (background plus a progress
file, short periodic checks, end the turn only for long waits); the
rationale: the prompt cache expires after 5 idle minutes, and at the
contexts a migration reaches every expiry re-writes the whole prefix at
write price; a completion notification that arrives after 5 minutes
misses the window too, so ending the turn helps the user, not the cache.
The progress file a long step writes is the thing to poll — `status.jsonl`
for phase boundaries, the driver's `stardust/.work/<skill>/<driver>.progress.json`
inside a phase (`node skills/stardust/scripts/progress.mjs read <file>`; the
driver's last stdout line is `SUMMARY <driver> ok=<n> failed=<n> exit=<code> …`
— `../../deploy/da-deploy-protocol.md` § Delivery pipeline). Output caps:
write large files in ≤ 2 chunks and cap tool output (`| tail`,
`--reporter=dot`). Claude Code levers: `run_in_background: true` on the shell call
(the harness posts a task notification when it exits);
`promptCacheTtl: "1h"` in settings.json stretches the window to an hour
at 1.6× write price — an owner setting, worth it for any multi-hour
session.

Unlike other stardust artifacts, `status.jsonl` carries no provenance
block — each line is self-describing via `ts` + `skill`, and the
append-only rule replaces the overwrite protection provenance
normally provides.
