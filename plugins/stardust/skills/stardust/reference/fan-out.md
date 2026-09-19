# Fan-out protocol — delegated agents

The liveness contract between a coordinator (the session running a
stardust skill) and the agents it delegates to. It binds every skill
that fans out — deploy Step 7 block agents, replica archetype
recreation, rollout waves, migrate page batches — and every brief a
coordinator writes. The master skill's § Hands-off mode holds the
coordinator's wait discipline; this file adds only what happens on the
worker side and what the coordinator does when a worker dies.

## When to read what

- § Worker contract — paste its five rules into every brief (by pointer: "follow `fan-out.md` § Worker contract"); read before starting work as a delegated agent.
- § Coordinator contract — before dispatching, and on every `failed` / `stalled` / lost-transcript notification.
- § Progress files — the path convention both sides write and read.
- § Scope and type of delegated agents — when deciding how many agents, how much each owns and whether it inherits the conversation.

## Progress files

- Per-agent log: `stardust/.work/<skill>/progress/<slug>.log` — one line
  appended after every step (`<ISO ts> <step> <ok|fail> <one-line detail>`).
  `<slug>` is the agent's unit of work (archetype, cluster, page).
- Per-agent ledger: where the phase keeps a ledger (`progress.json` in
  replica, the coverage/delivery ledgers in rollout), the agent writes
  its own `progress-<slug>.json` beside it and never edits the shared
  file; the coordinator merges (§ Coordinator contract).
- Driver progress: a batch driver (deploy-batch, crawl, verify, gate-batch)
  writes `stardust/.work/<skill>/<driver>.progress.json` and ends with one
  `SUMMARY` line (`skills/stardust/scripts/progress.mjs`) — poll that, not its log.
- Everything under `stardust/.work/` is run residue and untracked
  (master § Artifacts, write boundary).

## Worker contract

A delegated agent, in this order:

1. **Skeleton first.** Write the primary artefact as a skeleton before
   doing any work on it — the SPEC, ledger, report or page list with
   its headings and empty rows — then append or fill in. A transcript
   that dies at minute 40 leaves a readable artefact, not nothing.
2. **Append after every step.** One line to the per-agent log after
   each step (a page converted, a gate round, a batch pushed) and, where
   the phase has one, the per-agent `progress-<slug>.json` updated. The
   log is the only liveness signal the coordinator has.
3. **Wait discipline applies inside the agent.** Anything over about two
   minutes runs in the background with its own progress file; the agent
   checks with short reads, never a blocking read (master § Hands-off
   mode → Wait discipline). Never a fixed `sleep` — not to wait for a
   dev server or a preview to be ready (poll it in short reads), not to
   stagger against sibling agents (staggering is the coordinator's job).
4. **No model-authored file over ~200 KB.** Reports, contact sheets,
   inventories or HTML with embedded images are produced by a script
   that references files by path; the agent writes the script call, not
   the bytes. A model-written 200 KB+ file is the step that kills the
   transcript.
5. **Hand back by pointer.** The final report is about 1 KB: the
   verdict line, the paths of the artefacts and the ledger, what is
   left. Details, per-page rows and probe output stay in the ledger and
   log; nothing is pasted into the hand-back.

## Coordinator contract

- **Stagger dispatch yourself.** Launch agents a few seconds apart from
  the coordinator's turn; never ask workers to `sleep` into a stagger.
- **Poll the progress files, per the wait discipline.** Read the
  per-agent log with one short read at most every 4 minutes; a log that
  has not grown across **two consecutive polls** is a stall, whatever the
  harness says.
- **On `failed` or `stalled`: resume once.** Re-dispatch the same slug
  with the brief "continue from disk in small steps: read your
  `progress/<slug>.log`, skip every step it marks `ok`, append after
  each step". The resumed agent re-reads its own artefacts, not the
  coordinator's history.
- **On a second failure, or a lost transcript: spawn a finisher.** A
  finisher's brief *is* the progress file — the log, the skeleton
  artefact, the remaining steps. Never re-author the work from the
  coordinator's memory and never hand the finisher the dead agent's
  original brief; a stall on two silent polls counts as a failure here.
- **Merge is the lead's step.** After each hand-back the coordinator
  folds `progress-<slug>.json` into the phase's `progress.json` (or
  ledger) and appends the phase's `status.jsonl` line; workers never
  append to a shared file.
- **Record deaths.** Every failure, stall, respawn and finisher is one
  line in the journal entry for the phase, with the slug.

## Scope and type of delegated agents

Cost scales with requests per agent × context per request; the scope cap
is the primary lever, the agent type the secondary one.

- **Scope.** One agent owns at most one archetype gate loop or up to
  three sibling pages. Longer work is split into successive agents that
  resume from the ledger (§ Coordinator contract), not one long-lived
  agent.
- **Type.** Any agent expected to run more than ~20 requests or to
  launch a browser is a **fresh-context agent** — it inherits nothing,
  and its brief is a file-pointer brief of at most ~4 k tokens:
  `state.json`, the page list, the ledger and progress paths, the one
  operator-card row it needs (Claude Code: the `general-purpose`
  subagent type). An agent that **inherits the conversation** is
  reserved for tasks that need the parent's history and finish in a few
  turns (Claude Code: a fork); it never runs a gate loop or a batch.
- **Coordinator stays thin.** While workers run, the coordinator never
  authors blocks, encoders or foundation files inline; foundation work
  is its own dispatched worker, and the coordinator merges.
- **One capture, many readers.** Extract runs once; parallel audit,
  prepare and replica agents read `stardust/current/` (the reuse rule in
  `../audit/SKILL.md` § Setup).
