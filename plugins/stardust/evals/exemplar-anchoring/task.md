# Eval: exemplar anchoring (direct Phase 2.7)

## Setup

A project with `stardust:extract` already complete:

- `stardust/state.json` lists 5 pages, all status `extracted`.
- `stardust/current/PRODUCT.md`, `DESIGN.md`, `DESIGN.json` exist.
- `stardust/current/_brand-extraction.json` carries palette, type,
  motifs, voice samples that read as **editorial / niche / tactile**
  (used to derive target `brand_axes`).
- No project-root `PRODUCT.md` / `DESIGN.md` / `DESIGN.json` yet.
- No `stardust/direction.md` yet.
- Impeccable installed.

The plugin-side exemplar corpus
(`plugins/stardust/exemplars/`) contains **6 seeded entries**:

1. `editorial-civic-2024.yaml` — `verdict: stunning`, `brand_axes:
   [editorial, niche, civic]`, moves: `layout/asymmetric-grid`,
   `type/editorial-serif-display`.
2. `tactile-publishing-2025.yaml` — `verdict: stunning`, `brand_axes:
   [editorial, tactile, niche]`, moves: `image/no-imagery`,
   `motion/still-but-precise`.
3. `archival-museum-2023.yaml` — `verdict: stunning`, `brand_axes:
   [editorial, civic]`, moves: `layout/asymmetric-grid`,
   `tone/declarative`.
4. `corporate-saas-2025.yaml` — `verdict: stunning`, `brand_axes:
   [mass-market, technical, utility]`, moves:
   `layout/centered-single-column`, `type/all-caps-grotesque`. **Should
   not qualify** (no overlap with target).
5. `playful-d2c-2024.yaml` — `verdict: strong`, `brand_axes:
   [playful, mass-market, expressive]`. **Should not qualify**.
6. `slop-fintech-stock-2024.yaml` — `verdict: slop`, `brand_axes:
   [editorial, niche]`, `anti_pattern: gradient-blob-hero`. The
   slop anchor that overlaps the target.

The project-side corpus (`<project>/stardust/exemplars/`) is empty.

## User prompt

"$stardust direct make this read as a serious editorial publication, not
the institutional brochure it currently is"

## Expected behavior

The `stardust:direct` skill is invoked. Through Phases 1 and 2 it
resolves direction; in **Phase 2.7** (Exemplar anchor selection) it:

1. **Computes target `brand_axes`** from the resolved direction +
   extracted current state. The result includes at least
   `editorial` and `niche` (and likely `tactile` or `civic`).
2. **Reads the corpus** as the union of plugin-side and project-side
   (project-side is empty, so just plugin-side here).
3. **Filters by `brand_axes` overlap** per the runtime contract:
   entries qualifying require ≥2 tag overlap, OR 1 tag overlap with
   `verdict: stunning`. After filter:
   - Qualifying: `editorial-civic-2024`, `tactile-publishing-2025`,
     `archival-museum-2023`, `slop-fintech-stock-2024`.
   - Excluded: `corporate-saas-2025`, `playful-d2c-2024` (no overlap
     with target tags).
4. **Surfaces anchors**:
   - Up to 3 `stunning` entries: all three of the qualifying stunning
     entries are surfaced (max-3 cap not exceeded).
   - 1 `slop` entry: `slop-fintech-stock-2024`.
5. **Writes `# Anchors` section to `stardust/direction.md`** at
   Phase 5, listing each anchor with: `id`, `verdict`, `brand_axes`,
   `why`, and the moves the entry exhibits.
6. **Excluded entries are not cited** in `# Anchors` — the
   non-overlapping `mass-market` / `technical` / `playful` exemplars
   never appear.

A **stardust-observed candidate emission** may or may not occur
during this phase. If one does, it must (per learning-system §
Proposed candidates):

- Apply only to a `stunning` or `strong` source.
- Be on a structural axis (layout / type / image / motion / structural).
- Cap at 2 emissions per session.
- Surface a one-line note to the user.
- Write the candidate to `stardust/captures/candidates/`.

If no candidate emission happens, that is also acceptable (the
emission gate is conservative by design).