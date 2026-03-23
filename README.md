# Adobe Skills for AI Coding Agents

Repository of Adobe skills for AI coding agents.

## Installation

### Claude Code Plugins

```bash
# Add the Adobe Skills marketplace
/plugin marketplace add adobe/skills

# Install AEM Edge Delivery Services plugin (all 17 skills)
/plugin install aem-edge-delivery-services@adobe-skills

# Install all AEM as a Cloud Service skills (create-component + workflow + dispatcher) in one command
/plugin install aem-cloud-service@adobe-skills

# Install all AEM 6.5 LTS skills (workflow + dispatcher) in one command
/plugin install aem-6-5-lts@adobe-skills
```

### Vercel Skills (npx skills)

```bash
# Install all AEM Edge Delivery Services skills
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/edge-delivery-services --all

# Install all AEM as a Cloud Service skills (create-component + workflow + dispatcher) in one command
npx skills add https://github.com/adobe/skills/tree/beta/skills/aem/cloud-service --all

# Install all AEM 6.5 LTS skills (workflow + dispatcher) in one command
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
gh extension install trieloff/gh-upskill

# Install all AEM Edge Delivery Services skills
gh upskill adobe/skills --path skills/aem/edge-delivery-services --all

# Install all AEM as a Cloud Service skills (create-component + workflow + dispatcher)
gh upskill adobe/skills --path skills/aem/cloud-service --all

# Install all AEM 6.5 LTS skills (workflow + dispatcher)
gh upskill adobe/skills --path skills/aem/6.5-lts --all

# Install a specific skill
gh upskill adobe/skills --path skills/aem/edge-delivery-services --skill content-driven-development

# List available skills
gh upskill adobe/skills --path skills/aem/edge-delivery-services --list
gh upskill adobe/skills --path skills/aem/cloud-service --list
gh upskill adobe/skills --path skills/aem/6.5-lts --list
```

## Available Skills

### AEM Edge Delivery Services

This package provides three capability areas:
- Core development workflow skills
- Discovery and documentation lookup skills
- Migration and import workflow skills

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
    |       |-- ensure-agents-md/
    |       |   |-- SKILL.md          <-- bootstrap: creates AGENTS.md + CLAUDE.md if missing
    |       |   \-- references/
    |       |       |-- AGENTS.md.template
    |       |       \-- module-catalog.md
    |       |-- create-component/
    |       |   |-- SKILL.md          <-- discovered by npx skills
    |       |   |-- .claude-plugin/
    |       |   |   \-- plugin.json
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
    |       |   |-- .claude-plugin/
    |       |   |   \-- plugin.json
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
    |           |-- .claude-plugin/
    |           |   \-- plugin.json
    |           |-- config-authoring/
    |           |   |-- SKILL.md      <-- specialist (bundled inside dispatcher)
    |           |   \-- references/
    |           |-- technical-advisory/
    |           |-- incident-response/
    |           |-- performance-tuning/
    |           |-- security-hardening/
    |           \-- workflow-orchestrator/
    |-- 6.5-lts/
    |   |-- .claude-plugin/
    |   |   \-- plugin.json
    |   \-- skills/
    |       |-- aem-workflow/
    |       |   |-- SKILL.md          <-- discovered by npx skills (router)
    |       |   |-- .claude-plugin/
    |       |   |   \-- plugin.json
    |       |   |-- workflow-model-design/
    |       |   |-- workflow-development/
    |       |   |-- workflow-triggering/
    |       |   |-- workflow-launchers/
    |       |   |-- workflow-debugging/
    |       |   |-- workflow-triaging/
    |       |   \-- workflow-orchestrator/
    |       |-- ensure-agents-md/
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
