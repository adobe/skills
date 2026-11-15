# AEM Edge Delivery Services

Skills for developing sites on AEM Edge Delivery Services: blocks, content modeling, local development with the AEM CLI, and importing existing pages.

```bash
/plugin install aem-edge-delivery-services@adobe-skills
```

## Developing with Edge Delivery Services

| Skill | Description |
|-------|-------------|
| `aem-cli` | Install, run, and configure the Adobe AEM CLI (`aem up` local dev server, `.env`/TLS/proxy setup, `aem import`, `aem content` da.live sync, troubleshooting); migrate from `@adobe/helix-cli` |
| `create-site` | Start a brand-new site from scratch: GitHub repo from boilerplate, aem-code-sync, initial DA content (nav, footer, homepage), and live URL handoff |
| `content-driven-development` | Orchestrates the CDD workflow for all code changes |
| `analyze-and-plan` | Analyze requirements and define acceptance criteria |
| `building-blocks` | Implement blocks and core functionality |
| `testing-blocks` | Browser testing and validation |
| `content-modeling` | Design author-friendly content models |
| `code-review` | Self-review and PR review |

## Discovering Blocks

| Skill                          | Description                                             |
| ------------------------------ | ------------------------------------------------------- |
| `block-collection-and-party` | Search reference implementations                        |
| `find-test-content`          | Find existing content for testing                       |

## Migrating Content

| Skill | Description |
|-------|-------------|
| `page-import` | Import webpages into canonical EDS block format (orchestrator) |
| `migrate-header` | Rebuild a site's header as the EDS header block, 1:1 with the source: captures its states with the `web` CLI (`web header capture`), configures a header template and its nav document, then checks it against the live source (`web header check`) closed, with every menu open, on mobile and while scrolling |
| `scrape-webpage` | Scrape and analyze webpage content |
| `identify-page-structure` | Analyze page sections |
| `page-decomposition` | Analyze content sequences |
| `authoring-analysis` | Determine authoring approach |
| `generate-import-html` | Generate structured HTML |
| `preview-import` | Preview imported content |
| `snowflake` | Static-to-EDS overlay conversion — preserves original DOM byte-for-byte (alternative path to `page-import` for AI-generated/static pages) |
| `figma-to-content` | Turn a Figma design into an EDS content page in DA — resolves each section to an existing block, a new isolated block, or default content (annotation-first, else inferred), then deploys via the DA Source API |

## Content & Platform Reference

| Skill | Description |
|-------|-------------|
| `da-content` | Reference for DA + EDS content rules: block HTML format, metadata, media handling, DA Source API contract, and silent-failure rules |

Also in this plugin: `brand-setup`, `da-auth`, `slicc-handoff`, `ue-component-model`.

The folders under [`skills/`](skills/) are the complete list of skills.
