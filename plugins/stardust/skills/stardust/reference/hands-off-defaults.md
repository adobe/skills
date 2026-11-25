# stardust:stardust: hands-off defaults

The text of this part of `skills/stardust/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

## Hands-off mode

Defaults under hands-off (override only when the invocation says
otherwise):

- **One canonical direction.** No variant fan-out — commit to a
  single direction and record the rationale in `direction.md`.
- **Volume caps as reasoned proposals, said out loud.** Default **100
  pages overall, 20 per template**; "all pages" (or `--all-pages`) in
  the invocation lifts them; a user-named N replaces both and orders
  link-first (`../extract/reference/ia-extraction.md` § Priority for the
  cap). Otherwise roster priority: (1) every page linked from
  the header and footer, (2) section landing/overview pages, (3) a
  representative spread of detail pages across all templates. The setup
  status line names the roster against the site (`roster 94 of 2,532
  discovered — cap 100/20`); a capped roster is never called the full
  site. Record the caps in `direction.md`.
- **First page first.** A full-site replica run delivers one page (home,
  or the one named) first: `../replica/reference/first-page-first.md`.
- **Captured pages stay in the roster.** Locale is never a reason to
  drop a captured page: every `state.json` row is delivered —
  duplicate-content locale shells ride the sibling tier of their twin;
  `D3-multilingual` is for language trees that were never captured.
- **Delegate by file pointer, read by section.** A brief to a delegated
  agent names the files and sections it needs (`state.json`, the page's
  schema, the phase's SKILL.md sections); it never inlines reference docs.
  Reference documents are read by heading and line range, not end to end
  (replica ships `skills/replica/scripts/section.mjs` for exactly this:
  `--list` for a document's outline, then one heading; it works on any
  Markdown file — a whole reference doc is 30–40k characters, the section
  a step needs is 2–4k, and one recorded session paid for three whole docs
  twice when their `cat` output overflowed and was re-read in full).
  Instruments that can stall run under their shipped deadline (replica
  `gate.sh`, `pixel-compare --timeout`) — never under an agent-authored
  `sleep N; kill` loop — and long steps write a progress file the
  coordinator polls instead of blocking on the agent. (Field evidence,
  2026-09: in one recorded run the two conversion agents the harness
  watchdog killed carried the fattest briefs and whole-document reads,
  and a lean re-dispatch finished the same pages; that conversion lost
  89 minutes to a blind wait and 30 to fixed sleeps.)
- **Wait discipline: never park the conversation past the prompt-cache
  window.** Anything expected to run longer than about 2 minutes — a gate
  round over several pages, a crawl, a batch push, a capture set, a
  delegated agent — runs in the background and writes a progress or
  summary file; the coordinator never runs it in the foreground and never
  covers it with one long `sleep`. While it runs, do independent work;
  when there is none, check back with one short read of the progress
  file **at most every 4 minutes** — never a fixed `sleep` of 5 minutes or
  more, and never a blocking "wait for the agent's output" call with a
  long timeout. The number is not taste: the prompt cache expires after
  5 idle minutes, and at the 500–900k-token contexts a migration reaches,
  every expiry re-writes the whole prefix at write price (12× a cached
  read). Field data, 48 sessions: a foreground wait of ≤ 4 minutes missed
  the cache in ~10 % of cases, ≥ 5 minutes in 85–87 %; 572 such
  agent-side waits re-wrote 325 M tokens — 46 % of everything those
  sessions wrote to the cache. Ending the turn to wait for a completion
  notification helps the user, not the cache: a notification that arrives
  after 5 minutes misses too (137 recorded), so prefer short checks for
  waits under ~45 minutes and end the turn only when the wait is longer
  or the user should decide. (Claude Code: `run_in_background: true` on
  the shell call, the harness posts a task notification when it exits;
  `promptCacheTtl: "1h"` in settings.json stretches the window to an hour
  at 1.6× write price — an owner setting, worth it for any multi-hour
  session.)
  The harness-neutral form of the same rule is replica's `run-bg.mjs`:
  `start` detaches the instrument, `wait` returns within `--max` (default
  100 s, ceiling 110 s — inside the shell tool's ~2-minute default timeout,
  which applies only to a call that declares none) with verdict lines
  only, exit 75 = still going, `wait` again as the NEXT call — never in a
  shell loop, never after a `sleep`. The rule binds the main agent as it
  binds subagents: one long instrument in the foreground, or two long
  instruments as parallel tool calls in one turn, is the same blocked step
  (recorded: a 338 s main-agent turn cost one full cache re-write).
- **One shell, one working directory.** The harness's shell keeps its
  working directory from one tool call to the next: a `cd` inside a
  command moves every later command with it, and a path written from
  the project root then fails from wherever the previous call ended.
  Write paths from the project root (or absolute), and confine any `cd`
  to a subshell — `(cd stardust/current && …)`. (Field evidence,
  2026-09: one `cd` into the capture directory failed the next three
  reads and cost a re-run turn.)
- **Author large files in parts.** Write the skeleton, then append in
  edits of roughly 150 lines or less, so no single turn generates for
  longer than the prompt cache lives (about five minutes); a turn that
  outruns it leaves the next request with a cold cache and re-writes
  the whole context. (Field evidence, 2026-09: in one recorded run two
  such turns — the brand documents written in one go at the end of
  extract, and a first prototype's whole HTML and CSS in one write —
  each cost a full re-write of a ~200k-token context; an earlier run
  re-wrote 513k and 694k the same way. No compaction was involved; the
  sessions simply outran the cache lifetime inside one generation.)
- **Commit at the end of each phase** when the project is a git repo.
  Before the FIRST such commit, re-run Setup step 6 — the first commit
  lands at the end of the audit phase, long before deploy's SKILL.md is
  read, and a tracked `.env` poisons every later push (GH013 + history
  rewrite at deploy time).
