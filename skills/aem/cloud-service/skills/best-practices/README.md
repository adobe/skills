# AEM as a Cloud Service — Best practices (plugin)

Source: `skills/aem/cloud-service/skills/best-practices/`. Plugin **`aem-best-practices`**: `SKILL.md` and `references/` (patterns: scheduler, replication, events, assets; Java baseline: `scr-to-osgi-ds.md`, `resource-resolver-logging.md`, prerequisites hub).

For **BPA- or CAM-driven bulk migration**, install **`aem-migration`** as well (`skills/aem/cloud-service/skills/migration/`); it supplies targets, this plugin supplies transformation modules.

## Installation

### Claude Code Plugins

```bash
/plugin install aem-best-practices@adobe-skills
```

### Vercel Skills

```bash
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/cloud-service/skills/best-practices --all
```

### upskill

```bash
gh upskill adobe/skills --path skills/aem/cloud-service/skills/best-practices --all
```

## Related

For **BPA/CAM-driven bulk migration**, install **`aem-migration`** (`skills/aem/cloud-service/skills/migration`).
