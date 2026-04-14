# Component Model Field Types Reference

> **Canonical source:** These field types are defined by the Universal Editor JSON schemas:
> - [model-definition-fields.schema.json](https://universal-editor-service.adobe.io/schemas/model-definition-fields.schema.json)
> - [model-definition.schema.json](https://universal-editor-service.adobe.io/schemas/model-definition.schema.json)

## Field Structure

Every field in a component model follows this base structure:

```json
{
  "component": "<field-type>",
  "name": "<property-name>",
  "label": "<Display Label>",
  "valueType": "<data-type>",
  "value": "<default-value>",
  "description": "<helper-text>"
}
```

**Required properties for all fields:** `component`, `label`, `name`.

Some component types require additional properties — see the per-component sections and the [Required Properties](#required-properties-by-component) table.

---

## Component Types

### Text Input Fields

#### `text`
Single-line text input. Used for short strings like titles, labels, alt text.
- **Enforced valueType:** `"string"`
- **Validation:** `minLength`, `maxLength`, `regExp`, `customErrorMsg`

```json
{
  "component": "text",
  "name": "title",
  "label": "Title",
  "valueType": "string"
}
```

#### `textarea`
Multi-line text input without rich formatting. Use for descriptions, notes, or longer plain text content. Distinct from `richtext` which includes formatting controls.
- **Enforced valueType:** `"string"`

```json
{
  "component": "textarea",
  "name": "description",
  "label": "Description",
  "valueType": "string"
}
```

#### `richtext`
Rich text editor with formatting controls (bold, italic, lists, links). Toolbar can be customized via RTE filter configuration (see architecture.md).
- **Enforced valueType:** `"string"`

```json
{
  "component": "richtext",
  "name": "text",
  "value": "",
  "label": "Text",
  "valueType": "string"
}
```

### Media & Content Fields

#### `reference`
AEM asset picker. Opens DAM browser for selecting images, videos, documents. Unlike `aem-content`, this can only reference assets.
- **Enforced valueType:** `"string"`

```json
{
  "component": "reference",
  "name": "image",
  "label": "Image",
  "valueType": "string",
  "multi": false
}
```
- Set `multi: true` for multiple asset selection
- Typically paired with a `text` field for alt text (e.g., `imageAlt`)

#### `aem-content`
AEM content picker. Can select any AEM resource — pages, URLs, content paths. Unlike `reference` which is limited to assets.
- **Flexible valueType** (any from enum, defaults to `"string"`)
- **Validation:** `rootPath` — limits content picker to a specific directory

```json
{
  "component": "aem-content",
  "name": "link",
  "label": "Link",
  "valueType": "string"
}
```

#### `aem-content-fragment`
Content Fragment picker. Selects AEM Content Fragments — structured content reusable across channels.
- **Flexible valueType** (any from enum, defaults to `"string"`)

```json
{
  "component": "aem-content-fragment",
  "name": "articlepath",
  "value": "",
  "label": "Article Content Fragment path",
  "valueType": "string"
}
```

#### `aem-experience-fragment`
Experience Fragment picker. Selects AEM Experience Fragments — groups of one or more components including content and layout that can be referenced and reused across pages.
- **Flexible valueType** (any from enum, defaults to `"string"`)

```json
{
  "component": "aem-experience-fragment",
  "name": "fragment",
  "label": "Experience Fragment",
  "valueType": "string"
}
```

#### `aem-tag`
AEM tag picker for content categorization and organization.
- **Enforced valueType:** `"string"`

```json
{
  "component": "aem-tag",
  "name": "tags",
  "label": "Tags",
  "valueType": "string"
}
```

### Selection Fields

#### `select`
Single-choice dropdown. Requires `options` array.
- **Enforced valueType:** `"string"`
- **Required properties:** `options`

```json
{
  "component": "select",
  "name": "titleType",
  "label": "Title Type",
  "valueType": "string",
  "value": "h2",
  "options": [
    { "name": "H1", "value": "h1" },
    { "name": "H2", "value": "h2" },
    { "name": "H3", "value": "h3" }
  ]
}
```

#### `multiselect`
Multiple-choice selector. Supports grouped options via `children`. Requires `options` array.
- **Enforced valueType:** `"string"` (not `"string[]"` — this is enforced by the schema)
- **Required properties:** `options`

```json
{
  "component": "multiselect",
  "name": "style",
  "label": "Style",
  "valueType": "string",
  "options": [
    { "name": "Highlight", "value": "highlight" },
    { "name": "Dark", "value": "dark" }
  ]
}
```

**Grouped options** (with `children`):
```json
{
  "component": "multiselect",
  "name": "classes",
  "label": "Style",
  "valueType": "string",
  "maxSize": 3,
  "options": [
    {
      "name": "Theme",
      "children": [
        { "name": "Light", "value": "light" },
        { "name": "Dark", "value": "dark" }
      ]
    },
    {
      "name": "Alignment",
      "children": [
        { "name": "Left", "value": "left" },
        { "name": "Right", "value": "right" }
      ]
    }
  ]
}
```

#### `checkbox-group`
Multiple true/false checkbox items. Users can select multiple options simultaneously. Requires `options` array.
- **Enforced valueType:** `"string[]"`
- **Required properties:** `options`

```json
{
  "component": "checkbox-group",
  "name": "features",
  "label": "Features",
  "valueType": "string[]",
  "options": [
    { "name": "Show Title", "value": "show-title" },
    { "name": "Show Image", "value": "show-image" },
    { "name": "Show CTA", "value": "show-cta" }
  ]
}
```

#### `radio-group`
Radio button group for mutually exclusive choices. Requires `options` array.
- **Enforced valueType:** `"string"`
- **Required properties:** `options`

```json
{
  "component": "radio-group",
  "name": "orientation",
  "label": "Display Options",
  "valueType": "string",
  "value": "horizontal",
  "options": [
    { "name": "Horizontally", "value": "horizontal" },
    { "name": "Vertically", "value": "vertical" }
  ]
}
```

### Data Fields

#### `boolean`
Toggle for true/false values.
- **Enforced valueType:** `"boolean"`
- **Validation:** `customErrorMsg`

```json
{
  "component": "boolean",
  "name": "hideHeading",
  "label": "Hide Heading",
  "description": "Hide the heading of the block",
  "valueType": "boolean",
  "value": false
}
```

#### `number`
Numeric input with optional min/max constraints.
- **Enforced valueType:** `"number"`
- **Validation:** `numberMin`, `numberMax`, `customErrorMsg`

```json
{
  "component": "number",
  "name": "maxItems",
  "label": "Max Items",
  "valueType": "number",
  "description": "Maximum number of items to display"
}
```

#### `date-time`
Date/time picker.
- **Enforced valueType:** `"date"`

```json
{
  "component": "date-time",
  "name": "startDate",
  "label": "Start Date",
  "valueType": "date"
}
```

### Structural Fields

#### `container`
Groups nested fields together. Used for composite fields or repeated field groups.
- **Flexible valueType** (any from enum)

```json
{
  "component": "container",
  "name": "ctas",
  "label": "Call to Actions",
  "collapsible": false,
  "multi": true,
  "fields": [
    { "component": "richtext", "name": "text", "label": "Text", "valueType": "string" },
    { "component": "aem-content", "name": "link", "label": "Link" }
  ]
}
```
- `collapsible`: Whether the group can be collapsed in the UI
- `multi: true`: Makes the container repeatable (add/remove instances). Container nesting is not permitted for multi-fields.
- `fields`: Array of nested field definitions

#### `tab`
Creates a tab separator in the properties panel. Not a data field — purely UI organization. Everything after a `tab` is placed on that tab until a new `tab` is encountered.
- **Flexible valueType** (any from enum)

```json
{
  "component": "tab",
  "label": "Validation",
  "name": "validation"
}
```

---

## valueType Constraints

The `valueType` property controls data validation. Most components **enforce** a specific value (marked as `const` in the schema). Only a few allow any value from the enum.

| Component | Enforced valueType | Flexibility |
|---|---|---|
| `text` | `"string"` | Enforced |
| `textarea` | `"string"` | Enforced |
| `richtext` | `"string"` | Enforced |
| `reference` | `"string"` | Enforced |
| `select` | `"string"` | Enforced |
| `multiselect` | `"string"` | Enforced |
| `radio-group` | `"string"` | Enforced |
| `checkbox-group` | `"string[]"` | Enforced |
| `boolean` | `"boolean"` | Enforced |
| `number` | `"number"` | Enforced |
| `date-time` | `"date"` | Enforced |
| `aem-tag` | `"string"` | Enforced |
| `aem-content` | Any | Flexible |
| `aem-content-fragment` | Any | Flexible |
| `aem-experience-fragment` | Any | Flexible |
| `container` | Any | Flexible |
| `tab` | Any | Flexible |

**Valid valueType enum values:** `"string"`, `"string[]"`, `"number"`, `"date"`, `"boolean"`

---

## Required Properties by Component

All fields require `component`, `label`, and `name`. Some require additional properties:

| Component | Additional required properties |
|---|---|
| `select` | `options` |
| `multiselect` | `options` |
| `radio-group` | `options` |
| `checkbox-group` | `options` |
| All others | — |

---

## Field Properties

| Property | Type | Description |
|----------|------|-------------|
| `component` | string | **Required.** Field type |
| `name` | string | **Required.** Property name for data persistence. Underscore (`_`) not allowed with aem/xwalk plugins. Can be a nested path (e.g., `teaser/image/fileReference`). |
| `label` | string | **Required.** Display label in the property panel |
| `description` | string | Helper text shown below the field |
| `valueType` | string | Data type for the value (see constraints table above) |
| `value` | any | Default value. The UE will persist this if no value is set. |
| `multi` | boolean | Allow multiple values. Container nesting not permitted for multi-fields. |
| `required` | boolean | Whether the field must have a value before saving |
| `readOnly` | boolean | Field cannot be edited by authors |
| `hidden` | boolean | Field is hidden from the properties panel |
| `options` | array | Choices for select/multiselect/radio-group/checkbox-group. **Required** for those types. |
| `condition` | object | JSON Logic rule for showing/hiding the field dynamically |
| `validation` | object | Validation rules — component-specific (see below) |
| `maxSize` | number | Max selections for multiselect |
| `collapsible` | boolean | For containers: whether they can collapse |
| `fields` | array | For containers: nested field definitions |
| `raw` | any | Additional metadata passed to the component |

---

## Validation

Validation rules are component-specific. Each component type supports different constraints:

### TextValidation (for `text` only)
| Property | Type | Description |
|----------|------|-------------|
| `minLength` | number | Minimum characters allowed |
| `maxLength` | number | Maximum characters allowed |
| `regExp` | string | Regular expression the input must match |
| `customErrorMsg` | string | Custom error message on validation failure |

```json
{
  "component": "text",
  "name": "email",
  "label": "Email",
  "valueType": "string",
  "validation": {
    "regExp": "^[^@]+@[^@]+\\.[^@]+$",
    "customErrorMsg": "Please enter a valid email address"
  }
}
```

### NumberValidation (for `number` only)
| Property | Type | Description |
|----------|------|-------------|
| `numberMin` | number | Minimum value allowed |
| `numberMax` | number | Maximum value allowed |
| `customErrorMsg` | string | Custom error message on validation failure |

### BooleanValidation (for `boolean` only)
| Property | Type | Description |
|----------|------|-------------|
| `customErrorMsg` | string | Custom error message for invalid boolean values |

### AEMContentValidation (for `aem-content` only)
| Property | Type | Description |
|----------|------|-------------|
| `rootPath` | string | Limits content picker to this directory and subdirectories |

```json
{
  "component": "aem-content",
  "name": "link",
  "label": "Link",
  "valueType": "string",
  "validation": {
    "rootPath": "/content/mysite"
  }
}
```

---

## Conditional Fields

Use JSON Logic syntax to show/hide fields based on other field values:

```json
{
  "component": "text",
  "name": "customUrl",
  "label": "Custom URL",
  "valueType": "string",
  "condition": {
    "==": [
      { "var": "linkType" },
      "custom"
    ]
  }
}
```

Operators: `==`, `===`, `!=`, `!==`, and standard JSON Logic operators.

---

## Options Format

### Flat options
```json
"options": [
  { "name": "Display Name", "value": "stored-value" }
]
```

Each option requires `name` (display text) and `value` (persisted value).

### Grouped options (multiselect only)
```json
"options": [
  {
    "name": "Group Label",
    "children": [
      { "name": "Option A", "value": "a" },
      { "name": "Option B", "value": "b" }
    ]
  }
]
```

### With empty/default option
```json
"options": [
  { "name": "default", "value": "" },
  { "name": "primary", "value": "primary" },
  { "name": "secondary", "value": "secondary" }
]
```
