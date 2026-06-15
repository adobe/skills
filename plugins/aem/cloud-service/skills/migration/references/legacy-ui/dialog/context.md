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
        type: classic | coral2 | coral3 | classic+coral3 | missing
        fsPath: <relative path to dialog/ or _cq_dialog/>
        coexistingCoral3: true | false   # Classic dialog AND a Coral 3 _cq_dialog both present
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
    action: convert-extjs | upgrade-coral2 | skip-already-coral3 | remove-stale-classic | skip-design-editable | needs-user-confirm
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
3. **Classify main dialog.** Check `dialog/.content.xml` (Classic) **and** `_cq_dialog/.content.xml` (Coral) — both can exist at once. To distinguish Coral 2 from Coral 3 inside `_cq_dialog/`: read the `content` node's `sling:resourceType` — if it contains `granite/ui/components/foundation/` (without `coral/`) → `coral2`; if it contains `granite/ui/components/coral/foundation/` → `coral3`. Check for `_cq_dialog.coral2/` backup.

   **Critical — both present:** If a Classic `dialog/` (or legacy single-file `dialog.xml`) **and** a Coral 3 `_cq_dialog/` both exist, set `type: classic+coral3` and `coexistingCoral3: true`. The Touch UI dialog is already authoritative at runtime (Touch UI wins over Classic); the Classic dialog is **stale** and is the sole reason BPA still raises `legacy.dialog.classic`. **Do NOT convert** — converting would overwrite a hand-tuned Coral 3 dialog with an inferior generated one (data loss). The remediation is `remove-stale-classic` (see Step 8). Before deciding, diff the two: if the Classic dialog has fields/tabs the Coral 3 one lacks, downgrade to `needs-user-confirm` and surface the gap — the existing Coral 3 dialog may be incomplete.
4. **Classify design dialog.** Same logic. If project is on editable templates → `skipReason: editable-templates-in-use`.
5. **Detect listeners.** Search `dialog/**` for `<listeners` element. Record event names.
6. **Detect optionsProvider.** Search for `optionsProvider=` in any selection widget node.
7. **Detect custom xtypes.** Search for `jcr:primaryType="cq:Widget"` with `xtype` not in known-safe list.

   Known-safe xtypes (direct Coral 3 equivalents — do NOT flag):
   `textfield`, `editfield`, `textarea`, `htmleditor`, `richtext`, `checkbox`, `selection`,
   `combobox`, `pathfield`, `browsefield`, `smartfile`, `numberfield`, `datefield`,
   `multifield`, `dialogfieldset`, `tabpanel`, `panel`, `hidden`, `colorfield`, `tags`,
   `tagsfield`, `label`, `static`, `button`, `dialogbuttons`, `userpicker`

8. **Determine action.** `classic` (no Coral 3 present) → `convert-extjs`; `classic+coral3` → `remove-stale-classic` (back up the Classic dialog and exclude from `filter.xml`, or delete with the user's go-ahead — never overwrite the existing `_cq_dialog/`); `coral2` → `upgrade-coral2`; `coral3` → `skip-already-coral3`; unknown xtypes → `needs-user-confirm`; optionsProvider → `needs-user-confirm`. For `remove-stale-classic`, also remove obsolete `design_dialog`/`_cq_design_dialog` when the project uses editable templates.
9. **Emit + confirm.** Write YAML → show plan table → await `confirmed` before converting.

## Plan Table

| Component | Main dialog | Design dialog | Action | Listeners? | optionsProvider? |
|---|---|---|---|---|---|
| … | classic/coral2/coral3 | type/skip | convert-extjs/upgrade-coral2/skip | yes/no | yes/no |

Post-execute: run [validation.md](validation.md).
