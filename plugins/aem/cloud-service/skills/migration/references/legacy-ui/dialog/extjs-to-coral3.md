# Classic UI (ExtJS) → Coral 3 Dialog Conversion

Converts `dialog/` (`jcr:primaryType=cq:Dialog`) to `_cq_dialog/`. Design dialog: `design_dialog/` → `_cq_design_dialog/`. Only for `action: convert-extjs` components from confirmed `.migration/lui-dialog-context.yml`.

---

## Prerequisites

1. Component path resolves in workspace.
2. `existingBackup: false` (or user confirmed re-conversion).
3. All `needs-user-confirm` resolved.
4. If `hasListeners: true` — read Listeners section first.
5. If `hasOptionsProvider: true` — read optionsProvider section first.

---

## Widget Type Mapping Table

Node names (JCR keys) are preserved — they are authored content property names.

| Classic xtype | Coral 3 sling:resourceType | Notes |
|---|---|---|
| `textfield` / `editfield` | `granite/ui/components/coral/foundation/form/textfield` | `defaultValue` → `value`; `emptyText` same |
| `textarea` | `granite/ui/components/coral/foundation/form/textarea` | `rows` direct |
| `htmleditor` / `richtext` | `cq/gui/components/authoring/dialog/richtext` | Add `useFixedInlineToolbar="{Boolean}true"`; preserve RTE plugin config sub-nodes |
| `checkbox` | `granite/ui/components/coral/foundation/form/checkbox` | `inputValue` → `value`; add `uncheckedValue="false"` if absent |
| `selection` (type=select or omitted) | `granite/ui/components/coral/foundation/form/select` | `<options>` → `<items>`; each option: `text`+`value`; see optionsProvider section |
| `combobox` | `granite/ui/components/coral/foundation/form/autocomplete` | If free-form input required: add `forceSelection="{Boolean}false"`; else use `select` — confirm with user |
| `selection` (type=radio) | `granite/ui/components/coral/foundation/form/radiogroup` | Same `<options>` → `<items>` |
| `pathfield` / `browsefield` | `granite/ui/components/coral/foundation/form/pathfield` | `rootPath` direct; default `/content` |
| `smartfile` | `cq/gui/components/authoring/dialog/fileupload` | Add `useHTML5="{Boolean}true"`, `uploadUrl="${suffix.path}"`; `mimeTypes` → `[image/jpeg,...]` |
| `numberfield` | `granite/ui/components/coral/foundation/form/numberfield` | `minValue` → `min`, `maxValue` → `max`; drop `allowDecimals`/`allowNegative` |
| `datefield` | `granite/ui/components/coral/foundation/form/datepicker` | Add `displayedFormat="MMMM DD, YYYY"` and `valueFormat="YYYY-MM-DD[T]HH:mm:ss.000Z"` |
| `multifield` | `granite/ui/components/coral/foundation/form/multifield` | Single sub-field: simple; multiple sub-fields: `composite="{Boolean}true"` + child node named **`field`** with `sling:resourceType="granite/ui/components/coral/foundation/container"` containing an `<items>` node; see namePrefix section and composite template below |
| `dialogfieldset` | `granite/ui/components/coral/foundation/form/fieldset` | Recurse into children |
| `tabpanel` (root) | `granite/ui/components/coral/foundation/tabs` + `maximized="{Boolean}true"` | See structure templates |
| `panel` (tab) | `granite/ui/components/coral/foundation/container` + `margin="{Boolean}true"` | `title` → `jcr:title` |
| `hidden` | `granite/ui/components/coral/foundation/form/hidden` | `value` direct |
| `colorfield` | `granite/ui/components/coral/foundation/form/colorfield` | `defaultValue` → `value` |
| `tags` / `tagsfield` | `cq/gui/components/coral/common/form/tagfield` | `rootPath` direct |
| `label` / `static` | `granite/ui/components/coral/foundation/form/text` | `text` → `value` |
| `userpicker` | `cq/gui/components/coral/common/form/userpicker` | `rootPath` direct |
| `button` | `granite/ui/components/coral/foundation/form/button` | `text` → `text`; drop `handler` |
| `dialogbuttons` | — | **Drop silently** — Touch UI renders OK/Cancel automatically |

