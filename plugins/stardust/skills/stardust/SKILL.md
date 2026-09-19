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
| Setup 1 | read the skill's `metadata.impeccable` level; unless `none`: impeccable presence check + `node skills/stardust/scripts/impeccable-version-check.mjs [--local <dir>]` (advisory) | `required` stops if missing; `optional` degrades; `none` skips 1 and 4 | — |
| Setup 2–4 | `PRODUCT.md` / `DESIGN.md` presence; read `stardust/state.json`; parse impeccable's `command-metadata.json` | — | — |
| Setup 5–7 | status ledger; project hygiene (`stardust/.gitignore`, root `.gitignore`, `.hlxignore`, `git check-ignore`); credentials lookup on migration-bound asks | `state.json` must not be ignored; no 401 blocker before the lookup ran | `stardust/status.jsonl`, `stardust/.gitignore`, `state.json.credentials` |
| Routing | no arg / resume → state report; sub-skill keyword → delegate; migration ask → § Two migration flows; freeform → intent reasoning | plan shown before any command (hands-off: recorded instead) | `state.json` flow keys |
| Freeform intent | § The "open and reasoned" principle, steps 1–6 | plan confirmation | `stardust/direction.md` |
| Hands-off | gate auto-resolution + decision defaults; transport preflight; volume caps; background waits; per-phase commits | quality gates unchanged; hard blockers still stop; denied privileged action → ask once, `Blocked on owner:` | `state.json.handsOff`, `direction.md` activation line, `status.jsonl` `blocked` (+ `owner`) |
| Every write | provenance block; journal entry; validate-and-fix loop on human-facing HTML | clean validation pass | `stardust/journal.md`, `stardust/validation/<artifact>/<viewport>.png` |

| at step | read |
|---|---|
| Setup 3, Routing | `reference/state-machine.md` § File: `stardust/state.json` · § State report |
| Setup 5 | `reference/run-status.md` § Line shape · § Rules |
| Setup 6, Artifacts | `reference/artifact-map.md` § Versioning — what a clone holds · § Provenance shapes |
| Setup 1, 7 | `reference/harness-permissions.md` § Two classes · `reference/state-machine.md` § Credentials key |
| Routing (migration) | `reference/state-machine.md` § Flow keys |
| Freeform intent | `reference/intent-reasoning.md` § Procedure · `reference/intent-dimensions.md` § Reading a phrase · `reference/impeccable-command-map.md` § Common sequences |
| Hands-off | `reference/state-machine.md` § Hands-off keys · `reference/decisions.md` § Default rows · `reference/harness-permissions.md` § Privileged-action preflight · `reference/run-status.md` § Long-running steps |
| Per-page state | `reference/state-machine.md` § Page lifecycle states · § Stale flagging (content-aware) |
| Journal | `reference/journal-format.md` § Entry format · § Reading the journal at session start |
| Phase close / hand-off | `reference/handoff-report.md` § Gate table first |
| Validation | `../extract/reference/playwright-recipe.md` § Capture list · `../prototype/reference/motion-validation.md` § Validation procedure |

Headings: Setup · Routing · Two migration flows · Hands-off mode · The "open and reasoned" principle · Per-page state and "stale on direction change" · Artifacts you read and write · Provenance · Journal rule · Validation rule · What stardust never does · References

You are operating the `stardust` skill: a guided redesign of an existing
website. The user's job is to say what they want; your job is to reason about
what that means, propose a plan, and execute it through a small set of
sub-commands that delegate the actual design work to **impeccable**.

## Setup (run before anything else)

1. **Resolve the impeccable dependency level.** Read the invoked skill's
   frontmatter `metadata.impeccable` (`required` | `optional` | `none`; the
   master itself is `required` for its freeform-intent route). `none` →
   skip this step and step 4, noting `impeccable: skipped` in the skill's
   first `status.jsonl` line. Otherwise locate impeccable: the skill list
   the harness exposes to you, project skill directories
   (`.claude/skills/`, `.agents/skills/`, `.cursor/skills/`,
   `.github/skills/`) or its plugin cache (Claude Code:
   `~/.claude/plugins/cache/`; GitHub Copilot:
   `~/.copilot/installed-plugins/*/impeccable/skills/impeccable`). Under a
   permission layer, read `reference/harness-permissions.md` § Two classes
   first. If impeccable is absent, `required` skills stop (stardust ships
   no fallback for them) and tell the user:
   > Stardust requires impeccable. Install it from
   > <https://github.com/pbakaus/impeccable> and re-run the command.

   `optional` skills note `impeccable: absent` there and continue on their
   degrade path; they never stop over it.
   **Version hint (advisory, never blocking):** once per session run
   `node <plugin>/skills/stardust/scripts/impeccable-version-check.mjs`
   (`--local <dir>` when impeccable lives in a harness skills directory)
   and surface its one line verbatim only when it reports a newer version;
   every other outcome is noise. Stardust pins no impeccable version.
