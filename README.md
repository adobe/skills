# Adobe Skills for AI Coding Agents

Repository of Adobe skills for AI coding agents.

## Installation

### Claude Code Plugins

```bash
# Add the Adobe Skills marketplace
/plugin marketplace add adobe/skills

# Install AEM Edge Delivery Services plugin (all 17 skills)
/plugin install aem-edge-delivery-services@adobe-skills

# Install AEM as a Cloud Service Dispatcher plugin
/plugin install aem-cloud-service-dispatcher@adobe-skills

# Install AEM 6.5 LTS Dispatcher plugin
/plugin install aem-6-5-lts-dispatcher@adobe-skills

# Install AEM Cloud Service best practices (platform + pattern modules)
/plugin install aem-best-practices@adobe-skills

# Install AEM Cloud Service code migration (BPA/CAM orchestration)
/plugin install aem-migration@adobe-skills
```

### Vercel Skills (npx skills)

```bash
# Install all AEM Edge Delivery Services skills
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/edge-delivery-services --all

# Install all AEM as a Cloud Service Dispatcher skills
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/cloud-service/skills/dispatcher --all

# Install all AEM 6.5 LTS Dispatcher skills
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/6.5-lts/skills/dispatcher --all

# Install all AEM Cloud Service best-practices skills (pattern modules + SCR→DS + resource/logging)
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/cloud-service/skills/best-practices --all

# Install all AEM Cloud Service migration skills
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/cloud-service/skills/migration --all

# Install dispatcher skills for a single agent (pick ONE mode only)
# AEM as a Cloud Service mode:
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/cloud-service/skills/dispatcher --all -a cursor -y
# AEM 6.5 LTS mode:
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/6.5-lts/skills/dispatcher --all -a cursor -y

# Install specific skill(s)
npx skills add adobe/skills -s content-driven-development
npx skills add adobe/skills -s content-driven-development building-blocks testing-blocks

# Install a specific dispatcher skill from a mode-scoped source
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/cloud-service/skills/dispatcher -s config-authoring
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/6.5-lts/skills/dispatcher -s config-authoring

# Install all skills discoverable at repository root (currently AEM Edge Delivery Services)
npx skills add adobe/skills --all
# Note: Dispatcher mode skills are grouped under mode-scoped paths and are not discovered from repository root.

# List skills discoverable at repository root (currently AEM Edge Delivery Services)
npx skills add adobe/skills --list
# For dispatcher skills, use mode-scoped --list:
# npx skills add https://github.com/adobe/skills/tree/main/skills/aem/cloud-service/skills/dispatcher --list
# npx skills add https://github.com/adobe/skills/tree/main/skills/aem/6.5-lts/skills/dispatcher --list
```

### upskill (GitHub CLI Extension)

```bash
gh extension install trieloff/gh-upskill

# Install all skills discoverable at repository root
gh upskill adobe/skills --all
# Note: prefer mode-scoped --path installs for dispatcher skills.

# Install only AEM Edge Delivery Services skills
gh upskill adobe/skills --path skills/aem/edge-delivery-services --all

# Install only AEM as a Cloud Service Dispatcher skills
gh upskill adobe/skills --path skills/aem/cloud-service/skills/dispatcher --all

# Install only AEM 6.5 LTS Dispatcher skills
gh upskill adobe/skills --path skills/aem/6.5-lts/skills/dispatcher --all

# Install only AEM Cloud Service best-practices skills
gh upskill adobe/skills --path skills/aem/cloud-service/skills/best-practices --all

# Install only AEM Cloud Service migration skills
gh upskill adobe/skills --path skills/aem/cloud-service/skills/migration --all

# Install a specific skill
gh upskill adobe/skills --path skills/aem/edge-delivery-services --skill content-driven-development
gh upskill adobe/skills --path skills/aem/cloud-service/skills/dispatcher --skill config-authoring
gh upskill adobe/skills --path skills/aem/6.5-lts/skills/dispatcher --skill config-authoring

# List available skills in a subfolder
gh upskill adobe/skills --path skills/aem/edge-delivery-services --list
gh upskill adobe/skills --path skills/aem/cloud-service/skills/dispatcher --list
gh upskill adobe/skills --path skills/aem/6.5-lts/skills/dispatcher --list
```

## Available Skills

### AEM Edge Delivery Services

This package provides three capability areas:
- Core development workflow skills
- Discovery and documentation lookup skills
- Migration and import workflow skills

See `skills/aem/edge-delivery-services/skills/` for the current concrete skill set.

### AEM Dispatcher

Dispatcher skills are split by runtime flavor to avoid mode auto-detection and keep installation explicit.
Install only one dispatcher flavor in a workspace (`cloud-service` or `6.5-lts`).

Current dispatcher flavors:
- `skills/aem/cloud-service/skills/dispatcher`
- `skills/aem/6.5-lts/skills/dispatcher`

Each flavor contains parallel capability groups (workflow orchestration, config authoring, technical advisory, incident response, performance tuning, and security hardening).
Shared advisory logic is centralized under each flavor's `dispatcher/shared/references/` to reduce duplication and drift.

### AEM as a Cloud Service — Best Practices & Migration

Packages under `skills/aem/cloud-service/skills/`: **`aem-best-practices`** (source `best-practices/`, pattern modules + Java baseline refs) and **`aem-migration`** (source `migration/`, BPA/CAM orchestration). Scope is **legacy AEM → AEM as a Cloud Service** (not Edge Delivery or 6.5 LTS). **`aem-migration`** delegates transformations to **`aem-best-practices`** (`references/`).

**Key features:**
- One install for patterns, SCR→OSGi DS, and resolver/logging (all under the same skill)
- Migration stays orchestration-only; pattern content lives in the **`aem-best-practices`** plugin

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
    |   \-- skills/
    |       |-- dispatcher/
    |       |   |-- .claude-plugin/
    |       |   |   \-- plugin.json
    |       |   |-- config-authoring/
    |       |   |   |-- SKILL.md
    |       |   |   \-- references/
    |       |   |       \-- ...
    |       |   |-- technical-advisory/
    |       |   \-- ...
    |       |-- best-practices/
    |       |   |-- .claude-plugin/
    |       |   |   \-- plugin.json
    |       |   |-- README.md
    |       |   |-- SKILL.md
    |       |   \-- references/
    |       |       |   |-- scheduler.md
    |       |       |   |-- replication.md
    |       |       |   |-- scr-to-osgi-ds.md
    |       |       |   |-- resource-resolver-logging.md
    |       |       |   \-- ...
    |       \-- migration/
    |           |-- .claude-plugin/
    |           |   \-- plugin.json
    |           |-- README.md
    |           |-- SKILL.md
    |           |-- references/
    |           \-- scripts/
    |-- 6.5-lts/
    |   \-- skills/
    |       \-- dispatcher/
    |           |-- .claude-plugin/
    |           |   \-- plugin.json
    |           |-- config-authoring/
    |           |   |-- SKILL.md
    |           |   \-- references/
    |           |       \-- ...
    |           |-- technical-advisory/
    |           \-- ...
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
