# Gate 8 — Published-origin page gate + coverage regime (Phase C → E)

The release condition of a `flow: replica` rollout: every delivered page carries
its own published-origin number (`scripts/gate-publish.mjs`) or is held. SKILL.md
Phase C step 4 names it in one sentence; the contract — condition, escape
hatches, hands-off resolution, protected contracts — lives here and nowhere
else. Gates 1–4 + batched delivery: `delivery-gates.md`; Gates 5–7:
`measured-gates.md`.

## Gate 8 — Published-origin page gate (the release condition; D1 instrument)

The archetype gate proves the recreation; **every delivered page** carries its
own published-origin number or is `ungated`. The instrument is
`scripts/gate-publish.mjs`; the release condition is the publish run reading
its report. The script never publishes. The hold lives in
`deploy-batch.mjs --publish` (`../../deploy/scripts/deploy-batch.mjs` header
§ Publish hold): it reads `stardust/rollout/gate-report.json` (default when
present; `--gate-report <f>` names another — a named file that is missing is
exit 2, nothing read), prints `held (gate: …)` per row, counts `held=<n>` in
the SUMMARY and prints the coverage line with `· held h`; `deploy-page.mjs`
forwards the flags and books a held page `held` (chain exit 1). Both halves
implement the condition below; the fixture test is
`deploy/scripts/test/deploy-batch-gate.test.mjs`.

```bash
node skills/rollout/scripts/gate-publish.mjs --all-delivered --origin https://<branch>--<repo>--<org>.aem.page   # every page (≤ 150 delivered)
node skills/rollout/scripts/gate-publish.mjs --sample 10 --seed <run-seed> --exclude <fix-loop slugs> --origin <preview>   # coverage regime, > 150
node skills/rollout/scripts/gate-publish.mjs --all-delivered --report      # offline: records → gate-report.{json,md} + delivery.gate
node skills/rollout/scripts/verify.mjs --gate-report stardust/rollout/gate-report.json   # Phase E: read, never re-judge
node skills/deploy/scripts/deploy-batch.mjs … --publish [--plan]           # holds every row without a PASS; --plan prints the held reasons offline
```

