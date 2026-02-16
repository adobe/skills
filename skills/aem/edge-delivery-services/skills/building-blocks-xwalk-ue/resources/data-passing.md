# Data Passing Between Blocks

## How Blocks Communicate in AEM Edge Delivery

Blocks in AEM Edge Delivery Services are **isolated by convention**. They do not share state through custom events, global variables, or pub/sub systems. Communication happens through six patterns — all based on DOM attributes, direct function calls, or re-decoration.

### 1. DOM Attributes as Shared State

The decoration pipeline sets `dataset` properties on blocks and sections that any block can read:

| Attribute | Set by | Values | Purpose |
|-----------|--------|--------|---------|
| `data-aue-resource` | Universal Editor | `urn:aemconnection:...` | UE element identity |
| `dataset.blockStatus` | `aem.js` decoration | `initialized` → `loading` → `loaded` | Block lifecycle state |
| `dataset.sectionStatus` | `aem.js` decoration | `initialized` → `loading` → `loaded` | Section lifecycle state |
| `dataset.blockName` | `aem.js` decoration | Block type identifier (e.g., `cards`) | Block type |
| Section metadata | `decorateSections()` | Varies per key | Key-value pairs from section metadata block become `dataset[camelCasedKey]` on the `.section` element |

```javascript
// Reading section-level state
const section = block.closest('.section');
const sectionStatus = section?.dataset.sectionStatus;

// Reading block-level metadata
const blockName = block.dataset.blockName;
```

### 2. moveInstrumentation for UE Editability

`moveInstrumentation(from, to)` transfers `data-aue-*` and `data-richtext-*` attributes from one element to another. Call it whenever you create a new element to replace an authored element:

```javascript
import { moveInstrumentation } from '../../scripts/scripts.js';

const li = document.createElement('li');
moveInstrumentation(row, li); // Transfer UE attributes from authored row to new li
```

### 3. Direct Function Imports

In specific cases, modules import functions directly from other modules. These are the established patterns:

| Import | From → To | Purpose |
|--------|-----------|---------|
| `showSlide(block, index)` | `editor-support.js` → `carousel.js` | Restore carousel position after UE re-decoration |
| `decorateMain(main)` | `editor-support.js` → `scripts.js` | Re-run full page decoration after UE content changes |
| `moveInstrumentation(from, to)` | Block JS → `scripts.js` | Transfer UE instrumentation during DOM restructuring |

> **Do not create new cross-module imports without established patterns.** Blocks import from `scripts.js` and `aem.js` only.

### 4. Editor Support Replays Decoration

The `editor-support.js` module listens for Universal Editor content events dispatched by the external UE host application:

- `aue:content-patch` — Content inline edit
- `aue:content-update` — Property update from the properties rail
- `aue:content-add` — New component added
- `aue:content-move` — Component reordered
- `aue:content-remove` — Component deleted

On receiving these events, `editor-support.js` replays decoration through three code paths:

1. **Full main update** — `decorateMain()` → `loadSections()` (full page re-decoration)
2. **Block-level** — `decorateButtons()` → `decorateIcons()` → `decorateBlock()` → `loadBlock()` (single block re-decoration)
3. **Section/default content** — `decorateButtons()` → `decorateIcons()` → `decorateSections()` → `loadSections()` (section-level re-decoration)

There are no lifecycle hooks or callback registrations. Each path uses direct function calls, awaited in sequence.

### 5. Block Isolation

Block isolation is **absolute by convention**:

- Blocks do not communicate with other blocks
- All DOM queries use `:scope` selectors to avoid leaking into nested blocks
- The implicit structure is `.section` > `.block-wrapper` > `.block`
- No block may assume another block exists on the page or has been decorated

```javascript
// ✅ Correct — scoped to this block only
const rows = block.querySelectorAll(':scope > div');

// ❌ Wrong — may match elements in nested blocks
const rows = block.querySelectorAll('div');
```

### 6. State Preservation During Re-decoration

When Universal Editor replays decoration on stateful blocks, `editor-support.js` captures and restores state. The pattern uses `getState()` / `setState()` per block type:

```javascript
/**
 * Captures the current state of a stateful block before re-decoration.
 * @param {HTMLElement} block - The block element
 * @returns {Object} State to preserve
 */
function getState(block) {
  return { activeIndex: block.dataset.activeIndex || '0' };
}

/**
 * Restores block state after re-decoration.
 * @param {HTMLElement} block - The block element
 * @param {Object} state - Previously captured state
 */
function setState(block, state) {
  block.dataset.activeIndex = state.activeIndex;
}

export default function decorate(block) {
  const state = getState(block);
  // ... rebuild DOM ...
  setState(block, state);
}
```

Stateful blocks with established patterns: **Accordion** (`details[open]`), **Carousel** (`block.dataset.activeSlide`), **Tabs** (`aria-hidden="false"` panel).

> **Important:** Adobe uses zero custom events for block communication. The only `dispatchEvent` calls in the codebase are for RUM (Real User Monitoring) telemetry. Do NOT introduce custom event systems, pub/sub patterns, or global state for inter-block communication.
