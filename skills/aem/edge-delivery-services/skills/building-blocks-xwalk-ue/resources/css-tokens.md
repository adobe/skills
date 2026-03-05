# CSS Custom Property Tokens

Patterns for using CSS custom properties (design tokens) in AEM Edge Delivery blocks.

## Token Pattern

Use CSS custom properties to define block-specific tokens that reference global design tokens. For sites with design system components (e.g., drop-ins), use the `:root, .dropin-design {}` selector to ensure tokens are available in all contexts.

```css
/* block-name.css */
:root,
.dropin-design {
  --block-name-padding: var(--spacing-small);
  --block-name-color: var(--color-text-primary);
  --block-name-hover-bg: var(--color-background-secondary);
  --block-name-icon-size: 1.5rem;
}

.block-name {
  padding: var(--block-name-padding);
  color: var(--block-name-color);
}

.block-name:hover {
  background: var(--block-name-hover-bg);
}

.block-name .icon {
  width: var(--block-name-icon-size);
  height: var(--block-name-icon-size);
}
```

### Why This Pattern?

1. **`:root`** — Provides defaults for standard AEM pages
2. **`.dropin-design`** — Ensures tokens work inside Adobe Commerce Storefrontdesign system components (e.g., drop-ins)
3. **Fallback chain** — Block tokens reference global design tokens

## When to Use

| Site Type | Selector |
|-----------|----------|
| Standard AEM Edge Delivery | `:root { }` is sufficient |
| Sites with Adobe Commerce Storefront design system components (e.g., drop-ins) | `:root, .dropin-design { }` required |