**Unknown xtype:** Stop. Report xtype and path. Ask user for Coral 3 equivalent. Never guess.

---

## Node Container Mapping

| Classic jcr:primaryType | Coral 3 | Node name |
|---|---|---|
| `cq:Dialog` | `nt:unstructured` | root (becomes `_cq_dialog/.content.xml`) |
| `cq:WidgetCollection` | `nt:unstructured` | rename to `items` |
| `cq:Widget` | `nt:unstructured` | preserve widget node name |

---

## Property Mapping Rules

| Classic property | Coral 3 | Action |
|---|---|---|
| `fieldLabel` | `fieldLabel` | Keep |
| `name` | `name` | Keep exactly — maps to JCR property names on authored content |
| `fieldDescription` | `fieldDescription` | Keep |
| `required` | `required` | Keep; ensure `{Boolean}true` syntax |
| `disabled` | `disabled` | Keep |
| `cls` | `granite:class` | Rename |
| `xtype` | — | Drop |
| `jcr:primaryType` | `nt:unstructured` | Replace on all nodes |
| `hideLabel` | — | Drop |
| `width` / `height` | — | Drop |
| `vtype` | — | Drop; see Validation Migration note |
| `allowBlank` | — | String `"false"` → `required="{Boolean}true"`; else drop |
| `regex` / `regexText` | — | Drop; see Validation Migration note |
| `handler` | — | Drop; see Listeners section |

**Validation Migration note:** `vtype`, `regex`, `regexText`, `allowBlank` validation must be reimplemented via a Coral 3 dialog clientlib using the `foundation-validation` framework. Flag each dropped validation property in the report.

---

## Listeners Nodes — Required Handling

Classic UI `<listeners jcr:primaryType="nt:unstructured">` nodes contain JavaScript callbacks with no Touch UI equivalent. **Never copy into `_cq_dialog`.**

1. Collect all `listeners` nodes from source `dialog/`.
2. Write sidecar: `<componentRoot>/_cq_dialog.listeners-review.md` — list each node path and event properties.
3. Exclude from output.
4. Report: *"⚠️ N listener handlers excluded. See `_cq_dialog.listeners-review.md`. Migrate to Granite UI dialog clientlib."*

---

## optionsProvider — Required Handling

`optionsProvider` on a `selection` widget means options are loaded dynamically from a Sling servlet. Coral 3 uses a `datasource` child node.

1. Create the `select` shell with empty `<items>`.
2. Add datasource child — `sling:resourceType` must point to a Sling component whose GET handler returns `application/json` items (the developer implements this). Do **not** use `servletPath` — it is not a standard Granite UI datasource property:
```xml
<datasource
    jcr:primaryType="nt:unstructured"
    sling:resourceType="NEEDS-DEVELOPER-REVIEW"/>
    <!-- Original optionsProvider value: <optionsProvider value> — use as reference when implementing the datasource servlet -->
```
3. Report: *"⚠️ Dynamic options via `optionsProvider` (original value recorded above). Datasource shell created — developer must implement a Sling datasource component at the `sling:resourceType`."*

---

## namePrefix in Multifield

Classic `namePrefix="./foo/"` → Coral 3 composite multifield `name="./foo"` on the field container. Child field names are preserved. Report the mapping for developer verification.

---

## Composite Multifield Template

Use when the Classic multifield contains more than one sub-field. The child container **must** be named `field`:

```xml
<myMultifield jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/form/multifield"
    composite="{Boolean}true"
    fieldLabel="<label>">
    <field jcr:primaryType="nt:unstructured"
        sling:resourceType="granite/ui/components/coral/foundation/container">
        <items jcr:primaryType="nt:unstructured">
            <!-- converted sub-fields, each with their own name="./propName" -->
        </items>
    </field>
</myMultifield>
```

