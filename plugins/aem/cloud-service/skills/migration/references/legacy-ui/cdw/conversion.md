# Custom Classic Widget (CDW) — Conversion

Processes each unique xtype from confirmed `.migration/cdw-context.yml`. Two paths: map to an existing Coral 3 component, or scaffold a custom Granite UI form component. After all xtypes are resolved, update every affected dialog occurrence.

---

## Path A: Apply Known Mapping (`action: apply-mapping`)

When `coral3Equivalent.type: known-mapping` — the custom xtype functionality is covered by an existing Coral 3 component.

### Steps

1. **For each affected dialog occurrence** (from `affectedComponents`):
   - Open `<dialogPath>/.content.xml`.
   - Find nodes where `xtype="<xtype>"`.
   - Replace: remove `xtype` property, add `sling:resourceType="<coral3Equivalent.resourceType>"`, change `jcr:primaryType` to `nt:unstructured`.
   - Apply property mapping rules from `legacy-ui/dialog/extjs-to-coral3.md` for the target resource type.

2. **Report per xtype:** N occurrences updated across M dialogs.

---

## Path B: Scaffold Custom Granite UI Form Component (`action: scaffold-custom-component`)

When no existing Coral 3 component covers the functionality. Creates a Granite UI form component the author sees in the dialog.

### Component structure

```
ui.apps/src/main/content/jcr_root/apps/<appId>/components/granite/form/<xtype-kebab>/
├── .content.xml                 # Component definition
└── <xtype-kebab>.html           # HTL — Coral UI markup
ui.apps/.../clientlibs/clientlib-<xtype-kebab>/
├── .content.xml                 # clientlib definition
├── js.txt                       # lists: js/<xtype-kebab>.js
├── css.txt                      # lists: css/<xtype-kebab>.css
├── js/
│   └── <xtype-kebab>.js        # Coral UI JS (replaces ExtJS widget)
└── css/
    └── <xtype-kebab>.css       # Component styles
```

> `js.txt` and `css.txt` are required — AEM will not serve `js/` or `css/` files from a clientlib unless they are listed in the corresponding `.txt` index file.

### `.content.xml` — Component definition

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    jcr:primaryType="cq:Component"
    jcr:title="<Human-readable widget name>"
    sling:resourceSuperType="granite/ui/components/coral/foundation/form/field"
    componentGroup=".hidden"/>
```

> `sling:resourceSuperType="granite/ui/components/coral/foundation/form/field"` is mandatory — it wires the component into the Granite UI form framework so `name` and value handling work automatically.

### `<xtype-kebab>.html` — HTL template (scaffold)

`com.adobe.granite.ui.components.Field` is the correct use-object — it exposes `field.name`, `field.value`, `field.label`, and `field.required`. Using a resource-type path (e.g. `datasource/empty`) here is wrong and produces null values at runtime.

```html
<!--/* <xtype-kebab>.html - Custom Granite UI form component */-->
<sly data-sly-use.field="com.adobe.granite.ui.components.Field">
<div class="coral-Form-fieldwrapper">
    <label class="coral-Form-fieldlabel">${field.element.val('fieldLabel') @ context='html'}</label>
    <!--
        Replace this placeholder with the actual Coral UI component markup.
        Reference the original ExtJS widget JS source (jsSourcePath in cdw-context.yml)
        and the widgetPurpose field to understand what to implement.

        Examples:
        - Slider:  <coral-slider  name="${field.name}" value="${field.value}"></coral-slider>
        - Switch:  <coral-switch  name="${field.name}" ${field.value == 'true' ? 'checked' : ''}></coral-switch>
        - Textfield: <input is="coral-textfield" class="coral-Form-field" name="${field.name}" value="${field.value}">
    -->
    <coral-icon class="coral-Form-fielderror" icon="alert" size="S" hidden></coral-icon>
</div>
</sly>
```

### Clientlib `.content.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:ClientLibraryFolder"
    categories="[<appId>.<xtype-kebab>.dialog]"
    dependencies="[granite.ui.coral.foundation.form]"/>
```

### Steps

1. Create the **six files** above under `ui.apps/.../components/granite/form/<xtype-kebab>/` and `clientlibs/clientlib-<xtype-kebab>/`.
   - `js.txt` content: one line — `js/<xtype-kebab>.js`
   - `css.txt` content: one line — `css/<xtype-kebab>.css`
2. Add `extraClientlibs="[<appId>.<xtype-kebab>.dialog]"` to the root node of each affected `_cq_dialog/.content.xml` that uses this xtype.
3. For each affected dialog occurrence: replace the xtype node with (use the original node name as the XML element name):
```xml
<originalNodeName
    jcr:primaryType="nt:unstructured"
    sling:resourceType="<appId>/components/granite/form/<xtype-kebab>"
    name="<preserve original name>"
    fieldLabel="<preserve original fieldLabel>"/>
```
4. Report: scaffold created at `<path>`; N dialog occurrences updated; developer must implement HTL markup and JS behaviour.

---

## After all xtypes processed

Run [validation.md](validation.md). Then if these components also have LUI `legacy.dialog.classic` findings, re-run the dialog converter — all xtypes are now in the known-safe list for that session.
