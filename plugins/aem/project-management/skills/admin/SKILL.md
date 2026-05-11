---
name: admin
description: Generate comprehensive admin documentation for AEM Edge Delivery Services project handover. Creates admin guide covering Config Service setup, permissions, access control, Admin API operations, cache management, and code sync. Use for "admin guide", "admin documentation", "admin handover".
license: Apache-2.0
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion, Skill
metadata:
  version: "1.1.0"
---

# Project Handover - Admin Guide

Generate comprehensive documentation for administrators taking over an AEM Edge Delivery Services project. Produces a complete admin guide with Config Service setup, permissions, Admin API operations, and troubleshooting.

## When to Use This Skill

- Project handover to client administrators
- Documenting admin procedures for a project
- Creating operations runbook
- "Generate admin guide"
- "Admin documentation"
- "Admin handover"

---

## Step 0: Navigate to Project Root and Verify Edge Delivery Services Project (CONDITIONAL)

**Skip this step if `allGuides` flag is set** (orchestrator already validated and navigated).

**CRITICAL: If NOT skipped, you MUST execute the `cd` command. Do NOT use absolute paths — actually change directory.**

```bash
ALL_GUIDES=$(cat .claude-plugin/project-config.json 2>/dev/null | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try { console.log(JSON.parse(d).allGuides ? 'true' : ''); } catch(e) { console.log(''); }
")
if [ -z "$ALL_GUIDES" ]; then
  # Navigate to git project root (works from any subdirectory)
  cd "$(git rev-parse --show-toplevel)"
  # Verify it's an Edge Delivery Services project
  ls scripts/aem.js
fi
```

**IMPORTANT:**
- You MUST run the `cd` command above using the Bash tool
- All subsequent steps operate from project root
- Do NOT use absolute paths to verify — actually navigate
- Guides will be created at `project-root/project-guides/`

**If NOT skipped AND `scripts/aem.js` does NOT exist**, respond:

> "This skill is designed for AEM Edge Delivery Services projects. The current directory does not appear to be an Edge Delivery Services project (`scripts/aem.js` not found).
>
> Please navigate to an Edge Delivery Services project and try again."

**STOP if check fails. Otherwise proceed — you are now at project root.**

---

## Execution Checklist

```markdown
- [ ] Phase 1: Gather Project Context
- [ ] Phase 2: Generate Admin Guide Content
- [ ] Phase 3: Customize for Project
- [ ] Phase 4: Generate Professional PDF
```

---

## Communication Guidelines

- **NEVER use "EDS"** as an acronym for Edge Delivery Services in any generated documentation or chat responses
- Always use the full name "Edge Delivery Services" or "AEM Edge Delivery Services"
- This applies to all output files (PDF, HTML, markdown) and all communication with the user

---

## ⚠️ CRITICAL PATH REQUIREMENT

**YOU MUST SAVE THE FILE TO THIS EXACT PATH:**

```
project-guides/ADMIN-GUIDE.md
```

**BEFORE WRITING ANY FILE:**
1. First, create the directory: `mkdir -p project-guides`
2. Then write to: `project-guides/ADMIN-GUIDE.md`

**WHY THIS MATTERS:** Files must be in `project-guides/` for proper organization and PDF conversion.

❌ **WRONG:** `ADMIN-GUIDE.md` (root)
❌ **WRONG:** `docs/ADMIN-GUIDE.md`
❌ **WRONG:** `/workspace/ADMIN-GUIDE.md`
✅ **CORRECT:** `project-guides/ADMIN-GUIDE.md`

---

## Output Format

**MANDATORY OUTPUT:** `project-guides/ADMIN-GUIDE.pdf`

**STRICTLY FORBIDDEN:**
- ❌ Do NOT read or analyze `fstab.yaml` — it does NOT exist in most projects and does NOT show all sites
- ❌ Do NOT create `.plain.html` files
- ❌ Do NOT use `convert_markdown_to_html` tool — this converts the FULL guide to HTML with raw frontmatter visible, which is NOT what we want
- ❌ Do NOT tell user to "convert markdown to PDF manually"
- ❌ Do NOT save markdown to root directory or any path other than `project-guides/`
- ❌ Do NOT say "PDF will be generated later" or "at session end" — generate it NOW

**The HTML output must be a SHORT summary page** (created with Write tool) containing:
- Title and brief description
- "What's Inside" bullet list
- PDF download link
NOT the full guide content converted to HTML.

**REQUIRED WORKFLOW:**
1. Run `mkdir -p project-guides` to ensure directory exists
2. Generate markdown content with YAML frontmatter (title, date)
3. Save to `project-guides/ADMIN-GUIDE.md` (EXACT PATH - no exceptions)
4. **IMMEDIATELY** invoke PDF conversion (see Phase 4.1)
5. Clean up all source files (only PDF remains)
6. Final output: `project-guides/ADMIN-GUIDE.pdf`

