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

---

## 2. Where project implementation memory should live (EDS skills)

**Idea.** As more archetypes and blocks get implemented, where should project
implementation memory be written, so users can build new site functionality
aligned with what has already been designed and implemented?

### Findings — what exists today

- `stardust/eds-conversion-log.md` is the only implementation memory. It is
  referenced exactly twice in the whole plugin, both loosely:
  - `deploy/SKILL.md:244` — "Lock the answers in writing (in
    `stardust/eds-conversion-log.md` or similar)"
  - `deploy/SKILL.md:957` — "Update ... (or create one) with: final block
    inventory, decisions locked, anti-patterns avoided this run"
  Free-form prose, no fixed path, no schema, and **no defined reader** — no
  step in any skill specifies reading it back.
- The Step 7 parallel-agent brief needs a list that has no source:
  `deploy/SKILL.md:588` — "**Existing blocks — REUSE, do not recreate**: [list
  with one-line authoring shape per block]". Today the orchestrator re-derives
  this by reading `blocks/` on every run. That re-derivation is exactly the
  thing that drifts.
- `stardust/eds-schema/<page>.json` (Step 2b) is the real ENCODE/DECODE
  contract — but it is keyed by **page**, not by block. Answering "what is the
  authoring shape of `cards`?" means locating some earlier page that used it.
- Nothing captures **page archetype composition** at all.

### Core call: memory belongs in the EDS repo, not in `stardust/`

`stardust/` is the redesign workspace — the right home for the *why* of a
one-time conversion. But someone adding a feature months later clones the EDS
repo and may not have `stardust/` at all. Implementation memory has to ship
with the code it describes.

### Proposed layers

**1. `blocks/<name>/README.md` — per-block contract (source of truth).**
Authoring shape (row/cell table), variant classes and what each does, decode
tier (template-slotted vs reconstructive, per `deploy/SKILL.md:246`),
component-model shape (simple / key-value / container), block-specific
gotchas. Co-location is the point: an agent opening `blocks/cards/` to reuse
the block gets the contract for free, and deleting the block deletes its doc.
Structurally cannot drift from the code.

**2. `blocks/registry.json` + generated `blocks/BLOCKS.md` — the index.**
Generated by a script from layer 1; never hand-maintained. Two payoffs:
- The Step 7 brief's "Existing blocks — REUSE" list becomes generated instead
  of improvised.
- One read answers "what do we already have" for any new work.
Consider a `--check` mode (CI/gate) asserting every `blocks/*/` has a README
and the registry is current.

**3. `stardust/eds-conversion-log.md` — unchanged, narrowed.**
Keeps the chronological *why*: naming ceremony answers locked, decisions,
anti-patterns hit this run. It is the journal, not the reference. Much of its
current drift comes from being asked to be both at once.

**4. Archetype map — the layer most likely to be missed.**
A block registry cannot express "a service page is `service-hero` →
`approach` → `closing`". Record archetype → ordered block composition + a
pointer to the reference content page that exemplifies it. "Build a new
service page" then resolves to "copy this one", which is what actually keeps
new work aligned. Home could be `content/ARCHETYPES.md`, or an `archetypes`
section in `registry.json` (generated from the deployed content pages).

### Connections

- Ties directly to note 1: the CLAUDE.md managed block should point at the
  registry and the archetype map. That is what makes any of this discoverable
  to a session that never invokes a stardust skill.
- `deploy/SKILL.md:236` ("scale the naming ceremony to the number of pages")
  gets easier with a registry: on a repeat run the reuse-vs-new question is
  answered from the registry instead of from the user.

### Open questions

- Who writes layer 1 — the per-block agent in Step 7 (knows the block best,
  but 3-4 agents writing in parallel need a fixed template), or a
  consolidation pass after? Leaning: block agent writes it, from a template in
  the brief; the registry generator validates presence.
- Does the registry go in `blocks/` or repo root? `blocks/` keeps it adjacent
  to what it indexes; root is more discoverable. Leaning `blocks/`, with the
  CLAUDE.md pointing at it.
- Should `stardust/eds-schema/<page>.json` gain a by-block index, or is the
  per-block README enough? Possible that the README's authoring-shape table
  should be generated from the schema rather than written by hand.
