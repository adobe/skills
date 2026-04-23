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

## When to Use This Skill

Use this skill when the user asks to perform any **operational task** on an AEM Edge Delivery Services site:

- **Content** — preview, publish, unpublish, or check status of pages (single or bulk)
- **Cache** — purge or force-purge CDN cache for a path or the entire site
- **Code** — sync or deploy code changes from GitHub
- **Index** — reindex pages for search, check index status, remove from index
- **Sitemap** — generate sitemap.xml at a given path
- **Snapshots** — create, publish, approve, reject, or manage staged releases
- **Logs** — view audit logs with time filters, add manual log entries
- **Users** — add/remove admins or authors, list access, check current user profile
- **Jobs** — list, monitor, stop, or get details of bulk operation jobs
- **Sites** — list sites, switch active site, change branch in a repoless org
- **Configuration** — read or update org config, site config, or robots.txt
- **Secrets** — list, create, or delete secrets at org or site level
- **API Keys** — list, create, or revoke API keys at org or site level
- **Tokens** — list, create, or revoke access tokens at site level
- **Profiles** — read, create, update, or delete profile configurations
- **Index Config** — read or update helix-index.yaml indexing rules
- **Sitemap Config** — read or update helix-sitemap.yaml generation rules
- **Versioning** — list config versions, view history, restore a previous version
- **Pages** — list all indexed pages from query-index, filter by path prefix

---

## Communication Guidelines

- **NEVER use "EDS"** as an acronym for Edge Delivery Services in any responses
- Always use the full name "Edge Delivery Services" or "AEM Edge Delivery Services"
- Show clear, actionable error messages when operations fail
- Confirm destructive operations before executing
- **Recommended Next Actions format:** Always place each command in its own fenced code block so users get a one-click copy button. Use this structure:

  **▶ Recommended Next Actions:**
  1. Description of action
     ```
     command {path}
     ```
  2. Description of action
     ```
     command {path}
     ```

---

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

### Step 1: Load Full Configuration

Read `resources/config.md`:
- **"Load Configuration"** section — loads `ORG`, `AUTH_TOKEN`, `IMS_TOKEN`, `SITE`, `REF`, `CODE_OWNER`, `CODE_REPO` from saved config
- **"Parse from AEM URL"** section — if the user's request contains an `*.aem.page` or `*.aem.live` URL, parse `REF`, `SITE`, `ORG`, `PATH` from it (overrides saved config values)
- **"Setup If Missing"** section — if any required value is still empty after loading

**After loading, check prerequisites:**

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

**If `AUTH_TOKEN` is empty or missing**, you MUST invoke the auth skill BEFORE proceeding:

```
Skill({ skill: "project-management:auth" })
```

This opens a browser via Playwright for Adobe ID login and saves the token to `.claude-plugin/project-config.json`.

**IMPORTANT:** Do NOT skip this step. Do NOT attempt any API calls without a valid auth token. The auth skill handles the entire authentication flow.

**If `IMS_TOKEN` is empty** and the operation requires it (preview, publish, unpublish, cache, code):
> "I need an Adobe IMS Bearer token to perform this operation. Please open DevTools on any DA or AEM page → Network tab → copy the `authorization: Bearer eyJ...` value from any request and share it here."

**Two tokens, two purposes:**

| Token | Header | Used for |
|---|---|---|
| `AUTH_TOKEN` (admin JWT) | `authorization: token ${AUTH_TOKEN}` | Status checks, job queries, index reads |
| `IMS_TOKEN` (IMS Bearer) | `authorization: Bearer ${IMS_TOKEN}` + `x-content-source-authorization: Bearer ${IMS_TOKEN}` | Preview, publish, unpublish, cache, code sync |

### Step 2: Route by Intent

