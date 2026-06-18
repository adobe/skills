# AEM as a Cloud Service — Best practices

Source: `skills/aem/cloud-service/skills/best-practices/`. **`SKILL.md`** routes to:

- **Pattern guides** (each covering migration, greenfield, review, troubleshooting, common pitfalls, modern alternatives for one pattern): `scheduler/`, `resource-change-listener/`, `replication/`, `event-migration/`, `asset-manager/`
- **Shared references** under `references/` (topics used across patterns): Java baseline (`scr-to-osgi-ds.md`, `resource-resolver-logging.md`, prerequisites hub), HTL lint (`data-sly-test-redundant-constant.md` and proactive `rg` discovery in `SKILL.md`)

These files ship with the **AEM as a Cloud Service** plugin (`aem-cloud-service` in the marketplace). Install that umbrella package once; the agent selects this skill when the task matches.

For **BPA- or CAM-driven bulk migration**, use the **`migration`** skill under the same plugin (`skills/aem/cloud-service/skills/migration/`); it discovers the migration targets and runs the workflow, while this folder supplies the transformation steps.

## Installation

Use the root [Adobe Skills README](https://github.com/adobe/skills/blob/main/README.md): install **`aem-cloud-service`** (Claude `/plugin`), or add **`skills/aem/cloud-service`** with `npx skills` / `gh upskill --path` — not this subfolder alone.

## Related

For **BPA/CAM-driven bulk migration**, see **`migration/`** (`skills/aem/cloud-service/skills/migration`).
