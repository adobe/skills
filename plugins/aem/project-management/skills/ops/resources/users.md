---
name: ops-users
description: User management operations for Edge Delivery Services - add/remove users with any of the 8 roles (admin, author, publish, basic_author, basic_publish, develop, config, config_admin), list access, check current user profile.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - User Management

Manage user access for Edge Delivery Services sites.

## API Reference

### Site-Level Access

> **Note:** The `/config/{org}/{site}/access.json` endpoints below are a legacy access control API. The modern Config Service manages access via the `access` field within the site configuration at `/config/{org}/sites/{site}.json`. These legacy endpoints may still function for backward compatibility but prefer using site config for new setups.

| Intent | Endpoint | Method |
|--------|----------|--------|
| list site users | `/config/{org}/{site}/access.json` | GET |
| add admin | `/config/{org}/{site}/access/admin.json` | POST |
| add author | `/config/{org}/{site}/access/author.json` | POST |
| remove user | `/config/{org}/{site}/access/{role}/{email}.json` | DELETE |

### Org-Level Users
| Intent | Endpoint | Method |
|--------|----------|--------|
| list org users | `/config/{org}/users.json` | GET |
| add org user | `/config/{org}/users.json` | POST |
| get org user | `/config/{org}/users/${userId}.json` | GET |
| remove org user | `/config/{org}/users/${userId}.json` | DELETE |

### Profile
| Intent | Endpoint | Method |
|--------|----------|--------|
| who am i | `/profile` | GET |

## Roles

All 8 official roles, from the [Admin Roles documentation](https://www.aem.live/docs/authentication-setup-authoring#admin-roles):

| Role | Key Permissions | Typical Use |
|------|-----------------|-------------|
| `admin` | All permissions | Site/org administrators |
| `author` | `basic_author` + snapshot:write/delete, job:write, log:read, preview:list/delete-forced, edit/job:list | Content authors who manage staged releases |
| `publish` | All `author` permissions + live:write/delete/delete-forced/list | Authors who can also push to live |
| `basic_author` | cache:write, code:read/write/delete, index:read/write, preview:read/write/delete, edit:read, live:read, cron:read/write, snapshot:read, job:read | Basic content contributors (preview only, no publish) |
| `basic_publish` | `basic_author` + live:write/delete | Basic contributors who can also publish |
| `develop` | `basic_author` + code:write/delete/delete-forced | Developers managing code deployments |
| `config` | config:read-redacted | Read-only config access (redacted secrets) |
| `config_admin` | config:read, config:write | Full configuration management |

**Default role:** If `requireAuth` is `auto` (default) and no role mapping exists, unauthenticated users get `basic_publish`.

### Role Assignment via Site Config (Modern)

Roles are assigned in the `access.admin.role` section of the site config:

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "access": {
      "admin": {
        "role": {
          "author": ["*@example.com"],
          "publish": ["specific.user@example.com"],
          "admin": ["admin.user@example.com"]
        }
      }
    }
  }' \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json"
```

Wildcard patterns are supported: `"*@example.com"` gives all users in that domain the role.

## Operations

### List Users

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/access.json"
```

**Response format:** Present as two sections — Admins (list emails) and Authors (list emails)

### Add Admin
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"users": ["user@example.com"]}' \
  "https://admin.hlx.page/config/${ORG}/${SITE}/access/admin.json"
```

**Success:** `Added {email} as admin`

### Add Author
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"users": ["user@example.com"]}' \
  "https://admin.hlx.page/config/${ORG}/${SITE}/access/author.json"
```

**Success:** `Added {email} as author`

### Remove User
**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will revoke {role} access for {email}. They will no longer be able to perform {role} operations on this site."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/access/${ROLE}/${EMAIL}.json"
```

**Success:** `Removed {email} from {role}`

### Get Current User Profile

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/profile"
```

**Success:** `Logged in as {email} ({name})`

### List Org Users

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/users.json"
```

### Add Org User
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}' \
  "https://admin.hlx.page/config/${ORG}/users.json"
```

### Remove Org User
**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Confirm: "This will remove {userId} from the organization. Proceed? (yes/no)"

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/users/${USER_ID}.json"
```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "add john@acme.com as author" | Add author role |
| "add jane@acme.com as admin" | Add admin role |
| "add dev@acme.com as developer" | Add develop role |
| "add user@acme.com as publisher" | Add publish role |
| "give config access to user@acme.com" | Add config role |
| "remove admin user@example.com" | Remove from admin |
| "remove author user@example.com" | Remove from author |
| "who has access" | List users |
| "list users" | List users |
| "who am i" | Get profile |
| "what's my email" | Get profile |
| "show permissions" | List users |
| "list org users" | List org users |
| "add user to org" | Add org user |
| "remove user from org" | Remove org user |
