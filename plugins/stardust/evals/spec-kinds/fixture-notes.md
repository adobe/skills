# Fixture provenance & known limitations

`fixture/` realizes this eval's Setup: a fictional regional airport
operator's `spec` run frozen between S6 and S7, in the exact file layout
`skills/spec/scripts/test/spec-knowledge.test.mjs` builds — `spec.config.json`
(`aem-core` profile so the starter mapping exists but does NOT cover the
site's own components), a three-page sitemap under `/en/` with `fetch.jsonl`,
`parse/{components,signals,links}.jsonl`, an empty `links/pages.jsonl`,
`map/variants.json` and `chrome/header.json`, plus the S9 judgement files
(`implementation.json` with one `site-search` feature whose reach rule and a
finding both reference `block:site-search`, `findings.json`, `search-probes.json`,
an empty `answers.json`). The component trees use the parse contract's node
shape (`c, p, mods, chars, imgs, videos, forms, links, h`) and are flat (no
layout wrappers, rows, carousels or nesting) so the judgement reduces to the
kind decision the eval measures: `banner` (authored hero → block),
`richtext` / `title` / `image` (prose → default), `quicksearch` (`chars: 0`,
`forms: 1` → widget) and `langnav` (three locale links → metadata, given
`chars: 8` so the default `dropIfEmpty` does not remove it). `mapping.json`
and `catalog.json` are deliberately absent — the agent writes them — and a
reference pair (hero block / site-search widget / default prose / metadata
langnav) was verified to take `spec-map.mjs` to "unmapped components: none"
and `spec-knowledge.mjs` to exit 0 with `hero:block:reuse`,
`site-search:widget:new` in `blocks.json`. Two caveats: the feature reach rule
`block:site-search` assumes the agent names the search block `site-search`
(another name still computes, with reach 0, so S10 does not fail); and no
`media/`, `rum/` or `martech/` material exists, so captures, traffic bands and
martech are empty by design. This file and `answers.md` live outside
`fixture/` and are not visible to the agent under test.
