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
3. **Behavior:** flag-only. No folder renames. Findings go to the handoff
   `cleanup` array with remediation guidance.
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

## Out of scope

- No auto-rename / auto-remap of folders (flag-only).
- No new top-level canonical BPA pattern; URC lives under `osgiConfig`.
- No changes to the 6.5-LTS skill tree.
- Run modes in Repo Init / sling mappings beyond folder names.

## Files touched

| File | Change |
|------|--------|
| `scripts/osgi-config-runner.js` | New `validateRunmodeFolder` + `install.*`/`config.*` run-mode scan (local fallback) |
| `scripts/runbook-generator.js` | BPA-first URC sub-step inside the config-scan block |
| `scripts/bpa-local-parser.js` | Map `unsupported.runmode` subtype (path-keyed) |
| `scripts/unified-collection-reader.js` | Same subtype mapping for unified collections |
| `scripts/runbook-generator.test.js` | URC report-first + fallback + regression tests |
| `references/osgi-cfg-json-cloud-manager.md` | URC relabel, ordering rule, install scope, remediation, cleanup enum |
| `scripts/README.md` | Add `unsupported.runmode` to the supported-patterns table |
