# Legacy UI Dialog — Post-Conversion Validation

Run after every conversion pass. Failures block commit unless marked non-blocking. Skip sections where the artifact type was not generated. `<componentRoot>` from `.migration/lui-dialog-context.yml`.

## 1. Classic UI eliminated (convert-extjs only)

1.1 Original `dialog/` renamed — original folder must not exist as a deployable path:
`ls <componentRoot>/dialog/` → **absent** (renamed to `dialog.bak/`). Blocking.
`ls <componentRoot>/dialog.bak/` → **directory present** (rename happened). Blocking.

1.2 No `xtype` in `_cq_dialog` —
`rg 'xtype=' <componentRoot>/_cq_dialog/` → **0 matches**.

1.3 No `cq:WidgetCollection` in `_cq_dialog` —
`rg 'jcr:primaryType="cq:WidgetCollection"' <componentRoot>/_cq_dialog/` → **0 matches**.

## 2. Coral 3 resource types set (both conversion types)

2.1 No Coral 2 types remain —
`rg 'sling:resourceType="granite/ui/components/foundation/' <componentRoot>/_cq_dialog/` → **0 matches**.

2.2 Root resource type —
`rg 'sling:resourceType="cq/gui/components/authoring/dialog"' <componentRoot>/_cq_dialog/.content.xml` → **exactly 1 match**.

2.3 No `cq:Widget` primary types —
`rg 'jcr:primaryType="cq:Widget"' <componentRoot>/_cq_dialog/` → **0 matches**.

## 3. Listeners excluded (convert-extjs only)

3.1 No `listeners` in `_cq_dialog` —
`rg '<listeners' <componentRoot>/_cq_dialog/` → **0 matches**. Blocking.

3.2 Sidecar present when source had listeners —
If `hasListeners: true`: `ls <componentRoot>/_cq_dialog.listeners-review.md` → **file present**. Non-blocking.

## 4. Coral 2 backup integrity (upgrade-coral2 only)

4.1 Backup present — `ls <componentRoot>/_cq_dialog.coral2/` → **directory present**.
4.2 Backup has Coral 2 types — `rg 'granite/ui/components/foundation/' <componentRoot>/_cq_dialog.coral2/` → **≥1 match**. Non-blocking.

## 5. datepicker `valueFormat`

5.1 Every datepicker has `valueFormat` — for files containing `datepicker`:
`rg 'valueFormat=' <file>` → **≥1 match**. Blocking.

## 6. fileupload `useHTML5`

6.1 Every fileupload has `useHTML5` — for files containing `fileupload`:
`rg 'useHTML5="\{Boolean\}true"' <file>` → **≥1 match**. Non-blocking.

## 7. `name` property prefix

7.1 Form field `name` values start with `./` — scope to form field nodes only:
```bash
rg 'sling:resourceType="granite/ui/components/coral/foundation/form' -A 10 <file> \
  | rg 'name="[^"./]'
```
→ **0 matches**. Blocking.

## 8. filter.xml excludes backup folders

8.1 `dialog.bak` excluded (convert-extjs) —
`rg 'dialog\\\.bak' ui.apps/META-INF/vault/filter.xml` → **≥1 match**. Blocking.

8.2 `_cq_dialog.coral2` excluded (upgrade-coral2) —
`rg '_cq_dialog\\\.coral2' ui.apps/META-INF/vault/filter.xml` → **≥1 match**. Blocking.

## Report

Blocking failures: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 5.1, 7.1, 8.1, 8.2.
(1.1 now checks `dialog/` absent AND `dialog.bak/` present — both conditions must hold.)
Non-blocking warnings: 3.2, 4.2, 6.1.
Always surface in report: listeners sidecar contents, optionsProvider shells, dropped validation properties, namePrefix mappings.
