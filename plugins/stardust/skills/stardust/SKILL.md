---
name: stardust
description: Guided multi-page redesign of an existing website through a four-phase pipeline — extract (crawl and capture the current site), direct (set a visual direction), prototype (generate redesigned HTML), and migrate (emit a deployable static site). Tracks progress incrementally per page in stardust/state.json so redesigns are resumable. Delegates the per-page design craft (typography, spacing, color, layout, motion) to the impeccable skill. Use when the user wants to redesign, revamp, modernize, or restyle an existing site they can point to by URL, run the extract/direct/prototype/migrate flow, or resume a multi-page redesign or migration. Also routes the same-design migration flow (replica) and the donor-design flow (reskin). Not for designing a brand-new site from scratch or one-off single-component edits.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, playwright-cli on PATH, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
---

# stardust

## Operator card

| step | what runs | gate / outcome | writes |
|---|---|---|---|
| Setup 1 | impeccable presence check; `node skills/stardust/scripts/impeccable-version-check.mjs [--local <dir>]` (advisory) | impeccable is a hard dependency | — |
| Setup 2–4 | `PRODUCT.md` / `DESIGN.md` presence; read `stardust/state.json`; parse impeccable's `command-metadata.json` | — | — |
| Setup 5–7 | status ledger; project hygiene (`stardust/.gitignore`, root `.gitignore`, `.hlxignore`, `git check-ignore`); run lock + project root | `state.json` must not be ignored; a held lock → read-only | `stardust/status.jsonl`, `stardust/.gitignore`, `stardust/.work/run.lock` |
| Routing | no arg / resume → state report; sub-skill keyword → delegate; migration ask → § Two migration flows; freeform → intent reasoning | plan shown before any command (hands-off: recorded instead) | `state.json` flow keys |
| Freeform intent | § The "open and reasoned" principle, steps 1–6 | plan confirmation | `stardust/direction.md` |
| Hands-off | activation block (wave plan + stop point, commit policy); gate auto-resolution table; background waits; turn-end contract (chain after PASS); scoped per-phase commits | quality gates unchanged; hard blockers and owner-only rows still stop; a turn ends only on completion, blocker or a > 45-min wait | `state.json.handsOff` / `approvedChain`, `direction.md` activation line, `status.jsonl` `blocked` |
| Every write | provenance block; journal entry; validate-and-fix loop on human-facing HTML | clean validation pass | `stardust/journal.md`, `stardust/validation/<artifact>/<viewport>.png` |
| Phase close | checkpoint block (Completed / Verified / Next / On re-run), nothing after it | `end` line carries `next`; finished phases are never re-run | `status.jsonl` `end` + `next` |

| at step | read |
|---|---|
| Setup 3, 7, Routing | `reference/state-machine.md` § File: `stardust/state.json` · § State report · § Concurrency |
| Setup 5, Phase close | `reference/run-status.md` § Line shape · § Rules · § Phase close |
| Setup 6, Artifacts | `reference/artifact-map.md` § Versioning — what a clone holds · § Provenance shapes |
| Any shell loop, runner, delivery or probe | `reference/harness-quirks.md` (whole card, one page) |
| Routing (migration) | `reference/state-machine.md` § Flow keys |
| Freeform intent | `reference/intent-reasoning.md` § Procedure · `reference/intent-dimensions.md` § Reading a phrase · `reference/impeccable-command-map.md` § Common sequences |
| Hands-off | `reference/state-machine.md` § Hands-off keys |
| Hands-off (delegating) | `reference/fan-out.md` § Scope and type · § Worker contract · § Coordinator contract |
| Any image read, batch instrument, phase boundary | `reference/context-hygiene.md` § Image reads · § Runner reports and session hand-off |
| Per-page state | `reference/state-machine.md` § Page lifecycle states · § Stale flagging (content-aware) |
| Journal | `reference/journal-format.md` § Entry format · § Reading the journal at session start |
| Validation | `../extract/reference/playwright-recipe.md` § Capture list · `../prototype/reference/motion-validation.md` § Validation procedure |

Headings: Setup · Routing · Two migration flows · Hands-off mode · The "open and reasoned" principle · Per-page state and "stale on direction change" · Artifacts you read and write · Provenance · Journal rule · Validation rule · What stardust never does · References

