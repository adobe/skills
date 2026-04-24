---
name: ops-sites
description: Site and branch management for Edge Delivery Services - list sites, switch active site (repoless), switch branches for testing.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Site & Branch Management

Manage multi-site (repoless) setups and branch operations.

## When to Use

- Working in a repoless org with multiple sites and need to switch the active site context
- Listing all sites under an org to find the correct site name before running operations
- Switching to a feature branch to preview or test branch-specific content
- Investigating which sites share a code repo before triggering a code sync
- Setting up the project config for a new site or brand under an existing org

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
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites.json"
```

**On success:** Extract `sites[].name` — display results in a table with columns **#**, **Site Name**, and **Preview URL** (`https://main--{name}--{org}.aem.page`). Report total count.

**▶ Recommended Next Actions:**
1. Switch to a specific site to operate on it
   ```
   switch to {site}
   ```
2. Preview a page on a specific site
   ```
   preview {path}
   ```
3. Compare with DA org root to find DA folders not yet registered as sites (or vice versa)
   ```
   list DA folders
   ```
   *(Shows all DA folders — useful regardless of individual site source type)*


### Switch Site

```bash
python3 -c "
import json
with open('.claude-plugin/project-config.json') as f: c = json.load(f)
c['site'] = '${NEW_SITE}'
with open('.claude-plugin/project-config.json', 'w') as f: json.dump(c, f, indent=2)
print('Switched to site: ${NEW_SITE}')
"
```

**Success:** `Switched to site: {site}`
**▶ Recommended Next Actions:**
1. Preview a page on the newly selected site
   ```
   preview {path}
   ```
2. Verify the site configuration
   ```
   show site config
   ```
3. *(DA sites only)* Browse the DA content structure for this site
   ```
   list DA folders in {site}
   ```

### Switch Branch

```bash
python3 -c "
import json
with open('.claude-plugin/project-config.json') as f: c = json.load(f)
c['ref'] = '${NEW_BRANCH}'
with open('.claude-plugin/project-config.json', 'w') as f: json.dump(c, f, indent=2)
"
```

**Success:** `Switched to branch: {ref} (https://{ref}--{site}--{org}.aem.page)`
**▶ Recommended Next Actions:**
1. Preview a page to confirm the branch is working
   ```
   preview {path}
   ```
2. Switch back to main when done
   ```
   use branch main
   ```

### Show Current Config

```bash
cat .claude-plugin/project-config.json
```

**▶ Recommended Next Actions:**
1. Switch to a different site
   ```
   switch to {site}
   ```
2. Switch to a feature branch for testing
   ```
   use branch {branchName}
   ```
3. List all available sites in this org
   ```
   list sites
   ```
4. *(DA sites only)* Browse the DA content structure for the active site
   ```
   list DA folders in {site}
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
  echo "Publishing ${PATH} on $SITE..."
  curl -s -X POST \
    -H "authorization: Bearer ${IMS_TOKEN}" \
    -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
    "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}${PATH}"
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
| "preview /en/homepage on all sites" | Cross-site operation |
| "preview /en/homepage on site-b" | Specific site operation |

## Success Criteria

- ✅ Site list shows all sites under the org with their names and associated repos
- ✅ Active site context updated in `.claude-plugin/project-config.json` after a switch
- ✅ Repoless architecture detected and communicated when relevant to an operation
- ✅ Branch switch confirmed and user reminded that subsequent operations target the new branch
