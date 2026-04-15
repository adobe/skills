# Adobe Skills for AI Coding Agents

Repository of Adobe skills for AI coding agents. Test

## Installation

### Claude Code Plugins

```bash
/plugin marketplace add adobe/skills
/plugin install aem-edge-delivery-services@adobe-skills
/plugin install aem-project-management@adobe-skills
```

### Vercel Skills (npx skills)

```bash
npx skills add adobe/skills --all
```

### upskill (GitHub CLI Extension)

```bash
gh extension install ai-ecoverse/gh-upskill
gh upskill adobe/skills --all
```

## Available Skills

### For Business

#### Adobe Experience Manager

##### Developing with Edge Delivery Services

| Skill | Description |
|-------|-------------|
| `content-driven-development` | Orchestrates the CDD workflow for all code changes |
| `analyze-and-plan` | Analyze requirements and define acceptance criteria |
| `building-blocks` | Implement blocks and core functionality |
| `testing-blocks` | Browser testing and validation |
| `content-modeling` | Design author-friendly content models |
| `code-review` | Self-review and PR review |

##### Discovering Blocks

| Skill | Description |
|-------|-------------|
| `block-inventory` | Survey available blocks in project and Block Collection |
| `block-collection-and-party` | Search reference implementations |
| `docs-search` | Search aem.live documentation |
| `find-test-content` | Find existing content for testing |

##### Migrating Content

| Skill | Description |
|-------|-------------|
| `page-import` | Import webpages (orchestrator) |
| `scrape-webpage` | Scrape and analyze webpage content |
| `identify-page-structure` | Analyze page sections |
| `page-decomposition` | Analyze content sequences |
| `authoring-analysis` | Determine authoring approach |
| `generate-import-html` | Generate structured HTML |
| `preview-import` | Preview imported content |

##### Managing Projects

Handover documentation and PDF generation for AEM Edge Delivery Services projects.

| Skill | Description |
|-------|-------------|
| `handover` | Orchestrates project documentation generation |
| `authoring` | Generate comprehensive authoring guide for content authors |
| `development` | Generate technical documentation for developers |
| `admin` | Generate admin guide for site administrators |
| `whitepaper` | Create professional PDF whitepapers from Markdown |
| `auth` | Authenticate with AEM Config Service API |

### Creativity & Design

_Coming soon._

## Repository Structure

```
skills/
└── aem/
    ├── edge-delivery-services/
    │   ├── .claude-plugin/
    │   └── skills/
    └── project-management/
        ├── .claude-plugin/
        └── skills/
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding or updating skills. Join [#agentskills](https://adobe.enterprise.slack.com/archives/C0APTKDNPEY) on Adobe Slack for questions and discussion.

## Resources

- [agentskills.io Specification](https://agentskills.io)
- [Claude Code Plugins](https://code.claude.com/docs/en/discover-plugins)
- [Vercel Skills](https://github.com/vercel-labs/skills)
- [upskill GitHub Extension](https://github.com/trieloff/gh-upskill)
- [#agentskills Slack Channel](https://adobe.enterprise.slack.com/archives/C0APTKDNPEY)

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.
