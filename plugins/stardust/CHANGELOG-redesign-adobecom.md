# Changes from the `redesign-adobecom` branch

Changes proposed against `adobe/skills`'s `stardust` plugin, harvested
from the worked-example project at
[paolomoz/redesign-adobecom](https://github.com/paolomoz/redesign-adobecom)
(a multi-page redesign of adobe.com using stardust 0.7.1 + impeccable
3.0.1).

This branch bumps the plugin from **0.7.1 → 0.8.0** (minor: new skill +
extensions, no breaking changes to existing artifacts).

## 0.9.0 — Cinematic motion feature

Adds `prototype --cinematic` (and `--cinematic=<register>`) as a
first-class motion feature on top of the static prototype contract.
Built on top of the JFK Airport worked example (see
`test-jfkairport/stardust/prototypes/home-{A,B,C}-cinematic.html` for
register-specific reference instantiations).

| Area | Status | Driver |
|---|---|---|
| **`prototype --cinematic` flag** | added | Layers a brand-faithful motion register on top of the static prototype. Output is `<slug>-cinematic.html` alongside the static `<slug>-proposed.html` (never replacing). |
| **5 motion registers** | added — `arrival`, `kinetic-display`, `live-systems`, `editorial`, `kinetic-grid` | Closed catalog of choreography templates, each with brand-fit clause, signature moves, refuses list, and token defaults. Mode A's palette/typography pinning extended to motion personality. |
| **Register selection in `direct`** | added | `DESIGN.json.extensions.motion.register` written from PRODUCT.md Brand Personality via a documented selection heuristic. User override at command time via `--cinematic=<register>`. |
| **Motion `data-*` vocabulary** | added — `[data-anim]`, `[data-tile-anim]`, `[data-countup]`, `[data-flip]`, `[data-fill]`, `[data-split]`, `[data-parallax]` | Declarative motion contract on leaf elements; mirrors structural `data-section` vocabulary at a different scope. |
| **Lenis bundled** | added at `skills/prototype/assets/motion/` | MIT-licensed smooth-scroll engine, ~17 KB. Pinned per `motion-stack.md` § Pinning Lenis. No GSAP / Framer / Theatre.js — explicitly rejected for vendor-lock + license + weight reasons. |
| **Canonical inline motion runtime** | added at `prototype/reference/motion-runtime.md` | ~200-line script that bootstraps Lenis, drives the rAF loop, registers scroll entrances, runs `IntersectionObserver` triggers, and respects `prefers-reduced-motion`. Single source of truth; embedded inline in every cinematic prototype. |
| **Cinematic-mode validation gates (Pass 6)** | extended in `motion-validation.md` | Six new gates: Lenis bootstrap clean, reduced-motion fallback complete, scroll-jack check, three-position screenshot pass, register-match audit, motion C-cliff detector. |
| **Motion tokens in `:root` contract** | extended in `token-contract.md` | Cinematic prototypes additionally expose `--ease-out-cubic`, `--enter-duration`, `--parallax-translate`, etc. at `:root`. Static prototypes omit them. |

### Files added (0.9.0)

```
plugins/stardust/skills/prototype/assets/motion/lenis.min.js            NEW (bundled)
plugins/stardust/skills/prototype/assets/motion/lenis.min.css           NEW (bundled)
plugins/stardust/skills/prototype/assets/motion/LICENSE.md              NEW
plugins/stardust/skills/prototype/reference/motion-registers.md         NEW
plugins/stardust/skills/prototype/reference/motion-stack.md             NEW
plugins/stardust/skills/prototype/reference/motion-attributes.md        NEW
plugins/stardust/skills/prototype/reference/motion-runtime.md           NEW
```

### Files extended (0.9.0)

```
plugins/stardust/skills/prototype/SKILL.md                 — +`--cinematic` flag, +Phase 2.4 (motion application)
plugins/stardust/skills/prototype/reference/motion-validation.md  — +Pass 6 cinematic-mode gates, +cinematic _provenance shape
plugins/stardust/skills/direct/SKILL.md                    — +motion register selection in Phase 4 (DESIGN.json)
plugins/stardust/skills/stardust/SKILL.md                  — +cinematic-feature cross-cutting references
plugins/stardust/skills/stardust/reference/token-contract.md — +motion tokens (optional, cinematic only)
plugins/stardust/skills/stardust/reference/data-attributes.md — +companion-vocabulary pointer to motion-attributes.md
plugins/stardust/skills/stardust/reference/artifact-map.md — +cinematic file ownership + lenis asset paths
plugins/stardust/.claude-plugin/plugin.json                — version bump 0.8.0 → 0.9.0
```

### Backward compatibility

- Default behavior unchanged: prototypes are static unless
  `--cinematic` is passed.
- Existing prototypes do not gain motion automatically; the user
  opts in per slug.
- The static `<slug>-proposed.html` is the load-bearing artifact;
  the cinematic file lives alongside.
- All existing references continue to validate against the existing
  gates. Motion gates fire only when the cinematic feature is engaged.

---

## 0.8.0 — Original `redesign-adobecom` changes

## Summary

| Area | Status | Driver |
|---|---|---|
| **NEW skill `distill`** | added | Pre-extract step that turns user-provided samples into a structured trait matrix + a narrative vocabulary brief that `direct` reads under Mode B. The project ran distillation as a manual conversational pass; this branch promotes it to a first-class skill. |
| **Motion validation gate (Phase 2.8)** | added to `prototype` | Existing critique / audit / adapt gates read DOM at scrollY=0; they miss motion-specific failure modes (clipped-container content reveal, animation-range vs reading position, anim-enter trigger reachability, reduced-motion override completeness, no-JS fallback). The B3 surface fork's studio-banner garage-door surfaced 4 distinct motion bugs that no static gate could have caught. |
| **Surface fork as parent-direction tuning** | extended in `direct` | Existing skill docs restrict surface forks to A1/A2/A3 under verbatim mode. The B3 → B → A inheritance worked cleanly in this project; this branch formalizes the pattern (B/C surface forks under reimagined mode) with explicit parent-inference rules, cap-override semantics, and convergence-detector behavior. |
| **Brand-faithful inversion list** | extended in `direction-format` | Added 2 captured inversions from this project (glassmorphism on nav, gradient text on scoped AI affordances) to the canonical list. The list was 8 entries in 0.7.1; now 10. |
| **HTTP/2 / Akamai bypass: route-fulfiller pattern** | added to `playwright-recipe` | Existing recipe documents the headed-Chrome fallback for Akamai-fronted properties. This project surfaced a working unattended-pipeline alternative: the Playwright `request` API as a route fulfiller (intercept every page sub-resource, refetch via bare Node TLS fingerprint, fulfill back to the browser). Works on adobe.com / business.adobe.com. |
| **Journal rule** | promoted from project-side CLAUDE.md to `stardust/SKILL.md` | The journal pattern (append-only chronological log, prompt paraphrase + decisions + artifacts touched + findings + next) emerged in this project as the load-bearing continuity layer across sessions. State.json records "what is"; provenance records "why an artifact says what it says"; the journal records "how the project got here." All three are needed; only the first two were in stardust core. |
| **Recursive validate-and-fix loop** | promoted from project-side CLAUDE.md to `stardust/SKILL.md` | Type checks verify code; only browser rendering verifies feature correctness. The recursive loop (render → check → fix → re-render) was project-side discipline; now in stardust core. References the existing playwright-recipe + the new motion-validation reference. |

## Files added

```
plugins/stardust/skills/distill/SKILL.md                                NEW
plugins/stardust/skills/distill/reference/samples-brief-format.md       NEW
plugins/stardust/skills/distill/reference/trait-matrix-schema.md        NEW
plugins/stardust/skills/prototype/reference/motion-validation.md        NEW
plugins/stardust/skills/stardust/reference/journal-format.md            NEW
```

## Files modified

```
plugins/stardust/tile.json
    + version 0.7.1 → 0.8.0
    + skills["distill"] entry

plugins/stardust/skills/stardust/SKILL.md
    + § Journal rule (with reference/journal-format.md)
    + § Validation rule (recursive validate-and-fix loop)
    + Routing: "distill" added as first-word delegation target

plugins/stardust/skills/prototype/SKILL.md
    + Phases 2.5 – 2.8 table (renamed from 2.5 – 2.7)
    + § Phase 2.8 — Motion validation (mandatory when motion declared)
    + § References: motion-validation.md
    + Gating sentence in Phase 4 (4 gates instead of 3)

plugins/stardust/skills/direct/SKILL.md
    + § Surface forks of role-differentiated variants (B1/B2/B3, C1/C2/C3…)
    + § Variant parentage and inheritance chain (under add-variant mode)
    + Surface-fork-specific inheritance rules row

plugins/stardust/skills/direct/reference/direction-format.md
    + brand_faithful_inversions[] table extended with 2 entries:
      glassmorphism retention, gradient text retention (scoped)

plugins/stardust/skills/extract/reference/playwright-recipe.md
    + § Route-fulfiller pattern (unattended-pipeline alternative)
    + Order of techniques (refined): route-fulfiller → headed Chrome
      → playwright-extra stealth
```

## Worked example

Every change in this branch traces to a specific moment in the
redesign-adobecom project. The 1:1 mapping:

| Change | Project moment |
|---|---|
| `distill` skill | The opening turn: user provided `samples/bizpro-hub-prototype/`, `samples/plan-page/`, plus the live URL `https://www.adobe.com/upp-shared/fragments/tests/2026/q2/ace1201/sr-homepage`. We ran distillation as a manual conversational pass and produced `samples/SAMPLES.md` + `samples/trait-matrix.json`. User explicitly flagged: "take note of what we do for distillation, so we can make it a skill later." |
| Motion validation gate | The two final fix turns on B3's `home-B3-proposed.html`: (1) news scroll-scrub stages too wide [0.2/0.5/0.8 → 0.10/0.25/0.40]; (2) featured-products parallax magnitude too large (0.4 → 0.12); (3) studio-banner garage-door content invisible at large widths (50vh content reveal magnitude + cover-100% animation-range = content clipped through reading window). All four bugs were invisible to the existing static-DOM gates. The Playwright probes (`diagnose-motion.mjs`, `banner-all-widths.mjs`) were authored to find them. |
| Surface fork formalization | The `/stardust:direct --add-variant B3` turn: B3 → B → A inheritance worked but the skill docs said surface forks were verbatim-only (A1/A2/A3). The project marked B3 as "non-canonical pattern" in state.json. This branch makes it canonical. |
| Brand-faithful inversions | The Mode A bootstrap turn for adobe.com: extracted brand surface had `backdrop-filter: blur(64-128px) over rgba(255,255,255,0.64)` on nav (impeccable bans glassmorphism by default; brand-faithful direction inverted) and `linear-gradient(135deg, #8D88F2, #EB1000)` text on AI add-on chips (impeccable bans gradient text; brand-faithful direction inverted, scoped to AI affordance role only). |
| Route-fulfiller pattern | The first extract attempt against `https://www.adobe.com/` returned `ERR_HTTP2_PROTOCOL_ERROR` immediately. Headed Chrome worked but required a display. The route-fulfiller pattern (Playwright `request.newContext()` proxying every sub-resource via `context.route('**/*')`) worked unattended. Reusable for any Akamai-fronted property. |
| Journal rule | CLAUDE.md in the project declared "On every prompt execution, append a new entry to `stardust/journal.md` before ending the turn." The journal accumulated 30+ entries across the project's sessions; reviewers can read it linearly to understand how B3 evolved from a `/stardust:direct --add-variant B3` slot through 3 fix cycles. |
| Recursive validate-and-fix | CLAUDE.md in the project also declared the recursive loop. Used on every prototype render — caught all 4 motion bugs documented above; caught a JS-dependent hidden state on home-A (added `<noscript>` fallback); caught mobile-nav overflow at 360px (added hamburger pattern); caught skip-link missing on home-A (added). |

## Migration notes

For existing 0.7.1 consumers:

- **No artifact format breaks.** Existing `direction.md`, `DESIGN-*.{md,json}`,
  `state.json`, page records all read identically under 0.8.0.
- **The journal is recommended but not required** at session start.
  Projects without `stardust/journal.md` continue to work; only state.json
  is mandatory for reading context. Projects that start using the journal
  pick up continuity benefits immediately.
- **Phase 2.8 fires only when motion is declared.** Static prototypes
  pass through 0.8.0's gate cascade identically to 0.7.1. No regressions.
- **Surface forks under reimagined are opt-in.** Existing projects that
  used variants A + B + C without surface forks continue to work as
  before. Projects that want B1 / B2 / B3 now have the canonical contract.

## Open questions for the upstream maintainer

1. **Distill auto-invocation.** Should `extract` detect a populated
   `samples/` directory and offer to run `distill` first? Or keep distill
   strictly user-invoked? Argument for auto-offer: most users with samples
   will want both runs. Argument against: keeps the pipeline pure (each
   skill has one job).
2. **Motion-validation tool location.** The reference doc cites
   `tools/playwright/diagnose-motion.mjs` and `banner-all-widths.mjs`
   from the redesign-adobecom project as worked examples but does not
   ship them as fixtures. Should the plugin include them as
   `skills/prototype/fixtures/motion-*.mjs`? Argument for: ready-to-run.
   Argument against: every project's motion patterns differ; fixtures
   become stale.
3. **Surface-fork naming convention.** This branch uses letter-prefix
   inference (`B3` → parent `B`). Alternative: explicit `--parent B`
   flag. Letter-prefix is concise but requires the parent slot to
   already exist; explicit flag is more verbose but more flexible. The
   project used letter-prefix and it worked; bringing both options is an
   option.
4. **Journal rule defaulting.** Currently the recommended pattern is
   "project's CLAUDE.md says append to journal." Should stardust auto-
   create `stardust/journal.md` on `extract` and seed it with an opening
   entry? Argument for: zero-config. Argument against: projects without
   the journal habit accumulate empty/stale entries.

These are non-blocking. The branch is ready to merge as-is; the open
questions are for follow-up.
