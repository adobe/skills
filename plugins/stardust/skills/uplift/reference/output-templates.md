# uplift — output templates

Exact formats for the three artifacts `uplift` authors directly. Each
template is normative: field names, ordering, and wording anchors are
part of the contract, not illustration.

## § Improvements file (Phase 2a)

`stardust/uplift-improvements.md` mirrors the provenance shape used by
the rest of stardust:

```markdown
---
_provenance:
  writtenBy: stardust:uplift
  writtenAt: <ISO-8601>
  againstInput: <URL>
  readArtifacts:
    - stardust/current/_brand-extraction.json
    - stardust/current/pages/<slug>.json
    - stardust/current/brand-review.html
---

# Improvements — <URL>

1. **[<category-tag>]** <one-line headline> — <measurement /
   tension ID / screenshot observation> · <pattern at fault> ·
   fix: <one concrete fix>.
2. **[<category-tag>]** … (≥ 3 items; tags may repeat)
```

The bracketed tag preceding each weakness is a category from the list
in SKILL.md Phase 2a. The headline is the one-sentence summary the
agent will restate when variant A's shape brief applies the fix. When
audit findings were consumed, add the audit file to `readArtifacts`.

## § direction.md variant declarations (Phase 3d)

`stardust/direction.md` declares the resolved direction with one block
per variant (omit B under `--two-variants`):

```markdown
## Variant A — Faithful + improvements

Role: risk-averse green-light. "Yes, that's us, with the obvious
fixes."
Composition: same as captured.
Motion: static (no cinematic layer).
Improvements applied: <list from uplift-improvements.md>.

## Variant B — What if we amplified <captured trait>?

Role: design-team motivator. The brand's underused capability
foregrounded.
What if: "<one-line "what if…" framing>"
Captured trait amplified: <trait from uplift-questions.md>
Evidence: <captured citation>
Composition: <specific layout strategy that amplifies the trait>
Motion: static (no cinematic layer).

## Variant C — What if motion was part of the identity?

Role: visionary pitch. The brand's third dimension — kinetic.
What if: "<one-line "what if…" framing tied to the register>"
Cinematic register: <register> (auto-picked from PRODUCT.md
Brand Personality)
Captured trait amplified: <trait — the one register naturally
amplifies>
Evidence: <captured citation>
Composition: identical IA to A; the bet is motion, not layout.
Motion: cinematic, register <register>.
```

## § Three-pitch summary (Phase 6)

Printed in the chat after all variants mark `prototyped`:

```
uplift complete — three variants for <URL>

A · Tomorrow's version of the site you have today.
   Improvements applied: <count>.
   File: stardust/prototypes/<slug>-A-proposed.html
   Pitch: "yes, that's us, fixed."

B · What if we amplified <captured trait>?
   Trait: <name>.
   Composition bet: <one-line summary>.
   File: stardust/prototypes/<slug>-B-proposed.html
   Pitch: "the brand's underused capability, foregrounded."

C · What if motion was part of the identity?
   Cinematic register: <register>.
   Motion bet: <one-line summary>.
   File: stardust/prototypes/<slug>-C-cinematic.html
   Pitch: "the brand's third dimension."

Differentiation: A vs B ≥ 2 changes (✓), A vs C ≥ 2 changes (✓),
B vs C ≥ 2 changes (✓).

Validation: all three pass critique + audit + adapt; C additionally
passes motion validation Pass 6.

Next: iterate any variant via chat ("make B's hero quieter") or
approve via the standard prototype approval flow (records the
approval in state.json).
```

Under `--two-variants`, drop the B block and the A-vs-B / B-vs-C
differentiation lines.

## § Output tree

Full on-disk layout after a successful run:

```
stardust/
├── state.json                              ← extracted + 3× prototyped
├── direction.md                            ← resolved direction + 3 variant declarations
├── uplift-improvements.md                  ← load-bearing weakness list (≥ 3 items)
├── uplift-questions.md                     ← 6–8 "what if…" candidate list with disqualifications
├── current/                                ← from extract
│   ├── PRODUCT.md
│   ├── DESIGN.md
│   ├── DESIGN.json
│   ├── brand-review.html
│   ├── _brand-extraction.json
│   ├── _crawl-log.json
│   ├── pages/<slug>.json
│   └── assets/
└── prototypes/
    ├── <slug>-A-shape.md
    ├── <slug>-A-proposed.html              ← faithful + improvements
    ├── <slug>-B-shape.md
    ├── <slug>-B-proposed.html              ← "what if amplifying <trait>"
    ├── <slug>-C-shape.md
    ├── <slug>-C-proposed.html              ← static fallback for C
    ├── <slug>-C-cinematic.html             ← cinematic variant C
    ├── lenis.min.js                        ← copied from skill assets
    └── lenis.min.css

PRODUCT.md                                  ← shared (Mode A)
DESIGN.md / DESIGN.json                     ← shared
DESIGN-A.md / DESIGN-A.json
DESIGN-B.md / DESIGN-B.json
DESIGN-C.md / DESIGN-C.json                 ← carries motion.register
```
