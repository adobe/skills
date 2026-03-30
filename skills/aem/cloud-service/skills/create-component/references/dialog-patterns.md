# Dialog Patterns for AEM Components

Patterns for creating AEM component dialogs following Adobe Experience League best practices.

---

## Dialog Structure

### File Location
```
ui.apps/src/main/content/jcr_root/apps/[project]/components/{component-name}/_cq_dialog/.content.xml
```

### Basic Dialog Template
```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    xmlns:granite="http://www.adobe.com/jcr/granite/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="nt:unstructured"
    jcr:title="{Component Display Name}"
    sling:resourceType="cq/gui/components/authoring/dialog">
    <content
        jcr:primaryType="nt:unstructured"
        sling:resourceType="granite/ui/components/coral/foundation/fixedcolumns">
        <items jcr:primaryType="nt:unstructured">
            <column
                jcr:primaryType="nt:unstructured"
                sling:resourceType="granite/ui/components/coral/foundation/container">
                <items jcr:primaryType="nt:unstructured">
                    <!-- Fields go here -->
                </items>
            </column>
        </items>
    </content>
</jcr:root>
```

### Multi-Tab Dialog Template
```xml
<content
    jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/container">
    <items jcr:primaryType="nt:unstructured">
        <tabs
            jcr:primaryType="nt:unstructured"
            sling:resourceType="granite/ui/components/coral/foundation/tabs"
            maximized="{Boolean}true">
            <items jcr:primaryType="nt:unstructured">
                <properties
                    jcr:primaryType="nt:unstructured"
                    jcr:title="Properties"
                    sling:resourceType="granite/ui/components/coral/foundation/container"
                    margin="{Boolean}true">
                    <items jcr:primaryType="nt:unstructured">
                        <columns
                            jcr:primaryType="nt:unstructured"
                            sling:resourceType="granite/ui/components/coral/foundation/fixedcolumns"
                            margin="{Boolean}true">
                            <items jcr:primaryType="nt:unstructured">
                                <column
                                    jcr:primaryType="nt:unstructured"
                                    sling:resourceType="granite/ui/components/coral/foundation/container">
                                    <items jcr:primaryType="nt:unstructured">
                                        <!-- Tab 1 Fields -->
                                    </items>
                                </column>
                            </items>
                        </columns>
                    </items>
                </properties>
            </items>
        </tabs>
    </items>
</content>
```

---

## Field Types

### Textfield
```xml
<title
    jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
    fieldLabel="Title"
    fieldDescription="Enter the component title"
    emptyText="Enter title here"
    name="./title"
    required="{Boolean}true"/>
```

### Textarea
```xml
<description
    jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/form/textarea"
    fieldLabel="Description"
    name="./description"
    rows="5"/>
```

### Rich Text Editor
```xml
<richText
    jcr:primaryType="nt:unstructured"
    sling:resourceType="cq/gui/components/authoring/dialog/richtext"
    fieldLabel="Rich Text"
    name="./richText"
    useFixedInlineToolbar="{Boolean}true">
    <rtePlugins jcr:primaryType="nt:unstructured">
        <format jcr:primaryType="nt:unstructured" features="[bold,italic,underline]"/>
        <links jcr:primaryType="nt:unstructured" features="[modifylink,unlink]"/>
        <lists jcr:primaryType="nt:unstructured" features="[unordered,ordered]"/>
    </rtePlugins>
</richText>
```

### Checkbox
```xml
<showTitle
    jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/form/checkbox"
    text="Show Title"
    name="./showTitle"
    value="true"
    uncheckedValue="false"/>
```

### Select/Dropdown
```xml
<alignment
    jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/form/select"
    fieldLabel="Alignment"
    name="./alignment">
    <items jcr:primaryType="nt:unstructured">
        <left jcr:primaryType="nt:unstructured" text="Left" value="left"/>
        <center jcr:primaryType="nt:unstructured" text="Center" value="center"/>
        <right jcr:primaryType="nt:unstructured" text="Right" value="right"/>
    </items>
</alignment>
```

### Pathfield
```xml
<linkURL
    jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/form/pathfield"
    fieldLabel="Link URL"
    fieldDescription="Select or enter the link path"
    name="./linkURL"
    rootPath="/content"/>
```

### File Upload (Image)
```xml
<image
    jcr:primaryType="nt:unstructured"
    sling:resourceType="cq/gui/components/authoring/dialog/fileupload"
    class="cq-droptarget"
    fieldLabel="Image"
    fieldDescription="Upload or select an image"
    fileNameParameter="./image/fileName"
    fileReferenceParameter="./image/fileReference"
    mimeTypes="[image/gif,image/jpeg,image/png,image/webp,image/svg+xml]"
    name="./image/file"
    title="Upload Image"
    uploadUrl="${suffix.path}"
    useHTML5="{Boolean}true"/>
```

### Numberfield
```xml
<maxItems
    jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/form/numberfield"
    fieldLabel="Maximum Items"
    name="./maxItems"
    min="1"
    max="100"
    step="1"/>
```

