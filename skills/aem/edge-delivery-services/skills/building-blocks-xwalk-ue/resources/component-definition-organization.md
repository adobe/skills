# Component Definition Organization

As projects grow, organizing Universal Editor component definitions into logical groups improves maintainability and the authoring experience.

## Using Groups for Scalability

Instead of a flat list, organize components into groups in `_component-definition.json`:

```json
{
  "groups": [
    {
      "title": "Content",
      "id": "content",
      "components": [
        "text",
        "image",
        "quote",
        "hero"
      ]
    },
    {
      "title": "Navigation",
      "id": "navigation",
      "components": [
        "navigation",
        "navigation-group",
        "navigation-item",
        "breadcrumb"
      ]
    },
    {
      "title": "Commerce",
      "id": "commerce",
      "components": [
        "product-details",
        "product-list",
        "commerce-cart",
        "commerce-checkout"
      ]
    }
  ]
}
```

## Adding Custom Sections to Filters

When you create a custom section (e.g., navigation), add it to the main section filter in `_component-filters.json`:

```json
{
  "filters": [
    {
      "id": "main",
      "components": [
        "section",
        "navigation",
        "footer"
      ]
    }
  ]
}
```

**Without this step:** Your custom section won't appear as an option when authors try to add sections to a page.

## File Organization

| File | Purpose | When to Modify |
|------|---------|----------------|
| `_component-definition.json` | All component definitions | Adding new blocks/sections |
| `_component-filters.json` | Which components can contain which | Defining parent-child relationships |
| `_component-models.json` | Field definitions for components | Adding/modifying author fields |
| `blocks/blockname/_blockname.json` | Block-specific model | Preferred for block-scoped models |

**Prefer block-level JSON files** (`blocks/blockname/_blockname.json`) over monolithic model files. This keeps related code together and improves maintainability.
