---
name: ops-code
description: Code sync operations for Edge Delivery Services - deploy code changes from GitHub. Syncs full repo or specific files. Warns about repoless impact.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Code Sync

Deploy code changes from GitHub to Edge Delivery Services.

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| sync code (full) | `/code/{owner}/{repo}/{ref}` | POST |
| sync file | `/code/{owner}/{repo}/{ref}/{path}` | POST |
| delete code | `/code/{owner}/{repo}/{ref}/{path}` | DELETE |
| code status | `/code/{owner}/{repo}/{ref}/{path}` | GET |

**Note:** Code operations use `{owner}/{repo}` (GitHub), not `{org}/{site}` (content).

## Auth

All code bus operations (GET and POST) require IMS Bearer — admin JWT is not accepted:
```
authorization: Bearer ${IMS_TOKEN}
```

## Operations

### Sync Full Repository

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/code/${CODE_OWNER}/${CODE_REPO}/${REF}/*"
```

**Success:** `Code synced for {owner}/{repo}`

**▶ Recommended Next Actions:**
1. Verify the deployment completed successfully
   ```
   check code status of {path}
   ```
2. Preview a page to confirm code changes render correctly
   ```
   preview {path}
   ```
3. If CDN is still serving previous JS/CSS, purge cache
   ```
   purge cache of {path}
   ```

### Sync Specific File

```bash
curl -s -X POST \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/code/${CODE_OWNER}/${CODE_REPO}/${REF}${PATH}"
```

Example: Sync just the hero block:
```bash
curl -s -X POST \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/code/${CODE_OWNER}/${CODE_REPO}/main/blocks/hero/hero.js"
```

**▶ Recommended Next Actions:**
1. Verify the file was updated on the code bus
   ```
   check code status of {path}
   ```
2. Preview affected pages to confirm the change renders
   ```
   preview {pagePath}
   ```
3. If CDN is still serving the previous version, purge cache
   ```
   purge cache of {pagePath}
   ```

### Code Status

```bash
curl -s \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/code/${CODE_OWNER}/${CODE_REPO}/${REF}${PATH}"
```

**▶ Recommended Next Actions:**
1. If the file is out of date, sync it
   ```
   sync file {path}
   ```
2. To pull all latest changes from the repository
   ```
   sync code
   ```
3. Preview pages that depend on this file to verify behavior
   ```
   preview {pagePath}
   ```

### Delete Code

**Requires Admin role.**

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Confirm: "This will delete {path} from the code bus. In repoless setups, this affects ALL sites. Proceed? (yes/no)"

```bash
curl -s -X DELETE \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/code/${CODE_OWNER}/${CODE_REPO}/${REF}${PATH}"
```

**▶ Recommended Next Actions:**
1. Confirm the file has been removed from the code bus
   ```
   check code status of {path}
   ```
2. Purge CDN cache to stop serving the deleted file
   ```
   purge cache of {path}
   ```
3. Preview affected pages to verify no regressions
   ```
   preview {pagePath}
   ```

## Repoless Warning

In a **repoless setup**, multiple sites share one code repository. Code sync affects ALL sites.

**Before syncing, check if repoless:**

```bash
ORG=$(cat .claude-plugin/project-config.json | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
SITES=$(curl -s "https://admin.hlx.page/config/${ORG}/sites.json")
SITE_COUNT=$(echo "$SITES" | grep -o '"name"' | wc -l | tr -d ' ')

if [ "$SITE_COUNT" -gt 1 ]; then
  echo "REPOLESS: $SITE_COUNT sites share this codebase"
fi
```

**If repoless, warn user:**

> "This is a repoless setup with {N} sites sharing the same code. Code sync will affect ALL sites:
> - site-a
> - site-b
> - site-c
>
> Proceed with code sync?"

Only execute after confirmation.

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "sync code" | Full repo sync |
| "deploy the latest code" | Full repo sync |
| "sync blocks/hero/hero.js" | Sync specific file |
| "deploy code changes" | Full repo sync |
| "update the code" | Full repo sync |
| "delete code blocks/old.js" | Delete code file |