---

## Phase 0: Get Organization Name (Required First)

**Whenever this skill runs** — whether the user triggered it directly (e.g. "generate admin guide") or via the handover flow — you must have the Config Service organization name before doing anything else. Do not skip this phase.

### 0.1 Check for Saved Organization

```bash
# Check if org name is already saved
cat .claude-plugin/project-config.json 2>/dev/null | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try { const o = JSON.parse(d).org; if(o) console.log('org: ' + o); } catch(e) {}
"
```

### 0.2 Prompt for Organization Name (If Not Saved)

**If no org name is saved**, you MUST pause and ask the user directly:

> "What is your Config Service organization name? This is the `{org}` part of your Edge Delivery Services URLs (e.g., `https://main--site--{org}.aem.page`). The org name may differ from your GitHub organization."

**IMPORTANT RULES:**
- **DO NOT use `AskUserQuestion` with predefined options** — ask as a plain text question
- **Organization name is MANDATORY** — do not offer a "skip" option
- **Wait for user to type the org name** before proceeding
- If user doesn't provide a valid org name, ask again

### 0.3 Save Organization Name

Once you have the org name (either from saved config or user input), save it for future use:

```bash
# Create config directory if needed
mkdir -p .claude-plugin
# Ensure .claude-plugin is in .gitignore (contains auth tokens)
grep -qxF '.claude-plugin/' .gitignore 2>/dev/null || echo '.claude-plugin/' >> .gitignore

# Save org name to config file (create or update)
if [ -f .claude-plugin/project-config.json ]; then
  cat .claude-plugin/project-config.json | sed 's/"org"[[:space:]]*:[[:space:]]*"[^"]*"/"org": "{ORG_NAME}"/' > /tmp/project-config.json && mv /tmp/project-config.json .claude-plugin/project-config.json
else
  echo '{"org": "{ORG_NAME}"}' > .claude-plugin/project-config.json
fi
```

Replace `{ORG_NAME}` with the actual organization name provided by the user.

---

## Phase 0.5: Authenticate with Adobe IMS

**After getting the organization name, authenticate to obtain an IMS token.**

### 0.5.1 Check for Existing Auth Token

```bash
IMS_TOKEN=$(cat .claude-plugin/project-config.json 2>/dev/null | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try { console.log(JSON.parse(d).imsToken || ''); } catch(e) { console.log(''); }
")
IMS_EXPIRY=$(cat .claude-plugin/project-config.json 2>/dev/null | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try { console.log(JSON.parse(d).imsTokenExpiry || 0); } catch(e) { console.log(0); }
")
NOW=$(date +%s)

if [ -n "$IMS_TOKEN" ] && [ "$IMS_EXPIRY" -gt "$((NOW + 60))" ]; then
  echo "Token valid (expires in $((IMS_EXPIRY - NOW)) seconds)"
else
  echo "Token missing or expired. Need to authenticate."
fi
```

### 0.5.2 Authenticate (If No Valid Token)

If no valid token exists, invoke the auth skill:

```
Skill({ skill: "project-management:auth" })
```

This will:
1. Open a browser for Adobe ID login
2. Capture the IMS OAuth token automatically
3. Save token to `.claude-plugin/project-config.json`
4. Auto-close the browser when complete

### 0.5.3 Verify Authentication

After auth skill completes, verify token works:

```bash
eval $(cat .claude-plugin/project-config.json | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  const c = JSON.parse(d);
  console.log('IMS_TOKEN=' + JSON.stringify(c.imsToken || ''));
  console.log('ORG=' + JSON.stringify(c.org || ''));
")

# Test with authenticated endpoint
curl -s -w "%{http_code}" -o /dev/null -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites.json"
```

If returns 200, authentication is successful. If 401, re-run auth skill.

---

## Phase 1: Gather Project Context

### 1.1 Fetch Sites and Code Repo via Config Service API

**⚠️ MANDATORY DATA SOURCE — NO ALTERNATIVES ALLOWED**

You MUST call the Config Service API. This is the ONLY acceptable source for site information.

**❌ PROHIBITED APPROACHES (will produce incorrect results):**
- Analyzing `fstab.yaml` — does NOT show all sites in repoless setups
- Reading `README.md` — may be outdated or incomplete
- Inferring from codebase structure — misses CDN configs and additional sites
- Using git remote URLs — org name may differ from Config Service org
- Making assumptions based on project folder names

**✅ REQUIRED: Execute and save response:**

```bash
ORG=$(cat .claude-plugin/project-config.json | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  console.log(JSON.parse(d).org || '');
")

# Save response to file - Step 1.2 depends on this file
curl -s -H "Accept: application/json" "https://admin.hlx.page/config/${ORG}/sites.json" > .claude-plugin/sites-config.json
```

