---
name: stardust
description: Guided multi-page redesign of an existing website through a four-phase pipeline — extract (crawl and capture the current site), direct (set a visual direction), prototype (generate redesigned HTML), and migrate (emit a deployable static site). Tracks progress incrementally per page in stardust/state.json so redesigns are resumable. Delegates the per-page design craft (typography, spacing, color, layout, motion) to the impeccable skill. Use when the user wants to redesign, revamp, modernize, or restyle an existing site they can point to by URL, run the extract/direct/prototype/migrate flow, or resume a multi-page redesign or migration. Also routes the same-design migration flow (replica) and the donor-design flow (reskin). Not for designing a brand-new site from scratch or one-off single-component edits.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, playwright-cli on PATH, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
metadata:
  impeccable: required
---

# stardust

## Operator card

| step | what runs | gate / outcome | writes |
|---|---|---|---|
| Setup 1 | read the skill's `metadata.impeccable` level; unless `none`: `node skills/stardust/scripts/impeccable-version-check.mjs --probe --state stardust/state.json [--local <dir>]` (advisory) | `required` stops if missing; `optional` degrades; `none` skips 1 and 4 | `state.json.impeccable` |
| Setup 2–4 | `PRODUCT.md` / `DESIGN.md` presence; read `stardust/state.json`; parse impeccable's `command-metadata.json` | — | — |
| Setup 5–8 | status ledger; project hygiene (`stardust/.gitignore`, root `.gitignore`, `.hlxignore`, `git check-ignore`); `node skills/stardust/scripts/run-lock.mjs check` + project root; credentials lookup on migration-bound asks | `state.json` not ignored; `check` exit 3 (held) → read-only; no 401 blocker before the lookup ran | `stardust/status.jsonl`, `stardust/.gitignore`, `stardust/.work/run.lock`, `state.json.credentials` |
| Routing | no arg / resume → state report; sub-skill keyword → delegate; migration ask → § Two migration flows; freeform → intent reasoning | plan shown before any command (hands-off: recorded instead) | `state.json` flow keys |
| Freeform intent | § The "open and reasoned" principle, steps 1–6 | plan confirmation | `stardust/direction.md` |
| Hands-off | activation block (wave plan + stop point, commit policy); gate auto-resolution + decision defaults; transport preflight; background waits; turn-end contract (chain after PASS); scoped per-phase commits | quality gates unchanged; hard blockers and owner-only rows still stop; denied privileged action → ask once, `Blocked on owner:`; turn ends only on completion, blocker, > 45-min wait | `state.json.handsOff` / `approvedChain`, `direction.md` activation line, `status.jsonl` `blocked` (+ `owner`) |
| Every write | provenance block; journal entry; validate-and-fix loop on human-facing HTML | clean validation pass | `stardust/journal.md`, `stardust/validation/<artifact>/<viewport>.png` |
| Phase close | checkpoint block (Completed / Verified / Next / On re-run), nothing after it | `end` line carries `next`; finished phases are never re-run | `status.jsonl` `end` + `next` |

| at step | read |
|---|---|
| Setup 3, 7, Routing | `reference/state-machine.md` § File: `stardust/state.json` · § State report · § Concurrency |
| Setup 5, Phase close | `reference/run-status.md` § Line shape · § Rules · § Phase close |
| Setup 6, Artifacts | `reference/artifact-map.md` § Versioning · § Provenance shapes |
| Any shell loop, runner, delivery or probe | `reference/harness-quirks.md` (whole card) |
| Setup 1, 8 | `reference/harness-permissions.md` § Two classes · `reference/state-machine.md` § Impeccable key · § Credentials key |
| Routing (migration) | `reference/state-machine.md` § Flow keys |
| Freeform intent | `reference/intent-reasoning.md` § Procedure · `reference/intent-dimensions.md` § Reading a phrase · `reference/impeccable-command-map.md` § Common sequences |
| Hands-off | `reference/state-machine.md` § Hands-off keys · `reference/decisions.md` § Default rows · `reference/harness-permissions.md` § Privileged-action preflight · `reference/run-status.md` § Long-running steps |
| Hands-off (delegating) | `reference/fan-out.md` § Scope and type · § Worker contract · § Coordinator contract |
| Any image read, batch instrument, phase boundary | `reference/context-hygiene.md` § Image reads · § Runner reports and session hand-off |
| Per-page state | `reference/state-machine.md` § Page lifecycle states · § Stale flagging (content-aware) |
| Journal | `reference/journal-format.md` § Entry format · § Reading the journal at session start |
| Phase close / hand-off | `reference/handoff-report.md` § Gate table first |
| Validation | `../extract/reference/playwright-recipe.md` § Capture list · `../prototype/reference/motion-validation.md` § Validation procedure |

