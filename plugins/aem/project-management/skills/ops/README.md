# Edge Delivery Services Operations

Execute admin operations on AEM Edge Delivery Services projects using natural language commands.

## Quick Start

```
/ops list pages
/ops who am i
/ops list sites
```

## Commands

| Command | Description |
|---------|-------------|
| `list pages` | Show all indexed pages with URLs |
| `list pages /blog` | Filter pages by path |
| `who am i` | Show current user profile |
| `list sites` | Show all sites in org |
| `show site config` | View site configuration |
| `preview /path` | Preview a content path |
| `publish /path` | Publish to live |
| `status /path` | Check preview/live status |
| `clear cache /path` | Purge CDN cache |
| `sync code` | Deploy latest code |
| `show logs` | View recent activity |
| `list jobs` | Show bulk operations |
| `list admins` | List admin users |
| `list authors` | List author users |
| `help` | Show all available commands |

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

# User management
/ops list admins
/ops add user@example.com as author

# Monitoring
/ops show logs last hour
/ops list jobs

# Configuration
/ops show org config
/ops show site config
```

## Permissions

- **Author**: preview, publish, cache, index, read logs
- **Admin**: All author permissions + unpublish, code sync, user management, config changes

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Auth expired - skill will prompt for re-login |
| 403 Forbidden | You don't have permission for this operation |
| 404 Not Found | Check org/site names or content path |
| Command not recognized | Try `help` to see available commands |
