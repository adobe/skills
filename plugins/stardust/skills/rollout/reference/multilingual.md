# Multilingual — the locale-tree wave (Phase D3, optional)

## When to read what

Read this when the source has language trees (`/fr/…` beside `/de/…`, or
twins on another host). Locale is a **tree, not a feature**: the trees reuse
the same block library; only authored content, chrome documents and a few
wiring pieces change. The class inventory (modal titles, video ids, form
strings, switcher) is `../dynamics/reference/locale-trees.md`; this file is
the delivery procedure and the manifest it runs on. Nothing here changes a
gate bar or the publish order: D1 (gate on preview, publish on pass) and D16
(hands-off preview-only) apply per tree, and every tree's pages ride the same
`scripts/wave.mjs` roster and deploy ledger (`sweep-protocol.md` § Wave driver).

## Manifest precondition — `stardust/trees.json`

D3 fan-out does not start without the manifest. A single-language site never
enters D3; a one-tree manifest is derived from evidence (`decided-by:
extract`). Hands-off derives it from hreflang, twin probes and
`decisions.md` `locale`; "locale scope" stays a dynamics owner row
(recorded by name, interim tier, run continues) — nothing weakened.

```json
{
  "_provenance": { "writtenBy": "stardust:rollout", "writtenAt": "<ISO>", "stardustVersion": "<v>" },
  "default": "en",
  "decisions": { "locale": "one folder per locale incl. default; root redirects" },
  "trees": [
    { "lang": "en", "root": "/en", "twinRoot": null, "source": "sitemap:/sitemap.xml",
      "nav": "/en/nav", "footer": "/en/footer", "search": "/en/search", "contact": "/en/contact",
      "chromeSource": "stardust/current/trees/en/chrome.json",
      "strings": { "menu": { "value": "Menu", "lifted": true }, "search": { "value": "Search", "lifted": true } } },
    { "lang": "es", "root": "/es", "twinRoot": "/en", "source": "hreflang",
      "nav": "/es/nav", "footer": "/es/footer", "search": "/es/buscar", "contact": "/es/contacto",
      "chromeSource": "stardust/current/trees/es/chrome.json",
      "strings": { "menu": { "value": "Menú", "lifted": true }, "form-confirmation": { "value": null, "lifted": false, "owner": true } } }
  ]
}
```

Rules: `default` and every `lang` are BCP 47 tags; `root` is the locale
folder (`decisions.md` `locale` default row — one folder per locale
**including** the default, root redirects to it); `twinRoot` names the tree a
locale mirrors; `source` records how the tree was discovered; every
`strings` entry is **lifted from the live pages or marked `owner: true`** —
"still English on live" is a valid lift, a translation is not. The schema is
this block; a lint reads it when one ships.

## Procedure

1. **Discover the trees.** Inputs, unioned: `hreflang` alternates on captured
   pages (primary — `dynamics-detect.mjs` already reads the selector), every
   sitemap the host lists, and a BFS from each locale root; record `source`
   per URL. Twins that answer 301 are recorded, not captured (they are the
   redirect sheet's rows). Twins sit in unrelated section sitemaps and
   some carry no hreflang — no single input is complete.
2. **Type the twins.** Twin first (the default-language page's `type`), then
   the classifier's answer; a disagreement is listed in the plan, never
   silently resolved. Mirror the default-language archetype per type in the
   target language at the localized path — **no new blocks**.
3. **Supplement the store (write-once).** Capture twins with `crawl.mjs
   --pages <paths>` into the SAME store. A supplement run never re-aggregates
   the default-language Phase 3–4 surface (`_brand-extraction.json`,
   `PRODUCT.md`, `DESIGN.*`); locale evidence lands under
   `stardust/current/trees/<lang>/` (chrome hover probe, strings), and every
   supplemented page record carries `lang` and its alternates. Escape: an
   explicit `--force` re-run, stamped in `_crawl-log.json.runs[]`. Hands-off:
   the default is the safe one; no prompt.
4. **Chrome per locale.** Author `/<lang>/nav` and `/<lang>/footer` from the
   locale's hover probe, cross-checked on the source in that language; labels
   the header/footer blocks render come from `/<lang>/placeholders.json`
   (lifted or OWNER, never generated — A18). Language-route by metadata rows
   `nav` / `footer` on each page, or once in the block's `decorate()`:
   derive `/${lang}/nav` from `window.location.pathname` when no row is set.
   The switcher targets each language's home. Per-language chrome documents
   are published content: they belong on each tree's roster.
5. **Runtime hook (project-owned, two lines).** `scripts/scripts.js` stays
   stock except this hook (the allow-list in `../deploy/reference/foundation.md`
   § 3 names it): in `loadEager`, replace the boilerplate's
   `document.documentElement.lang = 'en'` with the metadata row, and add the
   alternates in `buildAutoBlocks()`:

   ```js
   document.documentElement.lang = getMetadata('lang') || 'en';
   // buildAutoBlocks(main):
   document.querySelectorAll('meta[name^="alternate-"]').forEach((m) => { const l = document.createElement('link'); l.rel = 'alternate'; l.hreflang = m.name.slice(10); l.href = m.content; document.head.append(l); });
   ```

   Content side: every page carries a `lang` metadata row; twins carry
   `alternate-<lang>` rows for each sibling tree
   (`../migrate/reference/metadata-and-jsonld.md`); `importer-skeleton.mjs`
   emits the `lang` row.
6. **Indexes and sitemaps per language.** Clone each `helix-query.yaml` index
   with a language-scoped `include` glob and a language-prefixed `target`, and
   fix selectors that encode language (`a[href*="/specialities/"]` is not the
   default tree's selector). `helix-sitemap.yaml`: one `languages` entry per
   tree — `source: /<lang>/query-index.json`, `destination: /<lang>/sitemap.xml`,
   `hreflang: <lang>`, `alternate: /<lang>/{path}`. `metadata.json` defaults
   per folder (`/<lang>/**` → `lang`, `nav`, `footer`). Indexes stay empty
   until the pages publish under the synced config (`operational-learnings.md`).
7. **Gate order for twins.** A locale twin of an archetype that already PASSED
   is gated **360 first, then 1440** — both at the unchanged bars, the usual
   iteration cap per breakpoint (`gate.sh` takes one width per call; nothing
   changes in it). Archetypes keep "1440 first"
   (`../replica/reference/source-fidelity-gate.md`). Twins that pass at 1440
   and fail at 360 are the case this order front-loads.
8. **Path safety and delivery.** The Gate 3 normalisation (`delivery-gates.md`)
   applies to every tree — record slugs recur with a leading hyphen across
   languages. Trees are additional rows on the same ledger and rosters
   (`wave.mjs <wave>-<lang> <roster>`); no literal tree path in project
   scripts — a wired `/es/` in a block is the hard-coded-path failure class.
9. **Verify per tree** on the origin: `<html lang>` and alternates, modal
   headings and video ids in the tree's language, results only from that
   tree, the switcher round-trips (`locale-trees.md` § Verify); `qa` runs with
   language awareness per tree.

## Eval

`evals/rollout-locale-tree/` pins the manifest, the `lang`/`alternate-*` rows,
the per-locale chrome documents, the two-line hook, the 360 → 1440 twin order,
the untouched brand surface after a supplement, and no literal tree paths.
