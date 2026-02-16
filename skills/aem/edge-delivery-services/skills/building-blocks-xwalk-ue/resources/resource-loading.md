# Resource Loading Guide

Guidance for lazy loading external resources (CSS, JS, third-party scripts) in AEM Edge Delivery blocks.

## When to Load Resources

| Resource | Load When... |
|----------|-------------|
| `ue-troubleshooting.md` | Block not working in Universal Editor |
| `key-value-migration.md` | Migrating existing block to key-value configuration |
| `common-mistakes.md` | Quick reference for common issues during development |
| `configuration-patterns.md` | Need to understand config parsing for different block types |
| `state-management.md` | Implementing interactive component state |
| `css-tokens.md` | Setting up CSS custom properties for a block |
| `field-naming-conventions.md` | Kebab-case naming rules for JSON field names and JavaScript access patterns |
| `component-definition-organization.md` | Organizing UE component definitions into groups for scalability |
| `blocks/example-nested-blocks/` | Complete 3-level nesting reference (Section → Block → Item) with JSON, JS, CSS, and editor-support patterns |

## Loading Patterns

Use `loadCSS` and `loadScript` from `aem.js` for lazy loading external resources in blocks:

```javascript
import { loadCSS, loadScript } from '../../scripts/aem.js';

// Load CSS when block needs external styles
await loadCSS('/path/to/external-styles.css');

// Load script when block needs external functionality
await loadScript('/path/to/external-library.js');
```

**Don't load resources preemptively.** Only load when:
1. The block explicitly requires that resource
2. You encounter an issue in that area
3. User asks about that specific topic