2. **Check the target-state files.** `PRODUCT.md` and `DESIGN.md` at the
   project root are the *target* state; check whether they exist. Do not
   run impeccable's context loader here — impeccable runs it itself on
   every command.
3. **Read stardust's state.** `stardust/state.json` if present
   (`reference/state-machine.md`); note each page's lifecycle state.
4. **Read impeccable's command registry** (skipped when the level is
   `none`): `<harness>/skills/impeccable/scripts/command-metadata.json`,
   the single source of truth — never hardcode commands.
5. **Status ledger.** Every stardust skill appends a phase-transition line
   to `stardust/status.jsonl` at each phase start/end
   (`reference/run-status.md`).
6. **Project hygiene** (idempotent). Write `stardust/.gitignore` from
   `reference/stardust.gitignore` if absent; never edit a project's copy.
   In a git repo: root `.gitignore` covers `.env`, `.env.*` and
   `.claude/settings.local.json` (managed `# >>> stardust` block),
   `.hlxignore` if present lists `stardust/`, and `git check-ignore -q
   stardust/state.json` must fail — if it passes, stop and name the rule.
   Offer (never write) LFS above 50 MB of tracked binaries. Details:
   `reference/artifact-map.md` § Versioning.
7. **Credentials** — on a migration ask or any invocation that can reach
   `deploy` / `rollout` (keyed on the ask; `flow` is stamped later). Run
   the lookup in `reference/state-machine.md` § Credentials key and write
   `state.json.credentials`. Never declare a 401 blocker before it ran;
   `--token-env` consumers default to `credentials.siteTokenEnv`.

## Routing

Once setup is done, route on the user's input:

- **No argument.** Render the **state report** described in
  `reference/state-machine.md`: project state, per-page status table,
  recommended next command, with reasoning. Do not write anything.
  The same applies to any **resume**: a new session on a project that
  has `stardust/state.json`, "continue", "where are we", or a resume
  driven by a memory file. Start with the state report (it names the
  flow and the last gate numbers), then enter the next phase **through
  its skill** — the procedure drives, not memory. (Recorded: a
  144-hour resume session invoked no stardust skill at all, re-read
  the procedure through `grep`, and followed whatever the previous
  context remembered.)
- **First word names a sub-skill.** Delegate to the matching sub-skill
  and pass remaining args through. Sub-skills are named by their bare
  skill name below; how to address one depends on the harness. Claude
  Code namespaces plugin skills as `stardust:<name>` (Skill tool);
  GitHub Copilot and other harnesses that flatten plugin skills expose
  the bare `<name>`. If the harness has no skill-invocation tool, read
  the sub-skill's `SKILL.md` and follow it inline. Never confuse the
  stardust `extract` and `audit` skills with impeccable's `extract` and
  `audit` commands, which are always written `$impeccable <command>`.
  The master skill routes **all** sibling sub-skills:

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
  | `dynamics` | the dynamic surface of a migration — detect, classify, triage, implement, verify (APIs, search, forms, modals, media, tags, client-rendered, sheet data); migration-bound, invoked by prepare-migration / replica / migrate / rollout or standalone on an already-migrated site |
  | `diff` | prototype ↔ build fidelity probes (pixel + structural) |
  | `audit` | three-perspective site audit — design tensions, SEO/technical, LLM visibility — scored report + findings ledger |
  | `qa` | read-only post-deploy QA sweep of the live site — routing, fidelity, template conformance, rendering, visual regression, SEO, links, a11y, perf — findings report only, never fixes |
  | `uplift` | one-shot presales orchestrator (3 variants) |

  - `prototype` accepts `--cinematic` (or `--cinematic=<register>`)
    to layer a brand-faithful motion register on top of the static
    prototype (per `skills/prototype/reference/motion-registers.md`).
  - `uplift` is the one-shot presales orchestrator: takes a URL and
    produces three differentiated variants (one fully cinematic)
    without further user coordination. Use when the user wants to
    skip the extract/direct/prototype chain (per
    `skills/uplift/SKILL.md`).
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

