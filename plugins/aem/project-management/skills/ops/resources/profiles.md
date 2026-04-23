---
name: ops-profiles
description: Profile configuration for Edge Delivery Services - manage user profile settings including access controls, CDN rules, headers, and metadata.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Profile Configuration

Manage user profile-level configuration settings.

## When to Use

- Configuring site-specific CDN rules, response headers, or access controls for a named profile
- Reading the current profile settings before making changes
- Creating a new profile for a distinct audience or environment (e.g., `default`, `authenticated`)
- Updating header rules or metadata overrides that apply to a specific user segment
- Deleting an obsolete profile that is no longer in use

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

**On success (200):** Display the full profile configuration JSON.

**▶ Recommended Next Actions:**
1. Update profile settings if changes are required
   ```
   update profile config
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
**▶ Recommended Next Actions:**
1. Verify the update was applied correctly
   ```
   show profile config
   ```
2. Preview pages to confirm the profile changes render correctly
   ```
   preview {path}
   ```

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
**▶ Recommended Next Actions:**
1. Verify the profile was created correctly
   ```
   show profile config
   ```
2. Update with additional settings as needed
   ```
   update profile config
   ```

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
**▶ Recommended Next Actions:**
1. Verify the profile no longer exists
   ```
   show profile config
   ```
2. Create a replacement profile if needed
   ```
   create profile {profileId}
   ```

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

## Success Criteria

- ✅ Profile configuration retrieved and displayed clearly
- ✅ Create or update confirmed with HTTP 200 and the applied properties shown to user
- ✅ Destructive operations (delete profile) confirmed with user before executing
- ✅ User reminded to preview affected pages to verify profile rules took effect
