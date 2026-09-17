# Custom Classic Widget (CDW) — Discovery & Context

Runs once per CDW session. Reads BPA CDW findings (pattern id `cdw`), inventories all unique custom xtypes, determines whether a Coral 3 equivalent exists for each, and emits `.migration/cdw-context.yml`. The converter (`conversion.md`) uses this YAML to process each xtype. Add `.migration/` to `.gitignore`.

> **Why per-xtype, not per-component:** Many components share the same custom widget. Resolving the xtype once fixes all its usages. Process unique xtypes first, then apply the resolution across all affected dialog occurrences.

## Schema

```yaml
session:
  cdwFindingsTotal: <N>
  uniqueXtypes: <N>

xtypes:
  - xtype: <xtype-name>                    # e.g. "my-colorpicker"
    registrationPattern: CQ.Ext.reg | xtype-property | unknown
    jsSourcePath: <workspace-relative path to JS file defining the widget> | not-found
    widgetPurpose: <one-line description inferred from JS source> | needs-user-confirm
    coral3Equivalent:
      type: known-mapping | custom-component-needed | needs-user-confirm
      resourceType: <Coral 3 sling:resourceType> | null     # when type=known-mapping
      notes: <why this mapping applies> | null
    affectedComponents:
      - componentPath: <workspace-relative>
        dialogPath: <workspace-relative path to dialog node containing this xtype>
        nodeNames: [ <widget node names using this xtype> ]
    action: apply-mapping | scaffold-custom-component | needs-user-confirm
```

Every field required. Unknown values use `needs-user-confirm`.

## BPA CDW vs Dialog LUI

CDW findings (`cdw` BPA pattern) are separate from LUI dialog findings. Do NOT mix:
- `getBpaFindings('cdw', ...)` → custom xtypes in Classic UI dialogs
- `getBpaFindings('lui', ...)` → dialog-level classic/coral2 (handled by `legacy-ui/dialog/`)

CDW findings are frequently found inside the same Classic UI dialogs that `legacy-ui/dialog/` also processes. If both sessions are run: run CDW first to resolve custom xtypes, then run dialog conversion — the dialog converter will be able to map all xtypes without stopping.

## JCR path → Filesystem path

```
/apps/<rest>  →  ui.apps/src/main/content/jcr_root/apps/<rest>
```

## Discovery Steps

1. **Get CDW findings.** `getBpaFindings('cdw', { bpaFilePath, collectionsDir, limit: 5, offset: 0 })`. Each finding `filePath` is the path to a `cq:Widget` node.

2. **Resolve and group by xtype.** For each finding, read the `xtype` property of the flagged node. Group all findings by unique xtype value.

3. **Find JS source per xtype.** For each unique xtype:
   - Search `ui.apps/**/clientlibs/**/*.js` for `CQ.Ext.reg('<xtype>'` or `xtype: '<xtype>'`.
   - If found: set `jsSourcePath`; read the file to infer `widgetPurpose`.
   - If not found: `jsSourcePath: not-found` — widget may be from a shared library; note for user.

4. **Determine Coral 3 equivalent.** For each unique xtype, check the known mappings table below. If matched: `type: known-mapping`, set `resourceType`. If not matched: `type: custom-component-needed`.

   Known additional Coral 3 equivalents (beyond the dialog converter's known-safe list):
   | Custom xtype pattern | Often maps to |
   |---|---|
   | Colour/color picker | `granite/ui/components/coral/foundation/form/colorfield` |
   | Tag selector | `cq/gui/components/coral/common/form/tagfield` |
   | User/group picker | `cq/gui/components/coral/common/form/userpicker` |
   | Path/asset browser | `granite/ui/components/coral/foundation/form/pathfield` |
   | Date/time selector | `granite/ui/components/coral/foundation/form/datepicker` |
   | Multi-value text | `granite/ui/components/coral/foundation/form/multifield` (simple) |
   | Slider/range | `granite/ui/components/coral/foundation/form/slider` |
   | Switch/toggle | `granite/ui/components/coral/foundation/form/switch` |

   For ambiguous cases: `type: needs-user-confirm` — show JS source excerpt to user and ask.

5. **Emit + confirm.** Write YAML → show xtype summary table → ask user to confirm purposes and equivalents before converting.

## Plan Table

| Custom xtype | JS source found? | Purpose | Coral 3 equivalent | Action |
|---|---|---|---|---|
| `my-xtype` | yes/no | inferred purpose | resourceType or "custom needed" | apply-mapping / scaffold / confirm |

Show table, get `confirmed`, then execute per-xtype via `conversion.md`.

Post-execute: run [validation.md](validation.md).