### Datepicker
```xml
<publishDate
    jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/form/datepicker"
    fieldLabel="Publish Date"
    name="./publishDate"
    type="datetime"
    displayedFormat="YYYY-MM-DD HH:mm"/>
```

---

## Multifield Patterns

### Simple Multifield (Single Value)
```xml
<tags
    jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/form/multifield"
    fieldLabel="Tags"
    fieldDescription="Add one or more tags">
    <field
        jcr:primaryType="nt:unstructured"
        sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
        name="./tags"
        emptyText="Enter tag"/>
</tags>
```

### Composite Multifield (Multiple Fields per Item)
```xml
<list
    jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/form/multifield"
    composite="{Boolean}true"
    fieldLabel="List Items"
    fieldDescription="Add items to the list">
    <field
        jcr:primaryType="nt:unstructured"
        sling:resourceType="granite/ui/components/coral/foundation/container"
        name="./list">
        <items jcr:primaryType="nt:unstructured">
            <itemTitle
                jcr:primaryType="nt:unstructured"
                sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
                fieldLabel="Item Title"
                name="./itemTitle"/>
            <itemDescription
                jcr:primaryType="nt:unstructured"
                sling:resourceType="granite/ui/components/coral/foundation/form/textarea"
                fieldLabel="Item Description"
                name="./itemDescription"/>
            <itemImage
                jcr:primaryType="nt:unstructured"
                sling:resourceType="cq/gui/components/authoring/dialog/fileupload"
                class="cq-droptarget"
                fieldLabel="Item Image"
                fileNameParameter="./itemImage/fileName"
                fileReferenceParameter="./itemImage/fileReference"
                mimeTypes="[image/gif,image/jpeg,image/png,image/webp]"
                name="./itemImage/file"
                uploadUrl="${suffix.path}"
                useHTML5="{Boolean}true"/>
        </items>
    </field>
</list>
```

**Key**: Use `composite="{Boolean}true"` for multiple fields per item.

---

## Sling Resource Merger - Complete Reference

When extending a component via `sling:resourceSuperType`, the dialog is automatically inherited. Use Sling Resource Merger properties to modify inherited content.

**For comprehensive extension guide:** Load `references/guides/extending-core-components.md`

### Property Reference

| Property | Type | Purpose |
|----------|------|---------|
| `sling:hideResource` | Boolean | Hide entire node (tab, field, container) |
| `sling:hideChildren` | String[] | Hide specific child nodes by name |
| `sling:hideProperties` | String[] | Remove inherited properties before merging |
| `sling:orderBefore` | String | Position this node before another sibling |

### Hide Entire Tab

To hide an inherited tab, add a node with the same name as the inherited tab:

```xml
<!-- Hide "List Settings" tab inherited from core List component -->
<listSettings
    jcr:primaryType="nt:unstructured"
    sling:hideResource="{Boolean}true"/>

<!-- Hide "Item Settings" tab -->
<itemSettings
    jcr:primaryType="nt:unstructured"
    sling:hideResource="{Boolean}true"/>
```

### Hide Multiple Fields

```xml
<!-- Hide multiple fields at once using sling:hideChildren -->
<items
    jcr:primaryType="nt:unstructured"
    sling:hideChildren="[maxItems,orderBy,childDepth,tags]"/>
```

### Hide Single Field

```xml
<!-- Hide specific field -->
<maxItems
    jcr:primaryType="nt:unstructured"
    sling:hideResource="{Boolean}true"/>
```

### Override Inherited Field Properties

```xml
<!-- Change label, make required, update description -->
<title
    jcr:primaryType="nt:unstructured"
    sling:hideProperties="[fieldLabel,required,fieldDescription]"
    fieldLabel="Banner Title"
    fieldDescription="Enter the banner headline"
    required="{Boolean}true"/>
```

### Position Custom Tab Before Inherited

```xml
<customProperties
    jcr:primaryType="nt:unstructured"
    jcr:title="Custom Properties"
    sling:orderBefore="properties"
    sling:resourceType="granite/ui/components/coral/foundation/container"
    margin="{Boolean}true">
    <items jcr:primaryType="nt:unstructured">
        <!-- Custom fields here -->
    </items>
</customProperties>
```

### Core Component Tab Names Reference

| Core Component | Tab Node Names |
|----------------|----------------|
| **List** (v4) | `listSettings`, `itemSettings` |
| **Teaser** (v2) | `properties`, `actions` |
| **Image** (v3) | `properties`, `features` |
| **Button** (v2) | `properties` |
| **Container** (v1) | `properties`, `policy` |
| **Tabs/Accordion** (v1) | `properties`, `accessibility` |

