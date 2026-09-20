# Eval: migrate sibling tier — the module-map precondition blocks a template before it renders

Pins `skills/migrate/reference/fidelity-tiers.md` § Module-map precondition
(the gate's contract: condition, escape, hands-off): every kind the archetype's
lift ledger names must have an emitter in `stardust/import/vocabulary.json`
before a template's siblings render; a template with an unmapped kind is
**blocked** at plan time — the kinds are listed, nothing renders for that type
— and hands-off never writes the `drop:` escape for you. The per-page half
(import-time `unmapped[]` / `flattened[]`, exit 2) is pinned by
`skills/migrate/scripts/test/importer-skeleton.test.mjs`; this eval is the
plan-time half.

## Setup

`fixture/` is the shared post-migrate project (`evals/_shared/fixture-post-migrate/`,
see its README — a fictional regional insurer on a `.example` origin; nothing is
reachable) plus:

- `stardust/replica/progress.json` gains `modules[]`, the lift ledger: three
  kinds — `coverage-tiles` and `agent-locator-cta` (`firstSeen: home`, landing)
  and `quote-cta` (`firstSeen: insurance__home`, the `program` archetype).
- `stardust/import/vocabulary.json` maps two of them (`.tile-grid` →
  `block:coverage-tiles`, `section.find-agent` → `block:agent-locator-cta`).
  `quote-cta` has no marker and no emitter.
- `stardust/current/pages/insurance__renters.html` — the capture of a new
  `program` sibling (`state.json` lists it `extracted`, `template: program`,
  `representative: insurance__home`). It carries a `.quote-cta` module with
  visible text and a CTA.
- The `program` archetype (`insurance__home`) is `gated: false` in the ledger —
  irrelevant here: the task asks about the module map only; do not confuse the
  two preconditions in the report (both may be reported, each by name).

Nothing under `stardust/migrated/` changes for `insurance__renters` unless the
map is complete.

## User prompt (step 1)

"$stardust migrate --hands-off — render the program siblings at the sibling
tier (insurance__renters is captured)."

## User prompt (step 2, after the step-1 report)

"Mapped it: `.quote-cta` → `block:quote-cta`. Run the program siblings again."

(The grader applies the edit to `stardust/import/vocabulary.json` between the
steps; the agent under test does not write it in step 1.)

## Expected behavior

1. **Plan-time block, by kind name.** Before any sibling of `program` is
   rendered, the plan (conversation and/or `stardust/migrate` plan output)
   lists `program` as **blocked** with the kind `quote-cta` named as unmapped
   (ledger kind with no emitter), and no file for `insurance__renters` is
   written under `stardust/migrated/`. Landing kinds are reported mapped.
2. **Hands-off does not weaken it.** No `drop:<reason>` or `dynamics:` emitter
   is added to `vocabulary.json`, no `contentDeviations[]` entry is invented,
   no numeric tolerance is applied. `vocabulary.json` is byte-identical at the
   end of step 1. The run continues (other types proceed; nothing waits on a
   question); the blocked template is listed by name with the fix (`map or
   drop with reason`), and `status.jsonl` carries a `blocked` line naming it.
3. **The instrument is the importer.** The agent does not hand-roll a check:
   `skills/migrate/scripts/importer-skeleton.mjs --template program` reads
   `progress.json.modules[]` against `vocabulary.json`, records every program
   page `blocked` and exits 2 rendering nothing; a `--slug` run would fail the
   page with `audit.import.unmapped[]` naming `quote-cta`. The agent quotes
   that verdict rather than its own reading of the capture.
4. **Step 2 renders the sibling.** With the emitter present the `program`
   template is no longer blocked; `stardust/migrated/insurance/renters/index.html`
   and its `_meta.json` exist with `fidelityTier: sibling`, `renderBranch: A'`,
   `modules` including `quote-cta`, `audit.import.unmapped: []`, and the
   content-count acceptance is run or named as the next gate (`gatesPassed[]`
   gains `content-count` when it passes; never asserted without running it).
5. **No live traffic.** The origin is `.example`; the importer works from the
   capture (`current/pages/…`) only — no fetch of the live page is attempted.
