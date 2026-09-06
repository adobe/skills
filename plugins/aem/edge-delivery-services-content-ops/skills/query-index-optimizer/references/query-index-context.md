# Query Index Background & Troubleshooting

> Sources of truth: [Indexing](https://www.aem.live/developer/indexing) and
> [Spreadsheets: offset and limit](https://www.aem.live/developer/spreadsheets#offset-and-limit).
> Verify against these docs before relying on any claim below, because EDS evolves.

## How the EDS Query Index Works

The query index is the primary mechanism for blocks and components to discover and list content in an EDS site. It is configured with the **Index Admin tool** and served as JSON (by default at `/query-index.json`).

### Key Concepts

- **Index configuration**: Managed with the [Index Admin tool](https://www.aem.live/developer/indexing) (or the Admin API "Update Indexing Configuration" endpoint), not a file committed to the GitHub repo. The definition specifies which properties to index and how they are sourced (from metadata, headings, or content).
- **The index endpoint**: `query-index.json` is the **default** name; a site can define additional, differently-named indices. Each returns an array of page entries with the indexed properties.
- **Consumers**: Blocks and components that fetch the index to build dynamic lists: navigation, footer, card lists, search results, recent posts, tag-filtered collections.
- **Default limit**: The endpoint returns a maximum of **1000** entries by default. Use the `limit` and `offset` query parameters to paginate beyond that (see [offset and limit](https://www.aem.live/developer/spreadsheets#offset-and-limit)).
- **Index freshness**: Pages are indexed **when they are published** (whether via Sidekick or programmatically; the method does not matter). Previewing a page does not change the published index.

### Common Properties

| Property | Source | Typical Consumers |
|----------|--------|-------------------|
| `path` | automatic | All consumers |
| `title` | metadata | Nav, cards, search |
| `description` | metadata | Cards, search |
| `image` | metadata | Cards, hero blocks |
| `lastModified` | automatic | Freshness sorting |
| `template` | metadata | Filtered collections |
| `tags` | metadata | Tag-filtered blocks |
| `author` | metadata | Blog cards |

### Example index definition

Index definitions are managed through the Index Admin tool / Admin API. A definition that indexes the whole site plus a named `blog` index looks like:

```yaml
indices:
  all:
    include:
      - /**
    properties:
      title:
        select: head > meta[property="og:title"]
        value: attribute(el, "content")
      description:
        select: head > meta[name="description"]
        value: attribute(el, "content")
      image:
        select: head > meta[property="og:image"]
        value: attribute(el, "content")
      tags:
        select: head > meta[property="article:tag"]
        values: attribute(el, "content")
  blog:
    include:
      - /blog/**
    properties:
      title:
        select: head > meta[property="og:title"]
        value: attribute(el, "content")
      author:
        select: head > meta[name="author"]
        value: attribute(el, "content")
```

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| Query index returns 404 | No index configured for the site | Create an index definition with the Index Admin tool |
| Pages missing from index | Pages not published after the index was configured | Publish each missing page (Sidekick or programmatically), then re-fetch the index |
| Stale entries persist after deletion | Index keeps an entry until the path is re-published / unpublished | Unpublish the path (or publish a replacement), then allow the index to update |
| Properties appear empty in index | The `select` / `value` expression in the index definition does not match the metadata key | Verify the property name matches the definition exactly (case-sensitive) |
| Index returns fewer pages than expected | Hitting the default limit of 1000 entries | Add `?limit=<n>` and page through with `?offset=<n>` |
| Named index not found | The index name does not match a defined index | Verify the index name against the Index Admin configuration |
