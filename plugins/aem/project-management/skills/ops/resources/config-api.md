---
name: ops-config-api
description: Configuration API operations for Edge Delivery Services - read/write org and site configs, manage robots.txt.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Configuration API

Read and manage organization and site configurations.

## When to Use

- Reading org or site configuration to audit current settings before making changes
- Updating site-level config properties (e.g., CDN rules, redirects, header overrides)
- Creating a brand-new org or site configuration for a fresh onboarding
- Deleting a site or org config as part of decommissioning (destructive — requires confirmation)
- Reading or updating `robots.txt` to control crawler access rules

## API Reference

### Organization Config

| Intent | Endpoint | Method |
|--------|----------|--------|
| read org config | `/config/{org}.json` | GET |
| update org config | `/config/{org}.json` | POST |
| create org config | `/config/{org}.json` | PUT |
| delete org config | `/config/{org}.json` | DELETE |

### Site Config

| Intent | Endpoint | Method |
|--------|----------|--------|
| read site config | `/config/{org}/sites/{site}.json` | GET |
| update site config | `/config/{org}/sites/{site}.json` | POST |
| create site config | `/config/{org}/sites/{site}.json` | PUT |
| delete site config | `/config/{org}/sites/{site}.json` | DELETE |

### Robots.txt

| Intent | Endpoint | Method |
|--------|----------|--------|
| read robots.txt | `/config/{org}/sites/{site}/robots.txt` | GET |
| update robots.txt | `/config/{org}/sites/{site}/robots.txt` | POST |

## Operations

### Read Organization Config

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}.json"
```

**On success (200):** Display the full org configuration JSON.

**▶ Recommended Next Actions:**
1. Read site-level config for a specific site
   ```
   show site config
   ```

### Update Organization Config

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}.json"
```

**▶ Recommended Next Actions:**
1. Verify the update was applied correctly
   ```
   show org config
   ```
2. Preview pages that depend on this config to confirm changes
   ```
   preview {path}
   ```

### Create Organization Config

**Requires Admin role. Fails if org already exists.**

```bash
curl -s -X PUT \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}.json"
```

**▶ Recommended Next Actions:**
1. Verify the new org config was created correctly
   ```
   show org config
   ```
2. Create a site config under this org
   ```
   create site config
   ```

### Delete Organization Config

**Requires Admin role.**

**CRITICAL DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. WARN user: "This will DELETE the entire organization configuration for '{org}'. This may break ALL sites under this org."
2. Ask: "Are you absolutely sure? This cannot be undone. Type 'DELETE {org}' to confirm."
3. Only execute if user types the exact confirmation

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}.json"
```

**▶ Recommended Next Actions:**
1. Recreate the org config if the deletion was unintentional
   ```
   create org config
   ```
2. Verify all sites under this org are still accessible
   ```
   list sites
   ```

### Read Site Config

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json"
```

**On success (200):** Display the full site configuration JSON.

**▶ Recommended Next Actions:**
1. Update site config if changes are required
   ```
   update site config
   ```
2. View org-level config that applies across all sites
   ```
   show org config
   ```
3. *(DA sites only)* Browse DA content structure for this site
   ```
   list DA folders in {site}
   ```

### Update Site Config

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json"
```

**▶ Recommended Next Actions:**
1. Verify the update was applied correctly
   ```
   show site config
   ```
2. Preview pages to confirm the config change takes effect
   ```
   preview {path}
   ```

### Create Site Config

**Requires Admin role. Fails if site already exists.**

```bash
curl -s -X PUT \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json"
```

**▶ Recommended Next Actions:**
1. Verify the new site config was created correctly
   ```
   show site config
   ```
2. Update it with additional properties as needed
   ```
   update site config
   ```
3. Confirm DA content exists for this site
   ```
   list DA folders in {site}
   ```

### Delete Site Config

**Requires Admin role.**

**CRITICAL DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. WARN user: "This will DELETE the entire site configuration for '{site}'. The site will stop working."
2. Ask: "Are you absolutely sure? This cannot be undone. Type 'DELETE {site}' to confirm."
3. Only execute if user types the exact confirmation

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json"
```

**▶ Recommended Next Actions:**
1. Recreate the site config if the deletion was unintentional
   ```
   create site config
   ```
2. Verify the site is still accessible
   ```
   check status of /
   ```

### Read Robots.txt

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/robots.txt"
```

**On success (200):** Display the robots.txt content.

**▶ Recommended Next Actions:**
1. Update robots.txt if crawler rules need to change
   ```
   update robots.txt
   ```
2. Regenerate sitemap after reviewing crawler coverage
   ```
   generate sitemap
   ```

### Update Robots.txt

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: text/plain" \
  -d 'User-agent: *
Disallow: /private/
Allow: /' \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/robots.txt"
```

**▶ Recommended Next Actions:**
1. Verify the updated robots.txt is correct
   ```
   show robots.txt
   ```
2. Regenerate sitemap after crawler rules change
   ```
   generate sitemap
   ```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "show org config" | Read org config |
| "show site config" | Read site config |
| "update org config" | Update org config |
| "update site config" | Update site config |
| "show robots.txt" | Read robots.txt |
| "update robots.txt" | Update robots.txt |
| "block crawlers from /private" | Update robots.txt |

## Success Criteria

- ✅ Org or site configuration retrieved and displayed in full
- ✅ Create or update confirmed with HTTP 200 and the applied changes summarized to user
- ✅ Critical destructive operations (delete org/site config) require typed confirmation before executing
- ✅ Robots.txt changes confirmed with HTTP 200 and the updated rules shown to user
- ✅ User directed to verify affected pages or re-read config to confirm changes took effect