- **Condition (what blocks).** On the explicit publish run a `previewed`
  ledger row is **held** — not `POST /live/`'d, status unchanged, plan reason
  `held (gate: 360 FAIL 12.4 % Δh -112)` / `held (gate: ungated — no
  published-origin number)` / `held (gate: unmeasured — 1440 exit 124)` /
  `held (gate: template <t> not at the bar)` (pages with no template are the
  report's `untyped` group and take its bar) — unless `gate-report.json`
  `pages[path].latest.pass === true`: PASS at **every configured breakpoint**, where PASS per breakpoint =
  the round record's own `pass` ∧ |Δh| ≤ 8 px ∧ header + footer crops pass
  `crop-compare` (no bar restated or configurable — B29). Already-`live` rows
  are never unpublished; an unchanged live row is skipped as today and its
  FAIL is reported `published-failing`; a changed live row is a re-publish and
  is held like any other. `/index` ≡ `/`. `--force` never lifts a hold. `gate-publish.mjs` exits 2 on any FAIL,
  0 when every measured page passes, 3 when a page is blocked (challenge /
  auth) — never on 124. Under `flow: replica` a row is `verified` only with
  `delivery.gate.status === 'pass'` (`coverage-model.md` § `delivery.gate`).
- **Escape hatches (operator / owner, never hands-off).** (a)
  `--publish-no-regression` — changed already-live rows only: a FAIL row whose
  every breakpoint is ≤ `bestOfLast3 + 1` point publishes, plan reason
  `changed (gate: no-regression: 1440 24.9→23.0)`, report status stays
  `published-failing`. (b) `--publish-ungated` — rows with no report entry:
  redesign-flow sites and the `decisions.md` `publish` row owner-decided `live`
  (D16). (c) **The residual door** (`gate-publish.mjs`, shipped): a residual
  under `progress.json` `archetypes[].published.<bp>.residuals[]` — the
  archetype's own row, or a row naming `page: <slug>` for a sibling of that
  type — that passes § Residual logging format
  (`../../replica/reference/source-fidelity-gate.md`: named class or
  `register:R-nn`, `artifacts[]`, `acceptedBy`; `hands-off-policy:` only on a
  permanent class) makes that over-bar breakpoint a PASS row, reason
  `residual <class>`; an invalid one leaves the row FAIL and the reason names
  the defect. Prototype-regime residuals (`breakpoints.<bp>.residuals[]`) are
  never read here. No `--bar`, no threshold flag.
- **Hands-off.** Phase C previews, runs `gate-publish.mjs` over the delivered
  pages (the coverage regime below decides sample vs every page), then the
  `--publish` run **naming the report** (`--gate-report
  stardust/rollout/gate-report.json` — an absent report is then exit 2, never
  the operator's ungated WARN path), which goes live with exactly the PASS rows
  and holds the rest; prints the coverage line `published-gated P of M · PASS p · FAIL f ·
  unmeasured u · ungated r · held h` (the publish run prints it);
  writes `status: blocked` with the re-drive command when any row is held; **never** passes `--publish-ungated` or
  `--publish-no-regression`; never self-accepts an unnamed residual. D1 becomes
  mechanical, not judged; D16 kept — hands-off publishes only PASS rows.
- **No verdict ≠ FAIL (B32).** Exit 124 / 3 / 5 / 6 from an instrument, or a
  round that wrote no record for its label (exit 1 / 125) → report status
  `unmeasured` (or `blocked`), row held with that reason, never counted as
  FAIL and never read from an older round; `pixelPctUnmasked` is recorded beside the gated number as the
  `neutralDiff` KPI (reporting, not a bar — `handoff-report.md` § Reporting
  KPI), never substituted for it (B9).
- **Hit-minimisation.** Live side captured once per page × breakpoint
  (`gate.sh` `live.png` + sidecar, `anchor-live.json` — the driver reads the
  cached probe file itself, never re-probes live for the chrome crops),
  refreshed only by the 24 h drift probe (`--refresh`); one `gate.sh` round at a time by default —
  `--concurrency 2` runs two rounds at once only over pages whose live capture
  is cached at every width (they run after the uncached pages); `--variance` (a second live hit) only
  where the gate doc names it. The prototype-regime cap and the published-origin
  cap are separate (labels `iter<k>` / `pub<k>` in the same gate dir).
- **Access-restricted previews.** `stitch-shot.mjs` accepts `--storage-state
  <file>` (an admitted session), but `gate.sh` and `gate-publish.mjs` do not
  forward it yet, so a site-token-protected preview cannot be stitched from
  the gate: gate on `aem.live` after an owner-decided publish, or wait for the
  pass-through — state the limitation in the report, never skip the gate.

### Coverage regime (which pages count as gated)

- **≤ 150 delivered pages:** the confirmation sweep (`sweep-protocol.md`
  step 5) is every page × every configured breakpoint through
  `gate-publish.mjs --all-delivered`; the fix loop's template sample
  (`sweep-protocol.md` step 2) is the same `--sample` draw at any size.
- **> 150:** every archetype + a **seeded random sample per template**
  (`--sample <n ≥ 10> --seed <run seed> --exclude <fix-loop slugs>` — never the
  delivery-order head, never a page the fix loop touched; seed and draw recorded
  in the report), expanding n → 4n → all as class rounds close. Every other page
  is `ungated` until measured; a cheap geometry probe that ranks pages into the
  stitched gate is advisory until it lands.
- **A template is at the bar** when every sampled page PASSes at every
  configured breakpoint or carries a named-class residual; a template not at the
  bar is **not published** (its rows are held). Median / p90 / share < 10 % per
  template fill `neutralDiff` — reporting only; the pass bar stays per page with
  the existing bars (no aggregate threshold, B29). No-verdict rows are excluded
  from the sample counts.
- **Hands-off** stops at preview with the coverage line and the ranked class
  table (`stardust/scripts/class-report.mjs`), writes `status: blocked` with the
  exact re-drive, never publishes a template not at the bar.
