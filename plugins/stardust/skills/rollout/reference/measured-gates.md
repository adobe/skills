# Gates 5–7 — Measured per-page gates (AI-readability, editability, content-count)

Three instrument-measured gates whose artifact is ingested, never retyped:
`update-coverage.mjs --gate <name> <json>` (Phase C) and `verify.mjs
--ai-readability` (Phase E). Each section is the gate's whole contract —
condition, escape hatch, hands-off, protected. Gates 1–4 + batched delivery:
`delivery-gates.md`; Gate 8 (the publish gate): `publish-gate.md`.

## Gate 5 — AI-readability (`code ≥ 98` on the delivered origin, per page)

Deploy's atomic contract names the gate per page; rollout runs it per wave and
ingests the artifact — never a typed number. Instrument:
`skills/deploy/scripts/ai-readability.mjs`; ingest: `update-coverage.mjs --gate
ai-readability <json>` (Phase C, preview origin) and `verify.mjs
--ai-readability <json>` (Phase E, live origin).

```bash
node skills/deploy/scripts/ai-readability.mjs --origin https://<branch>--<repo>--<org>.aem.page --paths <wave-paths> --min 98 --json stardust/rollout/ai-readability-<wave>.json
node skills/rollout/scripts/update-coverage.mjs --gate ai-readability stardust/rollout/ai-readability-<wave>.json
node skills/rollout/scripts/verify.mjs --ai-readability stardust/rollout/ai-readability-live.json   # Phase E, over every verified page (≤ 150) or listing pages + the Gate 8 sample
```

- **Condition.** After each Phase C wave's preview run, every page of the wave
  is scored on the **preview** origin (D1); `code < 98` → the row is `failed`
  (`error: "ai-readability code N < 98 — top: <blocks>"`) and is not in the
  `--publish` set. Phase E re-runs on **live** over every verified page (≤ 150;
  above: every listing/index page + the Gate 8 sample per template) and flips
  `code < 98` to `failed`. The bar is the artifact's own `min` (never retyped).
- **Unmeasured ≠ FAIL.** An `error` row (`served fetch HTTP 429`, a timeout) is
  `delivery.gates.ai-readability.unmeasured: true`: the row's status is
  untouched, it is counted, `verify` exits 2 ("incomplete") while any remain —
  a re-drive (sequentially, after the throttle window), never a pass, never a
  FAIL. The qa `ai-readability/unmeasured` severity stays `info`.
- **Escape hatch.** Per page: none. Per block: the instrument's `--allowlist`
  (block + string, never a page) and `--exclude-blocks`. A page that stays
  unmeasured is reported as such; the owner may close with a named `interim`
  line in `decisions.md` only for pages the report lists.
- **Hands-off.** No new auto-resolution: a `failed` readability page stays at
  preview (D16), the wave continues on the other pages, the close-out leads
  with the Readability line and the `failed` slugs go to `verify/summary.md`.
- **Phase H line** — computed from `rollout.json.lastRun.gates.ai-readability`,
  never typed: `Readability  strict median <n> · code median <n> · pages < 98:
  <n> · unmeasured: <n>`; the report cannot close with `< 98` or `unmeasured` > 0
  unless `decisions.md` names them. One instrument, one pass per phase (qa's
  check K remains the drift monitor).

## Gate 6 — Editability (Experience Workspace: dead non-exempt text = 0, duplicated index = 0)

