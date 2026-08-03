# Stardust UI — brief (in progress)

Defining a user interface for running a stardust migration in a browser or a
Mac desktop app. Separate from `plugins/stardust/NOTES.md` (plugin
implementation notes) — this is product definition.

**Status:** gathering inputs. Nothing decided yet.

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

### D1. Who is the primary user?
Practitioner running migrations / customer stakeholder reviewing + approving /
contributor picking up a work package (note 4) / mixed.

### D2. Where does the agent execute?
The fork that decides how much has to be built:
- **Mac desktop, local agent** — filesystem, Playwright/Chromium, `DA_TOKEN`
  in `.env`, git all work as stardust assumes today. Thin shell over existing
  behaviour.
- **Browser + hosted backend** — crawling, browser automation, token custody,
  git and long-running jobs all move server-side. A substantially larger build
  that changes stardust's operating assumptions.

### D3. What is the spine of the interface?
Chat-first with visual panels / structured dashboard with chat assist /
linear wizard through the phases. Stardust's craft loop ("make the hero
bolder") is inherently conversational; its state, coverage and gates are
inherently structured. The ratio is a real product decision, not a detail.

### D4. How much of the pipeline is in scope?
Full chain (extract → direct → prototype → migrate → prepare-rollout →
rollout) / migration execution only / review-and-approve surface only.

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
