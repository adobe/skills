---
name: ops-users
description: User management operations for Edge Delivery Services - add/remove admins and authors, list access, check current user profile.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - User Management

Manage user access for Edge Delivery Services sites.

## API Reference

### Site-Level Access
| Intent | Endpoint | Method |
|--------|----------|--------|
| list site users | `/config/{org}/sites/{site}/access.json` | GET |
| add admin | `/config/{org}/sites/{site}/access/admin.json` | POST |
| add author | `/config/{org}/sites/{site}/access/author.json` | POST |
| remove user | `/config/{org}/sites/{site}/access/{role}/{email}.json` | DELETE |

### Org-Level Users
| Intent | Endpoint | Method |
|--------|----------|--------|
| list org users | `/config/{org}/users` | GET |
| add org user | `/config/{org}/users` | POST |
| get org user | `/config/{org}/users/{userId}` | GET |
| remove org user | `/config/{org}/users/{userId}` | DELETE |

### Profile
| Intent | Endpoint | Method |
|--------|----------|--------|
| who am i | `/profile` | GET |

## Roles

| Role | Permissions |
|------|-------------|
| **Admin** | Full access - preview, publish, unpublish, user management, code sync |
| **Author** | Content operations - preview, publish (no unpublish, no user management) |

## Operations

### List Users

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/access.json"
```

Returns:
```json
{
  "admin": ["admin1@example.com", "admin2@example.com"],
  "author": ["author1@example.com", "author2@example.com"]
}
```

### Add Admin

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"users": ["user@example.com"]}' \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/access/admin.json"
```

**Success:** `Added {email} as admin`

### Add Author

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"users": ["user@example.com"]}' \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/access/author.json"
```

**Success:** `Added {email} as author`

### Remove User

**Requires Admin role.**

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will revoke {role} access for {email}. They will no longer be able to perform {role} operations on this site."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/access/${ROLE}/${EMAIL}.json"
```

**Success:** `Removed {email} from {role}`

### Get Current User Profile

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/profile"
```

**Success:** `Logged in as {email} ({name})`

### List Org Users

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/users"
```

### Add Org User

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}' \
  "https://admin.hlx.page/config/${ORG}/users"
```

### Remove Org User

**Requires Admin role.**

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Confirm: "This will remove {userId} from the organization. Proceed? (yes/no)"

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/users/${USER_ID}"
```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "add john@acme.com as author" | Add author |
| "add jane@acme.com as admin" | Add admin |
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
