---
name: create-site
description: Creates a new AEM Edge Delivery site from scratch — GitHub repo from the boilerplate, aem-code-sync installation, initial DA content (nav, footer, homepage), and a live preview URL. Use this skill whenever a user wants to create a new AEM Edge Delivery site and no repository or DA content exists yet.
license: Apache-2.0
metadata:
  version: "1.1.0"
---

# Create a New AEM Edge Delivery Site

This skill walks through the full onboarding flow for a new AEM Edge Delivery site. It handles everything that can be automated and clearly signals the steps that require human action.

## When to Use This Skill

Use this skill when:
- A user wants to create a brand-new AEM Edge Delivery site from scratch
- A user asks to "set up a new site", "create a new EDS project", or "onboard a new site"
- No GitHub repository or DA content exists yet for the project

**Do NOT use this skill for:**
- Importing or migrating existing pages (use **page-import** skill)
- Building or modifying blocks on an existing site (use **content-driven-development** skill)

## Prerequisites

- A GitHub account with permission to create repositories in the target org
- An Adobe IMS account with access to DA (da.live)
- `gh` CLI authenticated (`gh auth status`) or a GitHub personal access token with `repo` scope
- Node.js (for DA token management via da-auth-helper)

## Related Skills

- **page-import** — Import existing pages into the newly created site
- **content-driven-development** — Build and modify blocks once the site exists
- **building-blocks** — Implement new block code

---

## Step 0: Create TodoList