When the user wants to migrate a site to AEM Edge Delivery (or any clean
front end), the FIRST question is whether the design is kept or changed.
That answer selects the flow; the downstream chain is shared.

- **Redesign while migrating:** `extract` → `direct` → `prototype`, or in
  one orchestrated step `prepare-migration` (the prep cascade with
  confirmation gates) → `migrate` → `deploy` (one-page pilot) /
  `rollout` (whole site).
- **Keep the current design (re-platform):** `replica` → `migrate` →
  `deploy` / `rollout`. `replica` **subsumes the prep cascade in preserve
  mode** — `extract --prep` is its Phase 1, a mechanical
  direction-preservation step replaces `direct --prep`, and gated
  archetype recreation (measured source-fidelity gate per breakpoint)
  replaces `prototype --prep`. **Never run `prepare-migration` before or
  after `replica`**; there is no separate prep step in this flow.
- **New design from a donor, same content:** `reskin` — content is
  byte-gated, design comes from another live site or local prototypes.
- **Both migration flows carry the dynamic surface by default.** The
  pre-import gate (`prepare-migration` 4.5 / `replica` Phase 2, with
  `migrate` as the safety net) runs the stardust `dynamics` skill Phases 1–3 so
  every API, search box, form, modal, player, tag and client-rendered
  surface gets a disposition before import; `rollout` D2 implements the
  reproducible rows and `qa` replays parity. Never for redesign-only
  work (`uplift`, a bare `extract`): dynamics is a migration concern.

**Choosing, and recording the choice.** Read the ask before any sub-skill
loads:

- **Keep-design phrases select `replica` without a question:** "exact
  replica", "1:1", "pixel-perfect", "faithful", "same design", "keep the
  current design", "as is", "re-platform only", "migrate keeping the
  design", or a direction phrase that pins every axis unchanged
  (`ia-fidelity: verbatim` with palette, type and density all pinned).
- **Redesign phrases select the redesign flow:** "redesign", "modernise",
  "refresh", "new look", "rethink", "reimagine" — any phrase that moves a
  design axis.
- **Anything else** ("migrate X to EDS", "build a migration plan for X")
  asks the one keep-vs-redesign question — the only question this section
  asks. Under hands-off it is not asked: a keep-design phrase selects
  `replica`, otherwise `redesign`, recorded as a named assumption in
  `direction.md`.

Stamp the choice in `state.json` as `flow` / `flowChosenAt` / `flowSource`
(`reference/state-machine.md` § Flow keys) before delegating. The
sub-skills enforce it: `migrate`, `deploy`, `rollout` and a
migration-intent `extract` refuse to start a migration on a project with
`state.json` and no `flow`; `prepare-migration` refuses under
`flow: replica` and `replica` under `flow: redesign`. Switching is
explicit — `$stardust replica --switch-flow` / `$stardust
prepare-migration --switch-flow` — and marks the old flow's prototyped or
migrated pages stale (§ Per-page state).

**Planning aids belong to one flow.** Redesign: the `prepare-migration`
plan and its phase gates, the canon, module catalogs, template plans of
the "learn the template, then compile" kind. Keep-design: `replica`'s
inconsistency register and `progress.json`, the archetype gate ledgers,
`rollout` waves. A redesign procedure or plan template inside a replica
run — or the reverse — is a routing defect: refuse it, or flag it in
`direction.md` and hand back to this section. (Recorded: a same-design
migration adopted a redesign-only "train the template, then compile" plan
and spent an hour, 45 turns and 36 M tokens before reverting it; another
loaded `prepare-migration` for a keep-design ask on a plugin that already
described the two flows — description without a guard did not hold.)

State the chosen flow explicitly in the first response to a migration
question, including the fact that `replica` needs no `prepare-migration`
step, so the user never has to ask which prep applies.

## Hands-off mode

