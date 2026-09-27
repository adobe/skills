# jev-batteries — baseline (2026-09-27)

First replay of the decision layer (#127) against recorded decisions from 39 project folders
(Aug–Sep 2026 runs). Model `jev-1.13.0`, with `jev-preview` as a second column where noted.
Raw runs live under `data/` (gitignored: they name sites). Read every number as agreement with
what an agent or a person recorded at the time, not as truth.

## Cost and latency

| run | items × models | input tokens | cost | latency median / p95 | errors |
|---|---|---|---|---|---|
| all three batteries, v1 | 1,612 × 1 | 1.82 M | $0.08 | 254 ms / 310 ms | 0 |
| flag-justify + residual-causes | 1,096 × 1 | 1.01 M | $0.04 | 263 ms / 310 ms | 0 |
| supervisor batteries + fixtures | 1,454 × 1 | 1.83 M | $0.08 | 245 ms / 351 ms | 0 |
| all three batteries, two models | 1,612 × 2 | 3.64 M | $0.15 | 254 ms / 310 ms | 0 |
| page-type v2 (examples), two models | 869 × 2 | 3.29 M | $0.14 | 259 ms / 319 ms | 0 |

Concurrency 4–6 never hit a 429. A decision that costs an agent one turn over a 500k-token
context (about $0.13 in cache reads and 20–90 s) costs here about $0.00005 and a quarter of a
second.

## page-type — passes the bar once the options carry examples

| variant | agreement | ≥ 0.9 | 0.7–0.9 | 0.5–0.7 | < 0.5 | routed `act` | agreement when `act` |
|---|---|---|---|---|---|---|---|
| v1: types as bare names | 50.2 % | 79.1 % (177) | 59.9 % (222) | 44.5 % (211) | 26.6 % (259) | 151 / 869 | 80.8 % |
| v2: each type with the paths + lead heading of up to three other pages of that type | **74.2 %** | **91.4 % (409)** | 71.1 % (180) | 55.2 % (134) | 47.3 % (146) | **353 / 869** | **91.2 %** |
| v2 on `jev-preview` | 74.6 % | 92.4 % (406) | 67.4 % (175) | 60.4 % (139) | 47.7 % (149) | 350 / 869 | 92.3 % |

Confidence is monotone with agreement in every variant, so routing on it is sound. With
examples the route acts alone on 41 % of pages at 91 % agreement, sends 35 % to review and
25 % to escalate; the remaining confident disagreements are landing ↔ listing and
static ↔ program, where the recorded labels are themselves debatable. The examples are what the
pipeline has before typing siblings (the archetype and its first siblings), so v2 is the
production shape. **Go for wiring beside the agent's own typing**, with `act` at confidence
≥ 0.9 mapping to the archetype's sibling tier and everything else to review.

## dynamics-triage — class yes, disposition and reproducibility no

| question | agreement | ≥ 0.9 | 0.7–0.9 | 0.5–0.7 | < 0.5 | top confusions |
|---|---|---|---|---|---|---|
| class (12) | 72.1 % | **86.5 % (267)** | 62.1 % (58) | 41.4 % (58) | 30.6 % (36) | A→L, A→T, CR→M |
| disposition (7) | 45.3 % | 79.3 % (82) | 34.8 % (135) | 53.5 % (86) | 27.6 % (116) | static-snapshot→data-fed ×56, decided-out→embed-passthrough ×35 |
| reproducibility (5) | 44.8 % | 58.3 % (36) | 44.0 % (109) | 43.0 % (79) | 43.2 % (176) | self→needs-backend ×59 |

`jev-preview` is within a point on every row. Class behaves like page-type: monotone, and
86.5 % on the 64 % of rows it is confident about. Disposition and reproducibility do not: the
recorded answers encode the run's policy (ship `static-snapshot` first and upgrade later;
`decided-out` for tags with no consumer on the new origin; what the owner would or would not
provide), none of which is in a feature description, and reproducibility is flat across
confidence bins, so its confidence carries no information. The confident disagreements are
arguable on both sides (image renditions from a media CDN recorded as `static-snapshot`, judged
`embed-passthrough`). **Go for class beside the agent; disposition and reproducibility stay with
the agent** unless the project's policy (target origin, owner constraints) becomes part of the
state and the battery is measured again.

## section-alignment — not yet: the labels and the state are both too thin

| variant | agreement | ≥ 0.9 | routed `act` | agreement when `act` | top confusions |
|---|---|---|---|---|---|
| v1: every section pair, same name = same block | 65.4 % | 72.6 % (270) | 289 / 324 | 69.6 % | 2→0 ×84, 2→1 ×20 |
| v2: block sections only (≥ 3 items, no prose-wrapper names) | 66.2 % | 78.0 % (214) | 241 / 296 | 73.4 % | 2→0 ×68, 2→1 ×28 |

Inspection of the confident "same block judged different" pairs: most are label noise — a
generic section name (`columns`, `hero`, `sd-container`, a bare index) holding unrelated
inventories on two pages — and a few are model misses on the state given (a card grid of three
units versus six, judged different). The role-sequence summary loses the per-unit composition
the judgment needs. **No go.** Next: state = the per-unit composition and the section's
items with text clipped, labels from hand review of ~100 pairs (the `2→1` cases are the
variant level the harvest cannot label), then measure again.

## flag-justify — decisive on a third of the flags, at 91 %

849 flags from eight runs' prototype gates (content-diff and visual-diff lines at iteration 1).
Label: still present at the final round = the run justified it (kept); gone at the final round =
fixed. Jev saw the flag line, the probe header and a four-line capture-state policy, and answered
`defect` ("would a reader miss or misread content because of this?"), `artefact`, `intended`.