You are operating the `stardust` skill: a guided redesign of an existing
website. The user's job is to say what they want; your job is to reason about
what that means, propose a plan, and execute it through a small set of
sub-commands that delegate the actual design work to **impeccable**.

## Setup (run before anything else)

1. **Verify impeccable is installed.** Stardust has a hard dependency on
   impeccable and ships no fallbacks. Look for the `impeccable` skill in
   the skill list the harness exposes, the project skill directories
   (`.claude/skills/`, `.agents/skills/`, `.cursor/skills/`,
   `.github/skills/`) or the harness's plugin cache (Claude Code:
   `~/.claude/plugins/cache/`; GitHub Copilot:
   `~/.copilot/installed-plugins/*/impeccable/skills/impeccable`). If it
   is not installed, stop and tell the user:
   > Stardust requires impeccable. Install it from
   > <https://github.com/pbakaus/impeccable> and re-run the command.

   **Version hint (advisory, never blocking).** Stardust deliberately pins
   NO impeccable version — the design craft should always be the current
   one — and no harness announces third-party plugin updates by
   default. So, once per session, run
   `node <plugin>/skills/stardust/scripts/impeccable-version-check.mjs`
   (`--local <impeccable-dir>` when impeccable lives in a harness skills
   directory) and surface its one output line verbatim when it reports a
   newer version — it prints the update command for that harness. Any
   other outcome (current, unknown, offline) is noise: do not mention it,
   never stop or degrade a run over it.
2. **Check the target-state files.** `PRODUCT.md` and `DESIGN.md` at the
   project root are stardust's *target* state; a directory listing tells
   whether they exist. Do not run impeccable's context loader
   (`scripts/impeccable context`) here — its directives serve impeccable's
   own flow, and it runs whenever stardust invokes an impeccable command.
3. **Read stardust's state.** Read `stardust/state.json` if present
   (schema: `reference/state-machine.md`) and note each page's lifecycle
   state.
4. **Read impeccable's command registry.** Parse
   `<harness>/skills/impeccable/scripts/command-metadata.json` — the
   single source of truth for the 24 impeccable commands; never hardcode
   them.
5. **Status ledger.** Every skill appends a line to `stardust/status.jsonl`
   at each phase start and end (`reference/run-status.md`).
6. **Project hygiene** (idempotent). Write `stardust/.gitignore` from
   `reference/stardust.gitignore` if absent; never edit a project's copy.
   In a git repo: root `.gitignore` covers `.env` / `.env.*` (managed
   `# >>> stardust` block), `.hlxignore` if present lists `stardust/`, and
   `git check-ignore -q stardust/state.json` must fail — if it passes,
   stop and name the rule. Offer, never write, LFS above 50 MB of tracked
   binaries under `stardust/` (`reference/artifact-map.md` § Versioning).
   Every shell loop, runner, delivery step and probe in the run follows
   `reference/harness-quirks.md`.
7. **Run lock and project root.** Read `stardust/.work/run.lock`
   (`reference/state-machine.md` § Concurrency → Session advisory lock).
   If it names a held run in another session: interactive, ask once —
   take over or proceed read-only; hands-off, proceed read-only, append
   `event: "blocked"` naming the holder to `status.jsonl`, and stop at
   the first write. When the requested project root is not the working
   directory's project, confirm before any write (hands-off: record it
   in `direction.md` and stop) and run this step in that root.

## Routing

Once setup is done, route on the user's input:

- **No argument.** Render the **state report** described in
  `reference/state-machine.md`: project state, per-page status table,
  recommended next command, with reasoning. Do not write anything.
  The same applies to any **resume** (a new session on a project with
  `stardust/state.json`, "continue", "where are we", a memory-driven
  resume). Start with the state report (it names the
  flow and the last gate numbers), then execute the last `status.jsonl`
  `next` **through its skill** — the procedure drives, not memory. A
  phase whose `end` line exists is neither re-run nor re-narrated; a
  deliberate re-run asks before replacing its outputs
  (`reference/run-status.md` § Phase close).
