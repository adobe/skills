# Brand Profile Schema

`stardust/brand-profile.json` is the machine-readable source of truth for all extracted brand tokens. The brand board HTML is rendered from this file.

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

  "_divergence": {
    "toolkit_version": "string — version of _shared/divergence-toolkit.md in effect, e.g. 'v0.1'",
    "seed": {
      "decade": "string|null — from divergence-toolkit.md §2 seed list; null if a strong reference was provided",
      "craft": "string|null — from the same list",
      "register": "string|null — from the same list",
      "ground": "string|null — ground-family pick from divergence-toolkit.md §2: 'cream' | 'stark-white' | 'pale-gray' | 'saturated' | 'dark' | 'monochrome-tint'. Added in v0.5 to mathematically cap cream at ~1/6 of no-reference runs. Deterministic-random from byte[3] of the seed hash mod 6, or designer-picked.",
      "picked_by": "string — 'deterministic-random' | 'designer' | 'mixed' | 'not-applicable'",
      "overrides": ["string — when picked_by='mixed', list the dimensions the designer explicitly set, e.g. ['ground'] means decade/craft/register hashed but ground was manually overridden"],
      "hash_input": "string|null — for deterministic-random, the exact string that was hashed (e.g. 'Nonna\\'s Arsenal|2026-04-23'). Present for audit reproducibility."
    },
    "font_deck": "string|null — name of the deck used from divergence-toolkit.md §3, e.g. 'retro-italian'",
    "palette_source": {
      "method": "string — 'library-pick' | 'extracted-from-source' | 'designer-provided' | 'auto-classified' | 'llm-invented'. 'library-pick' is the default for no-reference runs in v0.6+; 'llm-invented' is a fallback and should be rare.",
      "library_version": "string|null — version of _shared/palettes/ used, e.g. 'v0.6.0'. Only present when method = 'library-pick'.",
      "library_source": "string|null — provenance note, e.g. 'coolors.co/palettes/trending (scraped 2026-04-24)'.",
      "description_used": "string|null — the natural-language palette brief ('freaking bold and shocking', 'clean and superbly engineered'). Either supplied by the designer or synthesized from brand voice + seed.",
      "classification": {
        "energy": "number|null — 1-5, from _shared/palette-picker.md §1 keyword match",
        "contrast": "number|null — 1-5",
        "saturation_level": "number|null — 1-5",
        "hue_bias": "string|null — 'hot'|'warm'|'mustard'|'green'|'teal'|'cool'|'violet'|'neutral'|'rainbow'",
        "ground_family": "string|null — 'cream'|'stark-white'|'pale-gray'|'saturated'|'dark'|'monochrome-tint'"
      },
      "candidates_shown": [
        {
          "index": "number — 1-5",
          "name": "string — palette name from Coolors",
          "source": "string — Coolors share URL",
          "score": "number — filter score from palette-picker.md §2"
        }
      ],
      "recommended_index": "number|null — 1-5, the hash-deterministic default. Null if method != 'library-pick'.",
      "picked_index": "number|null — 1-5, which candidate the designer chose. May equal recommended_index.",
      "picked_palette_name": "string|null — display name of the chosen palette.",
      "picked_palette_source": "string|null — Coolors share URL for the chosen palette; lets a reviewer click through and verify the colors."
    },
    "anti_toolbox_count": "number — how many moves from divergence-toolkit.md §1 are present in this profile; budget is 3",
    "anti_toolbox_hits": [
      "string — specific moves from the toolkit's §1 list that this profile uses, e.g. 'stencil display type', '45° hazard stripes'. Enables audit."
    ],
    "divergence_justifications": [
      {
        "move": "string — the toolkit move (from anti_toolbox_hits) this entry justifies",
        "reason": "string — why this specific brand warrants this move. Required when anti_toolbox_count > 3 OR for every hit if strict enforcement is on."
      }
    ],
    "off_toolbox_moves": [
      "string — moves present in this profile that are NOT in the toolkit §1 list. Positive signal that the profile engaged with divergence."
    ],
    "references_used": [
      {
        "source": "string — URL, image path, or identifier",
        "kind": "string — 'brand-guide' | 'marketing-site' | 'moodboard' | 'image' | 'listicle' | 'conversation'",
        "trends_extracted": ["string — when kind='listicle', every named trend pulled from it"],
        "trend_tags": { "trend_name": "'in-toolbox' | 'off-toolbox'" }
      }
    ],
    "divergence_warning": "boolean — true if profile was generated without any external reference (source: conversation with no anchor set). Downstream skills surface this as a banner."
  },

  "name": "string — brand name",
  "philosophy": "string — mission/positioning statement",

  "logo": {
    "path": "string — relative path to primary logo file. ALWAYS under stardust/assets/, e.g. \"stardust/assets/logo.svg\". Never under icons/ or the project root.",
    "format": "string — one of svg|png|webp|jpg",
    "source": "string — how the logo was obtained: \"inline-svg\" | \"img-tag\" | \"apple-touch-icon\" | \"og-image\" | \"favicon\" | \"pdf-embedded\" | \"synthesized-placeholder\"",
    "variants": [
      {
        "name": "string — e.g. 'white on dark', 'black B&W'",
        "path": "string — relative path under stardust/assets/",
        "usage": "string — when to use this variant"
      }
    ],
    "clearSpace": "string — clear space rule description",
    "donts": ["string — common logo misuse to avoid"]
  },

  "colors": {
    "primary": [
      {
        "name": "string — color name e.g. 'Vitamix Red', 'Pomodoro', 'Oxblood'",
        "hex": "string — #RRGGBB",
        "pantone": "string|null — Pantone code if available",
        "role": "string — MUST be brand-native vocabulary, NOT a generic slot. See 'Role Naming — enforced' section below. Examples: 'Pomodoro' for a tomato brand, 'Grove' for olive oil, 'Ledger' for a bank. Forbidden on new writes: 'Primary', 'Secondary', 'Alarm', 'Warning', 'Shadow', 'Hardware', 'Accent', 'Background' as sole role values.",
        "use": "string|null — optional technical qualifier, e.g. 'CTA fill, tomatoes, alert text'. This field is where 'primary text', 'background', 'CTA' belong — keeping the role field free for brand-native names."
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

## Divergence Tracking — `_divergence` block

The `_divergence` block sits as the second top-level key, right after `_provenance`. It records the constraints the skill applied during generation so the profile can be audited for sameness against the assistant's defaults.

**Required when writing a new profile:**
- `toolkit_version` — the version string from `_shared/divergence-toolkit.md`.
- `anti_toolbox_count` — the count of moves from toolkit §1 present in this profile.
- `anti_toolbox_hits` — explicit list of those moves. Budget is 3; excess moves require matching entries in `divergence_justifications`.
- `references_used` — every reference considered, tagged. Empty array is a valid value only when `source: conversation` is in `_provenance`.

**Required when reference was absent (conversation-only):**
- `seed.decade`, `seed.craft`, `seed.register` — the deterministic-random triple from toolkit §2.
- `seed.hash_input` — the exact string that was hashed. Enables reproducibility.
- `font_deck` — the deck picked from toolkit §3.
- `divergence_warning: true`.

**Optional:**
- `off_toolbox_moves` — moves present that are NOT in toolkit §1. Positive signal of divergence.

### Reader compatibility

Older profiles (pre-`_divergence`) are valid. Readers treat a missing `_divergence` block as equivalent to `{ toolkit_version: "pre-v0.1", anti_toolbox_count: null }`. No downstream skill should hard-fail on its absence.

### `palette_source` sub-block (added in v0.6)

The `_divergence.palette_source` block records where the brand's `colors.primary[]` entries came from. Recommended practice in v0.6+ is `method = "library-pick"` — the brand skill's Phase 2 (Palette Selection) picks a palette from `_shared/palettes/` based on a designer description, and the designer confirms the pick in a visual UI at `stardust/_palette-pick.html`.

Other valid methods:
- `"extracted-from-source"` — palette came from a real brand URL/PDF extracted in Phase 1
- `"designer-provided"` — the designer dropped `stardust/palettes/brand.json` with explicit hex values
- `"auto-classified"` — pipeline-automation fallback where no description was given; classifier ran on synthesized description
- `"llm-invented"` — fallback when the library has no matches. Should be rare and loud; stamp `anti_toolbox_hits` aggressively if it fires.

`candidates_shown`, `recommended_index`, and `picked_index` let a reviewer verify the choice process. The `picked_palette_source` URL provides external verification — a reviewer can open the Coolors link and confirm the colors match.

Backwards compatibility: profiles without a `palette_source` block are valid reads. Only enforced for new writes when Phase 2 has run.

---

## Role Naming — enforced

Color `role` values in `colors.primary[]`, `colors.secondary[]`, and `colors.web[]` MUST be named in the brand's own language. The role field is not a technical slot; technical intent belongs in the new `use` field.

### Forbidden on new writes

The check is **token-level, case-insensitive, whole-word match** — not string-equality. A `role` value is forbidden if any of these tokens appears anywhere in it:

- Primary · Secondary · Tertiary
- Alarm · Warning · Danger
- Shadow · Hardware · Ink
- Accent · Background · Neutral
- Brand · House

All of the following are therefore forbidden on new writes:

- `"Primary"` (bare match)
- `"Primary Red"` (compound — `Primary` is a token)
- `"Brand Blue"` (compound — `Brand` is a token)
- `"Warning Amber"` (compound — `Warning` is a token)
- `"Accent Gold"` (compound — `Accent` is a token)
- `"House Neutral"` (compound — two forbidden tokens)

String-equality was the v0.1 check. It missed compound names like `"Accent Gold"` that smuggle the generic taxonomy in alongside a color name. Token-level closes that loophole.

Technical intent (CTA fill, alarm state, body background) lives in the sibling `use` field, which is explicitly allowed to contain the forbidden tokens:

```json
{ "name": "Bar Beach Teal", "hex": "#0F6B6B", "role": "Bar Beach",
  "use": "primary background, hero fill, CTA fill on saturated scenes" }
```

The color's `name` field may also contain forbidden tokens — a color called "Shadow of Pomodoro" is fine; the `role` field is the one that must be brand-native.

If a new profile emits a forbidden role value, the skill refuses to write and retries with a prompt to rename.

### Accepted

Role names drawn from the brand's subject matter, content pillars, or founder biography. Examples:

- A tomato brand: "Pomodoro", "Grove", "Crate", "Dispatch", "Kitchen counter"
- A horror publisher: "Wormsalt Black", "Oxblood", "Sulphur", "Bone", "Tooth"
- A bank: "Ledger", "Receipt", "Vault", "Drawer", "Coin"
- An astronomy club: "Zenith", "Perigee", "Penumbra", "First light"

### Example — valid entry

```json
{
  "name": "Pomodoro Rosso",
  "hex": "#C13A1D",
  "role": "Pomodoro",
  "use": "accents, CTAs, the tomato itself"
}
```

### Reader compatibility

Existing profiles with generic role names (e.g., `"role": "Primary brand"`) remain valid reads. The rule applies only to new writes and to profiles being refactored. Downstream skills MUST NOT reject old profiles on role-name grounds.

### Why this rule

When roles are named generically, the palette imports the assistant's mental model; only the hex values differ between brands. Brand-native role names force the palette to be reasoned about in the brand's own terms, which makes brands harder to interchange.

---

## Notes for Implementation

- All fields are optional except `name` and `colors.primary` — brands vary in what they document.
- The brand skill should extract what's available and leave missing fields as `null`.
- The brand board template renders whatever fields are present and omits sections for missing data.
- Voice examples are critical for copy generation — extract as many as possible.
- Photography style feeds into `ai-image-generator` style prefixes.
- **`_provenance` is the first key** in every emitted `brand-profile.json`. Contract-compliant readers (downstream skills + evals) look for it at the top.
- **`_divergence` is the second key.** See the Divergence Tracking section above.
- **`synthesized_inputs` must enumerate every field the skill filled in but did not extract.** "The LLM wrote it based on vibes from the page" counts as synthesized. Use this list so the user can tell what to trust vs. what to revise.
- **Role names must be brand-native on new writes** (see Role Naming section above). Old profiles are read as-is.