| question | agreement | decisive (P ≥ 0.85 or ≤ 0.15) | 0.5–0.7 | unsure (< 0.5) | routed `act` (all three decisive) | agreement when `act` |
|---|---|---|---|---|---|---|
| defect | 66.9 % | **92.7 % (274)** | 61.0 % (118) | 53.0 % (457) | 86 / 849 | **96.5 %** |

The labels are noisy in both directions (a flag kept at the final round may have been fixed
afterwards; a flag gone at final may have vanished with an instrument change), so 65 % overall
understates the model. The shape is the point: where Jev is decisive it agrees with what the
run did 93 % of the time, and it is unsure about the half of the flags that are genuinely
ambiguous from the line alone. **Go as a pre-sort** — decisive flags resolved and logged, the
rest handed to the agent marked unsure — never as the sole judge.

## residual-causes — the harvested state is too thin to measure it

247 recorded residuals, labelled multi-label from the recorded `cause` text by keyword. The
state the harvest could rebuild is band, percentage, region and, for 5 of 247, a final band
table; no font-loaded warnings, no chrome-parity deltas, no anchor lines. Results: high
agreement on the causes whose evidence is in the band/region words (`nondeterministic_live`
89.5 %, `offset_contamination` 87.9 %, `sticky_widget` 83.8 %, `pipeline_transform` 98.4 %),
low on the ones whose evidence the state lacks (`font_fallback` 51.4 %, `chrome_generation`
58.7 %, `capture_truncation` 65.6 %; every miss is a recorded cause Jev could not see). **No
verdict on the model**; the battery needs the gate's verdict lines as state and a hand check of
the keyword labels before it is measured again.

## repair-priority — a demo, not a measurement

Run on the 68 failing rows of a recorded 96-page all-pages gate (0.26.0) with each row's probe
output as state: 68 graded, zero errors. Harm distribution: 15 cosmetic, 22 degraded, 22 broken
in part, 9 unusable. Ordered by the composite, the pages with missing links and clipped controls
lead and the pages that fail only the pixel bar drop to the end. There is no recorded label to
score against; the ordering is shown in the visual example for inspection.

## Supervisor batteries (phase 3) — phase-claim passes its bar; the others run in shadow

Cost of the whole supervisor replay: 1,454 requests, 1.83 M input tokens, $0.08, median 245 ms.

**phase-claim (v2).** 40 hand-written fixtures (25 asserted or skipped claims in the corpus's
style, 15 evidenced ones) plus 621 recorded `end` lines. The gate rule is "refuse when
P(asserts without evidence) ≥ 0.85 or P(declares a skip) ≥ 0.85".

| set | result |
|---|---|
| asserted fixtures caught at the bar | **20 / 25 (80 %)**; 21 / 25 at 0.80 |
| evidenced fixtures falsely refused | **0 / 15**; the highest P on an evidenced claim was 0.28 |
| recorded end lines that would be refused | **5 / 621 (0.8 %)** — a "PASS both widths" with no number, a "prepare-migration not run", three demo claims without instrument output |
| `cites_instrument_output` vs a regex label on 636 recorded lines | 75 % overall, 98.6 % at confidence ≥ 0.9; the disagreements are lines naming artefacts without numbers, which the regex does not count |

v1 read counted parkings ("383 parked") as skips and would have refused 4.5 % of recorded
lines; v2 names parkings, residuals with a cause and pending owner decisions as not-skips and
drops that to 0.8 % with the same fixture catch. **Go for `gate` + `--strict` on `ledger.mjs
end`** at the 0.85 bar; the five recorded refusals read as fair.

**decision-batch.** 14 items (9 recorded batches and fixtures): `one_batch` 92.9 %,
`interim_recorded` 100 %. Small set; advisory in shadow, no gate.

**plan-vs-flow.** 10 fixtures: `step` 5 / 5, `resume_from_memory` 1 / 1, `out_of_order` 4 / 7,
`wrong_flow` 1 / 2. The misses are legal steps read as out of order and a redesign step in a
replica run read as in-flow: the legal-step table needs preconditions written per step, and the
fixture set is too small. Shadow only.

**brief-check.** 769 recorded briefs labelled by literal presence (regex) per item: 58–69 %
agreement, `forbids_shortcuts` 27 %, every miss the same direction — Jev reads an item as present
where the regex found none of its keywords. Either reading could be right; the regex labels are
too narrow to say. **No verdict** until ~50 briefs are hand-labelled; the script stays in shadow.

## What this says about the layer

- The harness works end to end and is cheap enough to run on every battery change.
- Confidence is informative where the decision is structural (page type, feature class) and
  uninformative where the recorded answer was policy (disposition, reproducibility). Route on
  confidence only where the curve is monotone.
- The state is the model: the same battery moved from 50 % to 74 % agreement, and from 81 % to
  91 % on `act`, by putting three example paths per option into the criteria. Battery work is
  state work first, wording second.
- The two models (`jev-1.13.0`, `jev-preview`) agree within a point everywhere measured; pin
  `jev-1.13.0` and re-run the tables when a new version ships.

## Not measured yet

`flow-routing`, `block-triage`, `block-fit`, `red-adjudication`, `metadata-select`: their
recorded decisions live in conversion logs, progress files and QA reports that need a
harvester each; `residual-causes` needs a richer state (above); `repair-priority` needs labels. `harvest.mjs` is the place; each new battery lands here
with its own table before any caller runs it.
