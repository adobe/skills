# page-langs Output Schema

## langs.json

```jsonc
{
  "url": "https://example.com/page",    // canonical URL as seen by the browser
  "wordCount": 1234,                     // words in visible body text (CLD3 input)
  "detected": [                          // CLD3 results, sorted by proportion desc
    {
      "language": "en",                  // ISO 639-1 code (CLD3 output)
      "probability": 0.98,               // model confidence [0, 1]
      "is_reliable": true,               // CLD3 reliability flag
      "proportion": 0.62                 // fraction of body bytes in this language
    }
  ],
  "declared": {
    "htmlLang": "en",                    // document.documentElement.getAttribute('lang')
    "nestedLangs": [                     // [lang] on non-root elements, deduped
      { "lang": "fr", "count": 3 }
    ],
    "hreflang": [                        // <link rel="alternate" hreflang="...">
      { "hreflang": "fr", "href": "https://example.com/fr/" },
      { "hreflang": "x-default", "href": "https://example.com/" }
    ],
    "metaContentLanguage": "en"          // meta http-equiv or name="language"
  },
  "reconciliation": {
    "agreement":           ["en"],       // declared AND detected (reliable)
    "declaredNotDetected": [],           // declared but absent from body text
    "detectedNotDeclared": ["de"]        // detected but not declared — flag this
  }
}
```

## Null values

- `htmlLang`: `null` if the root element has no `lang` attribute.
- `metaContentLanguage`: `null` if neither `http-equiv` nor `name="language"` meta exists.
- `nestedLangs` / `hreflang`: empty arrays `[]` when none found.
- `detected`: empty array `[]` when CLD3 returns `und` (text too short or undetermined).

## Language-code formats

CLD3 emits ~ISO 639-1 two-letter codes (`en`, `fr`, `zh`, `ja`, `de`). A small set of
languages use three-letter codes where no two-letter code exists.

Structural signals (`htmlLang`, hreflang, metaContentLanguage) are BCP-47 and may include
region subtags (`en-US`), script subtags (`zh-Hant`), or the special value `x-default`.

**Reconciliation normalisation:** comparison is on the lowercased primary subtag only:
- `en-US` → `en`
- `zh-Hant` → `zh`
- `x-default` → excluded (not a real language)
- `und` → excluded

Raw values are always preserved in the `declared` object.

## cld3-asm dependency

`cld3-asm` 4.0.0 is the WASM port of Google CLD3:
- MIT licence
- ~6.6 MB unpacked; WASM model is inlined into the JS glue — no runtime download
- No native build required (emscripten WASM, not node-gyp)
- Ships CJS + ESM; the ESM import path is resolved automatically by Node 22
- API: `loadModule()` → factory; `factory.create(minBytes, maxBytes)` → identifier;
  `identifier.findMostFrequentLanguages(text, n)` → results; `identifier.dispose()` — required

page-langs is the first skill in this plugin with a runtime npm dependency. The model is
loaded from the local `node_modules/` directory. If the plugin distribution pipeline does
not run `npm install` per skill, the WASM glue (~5 MB) can be vendored into the `scripts/`
directory and imported via a relative path — remove the npm dep and update the dynamic
import in `page-langs.mjs` accordingly.
