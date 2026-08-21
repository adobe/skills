# Cross-site brand inputs (--design-source / --brand-source)

Consumed by `stardust:direct` Setup step 3b when extract captured
brand signal beyond the primary origin.

Two extract-written signals widen the brand surface beyond the
primary origin:

- `state.json.designSource` — design-donor mode (extract ran with
  `--design-source <url>`). The donor's derived system at
  `stardust/canon-source/DESIGN.{md,json}` becomes the **target**
  the Mode A pins bind to: palette and type pin to the *donor*
  surface while content, IA priorities, and per-page evidence stay
  with the primary origin. Surface in the plan: *"Design-donor
  mode — target system inherited from <donor-url>."*
- `_brand-extraction.json.origins[]` — sibling-property evidence
  captured via `--brand-source`. Traits captured on a sibling
  origin count as **captured evidence** for trait amplification
  (variant B/C briefs, improvements items) exactly like
  primary-origin evidence; cite the origin in the evidence
  citation. Under Mode A the *pins* still come from the primary
  origin unless designSource says otherwise — sibling evidence
  widens what can be amplified, not what is pinned.
