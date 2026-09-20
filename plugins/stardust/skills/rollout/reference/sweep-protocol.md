# Site-scale delivery — the wave driver, then sample, class triage, tail, one confirmation sweep

## When to read what

§ Wave driver is Phase C's execution model: how a roster of pages moves through
capture → gate → preview → publish without an agent turn per page. The rest is
the fix loop that follows Phase E's structural verify — "does the DELIVERED site
match its source at every page?". Both sit **after** deploy's per-page reconcile
and the per-page published-origin gate (`replica`
`reference/source-fidelity-gate.md` § The published-origin gate), which stay
authoritative. A read-only sweep with no fixing is the `qa` skill; delivery
mechanics: `reference/delivery-gates.md` § Batched delivery at scale.

## Wave driver (`scripts/wave.mjs`)

```bash
node skills/rollout/scripts/wave.mjs <waveId> <roster> [--publish] [--pixel all|sample|none] [--stage <name>] [--unpark <reason|all>] [--timeout 600]
# roster: slug|type|url per line · state: stardust/rollout/waves/<wave>.state.json · progress: stardust/.work/rollout/wave.progress.json
```

**What it is.** A stage runner that composes the shipped primitives and owns none
of their contracts: `deploy-batch.mjs` (hash skip, merge-safe ledger, exit 3
halt, never `--force`), `progress.mjs` (progress file, one `SUMMARY wave …` line),
the lint and gate instruments (every verdict is the instrument's own), run-status
`blocked` + `next`. One driver process per state file; parallel shards are
separate rosters and state files (`<wave>-s0`, `<wave>-s1`). Waves stay
**author-only**: agents write files, the driver deploys centrally.

**Stage table** (class is fixed; `rollout.json` `waves.stages.<name>.cmd`
overrides a stage's command, never its class):

| stage | class | idempotent skip when | default command |
|---|---|---|---|
| capture | hard | `stardust/current/pages/<slug>.html` exists | `crawl.mjs --url {url} --pages {path}` |
| build | hard | the migrated document exists | none — `migrate` is the skill |
| convert | hard | `content/<path>.html` exists | none — deploy methodology / project converter |
| lint | hard | recorded `contentHash` equals the file | `delivery-lint.mjs --file {file} --path {path}` |
| local-gate | hard | `localOk` with `contentHash` + `codeHash` current | `davids-model-lint.mjs {file}` |
| deploy | hard | ledger row `previewed`/`live` for THIS file's bytes | `deploy-batch.mjs … --paths {pathsFile}` (preview) |
| live-gate | hard | `liveOk` for the deployed bytes | `served-check.mjs {previewOrigin}{path}.plain.html --absent about:error` |
| publish | hard | ledger row `live`; runs only with `--publish` | `deploy-batch.mjs … --publish --paths {pathsFile}` |
| pixel | soft | `--pixel none` (default) | none — project gate; logs and proceeds |
| close | — | wave-level | `update-coverage.mjs --from-ledger`, report, parked table |

A hard stage with no command whose artefact is missing on any active page is a
start-time exit 2 (config error) — never a silent pass.

**Gate contract — what it blocks, on which condition.** A page is **parked**
(never the wave) when a hard stage fails: reasons `capture`, `build`, `convert`,
`lint` (P0/P1), `local-gate` (🔴), `preview` (a non-ok ledger row: `put-fail`,
`body-invalid`, `overwrite-guard`, `path-collision`, `verify-fail`), `live-gate`,
`publish`, `da-token` (deploy-batch exit 3), `config`. Parked pages leave every
later stage; the wave closes with the parked table (reason, detail, `next`) in
`waves/<wave>.report.md`. No threshold lives here — content 🔴 = 0, lint
P0/P1 = 0, delivered `.plain.html` 200 without `about:error` are each the
called instrument's own bar. Soft stages (pixel) log and proceed.

**Escape hatch.** `--unpark <reason|all>` clears the park and re-runs from the
failed stage — deploy-class parks (`preview`, `publish`, `da-token`) resume at
`deploy`; earlier parks re-run build → gate (artefacts that exist are skipped,
so a fixed converted file re-lints, re-gates and re-deploys). `--stage <name>`
runs one stage. No flag skips a hard stage; a `--stages` override that carries
`--force` on a batch command is refused (exit 2) — the ledger's hash skip is
the only re-drive rule.

**Hands-off.** Nothing to answer: parked pages carry a `next` line; a `da-token`
halt writes the `blocked` line with `next` (`../stardust/reference/run-status.md`),
the token-free stages of the delivered pages complete, the close still runs,
publish stays preview-only (D16 — `--publish` is explicit or a `decisions.md`
publish row), and the next wave starts in the same turn. Hands-off removes
waiting, never validation.

**Order (D1/D16).** deploy (preview) → live gate on the **preview** origin →
publish only for pages whose live gate passed → close. Publishing before the
live gate, then gating on live, is the anti-pattern this order names.

**No verdict.** A stage child exiting 124 (deadline, `--timeout`, default
600 s) or 143 leaves the page at its stage, counts `noverdict` in the progress
file and `SUMMARY`, and lists it for re-run — never a park, never a FAIL. A
no-verdict page does not enter the deploy batch.

**Hash re-gate.** `contentHash` (sha1 of `content/<path>.html`, recorded at the
lint pass) changed → that page loses `localOk` and `liveOk` and re-runs from
lint; `deploy-batch`'s own body hash decides the PUT. `codeHash` (sha1 over
`blocks/ styles/ scripts/ head.html`, recorded at the local-gate pass) changed →
every deployed page re-runs the local gate only; nothing re-converts or
re-deploys. The capture is read once at `capture`; no stage re-fetches the
source (hit-minimisation).

**State** (`waves/<wave>.state.json`, tracked ledger; progress is `.work/`
residue): `{waveId, startedAt, updatedAt, pages: {slug: {type, url, path,
stage, parked?, parkedDetail?, parkedAt?, next?, contentHash?, codeHash?,
localOk?, deployed?, deployedHash?, liveOk?, published?}}}`. Timestamps are
ISO UTC, as every status line. Exit: 0 every active page deployed (published
with `--publish`) · 1 a page parked · 2 usage/config · 3 token halt.

**Budget (observed, one field site, 500-page waves).** 1–147 agent turns and
0.13–13.6 M tokens read per wave with the driver, against ≈ 1.1 M tokens per
page without it; target ≤ 50 turns per wave. The parked table is the only LLM-touched output.

## The fix loop

1. **Reference once.** Capture the live side once per page and width into the
   gates dir and reuse it for every round (`gate.sh` keeps `live.png` when
   present; `anchor.mjs --cache`, `chrome-parity.mjs --live-cache`). A live
   capture is re-taken only when the source itself changed. One browser
   instrument at a time against the live host.
2. **Template sample.** Gate the `node skills/rollout/scripts/plan.mjs
   --sample 3` set per template (printed in delivery order), representative
   first — the representative is the template's **archetype** (the page the
   prototype phase gated; `inventory.mjs` groups siblings under it). Triage
   **class-complete per page**: list every large delta on the page (band table
   + anchor probe), not the first divergence, and name each delta's class (a
   block's CSS, a section style, a chrome state, an importer rule,
   page-specific content).