Activated by `--hands-off` on **any** stardust invocation or by an
explicit phrase ("fully hands-off", "no approval gates", "run
autonomously"): stamp `state.json.handsOff: true` and append an
activation line to `stardust/direction.md`. The mode removes **waiting**,
not **validation**: every quality gate still runs at full strength. Every
interactive gate auto-resolves:

| gate | hands-off resolution |
|---|---|
| `direct` clarifying questions | derive from the captured evidence (`stardust/current/`); state each as a **named assumption** in `direction.md` |
| `prototype` brief-confirmation waits | skip; proceed on the authored brief |
| prototype approval | granted by the agent's own judgment **only after all quality gates pass**; recorded as `approvedBy: "hands-off"` on the page's `approved` history entry in `state.json` |
| `prepare-migration` phase gates | behave as `--skip-confirm` |
| `rollout` | runs full-auto end-to-end |
| `dynamics` owner decisions (backend, tags on the new host, datasource ownership, locale scope) | ship the interim tier, record each by name in `dynamic-features.md` § Decision batch and the parity report, continue; regulated-PII forms stay blocked |
| plan-time decisions (`reference/decisions.md` § Default rows: target, branch, publish, fonts, links, locale, martech, crawl, credentials, copy, scope) | apply the default row and print the open rows in the first reply; publish stays preview-only — live is an explicit `--publish` run on gate PASS or an owner-decided row (D1, D16); only an owner-only row halts the work it gates |

Defaults (override only when the invocation says otherwise):

- **One canonical direction.** No variant fan-out — commit to a
  single direction and record the rationale in `direction.md`.
- **Volume caps as reasoned proposals.** Default **100 pages overall,
  20 per template**. Roster priority: header- and footer-linked pages,
  then section landing pages, then a representative spread of detail
  pages across templates. State the caps in `direction.md`.
- **Delegate by file pointer, read by section.** A brief to a delegated
  agent names files and sections (`state.json`, the page's schema, the
  phase's SKILL.md sections) — card rows, never whole files or inlined
  reference docs. The coordinator reads a skill's operator card, never
  its body, and before reading any file over 20 KB lists the headings
  and reads only the section the card names. Stall-prone instruments run
  under their shipped deadline (replica `gate.sh`, `pixel-compare
  --timeout`), never an agent-authored `sleep N; kill` loop; long steps
  write a progress file the coordinator polls.
- **Wait discipline: never park the conversation past the prompt-cache
  window.** Anything longer than about 2 minutes (a gate round, a crawl,
  a batch push, a delegated agent) runs in the background and writes a
  progress file; never in the foreground, never under one long `sleep`. Do independent work meanwhile; otherwise check the
  progress file **at most every 4 minutes** — never a fixed `sleep` of
  5 minutes or more, never a blocking wait with a long timeout — and end
  the turn only for waits over ~45 minutes or a user decision. Rationale
  and Claude Code levers: `reference/run-status.md` § Long-running steps.
- **Commit at the end of each phase** when the project is a git repo;
  the phase-close message is the hand-off shape in
  `reference/handoff-report.md`. Re-run Setup step 6 before the FIRST
  such commit — a tracked `.env` poisons every later push.
- **Transports and privileged actions first; a denial is not a
  blocker.** Probe every transport the plan uses in the first minutes and
  run the register's privileged actions (repo, Code Sync, first push,
  scratch preview) at Setup, never after migrate. On a denial ask exactly
  once, append `event: "blocked"` with `owner: "<command>"`, continue on
  unblocked work; state report, journal entry and turn-ending reply lead
  with `Blocked on owner:` while open. `reference/harness-permissions.md`
  § Privileged-action preflight.
- **Plan inside the token window.** From `credentials.daExpiresAt` order
  token-bound work inside the window and ask for the refresh up front
  when the projection exceeds it; a missing or expired credential is the
  `blocked` line **and** the first line of every progress message, with
  the exact unblock command — delivery halts, author-only work continues.

**Hard blockers remain stops.** An unreachable source site, an
expired `DA_TOKEN` that cannot be recovered, or a signal-absent brand
surface are not judgment calls — state the blocker precisely, append
`event: "blocked"` to `stardust/status.jsonl`, and halt. Never guess
around a hard blocker.

**Quality gates NEVER weaken under hands-off.** Provenance validation,
the validation loop, fidelity gates, delivery gates and rollout's optimize
gate run unchanged: hands-off changes *who answers*, not *what must pass*.

## The "open and reasoned" principle

Stardust does not ship a closed `intent → commands` lookup. Every freeform
phrase is reasoned about in public. You must:

1. Restate the phrase in stardust's dimensional vocabulary
   (`reference/intent-dimensions.md`).
2. Identify which axes the phrase moves and in which direction.
3. Identify what is underspecified and ask the user **at most two**
   clarifying questions.
4. Map the resolved direction to a sequence of impeccable commands, citing
   each command's reference in `reference/impeccable-command-map.md`.
5. Show the proposed plan to the user before executing.
6. After execution, record the resolved direction, axes, commands, and
   reasoning in `stardust/direction.md` with a stardust provenance block.

Worked examples of this procedure live in `reference/intent-examples.md`.

## Per-page state and "stale on direction change"

Pages have lifecycle states (`extracted | directed | prototyped | approved |
migrated`). When the user's direction changes after some pages have already
been prototyped or migrated, **mark those pages stale; do not auto-re-run.**
The user opts in to re-prototyping or re-migrating explicitly. Details in
`reference/state-machine.md`.

## Artifacts you read and write

Stardust state lives under `stardust/`. Impeccable's `PRODUCT.md` /
`DESIGN.md` / `DESIGN.json` live at the project root and represent the
*target* state. The current (extracted) state lives under
`stardust/current/`. Full layout in `reference/artifact-map.md`.

**Write boundary.** Stardust writes to `stardust/`, the impeccable target
files at the project root, and the EDS project (only via `deploy`,
`rollout`, `dynamics`). Run-only files — logs, harness page, pre-renders,
script copies, drafts — go under `stardust/.work/<skill>/`; the root
`scripts/` and `qa/` are not stardust's. Anything written elsewhere is a
bug in that skill.

**Versioning.** Everything under `stardust/` is committed except what
`reference/stardust.gitignore` lists: screenshots, four heavy folders
(`current/assets/`, `replica/gates/`, `migrated/assets/`, `rollout/qa/`),
`.work/`, run residue, session state. Per-directory table and what a clone
without `current/assets/` can and cannot do: `reference/artifact-map.md`
§ Versioning.

## Provenance

Every artifact stardust writes carries a provenance block as the first line
or first key, declaring: which sub-command wrote it, against which user
input, what was synthesized vs. authored, and what other artifacts were
read. Format conventions in `reference/artifact-map.md`.

## Journal rule

A multi-session stardust project benefits from a **chronological journal**
that records the prompt history, decisions, and open questions across
turns — separate from the state machine and from per-artifact provenance.
State.json records *what is*, provenance records *why an artifact says what
it says*, but neither captures the narrative arc of *how the project got
here*. The journal does.

**Maintain `stardust/journal.md` per the format in
`reference/journal-format.md`.** On every prompt execution that resulted in
a non-trivial write (any `direct`, `prototype`, `migrate`, or substantial
iteration), append an entry before ending the turn.

**Named deviations.** Any agent-authored crawler, compiler, importer,
wave driver or gate that replaces a skill phase is recorded in
`stardust/direction.md` as a **named deviation** — what it replaces, why
the shipped instrument did not serve, where the replacement lives — and
noted in the journal entry. An unrecorded parallel pipeline is a defect,
not initiative: three recorded migrations rebuilt the import pipeline by
hand (one a 60 KB importer) beside skills that shipped it, and their
fidelity numbers were never comparable to the gate's.

The journal is **append-only**. If a prior entry turns out wrong, write a
new entry that corrects it; do not edit history. This preserves the
reasoning trace and lets reviewers see how decisions evolved.

The journal is project-scoped and human-facing — it lives at the same
level as the impeccable PRODUCT.md, not under `stardust/current/` or
`stardust/canon/`. Treat it as the shared narrative layer over stardust's
state machine.

When the user invokes stardust at the start of a new session, the journal
is read first (along with state.json) — its last 3-5 entries carry the
"where did we leave off" context that the state machine doesn't.

## Validation rule

Every artifact stardust writes that a human will eyeball — proposed HTML,
brand-review.html, the migrated site — runs through a **recursive validate-
and-fix loop** before being marked done. The principle: type checks and
test suites verify code correctness; only browser rendering verifies
*feature* correctness.

For HTML the user will see (prototypes, migrated pages, the brand-review
HTML):

1. Render in Playwright (file:// for static, or local dev server).
2. Capture at three viewports — desktop **1440×900**, tablet **768×1024**,
   mobile **390×844**:
   - Full-page screenshot.
   - Browser console messages (errors + warnings).
   - Network failures (4xx / 5xx / aborted requests, missing assets).
   - Uncaught JS exceptions + unhandled promise rejections.
   - Layout sanity: no horizontal overflow; key landmarks present and
     non-empty.
   - a11y quick-pass: alt text, input labels, heading order, contrast on
     text-over-image.
   - Interaction smoke: hover an interactive card, scroll-trigger fires,
     nav opens/closes, primary CTA reachable by keyboard.
3. **If any issue is found, fix it and re-run the loop.** Iterate
   recursively until either (a) no issues remain or (b) the fix needs user
   input — in which case surface the question and stop. Do not report a
   task complete with known issues outstanding.
4. Save the final clean-pass screenshots to `stardust/validation/<artifact>/<viewport>.png`
   so reviewers can compare without re-running.

Per-sub-skill validation specifics live in each skill's reference docs —
notably `extract/reference/playwright-recipe.md` (the canonical recipe),
`prototype/reference/motion-validation.md` (motion-specific gates), and
`prototype/SKILL.md` Phases 2.5–2.8 (the critique / audit / adapt /
motion gate cascade).

## What stardust never does

- Invent design opinions that contradict impeccable's hard rules. Defer to
  impeccable.
- Execute a redesign plan without showing it first (hands-off mode records
  the plan in `stardust/direction.md` instead of waiting — § Hands-off mode).
- Force a re-run on stale pages without explicit user opt-in.
- Crawl an existing site beyond the user's confirmed page cap (an explicit `--pages` list is itself the confirmed scope — listed pages are never dropped; the crawler warns rather than truncates when the list exceeds `--max`).
- Emit platform-specific output from `migrate`. `migrate` emits
  platform-agnostic static HTML; the EDS conversion and delivery are owned
  by the stardust `deploy` (one page) and `rollout` (whole site) skills
  sub-skills, routed above.

## References

- `reference/intent-dimensions.md` — the axes redesigns move along.
- `reference/intent-reasoning.md` — the procedure for handling a freeform phrase.
- `reference/intent-examples.md` — worked examples (8-12) of the reasoning style.
- `reference/impeccable-command-map.md` — when to reach for each of the 24 impeccable commands.
- `reference/state-machine.md` — page lifecycle, stale rules, state report format.
- `reference/artifact-map.md` — every file stardust reads or writes, with ownership, provenance shape and (§ Versioning) what is tracked.
- `reference/stardust.gitignore` — installed as `stardust/.gitignore` by Setup step 6.
- `reference/divergence-toolkit.md` — anti-mediocrity device. Default-moves list, deterministic seed, font decks, role-naming rule. Consumed by `direct` (when authoring target tokens) and `prototype` (when generating variants).
- `reference/token-contract.md` — `:root` CSS custom-property contract every prototype and migrated page must expose. The token interface between stardust and any downstream consumer.
- `reference/data-attributes.md` — structural `data-*` vocabulary applied to sections in every prototype and migrated page. The structural lingua franca between stardust sub-commands and downstream tools.
- `reference/journal-format.md` — `stardust/journal.md` entry format. Append-only chronological log; the shared narrative layer over the state machine.
- `reference/run-status.md` — the `stardust/status.jsonl` phase-transition contract every skill appends to. The deterministic progress surface for any harness.
- `reference/learnings.md` — the per-run learnings ledger contract (`stardust/learnings.md`). rollout's report phase writes it; plugin maintainers harvest pending entries into skill diffs.

### Cinematic-feature references (cross-cutting)

Owned by `prototype/` because the cinematic feature is scoped to
prototype rendering, but cited by `direct` (when selecting a
register), `uplift` (when picking C's register), and `migrate`
(when copying motion assets through):

- `../prototype/reference/motion-registers.md` — five brand-faithful motion personalities (`arrival`, `kinetic-display`, `live-systems`, `editorial`, `kinetic-grid`) and the selection heuristic that maps PRODUCT.md Brand Personality traits to a register.
- `../prototype/reference/motion-stack.md` — technology choice: Lenis + CSS keyframes + rAF + IntersectionObserver. Why not GSAP. Bundle policy.
- `../prototype/reference/motion-attributes.md` — `data-*` vocabulary the runtime consumes (`[data-anim]`, `[data-tile-anim]`, `[data-countup]`, `[data-flip]`, `[data-fill]`, `[data-split]`, `[data-parallax]`).
- `../prototype/reference/motion-runtime.md` — the canonical inline runtime script that powers every cinematic prototype.
- `../prototype/reference/motion-validation.md` § Pass 6 — cinematic-mode validation gates (Lenis boot, reduced-motion fallback, scroll-jack, three-position screenshots, register-match, motion C-cliff detector).

### Uplift-feature references

Owned by `uplift/`. Cited by master routing when delegating
`$stardust uplift <URL>`:

- `../uplift/SKILL.md` — one-shot presales orchestrator: extract → tension/trait identification → 3-variant direction → prototype × 3 → open + summarize.
- `../uplift/reference/what-if-candidates.md` — catalog of 8 worked captured-trait amplification candidates that B and C select from in Phase 2b — plus its § Extension rule admitting evidence-shaped `derived` candidates.
