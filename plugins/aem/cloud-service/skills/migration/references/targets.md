# Step 3: the targets of a pattern session

Paths that start with `scripts/` are relative to the migration skill directory, the folder of `SKILL.md`. `{code-assessment}` is `skills/aem/cloud-service/skills/code-assessment/`.


**Check for a cached runbook first.** If `./migration-runbook.json` (or the path passed to
`generateRunbook`'s `cachePath` option) exists and its `findingsByPattern[<active pattern>]` array
is non-empty, reuse it instead of re-deriving findings:

- Load `{ generatedAt, workspaceRoot, sourceByPattern, findingsByPattern }` from the cache file.
- Take `allFindings = findingsByPattern[<active pattern>]`. Each entry is
  `{ pattern, file, line, snippet }` — `file` is **relative to the cache's `workspaceRoot`**
  (resolve with `path.join(workspaceRoot, file)`); `line`/`snippet` are `null` when the pattern's
  source was `mcp`/`csv` (BPA-sourced findings never carry line/snippet; only the `analyzer`,
  `html-scan`, and `config-scan` sources do). `osgiConfig` findings additionally carry a `kind`
  and, for `already-placeholdered` rows, `informational: true` — skip those when building the fix
  work list. The same applies to `inputStream` informational rows (benign-only files,
  `bpa-unmatched`, `missing-source`, `platform-provided`, `not-in-workspace`); its file findings
  carry `line`/`snippet` plus a `sites` array, so no re-detection is needed.
- Slice the batch with the same paginate helper that `getBpaFindings` uses:
  ```javascript
  const { paginate } = require('./scripts/unified-collection-reader.js');
  const { targets, paging } = paginate(allFindings, { offset, limit: 5 });
  ```
  This keeps the exact same `{ targets, paging }` envelope, batch-of-5 default, and
  `paging.nextOffset` semantics as the live `getBpaFindings` path below in this file — only the data source
  differs. Do not bypass the batch-of-5 discipline just because the whole array is already in
  memory.
- Tell the user: *"Reusing N findings for `<pattern>` from the existing runbook (generated at
  `<generatedAt>`)."*
- Hand the batch to code-assessment as a **`with_findings (pre-resolved)`** invocation (see
  `{code-assessment}/references/runbook.md`). Findings with `line`/`snippet` already populated skip
  the analyzer re-run entirely; findings with only `file` populated (BPA-sourced) still trigger one
  `analyze.sh --files <paths>` call inside code-assessment to resolve `line`/`snippet` before the
  edit plan is built.
- If the cache is missing, has no entries for the active pattern, or the user explicitly says
  "re-scan" / "refresh", fall through to the live flow below unchanged.

**For BPA patterns** (`scheduler`, `resourceChangeListener`, `replication`, `eventListener`, `eventHandler`, `assetApi`, `lui`, `cdw`) **when no usable cache exists**: Run **`getBpaFindings`** (with `bpaFilePath` when provided). Internally: cache → CSV → MCP → manual **only when each step is applicable and succeeds**; if MCP fails, obey **MCP errors** in `SKILL.md` (stop; no silent chain). For MCP details, [references/cam-mcp.md](cam-mcp.md).

For `lui` findings, the `identifier` in each target is the **JCR component path** (e.g. `/apps/myapp/components/content/mycomp`) — not a Java class name. Resolve it to the filesystem path using the [JCR → filesystem mapping](legacy-ui/dialog/context.md#jcr-path--filesystem-path) before opening files. **Note:** `luiCoral2` is not a standalone BPA pattern id — Coral 2 dialogs appear as the `legacy.dialog.coral2` sub-type within `lui` results. Do not call `getBpaFindings('luiCoral2', …)` independently; call `getBpaFindings('lui', …)` and filter by sub-type inside Branch D.

For **`dispatcherConversion`**, targets are the Dispatcher config root(s) and detected mode from the `dispatcher-inventory.js` scan (surfaced in the Step 0 runbook), not from BPA — go straight to **Branch E**.

For **`assetWorkflowMigration`**, targets are the whole Maven project — the tool migrates every affected model in one run, so there is no batching. Go straight to **Branch H** in `SKILL.md`.

For **`inputStream`**, the precedence is the same as for the other BPA patterns: the runbook cache (above), then BPA findings — CAM via `list-bpa-findings-by-pattern` (or the deprecated `fetch-cam-bpa-findings-by-pattern`) with `pattern: "inputStream"`, then a BPA CSV — and the local scan only when BPA has no `inputStream` findings. BPA names classes, not lines, so always run the scanner once to resolve them: write the CAM targets to a JSON file and run `node scripts/input-stream-runner.js <workspaceRoot> --bpa-json <cam-targets.json> [--csv <bpa.csv>] --json` (CAM targets win over the CSV; with neither, it scans the whole workspace). Do **not** hand BPA rows to `analyze.sh`. With BPA rows, only the reported classes are in scope: the scanner resolves them to workspace files with line-level sites and collapses classes outside the workspace per bundle (per package for CAM rows, which carry no bundle name). A batch is **five non-informational file findings** in the scanner's (risk) order. After editing a batch, verify with `--files <touched files>` (a missing or unreadable path fails the re-scan). Full loop: [references/input-stream.md](input-stream.md).

`getBpaFindings` returns **a batch of 5 findings** (default `limit=5`) along with a `paging`
envelope. The agent processes that batch only; it does **not** request the next batch until
the user says to continue. See **Batched processing (batch size 5)** in [bpa-helper.md](bpa-helper.md).

**For `htlLint`**: Skip BPA/CSV/MCP. If a cached runbook entry already has `htlLint` findings
(they carry `"confidence": "heuristic"` — regex matches, not compiler-validated), reuse them per
the cache-first rule above, but **re-open and re-confirm each hit** against the patterns in
`{code-assessment}/references/data-sly-test-redundant-constant.md` before editing. If there is no
cache, targets come from proactive `rg` discovery. See **htlLint flow** in `SKILL.md`.

**For `osgiConfig`** (OSGi → Cloud Manager): the cache holds heuristic, review-only findings
(`"confidence": "heuristic"`, key names + locations only — **no secret values**). Use them as a
starting checklist, then follow **Branch A** in `SKILL.md` and [references/osgi-cfg-json-cloud-manager.md](osgi-cfg-json-cloud-manager.md)
to classify each value (real secret? Adobe-owned PID → `needs_user_review`) — never trust the
heuristic `plaintext-secret` label without confirming.
