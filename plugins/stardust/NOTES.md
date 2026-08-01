# stardust — implementation notes

Running list of things to implement. Captured in-session; not yet acted on.
Each entry records the idea, findings from a look at the current code, and a
recommendation, so the work can start without re-deriving the context.

---

## 1. Write a project-side `CLAUDE.md` from the stardust skills

**Idea.** Have the stardust skills write a `CLAUDE.md` into the project they
run against, so the project itself carries instructions covering what has been
done and the design / implementation specifications.

### Findings

- `skills/stardust/reference/journal-format.md:138` (§ Project-side CLAUDE.md
  companion) already *assumes* the project has a CLAUDE.md carrying the journal
  rule — but no skill ever writes it. Today it's an instruction to the human
  that quietly doesn't happen.
- `CHANGELOG-redesign-adobecom.md:183-184` records that in the adobecom
  project, the project-side CLAUDE.md was load-bearing: it declared both the
  journal rule and the recursive validate-and-fix loop, and both were credited
  with catching real bugs. So the pattern is proven — it was just done by hand.
- The gap CLAUDE.md uniquely fills: it is the only file read automatically at
  session start with no skill invoked. `stardust/state.json`,
  `stardust/journal.md`, `PRODUCT.md`, `DESIGN.md`, `DESIGN.json` all require
  an agent that already knows to look for them. A fresh session — or a
  teammate without the plugin installed — currently has no entry point.

### Recommendation: rules-and-map, not a state snapshot

**Include** (durable across the project lifetime, written ~once):

- Artifact map + which file is authoritative for what:
  - `stardust/state.json` — what is (per-page state machine)
  - `stardust/journal.md` — how the project got here (chronological)
  - `PRODUCT.md` / `DESIGN.md` / `DESIGN.json` — the target spec
  - `stardust/current/` — extracted source-of-truth content
  - `stardust/prototypes/` — generated, do not hand-edit
- Session-start read order (state.json first, then last 3-5 journal entries —
  mirrors `journal-format.md` § Reading the journal at session start).
- The journal rule (verbatim from `journal-format.md:143-146`).
- The recursive validate-and-fix loop rule (render → check → fix → re-render).
- Don't-hand-edit warnings for generated artifacts.

**Exclude:**

- "What has been done." Already `state.json` + `journal.md` + provenance,
  updated transactionally by each skill. A CLAUDE.md copy is stale after the
  next command; rewriting it every turn just builds a worse journal.
- Design specs restated. `DESIGN.md` / `DESIGN.json` are the spec. A paraphrase
  becomes a second source of truth that silently diverges.

Rule of thumb: CLAUDE.md points *at* the artifacts and states the rules for
working with them. It never duplicates their contents.

### Mechanics to settle

- **Managed block.** Wrap stardust's content in
  `<!-- stardust:begin -->` … `<!-- stardust:end -->`. Re-runs rewrite only
  that block; anything outside is user territory and is never touched. Leave an
  explicit "project-specific extensions" heading below the block — this is the
  seam `journal-format.md:148-151` describes, where projects bind the default
  rule plus their own extensions.
- **Owner: `extract`.** First skill to run, already scaffolds `stardust/` and
  writes the initial `state.json`. Alternative is a shared step in the master
  skill's § Setup, which would cover projects entered mid-pipeline — worth
  considering if any skill can legitimately run before `extract`.
- **Existing file.** Append the managed block; never overwrite.
- **No existing file.** Ask before creating. Same zero-config-vs-stale-clutter
  tradeoff as open question 4 in `CHANGELOG-redesign-adobecom.md:222`
  (auto-seeding `stardust/journal.md` on extract). Decide both the same way —
  they're the same question about how much unrequested scaffolding stardust
  should drop into someone's repo.
- **Re-runs / `--re-direct`.** Block content is spec-independent, so a
  direction change shouldn't need to touch it. Confirm this holds once the
  block contents are final — if anything direction-specific creeps in, it
  belongs in `DESIGN.md` instead.
