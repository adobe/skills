# Legacy UI Dialog — Discovery & Context

Runs once per dialog session. Reads BPA LUI findings, filters to dialog sub-types only, classifies each component, and emits `.migration/lui-dialog-context.yml`. Both converters (`extjs-to-coral3.md`, `coral2-to-coral3.md`) consume this YAML. Add `.migration/` to `.gitignore`.

## Schema

```yaml
session:
  luiFindingsTotal: <N>
  dialogFindingsProcessed: <N>
  skippedSubTypes:
    - { contextType, count, note }

components:
  - componentPath: ui.apps/src/main/content/jcr_root/apps/<appId>/components/<type>/<name>
    jcrPath: /apps/<appId>/components/<type>/<name>
    appId: <appId>
    dialogs:
      main:
        type: classic | coral2 | coral3 | missing
        fsPath: <relative path to dialog/ or _cq_dialog/>
        tabCount: <N> | unknown
        fieldCount: <N> | unknown
        hasListeners: true | false
        listenerDetails: [ { nodePath, events: [...] } ]
        hasOptionsProvider: true | false
        hasCustomWidgets: true | false
        customWidgetXtypes: [ ... ]
      design:
        type: classic | coral2 | coral3 | missing
        fsPath: <relative>
        skipReason: editable-templates-in-use | static-templates-in-use | missing
    action: convert-extjs | upgrade-coral2 | skip-already-coral3 | skip-design-editable | needs-user-confirm
    existingBackup: true | false
```

Every field required. Unknown values use `unknown` or `needs-user-confirm`.

## BPA Sub-type Filter

Only process from LUI findings:
- `legacy.dialog.classic` → `action: convert-extjs`
- `legacy.dialog.coral2` → `action: upgrade-coral2`

Skip with user note (do not process in this sub-folder):
- `legacy.custom.component` → "use create-component skill; future legacy-ui/foundation-component/"
- `legacy.static.template` → "use migration Branch C"
- `content.fragment.template` → "out of scope"
- `translation.dictionary` → "out of scope"

## JCR path → Filesystem path

```
/apps/<rest>  →  ui.apps/src/main/content/jcr_root/apps/<rest>
```

Stop and report if the resolved path does not exist in the workspace.

## Filevault name mapping

| JCR node name | Filesystem folder |
|---|---|
| `dialog` | `dialog/` |
| `design_dialog` | `design_dialog/` |
| `cq:dialog` | `_cq_dialog/` |
| `cq:design_dialog` | `_cq_design_dialog/` |

## Discovery Steps

1. **Get LUI findings.** `getBpaFindings('lui', { bpaFilePath, collectionsDir, limit: 5, offset: 0 })`. Apply sub-type filter. Report skipped sub-types before continuing.
2. **Resolve component root.** Translate JCR path to workspace filesystem path.
3. **Classify main dialog.** Check `dialog/.content.xml` (Classic) then `_cq_dialog/.content.xml` per Filevault table. To distinguish Coral 2 from Coral 3 inside `_cq_dialog/`: read the `content` node's `sling:resourceType` — if it contains `granite/ui/components/foundation/` (without `coral/`) → `coral2`; if it contains `granite/ui/components/coral/foundation/` → `coral3`. Check for `_cq_dialog.coral2/` backup.
4. **Classify design dialog.** Same logic. If project is on editable templates → `skipReason: editable-templates-in-use`.
5. **Detect listeners.** Search `dialog/**` for `<listeners` element. Record event names.
6. **Detect optionsProvider.** Search for `optionsProvider=` in any selection widget node.
7. **Detect custom xtypes.** Search for `jcr:primaryType="cq:Widget"` with `xtype` not in known-safe list.

   Known-safe xtypes (direct Coral 3 equivalents — do NOT flag):
   `textfield`, `editfield`, `textarea`, `htmleditor`, `richtext`, `checkbox`, `selection`,
   `combobox`, `pathfield`, `browsefield`, `smartfile`, `numberfield`, `datefield`,
   `multifield`, `dialogfieldset`, `tabpanel`, `panel`, `hidden`, `colorfield`, `tags`,
   `tagsfield`, `label`, `static`, `button`, `dialogbuttons`, `userpicker`

8. **Determine action.** `classic` → `convert-extjs`; `coral2` → `upgrade-coral2`; `coral3` → `skip`; unknown xtypes → `needs-user-confirm`; optionsProvider → `needs-user-confirm`.
9. **Emit + confirm.** Write YAML → show plan table → await `confirmed` before converting.

## Plan Table

| Component | Main dialog | Design dialog | Action | Listeners? | optionsProvider? |
|---|---|---|---|---|---|
| … | classic/coral2/coral3 | type/skip | convert-extjs/upgrade-coral2/skip | yes/no | yes/no |

Post-execute: run [validation.md](validation.md).
