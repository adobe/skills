---
name: auth
description: Authenticate with AEM Edge Delivery Services. Opens browser for login and captures token. Works for admin.hlx.page and Config Service APIs regardless of content source (Document Authoring, SharePoint, or Google Drive).
license: Apache-2.0
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
metadata:
  version: "2.0.0"
---

# AEM Edge Delivery Services Authentication

Authenticate to obtain a token for all Edge Delivery Services admin operations. Auto-detects identity provider from org+site — no content source question needed. Opens the user's default browser for login and receives the token via a local callback server.

## Token Usage

The `authToken` works for admin APIs:

| API | Header | Usage |
|-----|--------|-------|
| `admin.hlx.page` | `x-auth-token: ${AUTH_TOKEN}` | Preview, publish, status, code sync, jobs, logs, config |
| Config Service | `x-auth-token: ${AUTH_TOKEN}` | Sites, config, secrets, API keys, profiles |

> **Note:** `admin.da.live` uses a separate Adobe IMS token with `Authorization: Bearer` header. See the DA-specific login flow in `ops/resources/da.md`.

## When to Use This Skill

- API returns 401 Unauthorized
- User says "login", "authenticate", "auth"
- Before any admin operation when token is missing/expired
- Before generating guides that need API access

## Prerequisites

- Node.js installed

---

## Authentication Flow

### Step 1: Check Existing Token

Tokens are cached at the **user level** (`~/.aem/ims-token.json`), shared across all projects.

```bash
mkdir -p "${HOME}/.aem"

AUTH_TOKEN=$(node -e "
  const fs = require('fs');
  try {
    const t = JSON.parse(fs.readFileSync(process.env.HOME + '/.aem/ims-token.json', 'utf8'));
    if (t.authToken && t.authTokenExpiry > Math.floor(Date.now()/1000) + 60) {
      process.stdout.write(t.authToken);
    }
  } catch (e) {}
")

if [ -n "$AUTH_TOKEN" ]; then
  echo "Token valid"
  exit 0
fi

echo "Token missing or expired. Starting login..."
```

### Step 2: Resolve Org and Site

The auto-login endpoint `/login/{org}/{site}/main` redirects to the correct identity provider automatically — no need to know the content source.

**Resolve org and site from available sources (project-config, ops-config, git remote):**

```bash
# Try project-config first (handover context)
ORG=$(cat .claude-plugin/project-config.json 2>/dev/null | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try { process.stdout.write(JSON.parse(d).org || ''); } catch(e) {}
")

# Fallback to ops-config (ops context)
if [ -z "$ORG" ]; then
  ORG=$(node -e "
    const fs = require('fs');
    try {
      const c = JSON.parse(fs.readFileSync(process.env.HOME + '/.aem/ops-config.json', 'utf8'));
      process.stdout.write(c.org || '');
    } catch(e) {}
  ")
fi

# Site: try git remote first, then ops-config
SITE=$(basename -s .git $(git remote get-url origin 2>/dev/null) 2>/dev/null)
if [ -z "$SITE" ]; then
  SITE=$(node -e "
    const fs = require('fs');
    try {
      const c = JSON.parse(fs.readFileSync(process.env.HOME + '/.aem/ops-config.json', 'utf8'));
      process.stdout.write(c.site || '');
    } catch(e) {}
  ")
fi

echo "org=${ORG:-NOT SET} site=${SITE:-NOT SET}"
```

**If `ORG` is empty**, ask the user:

> "I need your organization name to authenticate. You can provide either:
> - The org name (the `{org}` in `https://main--site--{org}.aem.page`)
> - A preview/live URL like `https://main--mysite--myorg.aem.page/`"

**If user provides a URL**, parse org and site from it:

```bash
URL="$USER_INPUT"
if echo "$URL" | grep -q '\.aem\.page\|\.aem\.live'; then
  HOST_PART=$(echo "$URL" | cut -d'/' -f3 | cut -d'.' -f1)
  ORG=$(echo "$HOST_PART" | awk -F'--' '{print $NF}')
  SITE=$(echo "$HOST_PART" | awk -F'--' '{print $(NF-1)}')
  echo "Parsed from URL: org=$ORG site=$SITE"
fi
```

**If `SITE` is still empty** (not in a git repo and no URL provided), ask the user:

> "I also need a site name to auto-detect your login provider. What is your site name? (the `{site}` part of `https://main--{site}--{org}.aem.page`)"

**Do NOT proceed until both org and site are available.**

### Step 3: Capture Token via Loopback Redirect

Opens the user's default browser for login. A temporary local HTTP server receives the token callback after login completes. The user must click "Send" on the confirmation page to deliver the token. Works with all identity providers (Adobe IMS, Google, Microsoft).

**User-facing message (display BEFORE running the script below):**

> **Browser opened for login to `{org}/{site}`. Click "Send" after authenticating — you can close the tab once done.**

