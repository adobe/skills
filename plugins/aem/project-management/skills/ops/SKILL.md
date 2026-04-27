---
name: ops
description: Execute AEM Edge Delivery Services admin operations - list admins, add/remove users, preview, publish, unpublish content, clear cache, sync code, reindex, generate sitemap, manage snapshots, view logs, manage jobs, list sites, configure org/site settings, manage secrets and API keys. Use for any Edge Delivery Services administrative task.
license: Apache-2.0
allowed-tools: Read, Write, Edit, Bash, Skill
metadata:
  version: "1.0.0"
---

# Edge Delivery Services Admin Operations

Execute admin operations on AEM Edge Delivery Services projects using natural language commands.

## Quick Reference

| Category | Examples |
|----------|----------|
| **Content** | preview /path, publish /path, unpublish /path, status /path |
| **Cache** | clear cache /path, force clear cache |
| **Code** | sync code, deploy code |
| **Index** | reindex /path, remove from index |
| **Sitemap** | generate sitemap |
| **Snapshots** | create snapshot X, publish snapshot X, approve snapshot X |
| **Logs** | show logs, show logs last hour |
| **Users** | add user@email as author/publish/develop, remove admin user@email, who am i |
| **Jobs** | list jobs, job status X, stop job X |
| **Sites** | list sites, switch to site-X, use branch feature-X |
| **Config** | show org config, show site config, update robots.txt |
| **Secrets** | list secrets, create secret, delete secret |
| **API Keys** | list API keys, create API key, revoke API key |
| **Tokens** | list tokens, create token, revoke token |
| **Profiles** | show profile config, create profile, delete profile |
| **Index Config** | show index config, update index config (query.yaml) |
| **Sitemap Config** | show sitemap config, update sitemap config (sitemap.yaml) |
| **Versioning** | list versions, restore version, rollback config |
| **Pages** | list pages, list all pages, show indexed pages |

---

## Communication Guidelines

- **NEVER use "EDS"** as an acronym for Edge Delivery Services in any responses
- Always use the full name "Edge Delivery Services" or "AEM Edge Delivery Services"
- Show clear, actionable error messages when operations fail
- Confirm destructive operations before executing

---

## Welcome Message

If user invokes the skill without a specific command (e.g., just `/ops` or "help me with ops"), show:

```
Edge Delivery Services Operations

Quick commands to try:
  list pages       - Show all indexed pages
  who am i         - Check your user profile
  list sites       - Show available sites
  show site config - View site configuration
  preview /path    - Preview a content path
  show logs        - View recent activity

For the full command list: type help, /ops help, or what can you do? (slash commands may be /ops help or /ops what can you do? depending on your client).
```

---

## Cross-Platform Notes

Shell commands in this skill use POSIX-compatible syntax (works on macOS/Linux). On Windows:
- **Git Bash / WSL**: Commands work as-is
- **PowerShell**: Claude Code will translate commands automatically using available shell

**curl:** All examples use `--connect-timeout 15` and `--max-time 120` so a stuck network does not hang the session. For unusually large responses (e.g. huge logs), you may increase `--max-time` for that call.

The agent executing these commands should adapt syntax to the user's environment.

---

## Intent Router

Analyze user request and load the appropriate resource module.

### Step 0: Get Organization Name (REQUIRED FIRST)

**Before ANY operation**, check if org name exists in saved config:

```bash
ORG=$(cat .claude-plugin/project-config.json 2>/dev/null | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
echo "org=${ORG:-NOT SET}"
```

**If `ORG` is empty**, you MUST pause and ask the user:

> "What is your Config Service organization name? This is the `{org}` part of your Edge Delivery Services URLs (e.g., `https://main--site--{org}.aem.page`).
>
> **Note:** The org name may differ from your GitHub organization, especially in repoless multi-site setups."

