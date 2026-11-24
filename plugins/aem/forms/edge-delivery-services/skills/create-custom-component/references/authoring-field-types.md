# Authoring Properties Dialog — Field Types Reference

This is the catalog of field types (components/widgets) available for the **properties dialog** of a custom component — the panel authors see in the Universal Editor when they select the component on a form.

Use these field types inside the `models[0].fields` array of your component's `_<name>.json`. Each entry in that array is an object with at minimum a `component`, `name`, and `label`.

Source: [Adobe Experience League — Universal Editor Field Types](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/universal-editor/field-types#fields)

---

## Field object — common shape

Every field object accepts these keys:

| Key | Type | Required | Purpose |
|-----|------|----------|---------|
| `component` | string | yes | Widget type (see table below) |
| `name` | string | yes | Property path where the value is persisted. Supports dot-notation for nested resources (e.g. `teaser/image/fileReference`). **Underscores (`_`) are not allowed** when using AEM/xwalk plugins. |
| `label` | string | yes | Display label in the authoring dialog |
| `description` | string | no | Helper text shown under the field |
| `value` | any | no | Default value |
| `valueType` | enum | no | `string`, `string[]`, `number`, `date`, `date-time`, `time`, `boolean` — used for validation/storage |
| `required` | boolean | no | Marks the field mandatory |
| `readOnly` | boolean | no | Prevents editing |
| `hidden` | boolean | no | Hides the field initially |
| `condition` | object | no | Conditional visibility rules |
| `multi` | boolean | no | Enables multifield (repeatable) support — only on `container` |
| `validation` | object | no | Field-specific validation (see each type below) |
| `raw` | object | no | Custom data forwarded to the component |

---

## Field types at a glance

| `component` value | Widget | Notes |
|-------------------|--------|-------|
| `text` | Single-line text input | `minLength`, `maxLength`, `regExp` validation |
| `textarea` | Multi-line plain text | |
| `richtext` | Rich text editor | Formatted multi-line |
| `number` | Numeric input | `numberMin`, `numberMax`; `valueFormat: "long"` (default) or `"double"` |
| `boolean` | Toggle switch | |
| `select` | Single-option dropdown | Needs `options` |
| `multiselect` | Multi-option dropdown | Needs `options`; supports grouping via `children`; `maxSize` limit |
| `radio-group` | Radio buttons | Needs `options` |
| `checkbox-group` | Checkboxes | Needs `options`; value is `string[]` |
| `date-time` | Date/time picker | `valueType`: `date-time`, `date`, or `time`; requires `displayFormat` + `valueFormat` |
| `container` | Grouping / multifield wrapper | `collapsible`, `fields`, `multi` |
| `tab` | Tab separator | Groups subsequent fields onto a tab |
| `reference` | Asset picker | Assets only |
| `aem-content` | Content picker | Any AEM resource; `validation.rootPath` to scope |
| `aem-content-fragment` | Content Fragment picker | `variationName`, `validation.rootPath` |
| `aem-experience-fragment` | Experience Fragment picker | `variationName`, `validation.rootPath` |
| `aem-tag` | AEM tag picker | |

---

## Type-by-type specifications

### `text` — single-line input
Validation: `minLength`, `maxLength`, `regExp`, `customErrorMsg`.

```json
{
  "component": "text",
  "name": "title",
  "label": "Title",
  "valueType": "string",
  "required": true,
  "validation": {
    "minLength": 1,
    "maxLength": 80,
    "regExp": "^[A-Za-z0-9 ]+$",
    "customErrorMsg": "Letters, digits, and spaces only"
  }
}
```

### `textarea` — multi-line plain text

```json
{
  "component": "textarea",
  "name": "description",
  "label": "Description",
  "valueType": "string"
}
```

### `richtext` — rich text editor

```json
{
  "component": "richtext",
  "name": "body",
  "label": "Body",
  "valueType": "string"
}
```

### `number` — numeric input
Validation: `numberMin`, `numberMax`, `customErrorMsg`. `valueFormat` is `"long"` (default) or `"double"`.

```json
{
  "component": "number",
  "name": "step",
  "label": "Step",
  "valueType": "number",
  "value": 1,
  "validation": {
    "numberMin": 1,
    "numberMax": 100,
    "customErrorMsg": "Step must be between 1 and 100"
  }
}
```

### `boolean` — toggle switch

```json
{
  "component": "boolean",
  "name": "enabled",
  "label": "Enabled",
  "valueType": "boolean"
}
```

### `select` — single-option dropdown

```json
{
  "component": "select",
  "name": "variant",
  "label": "Variant",
  "valueType": "string",
  "options": [
    { "name": "Default", "value": "default" },
    { "name": "Compact", "value": "compact" }
  ]
}
```

### `multiselect` — multi-option dropdown
Supports grouped options via `children`. Use `maxSize` to cap selections.

```json
{
  "component": "multiselect",
  "name": "tags",
  "label": "Tags",
  "valueType": "string",
  "maxSize": 3,
  "options": [
    {
      "name": "Theme",
      "children": [
        { "name": "Light", "value": "light" },
        { "name": "Dark", "value": "dark" }
      ]
    }
  ]
}
```

### `radio-group` — mutually-exclusive options

```json
{
  "component": "radio-group",
  "name": "alignment",
  "label": "Alignment",
  "valueType": "string",
  "options": [
    { "name": "Left", "value": "left" },
    { "name": "Right", "value": "right" }
  ]
}
```

### `checkbox-group` — multiple checkboxes
Value is an array.

```json
{
  "component": "checkbox-group",
  "name": "features",
  "label": "Features",
  "valueType": "string[]",
  "options": [
    { "name": "Analytics", "value": "analytics" },
    { "name": "Personalization", "value": "personalization" }
  ]
}
```

### `date-time` — date, time, or both
Set `valueType` to `date-time`, `date`, or `time`. `displayFormat` and `valueFormat` are required (pass `null` to accept the defaults).

```json
{
  "component": "date-time",
  "name": "startsAt",
  "label": "Starts at",
  "valueType": "date-time",
  "required": true,
  "placeholder": "YYYY-MM-DD HH:mm:ss",
  "displayFormat": null,
  "valueFormat": null
}
```

### `container` — grouping + multifield
Two modes:

- **Grouping:** nest `fields`, optionally `collapsible: true`.
- **Multifield:** add `multi: true` to make the set repeatable. *Container nesting is not permitted inside multifields.*

```json
{
  "component": "container",
  "name": "settings",
  "label": "Settings",
  "collapsible": true,
  "fields": [
    { "component": "text", "name": "label", "label": "Label", "valueType": "string" },
    { "component": "boolean", "name": "active", "label": "Active", "valueType": "boolean" }
  ]
}
```

Multifield:

```json
{
  "component": "container",
  "name": "images",
  "label": "Images",
  "multi": true,
  "fields": [
    { "component": "reference", "name": "src", "label": "Image", "valueType": "string" },
    { "component": "text", "name": "alt", "label": "Alt Text", "valueType": "string" }
  ]
}
```

### `tab` — tab separator
A `tab` entry is a separator, not a wrapper. Every field that follows it appears on that tab until the next `tab` entry. Fields before any `tab` appear above all tabs.

```json
[
  { "component": "tab", "name": "general", "label": "General" },
  { "component": "text", "name": "title", "label": "Title", "valueType": "string" },

  { "component": "tab", "name": "advanced", "label": "Advanced" },
  { "component": "number", "name": "timeout", "label": "Timeout (ms)", "valueType": "number" }
]
```

### `reference` — asset picker
Assets only. For broader AEM content, use `aem-content`.

```json
{
  "component": "reference",
  "name": "icon",
  "label": "Icon",
  "valueType": "string"
}
```

### `aem-content` — any AEM resource
Scope the picker with `validation.rootPath`.

```json
{
  "component": "aem-content",
  "name": "linkedPage",
  "label": "Linked Page",
  "valueType": "string",
  "validation": { "rootPath": "/content/refresh" }
}
```

### `aem-content-fragment` — Content Fragment picker
Set `variationName` to expose the variation picker; omit it to hide.

```json
{
  "component": "aem-content-fragment",
  "name": "fragment",
  "label": "Content Fragment",
  "valueType": "string",
  "variationName": "contentFragmentVariation",
  "validation": { "rootPath": "/content/dam/fragments" }
}
```

### `aem-experience-fragment` — Experience Fragment picker

```json
{
  "component": "aem-experience-fragment",
  "name": "xf",
  "label": "Experience Fragment",
  "valueType": "string",
  "variationName": "experienceFragmentVariation",
  "validation": { "rootPath": "/content/experience-fragments" }
}
```

### `aem-tag` — tag picker

```json
{
  "component": "aem-tag",
  "name": "cq:tags",
  "label": "Tags",
  "valueType": "string"
}
```

---

## Picking the right type

| Need | Use |
|------|-----|
| Short free-form string | `text` |
| Long free-form string | `textarea` |
| Formatted string (bold, links) | `richtext` |
| Integer or decimal | `number` |
| On/off flag | `boolean` |
| One of N fixed options | `select` (many) or `radio-group` (few) |
| Several of N fixed options | `multiselect` (many) or `checkbox-group` (few) |
| Date, time, or timestamp | `date-time` |
| Group related fields visually | `container` (with `collapsible`) |
| Repeatable set of fields | `container` with `multi: true` |
| Separate fields across tabs | `tab` |
| Point at an asset (image, file) | `reference` |
| Point at any AEM page/resource | `aem-content` |
| Point at a Content Fragment | `aem-content-fragment` |
| Point at an Experience Fragment | `aem-experience-fragment` |
| Attach AEM tags | `aem-tag` |

---

## Gotchas

- **No underscores in `name`** when AEM/xwalk plugins are in use.
- **`tab` is a separator, not a wrapper** — do not nest fields inside it.
- **Multifields cannot contain nested containers.** Keep the `fields` array flat.
- **`date-time` requires `displayFormat` and `valueFormat` keys**, even when passing `null`.
- **`checkbox-group` values are arrays** (`valueType: "string[]"`); `radio-group` is a single value.
- **`reference` is assets only.** Use `aem-content` for pages, experience fragments, or arbitrary resources.
