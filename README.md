# Adobe Skills for AI Coding Agents

Repository of Adobe skills for AI coding agents.

## Installation

### Claude Code Plugins

```bash
/plugin marketplace add adobe/skills
/plugin install aem-edge-delivery-services@adobe-skills

# Install all AEM as a Cloud Service skills (create-component + workflow + dispatcher) in one command
/plugin install aem-cloud-service@adobe-skills

# Install all AEM 6.5 LTS skills (workflow + dispatcher + replication) in one command
/plugin install aem-6-5-lts@adobe-skills
/plugin install aem-project-management@adobe-skills
```

### Vercel Skills (npx skills)

```bash
# Install all AEM Edge Delivery Services skills
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/edge-delivery-services --all

# Install all AEM as a Cloud Service skills (create-component + workflow + dispatcher) in one command
npx skills add https://github.com/adobe/skills/tree/beta/skills/aem/cloud-service --all

# Install all AEM 6.5 LTS skills (workflow + dispatcher + replication) in one command
npx skills add https://github.com/adobe/skills/tree/beta/skills/aem/6.5-lts --all

# Install for a single agent (pick ONE flavor only)
npx skills add https://github.com/adobe/skills/tree/beta/skills/aem/cloud-service -a cursor -y
npx skills add https://github.com/adobe/skills/tree/beta/skills/aem/6.5-lts -a cursor -y

# Install specific skill(s)
npx skills add adobe/skills -s content-driven-development
npx skills add adobe/skills -s content-driven-development building-blocks testing-blocks

# List available skills
npx skills add adobe/skills --list
npx skills add https://github.com/adobe/skills/tree/beta/skills/aem/cloud-service --list
npx skills add https://github.com/adobe/skills/tree/beta/skills/aem/6.5-lts --list
```

### upskill (GitHub CLI Extension)

```bash
gh extension install ai-ecoverse/gh-upskill

# Install all AEM Edge Delivery Services skills
gh upskill adobe/skills --path skills/aem/edge-delivery-services --all

# Install all AEM as a Cloud Service skills (create-component + workflow + dispatcher)
gh upskill adobe/skills --path skills/aem/cloud-service --all

# Install all AEM 6.5 LTS skills (workflow + dispatcher + replication)
gh upskill adobe/skills --path skills/aem/6.5-lts --all

# Install a specific skill
gh upskill adobe/skills --path skills/aem/edge-delivery-services --skill content-driven-development

# List available skills
gh upskill adobe/skills --path skills/aem/edge-delivery-services --list
gh upskill adobe/skills --path skills/aem/cloud-service --list
gh upskill adobe/skills --path skills/aem/6.5-lts --list
```

## Available Skills

### For Business

#### Adobe Experience Manager

##### Developing with Edge Delivery Services

See `skills/aem/edge-delivery-services/skills/` for the current concrete skill set.

### AEM as a Cloud Service — Create Component

The `create-component` skill creates complete AEM components following Adobe best practices for AEM Cloud Service and AEM 6.5. It covers:

- Component definition, dialog XML, and HTL template
- Sling Model and optional child item model (multifield)
- Unit tests for models and servlets
- Clientlibs (component and dialog)
- Optional Sling Servlet for dynamic content

See `skills/aem/cloud-service/skills/create-component/` for the skill and its reference files.

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

See `skills/aem/cloud-service/skills/ensure-agents-md/` for the skill, template, and module catalog.

### AEM Workflow

Workflow skills cover the full AEM Granite Workflow Engine lifecycle — from designing and implementing workflows to production debugging and incident triaging. Like Dispatcher, they are split by runtime flavor:

- `skills/aem/cloud-service/skills/aem-workflow` — Cloud Service variant (no JMX, Cloud Manager logs, pipeline deploy)
- `skills/aem/6.5-lts/skills/aem-workflow` — 6.5 LTS / AMS variant (JMX, Felix Console, direct log access)

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
- `skills/aem/cloud-service/skills/dispatcher`
- `skills/aem/6.5-lts/skills/dispatcher`

Each flavor contains parallel capability groups (workflow orchestration, config authoring, technical advisory, incident response, performance tuning, and security hardening).
Shared advisory logic is centralized under each flavor's `dispatcher/shared/references/` to reduce duplication and drift.

### AEM Replication

Replication skills for AEM 6.5 LTS cover the full content distribution lifecycle from agent configuration to troubleshooting.

**Location:** `skills/aem/6.5-lts/skills/aem-replication`

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

