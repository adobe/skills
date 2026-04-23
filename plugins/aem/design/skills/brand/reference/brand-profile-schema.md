# Brand Profile Schema

`aem-design/brand-profile.json` is the machine-readable source of truth for all extracted brand tokens. The brand board HTML is rendered from this file.

## Schema

```json
{
  "name": "string — brand name",
  "philosophy": "string — mission/positioning statement",

  "logo": {
    "primary": "string — path to primary logo SVG in icons/",
    "variants": [
      {
        "name": "string — e.g. 'white on dark', 'black B&W'",
        "path": "string — path to variant file",
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
  },

  "extraction": {
    "method": "string — e.g. 'Playwright (Chromium, 1440×900, 2x DPR) — computed styles + fullpage screenshot'",
    "source": "string — URL or file path",
    "capturedAt": "string — ISO date",
    "screenshots": ["string — paths to screenshot files"]
  }
}
```

## Notes for Implementation

- All fields are optional except `name` and `colors.primary` — brands vary in what they document.
- The brand skill should extract what's available and leave missing fields as `null`.
- The brand board template renders whatever fields are present and omits sections for missing data.
- Voice examples are critical for copy generation — extract as many as possible.
- Photography style feeds into `ai-image-generator` style prefixes.
