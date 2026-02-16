# Migration Guide: Classic to xwalk (Universal Editor)

## Should I Migrate This Block?

Use this checklist to evaluate whether an existing classic block should be migrated to the xwalk (Universal Editor) pattern:

- [ ] Block is actively used and will continue to be used
- [ ] Block needs to be authorable in Universal Editor
- [ ] Block has content that changes frequently
- [ ] Classic version has known authoring pain points

## Key Differences: Classic vs. xwalk

| Aspect | Classic (Document-based) | xwalk (Universal Editor) |
|--------|------------------------|--------------------------|
| Content source | Google Docs / SharePoint | Universal Editor |
| DOM structure | Rows and cells from table markup | Semantic HTML with `data-aue-*` attributes |
| Configuration | Manual DOM parsing | `readBlockConfig()` with key-value option |
| Editability | Edit source document, preview | Inline editing in UE |
| Model definition | Not needed | Required `_blockname.json` |
| Instrumentation | Not needed | `moveInstrumentation()` required |

## Migration Example: Cards Block

Cards is the ideal migration example because it demonstrates two distinct `moveInstrumentation` patterns, has a minimal diff between versions, and is a universal UI pattern where CSS is identical between classic and xwalk.

### Classic version

From [AEM Block Collection](https://github.com/adobe/aem-block-collection) (`blocks/cards/cards.js`):

```javascript
import { createOptimizedPicture } from '../../scripts/aem.js';

/**
 * Decorates a cards block with image and text content.
 * @param {HTMLElement} block - The cards block element
 */
export default function decorate(block) {
  /* change to ul, li */
  const ul = document.createElement('ul');
  [...block.children].forEach((row) => {
    const li = document.createElement('li');
    while (row.firstElementChild) li.append(row.firstElementChild);
    [...li.children].forEach((div) => {
      if (div.children.length === 1 && div.querySelector('picture')) div.className = 'cards-card-image';
      else div.className = 'cards-card-body';
    });
    ul.append(li);
  });
  ul.querySelectorAll('picture > img').forEach((img) => img.closest('picture')
    .replaceWith(createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }])));
  block.textContent = '';
  block.append(ul);
}
```

### xwalk version

From [AEM Block Collection xwalk](https://github.com/adobe-rnd/aem-block-collection-xwalk) (`blocks/cards/cards.js`):

```javascript
import { createOptimizedPicture } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

/**
 * Decorates a cards block with image and text content, preserving UE editability.
 * @param {HTMLElement} block - The cards block element
 */
export default function decorate(block) {
  /* change to ul, li */
  const ul = document.createElement('ul');
  [...block.children].forEach((row) => {
    const li = document.createElement('li');
    moveInstrumentation(row, li); // ← preserve UE editability on each card
    while (row.firstElementChild) li.append(row.firstElementChild);
    [...li.children].forEach((div) => {
      if (div.children.length === 1 && div.querySelector('picture')) div.className = 'cards-card-image';
      else div.className = 'cards-card-body';
    });
    ul.append(li);
  });
  ul.querySelectorAll('picture > img').forEach((img) => {
    const optimizedPic = createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]);
    moveInstrumentation(img, optimizedPic.querySelector('img')); // ← preserve on image
    img.closest('picture').replaceWith(optimizedPic);
  });
  block.textContent = '';
  block.append(ul);
}
```

### Key transformation patterns

| Change | Classic | xwalk |
|--------|---------|-------|
| Import | `createOptimizedPicture` only | Adds `moveInstrumentation` from `scripts.js` |
| Row → li | Direct append | `moveInstrumentation(row, li)` after creating li |
| Image optimization | One-liner `replaceWith` | Expanded: create optimized picture, `moveInstrumentation(img, newImg)`, then `replaceWith` |

### Cards UE model (`models/_cards.json`)

```json
{
  "definitions": [
    {
      "title": "Cards",
      "id": "cards",
      "plugins": {
        "xwalk": {
          "page": {
            "resourceType": "core/franklin/components/block/v1/block",
            "template": {
              "name": "Cards",
              "model": "cards",
              "filter": "cards"
            }
          }
        }
      }
    },
    {
      "title": "Card",
      "id": "card",
      "plugins": {
        "xwalk": {
          "page": {
            "resourceType": "core/franklin/components/block/v1/block/item",
            "template": {
              "name": "Card",
              "model": "card"
            }
          }
        }
      }
    }
  ],
  "models": [
    {
      "id": "card",
      "fields": [
        {
          "component": "reference",
          "name": "image",
          "label": "Image",
          "valueType": "string"
        },
        {
          "component": "richtext",
          "name": "text",
          "label": "Text",
          "valueType": "string"
        }
      ]
    }
  ],
  "filters": [
    {
      "id": "cards",
      "components": [
        "card"
      ]
    }
  ]
}
```

> **Key aspects of the Cards model:**
>
> - **Parent/child pattern** — Cards (container) uses `filter: "cards"` while Card (item) uses `model: "card"`
> - **Named fields** — `image` (reference) and `text` (richtext) give authors labeled fields instead of positional columns
> - **Filter restricts children** — The `"cards"` filter allows only `"card"` components inside the Cards container
> - **Container uses filter, items use model** — The parent block definition has `filter` to control what can be inserted; child definitions have `model` to define editable fields

For additional migration patterns, see:

> **Resource:** `resources/key-value-migration.md` — Key-value configuration migration walkthrough
