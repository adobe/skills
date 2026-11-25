# stardust:stardust: journal rule

The text of this part of `skills/stardust/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

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
