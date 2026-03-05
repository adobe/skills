# Configuration Parsing Patterns

Comparison of configuration parsing approaches for different block types in AEM Edge Delivery with Universal Editor.

## Block Type Comparison

| Component Type | Has `key-value`? | Has `filter`? | How to Read Config |
|----------------|------------------|---------------|-------------------|
| **Leaf Item** (navigation-item, accordion-item) | Yes | No | `readBlockConfig(block)` |
| **Parent Container** (accordion, navigation-group) | No | Yes | Query children directly |
| **Section** | N/A | N/A | `section.dataset.*` from section-metadata |

## Pattern 1: Leaf Block with Key-Value Config

```javascript
// accordion-item.js - HAS key-value: true
import { readBlockConfig } from '../../scripts/aem.js';

export default async function decorate(block) {
  const config = readBlockConfig(block);
  
  // Destructure with defaults
  const {
    title = 'Untitled',
    content = '',
    expanded = 'false',
  } = config;
  
  // Use values directly
  const isExpanded = expanded === 'true';
  // ... render item
}
```

## Pattern 2: Parent Block with Filter

```javascript
// accordion.js - HAS filter, NO key-value
// DO NOT use readBlockConfig for parent containers!

export default async function decorate(block) {
  // Query child blocks directly
  const items = block.querySelectorAll('.accordion-item');
  
  items.forEach((item, index) => {
    // Read each item's config (they have key-value)
    const header = item.querySelector('.accordion-item-header');
    const panel = item.querySelector('.accordion-item-panel');
    
    // Set up parent behavior (expand/collapse orchestration)
    header?.addEventListener('click', () => {
      toggleItem(item, items); // Parent manages coordination
    });
  });
}
```

## Pattern 3: Reading data-aue-prop Attributes

**For blocks with filter that need to read child element values:**

```javascript
// extractAueConfig - reads values from [data-aue-prop] elements
function extractAueConfig(block) {
  const config = {};
  block.querySelectorAll('[data-aue-prop]').forEach((el) => {
    const prop = el.dataset.aueProp;
    // Value is in textContent, NOT in an attribute
    config[prop] = el.textContent.trim();
  });
  return config;
}

// Usage in a block with filter
export default async function decorate(block) {
  const items = block.querySelectorAll(':scope > div');
  
  items.forEach((item) => {
    const itemConfig = extractAueConfig(item);
    // itemConfig = { title: 'Products', icon: 'shopping-cart', ... }
  });
}
```

## When readBlockConfig Doesn't Work

**Symptoms:**
- `readBlockConfig()` returns empty object or wrong data
- Block has a `filter` property in its JSON model
- Block contains other blocks as children

**Solution:** Don't use `readBlockConfig()` for parent containers. Query children directly.

## Component Hierarchy

Universal Editor organizes content in a strict 3-level hierarchy:

```
SECTION (wrapper, contains blocks)
    └── BLOCK (parent container OR leaf component)
            └── ITEM (leaf component inside a parent block)
```

| Type | Has Filter? | Has Key-Value? | Example |
|------|-------------|----------------|---------|
| **Section** | Yes (contains blocks) | Never | `navigation` section, `hero` section |
| **Parent Block** | Yes (contains items) | NEVER | `accordion`, `carousel`, `tabs`, `navigation-group` |
| **Leaf Item** | No | Yes (recommended) | `accordion-item`, `carousel-item`, `navigation-item` |

### Decision Flowchart

```
Does this component contain other components?
    │
    ├─ YES → PARENT CONTAINER
    │        ❌ DO NOT use key-value: true
    │        ✅ Define a filter for allowed children
    │        ✅ Read child config via DOM queries
    │
    └─ NO  → LEAF COMPONENT
             ✅ USE key-value: true (recommended)
             ✅ Read config via readBlockConfig()
             ❌ No filter needed
```

### How to Read Config for Each Type

| Component Type | How to Read Config | Import |
|---------------|-------------------|--------|
| **Leaf Item** (key-value) | `readBlockConfig(block)` | `import { readBlockConfig } from '../../scripts/aem.js'` |
| **Parent Block** (filter) | Query `[data-aue-prop]` elements or use `extractAueConfig()` | Project-specific utility (see Pattern 3 above) |
| **Section** | `section.dataset.*` or section-metadata block | N/A |

### Red Flags

| If you're thinking... | STOP! The reality is... |
|----------------------|------------------------|
| "This parent block has config, so I'll add key-value" | Parent config comes from section-metadata or `[data-aue-prop]` elements, NOT key-value |
| "I'll use key-value for the group title and expanded state" | Those properties belong on the group's model fields, read via `extractAueConfig()` not `readBlockConfig()` |
| "The child items need key-value, so the parent probably does too" | Parent and child are fundamentally different. Children = key-value. Parents = filter + DOM queries |
| "I saw another block with both filter and key-value" | That block is broken or you misread it. Check again |
