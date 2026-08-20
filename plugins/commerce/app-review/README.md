# commerce-app-review

A Claude Code skill for system integrators, developers, and partners to self-review an Adobe Commerce App Builder app against the submission guidelines before submitting to Adobe Exchange.

This plugin is **public** and published to [adobe/skills](https://github.com/adobe/skills) for use by anyone building Commerce extensions.

> **Note:** This skill is a self-service tool to catch common issues early — it may miss some findings or flag things that don't apply to your specific app. The Adobe Commerce team will do a full review when you submit to Adobe Exchange.

## Requirements

| Tool | Install (macOS) | Purpose |
|---|---|---|
| `aio` | `npm install -g @adobe/aio-cli` | IMS token for documentation-grounded enrichment |

`aio` must be authenticated (`aio login`) for the skill to fetch live context from the Adobe Commerce documentation index. The skill can run without it but will warn and ask whether to continue with fallback enrichment.

Run `commerce-app-review` from your app's root directory. For a full walkthrough, see [USAGE.md](USAGE.md).

## Reference library

The skill ships with a curated reference library under `skills/commerce-app-review/references/`:

- **`patterns/`** — team-validated implementation rules (e.g. how CORS must be configured for storefront-facing actions). When a pattern applies, the finding links to it directly.
- **`exceptions/`** — documented cases where a guideline may legitimately be relaxed (e.g. when `require-adobe-auth: false` is acceptable). The skill checks exceptions before flagging a finding to avoid false positives.
- **`finding.md`** — the output template the skill fills in for each enriched finding (context, remediation, proposed fix, references). Edit this to change how findings are formatted.

Both patterns and exceptions take precedence over the upstream submission guidelines when they conflict. To add a new pattern or exception, copy the template from `references/templates/` and place it in the appropriate directory.
