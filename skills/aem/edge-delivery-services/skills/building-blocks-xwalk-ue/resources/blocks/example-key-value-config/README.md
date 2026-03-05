# Example Key-Value Config Block

## Overview

This is a minimal example block demonstrating the **key-value configuration pattern** for AEM Edge Delivery Services blocks. It shows best practices for reading configuration with `readBlockConfig()` when `"key-value": true` is enabled in the Universal Editor JSON.

## Purpose

This example block serves as a reference implementation for:
- ✅ Enabling key-value configuration in JSON (`"key-value": true`)
- ✅ Reading configuration with `readBlockConfig()`
- ✅ Providing backward compatibility fallbacks
- ✅ Using kebab-case field names
- ✅ Handling multiple field types (text, boolean, select, number)

## Integration

### Block Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `title` | text | "Example Block" | Main heading for the block |
| `subtitle` | text | "" | Optional subtitle text |
| `show-icon` | boolean | false | Display an icon next to the title |
| `alignment` | select | "left" | Text alignment (left, center, right) |
| `max-items` | number | 10 | Maximum number of items (1-50) |

### Universal Editor Setup

This block uses the **key-value configuration pattern**:

```json
{
  "template": {
    "key-value": true  // ✅ Enabled
  }
}
```

**Benefits:**
- Configuration stored as `data-*` attributes (not DOM elements)
- Cleaner HTML output
- Better performance
- Easier debugging (visible in DevTools)

## Key-Value Pattern Details

### How Configuration is Stored

**With key-value enabled:**
```html
<div class="example-key-value-config block"
     data-title="My Title"
     data-subtitle="My Subtitle"
     data-show-icon="true"
     data-alignment="center"
     data-max-items="20">
  <!-- No configuration DOM elements -->
</div>
```

**Without key-value (traditional):**
```html
<div class="example-key-value-config block">
  <div><div>title</div><div>My Title</div></div>
  <div><div>subtitle</div><div>My Subtitle</div></div>
  <div><div>show-icon</div><div>true</div></div>
  <!-- Config creates visible DOM rows -->
</div>
```

### JavaScript Implementation

```javascript
import { readBlockConfig } from '../../scripts/aem.js';

export default async function decorate(block) {
  // Works for BOTH key-value AND traditional config
  const config = readBlockConfig(block);
  
  // Extract with backward compatibility fallbacks
  const title = config.title || block.dataset.title || 'Default';
  const showIcon = (config['show-icon'] || block.dataset.showIcon) === 'true';
  
  // Use configuration...
}
```

**Key points:**
- `readBlockConfig()` works for both patterns
- Always provide fallback chain: `config.field || block.dataset.field || 'default'`
- Boolean values are strings: `'true'` or `'false'`
- Field names use kebab-case: `'show-icon'`, not `'showIcon'`

## Behavior Patterns

### Configuration Reading

1. **Priority order:**
   - Key-value config (from `readBlockConfig()`)
   - Dataset attributes (for backward compatibility)
   - Default values

2. **Field name conventions:**
   - JSON uses kebab-case: `"name": "show-icon"`
   - JavaScript uses bracket notation: `config['show-icon']`

### DOM Transformation

1. Clears block content
2. Creates container with alignment class
3. Builds header with optional icon and title
4. Adds subtitle if provided
5. Creates content demonstrating configuration usage

## Testing

### Test Configuration Reading

```javascript
describe('Example Key-Value Config Block', () => {
  it('should read configuration from readBlockConfig', async () => {
    const { readBlockConfig } = await import('../../scripts/aem.js');
    readBlockConfig.mockReturnValueOnce({
      title: 'Test Title',
      'show-icon': 'true',
      alignment: 'center'
    });
    
    const { default: decorate } = await import('./example-key-value-config.js');
    await decorate(block);
    
    expect(block.querySelector('h2').textContent).toBe('Test Title');
    expect(block.querySelector('.icon')).toBeTruthy();
    expect(block.querySelector('.align-center')).toBeTruthy();
  });
});
```

## Accessibility

- Semantic HTML structure (h2 for heading, p for subtitle)
- Icon has `aria-hidden="true"` (decorative)
- Text content is screen reader accessible
- No interactive elements (no ARIA states needed)

## Performance

**Key-value benefits demonstrated:**
- Zero configuration DOM elements
- ~70% reduction in HTML size vs. traditional config
- Direct attribute access (faster than DOM traversal)
- Cleaner debugging (config visible as attributes)

## See Also

- **Parent Skill:** `SKILL.md` — Step 2.1 for key-value decision tree
- **Nested Blocks Example:** `resources/blocks/example-nested-blocks/` — Container pattern (3-level nesting with parent/child hierarchy)
- **Field Naming:** `resources/field-naming-conventions.md` — Kebab-case naming rules for JSON field names
- **Configuration Patterns:** `resources/configuration-patterns.md` — Config reading per component type
- **Migration Guide:** Parent skill, "Migration Guide" section
