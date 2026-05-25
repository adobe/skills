# trait-matrix.json schema

Structured per-sample + cross-sample trait data produced by
`stardust:distill` Phase 4. Direct reads this alongside SAMPLES.md;
the JSON is for programmatic consumption (palette swaps, token-name
generation, deterministic seed rolls under Mode B), the markdown is
for the narrative + the user.

## Top-level shape

```json
{
  "_provenance": {
    "writtenBy": "stardust:distill",
    "writtenAt": "<ISO-8601>",
    "readArtifacts": ["samples/static/<slug>/<entry-html>", "samples/live/snapshots/<slug>.html"],
    "consumedBy": "stardust:direct — Phase 2 anchor resolution + Phase 4 token + componentStyle authoring"
  },
  "samples": [ /* per-sample blocks, see below */ ],
  "sharedTokens": { /* aggregated tokens that recur in ≥ ceil(N/2) samples */ },
  "divergentTraits": [ /* traits direct may amplify in B/C/... variants */ ]
}
```

## Per-sample block (`samples[]`)

One entry per sample in the inventory. Schema:

```json
{
  "slug": "<kebab-case slug>",
  "kind": "static" | "live",
  "url": "<URL — live only>",
  "role": "<role-name from inventory; e.g., business, pricing, consumer-creative>",
  "type": {
    "headingFamily": "<font-family-name>",
    "headingWeights": [<weight-int>, ...],
    "bodyFamily": "<font-family-name>",
    "bodyWeights": [<weight-int>, ...],
    "labelWeight": <weight-int>,
    "scale": {
      "title-1": { "size": <px>, "lineHeight": <px>, "tracking": <px>, "fluidMin"?: <px>, "fluidVw"?: <number> },
      "title-2": { ... },
      "...": "...",
      "body-lg": { "size": <px>, "lineHeight": <px> },
      "body-md": { ... },
      "body-sm": { ... },
      "eyebrow": { "size": <px>, "lineHeight": <px>, "weight": <weight-int> },
      "label":   { "size": <px>, "lineHeight": <px>, "weight": <weight-int> }
    },
    "rules": ["<short rule-line>", ...]
  },
  "color": {
    "grayScale": ["#<hex>", ...],
    "brand": { "<role>": "#<hex>" },
    "surfaces": { "default": "#<hex>", "subtle": "#<hex>", "darkSection": "#<hex>", "contentDefault": "#<hex>", "contentSubtle": "rgba(...)" },
    "reservations": [{ "color": "#<hex>" | "<gradient-fn>", "reservedFor": ["<context>", ...] }],
    "rules": ["<short rule-line>", ...]
  },
  "spacing": {
    "base": <px>,
    "scale": { "2xs": <px>, "xs": <px>, "sm": <px>, ... },
    "layout": { "sm": <px>, "lg": <px> },
    "sectionPadding": { "primary": <px>, "secondary": <px>, "footer": <px> },
    "densityTier": "compact" | "balanced" | "packed",
    "grid": {
      "cols": { "mobile": <int>, "desktop": <int> },
      "outerPad": { "mobile": "<css-len>", "desktop": "<css-len>" },
      "gutter": "<css-len>",
      "maxContentWidth": <px>
    }
  },
  "radius": { "sm": <px>, "md": <px>, "lg": <px>, "pill": <px> },
  "shadow": ["<box-shadow-value>", ...],
  "easing": { "default": "<cubic-bezier()>", "entrance": "<cubic-bezier()>" },
  "duration": { "fast": <ms>, "base": <ms>, "entrance": <ms>, "expand": <ms> },
  "motion": {
    "libraries": [{ "name": "<lib-name>", "version"?: "<x.y.z>", "role": "<purpose>" }],
    "cssOnlyPatterns": ["<pattern-string>", ...],
    "choreographies": [
      {
        "name": "<kebab-case name>",
        "surface": "<section/component>",
        "mechanism": "CSS-only" | "rAF" | "library:<name>",
        "capturedFromSlug": "<sample-slug>"
      }
    ]
  },
  "componentPatterns": [
    {
      "kind": "<kebab-case>",
      "shape": "<3-5 sentence brief>",
      "instanceCount": <int>,
      "examples": ["<3-15 line markup snippet>", ...]
    }
  ],
  "voice": {
    "heroHeadline": "<verbatim>",
    "firstBodyParagraph": "<verbatim>",
    "ctas": ["<label>", ...],
    "navLabels": ["<label>", ...],
    "footerLine": "<verbatim>"
  },
  "assets": {
    "fonts": [{ "family": "<name>", "format": "<woff2|otf|ttf>", "src": "<URL or local path>", "weights": [<int>, ...], "licenseFlag"?: "<note>" }],
    "imageRatio": { "photography": <0..1>, "illustration": <0..1>, "svg": <0..1> },
    "motifs": ["<signature-motif>", ...]
  }
}
```

## sharedTokens block

Tokens that recur in ≥ `ceil(N/2)` samples (after near-duplicate
clustering for colors via the CIE76 ΔE method). Schema matches the
per-sample blocks above, but only the recurring values appear.
Direct picks this up as the default DESIGN.json frontmatter when
Mode B is active.

## divergentTraits block

Traits that did NOT reach majority. Each entry:

```json
{
  "trait": "<kebab-case name>",
  "strongestSlug": "<sample-slug>",
  "amplificationCandidateFor": "B" | "C" | "D+",
  "perSampleBreakdown": [
    { "slug": "<slug>", "value": "<observed-value>", "strength": <0..1> }
  ],
  "risk": "<short note: motion fatigue, layout-shift propagation, attention saturation, etc.>"
}
```

Direct reads `amplificationCandidateFor` when resolving the multi-variant
fork — picks the B-candidate trait for variant B, the C-candidate for
variant C, and so on. If two traits share a candidate slot, the one
with higher `strength` wins; the other becomes a D+ candidate (the
user can promote it via `direct --add-variant`).

## Aggregation rules (Phase 4)

- **Numeric tokens** (sizes, padding, weights): mode across samples;
  if no mode, median; report the spread in `divergentTraits` if
  the mode covers < 60% of samples.
- **Color tokens**: cluster near-duplicates within ΔE < 5 (CIE76);
  pick the mode of the cluster. Report off-cluster colors in
  `divergentTraits`.
- **Library tokens**: union (any library loaded by ≥ 1 sample
  appears in `sharedTokens.motion.libraries`). Motion is opt-in,
  not majority-rule.
- **Component patterns**: pattern enters `sharedTokens.componentPatterns`
  if its `kind` matches across ≥ `ceil(N/2)` samples. Pattern
  enters `divergentTraits` if it appears in only some samples and
  its absence in the others is meaningful (heuristic: pattern
  category is shared but instance count differs by ≥ 3×).
- **Voice**: never aggregated. Voice is per-sample only —
  averaging erases register signal.

## Backward compatibility

`trait-matrix.json` schema is versioned implicitly by the
`_provenance.writtenBy` string carrying the stardust version. Future
schema changes carry their version; consumers (direct) check the
version before reading.
