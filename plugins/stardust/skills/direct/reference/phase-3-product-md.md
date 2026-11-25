# stardust:direct: phase 3, PRODUCT.md

The text of this part of `skills/direct/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 3 — Author target PRODUCT.md

File order: stardust's `<!-- stardust:provenance … -->` block first
(per `../stardust/reference/artifact-map.md` § Provenance, as for
every stardust-written artifact), then `# Product`, then the
`<!-- impeccable:product-schema 1 -->` comment verbatim so impeccable
reads the file as a current product record rather than a legacy one.
Omit a section rather than filling it with generic prose. Sections to
populate:

- **Platform** — the bare value `web`.
- **Users** — from the resolved audience tuple plus tone signals from
  the extracted brand surface.
- **Product Purpose** — from the user's phrase + extracted hero copy
  + resolved tone, written as a one-line value statement followed by
  one-line scope.
- **Positioning** — the claim the site makes that a neighbour could
  not truthfully copy, from the extracted hero and proof copy. Mark
  inferred when the copy does not state it.
- **Capabilities and Constraints** — the resolved constraint set
  (`a11y-first`, `RTL-required`, platform or content constraints) and
  any product fact the user pinned.
- **Brand Commitments** — the binding identity decisions: the resolved
  `register` axis, the brand personality derived from the resolved
  expressive axis + tone + reference set (weight axes the user
  explicitly moved over inherited values), and the anti-references —
  the user's stated anti-refs **plus** any anti-toolbox guardrails
  relevant to the resolved direction (e.g. "modernise" triggers the
  Generic-2026-SaaS silhouette guardrail; list it explicitly so
  prototype and polish enforce it).
- **Evidence on Hand** — the captured copy, imagery and proof under
  `stardust/current/` with paths, and the absences future work must
  not fabricate (no testimonials captured, no pricing, …).
- **Product Principles** — 3-5 durable strategic principles, each
  mapping to a specific axis movement. Format: one verb-led principle,
  one-line elaboration. No visual recipes; those belong in DESIGN.md.
- **Accessibility & Inclusion** — populated when the constraint set
  includes `a11y-first`, `RTL-required`, or similar. Otherwise omit
  and inherit impeccable's defaults.

Where a section cannot be populated with confidence from inputs,
mark it `<!-- _provenance: inferred -->` with a one-line basis
sentence. Never invent strategy.
