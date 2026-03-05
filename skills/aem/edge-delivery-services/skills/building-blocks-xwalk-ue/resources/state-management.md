# State Management Patterns

Patterns for managing state in AEM Edge Delivery blocks, from simple module-level state to DOM-driven approaches compatible with Universal Editor.

## Pattern 1: Module-Level State (Set)

**Recommended for simple state tracking (expanded items, selected items).**

```javascript
// accordion.js
const expandedItems = new Set();

export default async function decorate(block) {
  const blockId = block.id || `accordion-${Date.now()}`;
  block.id = blockId;
  
  const items = block.querySelectorAll('.accordion-item');
  items.forEach((item, index) => {
    const itemId = `${blockId}-item-${index}`;
    
    item.querySelector('button')?.addEventListener('click', () => {
      if (expandedItems.has(itemId)) {
        expandedItems.delete(itemId);
        item.setAttribute('aria-expanded', 'false');
      } else {
        expandedItems.add(itemId);
        item.setAttribute('aria-expanded', 'true');
      }
    });
  });
}
```

## Pattern 2: Data Attributes (Carousel Pattern)

**Recommended for DOM-queryable state.**

```javascript
// carousel.js
export default async function decorate(block) {
  const slides = block.querySelectorAll('.carousel-slide');
  let currentIndex = 0;
  
  function showSlide(index) {
    slides.forEach((slide, i) => {
      slide.dataset.active = i === index ? 'true' : 'false';
      slide.setAttribute('aria-hidden', i !== index);
    });
    block.dataset.currentSlide = index;
    currentIndex = index;
  }
  
  // Navigation
  block.querySelector('.next')?.addEventListener('click', () => {
    showSlide((currentIndex + 1) % slides.length);
  });
  
  showSlide(0); // Initialize
}
```

## Pattern 3: ARIA State (Tabs Pattern)

**Required for accessibility-driven state.**

```javascript
// tabs.js
export default async function decorate(block) {
  const tabs = block.querySelectorAll('[role="tab"]');
  const panels = block.querySelectorAll('[role="tabpanel"]');
  
  function selectTab(index) {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', i === index);
      tab.setAttribute('tabindex', i === index ? '0' : '-1');
    });
    panels.forEach((panel, i) => {
      panel.hidden = i !== index;
    });
  }
  
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(index));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') selectTab((index + 1) % tabs.length);
      if (e.key === 'ArrowLeft') selectTab((index - 1 + tabs.length) % tabs.length);
    });
  });
  
  selectTab(0);
}
```

## Guidelines

| State Type | Storage Method | Example |
|------------|---------------|---------|
| Expanded/collapsed | ARIA + data attribute | `aria-expanded`, `data-expanded` |
| Current/active | ARIA + data attribute | `aria-selected`, `data-active` |
| Loading state | data attribute | `data-loading="true"` |
| Error state | data attribute | `data-error="message"` |
| Temporary/ephemeral | Module variable | `let currentIndex = 0` |
| Needs DOM query | data attribute | `block.dataset.state` |
