# Three new use cases — research synthesis + candidate approaches

> Round 1 exploration (2026-07-03). Constraint: no changes to existing skills in this round —
> new skills/commands that orchestrate or wrap the existing pipeline. Synergy refactors come later.
>
> Research inputs: full plugin capability map (agent report), aemcoder/skills migration analysis
> (agent report), nebula/greenfield research analysis (agent report), and direct reads of prior
> experiments (`migrate-heathrowairport{,-eds}`, `migrate-hirslanden`, `migrations/`).

---

## UC1 — Same-design migration to AEM (near pixel-perfect)

**User story:** migrate a site from any platform to AEM EDS keeping its current design. "Almost
pixel-perfect": exactly the same page/content/design, except identified inconsistencies or minimal
alignment improvements. Flow: static stardust prototypes of key pages (page types) first, then
deploy to AEM reusing the same blocks site-wide.

### What research established

- **~80% of the pipeline is reusable as-is.** extract (`--prep`) already captures per-page
  screenshots, per-section computed styles, first-party CSS custom props, fonts (network-intercepted
  woff2), media, systemComponents, and authors a *descriptive* `current/DESIGN.{md,json}` in
  impeccable format. prepare-migration's archetype→sibling model = "key pages as page types, apply
  across site". deploy+rollout need nothing: deploy is design-preserving by construction relative
  to its input prototype; rollout Phase B literally implements "reuse the same blocks across the
  whole site" (`coverage/blocks.json` single conversion point per block).
- **Two real gaps:** (1) no "reproduce the current design" direction mode — Mode A pins palette+type
  but still re-designs surface; `ia-fidelity: verbatim` freezes IA, not surface. (2) no fidelity gate
  pointing at the *source*: all diff machinery verifies prototype↔build, never live-site↔prototype.
- **Prior art proves the flow end-to-end, manually:** `migrate-heathrowairport` (verbatim content
  model + component catalog + deterministic PDF↔site verifier, 83.6% verbatim) and its EDS sibling
  (bespoke-block + content-model fill, 62/62 pages live, harvested SKILL-IMPROVEMENTS.md).
  `migrate-hirslanden` proved 291-page scale with "Variant A: faithful + identified improvements".
- **Key methodology lesson (heathrow):** *fidelity values come from the original site's own CSS,
  not the eye* — fetch stylesheets, lift exact tokens (container max-width, button spec, type ramp,
  hero heights) before any screenshot-eyeball loop. Converts 3–4 guess loops into one.
- **aemcoder counter-evidence:** direct-to-EDS with LLM-eyeballed fidelity loops costs ~$35/page,
  90% of it in the conflated (content × EDS mechanics × visual) iteration; their own README steers
  pixel-critical cases away from block-rewrite. Validates prototype-first + measured diff.

### Candidate approaches

**UC1-A — new skill `stardust:replica` (preserve-mode orchestrator).** *[primary candidate]*
1. `extract --prep` (unchanged) → full inventory, page types, module candidates.
2. **Mechanical direction promotion** (new, inside the skill — does NOT touch `direct`): promote
   `stardust/current/DESIGN.{md,json}` + `PRODUCT.md` verbatim to project root as the *target* spec;
   no divergence roll, no craft re-direction. Permitted deltas = only items from `stardust:audit`
   design findings (or user-supplied list), recorded in a `brand_adjacent_refinements[]`-shaped
   ledger ("inconsistency register"). ia-fidelity implicitly `verbatim`, design-fidelity `verbatim`.
3. **Recreation loop per archetype** (new): author clean semantic HTML/CSS per page type using
   (a) captured page JSON for content, (b) *source CSS extraction* for exact values
   (heathrow lesson — pull the live stylesheets, lift tokens/specs), (c) captured screenshot as
   ground truth. Gate: **source-fidelity gate** = `diff` scripts pointed at live URL vs prototype
   (`--profile generic`) + pixel-level screenshot compare; iterate to convergence with hard caps.
4. Existing `migrate` (sibling tier) → `deploy` (favor template-slotted decode) → `rollout`.

**UC1-B — CSS-portation variant.** Same as A but step 3 *ports* the source site's own CSS
(downloaded stylesheets, tree-shaken to used rules) instead of re-authoring clean CSS. Maximum
fidelity, but: carries source's CSS debt into blocks, conflicts with "better implementation of key
pages", and dirty CSS scoping under block classes is fragile. Keep as fallback for pixel-critical
sections only.

