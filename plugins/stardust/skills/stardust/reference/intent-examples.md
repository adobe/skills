# Intent reasoning — worked examples

These examples teach the **style** of reasoning. They are not a lookup
table. Two phrases that look similar may resolve to different plans
depending on register, prior direction, and constraints. Always run the
full procedure in `intent-reasoning.md`; use these only as calibration.

Each example shows: phrase → restatement → movement → gaps → questions
→ command sequence → reasoning. Some examples deliberately ask zero
questions; some ask the maximum two; some show the user pushing back on
an assumption.

---

## Example 1 — "make it better"

**Phrase:** "make it better"

**Restatement:**
- register: inherit from PRODUCT.md (assume `product` from existing site)
- expressive axis: not moved
- tone: not moved
- density: not moved
- distinctiveness: not moved
- audience: not moved
- constraints: not stated

**Movement:** *None of the directional axes.* The phrase is a quality
demand, not a directional one.

**Gaps:** What does "better" mean to the user? But the agent does **not**
ask this. "Better" has a default meaning in stardust: pass impeccable's
critique and audit cleanly. Asking would be pedantic.

**Questions:** None.

**Plan:**
1. `$impeccable critique stardust/current/` — score the existing site,
   surface P0/P1 issues.
2. `npx impeccable detect --json --fast stardust/current/` — deterministic
   anti-pattern scan.
3. For each P0 finding, pick the appropriate refine/fix command
   (`harden`, `clarify`, `optimize`).
4. `$impeccable polish` — final pre-ship pass.

**Reasoning shown to user:** "Better' has no direction in your phrase, so I
default to making the existing site pass impeccable's critique and audit.
If you want me to also push the design somewhere (bolder, quieter, more
distinctive), say so."

---

## Example 2 — "make it more expressive"

**Phrase:** "make it more expressive"

**Restatement:**
- expressive axis: moved (current → +1 step toward `drenched`)
- distinctiveness: implicitly moved (toward `distinctive`)
- everything else: not moved

**Gaps:** Audience and register.

**Questions:**
> 1. Who's the audience? (a) existing customers, (b) prospects we don't
>    have yet, (c) other — please describe.
> 2. Should this stay within the existing brand palette, or are we open
>    to swapping it? (a) keep palette, (b) open to new palette.

**Plan (assuming user picks "prospects we don't have" + "open to new
palette"):**
1. `$stardust direct` — write the resolved direction to
   `stardust/direction.md`.
2. `$impeccable shape stardust/current/index.html` — produce a Design
   Brief with the scene sentence anchored on the new audience.
3. `$impeccable craft` — primary expressive pass.
4. `$impeccable colorize` — palette swap, recommended pick from stardust's
   library if user wants.
5. `$impeccable typeset` — type voice that matches the expressive move.
6. `$impeccable critique` — verify we landed in the intended quadrant
   without slipping into AI-default territory.
7. `$impeccable polish`.

---

## Example 3 — "make it more expressive for a young audience"

**Phrase:** "make it more expressive for a young audience"

**Restatement:**
- expressive axis: moved toward `drenched`
- distinctiveness: moved toward `distinctive`
- audience: partially captured ("young")
- everything else: not moved

**Gaps:** "Young" is too coarse — Gen Z college students and 26-year-old
junior PMs are both "young" but want different things.

**Questions:**
> 1. Sharpen "young" — pick the closest: (a) Gen Z college / first-job, (b)
>    millennial professionals 25-35, (c) digital-native parents 30-40, (d)
>    other — describe.
> 2. Should the design feel native to a specific cultural reference set?
>    (Examples: indie publishing, gaming, streetwear, K-pop visual culture.)
>    Optional — say "skip" if you don't want to pin one.

**Plan (after answers):** identical shape to Example 2, but the **scene
sentence** in `shape` is filled with the resolved audience and reference
set. `colorize` and `typeset` are constrained by the cultural reference
set.

---

## Example 4 — "less corporate"

**Phrase:** "less corporate"

**Restatement:**
- distinctiveness: moved toward `distinctive` (away from `familiar`)
- tone: implicitly moved away from `serious`
- expressive axis: not moved (deliberately — "less corporate" is not the
  same as "louder")

**Movement note:** This phrase is mostly about *what to remove*, not what
to add. Distinguish from "more expressive" which is additive.

**Gaps:** None worth a question — the prompt is unambiguous in dimensional
terms.

**Questions:** None.

**Plan:**
1. `$impeccable distill stardust/current/` — strip corporate-default
   patterns (hero metric template, identical card grids, gray-on-color).
2. `$impeccable typeset` — replace corporate-default font reflexes (no Inter,
   no Plus Jakarta Sans, no DM Sans) with something with a point of view.
3. `$impeccable colorize` — replace corporate palette with something that
   carries tone.
4. `$impeccable critique` — confirm distinctiveness moved without
   sacrificing legibility.
5. `$impeccable polish`.

---

## Example 5 — "make it more accessible"

**Phrase:** "make it more accessible"

**Restatement:**
- constraint set: `a11y-first` pinned
- everything else: not moved

**Movement note:** Accessibility is a constraint, not a direction. The
plan is audit-driven.

**Questions:** None.

**Plan:**
1. `$impeccable audit stardust/current/` — score and find P0/P1 a11y
   issues.
2. `$impeccable harden` — i18n, edge cases, focus management,
   keyboard reachability.
3. `$impeccable clarify` — UX copy and labels, error messages with `aria-*`
   wiring.
4. `$impeccable polish` — final alignment with system tokens.

---

## Example 6 — "more Linear, less Salesforce"

**Phrase:** "more Linear, less Salesforce"

**Restatement:**
- register: pinned `product` (both anchors are product-register tools)
- expressive axis: moved toward `committed` (Linear) from `restrained`
  (legacy enterprise)
- density: moved toward `packed` (Linear is dense)
- distinctiveness: moved toward `distinctive`
- audience: implied — power users of category-leading tools
- constraints: anchor references = Linear, anti-references = Salesforce

**Movement note:** Anchor + anti-reference pairs are dense signal. Capture
both verbatim in the brief.

**Questions:** None.

**Plan:**
1. `$impeccable shape stardust/current/` — brief with anchor `Linear`,
   anti-reference `Salesforce`.
2. `$impeccable layout` — density move.
3. `$impeccable typeset` — Linear-style restrained-but-distinctive type.
4. `$impeccable craft` — execute the brief.
5. `$impeccable critique` + `$impeccable polish`.

---

## Example 7 — "modernise it"

**Phrase:** "modernise it"

**Restatement:**
- The phrase is **suspect**. "Modern" is the most common AI-slop trigger —
  it pattern-matches to the default training reflex (cyan/purple gradients,
  glassmorphism, dark blue, neon).
- Treat as: distinctiveness moved toward `distinctive`, but with a
  divergence-toolkit guardrail clamped on.

**Gaps:** What does "modern" mean *to this user*? But asking abstractly
will not help. Better: surface concrete reflexes the agent will *avoid*
and let the user push back.

**Questions:**
> 1. I'll avoid the AI-default modern look (gradients on text, glass
>    cards, neon-on-dark). Is that what you want — or do you specifically
>    want one of those? (a) avoid them, (b) actually I want \[X\], (c)
>    other.
> 2. Pick a non-category anchor reference if possible — something outside
>    SaaS/tech that you find modern. (Optional — say "skip".)