- **First word names a sub-skill.** Delegate to it and pass the
  remaining args through. Sub-skills are named by bare skill name below;
  Claude Code namespaces them as `stardust:<name>` (Skill tool), GitHub
  Copilot and other flattening harnesses expose the bare `<name>`, and a
  harness with no skill-invocation tool reads the sub-skill's `SKILL.md`
  and follows it inline. Never confuse the stardust `extract` / `audit`
  skills with impeccable's commands of the same name, always written
  `$impeccable <command>`. The master routes **all** sibling sub-skills:

  | keyword | owns |
  |---|---|
  | `extract` | crawl + capture the current site |
  | `direct` | resolve the visual direction |
  | `prototype` | per-page redesign prototypes |
  | `migrate` | full-site platform-agnostic static HTML |
  | `prepare-migration` | the migrate-prep cascade (prep phases, assets, dynamics gate) — **redesign flow only** |
  | `replica` | same-design migration (re-platform, keep the current design) — runs its own preserve-mode prep, then hands off to migrate/deploy/rollout |
  | `reskin` | byte-faithful content re-laid onto a separately defined donor design system |
  | `deploy` | one page → EDS blocks + DA delivery |
  | `rollout` | whole migrated site → EDS, with coverage + delivery gates |
  | `dynamics` | the dynamic surface of a migration — detect, classify, triage, implement, verify (APIs, search, forms, modals, media, tags, client-rendered, sheet data); invoked by the migration skills or standalone on a migrated site |
  | `diff` | prototype ↔ build fidelity probes (pixel + structural) |
  | `audit` | three-perspective site audit (design tensions, SEO/technical, LLM visibility) — scored report + findings ledger |
  | `qa` | read-only post-deploy QA sweep of the live site (routing, fidelity, rendering, visual regression, SEO, links, a11y, perf) — findings only, never fixes |
  | `uplift` | one-shot presales orchestrator (3 variants) |

  - `prototype --cinematic[=<register>]` layers a brand-faithful motion
    register on the static prototype (`skills/prototype/reference/motion-registers.md`).
  - `uplift` skips the extract/direct/prototype chain: one URL in,
    three differentiated variants out, one of them cinematic, no
    further user coordination (`skills/uplift/SKILL.md`).
- **Migration to EDS — pick ONE of two flows, never mix them.** See
  § Two migration flows below before answering any "how do I migrate X"
  question; the routing answer differs by whether the design is kept.
- **First word is anything else (a freeform phrase).** Treat it as a
  redesign intent. Load `reference/intent-reasoning.md` and follow the
  procedure step by step. **Do not execute any impeccable or stardust
  command before showing the resolved plan to the user** (under
  hands-off mode, the plan is recorded in `stardust/direction.md`
  instead of awaiting confirmation — see § Hands-off mode).

## Two migration flows — pick one, never mix

On any ask to migrate a site to AEM Edge Delivery (or any clean front
end), the FIRST question is whether the design is kept or changed; the
answer selects the flow, the downstream chain is shared.

- **Redesign while migrating:** `extract` → `direct` → `prototype`, or in
  one orchestrated step `prepare-migration` (the prep cascade with
  confirmation gates) → `migrate` → `deploy` (one-page pilot) /
  `rollout` (whole site).
- **Keep the current design (re-platform):** `replica` → `migrate` →
  `deploy` / `rollout`. `replica` **subsumes the prep cascade in preserve
  mode** (`extract --prep` is its Phase 1, direction preservation
  replaces `direct --prep`, gated archetype recreation replaces
  `prototype --prep`). **Never run `prepare-migration` before or after
  `replica`.**
- **New design from a donor, same content:** `reskin` — content is
  byte-gated, design comes from another live site or local prototypes.
- **Both migration flows carry the dynamic surface by default.** The
  pre-import gate (`prepare-migration` 4.5 / `replica` Phase 2, `migrate`
  as the safety net) runs the stardust `dynamics` skill Phases 1–3 so
  every dynamic surface gets a disposition before import; `rollout` D2
  implements the reproducible rows and `qa` replays parity. Never for
  redesign-only work (`uplift`, a bare `extract`).

**Choosing, and recording the choice.** Read the ask before any sub-skill
loads:

