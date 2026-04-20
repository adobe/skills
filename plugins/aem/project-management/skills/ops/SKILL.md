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
| **Users** | add user@email as author, remove admin user@email, who am i |
| **Jobs** | list jobs, job status X, stop job X |
| **Sites** | list sites, switch to site-X, use branch feature-X |
| **Config** | show org config, show site config, update robots.txt |
| **Secrets** | list secrets, create secret, delete secret |
| **API Keys** | list API keys, create API key, revoke API key |
| **Tokens** | list tokens, create token, revoke token |
| **Profiles** | show profile config, create profile, delete profile |
| **Index Config** | show helix-index.json, update index config |
| **Sitemap Config** | show helix-sitemap.json, update sitemap config |
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

Type 'help' for the full command list.
```

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

### Step 2: Load Full Configuration

After auth is confirmed, load remaining config:

```bash
CONFIG=$(cat .claude-plugin/project-config.json 2>/dev/null)
ORG=$(echo "$CONFIG" | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
AUTH_TOKEN=$(echo "$CONFIG" | grep -o '"authToken"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"authToken"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
SITE=$(echo "$CONFIG" | grep -o '"site"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"site"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
REF=$(echo "$CONFIG" | grep -o '"ref"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"ref"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

REF=${REF:-main}
echo "Config: org=$ORG site=$SITE ref=$REF auth=${AUTH_TOKEN:+set}"
```

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
4. Return formatted result

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

## Prerequisites

This skill works with AEM Edge Delivery Services projects that are:

1. **Onboarded to Admin Service** - Project must have admin.hlx.page access
2. **User has Adobe IMS account** - Required for authentication
3. **User has appropriate role** - Admin or Author on the site
4. **Network access** - Can reach admin.hlx.page (not blocked by firewall)

---

## Error Handling

When API returns an error, explain the cause and how to fix it:

| HTTP Code | Cause | Tell User | Fix |
|-----------|-------|-----------|-----|
| **400** | Malformed request | "The request format is invalid. Check the path or payload syntax." | Review path format, ensure JSON/YAML is valid |
| **401** | Token expired or missing | "Your session has expired. You need to log in again." | Run `Skill({ skill: "project-management:auth" })` |
| **403** | Insufficient permissions | "You don't have permission for this operation. This requires {Admin/Author} role." | Contact site admin to grant access |
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

When user asks "what can you do?" or "help", show:

```
Content Operations:
  preview /path          - Update preview
  publish /path          - Publish to live
  unpublish /path        - Remove from live (admin only)
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
  show index config      - View helix-index.json
  update index config    - Modify indexing rules

Sitemap Config:
  show sitemap config    - View helix-sitemap.json
  update sitemap config  - Modify sitemap rules

Versioning:
  list versions          - Show config history
  restore version {id}   - Rollback to version

Pages:
  list pages             - Show all indexed pages
  list pages /blog       - Filter by path prefix
```
