# System One models (Jev) and a fully autonomous same-design migration

Research note, 2026-09-26, against stardust 0.26.0 (includes the #125 published-origin gate
hardening merged the same day; § 1a records what it changed). Question: what would it mean to run
the keep-the-design (`replica`) flow with TypeSafe's Jev, would stardust be rewritten for
it, is a 1:1 migration the right use case, and what KPI change could be expected. Redesign
flows are out of scope. Evidence: the typesafe.ai launch post and docs (API, models, state,
jaggedness, cookbooks, coding-agents page, public workflow evals); this plugin's skills,
CHANGELOG and field studies; eleven recorded replica runs (Aug–Sep 2026) and their session
transcripts (35 project folders, 124k assistant turns). Site names are replaced by roles.

## 1. Short answer

- **Jev cannot run stardust.** It generates no text or code, calls no tools, reads no
  images, and takes at most 32k tokens of state. TypeSafe's own docs: "not a drop-in
  replacement for the LLM behind Claude Code". What it fits is a code-owned pipeline that
  calls the model as a typed function.
- **Do not rewrite stardust for Jev.** The rewrite worth doing is "move control flow from
  prose into an engine"; the plugin is already half-way (76 scripts, 20.6k lines of
  instruments, ledger and state machine, `migrate.mjs render`, `deploy-batch.mjs`, and a
  hands-off mode that is a specification of every auto-resolution rule). Jev then becomes one
  backend behind a `decide()` interface with an LLM fallback on low confidence.
- **1:1 migration is a partial fit.** Agent time in a clean run is ~40–50 % waiting on
  instruments, ~25–35 % generation, ~15–25 % judgment. Jev addresses only the closed-set,
  text-representable part of the judgment slice (~8–12 % of agent time), but that part
  contains the decisions that diverged between runs and the part that must scale to
  thousands of pages. It cannot touch the pixel loop: pixel diff is already code, root-cause
  diagnosis needs CSS reasoning and screenshots, and Jev is documented as weak on numbers,
  px values and hex colours.
- **KPIs.** Jev as a sidecar in the current architecture: ~5–10 % time and cost, no fidelity
  change. A code-owned engine with Jev decisions and bounded LLM generation calls: an
  estimated 2–3× faster and 3–4× cheaper on 10–100 pages, same pixel bar, near-zero over-bar
  pages shipped because the published all-pages gate becomes a release condition. 80–90 % of
  that gain is the engine; Jev's own contribution is near-zero decision cost (< $5 per site),
  sub-second decisions, calibrated confidence for an escalation queue, and consistency.

### 1a. What 0.26.0 (#125) changed in this picture

1. **The largest measured fidelity failure now has an in-code answer.** Before 0.26.0, five of
   eleven runs shipped pages at 10–30 % because siblings were never gated at the published
   origin and completion derived from `verify`. Now `gate-all.mjs` writes a row per deployed
   page and per prototype, `gate-evidence.mjs` reads a page without a row as `OPEN: no table
   row`, `update-coverage.mjs --gate` flips a failing page to `failed`, and `verify.mjs` never
   marks a page `verified` while `delivery.gate.pass` is false. The engine's "near zero over-bar
   pages by construction" advantage is therefore mostly delivered in the current architecture;
   what remains for an engine is refusing to close C-deliver without the roster unit, which
   today is a prose instruction.
2. **Pixel diff alone is not the KPI.** On the recorded 96-page roster the same captures give 66
   pixel-only passes and 28 four-criteria passes (pixel ≤ 10 %, |Δh| ≤ 5 %, clipped = 0,
   MISSING + HIDDEN links/headings = 0); a listing page passed at 6.7 % with all 284 cards
   broken. "Measured on pixel diff" must mean the full verdict, and the honest baseline is that
   about two thirds of delivered pages on a hostile origin fail the full bar before repair. Jev
   does not move that number; generation and the repair loop do. The probes do sharpen the
   repair brief: clipped line boxes, MISSING LINK ×n and unit Δy are text, a better input for a
   bounded fix call and for a residual-cause classification than a percentage.