The EW contract is measured, not asserted: every converted block passes
`block-roundtrip --ew` in deploy's Step 8 loop **and** the page passes one
whole-page probe. Instrument: `skills/deploy/scripts/ew-editability-probe.mjs`;
ingest: `update-coverage.mjs --gate editability <probe.json>` (page rows +
block rows in one call, T33.1's generic flag).

```bash
node skills/deploy/scripts/ew-editability-probe.mjs --content content/<page>.html --blocks-dir blocks --json > stardust/rollout/ew/<slug>.json   # harness
node skills/deploy/scripts/ew-editability-probe.mjs https://<preview>/<path> --blocks-dir blocks --json > stardust/rollout/ew/<slug>.json      # URL mode (a block imports modules)
node skills/rollout/scripts/update-coverage.mjs --gate editability stardust/rollout/ew/<slug>.json
```

- **Condition.** A page flips to `deployed` (and, transitively, into the
  `--publish` set) only with `totals.dead === 0` (dead text outside a declared
  `@ew-exempt`) and `totals.duplicated === 0`; `dead > 0` or `duplicated > 0` →
  `failed` (`error: "editability: dead N in <block>"`). The pass bar is deploy's
  own (`deploy/SKILL.md` Step 8 row), unchanged. Block rows: `blocks.json`
  `delivery.ewGate = pass | fail | exempt | unmeasured` (+ `ew{authored,
  editable, dead, exempt, duplicated}`) derived from the probe's `blocks[]` by
  `edsBlockName`, a block's worst page verdict winning; `coverage-model.md`
  § Block delivery status lifecycle: `converted` requires `ewGate ∈ {pass, exempt}`
  (`update-coverage --block <id> --status converted` refuses `fail` / `unmeasured` /
  no ingested verdict, exit 1; the roll-up counts such a block as `ewHeld`).
- **No verdict ≠ FAIL.** Probe exit 2 (a block failed to install / decorate —
  today every block with a static `import`) → `delivery.gates.editability.unmeasured:
  true`, status untouched, the page un-flippable, Phase E/H count it. Resolution
  until the harness resolves imports: URL mode against the dev-server harness or
  the **preview** origin (our host — never the source site) produces the verdict.
- **Escape hatch.** Only the declared one — `@ew-exempt` in the block JSDoc
  (EW5 categories; item-level tags). No `--skip-ew` / `--no-ew` on the contract
  row (`--no-ew` stays a `block-roundtrip` diagnostic). A CLI `--exempt a,b` is
  recorded `exemptSource: cli` and printed in Phase H, never silent.
- **Hands-off.** A failing block is a code defect fixed in the Step 8 loop ("fix
  by moving, never by weakening"); at the iteration cap the page records
  `--status failed --error "editability: dead N in <block>"` and the rollout
  continues, the page out of `--publish`. Hands-off runs the URL-mode fallback
  itself; unmeasured is never auto-resolved to pass. No owner decision involved.
- **Phase H line** — `Editability  <editable>/<authored> · dead <n> · exempt <n>
  · unmeasured <n>` from `rollout.json.lastRun.gates.editability`, never blank.
  Single-page deploy keeps its artifact at `stardust/deploy/ew-<page>.json`.
## Gate 7 — Content-count acceptance (source vs imported role inventory, offline)

The cheapest gate in the flow and the one field runs skipped: static role
counts of the rendered source sidecar against the migrated page. Instrument:
`scripts/content-acceptance.mjs` (no browser, zero source hits). Hooks:
`migrate` Phase 2 after content preservation (a FAIL keeps the page out of
`migrated`), `rollout` Phase C step 2 beside `delivery-lint` (a FAIL is P1 →
no PUT).

```bash
node skills/rollout/scripts/content-acceptance.mjs --slug <slug>                 # one page (state.json pageMap → target)
node skills/rollout/scripts/content-acceptance.mjs --all --report-only          # bulk triage: records + summary.md, exit 0, no gatesPassed
node skills/rollout/scripts/content-acceptance.mjs --slug <s> --target-url https://<preview>/<path>.plain.html   # one delivery-origin hit
```

- **Condition (what blocks).** Source = `stardust/current/pages/<slug>.html`
  (from the capture JSON's `renderedHtml`) scoped to `main | [role=main]`
  (else `--source-main` + `--source-exclude`, recorded); target = the migrated
  HTML's `main` minus `.metadata` / `.section-metadata`. Classes: headings
  (level + text), links (text + normalised path), images (count — the pipeline
  renames `src`), list items, table rows, words. 🔴 = **any count drop** in a
  class not covered by a `_meta.json#contentDeviations[]` entry (the 0.18.2 rule,
  unchanged), or words ratio < 0.9; 🟡 = ratio > 1.1 (clones). Exit 2 on 🔴, 0
  pass, 1 usage / `unmeasured` (a side missing — never a pass, never a FAIL).
  PASS appends `"content-count"` to `gatesPassed[]` and writes
  `stardust/migrated/_acceptance/<slug>.json` `{class{source, emitted,
  dropped[], extra[]}, words{source, emitted, ratio}, tolerances, covered[],
  verdict}` + `_acceptance/summary.md` (classes ranked by pages affected).
- **Escape hatch.** A `contentDeviations[]` entry `{kind, source, target,
  reason}` whose `source` matches the dropped text / href / src downgrades it to
  `covered` — recorded, never silent. Tolerances only as explicit flags
  (`--tolerance links=0.1,words=0.1`), echoed in the record and the summary; no
  default relaxation. `--report-only` writes records and never `gatesPassed`. A
  compiler record with `skipped[]` fails on any class not in `--skipped-allow`.
- **Hands-off.** Nothing to resolve interactively: a failed page stays
  `failed` with the reason, is listed under `content-count: P passed · C covered
  · F failed · U unmeasured` in Phase H, and the run continues (one page never
  aborts the rollout). Hands-off cannot author deviations or tolerances.
- **Protected.** Zero source hits; ≤ 1 delivery-origin hit only with
  `--target-url`; bulk `--all` over thousands of pages runs in the background
  (exit 124 / 143 = killed, no verdict); no threshold changes (B29); the deploy
  ledger is untouched (pre-PUT); role-level drill-down of a failed page is
  `diff`'s `content-diff.mjs` (today against the live source URL — one source
  hit per drill-down; a capture-as-source mode is pending), not a second
  classifier (B26).
