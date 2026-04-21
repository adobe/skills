# Adobe Skills for AI Coding Agents

Repository of Adobe skills for AI coding agents.

## Installation

### Claude Code Plugins

```bash
/plugin marketplace add adobe/skills
/plugin install aem-edge-delivery-services@adobe-skills
/plugin install aem-project-management@adobe-skills
/plugin install app-builder@adobe-skills
/plugin install aem-cloud-service@adobe-skills
/plugin install aem-6-5-lts@adobe-skills
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
| `create-site` | Start a brand-new site from scratch: GitHub repo from boilerplate, aem-code-sync, initial DA content (nav, footer, homepage), and live URL handoff |
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

### AEM as a Cloud Service — Create Component

The `create-component` skill creates complete AEM components following Adobe best practices for AEM Cloud Service and AEM 6.5. It covers:

- Component definition, dialog XML, and HTL template
- Sling Model and optional child item model (multifield)
- Unit tests for models and servlets
- Clientlibs (component and dialog)
- Optional Sling Servlet for dynamic content

See `plugins/aem/cloud-service/skills/create-component/` for the skill and its reference files.

### AEM as a Cloud Service — Ensure AGENTS.md (bootstrap)

The `ensure-agents-md` skill is a **bootstrap skill** that runs first, before any other work. When a
customer opens their AEM Cloud Service project and asks the agent anything, this skill checks whether
`AGENTS.md` exists at the repo root. If missing, it:

- Reads root `pom.xml` to resolve the project name and discover actual modules
- Detects add-ons (CIF, Forms, SPA type, precompiled scripts)
- Generates a tailored `AGENTS.md` with only the modules that exist, correct frontend variant, conditional
  Dispatcher MCP section, and the right resource links
- Creates `CLAUDE.md` (`@AGENTS.md`) so Claude-based tools also discover the guidance

If `AGENTS.md` already exists it is never overwritten.

See `plugins/aem/cloud-service/skills/ensure-agents-md/` for the skill, template, and module catalog.

### AEM Workflow

Workflow skills cover the full AEM Granite Workflow Engine lifecycle — from designing and implementing workflows to production debugging and incident triaging. Like Dispatcher, they are split by runtime flavor:

- `plugins/aem/cloud-service/skills/aem-workflow` — Cloud Service variant (no JMX, Cloud Manager logs, pipeline deploy)
- `plugins/aem/6.5-lts/skills/aem-workflow` — 6.5 LTS / AMS variant (JMX, Felix Console, direct log access)

Each flavor contains the same specialist sub-skills:

| Sub-Skill | Purpose |
|---|---|
| `workflow-model-design` | Design workflow models, step types, OR/AND splits, variables |
| `workflow-development` | Implement WorkflowProcess steps, ParticipantStepChooser, OSGi services |
| `workflow-triggering` | Start workflows from UI, code, HTTP API, or Manage Publication |
| `workflow-launchers` | Configure automatic workflow launchers on JCR events |
| `workflow-debugging` | Debug stuck, failed, or stale workflows in production |
| `workflow-triaging` | Classify incidents, determine log patterns, Splunk queries |
| `workflow-orchestrator` | Full lifecycle orchestration across all sub-skills |

### AEM Dispatcher

Dispatcher skills are split by runtime flavor to avoid mode auto-detection and keep installation explicit.
Install only one dispatcher flavor in a workspace (`cloud-service` or `6.5-lts`).

Current dispatcher flavors:
- `plugins/aem/cloud-service/skills/dispatcher`
- `plugins/aem/6.5-lts/skills/dispatcher`

Each flavor contains parallel capability groups (workflow orchestration, config authoring, technical advisory, incident response, performance tuning, and security hardening).
Shared advisory logic is centralized under each flavor's `dispatcher/shared/references/` to reduce duplication and drift.

### AEM Replication

Replication skills for AEM 6.5 LTS cover the full content distribution lifecycle from agent configuration to troubleshooting.

**Location:** `plugins/aem/6.5-lts/skills/aem-replication`

The aem-replication skill contains four specialist sub-skills:

| Sub-Skill | Purpose |
|---|---|
| `configure-replication-agent` | Configure replication agents for publishing, dispatcher flush, and reverse replication |
| `replicate-content` | Activate and deactivate content using UI, workflows, and package manager |
| `replication-api` | Use the Replication API programmatically in custom code with complete Java examples |
| `troubleshoot-replication` | Diagnose and fix blocked queues, connectivity failures, and distribution problems |

**Key features:**
- All skills based on official AEM 6.5 LTS documentation
- Complete coverage of public Replication API (Replicator, ReplicationOptions, AgentManager, ReplicationQueue, etc.)
- 49 Java code examples for OSGi services, servlets, and workflow steps
- 12+ troubleshooting scenarios with step-by-step resolution
- 3,575 lines of comprehensive documentation

### AEM as a Cloud Service — Best Practices & Migration

Under `plugins/aem/cloud-service/skills/`, **`best-practices/`** is the **general-purpose** Cloud Service skill: pattern modules, Java baseline references (SCR→OSGi DS, resolver/logging, and related refs), and day-to-day Cloud Service alignment. Use it **without** loading **migration** for greenfield or maintainability work. **`migration/`** (BPA/CAM orchestration) is **scoped to legacy AEM → AEM as a Cloud Service** (not Edge Delivery or 6.5 LTS); it **delegates** concrete refactors to **`best-practices`** (`references/`). **Installing the AEM as a Cloud Service plugin** (`aem-cloud-service`, or the `plugins/aem/cloud-service` path with `npx skills` / `gh upskill`) **includes both**; the agent should load the appropriate `SKILL.md` for the task. Use **`gh upskill` / `npx skills` with `--skill`** when you need a specific bundled skill (see **Installation** above).

**Key features:**
- **Best practices:** one skill for patterns, SCR→OSGi DS, and resolver/logging — applicable to Cloud Service projects generally, not only migration
- **Migration:** orchestration-only; pattern and transformation content lives in **`best-practices`**

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

### App Builder

Development, customization, testing, and deployment skills for Adobe App Builder projects.

**Skill chaining:**
- **Actions path:** `appbuilder-project-init` → `appbuilder-action-scaffolder` → `appbuilder-testing` → `appbuilder-cicd-pipeline`
- **UI path:** `appbuilder-project-init` → `appbuilder-ui-scaffolder` → `appbuilder-testing` → `appbuilder-cicd-pipeline`
- **E2E path:** `appbuilder-ui-scaffolder` or `appbuilder-testing` → `appbuilder-e2e-testing` → `appbuilder-cicd-pipeline`

| Skill | Description |
|-------|-------------|
| `appbuilder-project-init` | Initialize new Adobe App Builder projects and choose the right bootstrap path |
| `appbuilder-action-scaffolder` | Scaffold, implement, deploy, and debug Adobe Runtime actions |
| `appbuilder-ui-scaffolder` | Generate React Spectrum UI components for ExC Shell SPAs and AEM UI Extensions |
| `appbuilder-testing` | Generate and run Jest unit, integration, and contract tests for actions and UI components |
| `appbuilder-e2e-testing` | Playwright browser E2E tests for ExC Shell SPAs and AEM extensions |
| `appbuilder-cicd-pipeline` | Set up CI/CD pipelines for GitHub Actions, Azure DevOps, and GitLab CI |

### Creativity & Design

| Skill | Description |
|-------|-------------|
| `adobe-batch-edit-photos` | Apply consistent, cohesive photo adjustments across a set of images — matched tones, presets, and cinematic looks |
| `adobe-design-from-template` | Create flyers, posters, social posts, invitations, business cards, and other visuals from Adobe Express templates |
| `adobe-retouch-portraits` | Bulk walk-away retouching for wedding and event portraits: auto-straighten, auto-tone, and auto-light across a folder |
| `adobe-edit-quick-cut` | Turn a long video into a punchy sizzle or highlight reel using Adobe Quick Cut |
| `adobe-resize-photos-and-videos` | Resize images and videos to exact pixel dimensions, aspect ratios, or named sizes (4K, HD, A4) |
| `adobe-create-social-variations` | Produce platform-ready image and video crops for Instagram, TikTok, LinkedIn, YouTube, and other social platforms |

## Repository Structure

```
plugins/
├── aem/
│   ├── edge-delivery-services/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   └── skills/
│   │       ├── content-driven-development/
│   │       ├── building-blocks/
│   │       └── ...
│   ├── project-management/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   ├── fonts/
│   │   ├── hooks/
│   │   │   └── pdf-lifecycle.js
│   │   ├── templates/
│   │   │   └── whitepaper.typ
│   │   └── skills/
│   │       ├── handover/
│   │       ├── authoring/
│   │       ├── development/
│   │       ├── admin/
│   │       ├── whitepaper/
│   │       └── auth/
│   ├── cloud-service/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   └── skills/
│   │       ├── best-practices/
│   │       │   ├── README.md
│   │       │   ├── SKILL.md
│   │       │   └── references/
│   │       ├── migration/
│   │       │   ├── README.md
│   │       │   ├── SKILL.md
│   │       │   ├── references/
│   │       │   └── scripts/
│   │       ├── ensure-agents-md/
│   │       │   ├── SKILL.md
│   │       │   └── references/
│   │       │       ├── AGENTS.md.template
│   │       │       └── module-catalog.md
│   │       ├── create-component/
│   │       │   ├── SKILL.md
│   │       │   ├── assets/
│   │       │   └── references/
│   │       ├── aem-workflow/
│   │       │   ├── SKILL.md
│   │       │   ├── workflow-model-design/
│   │       │   ├── workflow-development/
│   │       │   ├── workflow-triggering/
│   │       │   ├── workflow-launchers/
│   │       │   ├── workflow-debugging/
│   │       │   ├── workflow-triaging/
│   │       │   └── workflow-orchestrator/
│   │       └── dispatcher/
│   │           ├── SKILL.md
│   │           ├── config-authoring/
│   │           ├── technical-advisory/
│   │           ├── incident-response/
│   │           ├── performance-tuning/
│   │           ├── security-hardening/
│   │           └── workflow-orchestrator/
│   └── 6.5-lts/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       └── skills/
│           ├── aem-workflow/
│           │   ├── SKILL.md
│           │   ├── workflow-model-design/
│           │   ├── workflow-development/
│           │   ├── workflow-triggering/
│           │   ├── workflow-launchers/
│           │   ├── workflow-debugging/
│           │   ├── workflow-triaging/
│           │   └── workflow-orchestrator/
│           ├── aem-replication/
│           │   ├── README.md
│           │   ├── SKILL.md
│           │   ├── configure-replication-agent/
│           │   ├── replicate-content/
│           │   ├── replication-api/
│           │   └── troubleshoot-replication/
│           ├── ensure-agents-md/
│           └── dispatcher/
│               ├── SKILL.md
│               ├── config-authoring/
│               ├── technical-advisory/
│               ├── incident-response/
│               ├── performance-tuning/
│               ├── security-hardening/
│               └── workflow-orchestrator/
├── app-builder/
│   ├── .claude-plugin/
│   │   └── plugin.json
│   └── skills/
│       ├── _shared/
│       ├── appbuilder-project-init/
│       ├── appbuilder-action-scaffolder/
│       ├── appbuilder-ui-scaffolder/
│       ├── appbuilder-testing/
│       ├── appbuilder-e2e-testing/
│       └── appbuilder-cicd-pipeline/
└── creative-cloud/
    └── adobe-for-creativity/
        ├── .claude-plugin/
        │   └── plugin.json
        ├── skills/
        │   └── ...
        └── .mcp.json
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding or updating skills. Join [#agentskills](https://adobe.enterprise.slack.com/archives/C0APTKDNPEY) on Adobe Slack for questions and discussion.

## Resources

- [agentskills.io Specification](https://agentskills.io)
- [Claude Code Plugins](https://code.claude.com/docs/en/discover-plugins)
- [Vercel Skills](https://github.com/vercel-labs/skills)
- [upskill GitHub Extension](https://github.com/ai-ecoverse/gh-upskill)
- [#agentskills Slack Channel](https://adobe.enterprise.slack.com/archives/C0APTKDNPEY)

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.
