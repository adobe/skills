---
name: ops
description: Execute AEM Edge Delivery Services admin operations - list admins, add/remove users, preview, publish, unpublish content, clear cache, sync code, reindex, generate sitemap, manage snapshots, view logs, manage jobs, list sites, configure org/site settings, manage secrets and API keys. Also supports Document Authoring (DA) operations via admin.da.live - list/get/put content, copy, move, delete, versioning, and DA-specific preview/publish. Use for any Edge Delivery Services administrative task.
license: Apache-2.0
allowed-tools: Read, Write, Edit, Bash, Skill
metadata:
  version: "1.1.0"
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
| **DA (Document Authoring)** | da list, da source /path, da copy, da move, da delete, da config, da update config, da versions, da create version, da upload media, da auth |

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

The agent executing these commands should adapt syntax to the user's environment.

---

## Intent Router

Analyze user request and load the appropriate resource module.

### Step 0: Get Organization Name (REQUIRED FIRST)

**Before ANY operation**, check if org name exists in saved config:

```bash
ORG=$(cat .claude-plugin/project-config.json 2>/dev/null | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try { console.log(JSON.parse(d).org || ''); } catch(e) { console.log(''); }
")
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

**Before ANY API call**, check if IMS token exists:

```bash
IMS_TOKEN=$(cat .claude-plugin/project-config.json 2>/dev/null | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try { console.log(JSON.parse(d).imsToken || ''); } catch(e) { console.log(''); }
")
echo "auth=${IMS_TOKEN:+set}"
```

**If `IMS_TOKEN` is empty**, invoke the auth skill BEFORE proceeding:

```
Skill({ skill: "project-management:auth" })
```

**IMPORTANT:** Do NOT skip this step. Do NOT attempt any API calls without a valid token. Use `Authorization: Bearer ${IMS_TOKEN}` header for all API calls.

### Step 2: Load Full Configuration and Validate Role

After auth is confirmed, load config:

```bash
CONFIG_JSON=$(cat .claude-plugin/project-config.json 2>/dev/null)
eval $(echo "$CONFIG_JSON" | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  const c = JSON.parse(d);
  console.log('ORG=' + JSON.stringify(c.org || ''));
  console.log('IMS_TOKEN=' + JSON.stringify(c.imsToken || ''));
  console.log('SITE=' + JSON.stringify(c.site || ''));
  console.log('REF=' + JSON.stringify(c.ref || 'main'));
")
echo "Config: org=$ORG site=$SITE ref=$REF auth=${IMS_TOKEN:+set}"
```

**Fetch profile** to verify auth and record user identity:

```bash
PROFILE_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/profile")
HTTP_CODE=$(echo "$PROFILE_RESPONSE" | tail -n1)
PROFILE=$(echo "$PROFILE_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "401" ]; then
  echo "Auth token expired. Clearing cached token..."
  # Remove expired token from config
  node -e "
    const fs = require('fs');
    const p = '.claude-plugin/project-config.json';
    let c = {};
    try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) {}
    delete c.imsToken;
    delete c.imsTokenExpiry;
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
  " 2>/dev/null
  echo "REAUTH_REQUIRED"
  exit 1
elif [ "$HTTP_CODE" != "200" ]; then
  echo "Failed to fetch profile (HTTP $HTTP_CODE). Check network/API status."
  exit 1
fi

# Profile response: {"profile": {"email": "...", "name": "...", "ttl": ...}}
eval $(echo "$PROFILE" | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try {
    const p = JSON.parse(d).profile || {};
    console.log('USER_EMAIL=' + JSON.stringify(p.email || ''));
    console.log('USER_NAME=' + JSON.stringify(p.name || ''));
  } catch(e) { console.log('USER_EMAIL=\"\"'); console.log('USER_NAME=\"\"'); }
")

echo "Authenticated as: $USER_EMAIL ($USER_NAME)"
```

**Important:** The `/profile` endpoint does **not** return a role. To determine if the user is admin or author on a site, check the site access config:

```bash
# Determine user role on the current site
ACCESS_RESPONSE=$(curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
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
| da, da list, da source, da copy, da move, da delete, da config, da versions | `resources/da.md` |

### Step 4: Read Resource and Execute

1. Read the appropriate resource file from `resources/`
2. Follow instructions in that resource
3. **For config updates**: Always GET current config first and show it to the user before modifying
4. **For code sync**: Always check repoless status before syncing (see `code.md`)
5. **For destructive operations**: Follow the Confirmation Protocol — no exceptions
6. Execute the API call
7. Handle response per completion standards below

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

### Document Authoring (DA)
- Keywords: da, da list, da source, da content, da files, da copy, da move, da delete, da config, da update config, da versions, da create version, da upload, da media, da auth, da login
- Prefix: "da " before any action indicates DA admin API (admin.da.live)
- Actions: list, get, source, copy, move, delete, config, versions, create version, restore, upload, media, auth, login
- Note: Requires IMS token authentication (same IMS token, different API base URL from admin.hlx.page)
- Note: Copy/move use form-data with `destination` field (not JSON). Config uses form-data with `config` field.
- Note: No dedicated restore endpoint — restore is: list versions → get version content → write back to source

### Help
- Triggers: `help`, `what can you do?`, `/ops help`, `/ops what can you do?`, "list commands", "show available commands" — show the **Help Response** block in this file (no resource module).

---

## Security & Confirmation Requirements

**CRITICAL: Always confirm before executing destructive operations.**

### Destructive Operations (Require User Confirmation)

| Operation | Resource | Risk Level |
|-----------|----------|------------|
| Unpublish (single/bulk) | `content.md` | HIGH - Removes from live site |
| Bulk publish (> 50 paths) | `content.md` | MEDIUM - Large surface area, partial failures possible |
| Delete preview | `content.md` | MEDIUM |
| Delete code | `code.md` | HIGH - Affects all sites in repoless |
| Purge all cache (wildcard) | `cache.md` | MEDIUM - Site-wide cache miss spike |
| Remove from index | `index.md` | MEDIUM - Removes from search |
| Delete snapshot | `snapshots.md` | MEDIUM |
| Remove resource from snapshot | `snapshots.md` | LOW - Changes staged release contents |
| Remove user | `users.md` | HIGH - Revokes access |
| Stop job | `jobs.md` | MEDIUM - Can leave content half-published |
| Delete org/site config | `config-api.md` | CRITICAL - Can break site |
| Config update (org/site) | `config-api.md` | HIGH - POST replaces entire config; can break site if malformed |
| Delete secret | `secrets.md` | HIGH - Can break integrations |
| Revoke API key | `apikeys.md` | HIGH - Can break CI/CD |
| DA delete | `da.md` | HIGH - Permanently deletes from DA |
| DA copy (overwrite) | `da.md` | MEDIUM - Can silently overwrite destination |
| DA move/rename (overwrite) | `da.md` | MEDIUM - Can silently overwrite destination |
| DA update config | `da.md` | HIGH - Can lock out all users if CONFIG write permission missing |
| Revoke token | `tokens.md` | HIGH - Can break access |
| Delete config version | `versioning.md` | MEDIUM - Permanently removes config history |
| Restore config version | `versioning.md` | HIGH - Replaces current config |
| Delete profile config | `profiles.md` | MEDIUM - Removes profile settings |
| Delete index config | `index-config.md` | MEDIUM - Removes search indexing rules |
| Delete sitemap config | `sitemap-config.md` | MEDIUM - Removes sitemap rules |

### Non-Destructive but Dangerous Operations

These operations don't delete anything but can still cause outages if misused:

| Operation | Risk | Guardrail |
|-----------|------|-----------|
| **Config update (POST)** | Malformed config can break the entire site | Always GET current config first, show to user, confirm change before POST |
| **Code sync in repoless** | Affects ALL sites sharing the repo | Always check site count first; warn and list all sites if > 1 |
| **Bulk preview/publish (> 50 paths)** | Large jobs tie up resources and can fail partially | Show path list, confirm, suggest batching for > 100 paths |
| **Wildcard bulk operations** | Can trigger thousands of jobs | Explain that `/*` creates an async job that may process all pages |
| **DA config update** | Must include CONFIG write permission or locks out everyone | Validate config JSON includes a CONFIG write entry before sending |

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
- Never store secret values, API keys, or access token values in config files

### Secret / API Key / Token Creation Safety

Secrets, API keys, and access tokens return their value **only once** at creation.

Before creating:
1. Warn the user: "The value will only be shown once. Make sure you're ready to store it securely."
2. Only proceed after user confirms they are ready.

After creation:
1. Display the value clearly and instruct: "Copy this value now. It cannot be retrieved again."
2. Never store the returned value in `.claude-plugin/project-config.json` or any tracked file.

### Config Update Safety

Before ANY config update (org, site, profile, or DA config):

1. **Always GET the current config first** — show it to the user so they understand the current state.
2. **Show the proposed change** — present a clear diff or summary of what will change.
3. **Warn about potential impact** — a malformed config body can break the site.
4. **For DA config updates** — the config JSON **must** include at least one entry granting CONFIG write permission. Sending a config without it will lock everyone out (requires Cloudflare KV escalation to fix).

### Publish Safety

- If user says "publish" without a preceding preview, suggest: "Do you want me to preview first, then publish?"
- For bulk operations > 50 paths, always show the path list and ask for confirmation.
- For wildcard bulk operations (`/*`), explain that this creates an async job and may process thousands of pages.

### Error Recovery

| Scenario | Recovery |
|----------|----------|
| Accidental unpublish | Re-publish: `POST /live/{org}/{site}/{ref}/{path}` |
| Accidental config delete | Restore from version: `POST /config/{org}.json?restoreVersion={id}` (list versions first) |
| Accidental secret/key delete | Cannot be recovered — create a new one and update all integrations |
| Bad config update broke site | List config versions, find last good one, restore it |
| Bulk job running wild | Stop it: `DELETE /job/{org}/{site}/{ref}/{topic}/{jobName}` |
| DA content accidentally deleted | Check if a version exists via `/versionlist/` — restore from version if available |
| DA config locked everyone out | Requires Cloudflare KV access to fix — escalate to DA admin team |

---

## Sensitive Data Handling

Many of these endpoints return secrets, credentials, PII, or organizational metadata. Operating on a real customer org is normal usage — but the responses must be handled with care so they do not leak into chat history, terminal scrollback, or memory.

### Sensitive endpoints (default to summarized output)

| Endpoint | Sensitive content |
|----------|-------------------|
| `/config/{org}/apiKeys.json`, `/config/{org}/sites/{site}/apiKeys.json` | API key IDs, expiration, role/subject metadata; `value` (JWT) on create |
| `/config/{org}/sites/{site}/tokens.json` | Token IDs; `value` (`hlx_…`) on create |
| `/config/{org}/sites/{site}/secrets.json` | Secret names; `value` on create |
| `/config/{org}.json`, `/config/{org}/sites/{site}.json` | User emails, role mappings, allowed domains, content source URLs, contentBusId |
| `/config/{org}/users.json` | User emails and IDs |
| `/log/{org}/{site}/{ref}` | User emails, IPs, paths edited, timestamps |
| `/profile` | IMS user ID, session IDs, scopes |

### Default behavior on these endpoints

These rules apply unconditionally on every org — personal, sandbox, dev, stage, prod, customer. There is no carve-out: customer dev/stage/sandbox environments hold real PII just like prod. Do not rationalize past them — the user's verb ("list", "show", "get") is a request for the data, NOT a request to un-redact. The redacted view IS the requested data.

1. **Lead with a summary, not the raw payload.** Example: "Found 3 API keys (IDs: …). Want me to show full details?" — not a dump of the full JSON.
2. **Redact emails by default.** Show `<3 admin users>` or `j***@example.com` on the first response, regardless of org type or naming.
3. **Never echo a credential `value` field a second time.** It must be displayed exactly once at creation, with the instruction to copy it now. Do not include it in any later message, summary, or memory write.
4. **Only these exact phrases un-redact:** "show full", "show un-redacted", "show raw", "show emails". Imperative verbs alone ("list users", "show users") do NOT — they request the data, served redacted by default.

### First-touch awareness

Before the first sensitive operation against any org in a session, surface a one-line note:

> "Querying org `{org}`. I'll redact emails by default — say 'show full' to see un-redacted output."

This applies uniformly. The org's name (test/dev/stage/prod/personal) does not change the rule.

### Memory rules

Never write to memory:

- API key IDs, JWTs, or `value` fields
- Token IDs or `hlx_…` secret strings
- Secret names paired with their values
- User emails from log entries or config dumps (memorize names/roles abstractly: "alice manages auth setup", not "alice@example.com")
- Full config bodies (role mappings, contentBusId, source URLs)
- IMS tokens, session IDs, IPs, or anything from `/profile`

If the user asks you to remember something derived from a sensitive endpoint, save the abstract fact (e.g., "this org has CI/CD via API keys") not the identifiers.

### POST safety on credential endpoints

Some endpoints **create a credential on any POST**, even with an empty body — defaults are filled in by the server, and the secret `value` is returned exactly once. This applies to:

- `/config/{org}/apiKeys.json` (org API keys)
- `/config/{org}/sites/{site}/apiKeys.json` (site API keys)
- `/config/{org}/sites/{site}/tokens.json` (site tokens)
- `/config/{org}/sites/{site}/secrets.json` (site secrets)

Never POST to these endpoints to "probe", "test", or "check" the API. Only POST when the user has explicitly asked to create a credential, with the intended role/scope/expiration provided. See `apikeys.md` and `tokens.md` for the full create flow.

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

Document Authoring (DA):
  da auth                - Authenticate with DA (IMS OAuth)
  da list                - List DA organizations
  da list /path          - List files in DA path
  da source /path        - Get file content from DA
  da copy /src to /dest  - Copy file/folder in DA
  da move /src to /dest  - Move/rename in DA
  da delete /path        - Delete from DA
  da upload /path        - Upload content to DA
  da upload media /path  - Upload image/media to DA
  da config              - View DA site config
  da update config       - Update DA site config
  da versions /path      - List file versions
  da create version      - Create labeled version snapshot
  da restore version X   - Restore a previous version
  da preview /path       - Preview DA content
  da publish /path       - Publish DA content
```