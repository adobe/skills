---
name: ops-config
description: Shared configuration loader for Edge Delivery Services admin operations. Loads org, site, auth token, and code repo settings. Used by all ops resource skills.
allowed-tools: Read, Write, Edit, Bash, Skill
---

# Edge Delivery Services Operations - Configuration Module

Shared configuration loading and setup for all ops operations.

## Load Configuration

All ops config lives in `~/.aem/ops-config.json`.

```bash
eval $(node -e "
  const fs = require('fs');
  try {
    const c = JSON.parse(fs.readFileSync(process.env.HOME + '/.aem/ops-config.json', 'utf8'));
    console.log('ORG=' + JSON.stringify(c.org || ''));
    console.log('SITE=' + JSON.stringify(c.site || ''));
    console.log('REF=' + JSON.stringify(c.ref || 'main'));
    console.log('CODE_OWNER=' + JSON.stringify(c.codeOwner || ''));
    console.log('CODE_REPO=' + JSON.stringify(c.codeRepo || ''));
  } catch(e) {
    console.log('ORG='); console.log('SITE='); console.log('REF=main');
    console.log('CODE_OWNER='); console.log('CODE_REPO=');
  }
")
IMS_TOKEN=$(node -e "
  const fs = require('fs');
  try {
    const t = JSON.parse(fs.readFileSync(process.env.HOME + '/.aem/ims-token.json', 'utf8'));
    if (t.imsToken && t.imsTokenExpiry > Math.floor(Date.now()/1000) + 60) {
      process.stdout.write(t.imsToken);
    }
  } catch (e) {}
")

echo "org=$ORG"
echo "site=$SITE"
echo "ref=$REF"
echo "auth=${IMS_TOKEN:+set}"
echo "codeOwner=$CODE_OWNER"
echo "codeRepo=$CODE_REPO"
```

## Setup If Missing

### Organization Name

**Note:** Org name check happens in the router (SKILL.md Step 0). This section is for saving the value after user provides it.

Save org name to `~/.aem/ops-config.json` (works from any directory):

```bash
mkdir -p "${HOME}/.aem"
node -e "
  const fs = require('fs');
  const p = process.env.HOME + '/.aem/ops-config.json';
  let c = {};
  try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) {}
  c.org = '{ORG_NAME}';
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
"
```

### Authentication

If `IMS_TOKEN` is empty:

```
Skill({ skill: "project-management:auth" })
```

### Site Detection

```bash
ORG=$(node -e "
  const fs = require('fs');
  try {
    const c = JSON.parse(fs.readFileSync(process.env.HOME + '/.aem/ops-config.json', 'utf8'));
    process.stdout.write(c.org || '');
  } catch(e) {}
")

SITES_JSON=$(curl -s "https://admin.hlx.page/config/${ORG}/sites.json")
SITE_NAMES=$(echo "$SITES_JSON" | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  const sites = JSON.parse(d).sites || [];
  sites.forEach(s => console.log(s.name));
")
SITE_COUNT=$(echo "$SITE_NAMES" | wc -l | tr -d ' ')

echo "Found $SITE_COUNT site(s):"
echo "$SITE_NAMES"
```

- **Single site:** Auto-select and save
- **Multiple sites (repoless):** Ask user to select

### Code Repository (For Code Sync)

```bash
eval $(node -e "
  const fs = require('fs');
  try {
    const c = JSON.parse(fs.readFileSync(process.env.HOME + '/.aem/ops-config.json', 'utf8'));
    console.log('ORG=' + JSON.stringify(c.org || ''));
    console.log('SITE=' + JSON.stringify(c.site || ''));
  } catch(e) { console.log('ORG='); console.log('SITE='); }
")
IMS_TOKEN=$(node -e "
  const fs = require('fs');
  try {
    const t = JSON.parse(fs.readFileSync(process.env.HOME + '/.aem/ims-token.json', 'utf8'));
    if (t.imsToken && t.imsTokenExpiry > Math.floor(Date.now()/1000) + 60) {
      process.stdout.write(t.imsToken);
    }
  } catch (e) {}
")

SITE_CONFIG=$(curl -s -H "Authorization: Bearer ${IMS_TOKEN}" "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json")
eval $(echo "$SITE_CONFIG" | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  const c = JSON.parse(d);
  console.log('CODE_OWNER=' + JSON.stringify(c.code?.owner || ''));
  console.log('CODE_REPO=' + JSON.stringify(c.code?.repo || ''));
")

# Save code owner/repo to ~/.aem/ops-config.json
# Agent should update the file with codeOwner and codeRepo values
```

## Permission Check

Identity comes from `/profile`. Roles on the current site are read from `/config/{org}/sites/{site}.json` under `access.admin.role` (a map of role name → list of user emails), not from a separate `/access.json` endpoint.

Use `node` to parse JSON so nested structures are handled correctly:

```bash
PROFILE=$(curl -s -H "Authorization: Bearer ${IMS_TOKEN}" "https://admin.hlx.page/profile")
USER_EMAIL=$(echo "$PROFILE" | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  console.log(JSON.parse(d).profile?.email || '');
")

SITE_CONFIG=$(curl -s -H "Authorization: Bearer ${IMS_TOKEN}" "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json")

ROLES_ON_SITE=$(echo "$SITE_CONFIG" | USER_EMAIL="$USER_EMAIL" node -e "
  const d = require('fs').readFileSync(0,'utf8');
  const email = process.env.USER_EMAIL || '';
  try {
    const data = JSON.parse(d);
    const block = data.access?.admin?.role || {};
    const matched = [];
    for (const [name, value] of Object.entries(block)) {
      if (Array.isArray(value) && value.includes(email)) matched.push(name);
      else if (value === email) matched.push(name);
    }
    console.log(matched.join(' '));
  } catch(e) { console.log(''); }
")

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

Ops config (`~/.aem/ops-config.json`) stores project context — no tokens:

```json
{
  "org": "myorg",
  "site": "site-a",
  "sites": ["site-a", "site-b"],
  "isRepoless": true,
  "ref": "main",
  "codeOwner": "adobe",
  "codeRepo": "shared-eds-code"
}
```

Auth token is stored separately at `~/.aem/ims-token.json`. See the auth skill for details.
