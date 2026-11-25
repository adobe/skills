---
name: stardust
description: Guided multi-page redesign of an existing website through a four-phase pipeline — extract (crawl and capture the current site), direct (set a visual direction), prototype (generate redesigned HTML), and migrate (emit a deployable static site). Tracks progress incrementally per page in stardust/state.json so redesigns are resumable. Delegates the per-page design craft (typography, spacing, color, layout, motion) to the impeccable skill. Use when the user wants to redesign, revamp, modernize, or restyle an existing site they can point to by URL, run the extract/direct/prototype/migrate flow, or resume a multi-page redesign or migration. Also routes the same-design migration flow (replica) and the donor-design flow (reskin). Not for designing a brand-new site from scratch or one-off single-component edits.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
metadata:
  version: "1.6.1"
---

# stardust

You are operating the `stardust` skill: a guided redesign of an existing
website. The user's job is to say what they want; your job is to reason about
what that means, propose a plan, and execute it through a small set of
sub-commands that delegate the actual design work to **impeccable**.

## Setup (run before anything else)

1. **Verify impeccable is installed.** Stardust has a hard dependency on
   impeccable and ships no fallbacks. Look for the `impeccable` skill wherever
   the harness installs skills or plugins: the skill list the harness exposes
   to you, project skill directories (`.claude/skills/`, `.agents/skills/`,
   `.cursor/skills/`, `.github/skills/`), or the harness's plugin cache
   (Claude Code: `~/.claude/plugins/cache/`; GitHub Copilot:
   `~/.copilot/installed-plugins/*/impeccable/skills/impeccable`). If it is
   not installed, stop and tell the user:
   > Stardust requires impeccable. Install it from
   > <https://github.com/pbakaus/impeccable> and re-run the command.

   **Version hint (advisory, never blocking):** once per session run `node <plugin>/skills/stardust/scripts/impeccable-version-check.mjs` and surface its line only when it reports a newer version; never stop over it. Its `--where` prints impeccable's skill directory, where phases read impeccable's format specs by section. Details: `skills/stardust/reference/impeccable-version-hint.md`.
2. **Check the target-state files.** `PRODUCT.md` and `DESIGN.md` at the
   project root are the *target* state for stardust; check whether they
   exist (a directory listing is enough). Do not run impeccable's context
   loader (`scripts/impeccable context`) here: it emits directives for
   impeccable's own flow (init, new-work, detector, update checks) that do
   not apply to stardust's setup, and impeccable runs it itself whenever
   stardust invokes an impeccable command. Skip if already known from this
   session's history.
3. **Read stardust's state.** Read `stardust/state.json` if present
   (`reference/state-machine.md` defines the schema). Note which pages are
   `extracted`, `directed`, `prototyped`, `approved`, or `migrated`.
4. **Read impeccable's command registry.** Parse
   `<harness>/skills/impeccable/scripts/command-metadata.json`. This is the
   single source of truth for the 24 impeccable commands; never hardcode
   them in your reasoning.
5. **Status ledger.** Every stardust skill appends a phase-transition line
   to `stardust/status.jsonl` at each phase start/end, per
   `reference/run-status.md` — written with `skills/stardust/scripts/ledger.mjs
   <skill> <phase> <start|end|blocked> [--detail …]` (`--strict` refuses
   unknown phases), never with hand-built `printf`. Page status moves with
   `skills/stardust/scripts/state.mjs advance <slug…> --to <status>`; a
   resuming agent reads `ledger.mjs tail` and `state.mjs summary`.
   For progress, recommend `node stardust/scripts/stardust/ledger.mjs
   tail [-n 10]` or `last [<skill>]`; **ledger has no `summary` command**.
   Report recorded status, not process liveness.
6. **Project hygiene** (idempotent). Write `stardust/.gitignore` from
   `reference/stardust.gitignore` if absent; never edit a project's copy.
   In a git repo: root `.gitignore` covers `.env` / `.env.*` (managed
   `# >>> stardust` block), `.hlxignore` if present lists `stardust/`, and
   `git check-ignore -q stardust/state.json` must fail — if it passes,
   stop and name the rule. Offer, never write, LFS above 50 MB of tracked
   binaries under `stardust/`. Details in `reference/artifact-map.md`
   § Versioning.
7. **Copy this skill's whole `scripts/` dir to `stardust/scripts/stardust/`**
   before any other skill's script runs. Its `browser.mjs` is the one entry to
   the browser for every script. A script you write opens every page this way
   (#159): `newLiveContext` and `gotoLive`, never `chromium.launch()` or
   `page.goto`:

   ```js
   import { pathToFileURL } from 'node:url';
   const { openBrowser, newLiveContext, gotoLive } = await import(pathToFileURL('stardust/scripts/stardust/browser.mjs').href);
   const browser = await openBrowser({ mode: 'chrome' });
   const context = await newLiveContext(browser, { viewport: { width: 1440, height: 900 }, stateUrl: url });
   const page = await context.newPage();
   await gotoLive(page, url); // paced on a live site. A bot wall throws.
   ```

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
  | `spec` | pre-migration spec of a site — pages, blocks with reuse verdicts, dynamic features, martech, open decisions — as committed knowledge files |

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
front end), the ask decides whether the design is kept or changed: a
migration keeps its design unless the ask says to redesign it. That
selects the flow; the downstream chain is shared.

