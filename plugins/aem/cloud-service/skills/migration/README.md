# AEM as a Cloud Service — Code Migration

This skill orchestrates migration **from legacy AEM (6.x, AMS, or on-prem) to AEM as a Cloud Service**: Best Practices Analyzer (BPA) data, Cloud Acceleration Manager (CAM) via MCP when available, and a one-pattern-per-session workflow.

**Target platform** is always **AEM as a Cloud Service**. Source is legacy AEM; ambiguous top-level “migration” is avoided by scoping this under `skills/aem/cloud-service/skills/migration/`.

## Requires `best-practices`

**This skill is not standalone.** It orchestrates BPA/CAM and target discovery; **step-by-step refactors and pattern modules live only in the [`best-practices`](../best-practices/) skill** (`SKILL.md` and `references/*.md`). For any code change, the agent must read that material—**migration does not copy those procedures** here.

- **You need both:** use **migration** for workflow and targets; use **best-practices** for how to edit Java/OSGi and apply each pattern.
- **Install once, get both:** the umbrella **`aem-cloud-service`** plugin (path `skills/aem/cloud-service`) includes `migration/` and `best-practices/` together. Do not rely on migration alone unless the same `best-practices` files are already on disk (for example full `adobe/skills` checkout with working `{best-practices}` links).

## Skills

### migration

- BPA collection, CSV, and CAM/MCP flows (CAM tool schemas and retries: `references/cam-mcp.md`)
- Manual flow and pattern auto-detection
- Delegates detailed transformations to **`best-practices`**

**First run:** In chat, name **one BPA pattern** (e.g. scheduler) and either a **CSV path**, **CAM/MCP**, or **concrete Java files**. See **Quick start** in `SKILL.md` for copy-paste prompts and the CAM happy path in `references/cam-mcp.md`.

## Installation

Use the root [Adobe Skills README](https://github.com/adobe/skills/blob/main/README.md): install **`aem-cloud-service`** (Claude `/plugin`), or add **`skills/aem/cloud-service`** with `npx skills` / `gh upskill --path` — not the `migration/` or `best-practices/` subfolders alone.

## Prerequisites

- AEM project with Maven/Gradle
- Access to sources to migrate
- BPA results recommended (CSV or CAM)

For issues, see the main [Adobe Skills repository](https://github.com/adobe/skills).