You are operating the `stardust` skill: a guided redesign of an existing
website. The user says what they want; you reason about what that means,
propose a plan, and execute it through a small set of sub-commands that
delegate the actual design work to **impeccable**.

## Setup (run before anything else)

1. **Resolve the impeccable dependency level.** Read the invoked skill's
   frontmatter `metadata.impeccable` (`required` | `optional` | `none`;
   absent counts as `required`; the master itself is `required` for its
   freeform-intent route). `none` → skip this step and step 4, noting
   `impeccable: skipped` in the skill's first `status.jsonl` line.
   Otherwise locate impeccable — once per session run
   `node <plugin>/skills/stardust/scripts/impeccable-version-check.mjs
   --probe --state stardust/state.json` (`--local <dir>` for a skills
   directory): it resolves the installed skill dir, records it as
   `state.json#impeccable` (`reference/state-machine.md` § Impeccable
   key) and prints one advisory line per copy — surface it verbatim only
   for a newer version or a `drift:` line; never stop or degrade over it.
   Sub-skills read `state.json#impeccable.skillDir`, never re-locate it.
   Under a permission layer read `reference/harness-permissions.md` § Two
   classes first. If it is absent, `required` skills stop and tell the
   user:
   > Stardust requires impeccable. Install it from
   > <https://github.com/pbakaus/impeccable> and re-run the command.

   `optional` skills note `impeccable: absent` there and continue on their
   degrade path.
2. **Check the target-state files.** `PRODUCT.md` and `DESIGN.md` at the
   project root are the *target* state; check whether they exist. Do not
   run impeccable's context loader here — impeccable runs it itself on
   every command.
3. **Read stardust's state.** `stardust/state.json` if present
   (`reference/state-machine.md`); note each page's lifecycle state.
4. **Read impeccable's command registry** (skipped when the level is
   `none`): `<state.json#impeccable.skillDir>/scripts/command-metadata.json`,
   the single source of truth — never hardcode commands.
5. **Status ledger.** Every skill appends a line to `stardust/status.jsonl`
   at each phase start and end (`reference/run-status.md`).
6. **Project hygiene** (idempotent). Write `stardust/.gitignore` from
   `reference/stardust.gitignore` if absent; never edit a project's copy.
   In a git repo: root `.gitignore` covers `.env`, `.env.*` and
   `.claude/settings.local.json` (managed `# >>> stardust` block),
   `.hlxignore` if present lists `stardust/`, and `git check-ignore -q
   stardust/state.json` must fail — if it passes, stop and name the rule.
   Offer (never write) LFS above 50 MB of tracked binaries
   (`reference/artifact-map.md` § Versioning). Every shell loop, runner,
   delivery step and probe follows `reference/harness-quirks.md`.
7. **Run lock and project root.** Run
   `node skills/stardust/scripts/run-lock.mjs check` (`--session <id>`
   when you hold one; `reference/state-machine.md` § Concurrency →
   Session advisory lock). Exit 3 = another live session holds the run:
   interactive, ask once — take over (`acquire --force`) or go
   read-only; hands-off, go read-only, append `event: "blocked"` quoting
   the `Active run:` line, stop at the first write. A requested project
   root outside the working directory's project is confirmed before any
   write (hands-off: record in `direction.md`, stop) and checked with
   `check --root <that root>`.
8. **Credentials** — on a migration ask or any invocation that can reach
   `deploy` / `rollout` (keyed on the ask; `flow` is stamped later): run
   the lookup in `reference/state-machine.md` § Credentials key, write
   `state.json.credentials`. Never declare a 401 blocker before it ran;
   `--token-env` consumers default to `credentials.siteTokenEnv`.

