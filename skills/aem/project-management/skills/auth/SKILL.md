---
name: auth
description: Authenticate with AEM Edge Delivery Services Config Service API. Opens a browser window for Adobe ID login and captures the auth token when browser is closed. Use when generating guides/documentation that require API access.
license: Apache-2.0
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
metadata:
  version: "1.0.0"
---

# AEM Config Service Authentication

This skill handles browser-based authentication for AEM Edge Delivery Services Config Service API using Playwright CLI. It opens a browser window for Adobe ID login and captures the auth token when the browser is closed.

## When to Use This Skill

- Before generating admin/authoring/development guides that need API data
- When Config Service API returns 401 Unauthorized
- User says "login", "authenticate", "get auth token"
- Orchestrated by handover/admin/authoring/development skills

## Prerequisites

- Organization name must be known (from `.claude-plugin/project-config.json` or user input)
- Node.js and npm installed

---

## Authentication Flow

### Step 1: Get Organization and Site Names

```bash
# Read saved org name
ORG=$(cat .claude-plugin/project-config.json 2>/dev/null | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
```

If org is not saved, prompt user:
> "What is your Config Service organization name? (the `{org}` in `https://main--site--{org}.aem.page`)"

Save the org name:
```bash
mkdir -p .claude-plugin
# Ensure .claude-plugin is in .gitignore (contains auth tokens)
grep -qxF '.claude-plugin/' .gitignore 2>/dev/null || echo '.claude-plugin/' >> .gitignore
echo "{\"org\": \"${ORG}\"}" > .claude-plugin/project-config.json
```

Then fetch the first site name from Config Service (unauthenticated endpoint):

```bash
SITE=$(curl -s "https://admin.hlx.page/config/${ORG}/sites.json" | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/"name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
```

### Step 2: Install Playwright (if needed)

```bash
npx playwright --version 2>/dev/null || npm install -g playwright
npx playwright install chromium 2>/dev/null || true
```

### Step 3: Display Clear Instructions and Open Browser

**IMPORTANT: Print highly visible instructions BEFORE opening the browser:**

```bash
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║   BROWSER WINDOW OPENING FOR ADOBE ID LOGIN                    ║"
echo "║                                                                ║"
echo "║   1. Sign in with your Adobe ID credentials                   ║"
echo "║   2. After successful login, CLOSE THE BROWSER WINDOW         ║"
echo "║                                                                ║"
echo "║   >>> CLOSE THE BROWSER TO CONTINUE <<<                       ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
```

Then open the browser with storage save:

```bash
mkdir -p .claude-plugin
npx playwright open --save-storage=.claude-plugin/auth-storage.json "https://admin.hlx.page/login/${ORG}/${SITE}/main"
```

**Note:** This command blocks until the browser is closed. The auth token is saved to `auth-storage.json` when the browser closes.

### Step 4: Extract Auth Token from Storage

After browser is closed, extract the token:

```bash
echo ""
echo "Browser closed. Extracting auth token..."

AUTH_TOKEN=$(node -e "
const fs = require('fs');
try {
  const data = JSON.parse(fs.readFileSync('.claude-plugin/auth-storage.json', 'utf8'));
  const cookie = data.cookies.find(c => c.name === 'auth_token');
  if (cookie) {
    console.log(cookie.value);
  } else {
    console.error('ERROR: auth_token cookie not found. Login may have failed.');
    process.exit(1);
  }
} catch (e) {
  console.error('ERROR: Could not read auth storage file.');
  process.exit(1);
}
")
```

### Step 5: Save Auth Token to Project Config

```bash
ORG=$(cat .claude-plugin/project-config.json | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

echo "{\"org\": \"${ORG}\", \"authToken\": \"${AUTH_TOKEN}\"}" > .claude-plugin/project-config.json

# Clean up storage file (contains sensitive session data)
rm -f .claude-plugin/auth-storage.json

echo "Auth token saved successfully."
```

### Step 6: Verify Token Works

```bash
AUTH_TOKEN=$(cat .claude-plugin/project-config.json | grep -o '"authToken"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"authToken"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
ORG=$(cat .claude-plugin/project-config.json | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites.json")

if [ "$HTTP_CODE" = "200" ]; then
  echo ""
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║  ✓ AUTHENTICATION SUCCESSFUL                                   ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""
else
  echo ""
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║  ✗ AUTHENTICATION FAILED (HTTP $HTTP_CODE)                        ║"
  echo "║    Please try again                                            ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""
fi
```

---

## Token Storage

Auth tokens are stored in `.claude-plugin/project-config.json`:

```json
{
  "org": "myorg",
  "authToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Security Note:** Add `.claude-plugin/` to `.gitignore`.

---

## Using the Token in Other Skills

```bash
AUTH_TOKEN=$(cat .claude-plugin/project-config.json 2>/dev/null | grep -o '"authToken"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"authToken"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

curl -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/{site}/access.json"
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `npx playwright` not found | Run `npm install -g playwright` |
| Browser doesn't open | Run `npx playwright install chromium` |
| Token not found after login | Ensure login completed before closing browser |
| Login page not loading | Verify org/site names are correct |
| API returns 401 | Token expired, re-authenticate |

---

## Integration with Other Skills

Called by: `admin`, `authoring`, `development`, `handover`

**Invocation:**
```
Skill({ skill: "project-management:auth" })
```
