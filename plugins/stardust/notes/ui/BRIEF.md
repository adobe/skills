# Stardust UI — brief (in progress)

Defining a user interface for running a stardust migration in a browser or a
Mac desktop app. Separate from `plugins/stardust/NOTES.md` (plugin
implementation notes) — this is product definition.

**Status:** gathering inputs. Round 1 decided (D1-D4); D5-D10 open.

---

## What already exists to build on

- **`stardust/status.jsonl` is a designed-for-this-purpose seam.**
  `skills/stardust/reference/run-status.md` states the progress surface exists
  so "any harness — a Claude Code session, **the stardust app**, CI — can tail
  the run without parsing model output", and mandates it as the *only*
  progress contract ("harness-agnostic … anything that wants milestones tails
  this file"). A UI is anticipated, not retrofitted.
- **`stardust/state.json`** — per-page lifecycle (`extracted | directed |
  prototyped | approved | migrated`), plus stale-flagging on direction change.
  The natural backbone of any status view.
- **Per-phase ledgers** — `rollout`'s `coverage/pages.json`,
  `coverage/blocks.json`, `plan.json`; `_crawl-log.json`. Structured,
  already machine-readable.
- **`stardust/journal.md`** — the chronological narrative.
- **Confirmation gates** — `prepare-migration` already models phase boundaries
  with explicit confirm/refine choices; hands-off mode already models "no
  gates". Both map directly onto UI affordances.

## Decisions needed before designing anything

Numbered so answers can be recorded against them.

### D1. Who is the primary user? — **DECIDED: practitioner running migrations**
An agency / consultant / internal specialist who drives the whole pipeline.
Optimise for control, state visibility and intervention — not for hiding the
machinery. Customer-reviewer and contributor personas are out of scope for
now (revisit once the practitioner surface exists; note-4 work packages make
the contributor persona a natural second).

### D2. Where does the agent execute? — **DECIDED: Mac desktop, local agent**
Filesystem, Playwright/Chromium, `DA_TOKEN` in `.env` and git all work exactly
as stardust assumes today. The app is a shell over existing behaviour rather
than a re-platforming.

Consequences:
- **No backend to build.** The app reads `stardust/` off disk directly and
  tails `status.jsonl` for live progress. Every artifact is already a file.
- **Secrets never leave the machine** — `.env` custody is unchanged.
- **Browser automation keeps working** — the headed-Chrome fallback for
  bot-managed origins (`extract/reference/playwright-recipe.md`) is a local
  capability that a hosted backend would have made hard.
- **Cost of the choice:** no shared/multi-user state, and nothing to point a
  customer at. Both were deprioritised by D1.

### D3. What is the spine of the interface? — **DECIDED: structured dashboard, chat assist**
State, coverage and gates are the primary surface. Chat appears where
iteration genuinely needs it — prototype refinement ("make the hero bolder"),
direction-setting — rather than as the main navigation.

Open tension to resolve: `direct` is the *least* structured phase (freeform
intent, palette choice, variants, the "open and reasoned" principle in
`skills/stardust/SKILL.md`). It fits a dashboard worst. See D11.

### D4. How much of the pipeline is in scope? — **DECIDED: full chain**
`extract → direct → prototype → migrate → prepare-rollout → rollout`.

Consequence: the UI must cover six phases with genuinely different shapes —
a long crawl (progress + scope confirmation), a creative step (direction), a
visual review loop (prototypes), a bulk render (migrate), a plan to read and
partition (prepare-rollout, note 4), and a resumable delivery run with gates
and credential expiry (rollout). Designing one screen pattern for all six is
the main risk.

### D5. Single project or portfolio?
One migration at a time, or a dashboard across many projects.

### D6. What is the approval surface?
Prototype approval today is "the user signs off in conversation". In a UI it
becomes first-class: variants side by side, per-page approve/reject, approval
history. Needs defining — it is the highest-value screen.

### D7. Long-running work.
Runs take hours (crawls, bulk delivery). Progress, resumability, notification,
and what the user can safely do while a run is in flight.

### D8. Multi-user and assignment.
Note 4's work packages imply assignment, ownership and progress per
contributor. In scope or not.

### D9. Credentials and secrets.
`DA_TOKEN` lifecycle (~24h dev tokens, expiry mid-run is an existing hard
stop), GitHub auth, DA org/repo binding (note 3's `project.json`).

### D10. What the UI must never do.
Stardust's guarantees — provenance, no synthesized pages, idempotency,
stale-on-direction-change — must survive a GUI that makes re-running cheap.

### D11. How conversational is the `direct` phase? (new, from D3)
Direction-setting is freeform intent, mode detection, palette picking and
variants — the phase that fits a dashboard worst. Options: a dedicated chat
surface for this phase only; a structured form (palette picker, axis sliders)
with chat fallback; or keep it in the terminal and have the app pick up from
`direction.md`.

### D12. Relationship to Claude Code. (new, from D2)
Does the app replace the terminal entirely, or coexist with an escape hatch to
a real Claude Code session on the same project? Practitioners (D1) will hit
cases the GUI does not cover.

---

## Architecture — DECIDED

**Lower the floor as far as possible. Build the least possible, so effort goes
into evolving the skills and the UIs rather than maintaining an app.**

- No backend. All local. Mac desktop app.
- Tokens obtained from Adobe via login, with a user-supplied override.
- A **thin layer on top of Claude Code**, plus the required UIs.

### The floor is already most of the way there

The plugin generates self-contained HTML views today, and one of them is
already a migration dashboard:

| Existing artifact | Produced by | What it already does |
|---|---|---|
| `dashboard/index.html` + `data.json` | `rollout` Phase I (`scripts/dashboard.mjs`) | Self-contained, **no external JS**, rendered in the project's own brand tokens. Page tree of every page, colour-coded `identified → prototyped → deployed → optimised`, spanning `state.json` + rollout coverage + optimize findings. Templates table + quality scorecard. Regenerated at every iteration boundary. |
| `stardust/audit/<domain>/report.html` | `audit` | Craft-rendered self-contained report, opened with `open <path>`. |
| `stardust/current/brand-review.html` | `extract` | Brand surface review. |
| `stardust/prototypes/<slug>-proposed.html` | `prototype` | The prototype itself, opened in the browser for the iteration loop. |
| `stardust/status.jsonl` | every skill | Live progress, explicitly designed so "**the stardust app**" can tail it (`reference/run-status.md`). |
| `stardust/state.json`, `coverage/*.json`, `plan.json` | pipeline | Structured state, already machine-readable. |

So the pattern "a skill generates a self-contained view and opens it" is
established in at least three skills. The app does not need to invent it.

### The thin-layer contract

**The app implements no stardust logic.** Every action it offers is one of:

1. **Render a file the skills already produce** (dashboard, report, prototype,
   ledger), or
2. **Inject a command into the Claude Code session** (`$stardust extract <url>`,
   `$stardust prototype home`, "approve home").

If the app ever needs to *know* a stardust rule — what state comes next, when a
page is stale, which gate applies — that logic belongs in a skill, not the
shell. This is the test to apply to every proposed feature.

**Corollary, and the highest-leverage part of the constraint: the UIs are
generated by the skills, not built into the app.** A new view is a new script
in a skill (the `dashboard.mjs` pattern), shipped by a plugin update, with no
app release. The app ships only: a window, a webview, a Claude Code session, an
Adobe login, and a project picker.

### What must actually be built

| Piece | Why it can't come from a skill |
|---|---|
| **Shell** — window hosting a webview + a Claude Code session side by side | The container itself. |
| **Command injection** — buttons/actions that send `$stardust …` into the session | This is the floor-lowering: users stop needing to know commands. |
| **Live progress** — tail `status.jsonl`, show current phase / blocked state | Needs a process watching a file; the format already exists. |
| **Adobe login → `DA_TOKEN`** | Credential custody, plus a user-supplied override. |
| **Project picker** — open or create a project folder | Filesystem entry point. |
| **The view↔shell bridge** (see below) | The one new API. |

### The bridge — the only new contract, keep it tiny

Generated views are static HTML; interaction needs a channel back to the
shell. Options: a small injected API (`window.stardust.run(cmd)`) or a custom
URL scheme (`stardust://run?cmd=…`) the shell intercepts. Either way keep the
surface minimal and stable — something like `run(command)`, `openFile(path)`,
`notify(message)` — because **this is the contract every skill-generated UI
will depend on**, and widening it later is how the thin layer stops being
thin.

### Consequences worth stating

- **The rollout dashboard should be promoted to a pipeline-wide, live view.**
  It already spans the lifecycle; today it is a `rollout` Phase I artifact
  regenerated at iteration boundaries. Making it the app's home screen means
  generating it from any phase and refreshing it on `status.jsonl` activity.
- **Credential expiry improves.** `DA_TOKEN` expiring mid-run is currently a
  legitimate hard stop that checkpoints the ledger (`deploy/SKILL.md:91`).
  With an Adobe login the shell can refresh and resume instead — a real
  usability win the CLI cannot offer.
- **Skills stay harness-agnostic.** `run-status.md` forbids skills from
  referencing harness-specific mechanisms. The app must not push stardust to
  break that rule; it consumes files, it does not get its own API inside the
  skills.
- **Risk to watch:** "generated views + command injection" makes re-running
  cheap, which is exactly when idempotency, provenance and
  stale-on-direction-change matter most (D10). A GUI that makes `--re-direct`
  a single click needs the advisory tier from NOTES.md note 5.
