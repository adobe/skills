# Contributor session — runtime behavior

This file defines what stardust does when a user identifies themselves
as a **contributor** to the learning corpus and asks for guidance. The
session is alive — stardust reads the corpus state, the contributor's
own history, and the corpus's current gaps, and generates a plan
specific to the moment.

This replaces the static "read CONTRIBUTING.md" entry path as the
primary contributor experience. CONTRIBUTING.md remains as reference
material for those who prefer to read first.

---

## Trigger phrases

Stardust enters contributor-session mode when the user says any of:

- *"I am a contributor"* / *"I'm a contributor"*
- *"I want to contribute to the corpus"* / *"to stardust"*
- *"Help me contribute"*
- *"What should I do as a contributor?"*
- *"Start a contributor session"*

Recognition is intent-driven, not literal. Synonyms and rephrasings
count. If the trigger is ambiguous (the user could mean code
contributions), ask one clarifying question before entering the
session.

## Session structure

A contributor session has four phases. Stardust executes them in order
unless the contributor redirects.

### Phase 1 — Identify and load context

1. **Resolve the contributor's handle.** Resolution is layered;
   stop at the first source that returns a value:
   1. **Persistent handle file** at `~/.stardust/contributor.yaml`
      (user-level, survives across projects). Schema:
      ```yaml
      handle:        <canonical handle>
      saved_at:      <ISO-8601>
      git_config_at_save: <verbatim git config user.name | null>
      ```
   2. **`git config user.name`** (then `user.email` as fallback).
   3. **Prompt the contributor** if neither resolves: *"What handle
      should I record your contributions under? I'll save this so I
      don't have to ask again."* Write the answer to
      `~/.stardust/contributor.yaml`. Create the directory if absent.
2. **Verify against git config (when both exist).** If the
   persistent file's `handle` differs from current `git config
   user.name`, ask once: *"I have you saved as `<handle>` but git
   config says `<git-handle>`. Which should I use going forward?"*
   Update the persistent file with the answer. Do not silently switch.
3. **Scan the corpus for their history** using the canonical handle.
   Look across:
   - `<user-project>/stardust/captures/` and
     `plugins/stardust/captures/` for files where `submitted_by`
     matches the handle.
   - `<user-project>/stardust/critiques/` and
     `plugins/stardust/exemplars/` for files where `designer`
     matches the handle.
   - `plugins/stardust/skills/stardust/reference/divergence-toolkit.md`
     §1a for moves whose `provenance.added_by` or
     `provenance.signed_off_by` matches the handle.
   - `plugins/stardust/audits/curator-pass-*.md` for explicit
     mentions.
4. **Classify them as one of:**
   - **First-time** — no prior submissions found.
   - **Returning, no pending** — has submissions; nothing currently
     awaits their action.
   - **Returning, has pending** — has submissions; at least one
     candidate move awaits their signoff, or at least one of their
     captures has clustered.

If the corpus contains submissions under a *different* handle that
the contributor recognizes as theirs (e.g. older captures under
`alex.smith` while their current handle is `alex`), surface this and
ask: *"I see N captures under `alex.smith` — should I treat those as
yours too?"* If they say yes, record an alias in the persistent file:

```yaml
handle:    alex
aliases:   [alex.smith]
```

Subsequent scans treat aliases as equivalent to the canonical handle.

### Phase 2 — Compute corpus needs

Read the current corpus state and identify gaps the contributor
could address. Possible gaps:

- **Axis under-represented.** A move axis (`layout`, `type`, `palette`,
  `image`, `motion`, `tone`, `structural`) with fewer than 2 promoted
  moves in §1a. Flag as: *"the corpus has only N moves on the
  `<axis>` axis; we'd benefit from observations there."*
- **Brand-axis territory under-represented.** A `brand_axes` tag
  cluster (e.g. `playful`, `mass-market`, `technical`) appearing in
  fewer than 3 exemplars. Flag as: *"we have thin coverage of
  `<tag>` brands."*
- **Slop corner empty.** Fewer than 1 `verdict: slop` exemplar in a
  brand_axes territory we have stunning entries for. Flag as: *"we
  have positive examples for `<territory>` but no anti-pattern
  entries — a slop critique would help."*
- **Stale candidates.** Candidate moves in
  `plugins/stardust/captures/candidates/` with no signoff for >30
  days. Flag as: *"these candidates have been waiting; a fresh look
  could move them or close them."*

If the contributor's history shows expertise in a territory (their
critiques cluster around `editorial` exemplars, say), surface gaps
in that territory first.

### Phase 3 — Generate the session plan

The plan is **specific, actionable, and short**. Write it as an
ordered list of suggested next actions, each one sentence + a
one-line rationale. Show the contributor's history summary first if
they're returning.

**First-time contributor template:**

```
Welcome. Stardust learns from designers who notice things; the
corpus turns that signal into named "moves" that proposals
intentionally commit to.

