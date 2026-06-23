# AEM as a Cloud Service — Code Migration

This skill drives migration **from legacy AEM (6.x, AMS, or on-prem) to AEM as a Cloud Service**: Best Practices Analyzer (BPA) data, Cloud Acceleration Manager (CAM) via MCP when available, and a one-pattern-per-session workflow.

**Target platform** is always **AEM as a Cloud Service**. Source is legacy AEM; ambiguous top-level “migration” is avoided by scoping this under `skills/aem/cloud-service/skills/migration/`.

## Requires `code-assessment`

**This skill is not standalone.** It drives BPA/CAM and target discovery; **step-by-step refactors live only in the [`code-assessment`](../code-assessment/) skill**. Five major patterns each have a **pattern guide** (`scheduler/`, `resource-change-listener/`, `replication/`, `event-migration/`, `asset-manager/`); shared topics (SCR→DS, ResourceResolver/SLF4J, HTL lint, prerequisites hub) live as **references** under `references/`. For any code change, the agent must read the relevant pattern guide or reference — **migration does not copy those procedures** here.

- **You need both:** use **migration** for workflow and targets; use **code-assessment** for how to edit Java/OSGi and apply each pattern.
- **Install once, get both:** the umbrella **`aem-cloud-service`** plugin (path `skills/aem/cloud-service`) includes `migration/` and `code-assessment/` together. Do not rely on migration alone unless the same `code-assessment` files are already on disk (for example full `adobe/skills` checkout with working `{code-assessment}` links).

## Skills

### migration

- BPA collection, CSV, and CAM/MCP flows (CAM tool schemas and retries: `references/cam-mcp.md`)
- Manual flow and pattern auto-detection
- Points to **`code-assessment`** for all detailed transformation steps

**First run:** In chat, name **one BPA pattern** (e.g. scheduler) and either a **CSV path**, **CAM/MCP**, or **concrete Java files**. See **Quick start** in `SKILL.md` for copy-paste prompts and the CAM happy path in `references/cam-mcp.md`.

## Installation

Use the root [Adobe Skills README](https://github.com/adobe/skills/blob/main/README.md): install **`aem-cloud-service`** (Claude `/plugin`), or add **`skills/aem/cloud-service`** with `npx skills` / `gh upskill --path` — not the `migration/` or `code-assessment/` subfolders alone.

## Prerequisites

- AEM project with Maven/Gradle
- Access to sources to migrate
- BPA results recommended (CSV or CAM)

For issues, see the main [Adobe Skills repository](https://github.com/adobe/skills).
