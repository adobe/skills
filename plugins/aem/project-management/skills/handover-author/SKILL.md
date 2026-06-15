---
name: handover-author
description: Generate comprehensive documentation for content authors taking over an AEM Edge Delivery Services project. Use when onboarding content authors, training content managers, or creating author-focused handover documentation — analyzes project structure and produces a complete authoring guide with blocks, templates, configurations, and publishing workflows.
license: Apache-2.0
allowed-tools: Read, Write, Edit, Bash, Skill, Glob, Grep
metadata:
  version: "1.0.0"
---

# Project Handover - Authoring

Generate a complete authoring guide for content authors and content managers. Analyzes the project and produces actionable documentation.

---

## Step 0: Navigate to Project Root (CONDITIONAL)

Skip if `allGuides` is set in `.claude-plugin/project-config.json` (orchestrator already validated).

```bash
ALL_GUIDES=$(cat .claude-plugin/project-config.json 2>/dev/null | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try { console.log(JSON.parse(d).allGuides ? 'true' : ''); } catch(e) { console.log(''); }
")
if [ -z "$ALL_GUIDES" ]; then
  cd "$(git rev-parse --show-toplevel)"
  ls scripts/aem.js
fi
```

If `scripts/aem.js` does not exist, tell the user this skill requires an AEM Edge Delivery Services project and stop.

All subsequent steps operate from project root. Guides are created at `project-guides/`.

---

## Execution Checklist

```markdown
- [ ] Phase 0: Get org name and authenticate
- [ ] Phase 1: Gather project information from Config Service API
- [ ] Phase 2: Analyze content structure
- [ ] Phase 3: Document blocks and templates
- [ ] Phase 4: Document configuration sheets
- [ ] Phase 5: Generate PDF
```

---

## Phase 0: Get Organization Name and Authenticate

### 0.1 Check for Saved Organization

```bash
cat .claude-plugin/project-config.json 2>/dev/null | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  try { const o = JSON.parse(d).org; if(o) console.log('org: ' + o); } catch(e) {}
"
```

### 0.2 Prompt for Organization Name (If Not Saved)

If no org name is found, ask the user:

> "What is your Config Service organization name? This is the `{org}` part of your Edge Delivery Services URLs (e.g., `https://main--site--{org}.aem.page`). The org name may differ from your GitHub organization."

Ask as a plain text question — not `AskUserQuestion` with options. Organization name is mandatory.

### 0.3 Save Organization Name

```bash
mkdir -p .claude-plugin
grep -qxF '.claude-plugin/' .gitignore 2>/dev/null || echo '.claude-plugin/' >> .gitignore

if [ -f .claude-plugin/project-config.json ]; then
  cat .claude-plugin/project-config.json | sed 's/"org"[[:space:]]*:[[:space:]]*"[^"]*"/"org": "{ORG_NAME}"/' > /tmp/project-config.json && mv /tmp/project-config.json .claude-plugin/project-config.json
else
  echo '{"org": "{ORG_NAME}"}' > .claude-plugin/project-config.json
fi
```

Replace `{ORG_NAME}` with the actual organization name.

### 0.4 Check Auth Token

```bash
AUTH_TOKEN=$(node -e "
  const fs = require('fs');
  try {
    const t = JSON.parse(fs.readFileSync(process.env.HOME + '/.aem/ims-token.json', 'utf8'));
    if (t.authToken && t.authTokenExpiry > Math.floor(Date.now()/1000) + 60) {
      process.stdout.write(t.authToken);
    }
  } catch (e) {}
")

if [ -z "$AUTH_TOKEN" ]; then
  echo "AUTH_REQUIRED"
fi
```

If `AUTH_REQUIRED`, invoke the auth skill before proceeding:

```
Skill({ skill: "aem-project-management:auth" })
```

---

## Phase 1: Gather Project Information

### 1.1 Fetch Sites via Config Service API

The Config Service API is the only reliable source for site information. Do not use `fstab.yaml`, README, or git remote URLs.

```bash
ORG=$(cat .claude-plugin/project-config.json | node -e "
  const d = require('fs').readFileSync(0,'utf8');
  console.log(JSON.parse(d).org || '');
")
AUTH_TOKEN=$(node -e "
  const fs = require('fs');
  try {
    const t = JSON.parse(fs.readFileSync(process.env.HOME + '/.aem/ims-token.json', 'utf8'));
    process.stdout.write(t.authToken || '');
  } catch (e) {}
")

curl -s -H "x-auth-token: ${AUTH_TOKEN}" -H "Accept: application/json" \
  "https://admin.hlx.page/config/${ORG}/sites.json" > .claude-plugin/sites-config.json

node -e "
  const d = require('fs').readFileSync('.claude-plugin/sites-config.json', 'utf8');
  const j = JSON.parse(d);
  if (!j.sites || !j.sites.length) {
    console.error('No sites returned — verify org name and re-authenticate if needed');
    process.exit(1);
  }
  console.log('Found ' + j.sites.length + ' site(s): ' + j.sites.map(s => s.name).join(', '));
"
```

