# journal.md format

The chronological prompt journal. Located at `stardust/journal.md`.
Append-only. Read at session start to recover "where did we leave off"
context that state.json doesn't carry.

## File header

```markdown
# Journal — <project-name> redesign

Chronological log of every prompt execution. Most recent at the bottom.
See `skills/stardust/reference/journal-format.md` for entry format.

---
```

## Entry format

```markdown
## <ISO-8601 timestamp> — <one-line summary>

**Prompt:** <one-paragraph paraphrase of the user's request>

**Decisions:**
- <decision 1>
- <decision 2>
- ...

**Artifacts touched:**
- <path> — <created | updated | read>
- ...

**Findings worth flagging:** *(optional — include when the turn surfaced reusable knowledge)*
- <finding 1 — short factual statement; include enough context to re-discover the rationale>
- ...

**Open questions:**
- <question> (or "none")

**Next:** <one-line recommendation for the next prompt>

---
```

The double-rule (`---`) at the end of each entry is mandatory — it makes
diffs readable and gives the journal a visual scroll rhythm.

## What to include

**Always:**
- The prompt paraphrase (not the verbatim user message; one sentence is fine).
- Decisions that changed direction, picked between alternatives, or
  committed to an approach.
- Every artifact created, updated, or significantly read.
- The recommended next action (even if it's "wait for user input").

**Sometimes (when applicable):**
- Findings: reusable knowledge that surfaced during the turn. Examples
  worth recording: a captured-pattern bug that resolved a class of issues
  beyond this one variant; a tool limitation you worked around; a design
  decision that has surprising downstream implications; a constraint the
  user hadn't named but the work revealed.
- Open questions: anything the user implicitly answered but didn't say
  out loud, anything the agent had to decide-by-default that the user
  may want to revisit.

**Never:**
- Code diffs. The git log is authoritative; the journal cites *what* and
  *why*, not *how*.
- Verbatim chat transcripts. Paraphrase prompts; record decisions.
- Speculative future planning. The "Next" line is a recommendation, not a
  plan. Plans live in plan mode or PRODUCT.md.
- Ephemeral debugging chatter. Distill to the load-bearing fact.

## What "non-trivial write" means

Append a journal entry when the turn:

- Wrote or modified an artifact under `stardust/`, `PRODUCT.md`,
  `DESIGN*.md`, `DESIGN*.json`, `samples/`, or any user-visible HTML.
- Resolved a direction question or picked between alternatives.
- Surfaced a bug, captured a finding, or made a reusable observation.
- Touched the state machine (page lifecycle transitions).

Skip entries for turns that were purely conversational, read-only,
diagnostic without action, or that only updated the journal itself.

## Correcting prior entries

If a prior entry is wrong, write a new entry that corrects it. Reference
the prior entry by timestamp + summary. The append-only contract is
load-bearing: editing history erases the reasoning trace and makes the
project harder to review.

Example correction entry:

```markdown
## 2026-05-23T21:00:00-07:00 — Correction: B3 motion stack count was 4, not 5

**Prompt:** *(self-initiated correction)*

**Decisions:**
- The 2026-05-22T17:00 entry recorded "B3 has 5 motion choreographies."
  Re-counting against DESIGN-B3.json: 4 (hero scroll-grow, news scrub,
  featured parallax, footer wordmark). The fifth I had counted was the
  studio-banner garage-door, but that's a CSS-only choreography
  inherited from B unchanged, not a B3 addition. Cap override remains
  at ≤5 (the brief allows up to that count).

**Artifacts touched:**
- stardust/journal.md — appended this correction

**Open questions:** none

**Next:** Continue with whatever the user was working on.

---
```

The prior entry remains. The reasoning trace shows: at time T the agent
thought N=5; at time T+1 the agent re-counted and got N=4. Both states
are visible to reviewers.

## Reading the journal at session start

When a new session begins (state.json exists, user has not yet given a
specific command), read the last 3-5 entries of the journal before any
non-trivial response. The state machine tells you *what state each
artifact is in*; the journal tells you *why the project is in that
state* — which is what informs "what should we do next" suggestions.

Quote the most recent `Next:` line if the user asks "where were we?"
or "what's next?" — but verify against state.json first. If the journal
recommends an action that state.json indicates is already done, the
journal is stale; surface the discrepancy.

## Project-side CLAUDE.md companion

When a project has a CLAUDE.md (impeccable's project instructions
file), it's normal to also have a one-line reminder there:

> **Journal rule:** On every prompt execution that resulted in a
> non-trivial write, append an entry to `stardust/journal.md`
> per `skills/stardust/reference/journal-format.md`.

This is project-side because each project might want to extend the
default format (a custom rule, an additional field, a project-specific
section). The reference here is the canonical format; project-side
CLAUDE.md is where projects bind the rule + their extensions.
