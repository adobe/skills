# AEM as a Cloud Service — Code Migration

This plugin orchestrates migration **from legacy AEM (6.x, AMS, or on-prem) to AEM as a Cloud Service**: Best Practices Analyzer (BPA) data, Cloud Acceleration Manager (CAM) via MCP when available, and a one-pattern-per-session workflow.

**Target platform** is always **AEM as a Cloud Service**. Source is legacy AEM; ambiguous top-level “migration” is avoided by scoping under `cloud-service/migration`.

Transformation rules and pattern modules live in **`aem-best-practices`** (folder `skills/aem/cloud-service/skills/best-practices/`) — read its main `SKILL.md` and `references/` before editing code.

**Install both plugins for typical migrations:** **`aem-migration`** handles BPA/CAM orchestration and target lists; it does **not** ship the step-by-step pattern refactors. **`aem-best-practices`** holds those modules (`references/*.md`). Install **only** **`aem-migration`** if your agent already has access to the same files (for example you have the full `adobe/skills` repo open and paths like `{best-practices}` resolve).

**First run:** In chat, name **one BPA pattern** (e.g. scheduler) and either a **CSV path**, **CAM/MCP**, or **concrete Java files**. See **Quick start** in `SKILL.md` for copy-paste prompts and the CAM happy path in `references/cam-mcp.md`.

## Skills

### aem-migration

- BPA collection, CSV, and CAM/MCP flows (CAM tool schemas and retries: `references/cam-mcp.md`)
- Manual flow and pattern auto-detection
- Delegates detailed transformations to **`aem-best-practices`**

## Installation

### Claude Code Plugins

```bash
/plugin install aem-migration@adobe-skills
/plugin install aem-best-practices@adobe-skills
```

### Vercel Skills

```bash
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/cloud-service/skills/migration --all
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/cloud-service/skills/best-practices --all
```

### upskill

```bash
gh upskill adobe/skills --path skills/aem/cloud-service/skills/migration --all
gh upskill adobe/skills --path skills/aem/cloud-service/skills/best-practices --all
```

## Prerequisites

- AEM project with Maven/Gradle
- Access to sources to migrate
- BPA results recommended (CSV or CAM)

For issues, see the main [Adobe Skills repository](https://github.com/adobe/skills).
