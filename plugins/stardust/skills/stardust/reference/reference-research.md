# Reference Research

The positive-space counterpart to the divergence toolkit. The toolkit's
§ 1 lists are *negative space* — recurring assistant defaults that need
per-hit justification. This procedure supplies the *positive space*:
grounding visual-direction decisions in named, real-world references
researched at run time, instead of (or before) rolling deterministic
entropy from § 2's seed lists.

Loaded whenever a skill is about to make a visual decision and wants an
external anchor: `direct` (anchor + palette + dimension resolution),
`prototype` (Discipline 2 composition alternatives), `uplift`
(dated-pattern citations, variant B's composition anchor), `audit`
(category benchmarks), `migrate` (Path B unique-page patterns).

**Status:** v1.0 (stardust 0.14). Introduced in the Fable 5 refactor.
The deterministic seed roll in `divergence-toolkit.md` § 2 remains the
documented fallback; it is no longer the default path.

---

## 1. Availability ladder

Probe once per run and record the resolved tier in the consuming
artifact's provenance:

1. **Refero MCP** (best) — the `mcp__refero__*` tools:
   `refero_search_styles` (visual language of real marketing/product
   sites), `refero_search_screens` (concrete UI patterns),
   `refero_get_style` (full token system: colors + roles, type scale,
   spacing, radii, components, do/don'ts, imagery, layout),
   `refero_get_similar_screens`, `refero_search_flows`. Probe by
   issuing the first real search; a tool-not-found or auth error
   drops to tier 2.
2. **WebSearch / WebFetch** — search *"best `<vertical>` website
   design `<year>`"*, *"`<register>` web design reference"*; fetch and
   study 2–3 results. Weaker evidence (no token systems), still named
   and citable.
3. **Neither reachable** — skip research. Fall back to the
   deterministic seed roll (`divergence-toolkit.md` § 2) and record
   `picked_by: "deterministic (research unavailable)"`.

Never block on research: a failing tier drops down the ladder after
one retry, and the run proceeds.

## 2. Procedure (anchor research at direct time)

1. **Compose 2–3 queries** from: the brand's industry/vertical, the
   brand-personality adjectives (captured `PRODUCT.md` / resolved
   direction), and the direction movement being resolved (*"calm
   premium healthcare, editorial serif, trust-led"*). Search styles
   first (visual language); screens only when a concrete pattern
   question is open.
2. **Select 3–5 candidates from the previews**, maximizing
   *diversity* — five variations of one look teach nothing. Include
   at least one out-of-category reference that shares the brand's
   register (a museum site for a calm clinic; a hardware catalogue
   for an industrial tools brand).
3. **Retrieve depth on the top 2–3** (`refero_get_style`). Full
   styles are large (10–15k chars); never retrieve more than 4 per
   run phase. Keep retrieved text out of authored artifacts — store
   the synthesis and the citation, not the dump.
4. **Tag each reference against the anti-toolbox** (toolkit § 1):
   `in-toolbox` (the reference itself exemplifies an assistant
   default) or `off-toolbox`. Require **≥ 1 off-toolbox reference
   per variant** — this extends toolkit § 5's reference-use
   discipline to researched references: research that only confirms
   the defaults is rubber-stamping, and a variant whose references
   are all in-toolbox refuses.
5. **Extract implied dimensions** per Mode B's mapping
   (`direct/SKILL.md` § Mode B): decade, craft, register,
   ground-family implied by each anchor — plus typography strategy,
   palette strategy, section rhythm, imagery treatment.
6. **Synthesize, don't copy**: pick one primary anchor for mood and
   density; borrow 1–2 specific treatments from the others. The
   captured brand surface always wins conflicts under Mode A —
   references inform *strategy, composition, and rhythm*; they never
   replace pinned palette or type.

## 3. Evidence shape

Every reference used lands in provenance as:

```json
{
  "source": "refero | websearch | model-memory",
  "title": "Joby Aviation",
  "url": "https://www.jobyaviation.com",
  "previewUrl": "https://images.refero.design/…/preview_0.jpg",
  "styleId": "e38f56d1-…",
  "grounds": "hero density + curved-container motif justify the arrival-register composition",
  "tag": "off-toolbox"
}
```

Storage:

- `direct` → `DESIGN.json.extensions.divergence.references_used[]`
  (same slot toolkit § 5 already defines) and per-dimension
  `picked_by: "reasoned: <anchor/basis>"` in the seed record.
- `prototype` / `uplift` / `audit` artifacts →
  `_provenance.referencesUsed[]`.

## 4. Hard rules

- **References ground the MOVE; captured evidence grounds the
  TRAIT.** A composition or treatment borrowed from a reference must
  still serve a captured brand trait or a cited improvements-list
  item. Research never overrides the fabricated-content ban, IA
  -priority preservation, or signature preservation.
- **Mode A pins hold.** Never port a reference's palette or type
  into a brand-faithful render. (The brand-adjacent refinement tier
  in `direct/SKILL.md` § Mode A+ has its own evidence bar and does
  not run through this procedure.)
- **Cite only what was retrieved.** Naming references from training
  memory is forbidden while research is available. When research is
  *unavailable* and a from-memory reference is still useful, mark it
  `source: "model-memory"` and treat it as untrusted — it cannot be
  the sole justification for a move.
- **Budget:** ≤ 5 searches + ≤ 4 full-style retrievals per run
  phase. Research is an anchor pass, not a survey.

## 5. Consumption map

| Consumer | Fires at | What research supplies |
|---|---|---|
| `direct` § Phase 2 | Default mode + Mode B | Anchor references → implied seed dimensions (`picked_by: "reasoned: …"`), palette strategy, density calibration |
| `prototype` Discipline 2 | Anti-template pass | Real composition alternatives per captured pattern, cited in `antiTemplatePass[]` |
| `uplift` Phase 2.5 | Reference grounding | Contemporary counter-examples for dated-pattern claims; variant B's named composition anchor; C-register verification |
| `audit` Phase 5 | Benchmarking | 2–3 same-vertical references the audited site is compared against |
| `migrate` Path B | Unique-page render | Named pattern for from-scratch pages (404, search, empty states) |