- **Keep-design phrases select `replica` without a question:** "exact
  replica", "1:1", "pixel-perfect", "faithful", "same design", "keep the
  current design", "as is", "re-platform only", or a direction phrase
  that pins every axis unchanged (`ia-fidelity: verbatim`, palette, type
  and density pinned).
- **Redesign phrases select the redesign flow:** "redesign", "modernise",
  "refresh", "new look", "rethink", "reimagine" — anything that moves a
  design axis.
- **Anything else** ("migrate X to EDS") asks the one keep-vs-redesign
  question — the only question this section asks. Hands-off does not
  ask: a keep-design phrase selects `replica`, otherwise `redesign`,
  recorded as a named assumption in `direction.md`.

Stamp the choice in `state.json` as `flow` / `flowChosenAt` / `flowSource`
(`reference/state-machine.md` § Flow keys) before delegating; the
sub-skills enforce it (`migrate`, `deploy`, `rollout` and a
migration-intent `extract` refuse a project with `state.json` and no
`flow`; `prepare-migration` refuses under `flow: replica`, `replica`
under `flow: redesign`). Switching is explicit — `--switch-flow` on
`replica` or `prepare-migration` — and marks the old flow's prototyped or
migrated pages stale (§ Per-page state).

**Planning aids belong to one flow.** Redesign: the `prepare-migration`
plan and gates, the canon, module catalogs, "learn the template, then
compile" plans. Keep-design: `replica`'s inconsistency register and
`progress.json`, the archetype gate ledgers, `rollout` waves. A redesign
plan inside a replica run — or the reverse — is a routing defect: refuse
it, or flag it in `direction.md` and hand back here. State the chosen
flow in the first response to a migration question, including that
`replica` needs no `prepare-migration` step.

## Hands-off mode

Activated by `--hands-off` on **any** stardust invocation, or by a user
phrase that says no one will answer: "fully hands-off", "no approval
gates", "run autonomously", "not monitoring", "never stop (asking)",
"do all of them" / "the full site" — never inferred from the harness or
the size of the ask. On activation, stamp
`state.json.handsOff: true` (`reference/state-machine.md` § Hands-off
keys), append an activation line quoting the phrase to
`stardust/direction.md`, and open the first reply with the fixed
**activation block**: the chosen flow; the roster cap as **wave 1 of a
written wave plan** with its stop point; "commits land at each phase
end without asking — hands-off overrides an ask-before-commit
preference for this run"; the decision register
(`reference/decisions.md`). The mode removes **waiting**, not
**validation**: provenance validation, the validation loop, fidelity,
delivery and optimize gates all run unchanged — hands-off changes *who
answers*, not *what must pass*.

Under hands-off, every interactive gate across the pipeline
auto-resolves:

| gate | hands-off resolution |
|---|---|
| `direct` clarifying questions | derive the answers from the captured evidence (`stardust/current/`), and state each as a **named assumption** in `direction.md` |
| `prototype` brief-confirmation waits | skip; proceed on the authored brief |
| prototype approval | granted by the agent's own judgment **only after all quality gates pass**; recorded as `approvedBy: "hands-off"` on the page's `approved` history entry |
| `prepare-migration` phase gates | behave as `--skip-confirm` |
| `rollout` | runs full-auto end-to-end |
| `dynamics` owner decisions (backend, tags, datasource ownership, locale scope) | ship the interim tier, record each decision by name in `dynamic-features.md` and the parity report, continue; regulated-pii forms stay blocked |

Defaults under hands-off (override only when the invocation says
otherwise):

- **One canonical direction.** No variant fan-out — commit to a
  single direction and record the rationale in `direction.md`.
- **Volume caps as reasoned proposals.** Default **100 pages overall,
  20 per template**; roster priority: header/footer-linked pages, then
  section landings, then a representative spread of detail pages per
  template. State the chosen caps in `direction.md`.