**STRICTLY FORBIDDEN - Do NOT attempt any of these to get org name:**
- `git remote -v` - GitHub org often differs from Config Service org
- Reading `fstab.yaml` - Does not contain org name
- Inferring from folder/repo names - Unreliable
- Any other inference method

**ONLY use the org name from:**
- Saved config (`.claude-plugin/project-config.json`)
- Direct user input when prompted

**Do NOT proceed until org is confirmed.**

### Step 1: Authenticate (REQUIRED)

**Before ANY API call**, check if auth token exists:

```bash
AUTH_TOKEN=$(cat .claude-plugin/project-config.json 2>/dev/null | grep -o '"authToken"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"authToken"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
echo "auth=${AUTH_TOKEN:+set}"
```

**If `AUTH_TOKEN` is empty or missing**, you MUST invoke the auth skill BEFORE proceeding:

```
Skill({ skill: "project-management:auth" })
```

This opens a browser via Playwright for Adobe ID login and saves the token to `.claude-plugin/project-config.json`.

**IMPORTANT:** Do NOT skip this step. Do NOT attempt any API calls without a valid auth token. The auth skill handles the entire authentication flow.

### Step 2: Load Full Configuration and Validate Role

After auth is confirmed, load config and verify user role:

```bash
CONFIG=$(cat .claude-plugin/project-config.json 2>/dev/null)
ORG=$(echo "$CONFIG" | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
AUTH_TOKEN=$(echo "$CONFIG" | grep -o '"authToken"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"authToken"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
SITE=$(echo "$CONFIG" | grep -o '"site"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"site"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
REF=$(echo "$CONFIG" | grep -o '"ref"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"ref"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
USER_ROLE=$(echo "$CONFIG" | grep -o '"userRole"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"userRole"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

REF=${REF:-main}
echo "Config: org=$ORG site=$SITE ref=$REF role=$USER_ROLE auth=${AUTH_TOKEN:+set}"
```

**If `USER_ROLE` is empty** (not yet cached), fetch profile to verify auth and record user identity:

```bash
PROFILE_RESPONSE=$(curl -s --connect-timeout 15 --max-time 120 -w "\n%{http_code}" -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/profile")
HTTP_CODE=$(echo "$PROFILE_RESPONSE" | tail -n1)
PROFILE=$(echo "$PROFILE_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "401" ]; then
  echo "Auth token expired. Re-authenticate required."
  # Clear cached token and re-run auth skill
  exit 1
elif [ "$HTTP_CODE" != "200" ]; then
  echo "Failed to fetch profile (HTTP $HTTP_CODE). Check network/API status."
  exit 1
fi

# Profile response: {"profile": {"email": "...", "name": "...", "ttl": ...}}
USER_EMAIL=$(echo "$PROFILE" | grep -o '"email"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"email"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
USER_NAME=$(echo "$PROFILE" | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

echo "Authenticated as: $USER_EMAIL ($USER_NAME)"
```

**Important:** The `/profile` endpoint does **not** return a role. To determine if the user is admin or author on a site, check the site access config:

```bash
# Determine user role on the current site
ACCESS_RESPONSE=$(curl -s --connect-timeout 15 --max-time 120 -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json")
# Check which role(s) the user's email appears in within access.admin.role
# Roles: admin, author, publish, basic_author, basic_publish, develop, config, config_admin
```

If an operation returns 403, inform the user which role is required. Key role requirements:
- **Preview** → `basic_author`, `author`, `publish`, or `admin`
- **Publish to live** → `basic_publish`, `publish`, or `admin`
- **Unpublish from live** → `publish` or `admin`
- **Code sync** → `develop` or `admin`
- **Config read** → `config`, `config_admin`, or `admin`
- **Config write** → `config_admin` or `admin`
- **Snapshot manage** → `author`, `publish`, or `admin`

Do not block all operations because role cannot be pre-determined — let the API enforce permissions and surface 403 errors.

Save `email` to `.claude-plugin/project-config.json` for future use.

Read `resources/config.md` for setup instructions if site or other values are missing.

### Step 3: Route by Intent

