---
name: ops-config
description: Shared configuration loader for Edge Delivery Services admin operations. Loads org, site, auth token, and code repo settings. Used by all ops resource skills.
allowed-tools: Read, Write, Edit, Bash, Skill
---

# Edge Delivery Services Operations - Configuration Module

Shared configuration loading and setup for all ops operations.

## When to Use

- **Always loaded first** by every ops resource skill before executing any operation
- Extracting org, site, ref, and auth token from `.claude-plugin/project-config.json`
- Parsing org/site/ref/path from a user-supplied AEM URL (`*.aem.page` / `*.aem.live`)
- Saving a new org or site name when the project config is missing or incomplete
- Triggering re-authentication when the stored auth token is expired or absent

## Load Configuration

```bash
CONFIG=$(cat .claude-plugin/project-config.json 2>/dev/null)
ORG=$(echo "$CONFIG" | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
AUTH_TOKEN=$(echo "$CONFIG" | grep -o '"authToken"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"authToken"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
IMS_TOKEN=$(echo "$CONFIG" | grep -o '"imsToken"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"imsToken"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
SITE=$(echo "$CONFIG" | grep -o '"site"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"site"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
REF=$(echo "$CONFIG" | grep -o '"ref"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"ref"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
CODE_OWNER=$(echo "$CONFIG" | grep -o '"codeOwner"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"codeOwner"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
CODE_REPO=$(echo "$CONFIG" | grep -o '"codeRepo"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"codeRepo"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

REF=${REF:-main}

echo "org=$ORG site=$SITE ref=$REF auth=${AUTH_TOKEN:+set} ims=${IMS_TOKEN:+set} codeOwner=$CODE_OWNER codeRepo=$CODE_REPO"
```

## Parse from AEM URL

**If the user's request contains an AEM URL**, use this block to extract `REF`, `SITE`, `ORG`, and `PATH` directly from it. These values override anything loaded from saved config.

Supports both `*.aem.page` and `*.aem.live` URLs, trailing slashes, root paths, and hyphenated ref/site/org names (e.g. `feature-x`, `hmns-uat-qa-da`).

```bash
eval $(python3 -c "
import re

url = '{USER_PROVIDED_URL}'
url = url.rstrip('/') or '/'

m = re.match(r'https://(.+)\.aem\.(?:page|live)(/.+)?', url)
if m:
    hostname = m.group(1)          # e.g. 'uat--hmns-uat-kw--alshaya-axp'
    path = (m.group(2) or '/').rstrip('/') or '/'
    parts = hostname.split('--')   # split on double-hyphen separator
    if len(parts) >= 3:
        ref  = parts[0]            # first segment
        org  = parts[-1]           # last segment
        site = '--'.join(parts[1:-1])  # everything in between (preserves hyphens)
        print(f'REF={ref}')
        print(f'SITE={site}')
        print(f'ORG={org}')
        print(f'PATH={path}')
    else:
        print('# Could not split hostname into ref--site--org parts')
else:
    print('# URL did not match AEM pattern — using saved config values')
" 2>/dev/null)

echo "Parsed: org=$ORG site=$SITE ref=$REF path=$PATH"
```

**Examples:**

| User URL | REF | SITE | ORG | PATH |
|----------|-----|------|-----|------|
| `https://uat--hmns-uat-kw--alshaya-axp.aem.page/en/shop-women` | `uat` | `hmns-uat-kw` | `alshaya-axp` | `/en/shop-women` |
| `https://main--eds-web--alshaya-axp.aem.page/` | `main` | `eds-web` | `alshaya-axp` | `/` |
| `https://uat--hmns-uat-qa-da--alshaya-axp.aem.live/en/help-center/` | `uat` | `hmns-uat-qa-da` | `alshaya-axp` | `/en/help-center` |
| `https://feature-x--my-site--my-org.aem.page/en/blog/post` | `feature-x` | `my-site` | `my-org` | `/en/blog/post` |

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
SITES_JSON=$(curl -s "https://admin.hlx.page/config/${ORG}/sites.json")
SITE_NAMES=$(echo "$SITES_JSON" | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
SITE_COUNT=$(echo "$SITE_NAMES" | wc -l | tr -d ' ')

echo "Found $SITE_COUNT site(s):"
echo "$SITE_NAMES"
```

- **Single site:** Auto-select and save to config
- **Multiple sites (repoless):** Ask user to select which site to operate on

> **Repoless note:** When multiple sites are detected, they share a single code repository. Code sync (`sync code`) will affect **all sites** — proceed with care. Preview, publish, cache, and index operations remain per-site.

### Content Source Detection

Run this after `SITE` is known to determine whether the site uses DA (Document Authoring) or an external source (SharePoint/Google Drive). Store the result in `CONTENT_SOURCE_TYPE` and `IS_DA_SITE`.

```bash
SITE_CONFIG=$(/usr/bin/curl -s -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json")

CONTENT_SOURCE_TYPE=$(echo "$SITE_CONFIG" | /usr/bin/python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('content', {}).get('source', {}).get('type', 'unknown'))
except:
    print('unknown')
")

# markup = DA (Document Authoring), onedrive = SharePoint, google = Google Drive
if [ "$CONTENT_SOURCE_TYPE" = "markup" ]; then
  IS_DA_SITE="true"
else
  IS_DA_SITE="false"
fi

echo "Content source: $CONTENT_SOURCE_TYPE (DA site: $IS_DA_SITE)"
```

| `CONTENT_SOURCE_TYPE` | Source | DA Recommendations |
|---|---|---|
| `markup` | Document Authoring (DA) | ✅ Show |
| `onedrive` | SharePoint | ❌ Skip |
| `google` | Google Drive | ❌ Skip |
| `unknown` | Not configured / error | ❌ Skip |

**Rule:** Only include DA-related recommended next actions when `IS_DA_SITE="true"`.

### Code Repository (For Code Sync)

```bash
SITE_CONFIG=$(curl -s -H "x-auth-token: ${AUTH_TOKEN}" "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json")
CODE_OWNER=$(echo "$SITE_CONFIG" | grep -o '"owner"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/"owner"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
CODE_REPO=$(echo "$SITE_CONFIG" | grep -o '"repo"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/"repo"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

python3 -c "
import json
with open('.claude-plugin/project-config.json') as f: c = json.load(f)
c['codeOwner'] = '${CODE_OWNER}'
c['codeRepo'] = '${CODE_REPO}'
with open('.claude-plugin/project-config.json', 'w') as f: json.dump(c, f, indent=2)
print('Saved: codeOwner=${CODE_OWNER} codeRepo=${CODE_REPO}')
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

## Success Criteria

- ✅ All required variables loaded: `ORG`, `SITE`, `REF`, `AUTH_TOKEN`
- ✅ AEM URL parsed correctly into `ORG`, `SITE`, `REF`, `PATH` when provided
- ✅ Missing org or auth token detected early and user prompted before any API call is made
- ✅ Auth re-triggered automatically when `AUTH_TOKEN` is absent or expired
