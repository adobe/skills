# Legacy Custom Component (Rich Text overlay / custom Parsys) — Discovery & Context

Handles BPA `lui` findings with sub-type `legacy.custom.component`, plus optional bounded workspace scans, for two **component-level** cases: Rich Text authoring overlays/customizations and custom legacy Parsys. Routed through Branch D (Legacy UI). **Template (static/editable) migration is out of scope for this flow** and Branch C is never invoked.

Planner: `scripts/legacy-component-planner.js` (uses `scripts/richtext-overlay.js` and `scripts/custom-parsys.js`).

## Run the dry-run (read-only)

```bash
node scripts/legacy-component-planner.js <workspaceRoot>                     # scan workspace (default)
node scripts/legacy-component-planner.js <workspaceRoot> --bpa <bpa.csv>     # BPA targets only
node scripts/legacy-component-planner.js <workspaceRoot> --path /apps/<...>  # one component
  [--scan] [--json] [--write-context]
```

- Prints the dry-run; writes nothing to the project. `--write-context` additionally writes the plan to `.migration/legacy-component-context.yml` (add `.migration/` to `.gitignore`), the same convention as the dialog and CDW flows.
- BPA targets come from `getBpaFindings('lui', …)` filtered to `identifier === 'legacy.custom.component'` (`className` = JCR path, mapped `/apps/<rest>` → `ui.apps/src/main/content/jcr_root/apps/<rest>`). BPA parsing is not reimplemented. Local inspection is bounded and recorded as `heuristic/local-inspection`.

Each entry reports: component path, evidence + source, classification, detected customizations / custom behavior inventory, content-compatibility and policy-mapping risk, proposed target (or none), proposed action, handoff, blocked reason, and files that would change.

## Confirmation gates

1. Classify before any modification; show the dry-run to the user.
2. `unknown`, `needs-user-confirm`, `manual-review`, `needs-content-validation`, `needs-policy-mapping` and every handoff action never change files in this flow.
3. Only one action is ever applied here: `convert-parsys-supertype`. `canApply()` requires explicit user confirmation, `contentCompatibility: established` and `policyCompatibility: established`.
4. Apply re-plans from the current workspace (never from a stale file):
   `node scripts/legacy-component-planner.js <root> --apply /apps/<...> --confirm --target <rt> --content-validated --policies-mapped`.

If structural inspection does not confirm a coarse signal, the entry is `needs-user-confirm`. Missing folders → `manual-review`. Conflicting Rich Text + Parsys evidence → `unknown`. Inspection never descends into a nested `cq:Component`, so evidence always belongs to the reported component.

## Rich Text overlay / customization

AEM as a Cloud Service has no Classic UI: authors only see `cq:dialog` (`_cq_dialog/`), and `/libs` is immutable and changes with product updates. **This flow never edits Rich Text files.**

A candidate needs legacy evidence (structural, never by name; a JSP alone never qualifies):
- a Classic (`dialog/`, `cq:Dialog`) or Coral 2 (`granite/ui/components/foundation/…`) Rich Text dialog;
- a product overlay: an `/apps/cq/**` or `/apps/granite/**` path for a Rich Text/RTE node, which mirrors `/libs`;
- a Rich Text dialog rendered by a JSP (any `*.jsp` the component owns, not only `render.jsp`) or another non-HTL script engine.

A Coral 3 Rich Text dialog rendered by HTL is already supported and is not reported.

Inventory: Rich Text resource types, dialogs and their kind, JSP / HTL / other scripts, RTE config (`rtePlugins`, `uiSettings`, `htmlRules`), toolbar features, clientlibs, custom RTE plugin code (`CQ.form.rte` / `CUI.rte`), JSP imports, scriptlets, conditions, request/session/repository/service access, dynamic expressions and unresolved includes.

| Classification | Meaning | Action |
|---|---|---|
| `configuration-only` | no script; declarative Rich Text config | Classic dialog → `handoff-convert-extjs`; Coral 2 → `handoff-upgrade-coral2` (to [dialog/context.md](../dialog/context.md), which owns the edit and its own confirmation). Custom RTE plugin / clientlib code → `needs-user-confirm`. |
| `custom-jsp-ui` | JSP is static markup only | `needs-user-confirm` (proposal: port to HTL; keep the JSP until validated) |
| `custom-jsp-behavioral` | JSP has imports, scriptlets, conditions, request/session/service access | `manual-review` |
| `unknown` | dynamic expressions, unresolved includes, unreadable JSP, other script engines | `manual-review` |

Product overlays always carry `overlay.libsPath` and are `needs-user-confirm` or `manual-review`. The proposal is to move the configuration into each affected component's `cq:dialog` and retire the overlay only after every affected dialog is migrated and validated. Scripts (including `render.jsp`) are never rewritten or deleted by any code path.

The `htmleditor`/`richtext` → `cq/gui/components/authoring/dialog/richtext` mapping in [extjs-to-coral3.md](../dialog/extjs-to-coral3.md) applies only inside that whole-dialog conversion. It is never applied to a single widget in place.

## Custom Parsys

Detection (structural, never by name): `sling:resourceSuperType` resolving to the legacy parsys (directly, `/libs/`-prefixed, or through supertypes that resolve inside the workspace), or a JSP/HTL include of it. Modern containers (e.g. Core `container`) do not match.

Inventory: direct/inherited usage, nested page containers (dialog layout containers excluded), column control, layout props, selector/suffix/resourceType overrides in scripts, virtual/dynamic children, custom JSP/HTL logic, clientlibs/JS, authored-child assumptions, design dependencies (`cq:designPath`, `/etc/designs`, `currentDesign`, `currentStyle`) and edit config (`_cq_editConfig.xml`, `cq:isContainer`, `cq:dropTargets`).

Classifications: `plain-legacy-parsys`, `custom-layout`, `custom-column-control`, `custom-virtual-or-dynamic-children`, `mixed-custom`, `unknown`.

- **No target is guessed.** Only a caller-supplied `--target` from project guidance is used.
- `plain-legacy-parsys` with a direct supertype → `needs-content-validation` until authored children are validated (`--content-validated`; source-visible child assumptions also block), then `needs-policy-mapping` until allowed components/styles are mapped to the target's `/conf` policies (`--policies-mapped`). A legacy parsys takes these from designs, which live in content, so source can never prove this. Only then `convert-parsys-supertype`, which changes only the `sling:resourceSuperType` value in that `.content.xml`.
- `custom-layout` / `custom-column-control` → `needs-user-confirm` with a migration plan. Everything else → `manual-review`. Nothing is replaced and no new component is created.
- This is a **code** change only. Existing page content (legacy parsys nodes) is converted separately, for example with AEM Modernize Tools rules on content. This flow does not generate those rules.

## Scope and validation notes

- Template (static/editable) migration is out of scope; templates belong to Branch C.
- Development tests use synthetic FileVault fixtures because no customer codebase is available. Real behavior, authored-content compatibility and policy mapping must be validated when the skill runs inside that workspace. Treat `needs-content-validation` and `needs-policy-mapping` as blocking until then.