**UC1-C — snowflake overlay path.** Byte-for-byte DOM preservation (snowflake skill exists).
Maximum pixel fidelity but zero re-implementation value: no clean blocks, no reusable design
system, defeats the stated goal ("better implementation of the key pages"). **Discard for UC1
mainline**; document as the escape hatch for a page that must be byte-identical.

### Hypotheses to validate (experiment UC1-E1)

- **H1 (riskiest):** a clean re-authored prototype can reach near-pixel fidelity vs a live page
  (measured: 0 structural 🔴 on content-diff; visual-diff clean; pixel diff of section screenshots
  under an agreed threshold) within ≤3 measured iterations, when armed with captured JSON +
  source-CSS token lifting + screenshot.
- **H2:** the "source-fidelity gate" is buildable from existing diff scripts (`--profile generic`)
  plus a small pixel-compare addition — no new instrument needed.
- **H3:** the mechanical direction promotion (current→target) is sufficient for prototype-stage
  work without invoking `direct` at all.

Promote UC1-A if H1+H2 hold; if H1 fails on fidelity, test UC1-B on the failing sections.

---

## UC2 — Reskin (existing content × separately-defined new design)

**User story:** site A has the content; the new design already exists elsewhere (another site,
static HTML prototypes, Figma, …). Rebuild A's pages with faithful content on the new design
system. Same design-recreation precision as UC1 (toward the *donor*), but content mapping is the
crux: faithful content, flexibly re-laid-out onto the new system.

### What research established

- **The live-site donor case is already specced:** `extract <content-url> --design-source <donor-url>`
  captures the donor to `stardust/canon-source/` and `direct` pins the donor surface as target while
  content stays with the primary origin. Content preservation in migrate is airtight and
  battle-tested (anti-fabrication catches in e2e runs).
