# URC (Unsupported Run Modes Configuration) — Migration Skill Design

**Date:** 2026-09-01
**Branch:** `feat/migration-urc-runmodes` (from `origin/main`)
**Skill:** `plugins/aem/cloud-service/skills/migration`

## Problem

AEM as a Cloud Service supports only an exact, ordered set of run modes. OSGi
configuration folders named with unsupported run modes (custom tokens, or valid
tokens in the wrong order) **silently have no effect** when deployed. Adobe's
Pattern Detector surfaces this as the **URC** finding
(`https://experienceleague.adobe.com/en/docs/experience-manager-pattern-detection/table-of-contents/urc`).

The migration skill's OSGi config handling describes an "Invalid runmode folders"
step (Phase 1a of `references/osgi-cfg-json-cloud-manager.md`) but the detector
script `scripts/osgi-config-runner.js` **implements no run-mode validation at
all** — it only scans for secrets, legacy formats, and placeholders. So URC is
effectively unhandled.

## Authoritative standard (Adobe docs + real BPA report)

Supported run-mode tokens:
- **Tier:** `author`, `publish`
- **Environment:** `dev`, `stage`, `prod`
- `preview` **inherits** OSGi config from publish and **cannot be declared** as
  a `config.preview` folder.
- **Custom run modes are unsupported.**

**Ordering rule (critical):** the tier token must precede the environment token.
`config.author.dev` is valid; `config.dev.author` is **not**. A folder may carry
at most one tier and at most one environment token. Resolution is at PID level —
the config with the most matching run modes wins.

Valid folder names: `config`, `config.author`, `config.publish`, `config.dev`,
`config.stage`, `config.prod`, `config.<author|publish>.<dev|stage|prod>`.

### How URC appears in the BPA report (verified against a real report)

CSV columns: `code,type,subtype,importance,identifier,message,context`

| Column | Value |
|--------|-------|
| `code` | `URC` (detail rows); `_COUNT_URC` (summary row, excluded) |
| `type` | `unsupported.runmode.configuration` |
| **`subtype`** | **`unsupported.runmode`** ← the token the parser maps on |
| `importance` | `CRITICAL` |
| `identifier` | JCR folder path, e.g. `/apps/bcbsmgeneral/config.dev.author` |
| `context` | `{"data":{"runmode":"dev.author"},"type":"unsupported.runmode"}` |

Real flagged examples confirming the ordering rule: `config.dev.author`,
`config.prod.author`, `config.stage.author` (valid tokens, wrong order) and
`config.preprod`, `config.author.preprod` (unknown token `preprod`).

## Decisions (locked)

1. **Source:** BPA-report-first (via CAM/MCP or local BPA CSV), local detection
   only as fallback when no BPA source provided URC findings.
2. **Home:** URC stays **under the `osgiConfig` pattern** — not a new top-level
   canonical pattern. Only the URC *sub-portion* becomes report-first; the
   secret/legacy/placeholder scan stays always-local.
