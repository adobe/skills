---
name: adobe-fonts
description: >
  Use when the user needs font or typeface recommendations, is choosing type
  for a design (poster, invitation, packaging, social post, brand, website,
  presentation), wants fonts similar to one they already like, or needs
  licensed Adobe Fonts for a document. Triggers include "what font should I
  use for...", "recommend a typeface for...", "find fonts like [name]",
  "suggest fonts for a [mood] [doc type]", or "pair fonts for headings and
  body".
license: Apache-2.0
metadata:
  version: 1.0.0
---

# Adobe Fonts

Wraps the `get_font_recommendations` tool exposed through the Adobe for
Creativity MCP server, which returns real, licensable fonts from the Adobe
Fonts catalog based on document type, mood, style, topic, text hierarchy, or
similarity to a font the user already likes.

**Hard constraint:** every font returned is a real, licensable Adobe Fonts
family. Never recommend a font that didn't come back in the tool's results —
prior knowledge of "similar" fonts outside the catalog is not licensable
here and must not be substituted.

## Tool Reference

| Tool | Purpose |
| --- | --- |
| `get_font_recommendations` | Return contextual font recommendations from the Adobe Fonts catalog |

## Mapping a request to parameters

**Context parameters** — describe the design and intent:

| Param | Type | Notes |
| --- | --- | --- |
| `doc_type` | string | Document type, e.g. `"postcard"`, `"Instagram post"`, `"movie poster"` |
| `styles` | string | Comma-separated styles |
| `moods` | string | Comma-separated moods |
| `topics` | string | Comma-separated design topics |
| `user_query` | string | Free-form text, max 150 chars |
| `font_query` | bool | Set `true` when `user_query` is literally a font-name search rather than a design brief |
| `text_hierarchy` | `"heading"` \| `"body"` | Text focus, when the user cares about one specifically |
| `selected_font` | string | A `postscript_name` for "more like this" similarity search |

**`selected_font` must be a `postscript_name` already returned by a prior
`get_font_recommendations` call** (from `font_identifier.postscript_name` or
a bare `postscript_name`) — never a guessed or display name. If the user
names a font casually (e.g. "something like Futura") and you don't yet have
its PostScript name, run a search first with `user_query` + `font_query:
true` to resolve it before using `selected_font`.

**Metadata parameters** — narrow the catalog:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `library` | `"full"` \| `"trial"` | `"full"` | |
| `writing_systems` | string | `"latn"` | comma-separated ISO 15924 script codes, lowercase, e.g. `"latn,jpan"`, `"cyrl"`, `"hang"` |
| `font_technology` | string | — | `"vf"` variable, `"colr"` color |
| `font_group` | string | — | e.g. `"Sans Serif,Display"` |
| `locale` | string | `"en"` | e.g. `"ja_JP"` |
| `per_page` | int, 1–100 | 10 | |
| `debug` | bool | `false` | disables caching |

`writing_systems` is passed straight through with no validation on the
server — an invalid or mismatched script code silently returns no results
rather than erroring. Map the user's target language(s)
to the correct ISO 15924 code (e.g. Korean → `hang`, Chinese → `hans`/`hant`,
Cyrillic → `cyrl`, Arabic → `arab`) rather than guessing.

If the request involves multiple intended uses (e.g. a poster needing both
display and body text) or multiple documents, call the tool once per
`text_hierarchy` / doc rather than trying to get one call to cover everything.

## Response shape

```json
{
  "results": [
    {
      "id": "trending_fonts",
      "name": "Trending Fonts",
      "results": [
        { "font_identifier": { "postscript_name": "MyriadPro-Regular", "font_id": "TkD-1-abc123" },
          "family_name": "Myriad Pro", "style_name": "Regular", "designers": ["..."],
          "foundry": "...", "detail_url": "https://fonts.adobe.com/fonts/myriad-pro" }
      ]
    }
  ],
  "total": 1,
  "instructions": "..."
}
```

`total` counts modules, not fonts — iterate each module's own nested
`results[]` for the fonts. Each font carries either a resolved
`font_identifier` (`postscript_name` + `font_id`) or a bare `postscript_name`
when the id couldn't be resolved, plus enrichment fields when available:
`family_name`, `style_name`, `full_name`, `designers`, `foundry`,
`detail_url`.

**The response's `instructions` field is authoritative for how to present
results** (formatting, linking to `detail_url`, crediting designers, writing
tone) — it's generated fresh on every call, so follow it over anything else,
including this skill, if the two ever diverge. Never infer a family name,
designer, or URL yourself when a field is present; omit the detail rather
than guessing when a field is absent.

**Errors are returned as a JSON body, not a transport failure** — check the
parsed result for an `"error"` key (e.g. `{"error": "...", "status_code":
400}`) rather than relying on the call throwing.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Recommending a font not present in the tool's results | Only use fonts from `get_font_recommendations` output — never from prior knowledge |
| Guessing family name, style, designer, or foundry from the `postscript_name` | Use the enriched fields verbatim; omit the detail if the field is absent |
| Constructing a fonts.adobe.com URL by hand | Use the exact `detail_url` field, or omit the link entirely |
| Passing a guessed or display name as `selected_font` | Only pass a `postscript_name` already returned by a prior call |
| `per_page` above 100 or `user_query` over 150 chars | Tool returns a 400-shaped error body — validate before calling |
