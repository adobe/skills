# Key-Value Configuration Migration Guide

Reference for migrating existing AEM Edge Delivery blocks from traditional row-based configuration to key-value configuration patterns.

## Example Blocks Using Key-Value Configuration

**Blocks USING key-value:**
- `accordion-item` - Child of accordion container
- `carousel-item` - Child of carousel container
- `card` - Child of cards container
- `promotional-banner` - Marketing banner with settings
- `enrichment` - Content enhancement block

**Blocks NOT using key-value:**
- `accordion` - Parent container for accordion-item children
- `carousel` - Parent container for carousel-item children
- `cards` - Parent container for card children
- `tabs` - Parent container for tab-panel children

## Migration Process

### Should I Migrate This Block?

**Good candidates for migration:**
- Configuration-only blocks (headers, banners, utility components)
- Child components of containers (items, cards, panels)
- Blocks with many configuration fields
- Blocks experiencing performance issues
- Blocks where debugging configuration is difficult

**Consider carefully:**
- Blocks with existing production content (need backward compatibility)
- Blocks with complex configuration + content mix
- Blocks scheduled for replacement/deprecation

**Don't migrate:**
- Parent containers with child items (accordion, carousel, cards)
- Blocks working well with no issues
- Blocks in active development with frequent changes

### Step-by-Step Migration

**1. Update JSON Configuration**

Add `"key-value": true` to the template:

```json
{
  "definitions": [
    {
      "title": "Block Name",
      "id": "blockname",
      "plugins": {
        "xwalk": {
          "page": {
            "resourceType": "core/franklin/components/block/v1/block",
            "template": {
              "name": "Block Name",
              "model": "blockname",
              "key-value": true
            }
          }
        }
      }
    }
  ]
}
```

**2. Update JavaScript Implementation**

**BEFORE (Traditional Config):**
```javascript
export default async function decorate(block) {
  const rows = Array.from(block.children);
  let title = 'Default';
  let showIcon = false;
  
  // Manual parsing of configuration rows
  rows.forEach((row) => {
    const cols = Array.from(row.children);
    if (cols.length === 2) {
      const key = cols[0].textContent.trim().toLowerCase();
      const value = cols[1].textContent.trim();
      
      if (key === 'title') title = value;
      if (key === 'show icon') showIcon = value === 'true';
      
      row.remove(); // Remove config row
    }
  });
  
  // Use configuration...
}
```

**AFTER (Key-Value Config with Backward Compatibility):**
```javascript
import { readBlockConfig } from '../../scripts/aem.js';

export default async function decorate(block) {
  // Read config (supports both key-value AND traditional)
  const config = readBlockConfig(block);
  
  // Extract with fallbacks for backward compatibility
  const title = config.title || block.dataset.title || 'Default';
  const showIcon = (config['show-icon'] || block.dataset.showIcon) === 'true';
  
  // No need to manually parse or remove rows
  // Key-value: no config rows exist
  // Traditional: readBlockConfig already read them
  
  // Use configuration (same as before)...
}
```

### Validation Checklist

Before deploying migration:

- [ ] Linting passes
- [ ] Manual testing in Universal Editor
- [ ] Manual testing with existing production content
- [ ] README.md updated with new configuration pattern
- [ ] Code review completed

## Backward Compatibility

**Always support multiple configuration sources:**

```javascript
export default async function decorate(block) {
  const config = readBlockConfig(block);
  
  // Priority order:
  // 1. Key-value config (readBlockConfig from data-* attributes)
  // 2. Dataset attributes (production content)
  // 3. Default values
  
  const title = config.title || block.dataset.title || 'Default Title';
  const showIcon = (config['show-icon'] || block.dataset.showIcon) === 'true';
  const maxItems = parseInt(
    config['max-items'] || block.dataset.maxItems || '10',
    10
  );
  
  // Use configuration...
}
```

**This pattern ensures:**
- New Universal Editor content works (key-value)
- Existing production content works (dataset attributes)
- Graceful fallbacks (default values)
- No breaking changes

## Rollback Plan

If migration causes issues:

1. **Immediate fix:** Update JavaScript to prioritize dataset attributes over key-value
2. **Revert JSON:** Remove `"key-value": true` from template (preserves existing behavior)
3. **Deploy hotfix:** Push reverted code to production
4. **Investigate:** Determine root cause before re-attempting migration
5. **Communicate:** Inform team about rollback and timeline for fix

## Migration Example Note

For a concrete migration example, apply the steps above to any leaf block that currently uses row-based configuration (e.g., `info-card`, `hero`, `promo-banner`).

## Deployment Strategy

**Recommended: Phased rollout**

1. **Deploy with backward compatibility** - New code supports both patterns
2. **Monitor production** - Ensure no issues with existing content
3. **Update content gradually** - Authors can update blocks to new pattern when editing
4. **Eventually retire traditional support** - After sufficient migration period (6+ months)

**Not recommended: Big bang migration** - Don't force-migrate all existing content at once