3. **Behavior:** matches the fix UX shared by Branch A (OSGi) and code-assessment
   — *detect → (opt-in) the skill applies the edit directly → the developer
   reviews the diff and commits.*
   - **Runbook / discovery = read-only:** URC is flagged, nothing is moved.
   - **Apply (opt-in, Branch A):** for the deterministic subset — *ordering-only*
     violations where every token is a valid tier/env in the wrong order
     (`config.dev.author` → `config.author.dev`) — the skill applies the reorder
     itself with **`git mv`** (preserves rename history; falls back to a plain
     move if the path isn't git-tracked), exactly as Phase 0 auto-converts legacy
     configs. Applied reorders are recorded in the handoff for an audit trail.
   - **Never auto-applied → handoff `cleanup` for a human decision:** unknown-token
     folders (`config.preprod`, `install.local`), duplicate tier/env folders, and
     any reorder whose target already exists (collision).
   - The skill **never commits** — the developer reviews the diff and commits,
     per both skills' rules.
4. **Coverage:** `config.<runmode>` **and** `install.<runmode>` folders.
5. **Subtype:** map BPA `subtype` = `unsupported.runmode`, path-keyed by
   `identifier` (like the existing content/legacy-UI subtypes).

## Architecture

### Sourcing split within `osgiConfig`

`osgiConfig` keeps `strategy: 'config-scan'` and always runs locally for
secrets/legacy/placeholders. The **URC sub-step** is report-first:

```
in the config-scan block of runbook-generator.js:
  urcFromBpa = bpaMode ? getBpaFindings('urc' → subtype 'unsupported.runmode') : none
  if urcFromBpa has targets → use them for URC; skip local run-mode detection
  else → run local run-mode folder detector (osgi-config-runner.js)
  merge URC findings into osgiConfig findings; tag source (bpa vs config-scan)
```

This satisfies "keep inside osgiConfig but make it BPA-first" without suppressing
the always-local secret/legacy scan.

### Safe auto-reorder fix — planner + skill-applied `git mv` (`osgi-config-runner.js`)

`reorderRunmodeFolder(folderName)` — pure. Returns `{ from, to }` (basename-level)
only when the folder is a **pure ordering** problem: every token a known
tier/env, at most one of each, currently out of canonical order. Returns `null`
for valid folders, unknown tokens, or duplicate tier/env (those are not
deterministically fixable). Canonical order is `<prefix>.<tier>.<env>`.

`planRunmodeReorders(workspaceRoot)` — **read-only** planner (walks the tree,
writes nothing). For each unsupported folder that `reorderRunmodeFolder` can fix
and whose target folder does **not** already exist, it emits
`{ from, to, command }` where `command` is `git mv "<rel-from>" "<rel-to>"`
(paths relative to `workspaceRoot`). Folders that are not auto-fixable (unknown
token / duplicate tier/env) or whose target already exists (**collision** —
renaming would change PID resolution) go to `manual` with a reason. Returns
`{ ok, reorders: [{from,to,command}], manual: [{folder, target?, reason}] }`.

The planner never mutates. During **apply** (opt-in, Branch A), the skill runs
each `reorders[].command` itself — the same way Phase 0 applies its conversions —
records the applied moves in the handoff, and routes `manual` items to the
handoff `cleanup` array. The developer reviews the resulting diff and commits.

### Local fallback detector (`osgi-config-runner.js`)

New pure function `validateRunmodeFolder(folderName)`:
- Match `^(config|install)(\.[a-z0-9-]+)+$` (a run-mode-qualified folder).
- Split trailing tokens on `.`; classify each as tier / env / unknown.
- Flag when: any unknown token; more than one tier or more than one env; an env
  token appears before a tier token (ordering); or `preview` is used.
- Return the offending run-mode string (joined tokens) for parity with the BPA
  `context.data.runmode`.

Walk both `config.*` and `install.*` folders. For `install.*` the folder token
is validated (contents — `.jar`/packages — merely anchor the finding). Emit
`kind: 'unsupported-runmode'`, `severity: 'high'`, location = folder path,
detail = the run-mode string + suggested action. Never modifies anything.

### Parser mapping (`bpa-local-parser.js`, `unified-collection-reader.js`)

Add `unsupported.runmode` to the content-style (path-keyed) subtype handling and
the slug↔subtype maps so `getBpaFindings('urc', …)` resolves it. Summary rows
(`code` starting with `_`, e.g. `_COUNT_URC`) remain excluded by existing logic.

### Reference doc (`references/osgi-cfg-json-cloud-manager.md`)

Relabel Phase 1a as **URC**, cite the Adobe URC page + supported-run-modes and
run-mode-resolution docs. Document the **ordering rule**, the `preview` rule, and
the `install.<runmode>` scope. Align remediation with Adobe's steps: evaluate
necessity → rename to a supported identifier → follow resolution rules → see the
`aem-guides-wknd-legacy` `code/urc` example. Add `unsupported_runmode` to the
handoff `cleanup` `type` enum.

## Testing (`runbook-generator.test.js`)

- Report-first: when BPA provides `unsupported.runmode`, URC comes from the
  report and the local detector does not run.
- Local fallback catches ordering violation `config.dev.author`, unknown token
  `config.preprod`, and `install.local`; and passes valid `config.author.dev` /
  `install.publish` / bare `config`.
- `config.preview` is flagged (cannot be declared).
- Existing secret/legacy/placeholder behavior stays green (no regression).
- No secret value is ever emitted (hard safety rule preserved).
- `reorderRunmodeFolder` reorders `config.dev.author`→`config.author.dev`,
  returns null for valid folders, unknown tokens, and duplicate tier/env.
- `planRunmodeReorders` emits a `git mv` command for an ordering-only folder and
  writes nothing to disk; collision (target exists) → `manual`, not `reorders`;
  unknown-token folders → `manual`; command paths are relative to the workspace.

## Out of scope

- No auto-remap of **unknown-token** run modes (`preprod`→`stage`, etc.) — intent
  is ambiguous, so those stay flag-only. Only deterministic ordering-only
  reorders are auto-fixed.
- No new top-level canonical BPA pattern; URC lives under `osgiConfig`.
- No changes to the 6.5-LTS skill tree.
- Run modes in Repo Init / sling mappings beyond folder names.

## Files touched

| File | Change |
|------|--------|
| `scripts/osgi-config-runner.js` | New `validateRunmodeFolder`, `scanUnsupportedRunmodes` (local fallback), and `reorderRunmodeFolder` + `planRunmodeReorders` (emit `git mv` commands; no mutation) |
| `scripts/runbook-generator.js` | BPA-first URC sub-step inside the config-scan block |
| `scripts/bpa-local-parser.js` | Map `unsupported.runmode` subtype (path-keyed) |
| `scripts/unified-collection-reader.js` | Same subtype mapping for unified collections |
| `scripts/runbook-generator.test.js` | URC report-first + fallback + regression tests |
| `references/osgi-cfg-json-cloud-manager.md` | URC relabel, ordering rule, install scope, remediation, cleanup enum |
| `scripts/README.md` | Add `unsupported.runmode` to the supported-patterns table |