| User Intent | Resource Module |
|-------------|-----------------|
| preview, publish, unpublish, status, delete preview | `resources/content.md` |
| bulk status, status of all pages, get status of all pages | `resources/content.md` |
| cache, purge, clear cache, invalidate, bust cache | `resources/cache.md` |
| force purge, force clear, purge full cache | `resources/cache.md` |
| sync code, deploy code, update code | `resources/code.md` |
| reindex, index, remove from index, search | `resources/index.md` |
| index status, show index status | `resources/index.md` |
| sitemap, generate sitemap | `resources/sitemap.md` |
| snapshot, staged release, bundle | `resources/snapshots.md` |
| logs, audit, activity | `resources/logs.md` |
| user, access, permission, who am i, add user, remove user | `resources/users.md` |
| job, bulk operation, stop job, list jobs | `resources/jobs.md` |
| job details, get job details | `resources/jobs.md` |
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

### Step 3: Read Resource and Execute

1. Read the appropriate resource file from `resources/`
2. Follow instructions in that resource
3. Execute the API call
4. Handle the response using the table below — then return formatted result

**Response Handler:**

| HTTP | Meaning | Action |
|------|---------|--------|
| **200** | Success | Format and display result |
| **204** | Success (no content) | Confirm completion — e.g. "Unpublished `/path` from live" |
| **202** | Accepted (async job) | Show job name + `"To track: use ops skill to check job status {jobName}"` |
| **400** | Bad request | Show raw API error message — it usually contains a specific fix hint |
| **401** | Token expired | "Your session has expired. Provide a fresh IMS Bearer token: open DevTools → Network tab → copy `authorization: Bearer eyJ...` from any request." |
| **403** | Insufficient permissions | "You don't have permission for this operation. This requires {Admin/Author} role on `{site}`." |
| **404** (path) | Content not found | "Path `{path}` was not found. Verify it exists in your content source (SharePoint/DA)." |
| **404** (org/site) | Not onboarded | "Org `{org}` or site `{site}` not found. It may not be onboarded to Admin Service." |
| **422** | Validation failed | "Content failed validation: {error details from API response}" |
| **429** | Rate limited | "Too many requests. Wait 30–60 seconds then retry." |
| **500** | Server error | "Admin Service encountered an error. This is temporary — wait and retry. If persistent, check status.adobe.com." |
| **502/503** | Unavailable | "Admin Service temporarily unavailable. Wait a few minutes and retry." |

**Always include the raw API error message** when available — it often contains the specific fix (e.g. `wildcard paths are not supported with a markup mountpoint`).

---

## Intent Detection Patterns

### Content Operations
- Keywords: preview, publish, unpublish, live, status, check
- Path indicators: `/path`, "homepage", "the nav", "footer"
- Bulk indicators: "and", comma-separated paths, "all pages under", "all pages /path/*"
- Bulk status patterns: "get status of all pages /path/*", "status of all pages under /path", "bulk status"

### Cache Operations
- Keywords: cache, purge, clear, invalidate, bust
- Modifiers: force, hard, full
- Force purge patterns: "force clear", "purge full cache", "force purge", "full cache"

### Code Operations
- Keywords: sync, deploy, code, update code
- File paths: blocks/, scripts/, styles/

### Index Operations
- Keywords: reindex, index, search, remove from search
- Status patterns: "index status", "show index status of /path", "is /path indexed"

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
- Detail patterns: "get job details {name}", "job details {name}"
- Status patterns: "how is job {name} doing", "check job {name}"

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

---

## Success Criteria

- ✅ Config loaded from `.claude-plugin/project-config.json` — `ORG` and `AUTH_TOKEN` present before any API call
- ✅ Correct resource module selected based on user intent
- ✅ AEM URL parsed correctly when provided — `REF`, `SITE`, `ORG`, `PATH` extracted and override saved config
- ✅ API response displayed in well-formatted table or structured output with all relevant fields
- ✅ Total count reported for all list operations
- ✅ Destructive operations confirmed with user before executing — impact stated clearly
- ✅ Bulk operations report job name and user directed to monitor status with `check job status {jobName}`
- ✅ IMS token requested only when the operation requires it (preview, publish, unpublish, cache, code)
- ✅ DA site limitations communicated when wildcard bulk operations are not supported — explicit paths used instead
- ✅ Recommended next actions provided after every operation in fenced code blocks