Pick one to start with:

1. Capture something striking you've seen recently.
   ($ stardust capture <source> -- "<one-line note>")
   This is the lowest-friction contribution; clusters of similar
   captures become candidate moves.

2. Critique a proposal stardust has generated.
   (Write a YAML entry under stardust/critiques/, or describe the
   proposal here and I'll help you frame the critique.)
   Critiques are higher-effort but higher-signal.

The corpus could most use:
  • <gap from Phase 2, e.g. "more motion-axis observations">
  • <second gap if relevant>

Tell me which feels right and we'll start.
```

**Returning, no pending template:**

```
Welcome back, <handle>. Cumulative impact:
  • <N> captures submitted
  • <M> contributions promoted to the catalog directly traceable
    to your work
  • <K> critiques in the corpus

Most useful next move would be:
  • <gap from Phase 2, ranked by overlap with their history>

Or — anything specific you want to capture or critique today?
```

**Returning, has pending template:**

```
Welcome back, <handle>. One thing waiting on you:

  Candidate move: candidate/<axis>/<short-name>
  Originated from your captures:
    • <capture-id> — "<sentence>"
    • <capture-id> — "<sentence>"
  Curator's draft abstraction:
    summary: <one line>
    when_to_use: <short note>
    when_not_to_use: <short note>

Does this abstraction match what you saw? Three answers are
possible:
  • Sign off — and the curator PRs it into §1a with you cited.
  • Revise — and the curator updates and re-shows.
  • Reject — and the captures return to the queue.
```

### Phase 4 — Execute and narrate impact

As the contributor takes actions during the session, narrate the
*impact* of each action immediately, using the corpus state to make
it concrete. Avoid generic encouragement; describe what actually
happens to their input.

**On a capture landing:**

```
Captured: <id>
  source: <kind, ref>
  sentence: "<verbatim>"

Effect on the queue:
  • <how it interacts: e.g. "joins 1 prior capture from <handle>
    describing a similar pattern; clustering threshold reached.
    Likely candidate-move PR in the next curator pass.">
  • OR "first capture of its kind; waits for company."
```

**On a critique landing:**

```
Critique recorded: <id>
  verdict: <level>
  mode: <quick | qualified | comparative | conversation>

Effect on the corpus:
  • <e.g. "the counterfactual you noted ('would be stunning if X')
    is the kind of signal that seeds new moves; flagged for the
    curator's pass.">
  • <e.g. "the failing_moves entry agrees with 2 prior critiques on
    the same move; this is starting to look like a default-combo
    that needs registering.">
```

**On a signoff:**

```
Signed off: candidate/<axis>/<short-name>
  Now eligible for promotion via PR.
  Cited as: provenance.signed_off_by = <handle>

Cumulative effect:
  • <N> moves in §1a now cite you in provenance.
  • Your eye is now visibly part of how stardust selects moves
    when a brief commits to <axis> on a <brand_axes> redesign.
```

### Session close

When the contributor wraps, summarize the session and the next
natural step:

```
Session summary:
  This session — 1 capture, 1 qualified critique, 1 signoff.
  Cumulative — <N> captures, <M> promoted moves, <K> critiques.

Next natural step (whenever you're back):
  • <suggestion based on what's now pending, or a fresh gap>
```

---

## Hard rules

- Never invent contributor history. If the corpus scan returns
  nothing, the contributor is first-time; do not pretend otherwise.
- Never describe impact in vague terms ("this will be valuable",
  "thank you for contributing"). Either describe a concrete effect
  on the corpus state, or say nothing.
- Never auto-submit on behalf of the contributor. Every capture,
  critique, and signoff is an explicit action they take in the
  session.
- Never skip Phase 1. Identifying the contributor and their history
  is what makes the session live; without it the session degrades to
  reading the static doc.
- Never recommend more than 2–3 next actions in the plan. The
  point is direction, not options.

## What this session deliberately does NOT do

- **Replace `--new-contributor`.** That flag still exists for
  contributors who prefer the CLI walkthrough without conversation.
  The session is the conversational alternative.
- **Track time.** No estimates of how long capture or critique
  takes; contributors decide.
- **Score contributors.** No leaderboard, no rankings, no streaks.
  Cumulative impact is reported because contributors asked for
  visibility into what their work produced — not as a gamification
  layer.
- **Override the corpus contracts.** A contributor session can
  produce captures and critiques, but never bypasses the curator
  pass, never auto-promotes, and never edits §1a directly.

## References

- `plugins/stardust/CONTRIBUTING.md` — static reference for those
  who prefer to read first.
- `plugins/stardust/skills/capture/SKILL.md` — the capture
  sub-skill the session delegates to.
- `plugins/stardust/design/curator-pass.md` — the curator workflow
  the session's signoff phase feeds into.
- `plugins/stardust/skills/stardust/reference/learning-system.md`
  — runtime contract for the corpus the session reads from.
