---
name: ops-profiles
description: Profile configuration for Edge Delivery Services - manage reusable profile-level settings at the org level, including access controls, CDN rules, headers, and metadata.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Profile Configuration

Manage org-level profile configurations. Profiles are shared across sites and reside under `/config/{org}/profiles/`.

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| list profiles | `/config/{org}/profiles.json` | GET |
| read profile config | `/config/{org}/profiles/{profile}.json` | GET |
| update profile config | `/config/{org}/profiles/{profile}.json` | POST |
| create profile config | `/config/{org}/profiles/{profile}.json` | PUT |
| delete profile config | `/config/{org}/profiles/{profile}.json` | DELETE |

## Operations

### List Profiles

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/profiles.json"
```

**Response format:** Present as table — Profile Name

### Read Profile Configuration

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/profiles/${PROFILE}.json"
```

### Update Profile Configuration

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"version": 1, "created": "...", "lastModified": "...", "content": {...}}' \
  "https://admin.hlx.page/config/${ORG}/profiles/${PROFILE}.json"
```

> Note: `version`, `created`, and `lastModified` fields are required in the request body.

**Success:** HTTP 200 with updated profile config data

### Create Profile Configuration

Use PUT to create a new profile config (fails with 409 if one already exists — use POST to update instead).

```bash
curl -s --connect-timeout 15 --max-time 120 -X PUT \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"version": 1, "created": "...", "lastModified": "...", "content": {...}}' \
  "https://admin.hlx.page/config/${ORG}/profiles/${PROFILE}.json"
```

**Success:** HTTP 200 with created profile config data

### Delete Profile Configuration
**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will delete the profile configuration for '${PROFILE}'. Any sites inheriting from this profile will lose its settings."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/profiles/${PROFILE}.json"
```

**Success:** `Deleted profile config: ${PROFILE}`

## Profile Configuration Properties

Profiles can include the same fields as site configs, such as:
- `content` — content bus source (SharePoint, Google Drive)
- `code` — GitHub repository
- `access` — admin/site/preview/live access rules
- `cdn` — CDN routing
- `headers` — custom response headers
- `secrets` / `tokens` / `apiKeys`
- `sidekick` — sidekick plugin settings
- `robots` — robots.txt content
- `metadata` — metadata source paths

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "list profiles" | List profiles |
| "show profile config for X" | Read profile config |
| "read profile settings for X" | Read profile config |
| "update profile config for X" | Update profile config |
| "delete profile X" | Delete profile config |
