# "What if…" candidates

A closed catalog of eight directional bets that `uplift` Phase 2b
selects from when authoring `stardust/uplift-questions.md`. Each
candidate is a **captured-but-underused brand trait** that variant B
or C can amplify.

The catalog is closed because the failure mode of "what if…"
questions is improvisation toward editorial vocabulary regardless
of the captured brand register. A closed list anchors the agent
to brand-evidence-driven amplifications.

## The eight candidates

### 1 · Display-typography amplification
**What if we extended `<captured display family>` from eyebrows into
the page's structural voice?**

**Triggering signal.** The captured surface carries a display font
that's reserved for very small uses (eyebrows, all-caps section
labels, badge text) while body / headings use the workhorse family.
Detected by inspecting `_brand-extraction.json.type.families.display`
usage count vs. its capability — if the display family ships axes
or weights that the captured site never exercises, the family is
underused.

**Direction.** Promote display type into section headers, navigation
labels, and key headlines. The captured family stays the same;
its **scope** changes.

**Natural register for C.** `kinetic-display`.

**Disqualified when.** The captured display family is generic
(Inter, Roboto, Helvetica vanilla) without a signature axis — no
trait worth amplifying.

---

### 2 · Photography re-foregrounding
**What if the captured photography breathed at editorial scale?**

**Triggering signal.** The captured site has high-quality
photography but the layout crops it to thumbnail size — 3:4 portrait
cards in a 5-up rail, 16:9 wide tiles with thin captions, hero photo
behind text without enough share-of-canvas. Detected by inspecting
`pages/<slug>.json.images` for `naturalWidth/Height` of captured
assets ≫ rendered card sizes.

**Direction.** Restore photography to 3:2 or 4:3 with title overlays
in the lower band. Hero photo becomes the layout, not a tile. Cards
gain photo-first composition.

**Natural register for C.** `editorial`.

**Disqualified when.** Photography is generic stock with no
identity (e.g. Unsplash-generic team photos, smiling-customer
templates). Amplifying generic photography exposes the weakness.

---

### 3 · Live-data promotion
**What if real-time operational signals were hero priority?**

**Triggering signal.** The captured site exposes live data
(security wait times, inventory levels, departure boards, status
indicators, queue counts) but the live data lives below the fold.
Detected by inspecting `pages/<slug>.json.sections` for
operational-language signals (numbers + time stamps + per-row
identifiers) that don't appear in the hero region.

**Direction.** Promote the live-data band into the hero adjacency.
Tickers, dashboards, count-up numerals, refresh-pulse indicators.
Often pairs with a configurator-search composition.

**Natural register for C.** `live-systems`.

**Disqualified when.** The captured site has no live data — marketing
brand surfaces without operational signals can't fake liveness.

---

### 4 · Signature-gesture extension
**What if `<captured signature gesture>` extended from one surface
into a system?**

**Triggering signal.** The captured site has a defining gesture —
a giant monogram, a stadium identity, a transport wordmark, a
custom illustrated motif — appearing only at the hero. Detected by
inspecting `_brand-extraction.json.motifs.wordmarkAsMotif` or
signature SVG / illustration appearing on `pages/<slug>.json`'s
`landmarks[hero]` but absent elsewhere.

**Direction.** Extend the gesture's vocabulary into section
headers, dividers, accent surfaces, footer wordmark. The gesture
is no longer an exception; it's the brand's structural voice.

**Natural register for C.** `arrival` (composition-led) or
`kinetic-display` (motion-led).

**Disqualified when.** There is no captured signature gesture —
the page reads as a template without a defining mark.

---

### 5 · Voice-register pivot
**What if `<captured underused tone>` was foregrounded over
`<captured dominant tone>`?**

**Triggering signal.** Voice samples in
`_brand-extraction.json.voice` carry a tonal contrast — formal +
casual, civic + warm, technical + plain. The captured page leans
heavily on one side and uses the other only in margins (footnotes,
support copy, employee-program blurbs).

**Direction.** Foreground the underused tone in section heads and
primary CTAs. The dominant tone retreats to legal / governance /
secondary surfaces.

**Natural register for C.** `editorial`.

**Disqualified when.** Voice samples are uniform — no tonal
contrast to lean into.

---

### 6 · Color-ladder re-weighting
**What if `<captured reserved shade>` became the primary surface?**

