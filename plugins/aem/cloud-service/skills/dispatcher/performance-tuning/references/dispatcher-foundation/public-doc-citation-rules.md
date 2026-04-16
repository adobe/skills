# Public Doc Citation Rules

Use these rules for all Cloud dispatcher advisory responses.

## Allowed Sources

- Use links listed in `public-docs-index.md`.
- Use only Experience League references (cloud mode docs + common Dispatcher docs).
- Do not cite sources unavailable to external readers in public skill guidance.

## Citation Requirements

For non-trivial recommendations, include:

1. at least one common Dispatcher source
2. at least one cloud-specific source when behavior differs by mode

## Topic-To-Citation Minimums

Use these minimum citation sets for precision and consistency:

- Filter ordering / allow-deny conflicts:
  - Dispatcher content filter docs
  - Dispatcher security checklist
- `statfileslevel` / invalidation scope:
  - Dispatcher invalidation by folder level docs
  - Dispatcher cache flush/invalidation docs
- URL decomposition / selector-suffix logic:
  - Dispatcher content filter docs
  - Cloud validation/debug docs when recommendation depends on include/file layout constraints
- Rewrite behavior / redirects:
  - Dispatcher configuration docs
  - Cloud Dispatcher overview or pipeline-free redirect docs (pick claim-aligned source)
- Cache headers / TTL strategy:
  - Dispatcher caching docs
  - AEMaaCS caching docs
- Cloud immutable/include/validator compatibility:
  - AEMaaCS validation/debug docs
  - Cloud Dispatcher overview docs
- CDN vs Dispatcher ownership decisions:
  - AEMaaCS CDN docs
  - Cloud Dispatcher overview docs

## Citation Format

Use a compact list:

- `Title` - URL - one-line relevance note

## Claim Discipline

- Distinguish observed MCP evidence from documentation guidance.
- If docs and runtime evidence conflict, state the conflict and prioritize executed evidence for environment-specific conclusions.
- For version-sensitive claims, include release-notes citation when available.

## Prohibited Patterns

- Unsupported claims without citations.
- Ambiguous mixed-mode guidance without mode labels.
- Copying large verbatim excerpts from external docs.
