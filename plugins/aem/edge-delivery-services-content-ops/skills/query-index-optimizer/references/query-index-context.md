# Query index: background, definition syntax, troubleshooting

Sources: [Indexing](https://www.aem.live/developer/indexing), [Indexing reference](https://www.aem.live/docs/indexing-reference), [Spreadsheets and JSON](https://www.aem.live/developer/spreadsheets), [Sitemaps](https://www.aem.live/developer/sitemap), [Limits](https://www.aem.live/docs/limits) and the [Admin API](https://www.aem.live/docs/admin.html), read in November 2026. Edge Delivery Services changes: check a detail there before you rely on it.

## How the index works

- An index lists the **published** pages of a part of the site. A page enters or updates when it is published, by Sidekick or by the API alike. It leaves when it is unpublished. Previewing changes nothing.
- The definition is managed in the [Index Admin tool](https://tools.aem.live/tools/index-admin/index.html) or with the Admin API (`/config/<org>/sites/<site>/content/query.yaml`). After a change to the properties, **Reindex** in the tool reindexes the whole site.
- A site can have several indexes. Each is served at the `target` of its definition. `/query-index.json` is only the default name.
- With SharePoint or Google Drive as the content source, the index can also live in a spreadsheet. The indexer writes the sheet `raw_index`. A sheet named `helix-default` with a `FILTER` formula over `raw_index` can leave out pages, for example those with `noindex`. This is not available with Document Authoring, AEM authoring or another bring-your-own-markup source: there, filter in the consumer by the `robots` property.

## The response

```json
{ "total": 1472, "offset": 0, "limit": 1000, "data": [{ "path": "/…" }], "columns": ["path", "title"], ":type": "sheet" }
```

- `total` is the number of entries in the index, whatever `limit` was. Compare it with the number of entries you got.
- Without a `limit` parameter, at most 1000 entries are returned. Page with `?offset=<n>&limit=<n>`.
- A workbook with several delivered sheets answers with `":type": "multi-sheet"`. Ask for one sheet with `?sheet=<name>`.

## Limits

| Limit | Value |
|---|---|
| Pages in one index | 50,000 |
| Response payload | 6 MB compressed |
| Entries returned without `limit` | 1000 |

## Definition syntax

```yaml
indices:
  site:
    include:
      - /**
    exclude:
      - /drafts/**
    target: /query-index.json
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
      robots:
        select: head > meta[name="robots"]
        value: attribute(el, "content")
      lastModified:
        select: none
        value: parseTimestamp(headers["last-modified"], "ddd, DD MMM YYYY hh:mm:ss GMT")
  blog:
    include:
      - /blog/**
    target: /blog/query-index.json
    properties:
      title:
        select: head > meta[property="og:title"]
        value: attribute(el, "content")
      author:
        select: head > meta[name="author"]
        value: attribute(el, "content")
      tags:
        select: head > meta[property="article:tag"]
        values: attribute(el, "content")
```

- `include` and `exclude` decide which pages are indexed. `/**` matches everything under a prefix and the prefix itself. Without the section, every page is indexed.
- `select` is a CSS selector on the delivered HTML. It returns all matches; `selectFirst` returns the first. Not every selector is supported: the indexer uses `hast-util-select`.
- `value` gives a string, `values` an array.
- Functions: `attribute(el, name)`, `textContent(el)`, `innerHTML(el)`, `match(el, re)`, `words(el, start, end)`, `characters(el, start, end)`, `replace(el, substr, newSubstr)`, `replaceAll(el, substr, newSubstr)`, `parseTimestamp(el, format)`, `dateValue(el, format)`. Variables: `el`, `path`, `headers[name]`.
- `path` needs no property: every entry has it.

The properties the Index Admin tool offers, and where they come from:

| Property | Source |
|---|---|
| `title` | `og:title` meta property |
| `description` | `description` meta tag |
| `image` | `og:image` meta property |
| `author` | `author` meta tag |
| `date` | `publication-date` meta tag |
| `category` | `category` meta tag |
| `tags` | `article:tag` meta tags, as an array |
| `robots` | `robots` meta tag |
| `lastModified` | `Last-Modified` response header of the page |

## Troubleshooting

| Problem | Cause | What the user does |
|---|---|---|
| The index URL answers 404 | No index has this `target`. | Check the `target` in the Index Admin tool. |
| A page is missing | It is not published, it is outside `include` or inside `exclude`, or it was published before the definition covered it. | Publish it again. Check the paths of the definition. |
| A property is empty on every page | The `select` doesn't match the delivered HTML. | View the page source, not the inspector, and fix the selector. Then reindex. |
| A new property is empty on old pages | Only pages published since the change have it. | Reindex in the Index Admin tool. |
| A list shows 1000 entries and no more | The consumer fetches without `limit`. | Page with `offset` and `limit` in the consumer. |
| A deleted page is still in a list | The source document was deleted, the page was not unpublished. | Unpublish the path. |
| `noindex` pages are in the sitemap | The index that the sitemap is built from has no `robots` property. | Add `robots` to the definition and reindex. |
| The indexer reports errors | A broken expression in the definition. | Filter the [Log Viewer](https://tools.aem.live/tools/log-viewer/index.html) by `Indexer`. |