## Routing

Route on the user's input:

- **No argument.** Render the **state report** described in
  `reference/state-machine.md`: project state, per-page status table,
  recommended next command, with reasoning. Do not write anything.
  The same applies to any **resume** (a new session on a project with
  `stardust/state.json`, "continue", "where are we", a memory-driven
  resume): state report first (it names the flow and the last gate
  numbers), then execute the last `status.jsonl` `next` **through its
  skill** — the procedure drives, not memory. A phase whose `end` line
  exists is neither re-run nor re-narrated; a deliberate re-run asks
  before replacing its outputs (`reference/run-status.md` § Phase close).
- **First word names a sub-skill.** Delegate to it, passing the
  remaining args. Sub-skills are named by bare skill name below; Claude
  Code namespaces them as `stardust:<name>` (Skill tool), GitHub Copilot
  and other flattening harnesses expose the bare `<name>`, and a harness
  with no skill-invocation tool reads the sub-skill's `SKILL.md` and
  follows it inline. Never confuse the stardust `extract` / `audit`
  skills with impeccable's same-named commands, always written
  `$impeccable <command>`. The master routes **all** sibling sub-skills:

  | keyword | owns |
  |---|---|
  | `extract` | crawl + capture the current site |
  | `direct` | resolve the visual direction |
  | `prototype` | per-page redesign prototypes |
  | `migrate` | full-site platform-agnostic static HTML |
  | `prepare-migration` | the migrate-prep cascade — **redesign flow only** |
  | `replica` | same-design migration — its own preserve-mode prep, then migrate/deploy/rollout |
  | `reskin` | byte-faithful content re-laid onto a separately defined donor design system |
  | `deploy` | one page → EDS blocks + DA delivery |
  | `rollout` | whole migrated site → EDS, with coverage + delivery gates |
  | `dynamics` | the dynamic surface of a migration — detect, classify, triage, implement, verify; invoked by the migration skills or standalone |
  | `diff` | prototype ↔ build fidelity probes (pixel + structural) |
  | `audit` | three-perspective site audit (design, SEO/technical, LLM visibility) — scored report + findings ledger |
  | `qa` | read-only post-deploy QA sweep of the live site — findings, never fixes |
  | `uplift` | one-shot presales orchestrator (3 variants) |

  - `prototype --cinematic[=<register>]` layers a brand-faithful motion
    register on the static prototype (`skills/prototype/reference/motion-registers.md`).
  - `uplift` skips the extract/direct/prototype chain: one URL in, three
    variants out (one cinematic), no further coordination.
- **Migration to EDS — pick ONE of two flows, never mix them.** See
  § Two migration flows before answering any "how do I migrate X"
  question; the answer differs by whether the design is kept.
- **First word is anything else (a freeform phrase).** Treat it as a
  redesign intent: load `reference/intent-reasoning.md` and follow its
  procedure. **Do not execute any impeccable or stardust command before
  showing the resolved plan to the user** (hands-off records the plan in
  `stardust/direction.md` instead — § Hands-off mode).

## Two migration flows — pick one, never mix

On any ask to migrate a site to AEM Edge Delivery (or any clean front
end), the FIRST question is whether the design is kept or changed; the
answer selects the flow; the downstream chain is shared.

- **Redesign while migrating:** `extract` → `direct` → `prototype`, or
  in one step `prepare-migration` (the prep cascade with confirmation
  gates) → `migrate` → `deploy` (one-page pilot) / `rollout` (site).
- **Keep the current design (re-platform):** `replica` → `migrate` →
  `deploy` / `rollout`. `replica` **subsumes the prep cascade in preserve
  mode** (`extract --prep` is its Phase 1; direction preservation and
  gated archetype recreation replace `direct --prep` / `prototype
  --prep`). **Never run `prepare-migration` before or after `replica`.**
- **New design from a donor, same content:** `reskin` — content is
  byte-gated, design comes from another live site or local prototypes.
