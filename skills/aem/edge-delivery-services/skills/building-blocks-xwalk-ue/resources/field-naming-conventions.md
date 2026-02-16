# Field Naming Conventions

Universal Editor field names MUST use kebab-case. This is non-negotiable — `readBlockConfig()` returns kebab-case keys (via `toClassName()` conversion), and mismatched names silently return `undefined`.

## The Rule

All `name` fields in Universal Editor JSON configurations MUST use kebab-case (lowercase with hyphens).

```
✅ "name": "background-color"
✅ "name": "enable-countdown"
✅ "name": "promotional-text"
❌ "name": "backgroundColor"
❌ "name": "background_color"
❌ "name": "Background Color"
```

## How toClassName() Works

Universal Editor converts field labels to kebab-case internally:

```javascript
"Background Color" → "background-color"
"Enable Countdown" → "enable-countdown"
"Promotional Text" → "promotional-text"
"Show Image"       → "show-image"
"Button Style"     → "button-style"
```

When your JSON `name` field doesn't match this output, `readBlockConfig()` returns `undefined` for that key.

## Where This Convention Applies

### 1. Field `name` Attributes

All field definitions in Universal Editor JSON:

```json
{
  "models": [
    {
      "id": "my-block",
      "fields": [
        {
          "component": "text",
          "name": "promotional-text",
          "label": "Promotional Text"
        },
        {
          "component": "boolean",
          "name": "enable-countdown",
          "label": "Enable Countdown"
        }
      ]
    }
  ]
}
```

### 2. Condition `var` References

Conditional logic must reference kebab-case field names:

```json
{
  "component": "text",
  "name": "countdown-text",
  "label": "Countdown Text",
  "condition": {
    "===": [
      { "var": "enable-countdown" },
      true
    ]
  }
}
```

### 3. JavaScript Config Access

Always use bracket notation with kebab-case keys:

```javascript
import { readBlockConfig } from '../../scripts/aem.js';

export default function decorate(block) {
  const config = readBlockConfig(block);

  // ✅ Correct — bracket notation, kebab-case
  const backgroundColor = config['background-color'];
  const enableCountdown = config['enable-countdown'];

  // ❌ Wrong — all of these return undefined
  const wrong1 = config.backgroundColor;
  const wrong2 = config['backgroundColor'];
  const wrong3 = config.background_color;
}
```

### Destructuring with Defaults

Use destructuring for cleaner code — the key must still be kebab-case, but you can alias to camelCase:

```javascript
import { readBlockConfig } from '../../scripts/aem.js';

export default function decorate(block) {
  const {
    'hide-heading': hideHeading = 'false',
    'max-items': maxItems,
    'enable-item-quantity-update': enableUpdateItemQuantity = 'false',
    'enable-item-remove': enableRemoveItem = 'true',
    'checkout-url': checkoutURL = '',
  } = readBlockConfig(block);

  if (hideHeading === 'true') {
    // Hide the heading
  }

  const limit = maxItems ? parseInt(maxItems, 10) : Infinity;
}
```

## Common Mistakes

### Mistake 1: JavaScript Property Naming

```json
// ❌ DON'T
{ "name": "primaryColor" }

// ✅ DO
{ "name": "primary-color" }
```

### Mistake 2: Database Column Names

```json
// ❌ DON'T
{ "name": "promo_banner_text" }

// ✅ DO
{ "name": "promo-banner-text" }
```

### Mistake 3: Inconsistent Access in JavaScript

```javascript
// JSON: "name": "button-style"

const wrong1 = config.buttonStyle;       // ❌ undefined
const wrong2 = config['buttonStyle'];    // ❌ undefined
const wrong3 = config.button_style;      // ❌ undefined
const correct = config['button-style'];  // ✅ Works
```

## Debugging Config Issues

If configuration values return `undefined`:

### 1. Log the Raw Config Object

```javascript
const config = readBlockConfig(block);
console.log('Raw config:', config);
// Inspect the actual keys in the output
```

### 2. Compare JSON Name with Console Output

The JSON `name` field must match the console output key exactly.

### 3. Common Debug Scenario

```javascript
// config['background-color'] returns undefined
console.log(config);
// Output: { 'backgroundColor': '#FF5733' }
// Mismatch! JSON has "name": "backgroundColor" — should be "background-color"
```

## Validation Checklist

Use when creating or reviewing Universal Editor JSON configurations:

- [ ] All field `name` attributes use kebab-case
- [ ] All condition `var` references use kebab-case
- [ ] Field names match exactly how they're accessed in JavaScript
- [ ] No camelCase in `name` fields
- [ ] No snake_case in `name` fields
- [ ] No spaces in `name` fields
- [ ] JavaScript uses bracket notation with kebab-case strings
- [ ] Tested block locally — config values are accessible
- [ ] If using destructuring, keys are kebab-case with camelCase aliases

## Automated Validation

Find non-kebab-case field names in your project:

```bash
find ./blocks -name '_*.json' -exec grep -H '"name"' {} \; | \
  grep -v '"name": "[a-z][a-z0-9-]*"' | \
  grep -v '"name": "[A-Z]'
```
