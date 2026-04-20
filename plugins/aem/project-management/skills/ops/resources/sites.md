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
ORG=$(cat .claude-plugin/project-config.json | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
curl -s "https://admin.hlx.page/config/${ORG}/sites.json" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
data.sites.forEach((s, i) => console.log(\`\${i + 1}. \${s.name} → https://main--\${s.name}--${ORG}.aem.page\`));
"
```

### Detect Repoless Setup

```bash
ORG=$(cat .claude-plugin/project-config.json | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
SITES=$(curl -s "https://admin.hlx.page/config/${ORG}/sites.json")
SITE_COUNT=$(echo "$SITES" | grep -o '"name"' | wc -l | tr -d ' ')

if [ "$SITE_COUNT" -gt 1 ]; then
  echo "REPOLESS: $SITE_COUNT sites share this codebase"
else
  echo "STANDARD: Single site setup"
fi
```

### Switch Site

```bash
node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('.claude-plugin/project-config.json', 'utf8'));
config.site = '${NEW_SITE}';
fs.writeFileSync('.claude-plugin/project-config.json', JSON.stringify(config, null, 2));
console.log('Switched to site: ${NEW_SITE}');
"
```

**Success:** `Switched to site: {site}`

### Switch Branch

```bash
node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('.claude-plugin/project-config.json', 'utf8'));
config.ref = '${NEW_BRANCH}';
fs.writeFileSync('.claude-plugin/project-config.json', JSON.stringify(config, null, 2));
console.log('Switched to branch: ${NEW_BRANCH}');
console.log('Preview URL: https://${NEW_BRANCH}--' + config.site + '--' + config.org + '.aem.page');
"
```

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
ORG=$(cat .claude-plugin/project-config.json | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
SITES=$(curl -s "https://admin.hlx.page/config/${ORG}/sites.json" | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

for SITE in $SITES; do
  echo "Publishing /about on $SITE..."
  curl -s -X POST \
    -H "x-auth-token: ${AUTH_TOKEN}" \
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