| User Intent | Resource Module |
|-------------|-----------------|
| preview, publish, unpublish, status, delete preview | `resources/content.md` |
| cache, purge, clear cache, invalidate | `resources/cache.md` |
| sync code, deploy code, update code | `resources/code.md` |
| reindex, index, remove from index, search | `resources/index.md` |
| sitemap, generate sitemap | `resources/sitemap.md` |
| snapshot, staged release, bundle | `resources/snapshots.md` |
| logs, audit, activity | `resources/logs.md` |
| user, access, permission, who am i, add user, remove user | `resources/users.md` |
| job, bulk operation, stop job | `resources/jobs.md` |
| site, branch, switch, list sites | `resources/sites.md` |
| org config, site config, robots.txt | `resources/config-api.md` |
| secret, secrets, create secret, delete secret | `resources/secrets.md` |
| API key, apikey, create key, revoke key | `resources/apikeys.md` |
| token, tokens, access token | `resources/tokens.md` |
| profile config, profile settings | `resources/profiles.md` |
| index config, helix-index, search config | `resources/index-config.md` |
| sitemap config, helix-sitemap, sitemap rules | `resources/sitemap-config.md` |
| version, versions, history, rollback, restore | `resources/versioning.md` |
| pages, list pages, indexed pages, all pages | `resources/pages.md` |

### Step 4: Read Resource and Execute

1. Read the appropriate resource file from `resources/`
2. Follow instructions in that resource
3. Execute the API call
4. Handle response per completion standards below

### Completion Standards

| HTTP Response | What It Means | Required Action |
|---------------|---------------|-----------------|
| **200/201** | Success | Display result with full URLs (`https://{ref}--{site}--{org}.aem.page{path}`) |
| **202** | Async job started | Report job name and instruct: `check job status {jobName}` to track progress |
| **204** | Success (no body) | Confirm completion: "{action} completed for {path}" |
| **4xx/5xx** | Error | Show API error verbatim, then suggest fix per Error Handling table |

**Before reporting success:**
- For content operations: Include both preview and live URLs where applicable
- For bulk operations: Never say "published" or "previewed" — say "job started" until job completes
- For destructive operations: Confirm what was removed and what still exists (e.g., "Unpublished from live. Preview still available.")

---

## Intent Detection Patterns

### Content Operations
- Keywords: preview, publish, unpublish, live, status, check
- Path indicators: `/path`, "homepage", "the nav", "footer"
- Bulk indicators: "and", comma-separated paths, "all pages under"

### Cache Operations
- Keywords: cache, purge, clear, invalidate, bust
- Modifiers: force, hard

### Code Operations
- Keywords: sync, deploy, code, update code
- File paths: blocks/, scripts/, styles/

### Index Operations
- Keywords: reindex, index, search, remove from search

### Sitemap Operations
- Keywords: sitemap, site map

### Snapshot Operations
- Keywords: snapshot, staged, release, bundle
- Actions: create, add, remove, publish, delete, lock, approve, reject

### Log Operations
- Keywords: logs, log, audit, activity, what happened
- Time: last hour, last 24h, yesterday

### User Management
- Keywords: user, access, permission, admin, author
- Actions: add, remove, list, who

### Job Management
- Keywords: job, jobs, bulk, running, stop, cancel

### Site/Branch Management
- Keywords: site, sites, branch, switch
- Repoless: "on site-X", "all sites"

### Configuration API
- Keywords: org config, site config, robots.txt, configuration
- Actions: show, read, update, create, delete

### Secrets Management
- Keywords: secret, secrets
- Actions: list, create, add, delete, remove

### API Key Management
- Keywords: API key, apikey, token
- Actions: list, create, generate, revoke, delete

### Profile Configuration
- Keywords: profile, profile config, profile settings
- Actions: show, read, create, update, delete

### Index Configuration
- Keywords: index config, helix-index, search config, indexing rules
- Actions: show, read, create, update, delete