If validation fails, verify the org name is correct, re-authenticate, and retry.

Fetch per-site config for content details:

```bash
curl -s -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/{site-name}.json"
```

Extract:
- `code.owner` / `code.repo` — GitHub repository
- `content.source.url` — Content mountpath (e.g., `https://content.da.live/org/site/`)
- `content.source.type` — Content source type (markup, onedrive, google)

Build DA and Block Library URLs from content source:
- DA URL: `https://da.live/#/{org}/{site}/`
- Block Library: `https://da.live/#/{org}/{site}/.da/library`

Multiple sites = repoless setup. Single site = standard setup.

### 1.2 Check Multi-Language Support

```bash
ls -la /en /fr /de /es /it 2>/dev/null || echo "Check DA for language folders"
```

Record whether the project is multi-lingual and which languages are supported.

---

## Phase 2: Analyze Content Structure

Read site config from Phase 1:

```bash
cat .claude-plugin/sites-config.json
```

### 2.1 Analyze Navigation and Footer

```bash
ls nav.md footer.md 2>/dev/null || echo "Nav/footer likely in DA"
```

Document: Navigation and footer location (DA path or local file), menu structure, mobile behavior.

### 2.2 Identify Page Templates

```bash
ls -la templates/ 2>/dev/null && ls templates/
```

For each template, document: name, purpose, how to apply (metadata setting).

### 2.3 Section Styles

```bash
grep -E "\.section\." styles/styles.css 2>/dev/null | head -15
```

Document available section styles (e.g., dark, highlight, narrow) for the guide's "Available Section Styles" table.

---

## Phase 3: Document Blocks and Templates

### 3.1 List and Analyze Blocks

```bash
ls blocks/
```

Run block analysis silently. For each block determine: purpose, variants (from CSS `.blockname.variant`), and when authors should use it. Document all blocks so authors know what's available.

### 3.2 Document Templates

For each template found in Phase 2.2, document: name, purpose, required metadata fields, and how to apply (`template: name` in Metadata block).

### 3.3 DA and Block Library Paths

Get the content path from the Config Service site config. Block Library URL is `https://da.live/#/{content-owner}/{content-path}/.da/library` — the path varies by project.

---

## Phase 4: Document Configuration Sheets

### 4.1 Placeholders

```bash
ls placeholders.json 2>/dev/null
```

Document: location in DA, language sheets, key strings authors might need to update.

### 4.2 Redirects

```bash
ls redirects.json 2>/dev/null
```

Document: location in DA, format (source → destination columns), when to use.

### 4.3 Bulk Metadata

```bash
ls metadata.json 2>/dev/null
```

Document: location in DA, URL patterns, which metadata properties are set in bulk.

### 4.4 Other Configuration Sheets

```bash
ls -la *.xlsx *.json 2>/dev/null | grep -v package
```

---

## Phase 5: Generate Author Guide

### 5.1 Output File

Save to `project-guides/AUTHOR-GUIDE.md` (run `mkdir -p project-guides` first).

```markdown
---
title: "[Project Name] - Author Guide"
date: "[Full Date — e.g., February 17, 2026]"
---

# [Project Name] - Author Guide

## Quick Reference

| Resource | URL |
|----------|-----|
| Document Authoring | https://da.live/#/{content-owner}/{content-path}/ |
| Preview (per site) | https://main--{site}--{org}.aem.page/ |
| Live (per site) | https://main--{site}--{org}.aem.live/ |
| Block Library | https://da.live/#/{content-owner}/{content-path}/.da/library |
| Bulk Operations | https://da.live/apps/bulk |

(**Content path** comes from the Config Service site config — e.g., `content.da.live/org/site/` → use `org/site` for the path after `#/`. This varies by project.)

### Sites

| Site | Content Source (DA) | Preview | Live |
|------|---------------------|---------|------|
| {site1} | [from site config] | https://main--{site1}--{org}.aem.page/ | https://main--{site1}--{org}.aem.live/ |

## Getting Started

### Access Requirements
- [ ] DA access (request from admin)
- [ ] Preview/publish permissions

### Your First Page
1. Go to DA: [link]
2. Navigate to the correct folder
3. Create new document
4. Use blocks from Library sidebar
5. Add Metadata block at bottom
6. Preview → Publish

## Content Organization

### Site Structure
[Describe the folder structure in DA]

### Languages
[List supported languages if multi-lingual]

## Block Library

The Block Library is the sidebar in Document Authoring where you browse and insert blocks and templates.

| What | Details |
|------|---------|
| **Open in DA** | Use the Library icon in the DA editor sidebar, or go directly to: `https://da.live/#/{content-owner}/{content-path}/.da/library` |
| **How to use** | Click a block or template in the library to insert it at the cursor position |

