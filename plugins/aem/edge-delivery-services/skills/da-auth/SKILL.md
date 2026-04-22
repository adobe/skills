---
name: da-auth
description: Obtains a valid Adobe IMS access token for the DA (Document Authoring) API. Use this skill as a prerequisite step whenever another skill needs to call admin.da.live — for example, before pushing HTML content, listing documents, or triggering a DA preview. Do NOT use this skill if you already have a valid DA_TOKEN in scope from a previous step in the same session.
license: Apache-2.0
metadata:
  version: "1.0.0"
---

# DA Authentication

Gets a valid Adobe IMS access token and stores it in `DA_TOKEN` for use in subsequent `admin.da.live` API calls.

## When to Use This Skill

Use this skill whenever you need to call the DA Admin API (`admin.da.live`) and do not already have a valid token in scope. Common cases:
- Pushing or updating page content in DA
- Listing documents in a DA repository
- Triggering a DA content preview

Do NOT use this skill when:
- You already obtained a `DA_TOKEN` earlier in the same session and it has not expired (tokens are valid for ~1 hour with a 60-second buffer)
- The **create-site** skill is already handling authentication as part of its own flow
- A DA MCP server is active in the session — use its authentication tool directly instead

## Prerequisites

- Node.js 18+ installed
- A browser accessible from the machine (for the OAuth flow)
- Network access to `ims-na1.adobelogin.com`

## Related Skills

- **create-site** — includes its own DA auth step for new site onboarding; do not invoke da-auth separately within that flow
- **content-driven-development** — use da-auth before pushing authored content to DA
- **building-blocks** — use da-auth if test content needs to be pushed to DA for block development

---

## Step 1: Check for a Cached Token

Before triggering a browser login, check whether a valid token is already cached.

```bash
DA_TOKEN=$(node -e "
  const fs = require('fs');
  const p = process.env.HOME + '/.aem/da-token.json';
  try {
    const t = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (t.expires_at > Date.now() + 60000) process.stdout.write(t.access_token);
  } catch {}
")
```

If `DA_TOKEN` is non-empty, skip to **Step 3**.

## Step 2: Obtain a Token *(login required)*

Choose the option that fits the environment:

**Option A (preferred) — `da-auth-helper` CLI:**

The `da-auth-helper` tool handles the full IMS OAuth 2.0 implicit flow, caches the token at `~/.aem/da-token.json`, and prints the token to stdout.

```bash
# Run directly without a global install
DA_TOKEN=$(npx github:adobe-rnd/da-auth-helper token)
```

If `npx` is unavailable or slow, install globally first:

```bash
npm install -g github:adobe-rnd/da-auth-helper
DA_TOKEN=$(da-auth-helper token)
```

This opens a browser window. Instruct the user:

> Please complete the Adobe IMS login in the browser window that just opened. The token will be captured automatically once you log in.

Success: `DA_TOKEN` is a non-empty JWT string starting with `eyJ`.

**Option B — DA MCP server:**

If a DA MCP server is configured in the session, use its authentication tool to start the OAuth flow and retrieve the token from the response.

**Option C — Manual paste *(last resort)*:**

> I need an Adobe IMS access token to push content to DA. You can copy one from your browser:
> 1. Open [da.live](https://da.live) and log in
> 2. Open DevTools → Network tab → find any request to `admin.da.live`
> 3. Copy the `Authorization: Bearer <token>` value (without the `Bearer ` prefix)
> 4. Paste it here

## Step 3: Verify the Token Works

Confirm the token is accepted by the DA API before proceeding:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer {{DA_TOKEN}}" \
  "https://admin.da.live/list/{{ORG}}/{{REPO}}"
```

Success: HTTP `200`. The token is valid — `DA_TOKEN` is ready for use by the calling skill.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `DA_TOKEN` is empty after Step 1 | No cached token or token expired | Proceed to Step 2 |
| Browser window does not open | `npx` / `da-auth-helper` blocked or headless environment | Use Option B (MCP) or Option C (manual paste) |
| `npx github:adobe-rnd/da-auth-helper` fails | Network restrictions on GitHub package registry | Use Option B (DA MCP server) or Option C (manual token paste) |
| Step 3 returns `401` | Token expired between steps | Re-run Step 2 to refresh |
| Step 3 returns `403` | Authenticated user lacks access to `{{ORG}}/{{REPO}}` | Ask the user to verify their DA permissions for that org/repo |

## Reference

- DA Auth Helper: https://github.com/adobe-rnd/da-auth-helper
- DA Admin API: https://opensource.adobe.com/da-admin/
- Token cache location: `~/.aem/da-token.json`
