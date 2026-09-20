# Waves — the resumable wave driver (`scripts/wave.mjs`, Phase C)

## When to read what

Phase C's execution model: a roster of pages moves through capture → gate →
preview → publish without an agent turn per page. § Stage table and § Gate
contract are the rules; § Escape hatch and § Hands-off answer the questions asked
of any gate; § State is the file you read to resume. The fix loop after Phase E
is `sweep-protocol.md`.

```bash
node skills/rollout/scripts/wave.mjs <waveId> <roster> [--publish] [--pixel all|sample|none] [--stage <name>] [--unpark <reason|all>] \
     [--concurrency 2] [--timeout 600] [--stages <json>] [--out stardust/rollout] [--repo <eds-root>] [--dry-run]
node skills/rollout/scripts/wave.mjs regate-list [--since <ref> | --files <list|file> | --all] [--json] [--out …] [--repo …]
# roster: slug|type|url per line · state: stardust/rollout/waves/<wave>.state.json · progress: stardust/.work/rollout/wave.progress.json
# exit 0 all deployed (published with --publish) · 1 parked / held / FAIL · 2 usage, config · 3 token halt · 124 never a verdict
```
A stage runner that composes the shipped primitives and owns none of their
contracts: `deploy-batch.mjs` (hash skip, merge-safe ledger, exit 3 halt, never
`--force`), `progress.mjs` (progress file, one `SUMMARY wave …` line), the lint and
gate instruments (every verdict is the instrument's own), run-status `blocked` +
`next`. One driver process per state file; parallel shards are separate rosters
and state files (`<wave>-s0`, `<wave>-s1`). Waves stay **author-only**: agents
write files, the driver deploys centrally.

## Stage table
Class is fixed; `rollout.json` `waves.stages.<name>.cmd` overrides a stage's
command, never its class (`null` disables a close step).
| stage | class | idempotent skip when | default command |
|---|---|---|---|
| capture | hard | `stardust/current/pages/<slug>.html` exists | `crawl.mjs --url {url} --pages {path}` |
| build | hard | the migrated document exists | none — `migrate` is the skill |
| content | hard | `contentOk` for the migrated file's bytes | `content-acceptance.mjs --slug {slug} --target {migrated}` (Gate 7: exit 2 parks `content`; exit 1 = unmeasured = no verdict) |
| convert | hard | `content/<path>.html` exists | none — deploy methodology / project converter |
| lint | hard | recorded `contentHash` equals the file | `delivery-lint.mjs --file {file} --path {path}` |
| local-gate | hard | `localOk` with `contentHash` + `codeHash` current | `davids-model-lint.mjs {file}` |
| deploy | hard | ledger row `previewed`/`live` for THIS file's bytes | `deploy-batch.mjs … --paths {pathsFile}` (preview) |
| live-gate | hard | `liveOk` for the deployed bytes | `served-check.mjs {previewOrigin}{webPath}.plain.html --absent about:error` |
| publish | hard | ledger row `live`; runs only with `--publish` | `deploy-batch.mjs … --publish --paths {pathsFile}` over the live-gated pages **minus the held rows** (§ Hands-off, order, no verdict) |
| pixel | soft | `--pixel none` (default); `sample` = first roster page per type, the rest stamped `pixelSkipped` (reached by `all`) | none — project gate; logs and proceeds |
| close | — | nothing ran this run (idempotent re-run) | `update-coverage.mjs --from-ledger`; `verify.mjs --paths <deployed pages> --base {previewOrigin}`; `dashboard.mjs`; `waves.close[]`; report + parked table |

`{path}` is the served path (`/` for the home page); `{webPath}` is deploy-batch's
ledger key for the same file — identical except `/` → `/index` — used by the paths
file, the ledger lookup and the live-gate URL; capture and lint use `{path}`. A hard
stage with no command whose artefact is missing on any active page is a start-time
exit 2 (config error) — never a silent pass. Close steps are logged in the report
(verify's own `SUMMARY` line quoted), never a park; the journal line and the
learnings row are the agent's Phase H step, fed by the report and the `SUMMARY` line.

## Gate contract — what it blocks, on which condition
A page is **parked** (never the wave) when a hard stage fails: reasons `capture`,
`build`, `content` (Gate 7 exit 2), `convert`, `lint` (P0/P1), `local-gate` (🔴), `preview` (a non-ok ledger
row: `put-fail`, `body-invalid`, `overwrite-guard`, `path-collision`,
`verify-fail`), `live-gate`, `publish`, `da-token` (deploy-batch exit 3),
`config`. Parked pages leave every later stage; the wave closes with the parked
table (reason, detail, `next`) in `waves/<wave>.report.md`. No threshold lives
here — content 🔴 = 0, lint P0/P1 = 0, delivered `.plain.html` 200 without
`about:error` are each the called instrument's own bar. Soft stages log and proceed.

## Escape hatch

`--unpark <reason|all>` clears the park and re-runs from the failed stage —
deploy-class parks (`preview`, `publish`, `da-token`) resume at `deploy`; earlier
parks re-run build → gate (existing artefacts are skipped, so a fixed converted
file re-lints, re-gates and re-deploys). `--stage <name>` runs one stage for the
pages that completed the stage before it; a page whose earlier hard stage is not
satisfied is listed `not ready` (`notready=` on the `SUMMARY` line), never run. No
flag skips a hard stage; a `--stages` override carrying `--force` on a batch
command is refused (exit 2) — the ledger's hash skip is the only re-drive rule.

## Hands-off, order, no verdict
**Hands-off** has nothing to answer: parked pages carry a `next` line; a `da-token`
halt writes the `blocked` line with `next` (`../../stardust/reference/run-status.md`),
the token-free stages of the delivered pages complete, the close still runs,
publish stays preview-only (D16 — `--publish` is explicit or a `decisions.md`
publish row), and the next wave starts in the same turn. Hands-off removes
waiting, never validation. **Order (D1/D16):** deploy (preview) → live gate on the
**preview** origin → publish only for pages whose live gate passed **and whose
gate artefacts read PASS** → close; publishing first and gating on live is the
anti-pattern this order names. **The publish hold** (`publish-gate.md` § Gate 8
condition, `measured-gates.md` § Gate 5–7; read, never re-judged): a live-gated
row is held — stays `previewed`, never parked — when `gate-report.json`
`pages[path].latest.pass !== true` (`held gate:<status>`, `gate:ungated` with no
entry), when `stardust/migrated/_acceptance/<slug>.json` is not `pass`
(`content:<verdict>`), or when the coverage row's `delivery.gates.ai-readability`
/ `.editability` is absent (`:ungated`), `unmeasured` or below its own bar
(`:fail`). Held rows print a table with the re-drive per class, `held=` on the
`SUMMARY` line and one `blocked` status line; the wave exits 1 until they clear.
No flag publishes a held row — the escape is the instrument that produces the
artefact (`gate-publish.mjs`, `content-acceptance.mjs`, the two `--gate` ingests).
**No verdict:** a stage child exiting 124 (deadline, `--timeout`, default 600 s) or
143 — and `content-acceptance.mjs` exit 1 (unmeasured) — leaves the page at its
stage, counts `noverdict` in the progress file and `SUMMARY`, and is listed for
re-run — never a park, never a FAIL; it does not enter the deploy batch.
**Concurrency:** per-page stages run `--concurrency` wide (default 2) except
`capture`, always one page at a time — one browser instrument against the source
host (`sweep-protocol.md` § Ops rules).

## Hash re-gate
`contentHash` (sha1 of `content/<path>.html`, recorded at the lint pass) changed →
that page loses `localOk` and `liveOk` and re-runs from lint; `deploy-batch`'s own
body hash decides the PUT. `codeHash` (sha1 over `blocks/ styles/ scripts/
head.html`, recorded at the local-gate pass) changed → every deployed page re-runs
the local gate only; nothing re-converts or re-deploys. The capture is read once;
no stage re-fetches the source (hit-minimisation).

## State
`waves/<wave>.state.json` (tracked ledger; progress is `.work/` residue):
`{waveId, startedAt, updatedAt, pages: {slug: {type, url, path, stage, parked?,
parkedDetail?, parkedAt?, next?, held?: <gate>:<status>, heldNext?, invalidated?:
content|code, contentOk?, contentOkHash?, contentHash?, codeHash?, localOk?,
deployed?, deployedHash?, liveOk?, liveOkHash?, published?, publishedHash?,
pixelDone?, pixelSkipped?: sample}}}`. Timestamps are ISO UTC, as every status
line. Exit: 0 every active page deployed (published with `--publish`) · 1 a page
parked or held · 2 usage/config · 3 token halt. The `rollout.json` `waves` block
(`stages.<name>.cmd`, `ledger`, `content`, `previewOrigin`, `close[]`) is the
`waves` key of `schemas/rollout-config.schema.json` — the key-walk tests apply.

**Budget.** Target ≤ 50 agent turns per wave; the parked table is the only
LLM-touched output.