- **Delegate by file pointer, read by section.** A brief to a delegated
  agent names the files and sections it needs (`state.json`, the page's
  schema, the phase's SKILL.md sections); it never inlines reference docs.
  Reading is card-first: the coordinator reads a skill's operator card,
  never its body; before any read of a file over 20 KB it lists the
  headings and reads only the section the card names; a brief to a
  delegated agent names card rows, not files to read whole.
  Instruments that can stall run under their shipped deadline (replica
  `gate.sh`, `pixel-compare --timeout`), never under an agent-authored
  `sleep N; kill` loop; long steps write a progress file the coordinator
  polls. What a delegated agent writes, how it is polled, resumed once
  and finished from its progress file: `reference/fan-out.md` (every
  brief points at its § Worker contract).
- **Image reads.** Numbers first (`pixel-compare --json`, `crop-compare
  --json`, `anchor`, `row-profile`), then band crops — never a stitched
  capture whole (the viewer caps at 2,000 px tall), one image per turn,
  none re-read, none past ~80 % of the context —
  `reference/context-hygiene.md` § Image reads.
- **Scope and type of delegated agents.** One agent owns at most one
  archetype gate loop or three sibling pages; anything longer than ~20
  requests or launching a browser is a fresh-context agent with a
  file-pointer brief, and the coordinator dispatches and merges rather
  than authoring inline while workers run — `reference/fan-out.md`
  § Scope and type.
- **Wait discipline: never park the conversation past the prompt-cache
  window.** Anything expected to run longer than about 2 minutes — a gate
  round, a crawl, a batch push, a capture set, a delegated agent — runs
  in the background and writes a progress or
  summary file; never in the foreground, never under one long `sleep`.
  While it runs, do independent work; when there is none, check back
  with one short read of the progress file **at most every 4 minutes** —
  never a fixed `sleep` of 5 minutes or more, never a blocking "wait for
  the agent's output" call with a long timeout; write large files in
  ≤ 2 chunks and cap tool output (`| tail`, `--reporter=dot`). The number is the prompt
  cache's 5-minute idle window: at migration-size contexts every expiry
  re-writes the whole prefix at write price (field data: CHANGELOG
  0.22.2). Ending the turn to wait helps the user, not the cache, so
  prefer short checks for waits under ~45 minutes. (Claude Code:
  `run_in_background: true` on the shell call; the owner setting
  `promptCacheTtl: "1h"` stretches the window to an hour at 1.6× write
  price — worth it for any multi-hour session.)
- **Context hygiene.** Batch runners report a ranked class table and
  write `summary.json` + `summary.md`; nothing per-page is pasted into
  the conversation; after an edit re-read the changed range only; a long
  run hands off to a fresh session at each phase boundary and after the
  first compaction — `reference/context-hygiene.md`.
- **Commit at the end of each phase** when the project is a git repo.
  Stage only the paths this skill wrote (`stardust/`, the target files,
  the EDS project files it touched) — never `git add -A` or `git add .`;
  name any other modified file `git status` shows in the commit body and
  leave it unstaged (another session may own it).
  Before the FIRST such commit, re-run Setup step 6: a tracked `.env`
  poisons every later push (GH013 + history rewrite at deploy time).

**Turn-end contract.** A turn ends only on (a) run completion, (b) a
hard blocker or an owner-only row of the decision register, or (c) a
background wait longer than ~45 minutes (Wait discipline). A wave or
phase close is never a permitted end: it writes the journal entry, the
`status.jsonl` `end` line and the phase commit, then starts the next
planned step **in the same turn** — "Phase N done, next: …" followed by
silence is a defect. When the ask names a chain ("replica, then
deploy"), stamp `state.json.approvedChain` (§ Hands-off keys) and
continue after each PASS; a FAIL or a residual over the bar still
pauses, and a chained `deploy` stops at preview unless the ask said
publish. An unavoidable pause ends with the fixed block `Running: …` /
`Waiting on you: 1) …` / `Will proceed without you: …` and the pasteable
`next` command (`reference/run-status.md` § Phase close); two same-named
gates → one question naming both. Printed paths are `ls`-verified,
printed counts re-read from the artifact.

**Hard blockers remain stops.** An unreachable source site, an
expired `DA_TOKEN` that cannot be recovered, or a signal-absent brand
surface (no usable brand signal even after a re-run) are not judgment
calls — state the blocker precisely, append
`event: "blocked"` to `stardust/status.jsonl`, and halt. Never guess
around a hard blocker.

## The "open and reasoned" principle

Stardust ships no closed `intent → commands` lookup; every freeform
phrase is reasoned about in public:

1. Restate the phrase in stardust's dimensional vocabulary
   (`reference/intent-dimensions.md`).
2. Name the axes it moves, and in which direction.
3. Name what is underspecified; ask **at most two** clarifying questions.
4. Map the resolved direction to impeccable commands, citing each in
   `reference/impeccable-command-map.md`.
5. Show the plan before executing.
6. Afterwards record direction, axes, commands and reasoning in
   `stardust/direction.md` with a provenance block.

Worked examples: `reference/intent-examples.md`.

## Per-page state and "stale on direction change"

Pages have lifecycle states (`extracted | directed | prototyped | approved |
migrated`). When the direction changes after pages were prototyped or
migrated, **mark them stale; do not auto-re-run** — the user opts in
explicitly. Details in `reference/state-machine.md`.

## Artifacts you read and write

Stardust state lives under `stardust/`. Impeccable's `PRODUCT.md` /
`DESIGN.md` / `DESIGN.json` live at the project root and represent the
*target* state. The current (extracted) state lives under
`stardust/current/`. Full layout in `reference/artifact-map.md`.

**Write boundary.** Stardust writes to `stardust/`, the impeccable target
files at the project root, and the EDS project (only via `deploy`,
`rollout`, `dynamics`). Run-only files — logs, harness page, pre-renders,
script copies, drafts, probes — go under `stardust/.work/<skill>/`; the
root `scripts/` and `qa/` are not stardust's. Anything written elsewhere
is a bug in that skill.

**Versioning.** Everything under `stardust/` is committed except what
`reference/stardust.gitignore` lists (screenshots, the heavy asset and
gate folders, `.work/`, run residue, session state); per-directory table
and what a clone without `current/assets/` can do: `reference/artifact-map.md`
§ Versioning.

## Provenance

Every artifact stardust writes opens with a provenance block (first line
or first key): which sub-command wrote it, against which user input, what
was synthesized vs. authored, which artifacts were read. Format:
`reference/artifact-map.md`.

## Journal rule

`stardust/journal.md` is the chronological narrative layer — prompts,
decisions, open questions — that neither `state.json` (*what is*) nor
provenance (*why an artifact says what it says*) captures. **Maintain it
per `reference/journal-format.md`**: append an entry before ending any
turn that made a non-trivial write (any `direct`, `prototype`, `migrate`
or substantial iteration), its `Next:` being the phase's `status.jsonl`
`next` command; append-only — a wrong entry is corrected by a
new one, never edited; project-scoped and human-facing, at the level of
`PRODUCT.md`, not under `stardust/current/`; at the start of a new
session its last 3–5 entries are read with `state.json` for the "where
did we leave off" context the state machine lacks.

**Named deviations.** Any agent-authored crawler, compiler, importer,
wave driver or gate that replaces a skill phase is recorded in
`stardust/direction.md` as a **named deviation** — what it replaces, why
the shipped instrument did not serve, where the replacement lives — and
noted in the journal entry. An unrecorded parallel pipeline is a defect,
not initiative — its fidelity numbers are never comparable to the gate's.

## Validation rule

Every artifact stardust writes that a human will eyeball — proposed HTML,
brand-review.html, the migrated site — runs through a **recursive validate-
and-fix loop** before being marked done: only browser rendering verifies
*feature* correctness.

For HTML the user will see (prototypes, migrated pages, the brand-review
HTML):

1. Render in Playwright (file:// for static, or local dev server).
2. Capture at three viewports — desktop **1440×900**, tablet **768×1024**,
   mobile **390×844**: full-page screenshot; console errors + warnings;
   network failures (4xx / 5xx / aborted, missing assets); uncaught JS
   exceptions + unhandled rejections; layout sanity (no horizontal
   overflow, landmarks present and non-empty); a11y quick-pass (alt text,
   input labels, heading order, contrast on text-over-image);
   interaction smoke (card hover, scroll trigger, nav open/close, primary
   CTA reachable by keyboard).
3. **Fix every issue found and re-run the loop** until none remain or
   the fix needs user input — then surface the question and stop. Never
   report a task complete with known issues outstanding.
4. Save the final clean-pass screenshots to
   `stardust/validation/<artifact>/<viewport>.png`.

Per-sub-skill specifics: `extract/reference/playwright-recipe.md` (the
canonical recipe), `prototype/reference/motion-validation.md` (motion
gates), `prototype/SKILL.md` Phases 2.5–2.8 (critique / audit / adapt /
motion cascade).

## What stardust never does

- Invent design opinions that contradict impeccable's hard rules.
- Execute a redesign plan without showing it first (hands-off mode records
  the plan in `stardust/direction.md` instead of waiting — § Hands-off mode).
- Force a re-run on stale pages without explicit user opt-in.
- Crawl beyond the user's confirmed page cap (an explicit `--pages` list is itself the confirmed scope — listed pages are never dropped; the crawler warns rather than truncates past `--max`).
- Emit platform-specific output from `migrate` — it emits
  platform-agnostic static HTML; EDS conversion and delivery belong to
  `deploy` (one page) and `rollout` (whole site).

## References

- `reference/intent-dimensions.md` — the axes redesigns move along.
- `reference/intent-reasoning.md` — the procedure for handling a freeform phrase.
- `reference/intent-examples.md` — worked examples (8-12) of the reasoning style.
- `reference/impeccable-command-map.md` — when to reach for each of the 24 impeccable commands.
- `reference/state-machine.md` — page lifecycle, stale rules, state report format.
- `reference/artifact-map.md` — every file stardust reads or writes, with ownership, provenance shape and (§ Versioning) what is tracked.
- `reference/stardust.gitignore` — installed as `stardust/.gitignore` by Setup step 6.
- `reference/divergence-toolkit.md` — anti-mediocrity device (default-moves list, deterministic seed, font decks, role-naming rule) for `direct` and `prototype`.
- `reference/token-contract.md` — the `:root` CSS custom-property contract every prototype and migrated page exposes.
- `reference/data-attributes.md` — the structural `data-*` vocabulary on sections of every prototype and migrated page.
- `reference/journal-format.md` — `stardust/journal.md` entry format; the append-only narrative layer over the state machine.
- `reference/run-status.md` — the `stardust/status.jsonl` phase-transition contract every skill appends to; `next` and the phase-close block.
- `reference/fan-out.md` — the delegated-agent protocol: progress files, worker and coordinator liveness contracts.
- `reference/harness-quirks.md` — shell, runner, delivery, path, served-asset, local-QA and port rules the tool layer imposes.
- `reference/context-hygiene.md` — what enters the conversation: the image-read budget, ranked class reports, no per-page dumps, ranged re-reads, phase-boundary hand-off.
- `reference/learnings.md` — the per-run learnings ledger (`stardust/learnings.md`) rollout's report phase writes and maintainers harvest.

### Cinematic-feature references (cross-cutting)

Owned by `prototype/` because the cinematic feature is scoped to
prototype rendering, but cited by `direct` (when selecting a
register), `uplift` (when picking C's register), and `migrate`
(when copying motion assets through):

- `../prototype/reference/motion-registers.md` — the five motion registers and the heuristic that maps PRODUCT.md personality traits to one.
- `../prototype/reference/motion-stack.md` — technology choice (Lenis + CSS keyframes + rAF + IntersectionObserver) and bundle policy.
- `../prototype/reference/motion-attributes.md` — the `data-*` vocabulary the motion runtime consumes.
- `../prototype/reference/motion-runtime.md` — the canonical inline runtime script of every cinematic prototype.
- `../prototype/reference/motion-validation.md` § Pass 6 — cinematic-mode validation gates (Lenis boot, reduced-motion fallback, scroll-jack, three-position screenshots, register-match, motion C-cliff detector).

### Uplift-feature references

Owned by `uplift/`. Cited by master routing when delegating
`$stardust uplift <URL>`:

- `../uplift/SKILL.md` — one-shot presales orchestrator: extract → tension/trait identification → 3-variant direction → prototype × 3 → open + summarize.
- `../uplift/reference/what-if-candidates.md` — catalog of 8 worked captured-trait amplification candidates that B and C select from in Phase 2b — plus its § Extension rule admitting evidence-shaped `derived` candidates.