- **Both migration flows carry the dynamic surface by default.** The
  pre-import gate (`prepare-migration` 4.5 / `replica` Phase 2, `migrate`
  as the safety net) runs `dynamics` Phases 1–3 so every dynamic surface
  has a disposition before import; `rollout` D2 implements the
  reproducible rows, `qa` replays parity. Never for redesign-only work
  (`uplift`, a bare `extract`). A chain that ends at `deploy` (one-page
  pilot, no rollout) runs dynamics Phases 4–5 standalone before the pilot
  is declared done (`../dynamics/SKILL.md` § When it runs).

**Choosing the flow.** Read the ask before any sub-skill loads:

- **Keep-design phrases select `replica` without a question:** "exact
  replica", "1:1", "pixel-perfect", "faithful", "same design", "keep the
  current design", "as is", "re-platform only", or a direction phrase
  that pins every axis (`ia-fidelity: verbatim`, palette, type, density).
- **Redesign phrases select the redesign flow:** "redesign", "modernise",
  "refresh", "new look", "rethink" — anything that moves a design axis.
- **Anything else** ("migrate X to EDS") asks the one keep-vs-redesign
  question — the only question this section asks. Hands-off does not
  ask: a keep-design phrase selects `replica`, otherwise `redesign`,
  recorded as a named assumption in `direction.md`.

Stamp the choice in `state.json` as `flow` / `flowChosenAt` / `flowSource`
before delegating; the sub-skills' guards (no `flow` → refuse; wrong
flow → refuse) and the explicit `--switch-flow`, which marks the old
flow's pages stale, are defined in `reference/state-machine.md` § Flow
keys.

**Planning aids belong to one flow.** Redesign: the `prepare-migration`
plan and gates, the canon, module catalogs, "learn the template, then
compile" plans. Keep-design: `replica`'s inconsistency register and
`progress.json`, the archetype gate ledgers, `rollout` waves. A redesign
plan inside a replica run — or the reverse — is a routing defect: refuse
it, or flag it in `direction.md` and hand back here. The first response
to a migration question states the chosen flow and that `replica` needs
no `prepare-migration` step.

## Hands-off mode

Activated by `--hands-off` on **any** stardust invocation, or by a user
phrase that says no one will answer: "fully hands-off", "no approval
gates", "run autonomously", "not monitoring", "never stop (asking)",
"do all of them" / "the full site" — never inferred from the harness or
the size of the ask. On activation, stamp `state.json.handsOff: true`
(`reference/state-machine.md` § Hands-off keys), append an activation
line quoting the phrase to `stardust/direction.md`, and open the first
reply with the fixed **activation block**: the chosen flow; the roster
cap as **wave 1 of a written wave plan** with its stop point; "commits
land at each phase end without asking — hands-off overrides an
ask-before-commit preference for this run"; the open owner-only
decisions (`reference/decisions.md`). The mode removes **waiting**, not
**validation**: every quality gate runs unchanged — hands-off changes *who answers*, not *what
must pass*. Every interactive gate auto-resolves:

| gate | hands-off resolution |
|---|---|
| `direct` clarifying questions | derive from the captured evidence (`stardust/current/`); state each as a **named assumption** in `direction.md` |
| `prototype` brief-confirmation waits | skip; proceed on the authored brief |
| prototype approval | granted by the agent's own judgment **only after all quality gates pass**; recorded as `approvedBy: "hands-off"` on the page's `approved` history entry |
| `prepare-migration` phase gates | behave as `--skip-confirm` |
| `rollout` | runs full-auto end-to-end |
| `dynamics` owner decisions (backend, tags, datasource ownership, locale scope) | ship the interim tier, record each by name in `dynamic-features.md` § Decision batch and the parity report, continue; regulated-PII forms stay blocked |
| replica/reskin impeccable `ignore-file` consent (`impeccable-ignores.mjs --files`) | auto-resolve: choosing a keep-design flow IS the decision; the direction/mapping record line says `resolved by: hands-off` |
| plan-time decisions (`reference/decisions.md` § Default rows) | apply the default row, print the open rows in the first reply; publish stays preview-only — live is an explicit `--publish` run on gate PASS or an owner-decided row (D1, D16); only an owner-only row halts the work it gates |