Under `skills/aem/cloud-service/skills/`, **`best-practices/`** is the **general-purpose** Cloud Service skill: pattern modules, Java baseline references (SCR→OSGi DS, resolver/logging, and related refs), and day-to-day Cloud Service alignment. Use it **without** loading **migration** for greenfield or maintainability work. **`migration/`** (BPA/CAM orchestration) is **scoped to legacy AEM → AEM as a Cloud Service** (not Edge Delivery or 6.5 LTS); it **delegates** concrete refactors to **`best-practices`** (`references/`). **Installing the AEM as a Cloud Service plugin** (`aem-cloud-service`, or the `skills/aem/cloud-service` path with `npx skills` / `gh upskill`) **includes both**; the agent should load the appropriate `SKILL.md` for the task. Use **`gh upskill` / `npx skills` with `--skill`** when you need a specific bundled skill (see **Installation** above).

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

### Creativity & Design

_Coming soon._

## Repository Structure

```
skills/
\-- aem/
    |-- edge-delivery-services/
    |   |-- .claude-plugin/
    |   |   \-- plugin.json
    |   \-- skills/
    |       |-- content-driven-development/
    |       |-- building-blocks/
    |       \-- ...
    |-- cloud-service/
    |   |-- .claude-plugin/
    |   |   \-- plugin.json
    |   \-- skills/
    |       |-- best-practices/
    |       |   |-- README.md
    |       |   |-- SKILL.md
    |       |   \-- references/
    |       |       |   |-- scheduler.md
    |       |       |   |-- replication.md
    |       |       |   |-- scr-to-osgi-ds.md
    |       |       |   |-- resource-resolver-logging.md
    |       |       |   \-- ...
    |       \-- migration/
    |           |-- README.md
    |           |-- SKILL.md
    |           |-- references/
    |           \-- scripts/
    |       |-- ensure-agents-md/
    |       |   |-- SKILL.md          <-- bootstrap: creates AGENTS.md + CLAUDE.md if missing
    |       |   \-- references/
    |       |       |-- AGENTS.md.template
    |       |       \-- module-catalog.md
    |       |-- create-component/
    |       |   |-- SKILL.md          <-- discovered by npx skills
    |       |   |-- assets/
    |       |   |   \-- field-type-mappings.md
    |       |   \-- references/
    |       |       |-- aem-conventions.md
    |       |       |-- dialog-patterns.md
    |       |       |-- htl-patterns.md
    |       |       |-- model-patterns.md
    |       |       |-- java-standards.md
    |       |       |-- clientlib-patterns.md
    |       |       |-- extending-core-components.md
    |       |       |-- sling-servlet-standards.md
    |       |       |-- core-components.md
    |       |       |-- test-patterns.md
    |       |       |-- no-hallucination-rules.md
    |       |       \-- examples.md
    |       |-- aem-workflow/
    |       |   |-- SKILL.md          <-- discovered by npx skills (router)
    |       |   |-- workflow-model-design/
    |       |   |   |-- SKILL.md      <-- specialist (bundled inside aem-workflow)
    |       |   |   \-- references/
    |       |   |-- workflow-development/
    |       |   |-- workflow-triggering/
    |       |   |-- workflow-launchers/
    |       |   |-- workflow-debugging/
    |       |   |-- workflow-triaging/
    |       |   \-- workflow-orchestrator/
    |       \-- dispatcher/
    |           |-- SKILL.md          <-- discovered by npx skills (router)
    |           |-- config-authoring/
    |           |   |-- SKILL.md      <-- specialist (bundled inside dispatcher)
    |           |   \-- references/
    |           |-- technical-advisory/
    |           |-- incident-response/
    |           |-- performance-tuning/
    |           |-- security-hardening/
    |           \-- workflow-orchestrator/
    \-- 6.5-lts/
        |-- .claude-plugin/
        |   \-- plugin.json
        \-- skills/
            |-- aem-workflow/
            |   |-- SKILL.md          <-- discovered by npx skills (router)
            |   |-- workflow-model-design/
            |   |-- workflow-development/
            |   |-- workflow-triggering/
            |   |-- workflow-launchers/
            |   |-- workflow-debugging/
            |   |-- workflow-triaging/
            |   \-- workflow-orchestrator/
            |-- dispatcher/
            |   |-- SKILL.md          <-- discovered by npx skills (router)
            |   |-- config-authoring/
            |   |   |-- SKILL.md      <-- specialist (bundled inside dispatcher)
            |   |   \-- references/
            |   |-- technical-advisory/
            |   |-- incident-response/
            |   |-- performance-tuning/
            |   |-- security-hardening/
            |   \-- workflow-orchestrator/
            |-- aem-replication/
            |   |-- README.md
            |   |-- SKILL.md          <-- discovered by npx skills (router)
            |   |-- configure-replication-agent/
            |   |   \-- SKILL.md      <-- specialist (bundled inside aem-replication)
            |   |-- replicate-content/
            |   |   \-- SKILL.md      <-- specialist (bundled inside aem-replication)
            |   |-- replication-api/
            |   |   \-- SKILL.md      <-- specialist (bundled inside aem-replication)
            |   \-- troubleshoot-replication/
            |       \-- SKILL.md      <-- specialist (bundled inside aem-replication)
            \-- ensure-agents-md/
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