Use bold/highlighted formatting so the instruction stands out clearly.

```bash
mkdir -p "${HOME}/.aem"

node -e "
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN_PATH = path.join(process.env.HOME, '.aem', 'ims-token.json');
const ORG = '${ORG}';
const SITE = '${SITE}';
const STATE = crypto.randomUUID();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (parsed.state !== STATE) {
          console.error('State mismatch — ignoring callback');
          res.writeHead(403);
          res.end('State mismatch');
          return;
        }
        const authToken = parsed.authToken;
        if (authToken) {
          const expiresAt = Math.floor(Date.now() / 1000) + 86400;
          fs.writeFileSync(TOKEN_PATH, JSON.stringify({
            authToken,
            authTokenExpiry: expiresAt,
          }, null, 2));
          try { fs.chmodSync(TOKEN_PATH, 0o600); } catch (e) {}
          console.log('Authentication successful');
          console.log('Token cached at: ' + TOKEN_PATH);
          console.log('Expires: ' + new Date(expiresAt * 1000).toISOString());
        } else {
          console.error('No authToken in callback. The helix-admin authToken support may not yet be deployed.');
          console.error('Keys received: ' + Object.keys(parsed).join(', '));
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('OK');
      } catch (e) {
        console.error('Failed to parse callback: ' + e.message);
        res.writeHead(400);
        res.end('Bad request');
      }
      server.close(() => process.exit(0));
    });
  } else if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body><p>Login complete. You can close this tab.</p><script>window.close()</script></body></html>');
  }
});

server.listen(0, () => {
  const port = server.address().port;
  const redirectUri = 'http://localhost:' + port + '/.aem/cli/login/ack';
  const loginUrl = 'https://admin.hlx.page/login/' + ORG + '/' + SITE + '/main?client_id=aem-cli&redirect_uri=' + encodeURIComponent(redirectUri) + '&state=' + STATE + '&selectAccount=true';

  console.log('Opening browser for login...');
  console.log('URL: ' + loginUrl);
  console.log('');
  console.log('After logging in, click the Send button to complete authentication.');
  try { execSync('open \"' + loginUrl + '\"'); } catch (e) {
    try { execSync('xdg-open \"' + loginUrl + '\"'); } catch (e2) {
      console.log('Could not open browser. Please open this URL manually:');
      console.log(loginUrl);
    }
  }
});

setTimeout(() => {
  console.error('Login timed out after 5 minutes. No callback received.');
  process.exit(1);
}, 300000);
"
```

---

## Token Storage

**User-level token cache** — `~/.aem/ims-token.json`:

```json
{
  "authToken": "eyJ...",
  "authTokenExpiry": 1780489855
}
```

| Field | Description |
|-------|-------------|
| `authToken` | Admin JWT from login callback |
| `authTokenExpiry` | Unix timestamp when token expires (~24 hours) |

Shared across every project on this machine. File is written with `0600` permissions.

---

## Using the Token

```bash
# Read token from user-level cache
AUTH_TOKEN=$(node -e "
  const fs = require('fs');
  try {
    const t = JSON.parse(fs.readFileSync(process.env.HOME + '/.aem/ims-token.json', 'utf8'));
    process.stdout.write(t.authToken || '');
  } catch (e) {}
")

# admin.hlx.page and Config Service use the same header
curl -H "x-auth-token: ${AUTH_TOKEN}" "https://admin.hlx.page/status/{org}/{site}/main/"
curl -H "x-auth-token: ${AUTH_TOKEN}" "https://admin.hlx.page/config/{org}/sites.json"
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Browser doesn't open | Manually open the URL printed in the terminal |
| "Send" button not working | Check browser console for errors; ensure no ad-blocker is blocking localhost requests |
| No authToken in callback | The helix-admin PR adding authToken to CLI login response has not yet been deployed |
| Token not received | Ensure you clicked "Send" on the confirmation page before the 5-minute timeout |
| 401 after login | Token expired, re-authenticate |
| 403 on API | User lacks permission for that org/site |
| State mismatch | Another process may have sent a rogue callback; re-run login |

---

## How It Works

1. CLI starts a temporary HTTP server on a random localhost port
2. Opens the user's default browser to `admin.hlx.page/login/{org}/{site}/main` with `client_id=aem-cli` and `redirect_uri=http://localhost:{port}/...`
3. Admin API auto-detects IDP (Google, Microsoft, Adobe) and redirects to login
4. User authenticates in their real browser
5. After login, admin API shows a confirmation page with a "Send" button
6. User clicks "Send" — browser POSTs `{ state, authToken }` to localhost
7. CLI validates state nonce, saves `authToken` to `~/.aem/ims-token.json`, exits

---

## Integration

Called by: `ops`, `handover-admin`, `handover-author`, `handover-developer`, `handover`

```
Skill({ skill: "aem-project-management:auth" })
```