Defaults (override only when the invocation says otherwise):

- **One canonical direction.** No variant fan-out — one direction, its
  rationale recorded in `direction.md`.
- **Volume caps as reasoned proposals.** Default **100 pages overall,
  20 per template**; roster priority: header/footer-linked pages, section
  landings, then a representative spread of detail pages per template.
  State the chosen caps in `direction.md`.
- **Delegate by file pointer, read by section.** A brief to a delegated
  agent names files and sections (`state.json`, the page's schema, the
  phase's SKILL.md sections) — card rows, never whole files or inlined
  reference docs. The coordinator reads a skill's operator card, never
  its body, and before reading any file over 20 KB lists the headings
  and reads only the section the card names. Stall-prone instruments run
  under their shipped deadline (replica `gate.sh`, `pixel-compare
  --timeout`), never an agent-authored `sleep N; kill` loop; long steps
  write a progress file the coordinator polls. Worker contract (briefs
  point at it): `reference/fan-out.md` § Worker contract.
- **Image reads.** Numbers first, then band crops; never a stitched
  capture whole — `reference/context-hygiene.md` § Image reads.
- **Scope and type of delegated agents.** Scope cap first, fresh-context
  workers by default, the coordinator dispatches and merges —
  `reference/fan-out.md` § Scope and type of delegated agents.
- **Wait discipline: never park the conversation past the prompt-cache
  window.** Anything over about 2 minutes (gate round, crawl, batch
  push, delegated agent) runs in the background and writes a progress
  file — never in the foreground, never under one long
  `sleep`. Do independent work meanwhile; otherwise check the progress
  file **at most every 4 minutes** (never a fixed `sleep` ≥ 5 minutes,
  never a blocking wait on the agent's output), and end the turn only for
  waits over ~45 minutes or a user decision. Write large files in ≤ 2
  chunks and cap tool output (`| tail`, `--reporter=dot`). Rationale and
  Claude Code levers: `reference/run-status.md` § Long-running steps.
- **Context hygiene.** Class tables in the conversation, per-page rows
  in files, hand-off at phase boundaries — `reference/context-hygiene.md`
  § Runner reports and session hand-off.
- **Commit at the end of each phase** when the project is a git repo;
  the phase-close message is the hand-off shape in
  `reference/handoff-report.md`. Stage only the paths this skill wrote
  (`stardust/`, the target files, the EDS project files it touched) —
  never `git add -A` or `git add .`; name any other modified file `git
  status` shows in the commit body and leave it unstaged (another session
  may own it). Re-run Setup step 6 before the FIRST such commit — a
  tracked `.env` poisons every later push.
- **Transports and privileged actions first; a denial is not a
  blocker.** Probe every transport the plan uses in the first minutes and
  run the register's privileged actions (repo, Code Sync, first push,
  scratch preview) at Setup, never after migrate. On a denial ask exactly
  once — approve or run `<command>`, else the run writes
  `stardust/.work/ship.sh` (`../deploy/reference/ship-script.md`) —
  append `event: "blocked"` with `owner: "<command>"` and continue on
  unblocked work; state report, journal and turn-ending reply lead with
  `Blocked on owner:` while open (`reference/harness-permissions.md`
  § Privileged-action preflight).
- **Plan inside the token window.** From `credentials.daExpiresAt` order
  token-bound work inside the window and ask for the refresh up front
  when the projection exceeds it; a missing or expired credential is the
  `blocked` line **and** the first line of every progress message, with
  the exact unblock command — delivery halts, author-only work goes on.

**Turn-end contract.** A turn ends only on (a) run completion, (b) a
hard blocker or an owner-only row of `reference/decisions.md` (an open
`Blocked on owner:` with unblocked work left is neither), or (c) a
background wait longer than ~45 minutes. A wave or phase close is never a permitted end: it writes
the journal entry, the `status.jsonl` `end` line and the phase commit,
then starts the next planned step **in the same turn** — "Phase N done,
next: …" followed by silence is a defect. When the ask names a chain
("replica, then deploy"), stamp `state.json.approvedChain` (§ Hands-off
keys) and continue after each PASS; a FAIL or a residual over the bar
still pauses, and a chained `deploy` stops at preview unless the ask
said publish. An unavoidable pause ends with the fixed block `Running:
…` / `Waiting on you: 1) …` / `Will proceed without you: …` and the
pasteable `next` command (`reference/run-status.md` § Phase close); two
same-named gates → one question. Printed paths are `ls`-verified,
printed counts re-read from the artifact.

**Hard blockers remain stops.** An unreachable source site, an expired
`DA_TOKEN` that cannot be recovered, or a signal-absent brand surface are
not judgment calls — state the blocker precisely, append `event:
"blocked"` to `stardust/status.jsonl`, and halt — for a token halt the
`blocked` line carries `next` (the re-drive command) and authored
files stay in `content/**`; `../rollout/reference/delivery-gates.md`
§ Batched delivery at scale has the parking rule. Never guess around one.

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
6. Record direction, axes, commands and reasoning in
   `stardust/direction.md` with a provenance block.

## Per-page state and "stale on direction change"

Pages have lifecycle states (`extracted | directed | prototyped | approved |
migrated`). When the direction changes after pages were prototyped or
migrated, **mark them stale; do not auto-re-run** — the user opts in
explicitly (`reference/state-machine.md`).

## Artifacts you read and write

Stardust state lives under `stardust/`; impeccable's `PRODUCT.md` /
`DESIGN.md` / `DESIGN.json` at the project root are the *target* state;
the current (extracted) state lives under `stardust/current/`. Full
layout: `reference/artifact-map.md`.

**Write boundary.** Stardust writes to `stardust/`, the impeccable target
files at the project root, and the EDS project (only via `deploy`,
`rollout`, `dynamics`). Run-only files (logs, pre-renders, script
copies, drafts, probes) go under `stardust/.work/<skill>/`; the
root `scripts/` and `qa/` are not stardust's. Anything written elsewhere
is a bug.

**Versioning.** Everything under `stardust/` is committed except what
`reference/stardust.gitignore` lists; per-directory table and what a
clone without `current/assets/` can do: `reference/artifact-map.md`
§ Versioning.

## Provenance

Every artifact stardust writes opens with a provenance block (first line
or first key): which sub-command wrote it, against which user input, what
was synthesized vs. authored, which artifacts were read
(`reference/artifact-map.md`).

## Journal rule

`stardust/journal.md` is the chronological narrative layer — prompts,
decisions, open questions — that neither `state.json` (*what is*) nor
provenance (*why an artifact says what it says*) captures. **Maintain it
per `reference/journal-format.md`**: append an entry before ending any
turn that made a non-trivial write, its `Next:` being the phase's
`status.jsonl` `next` command, a phase-close entry opening with the gate
table (`reference/handoff-report.md` § Gate table first); append-only,
project-scoped, at the level of `PRODUCT.md`; its last 3–5 entries are
read with `state.json` at the start of every session.

**Named deviations.** Any agent-authored crawler, compiler, importer,
wave driver, gate **or measurement/probe script** that replaces a skill
phase is recorded in `stardust/direction.md` as a **named deviation** —
what it replaces, why the shipped instrument did not serve, where the
replacement lives — and noted in the journal. Before writing one, list
the shipped instruments (`ls skills/*/scripts`, or the project copy under
`stardust/scripts/<skill>/`) and run the shipped one; write your own only
when none exists, and ledger it here as a plugin gap. An unrecorded
parallel pipeline is a defect — its fidelity numbers are never comparable
to the gate's.

## Validation rule

Every human-facing artifact stardust writes — proposed HTML,
brand-review.html, the migrated site — runs through a **recursive
validate-and-fix loop** before being marked done: only browser rendering
verifies *feature* correctness.

1. Render in Playwright (file:// for static, or a local dev server).
2. Capture at three viewports — desktop **1440×900**, tablet **768×1024**,
   mobile **390×844**: full-page screenshot; console errors + warnings;
   network failures (4xx / 5xx / aborted, missing assets); uncaught JS
   exceptions + unhandled rejections; layout sanity (no horizontal
   overflow, non-empty landmarks); a11y quick-pass (alt text, input
   labels, heading order, text-over-image contrast); interaction smoke
   (card hover, scroll trigger, nav open/close, keyboard-reachable CTA).
3. **Fix every issue and re-run the loop** until none remain or a fix
   needs user input — then ask and stop. Never report a task complete
   with known issues outstanding.
4. Save the final clean-pass screenshots to
   `stardust/validation/<artifact>/<viewport>.png`.

Per-sub-skill specifics: `extract/reference/playwright-recipe.md`,
`prototype/reference/motion-validation.md`, `prototype/SKILL.md` Phases
2.5–2.8.

## What stardust never does

- Invent design opinions that contradict impeccable's hard rules.
- Execute a redesign plan without showing it first (hands-off records it
  in `stardust/direction.md` instead of waiting — § Hands-off mode).
- Force a re-run on stale pages without explicit user opt-in.
- Crawl beyond the user's confirmed page cap (an explicit `--pages` list is the confirmed scope — never dropped; the crawler warns rather than truncates).
- Emit platform-specific output from `migrate` — EDS conversion and
  delivery belong to `deploy` (one page) and `rollout` (whole site).

## References

- `reference/intent-dimensions.md` — the axes redesigns move along.
- `reference/intent-reasoning.md` — the procedure for a freeform phrase.
- `reference/intent-examples.md` — worked examples of the reasoning style.
- `reference/impeccable-command-map.md` — when to reach for each impeccable command.
- `reference/state-machine.md` — page lifecycle, stale rules, state report, flow / credentials / hands-off keys, concurrency.
- `reference/artifact-map.md` — every file stardust reads or writes: ownership, provenance shape, what is tracked.
- `reference/stardust.gitignore` — installed as `stardust/.gitignore` by Setup step 6.
- `reference/divergence-toolkit.md` — anti-mediocrity device for `direct` and `prototype`.
- `reference/token-contract.md` — the `:root` CSS custom-property contract every prototype and migrated page exposes.
- `reference/data-attributes.md` — the structural `data-*` vocabulary on sections.
- `reference/journal-format.md` — `stardust/journal.md` entry format; the append-only narrative layer.
- `reference/run-status.md` — the `stardust/status.jsonl` contract; `next`, the phase-close block, long-running steps.
- `reference/fan-out.md` — the delegated-agent protocol: progress files, worker and coordinator contracts.
- `reference/harness-quirks.md` — shell, runner, delivery, path, served-asset, local-QA and port rules.
- `reference/context-hygiene.md` — what enters the conversation: image-read budget, class reports, ranged re-reads, hand-off.
- `reference/learnings.md` — the per-run learnings ledger rollout's report phase writes and maintainers harvest.
- `reference/decisions.md` — the plan-time decision register: default and owner-only rows, how the plan gate batches them.
- `reference/handoff-report.md` — the phase-close hand-off shape: gate table first, reporting KPI, before/after evidence.
- `reference/harness-permissions.md` — the two command classes a permission layer sees, the Claude Code pre-approval generator, capability probes.

### Cinematic-feature references (cross-cutting)

Owned by `prototype/`; cited by `direct` and `uplift` (register
choice) and `migrate` (motion assets):

- `../prototype/reference/motion-registers.md` — the five motion registers and the heuristic that maps PRODUCT.md personality traits to one.
- `../prototype/reference/motion-stack.md` — technology choice (Lenis + CSS keyframes + rAF + IntersectionObserver) and bundle policy.
- `../prototype/reference/motion-attributes.md` — the `data-*` vocabulary the motion runtime consumes.
- `../prototype/reference/motion-runtime.md` — the canonical inline runtime script of every cinematic prototype.
- `../prototype/reference/motion-validation.md` § Pass 6 — cinematic-mode validation gates.

### Uplift-feature references

Owned by `uplift/`. Cited by master routing when delegating
`$stardust uplift <URL>`:

- `../uplift/SKILL.md` — one-shot presales orchestrator: extract → 3-variant direction → prototype × 3 → summarize.
- `../uplift/reference/what-if-candidates.md` — 8 worked trait-amplification candidates B and C select from in Phase 2b; § Extension rule admits evidence-shaped `derived` candidates.