- **Gaps:** (1) non-URL donors — local static prototypes (small variant: serve on localhost) and
  Figma (new adapter via Figma MCP: variables→palette, text styles→type, screenshots→vision gates,
  new provenance class). (2) No cross-origin section-mapping contract (content site's page content →
  donor's module vocabulary). (3) Strict donor fidelity inherits UC1's preserve-mode gap, pointed at
  `canon-source/`.
- **From aemcoder:** `dom-equality.mjs` (snowflake half) is exactly the UC2 content gate —
  whitespace-normalized visible-text byte comparison + image-set comparison, with tag-sequence
  divergence expected/informational. `metadata-extract.js` = the SEO carry-over checklist.

### Candidate approaches

**UC2-A — new skill `stardust:reskin` (donor-pinned orchestrator).** *[primary candidate]*
1. Ingest donor: live URL → existing `--design-source` path; local prototype dir → serve on
   localhost and run the same path; Figma → adapter producing `canon-source/`-shaped artifacts
   (brand surface + descriptive DESIGN + screenshots).
2. Extract content site fully (`--prep`).
3. **Cross-origin mapping step** (new): for each content page type, a mapping brief — every content
   slot (from typed slots in page JSON) assigned to a donor module/pattern (from donor
   DESIGN/modules), with explicit lineage citations both ways (content from `current/pages/`,
   layout from `canon-source/`). This is the shape-brief Discipline-1 form extended cross-origin.
4. Prototype per archetype against donor-pinned target; **dual gates**: content byte-fidelity
   (dom-equality-style: text bytes + image set + metadata carry-over) AND donor design adherence
   (UC1's source-fidelity gate pointed at donor pages/screenshots).
5. migrate → deploy → rollout unchanged.

**UC2-B — reskin via canon transplant.** Run UC1-style recreation *of the donor* first (donor
canon: header/footer/canon.css/modules), then treat the content site's migration as `migrate`
sibling-tier renders into transplanted canon. More mechanical, likely better cross-page
consistency; depends on donor canon quality. Candidate for the scale path after UC2-A validates
the per-page mapping.

### Hypotheses to validate (experiment UC2-E1)

- **H4 (riskiest):** an agent can produce a faithful-content reskin in one archetype pass — content
  byte-fidelity (whitespace-normalized text equality, zero dropped slots, image set carried) while
  adopting the donor's tokens/modules (measured vs donor DESIGN.json + donor screenshots).
- **H5:** the cross-origin mapping brief is decidable — content slots map onto donor modules
  without inventing new patterns for ≥80% of slots; the remainder is an explicit "new module in
  donor vocabulary" list, not silent improvisation.
- **H6:** dom-equality-style byte-level text checking is adoptable as the content gate (adapted
  from the aemcoder clone) alongside the existing content-diff.

---

## UC3 — Greenfield creative generation ("Claude Design as a skill")

**User story:** generate a NEW design for a page/site from heterogeneous inputs (existing site,
text description, brand pictures, Figma, inspiration sites, refero references). Core value =
CREATIVITY: unexpected but balanced/modern/usable, no AI slop; variants along axes the user can
pin to explore.

### What research established

- **nebula (local `stardust-greenfield`, one unpushed commit ahead of GitHub) is the mature front
  door**: brief → direct (non-web anchor + register + 5 axes from human-curated pools + named
  tension + distinctiveness gate vs named LLM-defaults) → render (signature specimens with
  load-bearing details, accent territory, baked palettes, impeccable gates). Validated 5/5
  distinctiveness (test-11a) after the v2 convergence fix.
- **Its gaps are exactly this use case's asks:** single page only; text-brief-only input (no brand
  images / Figma / inspiration-site / refero ingestion); no variant fan-out with axis pinning
  (though pool-ID-based DESIGN.json is the right substrate); image generation unimplemented; pool
  content debt (gestures/axes partly TODO).
- **stardust side:** divergence toolkit, refero tier-1 grounding (validated on 4/6 e2e sites),
  Mode B anchors, variant role contracts + convergence detector, motion registers — all reusable;
  but everything upstream assumes an extracted site, and the content-sourcing/placeholder economy
  is inverted for greenfield.
- Motion signature library: 15 runnable clean-room specimens with production notes (S1–S20),
  plus hovers H1–H17, buttons B1–B12, links L1–L12, vocabularies V1–V11.

### Candidate approaches

**UC3-A — new skill `stardust:genesis` = nebula core + multi-input ingestion + variant axes.**
*[primary candidate]*
1. **Ingestion front door** (new): accept any mix of {text brief, existing-site URL(s), brand
   images, Figma file, inspiration URLs, refero queries}. Each input becomes an *origin* in a
   synthetic brand surface (`origins[]` pattern from `--brand-source`): images → palette/mood/motif
   evidence (vision); Figma → variables/type/components; existing site → standard extract; refero →
   grounded pattern references (reconciled with nebula's non-web-anchor stance: refero for
   layout/pattern evidence, non-web anchors keep owning personality).
2. **Direction via nebula's machinery** (pools, anchor, register, tension, distinctiveness gate) —
   consumed as a library, not by modifying nebula.
3. **Variant fan-out with pinning** (new): N variants = points in axis space; user pins axes
   (e.g. "keep this typography, re-roll motion+substrate"); re-rolls sample away from pinned
   variants (anti-convergence: minimum axis-distance between variants, per the v2 lesson).
   Contact-sheet artifact for review; pin → explore loop.
4. Render per variant via impeccable + signature library; placeholder economy inverted
   (placeholders expected + enumerated, `--publish-sample` carve-out pattern).
5. Optional back half: hand the pinned winner to stardust prototype/migrate/deploy for
   multi-page/EDS delivery (nebula's declared non-goal, stardust's strength).

**UC3-B — thin wrapper around nebula as-is + stardust back half.** Fastest to ship but fails the
brief: no multi-input, no pinning. **Discard as end state**; useful only as the skeleton for A.

### Hypotheses to validate (experiment UC3-E1)

- **H7 (riskiest):** variant fan-out with axis pinning produces *genuinely distinct, non-slop*
  variants — measured with nebula's own instruments: per-variant distinctiveness table (≥4/5 axes
  off-default), pairwise axis distance ≥2 between variants, named tension present per variant.
- **H8:** heterogeneous inputs measurably steer direction: the same brief with vs without
  image/inspiration inputs yields different, evidence-cited pool picks (origins → picks traceable).
- **H9:** refero can be reconciled with the anti-slop stance (layout evidence only, personality
  stays with non-web anchors) without re-introducing "like Linear" convergence.

---

## Validation experiments (running now)

| Exp | Where | What |
|---|---|---|
| UC1-E1 | `/Users/paolo/stardust/uc1-replica-test/` | Recreate one live page (strict-design brand) as clean prototype; measured source-fidelity loop; ≤3 iterations |
| UC2-E1 | `/Users/paolo/stardust/uc2-reskin-test/` | One content page × one donor design; content byte-fidelity + donor adherence gates |
| UC3-E1 | `/Users/paolo/stardust/uc3-genesis-test/` | One brief + inspiration inputs; 3 variants along axes; pin one axis-set, re-roll; distinctiveness measured |

Promote/discard is recorded per hypothesis in `VALIDATION.md` in each experiment folder and
synthesized back into this doc.