**Plan (after "avoid them"):**
1. `npx impeccable detect --json` — flag any existing slop.
2. `$impeccable shape` — brief with anti-references = the slop list.
3. `$impeccable distill` — strip dated patterns first.
4. `$impeccable typeset` — replace dated type with current expressive type
   (avoiding the impeccable reflex-reject list).
5. `$impeccable colorize` — non-cliché palette pick.
6. `$impeccable critique` + `$impeccable polish`.

---

## Example 8 — "I want it to feel premium"

**Phrase:** "I want it to feel premium"

**Restatement:**
- distinctiveness: moved toward `distinctive`
- density: implicit move toward `airy` (premium often = restraint)
- tone: implicit move toward `serious`
- expressive axis: ambiguous — premium can be `restrained` (Hermès web)
  or `drenched` (Bottega Veneta)

**Gaps:** The expressive axis fork is the whole question.

**Questions:**
> 1. Premium-by-restraint or premium-by-presence? (a) restrained — quiet
>    confidence, lots of negative space (b) committed/drenched —
>    high-presence, designed surfaces, big type.

**Plan:** branches on the answer. Restrained → `quieter` + `distill` +
`polish`. Committed → `bolder` + `typeset` + `craft` + `polish`. Both
include a `colorize` step to land on a non-default palette.

---

## Example 9 — user pushes back on the plan

**Phrase:** "make it bolder"

**Plan offered:**
1. `$impeccable bolder`
2. `$impeccable typeset`
3. `$impeccable colorize`
4. `$impeccable polish`

**User reply:** "Skip the type and color changes — just push the layout."

**Resolution:** Replace the plan with `$impeccable layout` + `$impeccable
polish`. Update `direction.md` to record that type and color are pinned to
their current values per user override. Run the new plan.

---

## Example 10 — phrase is too vague to act on

**Phrase:** "I want it to be amazing"

**Restatement:** moves no dimension at all; "amazing" is a quality demand
without direction *and* without a default like "better" has.

**Questions:** Two ceilings, picked for highest leverage.

> 1. Pick a direction we should push: (a) make it more distinctive, (b)
>    make it more accessible, (c) make it more performant, (d) something
>    else — describe in one sentence.
> 2. Optional: a reference site you find amazing.

**Plan:** deferred until the user answers. This is the only case where
asking-then-stopping is correct.