**Triggering signal.** The captured palette has a deep / accent /
muted shade that's used in 1–3 places (a button hover state, a
single footer band, an icon fill) but never as a primary ground.
Detected by inspecting `_brand-extraction.json.palette.roles` for
shades whose computed count is < 10% of the dominant background.

**Direction.** Promote the reserved shade to one or two large
surfaces (a band, a header, a footer pre-band). The palette is
unchanged — only its **proportions** shift.

**Natural register for C.** Any (color re-weighting is composition,
not motion).

**Disqualified when.** The captured palette is monochromatic +
neutrals only — no shade to lift.

---

### 7 · Audience-routing reframe
**What if the page foregrounded `<one captured audience>` over
the multi-audience compression?**

**Triggering signal.** The captured page tries to serve multiple
user intents in one composition (e.g. an airport homepage serving
departing-today + arriving-today + parking + trip-planner + access
+ shopper + civic — seven intents, one surface). Detected by
inspecting `pages/<slug>.json` for > 4 distinct CTA verbs in the
above-the-fold region.

**Direction.** Pick the most operationally-critical audience and
foreground its path. The other audiences stay accessible but are
demoted below the fold. The IA changes; the content set does not.

**Natural register for C.** `live-systems` (when the foregrounded
audience is operational) or `arrival` (when civic).

**Disqualified when.** The captured page serves a single clear
audience — no compression to untangle.

---

### 8 · Motif vocabulary swap
**What if the layout primitive switched from `<captured primitive>`
to `<captured alternate>`?**

**Triggering signal.** The captured page uses one composition
primitive heavily (e.g. cards-in-a-grid, badges-in-a-row,
chips-in-a-pill-rail) while a different primitive appears once or
twice (e.g. a list with index numbers, a banner with overlay text,
a panel with a side rail). Detected by inspecting
`_brand-extraction.json.systemComponents` for under-represented
patterns.

**Direction.** Promote the alternate primitive to the layout
default. The card grid becomes an indexed list; the badge row
becomes a labeled rail; the chip pill becomes a panel-and-rail.

**Natural register for C.** `kinetic-grid`.

**Disqualified when.** The captured page has only one composition
primitive — nothing to swap to.

## Selection procedure (used in Phase 2b)

1. **Walk all eight candidates.** For each, read the triggering
   signal and check the captured brand surface for the trigger.
2. **Mark disqualifications.** A candidate is disqualified when
   its disqualification clause fires. Record the reason in
   `uplift-questions.md` so the audit trail is preserved.
3. **Rank remaining candidates** by trigger strength: how
   underused is the trait? How clearly does the captured evidence
   support amplification?
4. **C picks first.** The cinematic register was selected in
   Phase 3a; C takes the candidate that register naturally
   amplifies (see uplift SKILL.md Phase 3b matrix).
5. **B picks from remaining.** Prefer candidates whose move is
   composition / IA / voice (not motion) so B and C differentiate
   by axis, not intensity.
6. **A needs no candidate.** A is the faithful + improvements
   variant; its bet is the improvements list, not a trait
   amplification.

If after disqualification fewer than two candidates remain, the
brand surface is too thin for three differentiated variants —
trigger the stop condition (uplift SKILL.md § Stop conditions
(b) / (d)) and switch to `--two-variants` (A + C) or refuse.

## Format of `uplift-questions.md`

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

# "What if…" candidates — <URL>

## Picked

### Variant C · <candidate name>
What if: "<verbatim "what if…" phrasing>"
Cinematic register: <register>
Evidence: <captured citation, e.g. "_brand-extraction.json#type.families.display
shows 'Sharp Grotesk Semibold' used in 5 elements only">
Motion bet: <one-line>

### Variant B · <candidate name>
What if: "<verbatim "what if…" phrasing>"
Captured trait amplified: <name>
Evidence: <citation>
Composition bet: <one-line>

## Disqualified

- **<candidate name>** — disqualified because <reason>.
- **<candidate name>** — disqualified because <reason>.
...

## Considered but not picked

- **<candidate name>** — strong trigger but B/C differentiation
  better served by the picked candidate.
```

The disqualifications section is mandatory. Listing what was
excluded (and why) is the audit trail that proves Phase 2b
walked the catalog rather than reflexively picking the first
match.