### Complete Example: Dialog with Hidden Inherited Tabs

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    xmlns:granite="http://www.adobe.com/jcr/granite/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="nt:unstructured"
    jcr:title="Custom List"
    sling:resourceType="cq/gui/components/authoring/dialog">
    <content
        jcr:primaryType="nt:unstructured"
        sling:resourceType="granite/ui/components/coral/foundation/container">
        <items jcr:primaryType="nt:unstructured">
            <tabs
                jcr:primaryType="nt:unstructured"
                sling:resourceType="granite/ui/components/coral/foundation/tabs"
                maximized="{Boolean}true">
                <items jcr:primaryType="nt:unstructured">

                    <!-- HIDE inherited tabs from core component -->
                    <listSettings
                        jcr:primaryType="nt:unstructured"
                        sling:hideResource="{Boolean}true"/>
                    <itemSettings
                        jcr:primaryType="nt:unstructured"
                        sling:hideResource="{Boolean}true"/>

                    <!-- Custom Properties tab -->
                    <properties
                        jcr:primaryType="nt:unstructured"
                        jcr:title="Properties"
                        sling:resourceType="granite/ui/components/coral/foundation/container"
                        margin="{Boolean}true">
                        <items jcr:primaryType="nt:unstructured">
                            <columns
                                jcr:primaryType="nt:unstructured"
                                sling:resourceType="granite/ui/components/coral/foundation/fixedcolumns"
                                margin="{Boolean}true">
                                <items jcr:primaryType="nt:unstructured">
                                    <column
                                        jcr:primaryType="nt:unstructured"
                                        sling:resourceType="granite/ui/components/coral/foundation/container">
                                        <items jcr:primaryType="nt:unstructured">
                                            <!-- Custom fields here -->
                                            <customTitle
                                                jcr:primaryType="nt:unstructured"
                                                sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
                                                fieldLabel="Title"
                                                name="./customTitle"/>
                                        </items>
                                    </column>
                                </items>
                            </columns>
                        </items>
                    </properties>
                </items>
            </tabs>
        </items>
    </content>
</jcr:root>
```

---

## Dialog Clientlib (Custom Validation)

### When to Create
Create dialog clientlib when user specifies conditional logic:
- "Field B editable only if Field A is non-empty"
- "Show Field C when checkbox D is checked"

### Adding to Dialog
```xml
<jcr:root ...
    jcr:title="Component"
    sling:resourceType="cq/gui/components/authoring/dialog"
    extraClientlibs="[[project].componentname.dialog]">
```

### Add CSS Classes to Fields
```xml
<linkText
    jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
    fieldLabel="Link Text"
    name="./linkText"
    granite:class="component-link-text"/>
```

---

## Property Naming Rules

- **MUST** use camelCase property names: `name="./authorName"`
- **MUST** prefix with `./` for component properties
- **MUST NOT** use reserved namespaces: `jcr:*`, `sling:*`, `cq:*`
- Property names map directly to Sling Model `@ValueMapValue` fields

---

## Complete Example: Tiles List Dialog

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    xmlns:granite="http://www.adobe.com/jcr/granite/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="nt:unstructured"
    jcr:title="Tiles List"
    sling:resourceType="cq/gui/components/authoring/dialog">
    <content
        jcr:primaryType="nt:unstructured"
        sling:resourceType="granite/ui/components/coral/foundation/fixedcolumns">
        <items jcr:primaryType="nt:unstructured">
            <column
                jcr:primaryType="nt:unstructured"
                sling:resourceType="granite/ui/components/coral/foundation/container">
                <items jcr:primaryType="nt:unstructured">
                    <listTitle
                        jcr:primaryType="nt:unstructured"
                        sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
                        fieldLabel="List Title"
                        fieldDescription="Enter the main title"
                        name="./listTitle"/>
                    <tiles
                        jcr:primaryType="nt:unstructured"
                        sling:resourceType="granite/ui/components/coral/foundation/form/multifield"
                        composite="{Boolean}true"
                        fieldLabel="Tiles">
                        <field
                            jcr:primaryType="nt:unstructured"
                            sling:resourceType="granite/ui/components/coral/foundation/container"
                            name="./tiles">
                            <items jcr:primaryType="nt:unstructured">
                                <tileTitle
                                    jcr:primaryType="nt:unstructured"
                                    sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
                                    fieldLabel="Tile Title"
                                    name="./tileTitle"/>
                                <tileDesc
                                    jcr:primaryType="nt:unstructured"
                                    sling:resourceType="cq/gui/components/authoring/dialog/richtext"
                                    fieldLabel="Tile Description"
                                    name="./tileDesc"
                                    useFixedInlineToolbar="{Boolean}true"/>
                                <tileLinkText
                                    jcr:primaryType="nt:unstructured"
                                    sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
                                    fieldLabel="Link Text"
                                    name="./tileLinkText"/>
                                <tileLinkURL
                                    jcr:primaryType="nt:unstructured"
                                    sling:resourceType="granite/ui/components/coral/foundation/form/pathfield"
                                    fieldLabel="Link URL"
                                    name="./tileLinkURL"
                                    rootPath="/content"/>
                            </items>
                        </field>
                    </tiles>
                </items>
            </column>
        </items>
    </content>
</jcr:root>
```