For a single sub-field multifield, omit `composite` and place the sub-field directly as `<field .../>` with the appropriate `sling:resourceType`.

---

## Dialog Structure Templates

### Flat dialog

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    xmlns:granite="http://www.adobe.com/jcr/granite/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="nt:unstructured"
    jcr:title="<from source cq:Dialog jcr:title>"
    sling:resourceType="cq/gui/components/authoring/dialog">
    <content jcr:primaryType="nt:unstructured"
        sling:resourceType="granite/ui/components/coral/foundation/fixedcolumns">
        <items jcr:primaryType="nt:unstructured">
            <column jcr:primaryType="nt:unstructured"
                sling:resourceType="granite/ui/components/coral/foundation/container">
                <items jcr:primaryType="nt:unstructured">
                    <!-- converted fields -->
                </items>
            </column>
        </items>
    </content>
</jcr:root>
```

### Tabbed dialog

```xml
<content jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/container">
    <items jcr:primaryType="nt:unstructured">
        <tabs jcr:primaryType="nt:unstructured"
            sling:resourceType="granite/ui/components/coral/foundation/tabs"
            maximized="{Boolean}true">
            <items jcr:primaryType="nt:unstructured">
                <tab1 jcr:primaryType="nt:unstructured"
                    jcr:title="<panel title>"
                    sling:resourceType="granite/ui/components/coral/foundation/container"
                    margin="{Boolean}true">
                    <items jcr:primaryType="nt:unstructured">
                        <columns jcr:primaryType="nt:unstructured"
                            sling:resourceType="granite/ui/components/coral/foundation/fixedcolumns"
                            margin="{Boolean}true">
                            <items jcr:primaryType="nt:unstructured">
                                <column jcr:primaryType="nt:unstructured"
                                    sling:resourceType="granite/ui/components/coral/foundation/container">
                                    <items jcr:primaryType="nt:unstructured">
                                        <!-- converted fields -->
                                    </items>
                                </column>
                            </items>
                        </columns>
                    </items>
                </tab1>
            </items>
        </tabs>
    </items>
</content>
```

---

## Conversion Steps (per component)

1. Read `dialog/.content.xml`. Collect and set aside `listeners` nodes — write sidecar.
2. Determine structure: root `xtype=tabpanel` → tabbed, else flat.
3. Convert widget tree: replace `cq:WidgetCollection` → `nt:unstructured` `items`; apply widget + property mapping; convert `<options>` → `<items>`; apply namePrefix; handle optionsProvider; drop `dialogbuttons`.
4. Write `_cq_dialog/.content.xml`. If `_cq_dialog/` exists: rename to `_cq_dialog.coral2/` first.
5. Rename source: `dialog/` → `dialog.bak/`. For design dialog: `design_dialog/` → `design_dialog.bak/`; write output to `_cq_design_dialog/.content.xml`. Skip design dialog if `skipReason: editable-templates-in-use`.
6. Update `filter.xml` — add excludes:
```xml
<exclude pattern=".*/dialog\.bak(/.*)?"/>
<exclude pattern=".*/_cq_dialog\.coral2(/.*)?"/>
<exclude pattern=".*/_cq_dialog\.listeners-review\.md"/>
```
7. Report per component: tabs, fields, dropped dialogbuttons, listeners flagged, optionsProvider shells, validation properties dropped, filter.xml updated.

---

## Critical Rules

- Never delete source dialog — rename to `.bak`, then exclude from filter.xml.
- Never copy `listeners` nodes — sidecar only.
- Never guess unknown xtypes — stop and ask.
- Preserve all `name` values exactly.
- Every node in `_cq_dialog` must be `jcr:primaryType="nt:unstructured"`.
- Design dialog output: `_cq_design_dialog/` (not `design_dialog/`).
- `dialogbuttons` is always dropped silently — never treated as unknown.
