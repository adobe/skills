---
name: ops-sites
description: Site and branch management for Edge Delivery Services - list sites, switch active site (repoless), switch branches for testing.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Site & Branch Management

Manage multi-site (repoless) setups and branch operations.

## Repoless Architecture

In a **repoless setup**, multiple sites share a single code repository:

```
Organization (org)
├── Code Repository (shared)
│   └── owner/repo on GitHub
└── Sites (independent content)
    ├── site-a → content-a, preview-a, live-a
    ├── site-b → content-b, preview-b, live-b
    └── site-c → content-c, preview-c, live-c
```

## Operations

### List All Sites

```bash
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites.json"
```

**Response format:** Present as table — # | Site Name | Preview URL (`https://main--{name}--{org}.aem.page`)

### Detect Repoless Setup

```bash
ORG=$(cat .claude-plugin/project-config.json | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  console.log(JSON.parse(d).org || '');
")
SITES_JSON=$(curl -s -H "Authorization: Bearer ${IMS_TOKEN}" "https://admin.hlx.page/config/${ORG}/sites.json")
SITE_COUNT=$(echo "$SITES_JSON" | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try { console.log((JSON.parse(d).sites || []).length); } catch(e) { console.log(0); }
")

if [ "$SITE_COUNT" -gt 1 ]; then
  echo "REPOLESS: $SITE_COUNT sites share this codebase"
else
  echo "STANDARD: Single site setup"
fi
```

### Switch Site

Update `site` value in `.claude-plugin/project-config.json` to the new site name.

**Success:** `Switched to site: {site}`

### Switch Branch

Update `ref` value in `.claude-plugin/project-config.json` to the new branch name.

**Success:** `Switched to branch: {ref} (https://{ref}--{site}--{org}.aem.page)`

### Show Current Config

```bash
cat .claude-plugin/project-config.json
```

## Scope Differences in Repoless

| Operation | Scope |
|-----------|-------|
| **Code Sync** | Shared - affects ALL sites |
| **Preview/Publish** | Per-site only |
| **Cache Purge** | Per-site only |
| **Index** | Per-site only |
| **User Access** | Per-site (or org-level) |

## Cross-Site Operations

Execute operation across all sites:

```bash
ORG=$(cat .claude-plugin/project-config.json | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  console.log(JSON.parse(d).org || '');
")
SITES=$(curl -s -H "Authorization: Bearer ${IMS_TOKEN}" "https://admin.hlx.page/config/${ORG}/sites.json" | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try { (JSON.parse(d).sites || []).forEach(s => console.log(s.name)); } catch(e) {}
")

for SITE in $SITES; do
  echo "Publishing /about on $SITE..."
  curl -s -X POST \
    -H "Authorization: Bearer ${IMS_TOKEN}" \
    "https://admin.hlx.page/live/${ORG}/${SITE}/main/about"
done
```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "list sites" | Show all sites |
| "switch to site-b" | Change active site |
| "use branch feature-nav" | Set default branch |
| "switch to main" | Reset to main branch |
| "show config" | Display current settings |
| "what site am I on" | Show current site |
| "preview /about on all sites" | Cross-site operation |
| "preview /about on site-b" | Specific site operation |
