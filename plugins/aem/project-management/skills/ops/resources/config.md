---
name: ops-config
description: Shared configuration loader for Edge Delivery Services admin operations. Loads org, site, auth token, and code repo settings. Used by all ops resource skills.
allowed-tools: Read, Write, Edit, Bash, Skill
---

# Edge Delivery Services Operations - Configuration Module

Shared configuration loading and setup for all ops operations.

## Load Configuration

```bash
CONFIG=$(cat .claude-plugin/project-config.json 2>/dev/null)
ORG=$(echo "$CONFIG" | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
AUTH_TOKEN=$(echo "$CONFIG" | grep -o '"authToken"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"authToken"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
SITE=$(echo "$CONFIG" | grep -o '"site"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"site"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
REF=$(echo "$CONFIG" | grep -o '"ref"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"ref"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
CODE_OWNER=$(echo "$CONFIG" | grep -o '"codeOwner"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"codeOwner"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
CODE_REPO=$(echo "$CONFIG" | grep -o '"codeRepo"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"codeRepo"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

REF=${REF:-main}

echo "org=$ORG"
echo "site=$SITE"
echo "ref=$REF"
echo "auth=${AUTH_TOKEN:+set}"
echo "codeOwner=$CODE_OWNER"
echo "codeRepo=$CODE_REPO"
```

## Setup If Missing

### Organization Name

**Note:** Org name check happens in the router (SKILL.md Step 0). This section is for saving the value after user provides it.

Save org name:

```bash
mkdir -p .claude-plugin
grep -qxF '.claude-plugin/' .gitignore 2>/dev/null || echo '.claude-plugin/' >> .gitignore
echo '{"org": "{ORG_NAME}"}' > .claude-plugin/project-config.json
```

### Authentication

If `AUTH_TOKEN` is empty:

```
Skill({ skill: "project-management:auth" })
```

### Site Detection

```bash
ORG=$(cat .claude-plugin/project-config.json | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

SITES_JSON=$(curl -s "https://admin.hlx.page/config/${ORG}/sites.json")
SITE_NAMES=$(echo "$SITES_JSON" | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
SITE_COUNT=$(echo "$SITE_NAMES" | wc -l | tr -d ' ')

echo "Found $SITE_COUNT site(s):"
echo "$SITE_NAMES"
```

- **Single site:** Auto-select and save
- **Multiple sites (repoless):** Ask user to select

### Code Repository (For Code Sync)

```bash
AUTH_TOKEN=$(cat .claude-plugin/project-config.json | grep -o '"authToken"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"authToken"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
ORG=$(cat .claude-plugin/project-config.json | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
SITE=$(cat .claude-plugin/project-config.json | grep -o '"site"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"site"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

SITE_CONFIG=$(curl -s -H "x-auth-token: ${AUTH_TOKEN}" "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json")
CODE_OWNER=$(echo "$SITE_CONFIG" | grep -o '"owner"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/"owner"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
CODE_REPO=$(echo "$SITE_CONFIG" | grep -o '"repo"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/"repo"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('.claude-plugin/project-config.json', 'utf8'));
config.codeOwner = '${CODE_OWNER}';
config.codeRepo = '${CODE_REPO}';
fs.writeFileSync('.claude-plugin/project-config.json', JSON.stringify(config, null, 2));
"
```

## Permission Check

```bash
PROFILE=$(curl -s -H "x-auth-token: ${AUTH_TOKEN}" "https://admin.hlx.page/profile")
USER_EMAIL=$(echo "$PROFILE" | grep -o '"email"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"email"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

ACCESS=$(curl -s -H "x-auth-token: ${AUTH_TOKEN}" "https://admin.hlx.page/config/${ORG}/sites/${SITE}/access.json")

IS_ADMIN=$(echo "$ACCESS" | grep -o '"admin"[[:space:]]*:[[:space:]]*\[[^]]*\]' | grep -q "$USER_EMAIL" && echo "true" || echo "false")
IS_AUTHOR=$(echo "$ACCESS" | grep -o '"author"[[:space:]]*:[[:space:]]*\[[^]]*\]' | grep -q "$USER_EMAIL" && echo "true" || echo "false")

echo "User: $USER_EMAIL | Admin: $IS_ADMIN | Author: $IS_AUTHOR"
```

## Permission Matrix

| Operation | Required Role |
|-----------|---------------|
| Preview/Publish | Author or Admin |
| Unpublish | Admin |
| Cache Purge | Author or Admin |
| Code Sync | Admin |
| Index | Author or Admin |
| Remove from Index | Admin |
| Snapshots | Author (Publish requires Admin) |
| User Management | Admin |
| View Logs | Author or Admin |

## Error Handling

| HTTP Code | Meaning | Action |
|-----------|---------|--------|
| 200/201 | Success | Show result |
| 202 | Accepted (async) | Show job ID |
| 401 | Unauthorized | Re-authenticate |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not found | Check path |
| 429 | Rate limited | Wait and retry |

## Config Structure

```json
{
  "org": "myorg",
  "authToken": "...",
  "site": "site-a",
  "sites": ["site-a", "site-b"],
  "isRepoless": true,
  "ref": "main",
  "codeOwner": "adobe",
  "codeRepo": "shared-eds-code"
}
```
