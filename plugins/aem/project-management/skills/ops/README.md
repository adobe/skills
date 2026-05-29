# Edge Delivery Services Operations

Execute admin operations on AEM Edge Delivery Services projects using natural language commands.

## Quick Start

```
/ops list pages
/ops who am i
/ops list sites
```

## Commands

| Category | Commands |
|----------|----------|
| **Content** | `preview /path`, `publish /path`, `unpublish /path`, `status /path` |
| **Cache** | `clear cache /path`, `force clear cache` |
| **Code** | `sync code`, `deploy code` |
| **Index** | `reindex /path`, `remove from index` |
| **Sitemap** | `generate sitemap` |
| **Snapshots** | `create snapshot X`, `publish snapshot X`, `approve snapshot X` |
| **Logs** | `show logs`, `show logs last hour` |
| **Users** | `add user@email as role`, `remove role user@email`, `who am i` |
| **Jobs** | `list jobs`, `job status X`, `stop job X` |
| **Sites** | `list sites`, `switch to site-x`, `use branch feat-x` |
| **Config** | `show org config`, `show site config`, `update robots.txt` |
| **Secrets** | `list secrets`, `create secret`, `delete secret` |
| **API Keys** | `list API keys`, `create API key`, `revoke API key` |
| **Tokens** | `list tokens`, `create token`, `revoke token` |
| **Profiles** | `show profile config`, `create profile`, `delete profile` |
| **Index Config** | `show index config`, `update index config` |
| **Sitemap Config** | `show sitemap config`, `update sitemap config` |
| **Versioning** | `list versions`, `restore version`, `rollback config` |
| **Pages** | `list pages`, `list all pages`, `show indexed pages` |
| **DA (Document Authoring)** | `da list`, `da source /path`, `da copy`, `da move`, `da delete`, `da config`, `da versions`, `da preview`, `da publish` |

Type `help` for the full command list.

## First-Time Setup

On first use, the skill will:
1. Ask for your **organization name** (the `{org}` in `https://main--site--{org}.aem.page`)
2. Open a browser for **Adobe ID login** to get an auth token

Configuration is saved to `~/.aem/ops-config.json` (org, site, ref) and `~/.aem/ims-token.json` (auth token, shared across all skills).

## Examples

```
# Content operations
/ops preview /index
/ops publish /blog/my-article
/ops status /products

# Bulk operations
/ops preview /blog/post-1, /blog/post-2, /blog/post-3
/ops publish all pages under /products

# User management
/ops add user@example.com as author
/ops add dev@example.com as developer
/ops remove author user@example.com

# Monitoring
/ops show logs last hour
/ops list jobs

# Configuration
/ops show org config
/ops show site config
```

## Roles

The Admin API defines 8 roles:

| Role | Key Permissions |
|------|-----------------|
| `admin` | All permissions |
| `author` | Preview, snapshots, jobs, logs |
| `publish` | All author permissions + publish to live |
| `basic_author` | Preview only (no publish) |
| `basic_publish` | Basic author + publish |
| `develop` | Basic author + code sync |
| `config` | Read-only config access |
| `config_admin` | Full config management |

If an operation returns 403, you need a role with that permission.

## Document Authoring (DA)

For sites using Document Authoring (DA) instead of SharePoint/Google Drive, prefix commands with `da`:

```
# DA content operations
/ops da list                      # List DA organizations
/ops da list /blog                # List files in a folder
/ops da source /index.html        # View file content
/ops da copy /template to /new    # Copy (uses form-data)
/ops da move /old to /new         # Move/rename (uses form-data)
/ops da delete /drafts/old.html   # Delete (confirmation required)

# DA versioning
/ops da versions /page.html       # List file versions
/ops da create version /page.html # Create labeled snapshot
/ops da restore version X         # Restore a previous version

# DA config
/ops da config                    # View site config
/ops da update config             # Update site config (sheet format)

# Preview/publish DA content (uses x-content-source-authorization header)
/ops da preview /page
/ops da publish /page
```

**Note:** DA API (admin.da.live) uses form-data for copy, move, config, and content uploads — not JSON bodies. The skill handles this automatically.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Auth expired - skill will prompt for re-login |
| 403 Forbidden | You need a role with permission for this operation |
| 404 Not Found | Check org/site names or content path |
| Command not recognized | Try `help` to see available commands |
