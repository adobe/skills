# Adobe Skills for AI Coding Agents

Repository of Adobe skills for AI coding agents.

## Installation

### Claude Code Plugins

```bash
# Add the Adobe Skills marketplace
/plugin marketplace add adobe/skills

# Install AEM Edge Delivery Services plugin (all 17 skills)
/plugin install aem-edge-delivery-services@adobe-skills
```

### Vercel Skills (npx skills)

```bash
# Install all AEM Edge Delivery Services skills
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/edge-delivery-services --all

# Install specific skill(s)
npx skills add adobe/skills -s content-driven-development
npx skills add adobe/skills -s content-driven-development building-blocks testing-blocks

# Install all Adobe skills (all products)
npx skills add adobe/skills --all

# List available skills
npx skills add adobe/skills --list
```

### upskill (GitHub CLI Extension)

```bash
gh extension install trieloff/gh-upskill

# Install all skills from this repo
gh upskill adobe/skills

# Install only AEM Edge Delivery Services skills
gh upskill adobe/skills --path skills/aem/edge-delivery-services --all

# Install a specific skill
gh upskill adobe/skills --path skills/aem/edge-delivery-services --skill content-driven-development

# List available skills in a subfolder
gh upskill adobe/skills --path skills/aem/edge-delivery-services --list
```

## Available Skills

### AEM Edge Delivery Services

#### Core Development

| Skill | Description |
|-------|-------------|
| `content-driven-development` | Orchestrates the CDD workflow for all code changes |
| `analyze-and-plan` | Analyze requirements and define acceptance criteria |
| `building-blocks` | Implement blocks and core functionality |
| `testing-blocks` | Browser testing and validation |
| `content-modeling` | Design author-friendly content models |
| `code-review` | Self-review and PR review |

#### Discovery

| Skill | Description |
|-------|-------------|
| `block-inventory` | Survey available blocks in project and Block Collection |
| `block-collection-and-party` | Search reference implementations |
| `docs-search` | Search aem.live documentation |
| `find-test-content` | Find existing content for testing |

#### Migration

| Skill | Description |
|-------|-------------|
| `page-import` | Import webpages (orchestrator) |
| `scrape-webpage` | Scrape and analyze webpage content |
| `identify-page-structure` | Analyze page sections |
| `page-decomposition` | Analyze content sequences |
| `authoring-analysis` | Determine authoring approach |
| `generate-import-html` | Generate structured HTML |
| `preview-import` | Preview imported content |

## Repository Structure

```
skills/
└── aem/
    └── edge-delivery-services/
        ├── .claude-plugin/
        │   └── plugin.json
        └── skills/
            ├── content-driven-development/
            ├── building-blocks/
            └── ...
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding or updating skills.

## Resources

- [agentskills.io Specification](https://agentskills.io)
- [Claude Code Plugins](https://code.claude.com/docs/en/discover-plugins)
- [Vercel Skills](https://github.com/vercel-labs/skills)
- [upskill GitHub Extension](https://github.com/trieloff/gh-upskill)

## License

Apache 2.0 - see [LICENSE](LICENSE) for details.