3. **Code first, confirmed; a few new judgment points.** Clip-probe, content-presence and
   unit-geometry are deterministic code for the "silent placeholder / zero-row content" class
   the corpus had listed as missed. The judgment left around them is small and Jev-shaped:
   clip legitimate vs defect (`clip-allow.json`), region variable vs fixed (`presence.json`),
   repeated-unit family membership (`units.json`), override justified (`overrides.json`) — each
   a `noul` or `choice` over a text finding, hand-written by the agent today. Upstreamed field
   fixes (window-free real Chrome tier, HTTP 400 as challenge marker, devDependencies instead of
   `--no-save`) remove three instrument-defect causes behind cap exceedance.

Net effect on the recommendation: unchanged. The engine's fidelity advantage shrinks; its
time and cost advantage does not, and the new per-page probes are one more thing a single
coordinator pays for in wall-clock and cache-window discipline that an engine parallelises.

### 1b. Review with the TypeSafe agent skill (2026-09-27)

The vendor's agent skill points at the live docs and enforces a few design rules; reading the
primitive pages and six more cookbooks against § 5 changed the mapping, not the answers.

Primitive corrections: residual causes are multi-label (one `noul` per cause plus `unknown`,
not one `choice`); anything graded is a `score` with situation-described levels, never a
`noul` (0.5 means split, not medium); block naming is a two-stage rank-then-re-check (one
`choice` over the whole registry, then a `fits` noul per shortlisted candidate; none fits =
new block) with criteria taken directly from the section-schema JSON as `what` / `not_for` /
`examples`; page-typing confidence maps onto fidelity tiers (at or above the bar → the
predicted archetype's sibling tier, below → thin tier or human, no extra call); content-red
adjudication takes the extraction-cascade shape (one "is this wrong?" noul per failure class,
gate on the maximum, exact string match in code first); dynamics triage keeps four `choice`
axes, with a higher bar on `reproducibility = self` because only `self` ships autonomously.

Shapes the first pass missed: **select instead of generate** for the rollout content-draft
fixers (metadata title and description, alt drafts), redirect targets and localised link
targets — code proposes candidates from the captured page, the model picks one or `none`,
code copies verbatim, so nothing is invented; **entity alignment** for block dedup and sibling
variance (a three-level `score` different / variant / same plus one noul per structural field
naming the disagreement, middle level = variant class); **composite scoring** for ordering the
repair of failing all-pages rows (per-row severity scores weighted in code with page
importance, retunable without re-inference); **typed function call** for the flow entry (flow
plus its arguments in one request, `stated` nouls so defaults apply, confidence = minimum
across judgments); a `noul` over content-presence MOVED / EXTRA / COUNT deltas for the
nondeterministic-origin class that cost a diagnosis round in seven of eleven runs.

Rules for the pilot: state as a JSON object with named fields referenced in backticks;
existing JSON (section schema, registry, triage rows) passed as structured criteria, not
templated prose; a `none` option on every `choice`; full probability vectors logged so
thresholds are retuned without re-inference; two phrasings per battery, because wording
sensitivity is documented; fan-out planned at about eight concurrent requests, the practical
limit the cookbooks hit, not the nominal 1,200 per minute. The no-fit list is unchanged and
reinforced by the skill's first rule: keep known rules, calculations, exact lookups and
execution in code. The Jev-attributable share of the estimated gain rises a little and
remains a minority; § 7 stands.

### 1c. Built and measured (2026-09-27)

The first increment is on this branch: `skills/stardust/scripts/decide.mjs` (library + CLI,
tests), nine batteries under `scripts/batteries/`, and `evals/jev-batteries/` (harvest +
replay; `BASELINE.md` there holds the tables). 1,612 recorded decisions from 39 project folders
replayed for $0.08 at a median 254 ms, zero errors. `page-type` with each option carrying the
paths and lead heading of up to three other pages of that type: 74 % agreement, **91 % on the
41 % of pages the route acts on alone**, monotone with confidence — go. `dynamics-triage` class
72 % (86.5 % when confident) — go; disposition and reproducibility 45 % with a flat curve — the
recorded answers are run policy absent from the state; they stay with the agent.
`section-alignment` 66 %, label noise plus a state that drops the per-unit composition — not
yet. The state is the model: one battery moved from 50 to 74 % by putting example paths into
the criteria. No skill calls the layer yet.

## 2. Jev, as documented

| Property | Jev 1.13 |
|---|---|
| Interface | `POST /v1/systemone`: one `state` (string / JSON object / array of text) + N typed questions, evaluated in parallel and in isolation |
| Question types | `noul` (P(true)), `choice` (≤ 255 options, probabilities + confidence), `score` (2–10 ordered levels) |
| Output | Typed values only; no text, code, tool calls or edits |
| Context | 64k tokens per request; **state ≤ 32k tokens** |
| Modalities | Text only; English primary |
| Price | $0.042 per 1M input tokens, output free; 70–500 ms per request |
| Limits | 250k tokens/s, 1,200 requests/min, "dynamic, can change without notice"; early access; no per-customer tuning |

Known rough edges (jaggedness page for 1.13): literal reading; unreliable counting; hex/RGB
and numeric magnitudes underperform; dates read as text; multi-hop indirection degrades;
irrelevant state distracts; injected instructions in state shift answers; a noul and its
negation do not sum to 1; generation by chaining choices is "slow and poor".

Public evals: 67.8 % mean agreement over four workflows versus 73.1 % for the best Opus
workflow, at ~1/400 the cost and ~1/90 the latency. "Agreement" is with a two-frontier-LLM
consensus, not human truth; the workflows are TypeSafe's; Jev is weakest on the numeric task.
Relevant cookbooks: structure recovery (62 questions over 17 blocks, 0.8 s), hierarchical
classification (beam search over `choice`), re-ranking (one `noul` per pair), and the
extraction cascade (cheap extractor → Jev "is this field wrong?" nouls → reasoning model only
when any P(wrong) > 0.7).

## 3. The replica pipeline as a step inventory

Types: **A** deterministic script · **B** narrow model decision · **C** open-ended generation
· **D** human gate. Volumes are per site unless stated.

| # | Step | Type | Inputs → outputs | Volume |
|---|---|---|---|---|
| 1 | Extract crawl (`extract --prep --dynamics`) | A + C (spec synthesis) | URL → page JSON, screenshots, fonts, DESIGN.json, page types | once |
| 2 | Flow guard / stamp `flow` | A + D | prompt → state.json | once |
| 3 | Promote spec, write `direction.md` | A | current/*.md → root spec | once |
| 4 | Inconsistency register | B/D | audit findings → register | 0–n |
| 5 | Dynamics detect | A + B (probe term) | archetype URLs → `_dynamics.json` | once |
| 6 | Dynamics classify + triage: class (12), disposition (7), reproducibility (5), status (8) | A + **B** | drafted rows → `dynamic-features.md` | 5–30 rows |
| 7 | CSS lift | A + B (which rules matter) | live stylesheets → tokens per breakpoint | per archetype × bp |
| 8 | Author archetype prototype | **C** | page JSON + lifted values + screenshot → HTML/CSS | 4–15 archetypes |
| 9 | Fonts policy | B | woff2 inventory → stack | per family |
| 10 | Source-fidelity gate round | A (`gate.sh`) | live + proto → verdict lines | archetype × 2 bp × ≤ 3 |
| 11 | Read verdict → diagnose → fix | **B** + **C** | band table, anchors → CSS/markup patch | 1–3 rounds per bp |
| 12 | Chrome crop gate + parity | A + B (glyph-noise justification) | PNGs → band % | per archetype × bp |
| 13 | Content-cap row | A (`cap-probe.mjs`) | live + proto → PASS/✗ | per archetype |
| 14 | Residual logging | **B** (band, cause, inheritor) | → `replica/progress.json` | per over-cap cell |
| 15 | Interaction parity | A + B + C | motion JSON → parity lines, motion code | per archetype |
| 16 | Archetype approval | **D** / hands-off | metrics → `approved` | per archetype |
| 17 | Sibling variance probe | A + B (delta → variant class) | probe JSON | per template |
| 18 | Sibling clone + content fidelity | A (`migrate.mjs render`) + B (`contentDeviations[]`) | → `migrated/` + sidecar | per page |
| 19 | Content-count acceptance | A + B (drop covered by deviation?) | capture vs rendered | per page |
| 20 | Sibling pixel bar | A | live vs migrated | per sibling × bp |
| 21 | Runtime-detection probe | B | target `scripts.js` → runtime contract | once |
| 22 | Audit + style fingerprint | A + B | prototype → section list | per page |
| 23 | Block triage + naming: block vs default content, Block-Collection match, reuse vs new | **B** (+ D on multi-page sites) | → conversion log | 6–10 sections × pages |
| 24 | Section schema + decode tier (template-slotted vs reconstructive), component shape (3) | A + **B** | → `eds-schema/` | per section |
| 25 | Foundation (styles, chrome blocks, nav/footer docs) | **C** then A (`foundation-freeze`) | tokens, chrome → `styles/`, `blocks/header|footer` | once |
| 26 | Block authoring | **C** | schema + prototype → `blocks/<name>/` | per distinct block (18–63) |
| 27 | Content page authoring | **C** | migrated HTML → DA document | per page |
| 28 | Media rehost | A + B (editorial vs decorative) | assets → DA media | per image |
| 29 | Block round-trip + EW gate | A | → 0 structural red, 0 dead text | per block, per page |
| 30 | Local structural QA | A + C (interactive drives) | harness → exit 0 | per page |
| 31 | Pre-PUT lints | A | content file → pass/fail | per page |
| 32 | Section-fidelity outline | A + **B** (REVIEW-flagged blocks) | authored vs source outline | per page |
| 33 | PUT → preview → live asserts | A (`deploy-batch.mjs`) | → `deployed` | per page |
| 34 | AI-readability gate | A | → score ≥ 98 | per page |
| 35 | Computed-style guard | A | → pass/fail | per template |
| 36 | Published-origin fidelity gate | A + B/C (one reconcile round) | live vs preview | archetype + one sibling per cluster |
| 36a | All-pages published-origin gate (0.26.0): `gate-all.mjs` → `update-coverage --gate` → `verify` | A + B (sidecar allowances, variable regions, unit families, overrides) | every deployed page and prototype → `gates/{all,prototypes}-<w>/summary` | per page × width |
| 37 | Deployed eyeball + CLS | **B** (visual) + A | deployed vs prototype | per page |
| 38 | Foundation-first gate + freeze check | A | | per unit |
| 39 | Coverage bookkeeping | A | → coverage, plan, progress | per page/block/unit |
| 40 | Site assembly, redirects, sitemap verify | A + C + B | → `site/*` | once |
| 41 | Dynamics implement + parity | **C** + A + **D** | plan → parity report | per feature |
| 42 | Full-site verify + link audit | A + B (crawl vs repoint) | → verified/failed | per page |
| 43 | Optimize gate + autofix | A + C + B (accepted/wontfix) | findings ledger | per finding |
| 44 | Report, learnings, dashboard | C + A | | once |
| 45 | QA sweep | A (`qa.mjs`) | → report | site-wide |
| 46 | QA triage | **B** (lost vs transformed; regression vs dynamism) | → annotated verdicts | per flagged finding |
| 47 | Allowlist entry | **D** | → `qa/allowlist.json` | per non-defect |

Count: ~24 A, ~18 B, ~9 C, ~4 D. Every measured bar (pixel ≤ 10 %, |Δh| ≤ 8 px, 0 structural
red, chrome crops ≤ 2 %, content-cap PASS, overflow ≤ 4 px, AI-readability ≥ 98, CLS < 0.1) is
already produced by an A step; the B steps decide what a number means, the C steps produce
what the numbers measure.

## 4. Measured baseline (eleven replica runs)

| KPI | Measured |
|---|---|
| 10-page hands-off pilot, same brief, two frontier models, same day | 4 h 56 min / 3,111 turns / ~1,750 tool calls / $689 API-equivalent / 7 of 10 pages within bar at the published origin — versus 6 h 11 min / 4,109 turns / ~2,250 tool calls / $303 / 10 of 10 (0.9–3.1 %) |
| 100-page clean hands-off run (a broadcaster's site, one prompt) | 4 h 15 min, 12 archetypes, 36 blocks, 3,364 tool calls, 12/12 archetypes within bar (1440: 0.00–0.68 %; 360: 0.01–7.33 %), sibling fidelity median 100 % |
| Archetype cost | 30–60 min agent time each (a credit bureau's run: 52 min, 30 turns, 13.6M cache-read per archetype); wall-clock ≈ slowest archetype under fan-out |
| Sibling cost | 0.2–2 min per page ungated; 13–80 min per page when siblings were repaired after publish |
| Fixed overhead | 1.5–2.5 h per run regardless of page count |
| Gate iterations (≈ 110 breakpoint cells) | 25 % pass in 1, 30 % in 2, 30 % in 3, 15 % exceed the cap; first-iteration diff 8–25 % |
| Pixel diff at archetype pass | 1440: 0.1–3 % clean, 2–9 % on bot-blocked origins; 360 is 2–4× worse; published origin adds 0.5–5 pts unless re-gated |
| Largest fidelity failure (pre-0.26.0) | **5 of 11 runs shipped pages at 10–30 %** after archetype gates passed (ungated siblings; a 3.58 % prototype measured 21.44 % deployed). Addressed in code by #125 (§ 1a) |
| Full-bar pass at delivery (0.26.0 calibration, 96 pages, same captures) | pixel-only 66/96; **four-criteria 28/96**; by criterion: pixel 30, height 6, clip 23, content 31; content n/a on 37 edge-blocked pages |
| Effort split (transcripts) | 85–88 % of tool calls are shell; 3–12 % edits. Agent time ≈ 40–50 % waiting on instruments, 25–35 % generation, 15–25 % judgment |
| Token economics (35 project folders) | 124k turns; 142M output tokens; 36.5B cache-read; 2.35B cache-write. At list prices ≈ $45k: cache writes ≈ 65 %, cache reads ≈ 20 %, output ≈ 15 %. Output is 0.3–0.8 % of cache reads |
| Cache-window loss (48-session study, CHANGELOG 0.22.2) | 1,271 requests re-wrote most of their context (649M of 713M cache-creation tokens); 46 % followed the agent's own blocking waits |
| Human touches, hands-off | 0–3 prompts plus token refreshes; 4–13 owner decisions left open |
| Repair after publish | often exceeds the original run (a bank: 9 h repair vs 7 h run; a pharmacy retailer: ~17 of ~28 h; a fintech firm: ~11 of ~20 h) |

The dominant costs are structural: a 500–900k-token conversation re-read every turn, cache
re-writes after every long wait, one coordinator serialising fan-out. The outcomes that
diverged between runs were judgment events (a product-order-drift policy, a `li>p` root
cause, an agent-asserted `pass: true` beside Δh 28, publishing on visual review): few, high
leverage, and Jev-shaped.

## 5. Fit of stardust decisions to Jev primitives

| Decision (step) | Shape | State (text) | Volume | Fit |
|---|---|---|---|---|
| Flow routing keep-design / redesign / reskin (2) | `choice` 3 + confidence | prompt + extract summary | 1 | **Strong** — 0.23.0 records misrouting that cost 2,207 pages at 24–28 % |
| Page typing (1) | `choice` over types (beam search for large sets) + `noul` locale-shell; confidence → fidelity tier | sliced page JSON | 100–3,000 | **Strong** |
| Dynamics triage, 4 axes (6) | 4 × `choice` in one request | detector JSON per row | 5–30 | **Strong** |
| Block triage: block vs default content, collection match, reuse vs new name (23) | `noul` + two-stage `choice` (rank registry, re-check top three with `fits` nouls; none = new block) | section schema as structured criteria | 6–10 per page | **Strong** — fixes the recorded same-name collision between agents |
| Decode tier, component shape (24) | `choice` 2, `choice` 3 | section schema | per section | **Strong** |
| Content-diff red: real drop / JOIN-SPLIT false red / covered by deviation (18, 19) | cascade battery: one "is this wrong?" `noul` per class, max-gate; exact match in code first | source + build slices + deviation list | hundreds–thousands | **Strong** |
| Sibling variance and block dedup: same block? (17, rollout B) | `score` 3 levels (different / variant / same) + one `noul` per structural field | two role inventories | tens per template; every block pair | Good — middle level = variant class |
| Residual cause naming (14) | one `noul` per cause + `unknown` (multi-label) | verdict lines + **code-bucketed** deltas | per over-cap cell | Medium — numbers must arrive as named buckets |
| Nondeterministic origin: difference explained by content varying between loads? | `noul` | content-presence MOVED / EXTRA / COUNT deltas | per flagged page | Good — a diagnosis round in 7 of 11 runs |
| Select instead of generate: metadata title/description drafts, alt drafts, redirect and localised-link targets (43, 40, 42) | `choice` over code-found candidates + `none` | h1, og:title, first paragraph, figcaption, nearest heading, inventory slugs | per page / image / path | **Strong** — moves content-draft fixers from C to B, nothing invented |
| Repair prioritisation of failing all-pages rows (36a) | `score` battery weighted in code with page importance | per-row element findings | per failing page | Good — composite scoring |
| QA triage (46), optimize disposition (43) | `noul`, `choice` | finding JSON + slices | tens–hundreds | Good for text findings; the visual-diff half needs the PNG |
| Editorial vs decorative image (28), licensed font (9) | `choice`, `noul` | alt/context, `@font-face` + licence | per item | Medium — route licensing below 0.9 to a human |
| Learnings dedup (44) | `noul` | new + existing entries | tens | Good |
| Gate sidecar judgments (36a, 0.26.0): clip legitimate vs defect, region variable vs fixed, unit family, override justified | `noul`, `choice` | probe finding JSON + named slice | tens | Good — low volume, text, closed sets |
| Verifier over LLM output (EW1 move-not-rebuild, schema conformance) | `noul` battery, cascade style | block JS + schema | per block | Medium — measure before trusting |
| Archetype, block, content, foundation, patches (8, 11-C, 25–27, 41) | — | — | — | **None** — generation |
| Pixel root cause from screenshots, CSS value lifting, eyeball (7, 11-B, 37) | — | — | — | **None** — vision and numbers |

Jev spend for a 100-page site under this mapping ≈ 7M tokens ≈ $0.30; for 3,000 pages ≈
$2.50. Constraints: rendered captures exceed 32k tokens (the existing `html-slice.mjs`,
`json-query.mjs`, `section.mjs` do the slicing); English-primary accuracy on non-English
sites; state is not treated as hostile; dynamic rate limits during early access.

## 6. Architecture options and recommendation

- **A0 status quo.** LLM executes prose; scripts measure; hands-off auto-resolves gates.
- **A1 Jev sidecar.** Decisions in § 5 become `decide-*.mjs` scripts that call Jev and print a
  verdict line the agent reads; ~a dozen scripts, ~15 batteries, prose edits. Consistency
  across agents and confidence in the ledgers; per-decision saving is one thinking turn, not
  one context read.
- **A2 code-owned engine.** A driver owns phases, units, ledgers, fan-out, waits and release
  conditions; each step is a script, a `decide()` (Jev → LLM fallback → human queue by
  confidence) or a `generate()` (LLM with a bounded fresh context, no conversation history).
  Prose becomes lints, prompt content and question batteries. Removes the structural costs
  in § 4 and makes "published all-pages gate before release" a property of the code.
- **A3 Jev-only.** Not viable.

Recommendation: A2 as direction, A1 as first increment (its scripts are A2's decision layer).
Pin `jev-1.13.0`, keep an LLM fallback behind every Jev decision, and treat Jev as a
dependency to isolate: early access, dynamic limits, no tuning, unproven pricing.

## 7. KPI estimates

| KPI | Baseline (measured) | A1 sidecar | A2 engine + Jev | Driver |
|---|---|---|---|---|
| Wall-clock, 10 pages | 4 h 56 min – 6 h 11 min | −5–10 % | 1.5–2.5 h | engine: parallel archetypes, overhead 1.5–2.5 h → 0.5–1 h (medium) |
| Wall-clock, 100 pages | 4 h 15 min | ~4 h | 2–3 h | bound by slowest archetype + published gate rounds + QA (medium) |
| Cost, 10 pages | $303–$689 | −5–10 % | $100–200 | output constant, cache read/write −80–90 % (medium-high) |
| Cost, 100 pages | ≈ $1.7–2.3k | ≈ $1.6–2.1k | $400–700 | same (medium) |
| Decision cost / latency | one LLM turn: 20–90 s, ~$0.13–0.25 of cache read | Jev ~0.5 s, ~$0.0002 + a verdict read | Jev ~0.5 s, ~$0.0002 | Jev (high) |
| Pixel diff at pass | 1440 0.1–3 % clean; 360 2–4× worse | unchanged | unchanged | set by gate and generation, not decisions (high) |
| Over-bar pages shipped | 5 of 11 runs pre-0.26.0; with #125 prevented whenever the roster unit runs (skipped run = pages `OPEN`) | unchanged | driver makes the roster unit non-skippable | mostly delivered by #125 in code (high); engine adds execution reliability (medium) |
| Full four-criteria pass at delivery | 28/96 on a hostile-origin roster before repair | unchanged | unchanged per page; repair rounds parallel with element-level briefs | generation and repair quality, not decisions (high) |
| Gate iterations | mean 1.8–2.0; 15 % over cap | unchanged | slightly lower | instrument-invalidated rounds detected by code (low-medium) |
| Long tail at 3,000 pages | 5 days, 319 parked, 2,286 turns | typing + adjudication in minutes for ~$2.50, parks carry cause + confidence | same, no coordinator limit | Jev volume + engine (medium) |
| Consistency across runs | two runs of one brief: 7/10 vs 10/10 pass, different scope | decisions consistent | decisions and flow consistent; generation still varies | Jev + code (medium) |
| Human surface | 0–3 prompts + token refreshes; 4–13 open items | confidence-ranked queue | queue only | confidence routing (medium) |
| Rewrite effort | — | ~1–2 weeks | ~2–3 months | estimate (low) |

Of the A2 gain on time and cost, roughly 80–90 % is the engine and 10–20 % Jev; on fidelity,
#125 has already moved the release condition into code, so the engine's remaining gain there is small. An engine using a low-effort
LLM for the same decisions would capture most of the time and cost; Jev's distinct value is
calibrated confidence at negligible cost and sub-second latency, which makes a decision queue
and a verifier layer practical at thousands of decisions per site.

## 8. Risks

Domain accuracy unmeasured (published evals are tickets, invoices, traces); numbers and
colours are documented weaknesses and are the substance of a pixel loop; 32k state forces a
code-side slice per decision; English-primary; state is not hostile-aware; early-access
vendor; a prose-to-engine rewrite loses field learnings until re-encoded as lints and tests.

## 9. Proposed pilot

1. Build a labelled decision set (~2,000 items) from the corpus: page types in `state.json`,
   dynamics rows, block names and decode tiers in conversion logs, `contentDeviations[]`,
   residual causes, QA verdicts.
2. Write eight batteries (routing as a typed function call, typing with the tier rule,
   dynamics, block triage as rank-then-re-check plus decode tier, red adjudication as a
   cascade, residual causes as multi-label nouls, section alignment for dedup and variance,
   metadata and alt selection over candidates); hand-review them, two phrasings each, log
   full probability vectors.
3. Measure agreement with recorded decisions and with a two-model consensus on a 300-item
   subset, the confidence-vs-accuracy curve per battery, cost and latency. Go bar: ≥ 90 %
   agreement at confidence ≥ 0.8 on routing/typing/triage and a monotone curve.
4. Ship A1 for passing batteries as `decide-*.mjs` behind a `STARDUST_DECIDER=jev|llm`
   switch, one ledger line per decision (question id, answer, confidence, backend).
5. Start the engine on the delivery half (`migrate` → `deploy` → `gate-all` → `qa`), where
   after #125 the steps are ~85 % scripts and the release condition exists in code; the driver
   makes the roster unit and the `--gate` flip non-skippable, runs the per-page probes in
   parallel, and hands each failing row's element-level findings to a bounded fix call.