3. **Fix once per class, re-gate only the mapped pages.** One fix per class,
   then `node skills/rollout/scripts/wave.mjs regate-list --since <ref>` lists
   the pages the change maps to (`slug<TAB>path<TAB>reason`): `blocks/<name>/**`
   → the block's `usedByPages`; `styles/`, `scripts/`, `head.html`, chrome and
   fragments → every page (`site-wide`); `content/<path>.html` → that page; a
   file no rule maps → every page (`unmapped→all`). Fail-open by contract: a
   wrong mapping costs time, never a skipped defect. `--files <list>` instead
   of a git range; `--all` forces the full list; `--json` adds the ledger's
   `bodyHash`/`branch` per page. Never re-gate the whole site for a class fix.
4. **Tail.** After at most **3** class rounds the remainder is page-specific:
   class-level fixing on the residual tail leaves most pages unchanged and
   regresses some. Switch to a one-page loop (gate → fix → re-gate) on the
   priority pages the owner names; every other residual is ledgered per
   `source-fidelity-gate.md` § Residual logging format with an owner item.
   Do not start a fourth class round.
5. **One unattended confirmation sweep.** Gate every delivered page once,
   against **preview**; publish follows the pass (the D1 default). The sweep is
   full by contract — `regate-list` narrows class rounds, never this step.
   Output: the residual ledger, the allowlist of accepted residuals, and the
   owner-item list — nothing else re-runs.
6. **Report.** The Phase H report carries the sweep's ledger and allowlist
   next to the delivery ledger and the wave reports; class rounds used and
   pages in the tail are the two numbers that tell the reader how converged
   the site is.

## Ops rules while the loop runs

- A CSS-only fix batch never triggers a content re-drive; content re-imports
  and CSS purges are separate batches with separate ledgers.
- No CSS purge or publish while a sampled gate is capturing — a capture that
  straddles a publish measures two sites.
- One browser instrument while a deploy batch runs (the master skill's wait
  discipline applies to both).
- The confirmation sweep is background work with a per-page ledger; check it
  on the wait discipline, never with a long fixed sleep.