### Sitemap Configuration
- Keywords: sitemap config, helix-sitemap, sitemap rules
- Actions: show, read, create, update, delete

### Versioning
- Keywords: version, versions, history, rollback, restore
- Actions: list, show, view, restore, delete

### Pages
- Keywords: pages, list pages, indexed pages, all pages, show pages
- Actions: list, show, filter

### Help
- Triggers: `help`, `what can you do?`, `/ops help`, `/ops what can you do?`, "list commands", "show available commands" — show the **Help Response** block in this file (no resource module).

---

## Security & Confirmation Requirements

**CRITICAL: Always confirm before executing destructive operations.**

### Destructive Operations (Require User Confirmation)

| Operation | Resource | Risk Level |
|-----------|----------|------------|
| Unpublish (single/bulk) | `content.md` | HIGH - Removes from live site |
| Delete preview | `content.md` | MEDIUM |
| Delete code | `code.md` | HIGH - Affects all sites in repoless |
| Remove from index | `index.md` | MEDIUM - Removes from search |
| Delete snapshot | `snapshots.md` | MEDIUM |
| Remove user | `users.md` | HIGH - Revokes access |
| Stop job | `jobs.md` | LOW |
| Delete org/site config | `config-api.md` | CRITICAL - Can break site |
| Delete secret | `secrets.md` | HIGH - Can break integrations |
| Revoke API key | `apikeys.md` | HIGH - Can break CI/CD |

### Confirmation Protocol

Before ANY destructive operation:

1. **State the action clearly**: "This will unpublish /products/old-widget from the live site"
2. **Explain the impact**: "Users will get a 404 error when visiting this URL"
3. **Ask for explicit confirmation**: "Do you want to proceed? (yes/no)"
4. **Only execute after user confirms with "yes"**

### Token Security

- Auth tokens are stored in `.claude-plugin/project-config.json`
- This directory MUST be in `.gitignore`
- Tokens expire after ~24 hours
- Never log or display full token values

---

## URL Parsing Helper

If user provides an AEM URL instead of separate org/site/path values, extract context:

```bash
# Pattern: https://{ref}--{site}--{org}.aem.page{path} or .aem.live{path}
# The hostname is split on -- (double hyphen), not on single - (hyphenated org/site names use single -).
URL="$USER_INPUT"
if echo "$URL" | grep -q '\.aem\.page\|\.aem\.live'; then
  DOMAIN=$(echo "$URL" | cut -d'/' -f3)
  HOST_PART=$(echo "$DOMAIN" | cut -d'.' -f1)
  REF=$(echo "$HOST_PART" | awk -F'--' '{print $1}')
  ORG=$(echo "$HOST_PART" | awk -F'--' '{print $NF}')
  SITE=$(echo "$HOST_PART" | awk -F'--' '{
    r=""; for(i=2;i<NF;i++) r=(r==""?"":r"--")$i; print r
  }')
  URL_PATH=$(echo "$URL" | sed 's|https://[^/]*||')
  URL_PATH=${URL_PATH:-/}
  echo "Parsed from URL: org=$ORG site=$SITE ref=$REF path=$URL_PATH"
fi
```

**Examples (hyphenated `ref` / `site` / `org`):** `uat--hmns-uat-kw--alshaya-axp.aem.page` → `ref=uat`, `site=hmns-uat-kw`, `org=alshaya-axp`.

Use this when user pastes a URL like `https://main--mysite--myorg.aem.page/en/products` to extract the path for operations. Still follow the standard org/auth flow for config validation.

---

## Prerequisites

This skill works with AEM Edge Delivery Services projects that are:

1. **Onboarded to Admin Service** - Project must have admin.hlx.page access
2. **User has Adobe IMS account** - Required for authentication
3. **User has a site role that allows the operation** - Roles are defined in the site configuration (`access.admin.role`). The Admin API defines eight roles: `admin`, `author`, `publish`, `develop`, `basic_author`, `basic_publish`, `config`, and `config_admin`. Each operation needs the matching permission; if the user lacks it, the API returns **403**. Do not assume only "admin" or "author" — use the **403 guidance** and role table earlier in this file when explaining permission errors.
4. **Network access** - Can reach admin.hlx.page (not blocked by firewall)

