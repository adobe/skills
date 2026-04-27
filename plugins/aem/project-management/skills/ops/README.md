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

Type `help` for the full command list.

## First-Time Setup

On first use, the skill will:
1. Ask for your **organization name** (the `{org}` in `https://main--site--{org}.aem.page`)
2. Open a browser for **Adobe ID login** to get an auth token

Configuration is saved to `.claude-plugin/project-config.json` (add to `.gitignore`).

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

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Auth expired - skill will prompt for re-login |
| 403 Forbidden | You need a role with permission for this operation |
| 404 Not Found | Check org/site names or content path |
| Command not recognized | Try `help` to see available commands |