- **Scoping, before either flow:** "scope / estimate / plan / spec the
  migration of X", "which pages use block X", a redirect or 404 inventory →
  `spec`. Flow-neutral: it never stamps `flow`.
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
  design axis. Only an explicit phrase does; nothing is inferred.
- **Anything else** ("migrate X to EDS") is a faithful migration: `replica`, `flowSource: "default"`, no
  question, interactive and hands-off alike. The first response carries
  replica's flow line ("Flow: replica — the design is kept. Say `switch to
  redesign` now if it is to change."), so the one decision stays visible.
  With 1,000+ sitemap URLs and no spec, it adds "Large site: say `spec
  first` to scope it." Offered only, never in hands-off mode.

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

Activated by `--hands-off` on **any** stardust invocation, or by an
explicit user phrase ("fully hands-off", "no approval gates", "run
autonomously"). On activation, stamp `state.json.handsOff: true`
(schema note in `reference/state-machine.md` § Hands-off keys) and
append an activation line to `stardust/direction.md`. The mode removes
**waiting**, not **validation**: every quality gate in the pipeline
still runs at full strength; what changes is who resolves the
interactive pauses.

Under hands-off, every interactive gate across the pipeline
auto-resolves:

| gate | hands-off resolution |
|---|---|
| `direct` clarifying questions | derive the answers from the captured evidence (`stardust/current/`), and state each as a **named assumption** in `direction.md` |
| `prototype` brief-confirmation waits | skip; proceed on the authored brief |
| prototype approval | granted by the agent's own judgment **only after all quality gates pass** (craft bar, validation loop, motion gates); recorded as `approvedBy: "hands-off"` on the page's `approved` history entry in `state.json` |
| `prepare-migration` phase gates | behave as `--skip-confirm` |
| `rollout` | runs full-auto end-to-end |
| `dynamics` owner decisions (backend, tags on the new host, datasource ownership, locale scope) | ship the interim tier, record each decision by name in `dynamic-features.md` and the parity report, continue; regulated-pii forms stay blocked; a named assumption never sets `decided-out` |

Defaults under hands-off (override only when the invocation says otherwise), each in full in `skills/stardust/reference/hands-off-defaults.md`; read it when hands-off is active:

- **One canonical direction**, no variant fan-out.
- **Volume caps said out loud:** 100 pages overall, 20 per template; "all pages" lifts them; a user-named N replaces both. A capped roster is never called the full site.
- **First page first** in a full-site replica run.
- **Captured pages stay in the roster**; locale is never a reason to drop one.
- **Delegate by file pointer, read by section.**
- **Wait discipline: never park the conversation past the prompt-cache window.** Nothing long in the foreground, no single `sleep` of 5 minutes or more, progress checks at most every 4 minutes (replica's `run-bg.mjs` is the harness-neutral form).
- **One shell, one working directory:** paths from the project root, any `cd` in a subshell.
- **Author large files in parts.**
- **Commit at the end of each phase**, re-running Setup step 6 before the first commit.

**Hard blockers remain stops.** An unreachable source site, an
expired `DA_TOKEN` that cannot be recovered, or a signal-absent brand
surface (extract captured no usable brand signal even after a re-run)
are not judgment calls — state the blocker precisely, append
`event: "blocked"` to `stardust/status.jsonl`, and halt. Never guess
around a hard blocker.

**Quality gates NEVER weaken under hands-off.** Provenance
validation, the validation loop, fidelity gates, delivery gates, and
rollout's optimize gate all run unchanged. Hands-off changes *who
answers*, not *what must pass*.

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
`reference/stardust.gitignore` lists: screenshots, gate images, two heavy
folders (`migrated/assets/`, `rollout/qa/`), `.work/`, run residue, session
state. Per-directory table and what a clone can and cannot do:
`reference/artifact-map.md` § Versioning.

## Provenance

Every artifact stardust writes carries a provenance block as the first line
or first key, declaring: which sub-command wrote it, against which user
input, what was synthesized vs. authored, and what other artifacts were
read. Format conventions in `reference/artifact-map.md`.

## Journal rule

Maintain `stardust/journal.md`, append-only, per `reference/journal-format.md`: one entry before ending every turn that made a non-trivial write. Record any agent-authored crawler, compiler, importer, wave driver or gate that replaces a skill phase as a **named deviation** in `stardust/direction.md`. At the start of a session, read the journal's last entries with `state.json`. Rule text: `skills/stardust/reference/journal-rule.md`.

## Validation rule

Every artifact stardust writes that a human will eyeball — proposed HTML,
brand-review.html, the migrated site — runs through a **recursive validate-
and-fix loop** before being marked done. The principle: type checks and
test suites verify code correctness; only browser rendering verifies
*feature* correctness.

For HTML the user will see, render through `browser.mjs` (§ Setup, step 7) at 1440×900, 768×1024 and 390×844; check screenshots, console, network failures, exceptions, overflow and landmarks, an a11y quick-pass and interaction smoke. Fix and re-run until nothing remains or a fix needs the user; never report a task complete with known issues. Save the clean-pass screenshots to `stardust/validation/<artifact>/<viewport>.png`. Steps: `skills/stardust/reference/validation-loop.md`.

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

- `skills/stardust/reference/cross-cutting-references.md`: the cinematic-feature references owned by `prototype/` (motion registers, stack, attributes, runtime, validation) and the uplift references.
