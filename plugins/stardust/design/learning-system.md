# Stardust learning system — design v1

> Status: **locked from designer review.** All v0 open questions are
> resolved (see §8). Nothing here is implemented yet — the doc now informs
> the spec and implementation work that follows.

## Why this exists

Two observed weaknesses in stardust today:

1. **Within-brand sameness.** Multiple proposals for one site tend to share a
   skeleton and differ mostly on tokens (palette, spacing).
2. **Cross-brand sameness.** Designs across *different* brands also converge on
   a recurring vocabulary, so a fintech and a children's product can end up
   structurally similar.

Both failures are structural, not chromatic. The fix is a **moves catalog**
that grows under designer guidance, plus a contract that forces every proposal
to commit to a *design grammar* — not a paint job — before color is chosen.

## Scope

In scope for this design:

- Move-combination contract.
- Exemplar / critique corpus (format-agnostic input).
- The shared `design-facts` shape (the interface every ingester produces).
- Designer-driven move contribution pipeline.
- Mining / retirement loop.

Out of scope (separate sessions):

- **Figma-as-extract-source** (Figma file as the *source of truth* for a
  redesign). Depends on `design-facts` being defined here; otherwise its own
  doc.
- Any implementation. This doc is design only; the spec and code follow.

---

## 1. Move-combination contract

A **move** is a single, named design decision along one axis. Examples:

- `layout/asymmetric-grid`, `layout/full-bleed-cinematic`, `layout/horizontal-scroll`
- `type/editorial-serif-display`, `type/mono-led`, `type/poster-scale`
- `image/photographic-edge`, `image/abstract-only`, `image/no-imagery`
- `motion/kinetic`, `motion/still-but-precise`
- `tone/dry-witty`, `tone/declarative`, `tone/poetic`

Each move carries:

```
id:           layout/asymmetric-grid
axis:         layout
summary:      one line
when_to_use:  short note grounded in brand axes
when_not_to_use: short note
exemplars:    [exemplar-id, exemplar-id, ...]
provenance:   { added_by, from_session, captures: [...] }
```

**Proposal contract** (enforced at `prototype` time):

- A proposal commits to **≥3 moves spanning ≥3 different axes** *before* color
  is chosen.
- A set of N proposals must **pairwise differ by ≥2 moves** — not by tokens
  alone.
- A **default-combinations registry** flags slop combos (e.g.
  `layout/centered-hero` + `type/sans-default` + `motion/none`). Proposals
  matching one are auto-flagged for divergence.
- **Brand-justification rule.** Stardust has no default move set. Every chosen
  move must be traced to a fact about the extracted brand (audience,
  tactility, formality, scale, etc.). No move may be picked by inertia.

The brand-justification rule is the cross-brand safeguard: if every move is
brand-traced, two different brands can't accidentally land on the same
skeleton.

---

## 2. Exemplar / critique corpus

Two locations:

- `stardust/exemplars/` — plugin-shipped, curated reference set.
- `stardust/critiques/` — per-redesign, generated during a session.

**Entry schema** (one YAML/MD file per exemplar):

```
id:           tactile-chairs-2024
source:
  kind:       url | figma | image | pdf | video
  ref:        <URL or path>
  facts:      <design-facts block — see §3>
verdict:      stunning | strong | competent | slop
moves:        [layout/asymmetric-grid, type/editorial-serif-display, ...]
brand_axes:   [tactile, niche, editorial]
designer:     <handle>
why:          1–3 lines on what makes it work (or fail)
anti_pattern: optional tag (e.g. "gradient-blob-hero")
```

**`brand_axes` are open tags, not a fixed enum.** Designers describe brands
in their own vocabulary; the corpus accepts that. Cost: near-duplicates will
appear (`playful` / `whimsical` / `joyful`) and the curator pass is
responsible for periodic merges, not the contributor.

**Verdict has four levels: `stunning | strong | competent | slop`.**
`competent` is the most load-bearing — it's where most failures hide.

**Anti-patterns live in the same corpus**, as entries with `verdict: slop`
plus an `anti_pattern` tag. Symmetric storage means stardust can use them
without a second read path.

**Read path.** At `direct` time, stardust filters the corpus by the *target
brand's* `brand_axes`, not by visual similarity. Surfaces ~3 `stunning` + 1
`slop` as anchors before generating. At `prototype` time, the chosen moves
are checked against exemplar tags so generated variants point back to real
references.

**Verdict + 1–3 line `why` is the maximum.** No essays. Depth comes from
volume of entries, not length of any one entry.

---

## 3. The `design-facts` shape (shared interface)

Every ingester — URL crawler, Figma reader, vision-on-image, PDF parser,
video frame sampler — produces the same structured shape. This is the only
contract the rest of stardust depends on.

```
design-facts:
  layout_grammar:    { primary, secondary, rhythm }
  type_system:       { display, body, scale, tone }
  palette:           { roles[], temperature, contrast }
  motion_personality: { ... }
  image_strategy:    { ... }
  tone_signals:      [ ... ]
  observed_moves:    [ move-id, ... ]
```

Filling this shape from a URL is what `extract` already does today (in spirit).
Filling it from Figma, image, PDF, video is new ingestion plumbing — but the
output is identical.

