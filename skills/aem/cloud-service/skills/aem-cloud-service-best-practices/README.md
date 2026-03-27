# AEM as a Cloud Service — Best practices (plugin)

This plugin lives at `skills/aem/cloud-service/skills/aem-cloud-service-best-practices/`. There is **one** installable skill under **`aem-cloud-service-best-practices/aem-cloud-service-best-practices/`**:

| Skill | Path |
|-------|------|
| `aem-cloud-service-best-practices` | `.../aem-cloud-service-best-practices/SKILL.md` + `references/` (patterns: scheduler, replication, events, assets; Java baseline: `scr-to-osgi-ds.md`, `resource-resolver-logging.md`, prerequisites hub) |

**Migration plugin:** `skills/aem/cloud-service/skills/migration/` (`aem-cloud-service-migration`) — BPA/CAM orchestration only. For **BPA- or CAM-driven bulk migration**, install **both** plugins; migration finds targets, this plugin supplies transformation modules.

## Installation

### Claude Code Plugins

```bash
/plugin install aem-cloud-service-best-practices@adobe-skills
```

### Vercel Skills

```bash
npx skills add https://github.com/adobe/skills/tree/main/skills/aem/cloud-service/skills/aem-cloud-service-best-practices --all
```

### upskill

```bash
gh upskill adobe/skills --path skills/aem/cloud-service/skills/aem-cloud-service-best-practices --all
```

## Related

For **BPA/CAM-driven bulk migration**, install **`aem-cloud-service-migration`** (`skills/aem/cloud-service/skills/migration`).
