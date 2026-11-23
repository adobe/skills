# AEM Project Management

Handover documentation and PDF guides generation for AEM Edge Delivery Services projects. Available via the `aem-project-management` plugin.

```bash
/plugin install aem-project-management@adobe-skills
```

The plugin's hooks keep generated PDFs in step with their Markdown. They are plugin hooks, which not every client runs; without them the skills still load.

| Skill           | Description                                                |
| --------------- | ---------------------------------------------------------- |
| `handover`    | Orchestrates project documentation generation              |
| `handover-author` | Generate comprehensive authoring guide for content authors |
| `handover-developer` | Generate technical documentation for developers         |
| `handover-admin` | Generate admin guide for site administrators               |
| `whitepaper`  | Create professional PDF whitepapers from Markdown          |
| `auth`        | Authenticate with AEM Config Service API                   |

Also in this plugin: `ops`.

The folders under [`skills/`](skills/) are the complete list of skills.
