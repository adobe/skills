# Mode A+ — Brand-adjacent refinement (bounded, evidence-gated)

Consumed by `stardust:direct` Phase 2 when an improvements-list
item names a captured type or color weakness with evidence.

The middle tier between Mode A's hard pins and `--rebrand`. It exists
because the median redesign candidate is a site whose brand is right
but whose *execution* of that brand is part of the problem — a
generic system body face, a palette whose only accent fails contrast
on half its surfaces. Strict Mode A reproduces those weaknesses;
rebrand throws away the brand. Mode A+ authorizes **bounded
upgrades**, each gated on evidence:

- **Same-classification type upgrade.** When the improvements list
  (Phase 2.5) names the captured *body or system* face as a weakness
  with evidence (illegibility at captured sizes, a generic system
  stack where the brand deserves a voice, missing weights/axes the
  layout needs), the body face may be upgraded to a
  same-classification, deliverable face (humanist sans → humanist
  sans; grotesque → grotesque). **The display face stays pinned** —
  it carries the brand's recognition.
- **Single-role palette recolor.** When a specific captured color
  fails contrast or hierarchy *as evidenced* (computed ratio cited,
  or a `T-color-imbalance` tension), that one role may be re-derived
  (deepened, re-weighted) while every other role stays pinned. New
  hues from outside the captured family remain forbidden.

Contract: each refinement is recorded in
`DESIGN.json.extensions.divergence.brand_adjacent_refinements[]` as
`{ kind, captured, replacement, evidence, improvementsItem }` — an
inversion-style audit entry citing the improvements-list item that
authorizes it. No evidence citation → no refinement. Mode A+ never
activates by default: it requires the qualifying improvements-list
item, and the plan surfaces each refinement explicitly (*"body face
upgraded Arial → Hanken Grotesk per improvements #3; display face
pinned"*) so the user (or the hands-off record) sees exactly what
moved. Refinements do not run through reference research — their
justification is the captured weakness, not an external anchor.
