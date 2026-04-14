# Task-Specific Analysis Guidance

Apply the guidance below based on the type of task being analyzed.

## Building a New Block

**Must analyze:**
- Author inputs — what content will authors provide (e.g., image, title, description, link)?
  - What's required vs optional?
  - What can be inferred or auto-generated?
- Variations needed
- Styling and layout expectations
- Interactive behavior requirements
- Responsive behavior across viewports

**DON'T design at this stage:**
- ❌ Table structure (how many columns/rows)
- ❌ Cell layout (which content goes in which cell)
- ❌ Block variant classes or naming
- ❌ Exact authoring format or field names
- ❌ Authoring experience details (always the goal, addressed later)

Focus on WHAT content is needed, not HOW it's structured. Content model design (table structure, cells, variants, authoring UX) happens in the content-modeling skill (CDD Step 3).

**Acceptance criteria should cover:**
- Styling and layout match requirements across viewports
- All variations work
- Interactive behavior functions as expected

---

## Adding a Variant to an Existing Block

**Must analyze:**
- What does the variant do?
- How does the author enable it? (class name? content marker?)
- Style-only (CSS) or behavior change (JS)?
- Styling/layout changes for the variant
- Responsive considerations

**Acceptance criteria should cover:**
- Variant styling/layout matches requirements across viewports
- Variant applies correctly when specified
- Existing variants/default behavior continue to function unchanged

---

## Modify Existing Block Behavior

**Must analyze:**
- What behavior is changing and why?
- Any impact to existing content using this block?
- Content/authoring implications of the change (what content needs to be updated and how)?
- JS and/or CSS changes needed?
- Responsive implications?

**Acceptance criteria should cover:**
- New behavior works as expected
- Existing functionality is not broken (regression check)
- Works across viewports
- Existing content still works

---

## CSS-Only Styling Change

**Must analyze:**
- What's changing visually
- Which viewports are affected
- Layout implications

**Acceptance criteria should cover:**
- Styling/layout changes match requirements across viewports
- No layout breaks
- No regressions

---

## Bug Fix

**Must analyze:**
- What is the bug?
- What should happen instead?
- Root cause (if not obvious)

**Acceptance criteria should cover:**
- Bug no longer occurs
- No regressions (existing behavior unchanged)
- Works across viewports, if relevant

