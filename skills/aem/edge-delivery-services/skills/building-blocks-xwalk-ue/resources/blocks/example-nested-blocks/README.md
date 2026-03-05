# Example Nested Blocks

## Overview

This is a reference block demonstrating the **3-level nesting pattern** (Section → Block → Item) for AEM Edge Delivery Services with Universal Editor. It shows the correct way to structure parent containers and leaf items with proper key-value configuration decisions.

## Purpose

This example block serves as a reference implementation for:
- Section → Parent Block → Leaf Item hierarchy
- Correct `filter` and `key-value` usage at each level
- Parent containers that read settings from `block.dataset.*` (not `readBlockConfig()`)
- Leaf items that use `key-value: true` with `readBlockConfig()`
- `moveInstrumentation()` for DOM restructuring
- Editor-support patterns for re-decoration (`getState`/`setState`/`applyChanges`)
- Autoblocking in `decorateSections`

## Architecture

### The 3-Level Hierarchy

```
example-nested-blocks (SECTION)
├── model: example-nested-blocks
├── key-value: NO (sections never use key-value)
├── filter: example-nested-blocks-filter → [example-nested-group]
│
└── example-nested-group (PARENT BLOCK)
    ├── model: example-nested-group
    ├── key-value: NO (has filter → MUST NOT use key-value)
    ├── filter: example-nested-group-filter → [example-nested-item]
    ├── reads own config: block.dataset.heading, block.dataset.expanded
    │
    └── example-nested-item (LEAF ITEM)
        ├── model: example-nested-item
        ├── key-value: YES (leaf component, no children)
        ├── filter: NONE (leaf has no children)
        └── reads config: readBlockConfig(block) → { label, url, icon }
```

### The Critical Rule in Practice

| Level | Component | Has Filter? | Has Key-Value? | Why? |
|-------|-----------|-------------|----------------|------|
| Section | example-nested-blocks | Yes | No | Sections never use key-value |
| Block | example-nested-group | Yes | **No** | Has filter → MUST NOT have key-value |
| Item | example-nested-item | No | **Yes** | Leaf component → key-value recommended |

## Files

| File | Purpose |
|------|---------|
| `_example-nested-blocks.json` | UE definitions, models, and filters for all 3 levels |
| `example-nested-blocks.js` | Parent container decoration with `moveInstrumentation` |
| `example-nested-blocks.css` | Mobile-first CSS with design tokens |
| `scripts/example-aem-updates.js` | Autoblocking pattern for `decorateSections` in `aem.js` |
| `scripts/example-editor-support-updates.js` | Editor-support with `getState`/`setState`/`applyChanges` |

## Key Patterns Demonstrated

### Parent Block Reads from dataset, Not readBlockConfig

```javascript
// ✅ Parent block (has filter) — reads from dataset
const heading = block.dataset.heading || '';
const expanded = block.dataset.expanded === 'true';

// ❌ WRONG for parent blocks
const config = readBlockConfig(block); // Returns wrong/empty data
```

### Leaf Item Uses readBlockConfig

```javascript
// ✅ Leaf item (has key-value: true)
import { readBlockConfig } from '../../scripts/aem.js';

export default function decorate(block) {
  const { label, url, icon } = readBlockConfig(block);
}
```

### moveInstrumentation on Every Restructured Element

```javascript
groups.forEach((group) => {
  const li = document.createElement('li');
  moveInstrumentation(group, li); // ✅ Before removing original
  // ... build content
});
```

## Companion Example

- **Key-Value Config Example:** `resources/blocks/example-key-value-config/` — Demonstrates the LEAF pattern (flat key-value block, no children)
- **This Example:** Demonstrates the CONTAINER pattern (3-level nesting with parent/child hierarchy)

## See Also

- **Parent Skill:** `SKILL.md` — Step 2.1 (key-value decision), Step 6.3 (parent/child patterns)
- **Configuration Patterns:** `resources/configuration-patterns.md` — Config reading per component type
- **Field Naming:** `resources/field-naming-conventions.md` — Kebab-case rule for JSON field names
- **Component Organization:** `resources/component-definition-organization.md` — Grouping definitions
