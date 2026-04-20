---
name: ops-profiles
description: Profile configuration for Edge Delivery Services - manage user profile settings including access controls, CDN rules, headers, and metadata.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Profile Configuration

Manage user profile-level configuration settings.

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| read profile config | `/config/{org}/{site}/profiles/{profileId}.json` | GET |
| update profile config | `/config/{org}/{site}/profiles/{profileId}.json` | POST |
| create profile config | `/config/{org}/{site}/profiles/{profileId}.json` | PUT |
| delete profile config | `/config/{org}/{site}/profiles/{profileId}.json` | DELETE |

## Operations

### Read Profile Configuration

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/profiles/${PROFILE_ID}.json"
```

### Update Profile Configuration

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}/${SITE}/profiles/${PROFILE_ID}.json"
```

**Success:** `Updated profile config: {profileId}`

### Create Profile Configuration

**Requires Admin role. Fails if profile already exists.**

```bash
curl -s -X PUT \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}/${SITE}/profiles/${PROFILE_ID}.json"
```

**Success:** `Created profile config: {profileId}`

### Delete Profile Configuration

**Requires Admin role.**

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will delete the profile configuration for '{profileId}'. Any settings specific to this profile will be lost."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/profiles/${PROFILE_ID}.json"
```

**Success:** `Deleted profile config: {profileId}`

## Profile Configuration Properties

Profiles can include settings for:
- Access controls
- CDN rules
- Code settings
- Content settings
- Folder configurations
- Custom headers
- Metadata
- Robots.txt overrides
- Secrets

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "show profile config" | Read profile config |
| "read profile settings for X" | Read profile config |
| "update profile config" | Update profile config |
| "create profile for X" | Create profile config |
| "delete profile X" | Delete profile config |
