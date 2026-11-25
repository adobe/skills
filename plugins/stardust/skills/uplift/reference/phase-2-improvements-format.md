# stardust:uplift: phase 2a, improvements format

The text of this part of `skills/uplift/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

#### 2a — `stardust/uplift-improvements.md`

Format (mirrors the provenance shape used by the rest of stardust):

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

The bracketed tag preceding each weakness is a category from the
list above. The headline is the one-sentence summary the agent will
restate when variant A's shape brief applies the fix.
