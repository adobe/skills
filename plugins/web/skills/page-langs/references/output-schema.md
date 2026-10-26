# page-langs Output Schema

## langs.json

```jsonc
{
  "url": "https://example.com/page",    // canonical URL as seen by the browser
  "wordCount": 1234,                     // words in visible body text (CLD3 input)
  "detected": [                          // CLD3 per-block results, top 5 by proportion
    {
      "language": "en",                  // ISO 639-1 code (CLD3 output)
      "probability": 0.98,               // byte-weighted mean confidence [0, 1]
      "is_reliable": true,               // CLD3 reliability flag
      "proportion": 0.62                 // share of classified text bytes in this language
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
- `detected`: empty array `[]` when no text block of 50+ bytes is reliably classified.

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
