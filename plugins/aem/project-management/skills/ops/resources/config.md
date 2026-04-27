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

SITES_JSON=$(curl -s --connect-timeout 15 --max-time 120 "https://admin.hlx.page/config/${ORG}/sites.json")
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

SITE_CONFIG=$(curl -s --connect-timeout 15 --max-time 120 -H "x-auth-token: ${AUTH_TOKEN}" "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json")
CODE_OWNER=$(echo "$SITE_CONFIG" | grep -o '"owner"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/"owner"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
CODE_REPO=$(echo "$SITE_CONFIG" | grep -o '"repo"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/"repo"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

# Update config file with code owner/repo
# Agent should use Edit tool to update .claude-plugin/project-config.json with codeOwner and codeRepo values
```

## Permission Check

Identity comes from `/profile`. Roles on the current site are read from `/config/{org}/sites/{site}.json` under `access.admin.role` (a map of role name → list of user emails), not from a separate `/access.json` endpoint.

Use `python3` to parse JSON so nested structures are handled correctly (shell `grep` on JSON is unreliable):

```bash
PROFILE=$(curl -s --connect-timeout 15 --max-time 120 -H "x-auth-token: ${AUTH_TOKEN}" "https://admin.hlx.page/profile")
USER_EMAIL=$(echo "$PROFILE" | grep -o '"email"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"email"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

SITE_CONFIG=$(curl -s --connect-timeout 15 --max-time 120 -H "x-auth-token: ${AUTH_TOKEN}" "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json")

export USER_EMAIL
ROLES_ON_SITE=$(echo "$SITE_CONFIG" | python3 -c '
import json, os, sys
try:
    email = os.environ.get("USER_EMAIL", "")
    data = json.load(sys.stdin)
    block = data.get("access", {}).get("admin", {}).get("role", {})
    if not isinstance(block, dict):
        print("")
        sys.exit(0)
    matched = []
    for name, value in block.items():
        if isinstance(value, list) and email in value:
            matched.append(name)
        elif value == email:
            matched.append(name)
    print(" ".join(matched))
except Exception:
    print("")
')

IS_ADMIN=false
IS_AUTHOR=false
for r in $ROLES_ON_SITE; do
  [ "$r" = "admin" ] && IS_ADMIN=true
  { [ "$r" = "author" ] || [ "$r" = "basic_author" ]; } && IS_AUTHOR=true
done

echo "User: $USER_EMAIL | roles on site: ${ROLES_ON_SITE:-—} | IS_ADMIN=$IS_ADMIN | IS_AUTHOR=$IS_AUTHOR"
```

`IS_AUTHOR` is **true** if the user has the `author` or `basic_author` role. For other roles (`publish`, `develop`, `config`, etc.) inspect the space-separated `ROLES_ON_SITE` list. If `ROLES_ON_SITE` is empty, the user may not be listed in `access.admin.role` or the config shape may differ—let the API enforce permissions on each call.

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