## Available Blocks

| Block | Purpose | Variants | Usage |
|-------|---------|----------|-------|
| [name] | [what it's for] | [variant1, variant2] | [when to use] |

[Generate table rows for all blocks]

## Page Templates

| Template | Purpose | Required Metadata | How to Apply |
|----------|---------|-------------------|--------------|
| [name] | [what type of pages] | [key fields] | `template: [name]` in Metadata |

[Generate table rows for all templates]

## Configuration Sheets

| Sheet | Location | Purpose | When to Update |
|-------|----------|---------|----------------|
| Placeholders | `/placeholders` | Reusable text strings, translations | Changing labels, button text |
| Redirects | `/redirects` | Forward old URLs to new URLs | After deleting/moving pages |
| Bulk Metadata | `/metadata` | Apply metadata to multiple pages | Setting defaults by folder |

## Publishing Workflow

| Environment | Domain | Purpose |
|-------------|--------|---------|
| Preview | `.aem.page` | Test changes before going live |
| Live | `.aem.live` | Production site |

**Workflow:** Edit in DA → Preview → Publish → Live immediately

**Bulk:** https://da.live/apps/bulk

## Common Tasks

| Task | Steps |
|------|-------|
| **Create a Page** | Navigate to folder → New → Document → Add content → Add Metadata → Preview → Publish |
| **Edit a Page** | Open in DA → Make changes → Preview → Publish |
| **Delete a Page** | Add redirect first → Delete document → Publish redirects |
| **Update Navigation** | Edit `/nav` document → Preview → Publish |
| **Update Footer** | Edit `/footer` document → Preview → Publish |

## Sections and Section Metadata

Sections group content together. Create sections with horizontal rules (`---`).

Add styles with a Section Metadata block at the end of the section:

| Section Metadata | |
|------------------|-|
| style | [style-name] |

**Available Section Styles:**

| Style | Effect |
|-------|--------|
| [List project-specific styles] | |

## Page Metadata

| Property | Required | Purpose | Example |
|----------|----------|---------|---------|
| `title` | Yes | Page title for SEO | "About Us" |
| `description` | Yes | SEO description | "Learn about..." |
| `image` | No | Social sharing image | /images/og.jpg |
| `template` | No | Apply page template | project-article |
| [Add project-specific fields] | | | |

## Images and Media

| Method | How |
|--------|-----|
| Drag & drop | Drag images directly into DA editor |
| AEM Assets | Use Assets sidebar in DA |

Best practices: descriptive filenames, always add alt text, images auto-optimized.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Page not updating after publish | Wait 1-2 min for cache, hard refresh (Cmd+Shift+R) |
| Block not displaying correctly | Check structure matches expected format, verify variant spelling |
| Images not showing | Verify image uploaded to DA, check path is correct |
| Wrong template styling | Check `template` value in Metadata matches template name exactly |

## Resources

| Resource | URL |
|----------|-----|
| DA Documentation | https://docs.da.live/ |
| Authoring Guide | https://www.aem.live/docs/authoring |
| Placeholders Docs | https://www.aem.live/docs/placeholders |
| Redirects Docs | https://www.aem.live/docs/redirects |

## Support Contacts

[Add project-specific contacts]
```

### 5.2 Convert to Professional PDF

Save the completed markdown to `project-guides/AUTHOR-GUIDE.md` with YAML frontmatter (title, date using full date format e.g., "February 17, 2026"). Then immediately invoke PDF conversion:

```
Skill({ skill: "aem-project-management:whitepaper", args: "project-guides/AUTHOR-GUIDE.md project-guides/AUTHOR-GUIDE.pdf" })
```

The whitepaper skill auto-cleans source files. Final output: `project-guides/AUTHOR-GUIDE.pdf`.

Inform the user: "Author guide complete: project-guides/AUTHOR-GUIDE.pdf"

---

## Success Criteria

| Category | Check |
|----------|-------|
| **Data Source** | Config Service API called (`https://admin.hlx.page/config/{ORG}/sites.json`) |
| **Data Source** | Site list from API response, not fstab.yaml or codebase analysis |
| **Data Source** | DA/Block Library URLs derived from Config Service content source, not assumed from code.owner/repo |
| **Content** | Quick Reference table with all project URLs |
| **Content** | All blocks documented in table format |
| **Content** | All templates documented with required metadata |
| **Content** | Configuration sheets documented |
| **Content** | Publishing workflow explained |
| **Content** | Common tasks documented |
| **Content** | Section/page metadata options listed |
| **Content** | Troubleshooting included |
| **Output** | PDF generated at `project-guides/AUTHOR-GUIDE.pdf` |
| **Output** | All source files cleaned up (only PDF remains) |

---

**Communication:** Never use "EDS" as an acronym — always write "Edge Delivery Services" or "AEM Edge Delivery Services" in all output and documentation.
