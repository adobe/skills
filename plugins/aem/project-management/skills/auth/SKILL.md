---
name: auth
description: Authenticate with AEM Edge Delivery Services using Adobe IMS OAuth. Opens browser for Adobe ID login and captures token. Works for admin.hlx.page, admin.da.live, and Config Service APIs.
license: Apache-2.0
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
metadata:
  version: "2.0.0"
---

# AEM Edge Delivery Services Authentication

Authenticate with Adobe IMS to obtain a Bearer token for all Edge Delivery Services admin operations.

## Token Usage

The IMS token works for all admin APIs:

| API | Usage |
|-----|-------|
| `admin.hlx.page` | Preview, publish, status, code sync, jobs, logs |
| `admin.da.live` | DA content operations (list, source, copy, move) |
| Config Service | Sites, config, secrets, API keys, profiles |

**Header:** `Authorization: Bearer ${IMS_TOKEN}`

## When to Use This Skill

- API returns 401 Unauthorized
- User says "login", "authenticate", "auth"
- Before any admin operation when token is missing/expired
- Before generating guides that need API access

## Prerequisites

- Node.js installed
- Playwright installed (`npx playwright install chromium`)

---

## Authentication Flow

### Step 1: Check Existing Token

```bash
CONFIG_FILE=".claude-plugin/project-config.json"
mkdir -p .claude-plugin
grep -qxF '.claude-plugin/' .gitignore 2>/dev/null || echo '.claude-plugin/' >> .gitignore

IMS_TOKEN=$(cat "$CONFIG_FILE" 2>/dev/null | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try { console.log(JSON.parse(d).imsToken || ''); } catch(e) { console.log(''); }
")
IMS_EXPIRY=$(cat "$CONFIG_FILE" 2>/dev/null | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try { console.log(JSON.parse(d).imsTokenExpiry || 0); } catch(e) { console.log(0); }
")
NOW=$(date +%s)

if [ -n "$IMS_TOKEN" ] && [ "$IMS_EXPIRY" -gt "$((NOW + 60))" ]; then
  echo "Token valid (expires in $((IMS_EXPIRY - NOW)) seconds)"
  exit 0
fi

echo "Token missing or expired. Starting login..."
```

### Step 2: Install Playwright (if needed)

```bash
npx playwright --version 2>/dev/null || npm install -g playwright
npx playwright install chromium 2>/dev/null || true
```

### Step 3: Capture IMS Token via Playwright

Playwright opens browser, local HTTP server captures the OAuth token from redirect, then browser closes automatically.

```bash
mkdir -p .claude-plugin

node -e "
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const CALLBACK_PORT = 9898;
const CONFIG_PATH = '.claude-plugin/project-config.json';

const scopes = 'ab.manage,AdobeID,gnav,openid,org.read,read_organizations,session,aem.frontend.all,additional_info.ownerOrg,additional_info.projectedProductContext,account_cluster.read';

const authUrl = 'https://ims-na1.adobelogin.com/ims/authorize/v2' +
  '?client_id=darkalley' +
  '&scope=' + encodeURIComponent(scopes) +
  '&response_type=token' +
  '&redirect_uri=' + encodeURIComponent('http://localhost:' + CALLBACK_PORT + '/callback');

let browser;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:' + CALLBACK_PORT);
  
  if (url.pathname === '/callback') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(\\\`<!DOCTYPE html><html><body>
<script>
  const p = new URLSearchParams(window.location.hash.substring(1));
  const token = p.get('access_token');
  const expiresIn = p.get('expires_in');
  if (token) {
    fetch('/token?access_token=' + encodeURIComponent(token) + '&expires_in=' + encodeURIComponent(expiresIn || ''));
    document.body.innerHTML = '<h2>Login successful!</h2>';
  } else {
    fetch('/token?error=failed');
    document.body.innerHTML = '<h2>Login failed</h2>';
  }
</script>
</body></html>\\\`);
    return;
  }
  
  if (url.pathname === '/token') {
    const token = url.searchParams.get('access_token');
    const expiresIn = url.searchParams.get('expires_in');
    res.writeHead(200); res.end();
    server.close();
    
    if (token) {
      const expiresAt = Math.floor(Date.now() / 1000) + parseInt(expiresIn || '86400', 10);
      let config = {};
      try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch(e) {}
      config.imsToken = token;
      config.imsTokenExpiry = expiresAt;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      
      console.log('Authentication successful');
      console.log('Expires: ' + new Date(expiresAt * 1000).toISOString());
      
      // Auto-close browser
      if (browser) browser.close().then(() => process.exit(0));
    } else {
      console.error('Login failed');
      if (browser) browser.close().then(() => process.exit(1));
    }
  }
});

(async () => {
  server.listen(CALLBACK_PORT, 'localhost');
  
  console.log('Opening browser for Adobe ID login...');
  browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(authUrl);
  
  // Timeout after 5 minutes
  setTimeout(() => {
    console.error('Login timed out');
    server.close();
    browser.close().then(() => process.exit(1));
  }, 5 * 60 * 1000);
})();
"
```

---

## Token Storage

Stored in `.claude-plugin/project-config.json`:

```json
{
  "org": "myorg",
  "site": "mysite",
  "imsToken": "eyJ...",
  "imsTokenExpiry": 1777891272
}
```

| Field | Description |
|-------|-------------|
| `imsToken` | IMS OAuth token |
| `imsTokenExpiry` | Unix timestamp when token expires |

---

## Using the Token

```bash
IMS_TOKEN=$(cat .claude-plugin/project-config.json | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  console.log(JSON.parse(d).imsToken);
")

# All APIs use the same header
curl -H "Authorization: Bearer ${IMS_TOKEN}" "https://admin.hlx.page/status/{org}/{site}/main/"
curl -H "Authorization: Bearer ${IMS_TOKEN}" "https://admin.hlx.page/config/{org}/sites.json"
curl -H "Authorization: Bearer ${IMS_TOKEN}" "https://admin.da.live/list/{org}/{site}"
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `npx playwright` not found | Run `npm install -g playwright` |
| Browser doesn't open | Run `npx playwright install chromium` |
| Port 9898 in use | Kill process or wait |
| Login page doesn't load | Check network to `ims-na1.adobelogin.com` |
| Token not captured | Ensure login completed before closing browser |
| 401 after login | Token expired, re-authenticate |
| 403 on API | User lacks permission for that org/site |

---

## Integration

Called by: `ops`, `admin`, `authoring`, `development`, `handover`

```
Skill({ skill: "project-management:auth" })
```
