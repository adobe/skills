# Coral 2 → Coral 3 Dialog Upgrade

In-place upgrade of `_cq_dialog/.content.xml` where nodes use `granite/ui/components/foundation/` (without `coral/`). Only for `action: upgrade-coral2`. Inputs from `.migration/lui-dialog-context.yml`.

---

## Prerequisites

1. `_cq_dialog/.content.xml` classified `coral2`.
2. No `_cq_dialog.coral2/` backup (or user confirmed re-upgrade).

---

## Resource Type Replacement Table

| Coral 2 sling:resourceType | Coral 3 sling:resourceType | Notes |
|---|---|---|
| `granite/ui/components/foundation/form/textfield` | `granite/ui/components/coral/foundation/form/textfield` | |
| `granite/ui/components/foundation/form/textarea` | `granite/ui/components/coral/foundation/form/textarea` | |
| `granite/ui/components/foundation/form/checkbox` | `granite/ui/components/coral/foundation/form/checkbox` | |
| `granite/ui/components/foundation/form/select` | `granite/ui/components/coral/foundation/form/select` | |
| `granite/ui/components/foundation/form/radiogroup` | `granite/ui/components/coral/foundation/form/radiogroup` | |
| `granite/ui/components/foundation/form/pathbrowser` | `granite/ui/components/coral/foundation/form/pathfield` | Component renamed — `pathbrowser` → `pathfield`; not a prefix-only replacement |
| `granite/ui/components/foundation/form/fileupload` | `cq/gui/components/authoring/dialog/fileupload` | Different path family — not a prefix-only replacement |
| `granite/ui/components/foundation/form/multifield` | `granite/ui/components/coral/foundation/form/multifield` | |
| `granite/ui/components/foundation/form/numberfield` | `granite/ui/components/coral/foundation/form/numberfield` | |
| `granite/ui/components/foundation/form/datepicker` | `granite/ui/components/coral/foundation/form/datepicker` | |
| `granite/ui/components/foundation/form/hidden` | `granite/ui/components/coral/foundation/form/hidden` | |
| `granite/ui/components/foundation/form/colorfield` | `granite/ui/components/coral/foundation/form/colorfield` | |
| `granite/ui/components/foundation/form/fieldset` | `granite/ui/components/coral/foundation/form/fieldset` | |
| `granite/ui/components/foundation/form/password` | `granite/ui/components/coral/foundation/form/password` | |
| `granite/ui/components/foundation/form/autocomplete` | `granite/ui/components/coral/foundation/form/autocomplete` | |
| `granite/ui/components/foundation/form/nestedcheckboxlist` | `granite/ui/components/coral/foundation/form/nestedcheckboxlist` | |
| `granite/ui/components/foundation/form/text` | `granite/ui/components/coral/foundation/form/text` | |
| `granite/ui/components/foundation/form/tagfield` | `cq/gui/components/coral/common/form/tagfield` | Different path family — not a prefix-only replacement |
| `granite/ui/components/foundation/container` | `granite/ui/components/coral/foundation/container` | |
| `granite/ui/components/foundation/fixedcolumns` | `granite/ui/components/coral/foundation/fixedcolumns` | |
| `granite/ui/components/foundation/tabs` | `granite/ui/components/coral/foundation/tabs` | |
| `granite/ui/components/foundation/layouts/column` | `granite/ui/components/coral/foundation/layouts/column` | |
| `granite/ui/components/foundation/layouts/fixedcolumns` | `granite/ui/components/coral/foundation/layouts/fixedcolumns` | |
| `granite/ui/components/foundation/layouts/well` | `granite/ui/components/coral/foundation/layouts/well` | |

**Pattern rule:** `granite/ui/components/foundation/` (without `coral/`) → `granite/ui/components/coral/foundation/`. Exceptions (`pathbrowser` → `pathfield`, `fileupload`, `tagfield`) are listed explicitly above — apply each row's exact Coral 3 value, do not derive by prefix substitution.
**Do NOT replace** `cq/gui/components/authoring/dialog` on the root — correct for both versions.

---

## Additional Property Fixes

| Condition | Fix |
|---|---|
| `datepicker` missing `displayedFormat` | Add `displayedFormat="MMMM DD, YYYY"` |
| `datepicker` missing `valueFormat` | Add `valueFormat="YYYY-MM-DD[T]HH:mm:ss.000Z"` |
| `fileupload` missing `useHTML5` | Add `useHTML5="{Boolean}true"` |
| `fileupload` missing `uploadUrl` | Add `uploadUrl="${suffix.path}"` |
| `pathbrowser` had `rootPath` | Carry to converted `pathfield`; sanitize before writing: strip `/libs/` prefix, collapse `//` to `/` |
| `tabs` container missing `maximized` (primary container) | Add `maximized="{Boolean}true"` |

---

## Conversion Steps (per component)

1. Backup: copy `_cq_dialog/` → `_cq_dialog.coral2/`.
2. Read `_cq_dialog/.content.xml`. Apply resource type replacements. Apply property fixes. **Sanitize path property values** (`rootPath` and any property whose value starts with `/`): strip a leading `/libs/` prefix and collapse any `//` double-slash sequences to `/`.
3. Write updated file in place.
4. Update `filter.xml`: add `<exclude pattern=".*/_cq_dialog\.coral2(/.*)?"/>`.
5. Report: types replaced (N), fixes applied, backup location.

---

## Critical Rules

- Always backup before modifying.
- Only replace known Coral 2 types — do not touch unrecognised types.
- `pathbrowser` → `pathfield` (different name, not prefix-only).
- `fileupload` → `cq/gui/components/authoring/dialog/fileupload` (different path family).