**📁 REQUIRED ARTIFACT:** `.claude-plugin/sites-config.json`

**API Reference:** https://www.aem.live/docs/admin.html#tag/siteConfig/operation/getConfigSites

---

The response is a JSON object with a `sites` array (each entry has a `name` field). Extract site names and construct per-site URLs:
- **Preview:** `https://main--{site-name}--{org}.aem.page/`
- **Live:** `https://main--{site-name}--{org}.aem.live/`

Multiple sites = **repoless** setup. Single site = **standard** setup.

**Then fetch individual site config for code and content details:**

```bash
IMS_TOKEN=$(cat .claude-plugin/project-config.json | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  console.log(JSON.parse(d).imsToken || '');
")
curl -s -H "Authorization: Bearer ${IMS_TOKEN}" "https://admin.hlx.page/config/${ORG}/sites/{site-name}.json"
```

**Example response:**
```json
{
  "code": {
    "owner": "github-owner",
    "repo": "repo-name",
    "source": { "type": "github", "url": "https://github.com/owner/repo" }
  },
  "content": {
    "source": {
      "url": "https://content.da.live/org-name/site-name/",
      "type": "markup"
    }
  }
}
```

**Extract from response:**
- `code.owner` / `code.repo` — GitHub repository
- `content.source.url` — Content mountpath (e.g., `https://content.da.live/org/site/`)
- `content.source.type` — Content source type (markup, onedrive, google)

**⚠️ Do NOT use `fstab.yaml`** — use Config Service API instead.

### 1.2 Build Context

**Read from artifact created in 1.1:**

```bash
cat .claude-plugin/sites-config.json
```

Parse the JSON to extract site names, then fetch each site's config for code repo:

```bash
curl -s -H "Accept: application/json" "https://admin.hlx.page/config/${ORG}/sites/{site-name}.json"
```

Use these API responses to build context: site names, code repo (owner/repo), preview/live URLs. If site config includes a content source (e.g. content.da.live path), record it for the Sites table.

```
Admin Context:
├── Organization: {org from saved config}
├── Site(s): {site1}, {site2}, ... (from Config Service API response)
├── Setup Type: {repoless | standard} (from Config Service API)
├── Code Repo: {code.owner}/{code.repo} (from Config Service — GitHub or Cloud Manager)
├── Preview: https://main--{site}--{org}.aem.page/
├── Live: https://main--{site}--{org}.aem.live/
├── Login URL: https://admin.hlx.page/login/{org}/{site}
└── Config Service: https://admin.hlx.page/config/{org}/
```

---

## Phase 2: Generate Admin Guide

### Output File: `project-guides/ADMIN-GUIDE.md`

Generate the admin handover document with the following structure:

```markdown
# [Project Name] - Admin Guide

Complete administration guide for managing this Edge Delivery Services project.

## Quick Reference

### URLs

| Purpose | URL |
|---------|-----|
| **Login** | https://admin.hlx.page/login/{org}/{site} |
| **Config Service** | https://admin.hlx.page/config/{org}/ |
| **Preview** | https://main--{site}--{org}.aem.page/ |
| **Live** | https://main--{site}--{org}.aem.live/ |

### Sites (if multi-site/repoless)

| Site | Content Source (DA) | Preview | Live |
|------|---------------------|---------|------|
| {site1} | [from site config if present] | https://main--{site1}--{org}.aem.page/ | https://main--{site1}--{org}.aem.live/ |
| {site2} | [from site config if present] | https://main--{site2}--{org}.aem.page/ | https://main--{site2}--{org}.aem.live/ |

## Authentication

### Login

1. Open: https://admin.hlx.page/login/{org}/{site}
2. Sign in with your Adobe ID
3. Copy auth token for API operations

### Logout

```bash
curl -X POST \
  -H "Authorization: Bearer $IMS_TOKEN" \
  "https://admin.hlx.page/logout/{org}/{site}/main"
```

## User Management

### View Current Access

```bash
curl -H "Authorization: Bearer $IMS_TOKEN" \
  "https://admin.hlx.page/config/{org}/sites/{site}/access.json"
```

### Add User

| Role | Command |
|------|---------|
| Admin | `POST /config/{org}/sites/{site}/access/admin.json` with `{"users": ["email"]}` |
| Author | `POST /config/{org}/sites/{site}/access/author.json` with `{"users": ["email"]}` |

### Remove User

```bash
curl -X DELETE \
  -H "Authorization: Bearer $IMS_TOKEN" \
  "https://admin.hlx.page/config/{org}/sites/{site}/access/admin/{email}.json"
