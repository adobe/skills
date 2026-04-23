# Brand Profile Schema

`aem-design/brand-profile.json` is the machine-readable source of truth for all extracted brand tokens. The brand board HTML is rendered from this file.

## Schema

```json
{
  "_provenance": {
    "generated_by": "string — always \"brand\"",
    "date": "string — ISO date YYYY-MM-DD",
    "source": "string — URL, PDF path, or \"conversation\" when no guidelines were provided",
    "extraction_method": "string — e.g. \"Playwright (Chromium, 1440x900 @ 2x DPR, networkidle + 1.5s settle)\" or \"PDF read\" or \"conversation only\"",
    "synthesized_inputs": [
      "string — one entry per field the skill FILLED IN rather than extracted. e.g. \"personas (mottos, values) — composed from extracted voice signals, not read from the page\", \"contentPillars descriptions — inferred from nav + hero copy\". Empty array only if every field was directly extracted from source."
    ],
    "screenshots": ["string — paths to scratch screenshots"],
    "note": "string — optional caveats"
  },

  "name": "string — brand name",
  "philosophy": "string — mission/positioning statement",

  "logo": {
    "path": "string — relative path to primary logo file. ALWAYS under aem-design/assets/, e.g. \"aem-design/assets/logo.svg\". Never under icons/ or the project root.",
    "format": "string — one of svg|png|webp|jpg",
    "source": "string — how the logo was obtained: \"inline-svg\" | \"img-tag\" | \"apple-touch-icon\" | \"og-image\" | \"favicon\" | \"pdf-embedded\" | \"synthesized-placeholder\"",
    "variants": [
      {
        "name": "string — e.g. 'white on dark', 'black B&W'",
        "path": "string — relative path under aem-design/assets/",
        "usage": "string — when to use this variant"
      }
    ],
    "clearSpace": "string — clear space rule description",
    "donts": ["string — common logo misuse to avoid"]
  },

  "colors": {
    "primary": [
      {
        "name": "string — color name e.g. 'Vitamix Red'",
        "hex": "string — #RRGGBB",
        "pantone": "string|null — Pantone code if available",
        "role": "string — e.g. 'Primary brand', 'Accent', 'Background'"
      }
    ],
    "secondary": [
      { "name": "string", "hex": "string", "role": "string" }
    ],
    "web": [
      { "name": "string", "hex": "string", "role": "string — e.g. 'Links', 'Offer text'" }
    ],
    "gradients": [
      {
        "name": "string — e.g. 'Aurora'",
        "stops": ["string — color descriptions or hex"],
        "usage": "string — where and when to apply"
      }
    ]
  },

  "componentStyle": {
    "borderRadius": {
      "default": "string — e.g. '10px'. The brand's signature corner — often a non-round value",
      "usage": "string — why this specific value"
    },
    "maxWidth": "string — e.g. '1280px'",
    "pagePadding": "string — e.g. '32px'",
    "navbarHeight": "string — e.g. '64px'",
    "buttons": {
      "patterns": [
        {
          "name": "string — e.g. 'Primary (inked)', 'Primary (branded)', 'Inverted'",
          "style": "string — exact bg/text/radius/padding recipe",
          "example": "string — label text"
        }
      ],
      "dualCTA": "string|null — whether the brand shows multiple primary CTAs side-by-side (e.g. Mac + Windows)"
    }
  },

  "motifs": [
    {
      "name": "string — e.g. 'Dashed cream divider', 'Aurora haze', 'Wavy squiggle', 'Noise texture'",
      "description": "string — what it looks like and what it evokes",
      "usage": "string — where to place it, where NOT to"
    }
  ],

  "typography": {
    "heading": {
      "family": "string — font family name",
      "weights": ["string — e.g. 'Book', 'Medium', 'Bold'"],
      "lineHeight": "number|null — e.g. 0.93. Capture verbatim if the brand runs display tight",
      "letterSpacing": "string|null — e.g. '-0.04em'. Capture verbatim for display type",
      "usage": "string — when to use"
    },
    "subheading": {
      "family": "string",
      "weight": "string",
      "usage": "string"
    },
    "body": {
      "family": "string",
      "weight": "string",
      "opacity": "number|null — e.g. 0.65. Many brands soften body ink below full opacity; record if true",
      "usage": "string"
    },
    "accent": {
      "family": "string — italic serif or other display accent used on single words within sans headlines",
      "weight": "string",
      "usage": "string — which contexts and at what dose ('one word per headline max')"
    },
    "eyebrow": {
      "family": "string",
      "weight": "string",
      "transform": "string — e.g. 'uppercase'",
      "usage": "string"
    },
    "button": {
      "family": "string",
      "weight": "string",
      "usage": "string"
    },
    "rules": ["string — specific typographic rules e.g. 'Dollar signs half-size + top-aligned'"]
  },

  "photography": {
    "style": "string — overall photographic direction",
    "rules": ["string — composition/lighting/subject rules"],
    "donts": ["string — what to avoid"],
    "social": "string — social media specific guidance"
  },

  "voice": {
    "character": "string — voice character summary",
    "traits": ["string — personality traits e.g. 'Sophisticated', 'Informed'"],
    "antiTraits": ["string — what voice is NOT e.g. 'Stuffy', 'Arrogant'"],
    "examples": {
      "do": [
        { "text": "string — good copy example", "context": "string — why it works" }
      ],
      "dont": [
        { "text": "string — bad copy example", "context": "string — why it fails" }
      ]
    },
    "rules": ["string — hard rules e.g. 'NO excessive exclamation marks'"]
  },

  "tone": {
    "description": "string — how tone adapts by context",
    "writingGoals": [
      {
        "goal": "string — e.g. 'To Educate'",
        "description": "string — how this goal manifests in copy"
      }
    ],
    "cleverVsClear": {
      "clever": "string — when to be witty",
      "clear": "string — when to be direct"
    }
  },

  "contentPillars": [
    {
      "name": "string — pillar name e.g. 'Recipes'",
      "description": "string — what this pillar covers"
    }
  ],

  "personas": [
    {
      "name": "string — persona name e.g. 'The Essentialist'",
      "description": "string — who they are",
      "values": ["string"],
      "motto": "string — representative quote",
      "stats": [
        { "value": "string — e.g. '46%'", "description": "string" }
      ]
    }
  ],

  "spacing": {
    "scale": [
      { "name": "string — e.g. 'XS'", "value": "string — e.g. '8px'" }
    ],
    "borderRadius": [
      { "name": "string", "value": "string" }
    ]
  }
}
```

## Notes for Implementation

- All fields are optional except `name` and `colors.primary` — brands vary in what they document.
- The brand skill should extract what's available and leave missing fields as `null`.
- The brand board template renders whatever fields are present and omits sections for missing data.
- Voice examples are critical for copy generation — extract as many as possible.
- Photography style feeds into `ai-image-generator` style prefixes.
- **`_provenance` is the first key** in every emitted `brand-profile.json`. Contract-compliant readers (downstream skills + evals) look for it at the top.
- **`synthesized_inputs` must enumerate every field the skill filled in but did not extract.** "The LLM wrote it based on vibes from the page" counts as synthesized. Use this list so the user can tell what to trust vs. what to revise.
