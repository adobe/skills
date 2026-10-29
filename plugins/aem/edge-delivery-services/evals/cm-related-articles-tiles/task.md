# Related Articles Tiles for Blog Posts

## Problem/Feature Description

The Fenwick Gardens blog runs on AEM Edge Delivery Services; editors author posts in Document Authoring (da.live). Every blog post already has page metadata (title, description, image, category, publication-date, read-time), and the site publishes a query index of all posts at `/blog/query-index.json` (sample in the input files).

The product owner wrote this story:

> **BLOG-88 — Related articles at the end of each post**
>
> At the bottom of each blog post show 3 "related article" tiles. Each tile shows:
> - Thumbnail image
> - Category label (e.g. "Vegetables")
> - Article title
> - Excerpt (max ~140 characters)
> - Publish date ("Apr 2, 2025")
> - Read time ("6 min read")
> - The whole tile links to the article
>
> Editors choose which articles appear for each post. Sometimes an editor picks only one or two; if editors pick nothing, show the 3 newest posts from the same category as the current post.
> Editors complained on the old CMS that related-article teasers went stale whenever an article's title or image changed.

## Output Specification

- Write `MODEL.md` describing what an editor writes in the post document (as text table / markdown grid), with an example where the editor picks two articles and one where the editor picks none. Follow with a 2–5 sentence rationale.
- Write `blocks/related-articles/related-articles.js` (default-exported `decorate(block)`; may be async). CSS is not needed.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: data/blog-query-index.sample.json ===============
{
  "total": 3,
  "offset": 0,
  "limit": 3,
  "data": [
    {
      "path": "/blog/tomatoes-in-containers",
      "title": "Growing Tomatoes in Containers",
      "description": "Small balcony? Here is how to get a big tomato harvest from a few pots and the right varieties.",
      "image": "/blog/media_1a2b.jpg?width=1200&format=pjpg&optimize=medium",
      "category": "Vegetables",
      "publication-date": "1743552000",
      "read-time": "6"
    },
    {
      "path": "/blog/winter-pruning-roses",
      "title": "Winter Pruning for Healthier Roses",
      "description": "Prune in late winter to shape your roses and encourage strong new growth.",
      "image": "/blog/media_3c4d.jpg?width=1200&format=pjpg&optimize=medium",
      "category": "Flowers",
      "publication-date": "1738368000",
      "read-time": "4"
    },
    {
      "path": "/blog/raised-bed-soil-mix",
      "title": "The Best Soil Mix for Raised Beds",
      "description": "Our tested recipe for raised-bed soil that drains well and feeds plants all season.",
      "image": "/blog/media_5e6f.jpg?width=1200&format=pjpg&optimize=medium",
      "category": "Vegetables",
      "publication-date": "1740787200",
      "read-time": "8"
    }
  ],
  ":type": "sheet"
}

=============== FILE: scripts/aem.js (exports used by blocks, excerpt) ===============
export function getMetadata(name, doc = document) { /* returns content of <meta name=...> */ }
export function createOptimizedPicture(src, alt = '', eager = false, breakpoints = [/* ... */]) { /* ... */ }