Create a checklist to track progress (use your agent's task-tracking tool if available):

1. **Gather inputs** — org, repo name, site name collected
2. **Create GitHub repository** — repo created from boilerplate template
3. **Install aem-code-sync** *(human action)* — GitHub App installed on repo
4. **Authenticate with DA** — valid IMS token obtained
5. **Create initial content in DA** — nav, footer, index created
6. **Trigger preview** — all three paths return 200/201
7. **Hand off** — preview URL and DA links delivered to user

---

## Step 1: Gather Inputs

Ask the user for the following. Do not proceed until all required inputs are provided.

1. **GitHub org** — the GitHub organization or username where the repo will be created (e.g. `my-org`)
2. **Project name** — the repository name, lowercase, hyphens only (e.g. `my-site`)
3. **Site name** — the human-readable name used in content (e.g. `My Site`). If not provided, derive it from the project name.

Store as: `{{ORG}}`, `{{REPO}}`, `{{SITE_NAME}}`

---

## Step 2: Create GitHub Repository

Create a new repository using the `adobe/aem-boilerplate` template.

**Option A — GitHub CLI (preferred, handles auth automatically):**
```bash
gh repo create {{ORG}}/{{REPO}} \
  --template adobe/aem-boilerplate \
  --description "{{SITE_NAME}} — AEM Edge Delivery site" \
  --public
```

Check if `gh` is available with `gh auth status`. If not authenticated, run `gh auth login` first.

**Option B — GitHub API (if `gh` CLI is not available):**
```
POST https://api.github.com/repos/adobe/aem-boilerplate/generate
Authorization: Bearer {{GITHUB_TOKEN}}
Content-Type: application/json

{
  "owner": "{{ORG}}",
  "name": "{{REPO}}",
  "description": "{{SITE_NAME}} — AEM Edge Delivery site",
  "private": false,
  "include_all_branches": false
}
```

To obtain a token: https://github.com/settings/tokens/new — scope: `repo`.

**Success:** HTTP 201 (API) or exit code 0 (CLI). The repo is now live at `https://github.com/{{ORG}}/{{REPO}}`.

---

## Step 3: Install aem-code-sync *(human action required)*

The aem-code-sync GitHub App connects the repository to AEM's content delivery pipeline. This step cannot be automated — the user must complete it in the browser.

Tell the user:

> **Action required:** Install the AEM Code Sync app on your new repository.
>
> 1. Open this URL: https://github.com/apps/aem-code-sync/installations/new
> 2. Under "Repository access", select **Only select repositories**
> 3. Choose **{{ORG}}/{{REPO}}** from the list
> 4. Click **Save**
>
> Reply "done" when complete.

Wait for confirmation before proceeding.

**Verify:** After confirmation, check that `https://admin.hlx.page/status/{{ORG}}/{{REPO}}/main/` returns a valid JSON response (not 404). If it does, the app is correctly installed.

---

## Step 4: Authenticate with DA

DA requires Adobe IMS authentication. Choose the appropriate path:

**Option A — da-auth-helper (preferred)**

`da-auth-helper` (https://github.com/adobe-rnd/da-auth-helper) caches IMS tokens at `~/.aem/da-token.json`. Always check the cache first before triggering a new OAuth flow.

1. Check for a valid cached token:
```bash
node -e "
  const fs = require('fs');
  const p = process.env.HOME + '/.aem/da-token.json';
  if (!fs.existsSync(p)) { console.log('No cache'); process.exit(1); }
  const t = JSON.parse(fs.readFileSync(p));
  console.log('Valid:', t.expires_at > Date.now());
  console.log('Expires:', new Date(t.expires_at).toISOString());
"
```

2. If valid, capture the token and skip to Step 5:
```bash
DA_TOKEN=$(node -e "const t = require(process.env.HOME + '/.aem/da-token.json'); process.stdout.write(t.access_token);")
```

3. If missing or expired, install da-auth-helper from GitHub (it is not published to npm) and refresh:
```bash
npm install -g github:adobe-rnd/da-auth-helper
da-auth-helper token
```
This opens a browser for Adobe IMS login and writes the new token to `~/.aem/da-token.json`. Then capture it as in step 2.

**Option B — DA MCP is configured**

If the DA MCP server is available, trigger the authentication tool to start the OAuth flow and share the authorization URL with the user.

**Option C — Manual token**

Ask the user to obtain an IMS token from their browser (e.g. from the DA network tab or an existing session) and paste it. Store as `{{DA_TOKEN}}`.

---

## Step 5: Create Initial Content in DA

Create the three mandatory pages every EDS site requires. Use the templates below exactly — they are pre-validated for EDS compliance.

**Option A — DA MCP:**
Call the DA create source tool three times with the content below.

**Option B — DA API:**

Write each file to a temp file first, then POST using `@` syntax. Inline multiline content with `-F 'data=...'` causes curl to fail (exit 26). Use `/usr/bin/curl` explicitly to avoid PATH resolution issues in subshells.

```bash
cat > /tmp/nav.html << 'EOF'
<nav content>
EOF
/usr/bin/curl -s -o /dev/null -w "%{http_code}" -X POST "https://admin.da.live/source/{{ORG}}/{{REPO}}/nav.html" \
  -H "Authorization: Bearer {{DA_TOKEN}}" \
  -F "data=@/tmp/nav.html;type=text/html"
```

Repeat for `footer.html` and `index.html`.

**Verify:** After each POST, expect HTTP 201. If you get 401, the token has expired — return to Step 4.

---

### nav.html

```html
<main>
  <div>
    <p><a href="/">{{SITE_NAME}}</a></p>
  </div>
  <div>
    <ul>
      <li><a href="/">Home</a></li>
    </ul>
  </div>
  <div></div>
</main>
```

### footer.html

```html
<main>
  <div>
    <p>© 2024 {{SITE_NAME}}. All rights reserved.</p>
  </div>
</main>
```

### index.html

```html
<main>
  <div>
    <h1>Welcome to {{SITE_NAME}}</h1>
    <p>Your new site is ready. Start editing this page in DA.</p>
  </div>
</main>
```

---

## Step 6: Trigger Preview

Preview pulls the DA content into the AEM delivery pipeline and makes it accessible on the `.aem.page` domain.

DA-sourced content requires the Bearer token on preview requests — even for public repos. Use `/usr/bin/curl` explicitly.

```bash
/usr/bin/curl -s -o /dev/null -w "%{http_code}" -X POST "https://admin.hlx.page/preview/{{ORG}}/{{REPO}}/main/nav" \
  -H "Authorization: Bearer {{DA_TOKEN}}"
/usr/bin/curl -s -o /dev/null -w "%{http_code}" -X POST "https://admin.hlx.page/preview/{{ORG}}/{{REPO}}/main/footer" \
  -H "Authorization: Bearer {{DA_TOKEN}}"
/usr/bin/curl -s -o /dev/null -w "%{http_code}" -X POST "https://admin.hlx.page/preview/{{ORG}}/{{REPO}}/main/" \
  -H "Authorization: Bearer {{DA_TOKEN}}"
```

**Success:** HTTP 200 or 201 for each. The homepage is now live at:
```
https://main--{{REPO}}--{{ORG}}.aem.page/
```

---

## Step 7: Confirm and Hand Off

Tell the user:

> **Your site is ready!**
>
> - **Preview:** `https://main--{{REPO}}--{{ORG}}.aem.page/`
> - **Browse content in DA:** `https://da.live/#/{{ORG}}/{{REPO}}/`
> - **Edit homepage:** `https://da.live/edit#/{{ORG}}/{{REPO}}/index`
> - **Edit nav:** `https://da.live/edit#/{{ORG}}/{{REPO}}/nav`
> - **Edit footer:** `https://da.live/edit#/{{ORG}}/{{REPO}}/footer`
> - **GitHub repo:** `https://github.com/{{ORG}}/{{REPO}}`
>
> To start developing locally:
> ```bash
> git clone https://github.com/{{ORG}}/{{REPO}}.git
> cd {{REPO}}
> npm install
> aem up
> ```
>
> What would you like to do next — add more pages, customize a block, or set up a custom domain?

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Step 2 returns 422 | Repo name already exists | Ask user for a different name |
| Step 3 verify returns 404 | aem-code-sync not installed | Re-send the installation URL |
| Step 4 cached token missing/expired | No prior DA session on this machine | Install da-auth-helper from GitHub (`npm install -g github:adobe-rnd/da-auth-helper`) and run `da-auth-helper token` |
| Step 5 curl exits with code 26 | Inline multiline content in `-F` flag | Write content to a temp file and use `@/tmp/file.html` syntax |
| Step 5 returns 401 | Expired or missing IMS token | Re-check `~/.aem/da-token.json` expiry; ask user for a fresh token |
| Step 5 returns 403 | Token lacks permission for this org/repo | Confirm the user has write access to `{{ORG}}/{{REPO}}` in DA |
| Step 6 returns 401 | DA-sourced content requires auth on preview | Add `-H "Authorization: Bearer {{DA_TOKEN}}"` to preview requests |
| Step 6 returns 404 | aem-code-sync not installed correctly | Verify Step 3, then retry |
| `curl: command not found` in scripts | PATH not resolved in subshell | Use `/usr/bin/curl` explicitly |
| Preview URL shows blank page | nav or index not previewed | Re-run Step 6 for the failing path |

---

## Reference

- Boilerplate: https://github.com/adobe/aem-boilerplate
- aem-code-sync app: https://github.com/apps/aem-code-sync
- DA docs: https://da.live/docs
- DA Admin API: https://opensource.adobe.com/da-admin/
- DA Auth (IMS token helper): https://github.com/adobe-rnd/da-auth-helper
- AEM Admin API: https://www.aem.live/docs/admin.html
- Full onboarding guide: https://www.aem.live/developer/create-site.md

### DA URL patterns

- Browse folder: `https://da.live/#/{{org}}/{{repo}}{{folder-path}}`
- Edit HTML document: `https://da.live/edit#/{{org}}/{{repo}}{{path-without-extension}}`
- Edit JSON/sheet: `https://da.live/sheet#/{{org}}/{{repo}}{{path-without-extension}}`