```

## Content Operations

### Preview

| Operation | Endpoint |
|-----------|----------|
| Single page | `POST /preview/{org}/{site}/main/{path}` |
| Bulk preview | `POST /preview/{org}/{site}/main/*` |

### Publish

| Operation | Endpoint |
|-----------|----------|
| Single page | `POST /live/{org}/{site}/main/{path}` |
| Bulk publish | `POST /live/{org}/{site}/main/*` |
| Unpublish | `DELETE /live/{org}/{site}/main/{path}` |

### Cache

| Operation | Endpoint |
|-----------|----------|
| Purge path | `POST /cache/{org}/{site}/main/{path}` |
| Purge all | `POST /cache/{org}/{site}/main/*` |

## Code Operations

### Sync Code

```bash
curl -X POST \
  -H "Authorization: Bearer $IMS_TOKEN" \
  "https://admin.hlx.page/code/{owner}/{repo}/main"
```

## Common Tasks

| Task | Steps |
|------|-------|
| **Add new admin** | POST to `/config/{org}/sites/{site}/access/admin.json` |
| **Republish site** | POST to `/preview/{org}/{site}/main/*` then `/live/{org}/{site}/main/*` |
| **Clear all cache** | POST to `/cache/{org}/{site}/main/*` |
| **Deploy code changes** | POST to `/code/{owner}/{repo}/main` |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Token expired - login again |
| 403 Forbidden | Insufficient permissions - check role |
| 404 Not Found | Check org/site/path spelling |
| 429 Rate Limited | Wait and retry |
| Cache not clearing | Try with `forceUpdate: true` |
| Code not syncing | Manual sync: POST to `/code/{owner}/{repo}/main` |

---

## Resources

| Resource | URL |
|----------|-----|
| Admin API Docs | https://www.aem.live/docs/admin.html |
| Config Service | https://www.aem.live/docs/config-service-setup |
```

## Phase 3: Customize for Project

### 3.1 Fill in Project-Specific Values

Replace all placeholders:
- `{org}` → actual organization from Config Service API
- `{site}` → actual site name(s)
- `{owner}` → code owner from Config Service (GitHub org or Cloud Manager program)
- `{repo}` → code repo from Config Service

### 3.2 Add Multi-Site Details (if repoless)

If project has multiple sites, add a section listing all sites with their:
- Site name
- Preview URL
- Live URL
- Content source

### 3.3 Document Project-Specific Configurations

Check for and document:
- Custom headers (`/config/{org}/sites/{site}/headers.json`)
- CDN configuration
- Any project-specific admin procedures

---

## Phase 4: Convert to Professional PDF

### 4.1 Generate PDF (MANDATORY)

**THIS STEP IS NOT OPTIONAL. YOU MUST GENERATE THE PDF NOW.**

1. Save markdown to: `project-guides/ADMIN-GUIDE.md`
   - File MUST start with YAML frontmatter:
     ```yaml
     ---
     title: "[Project Name] - Admin Guide"
     date: "[Full Date - e.g., February 17, 2026]"
     ---
     ```
   - **Date format**: Always use full date with day, month, and year (e.g., "February 17, 2026"), NOT just month and year

2. **IMMEDIATELY after saving the markdown**, invoke the PDF conversion skill:

   ```
   Skill({ skill: "project-management:whitepaper", args: "project-guides/ADMIN-GUIDE.md project-guides/ADMIN-GUIDE.pdf" })
   ```

3. Wait for PDF generation to complete (whitepaper skill auto-cleans source files)

**DO NOT:**
- Skip the PDF conversion step
- Tell user "PDF will be generated later" — generate it NOW

### 4.2 Deliver to User

After PDF is generated, inform the user:

```
"✓ Admin guide complete: project-guides/ADMIN-GUIDE.pdf"
```

---

## Output

**FINAL OUTPUT:** `project-guides/ADMIN-GUIDE.pdf`

All source files (.md, .html, .plain.html) are deleted after PDF generation. Only the PDF remains.

**Location:** `project-guides/` folder

---

## Success Criteria

**Data Source Validation (CRITICAL):**
- [ ] Config Service API was called (`https://admin.hlx.page/config/{ORG}/sites.json`)
- [ ] Site list came from API response, NOT from fstab.yaml or codebase analysis
- [ ] Code repo info came from site config API, NOT from git remote

**Content Validation:**
- [ ] All org/site values filled from Config Service API
- [ ] Login URL correct
- [ ] All API endpoints have correct org/site
- [ ] Multi-site documented (if applicable)
- [ ] Common tasks listed with correct paths

**Output Validation:**
- [ ] PDF generated successfully
- [ ] All source files cleaned up (only PDF remains)

---

## Tips

1. **Always use Config Service API** - org/site/code repo may differ from what's in the local git remote
2. **Test login URL** - Verify the login URL works before documenting
3. **List all sites** - For repoless setups, document every site
4. **Include examples** - Show actual paths from the project