---

## Error Handling

When API returns an error, explain the cause and how to fix it:

| HTTP Code | Cause | Tell User | Fix |
|-----------|-------|-----------|-----|
| **400** | Malformed request | "The request format is invalid. Check the path or payload syntax." | Review path format, ensure JSON/YAML is valid |
| **401** | Token expired or missing | "Your session has expired. You need to log in again." | Run `Skill({ skill: "project-management:auth" })` |
| **403** | Insufficient permissions | Show actual API error message. If none, say: "You don't have permission for this operation." | Contact site admin to grant access |
| **404** (on path) | Content doesn't exist | "The path '{path}' was not found. Check if it exists in your content source." | Verify path spelling, check SharePoint/Drive |
| **404** (on org/site) | Org or site not configured | "The organization '{org}' or site '{site}' is not found. It may not be onboarded to Admin Service." | Verify org/site names, contact Adobe support if new project |
| **409** | Conflict (e.g., already exists) | "This resource already exists. Use update instead of create." | Use POST instead of PUT |
| **422** | Invalid content | "The content failed validation: {error details from API}" | Fix the specific validation error returned |
| **429** | Rate limited | "Too many requests. Wait a moment before retrying." | Wait 30-60 seconds, then retry |
| **500** | Server error | "The Admin Service encountered an error. This is temporary." | Wait and retry; if persistent, check status.adobe.com |
| **502/503** | Service unavailable | "The Admin Service is temporarily unavailable." | Wait a few minutes and retry |

**Always show the actual API error message** when available - it often contains specific details.

---

## Help Response

When the user wants the command list, show the block below. Match **help**, **what can you do?**, the same with a **/ops** prefix (e.g. `/ops help`, `/ops what can you do?`), or short phrases like **list commands** / **show available commands**:

```
Content Operations:
  preview /path          - Update preview
  publish /path          - Publish to live
  unpublish /path        - Remove from live (requires publish or admin role)
  status /path           - Check preview/live status

Cache Operations:
  clear cache /path      - Purge CDN cache
  force clear cache      - Force purge

Code Operations:
  sync code              - Deploy latest code

Index Operations:
  reindex /path          - Re-index for search

Sitemap:
  generate sitemap       - Create sitemap.xml

Snapshots:
  create snapshot {name} - Create staged release
  publish snapshot {name}- Publish all in snapshot

Logs:
  show logs              - View recent logs
  show logs last hour    - Filtered by time

Users:
  add user@email as role - Grant access
  remove role user@email - Revoke access
  who am i               - Current user

Jobs:
  list jobs              - Show bulk operations
  stop job {name}        - Cancel job

Sites:
  list sites             - Show all sites
  switch to site-x       - Change active site
  use branch feat-x      - Set branch

Config:
  show org config        - View org settings
  show site config       - View site settings
  update robots.txt      - Modify crawler rules

Secrets:
  list secrets           - Show secrets
  create secret {name}   - Add new secret
  delete secret {name}   - Remove secret

API Keys:
  list API keys          - Show API keys
  create API key {name}  - Generate new key
  revoke API key {id}    - Delete key

Profiles:
  show profile config    - View profile settings
  create profile {id}    - Create profile config
  delete profile {id}    - Remove profile config

Index Config:
  show index config      - View query.yaml (index config)
  update index config    - Modify indexing rules

Sitemap Config:
  show sitemap config    - View sitemap.yaml (sitemap config)
  update sitemap config  - Modify sitemap rules

Versioning:
  list versions          - Show config history
  restore version {id}   - Rollback to version

Pages:
  list pages             - Show all indexed pages
  list pages /blog       - Filter by path prefix
```
