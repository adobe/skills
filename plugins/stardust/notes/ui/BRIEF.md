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