This shape is the **only** dependency that future work (Figma-as-extract,
image-as-direction-reference) takes from this session.

---

## 4. Move contribution pipeline (designer-driven growth)

A fixed catalog just relocates the house-style problem. The catalog must grow
without becoming a curation tax. Four steps:

1. **Capture** — designer (~30 seconds). Sees something striking. Submits
   source (URL / Figma frame / screenshot / etc.) + one line: *"what is this
   doing that's different?"* Stored in `stardust/captures/`.
   - **Frictionless or it dies.** No taxonomy work at this step. No axis
     tag. No required fields beyond `source` and one sentence.
2. **Cluster** — curator pass. **Queue-driven cadence:** the pass triggers
   when any cluster reaches **≥2–3 captures of the same underlying idea**,
   not on a calendar. A lone capture waits. This guards against one
   designer's idiosyncratic taste becoming canon and keeps curation
   reactive to real signal density rather than the clock.
3. **Abstract** — curator + originating designer. Turn the cluster into a
   named move with the §1 schema. Originating designer signs off that the
   abstraction matches what they captured.
4. **Promote** — move enters `divergence-toolkit.md` with full provenance
   (who, which captures, which session). Now eligible for proposals.

Two side paths:

- **Direct authoring.** Senior designers can author a move without going
  through capture, when they can already articulate the abstraction. Rare,
  used for foundational entries.
- **Stardust-proposed candidates.** Stardust scans an extracted exemplar and
  proposes *candidate* moves it observes. Designers validate or reject —
  designers stay the gate.

---

## 5. Retirement and the house-style audit

Growth without pruning recreates the original problem at higher cost.

- A periodic **histogram audit** of moves used across all redesigns stardust
  has produced.
- **Owned by a lead designer, run manually.** Stardust generates the raw
  histogram; the lead designer interprets it. Automation would catch drift
  mechanically but miss qualitative slop, which is exactly the failure mode
  the audit is meant to detect.
- Moves that dominate regardless of brand → demote (treat as default-combo
  warning).
- Moves unused for N sessions → retire (move to archive, not deleted, with
  reason recorded).

---

## 6. Mining loop (how feedback evolves the system)

```
critique session  →  raw critiques  →  curator pass  →  divergence-toolkit.md
                                                     →  new exemplar entries
                                                     →  new anti-patterns
                                                     →  candidate moves queue
```

- A **critique session** is lightweight: designer reviews 5 proposals, leaves
  a verdict + 1–3 line `why` per proposal. ~15 minutes.
- A **curator pass** (human, or stardust-with-review) extracts: new moves
  named, new anti-pattern tells, exemplar additions, retirement candidates.
- Each pass updates the toolkit and exemplar corpus with provenance (who,
  when, from which session).

---

## 7. Tradeoffs to flag for the designers

- **Frictionless capture is load-bearing.** Any field added to capture step 1
  costs us contributions. Resist the urge to ask for more upfront.
- **Curation discipline is the bottleneck, not capture volume.** A regular
  curator cadence matters more than a big capture queue.
- **Brevity is structural.** Verdict + 1–3 lines per critique. If a thought
  needs more, it should become its own exemplar, not a longer note.
- **Catalog growth needs a deletion discipline.** The histogram audit is the
  mechanism; without it, the catalog bloats and stops being useful.

---

## 8. Decisions log (resolved from designer review)

All v0 open questions, with the resolved answer and a one-line rationale.

1. **`brand_axes` — open tags, not a fixed enum.** Truer to how designers
   describe brands. Curator owns periodic de-duping.
2. **Verdict — keep four levels** (`stunning | strong | competent | slop`).
   Granularity is worth the slightly higher annotation cost; `competent` is
   where the failures hide and we don't want to lose it.
3. **Curator cadence — queue-driven.** Pass triggers when a cluster reaches
   ≥2–3 captures, not on a calendar. Reactive to signal density.
4. **Histogram audit — manual, owned by a lead designer.** Stardust
   generates the raw histogram; interpretation is human. Automation would
   miss qualitative slop, which is the failure the audit is for.
5. **Anti-patterns — one corpus.** Same schema, `verdict: slop` +
   `anti_pattern` tag. Lets stardust use them symmetrically with exemplars.
6. **Move-combination floor — ≥3 moves spanning ≥3 axes.** Confirmed.
7. **Capture step — source + one sentence, no axis tag.** Confirmed.
   Frictionless contribution outweighs cheaper clustering.
8. **Verdict vocabulary — `stunning | strong | competent | slop`.**
   Confirmed. "Slop" is loaded but precise.

---

## What happens next

- Pin the **`design-facts` shape** (§3) as a standalone spec — this is the
  interface every future ingester depends on (URL crawler, Figma reader,
  vision-on-image, PDF parser, video frame sampler).
- Add a `learning-system.md` in `reference/` describing **runtime behavior**
  (what stardust reads at `direct` and `prototype` time). This doc stays as
  the design rationale.
- Extend `divergence-toolkit.md` to formalize the move schema in §1.
- Land empty `stardust/exemplars/`, `stardust/captures/`, `stardust/critiques/`
  scaffolding with READMEs explaining contribution.
- Open a separate session for **Figma-as-extract-source**, dependent on §3.
