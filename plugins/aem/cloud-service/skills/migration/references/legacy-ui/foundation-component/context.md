# Legacy Custom Component (Rich Text overlay / custom Parsys) — Discovery & Context

Handles BPA `lui` findings with sub-type `legacy.custom.component`. Routed through Branch D (Legacy UI), never Branch C (template modernization). Template handling is unchanged.

## Cases

| Classification | Signals | Proposed action |
|---|---|---|
| `richtext-overlay` | path overlays a foundation `richtext` node, or a dialog uses a richtext resourceType with `rtePlugins`/`uiSettings`/`htmlRules` | classify and plan; guarded xtype conversion only for confirmed `configuration-only` cases (see Rich Text section) |
| `custom-parsys` | `sling:resourceSuperType` resolves to the legacy parsys, or a script includes it | classify and plan; guarded supertype conversion only for a validated plain Parsys with an explicitly supplied target (see Custom Parsys section) |
| `unknown` | none, ambiguous, or conflicting signals | `needs-user-confirm` |

If structural inspection does not confirm the coarse signal, the entry is `needs-user-confirm` and never converts. Missing folders → `manual-review`. Only `convert-richtext-xtype` and `convert-parsys-supertype` can ever be applied.

## Discovery

1. `getBpaFindings('lui', { bpaFilePath, collectionsDir, limit: 5, offset: 0 })`; keep `identifier === 'legacy.custom.component'`. Do not reimplement BPA parsing. `className` is the JCR component path; map via `/apps/<rest>` → `ui.apps/src/main/content/jcr_root/apps/<rest>`.
2. If BPA lacks detail, bounded workspace-only inspection of the component folder (≤25 files, depth 2) is allowed; the evidence source is recorded as `heuristic/local-inspection`.
3. Classify **before** any modification, then run the dry-run:

```bash
# programmatic: planLegacyComponents(workspaceRoot, { bpaOptions, extraPaths }) + renderDryRun(plan)
```

## Dry-run report (read-only, no source changes)

Per component: component path, evidence (+source `bpa` | `heuristic/local-inspection`), classification, proposed action, risk/blocked reason, files that would change.

## Confirmation gate

Show the dry-run table and ask the user to confirm per component. `canApply(entry, userConfirmed)` is true only for classified, unblocked entries with explicit confirmation. Unknown/unsafe cases stay `needs-user-confirm` / `manual-review`.

## Rich Text overlay (component level)

Detection is structural (`scripts/richtext-overlay.js`): a `cq:Component` folder at any path whose XML references a richtext resourceType/xtype or RTE config. `render.jsp` alone never qualifies. Enable with `planLegacyComponents(root, { scanWorkspace: true })`.

| Classification | Meaning | Action |
|---|---|---|
| `configuration-only` | no JSP; declarative config | `convert-richtext-xtype` (only the mapping in [extjs-to-coral3.md](../dialog/extjs-to-coral3.md): `xtype` richtext/htmleditor → `cq/gui/components/authoring/dialog/richtext` + `useFixedInlineToolbar`, RTE children preserved), `no-change` if already declarative, or `needs-user-confirm` if clientlibs are referenced or `useFixedInlineToolbar` is already set (the mapping would overwrite an explicit value) |
| `custom-jsp-ui` | JSP is static markup only | `needs-user-confirm` (proposal only) |
| `custom-jsp-behavioral` | JSP has imports, scriptlets, conditions, request/session/service access | `manual-review` |
| `unknown` | dynamic expressions, unresolved includes, unreadable JSP | `manual-review` |

Inspection of a component never descends into a nested `cq:Component` folder, so evidence and `filesToChange` always belong to the reported component. `render.jsp` is never rewritten or deleted; removal needs a proven replacement for every detected behavior plus the confirmation and validation gates, and no code path performs it. `applyRichTextConversion(entry, root, userConfirmed)` edits only the XML files listed in the plan.

## Custom Parsys (component level)

Detection (`scripts/custom-parsys.js`, enable with `scanParsys: true`) is structural: `resourceSuperType` (direct, or inherited through supertypes that resolve inside the workspace), or a JSP/HTL include of the legacy parsys resourceType. Names are never used. Modern containers (e.g. Core `container`) do not match. This flow never calls Branch C (template modernization).

Classifications: `plain-legacy-parsys`, `custom-layout` (layout props, selector/suffix/resourceType overrides, nested containers), `custom-column-control`, `custom-virtual-or-dynamic-children`, `mixed-custom`, `unknown` (unresolved supertype, unreadable file, or only custom logic/clientlib/JS).

Rules:
- **No target is guessed.** The repository defines no component-level parsys target (the template-modernization container mapping is project-specific and belongs to Branch C). Auto-conversion is possible only when the caller supplies `supportedTarget` from project guidance.
- `plain-legacy-parsys` + direct supertype + `supportedTarget` + `contentValidated` (explicit attestation; authored-child assumptions visible in source also block) → `convert-parsys-supertype` (only the `sling:resourceSuperType` value in `.content.xml`). Otherwise `needs-content-validation` (blocks apply) or `needs-user-confirm`.
- `custom-layout` / `custom-column-control` → `needs-user-confirm` with a migration plan; all others → `manual-review`. Nothing is replaced and no new component is created.

Dry-run reports: path, evidence, classification, custom behavior inventory, content-compatibility risk, proposed target (or none), blocked reason, files that would change. `applyParsysConversion(entry, root, userConfirmed)` enforces the gates.

## Scope and validation notes

- Template (static/editable) migration is out of scope for this flow; use Branch C for templates.
- Development tests use synthetic fixtures because no customer codebase is available. Real customer behavior and authored-content compatibility must be validated when the skill runs inside that workspace — treat `needs-content-validation` as blocking until then.
