---
name: authoring
description: Generate comprehensive documentation for content authors taking over an AEM Edge Delivery Services project. Analyzes the project structure and produces a complete authoring guide with blocks, templates, configurations, and publishing workflows.
license: Apache-2.0
allowed-tools: Read, Write, Edit, Bash, Skill, Glob, Grep
metadata:
  version: "1.0.0"
---

# Project Handover - Authoring

Generate a complete authoring guide for content authors and content managers. This skill analyzes the project and produces actionable documentation.

## When to Use This Skill

- Onboarding content authors to a new project
- Training content managers
- Project handover to client authoring team
- Creating author-focused documentation

---

## Step 0: Navigate to Project Root and Verify Edge Delivery Services Project (CONDITIONAL)

**Skip this step if `allGuides` flag is set** (orchestrator already validated and navigated).

**CRITICAL: If NOT skipped, you MUST execute the `cd` command. Do NOT use absolute paths — actually change directory.**

```bash
ALL_GUIDES=$(cat .claude-plugin/project-config.json 2>/dev/null | grep -o '"allGuides"[[:space:]]*:[[:space:]]*true')
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

## Communication Guidelines

- **NEVER use "EDS"** as an acronym for Edge Delivery Services in any generated documentation or chat responses
- Always use the full name "Edge Delivery Services" or "AEM Edge Delivery Services"
- This applies to all output files (PDF, HTML, markdown) and all communication with the user

---

## ⚠️ CRITICAL PATH REQUIREMENT

**YOU MUST SAVE THE FILE TO THIS EXACT PATH:**

```
project-guides/AUTHOR-GUIDE.md
```

**BEFORE WRITING ANY FILE:**
1. First, create the directory: `mkdir -p project-guides`
2. Then write to: `project-guides/AUTHOR-GUIDE.md`

**WHY THIS MATTERS:** Files must be in `project-guides/` for proper organization and PDF conversion.

❌ **WRONG:** `AUTHOR-GUIDE.md` (root)
❌ **WRONG:** `docs/AUTHOR-GUIDE.md`
❌ **WRONG:** `/workspace/AUTHOR-GUIDE.md`
✅ **CORRECT:** `project-guides/AUTHOR-GUIDE.md`

---

## Output Format

**MANDATORY OUTPUT:** `project-guides/AUTHOR-GUIDE.pdf`

**STRICTLY FORBIDDEN:**
- ❌ Do NOT read or analyze `fstab.yaml` — it does NOT exist in most projects and does NOT show all sites
- ❌ Do NOT create `.plain.html` files
- ❌ Do NOT use `convert_markdown_to_html` tool — this converts the FULL guide to HTML with raw frontmatter visible, which is NOT what we want
- ❌ Do NOT tell user to "convert markdown to PDF manually"
- ❌ Do NOT save markdown to root directory or any path other than `project-guides/`
- ❌ Do NOT say "PDF will be generated later" or "at session end" — generate it NOW

**REQUIRED WORKFLOW:**
1. Run `mkdir -p project-guides` to ensure directory exists
2. Generate markdown content with YAML frontmatter (title, date)
3. Save to `project-guides/AUTHOR-GUIDE.md` (EXACT PATH - no exceptions)
4. **IMMEDIATELY** invoke PDF conversion (see Phase 5.2)
5. Clean up all source files (only PDF remains)
6. Final output: `project-guides/AUTHOR-GUIDE.pdf`

---

## Execution Checklist

```markdown
- [ ] Phase 1: Gather Project Information
- [ ] Phase 2: Analyze Content Structure
- [ ] Phase 3: Document Blocks and Templates
- [ ] Phase 4: Document Configuration Sheets
- [ ] Phase 5: Generate Professional PDF
```

---

## Phase 0: Get Organization Name (Required First)

**Whenever this skill runs** — whether the user triggered it directly (e.g. "generate authoring guide") or via the handover flow — you must have the Config Service organization name before doing anything else. Do not skip this phase.

### 0.1 Check for Saved Organization

```bash
# Check if org name is already saved
cat .claude-plugin/project-config.json 2>/dev/null | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1
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

## Phase 1: Gather Project Information

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
ORG=$(cat .claude-plugin/project-config.json | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

# Save response to file - Phase 2 depends on this file
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
AUTH_TOKEN=$(cat .claude-plugin/project-config.json | grep -o '"authToken"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"authToken"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
curl -s -H "x-auth-token: ${AUTH_TOKEN}" "https://admin.hlx.page/config/${ORG}/sites/{site-name}.json"
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
    },
    "contentBusId": "..."
  }
}
```

**Extract from response:**
- `code.owner` / `code.repo` — GitHub repository
- `content.source.url` — Content mountpath (e.g., `https://content.da.live/org/site/`)
- `content.source.type` — Content source type (markup, onedrive, google)

**Build URLs from content source:**
- **DA URL:** `https://da.live/#/{org}/{site}/` (derived from `content.source.url`)
- **Block Library:** `https://da.live/#/{org}/{site}/.da/library`

**⚠️ Do NOT use `fstab.yaml`** — use Config Service API instead.

### 1.2 Check Multi-Language Support

```bash
# Check for language folders in content structure
ls -la /en /fr /de /es /it 2>/dev/null || echo "Check DA for language folders"
```

**Output:** Record whether project is multi-lingual and which languages are supported.

---

## Phase 2: Analyze Content Structure

**Read site config from Phase 1:**
```bash
cat .claude-plugin/sites-config.json
```

### 2.1 Analyze Navigation and Footer

```bash
ls nav.md footer.md 2>/dev/null || echo "Nav/footer likely in DA"
```

**Document:** Navigation and footer location (DA path or local file), menu structure, mobile behavior.

### 2.2 Identify Page Templates

```bash
ls -la templates/ 2>/dev/null && ls templates/
```

**If templates exist, document each:** Template name, purpose, how to apply (metadata setting).

### 2.3 Section Styles (for guide)

```bash
grep -E "\.section\." styles/styles.css 2>/dev/null | head -15
```

**Document** available section styles (e.g. dark, highlight, narrow) for the "Available Section Styles" table in the guide.

---

## Phase 3: Document Blocks and Templates

### 3.1 List and Analyze Blocks

```bash
ls blocks/
```

**Run block analysis silently.** For each block determine: purpose, variants (e.g. from CSS `.blockname.variant`), and when authors should use it. Document ALL blocks in the project so authors know what's available.

### 3.2 Document Templates

For each template identified in Phase 2.2, document: name, purpose, required metadata fields, and how to apply (`template: name` in Metadata block).

### 3.3 DA and Block Library paths

Get the **content path** from the Config Service site config (content source). Block Library URL is `https://da.live/#/{content-owner}/{content-path}/.da/library` — the path varies by project. Note which blocks/templates appear in the library.

---

## Phase 4: Document Configuration Sheets

### 4.1 Placeholders

**Location:** `/placeholders` in DA (or `/placeholders.xlsx`)

```bash
ls placeholders.json 2>/dev/null
```

**Document:**
| Field | Description |
|-------|-------------|
| Location | Where to find placeholders in DA |
| Languages | Which language sheets exist (en, fr, etc.) |
| Key strings | Important placeholders authors might need to update |

### 4.2 Redirects

**Location:** `/redirects` in DA (or `/redirects.xlsx`)

```bash
ls redirects.json 2>/dev/null
```

**Document:**
| Field | Description |
|-------|-------------|
| Location | Where to find redirects in DA |
| Format | Source column → Destination column |
| When to use | URL changes, deleted pages, renamed pages |

### 4.3 Bulk Metadata

**Location:** `/metadata` in DA (or `/metadata.xlsx`)

```bash
ls metadata.json 2>/dev/null
```

**Document:**
| Field | Description |
|-------|-------------|
| Location | Where to find bulk metadata in DA |
| Patterns | URL patterns used (e.g., `/news/*`) |
| Properties | Which metadata properties are set in bulk |

### 4.4 Other Configuration Sheets

Check for project-specific configuration sheets:

```bash
# Look for other Excel/JSON config files
ls -la *.xlsx *.json 2>/dev/null | grep -v package
```

---

## Phase 5: Generate Author Guide

### 5.1 Output File: `project-guides/AUTHOR-GUIDE.md`

```markdown
# [Project Name] - Author Guide

## Quick Reference

| Resource | URL |
|----------|-----|
| Document Authoring | https://da.live/#/{content-owner}/{content-path}/ |
| Preview (per site) | https://main--{site}--{org}.aem.page/ |
| Live (per site) | https://main--{site}--{org}.aem.live/ |
| Block Library | https://da.live/#/{content-owner}/{content-path}/.da/library |
| Bulk Operations | https://da.live/apps/bulk |

(**Content path** comes from the Config Service site config — e.g. content source like `content.da.live/org/site/` → use `org/site` for the path after `#/`. This can differ per project; do not use code.owner/code.repo unless the API explicitly maps them.)

### Sites

| Site | Content Source (DA) | Preview | Live |
|------|---------------------|---------|------|
| {site1} | [from site config] | https://main--{site1}--{org}.aem.page/ | https://main--{site1}--{org}.aem.live/ |

(One row per site from Config Service. **Content Source (DA)** is the content path for that site — use it to build DA and Block Library URLs: `https://da.live/#/{path-from-content-source}/` and `.../.da/library`. Path format varies by project, e.g. `audemars-piguet/arbres-fondationsaudemarspiguet`.)

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

The **Block Library** is the sidebar in Document Authoring where you browse and insert blocks and templates into your document.

| What | Details |
|------|---------|
| **Open in DA** | Use the Library icon in the DA editor sidebar, or go directly to the Block Library URL (from Config Service content path for this project): `https://da.live/#/{content-owner}/{content-path}/.da/library` |
| **What's in it** | All blocks and templates listed in the "Available Blocks" and "Page Templates" sections below appear in the library |
| **How to use** | Click a block or template in the library to insert it at the cursor position in your document |

When creating or editing a page, use the Library sidebar to add blocks instead of typing block names manually.

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

**Sections** group content together. Create sections with horizontal rules (`---`).

**Add styles** with Section Metadata block at end of section:

| Section Metadata |        |
|------------------|--------|
| style            | [style-name] |

**Available Section Styles:**

| Style | Effect |
|-------|--------|
| [List project-specific styles in table format] |

## Page Metadata

| Property | Required | Purpose | Example |
|----------|----------|---------|---------|
| `title` | Yes | Page title for SEO | "About Us" |
| `description` | Yes | SEO description | "Learn about..." |
| `image` | No | Social sharing image | /images/og.jpg |
| `template` | No | Apply page template | project-article |
| [Add project-specific fields] |

## Images and Media

| Method | How |
|--------|-----|
| Drag & drop | Drag images directly into DA editor |
| AEM Assets | Use Assets sidebar in DA |

**Best Practices:** Descriptive filenames, always add alt text, images auto-optimized

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Page not updating after publish | Wait 1-2 min for cache, hard refresh (Cmd+Shift+R) |
| Block not displaying correctly | Check structure matches expected format, verify variant spelling |
| Images not showing | Verify image uploaded to DA, check path is correct |
| Wrong template styling | Check `template` value in Metadata, ensure it matches template name exactly |

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

### 5.2 Convert to Professional PDF (MANDATORY)

**THIS STEP IS NOT OPTIONAL. YOU MUST GENERATE THE PDF NOW.**

1. Save markdown to: `project-guides/AUTHOR-GUIDE.md`
   - File MUST start with YAML frontmatter:
     ```yaml
     ---
     title: "[Project Name] - Author Guide"
     date: "[Full Date - e.g., February 17, 2026]"
     ---
     ```
   - **Date format**: Always use full date with day, month, and year (e.g., "February 17, 2026"), NOT just month and year

2. **IMMEDIATELY after saving the markdown**, invoke the PDF conversion skill:

   ```
   Skill({ skill: "project-management:whitepaper", args: "project-guides/AUTHOR-GUIDE.md project-guides/AUTHOR-GUIDE.pdf" })
   ```

3. Wait for PDF generation to complete (whitepaper skill auto-cleans source files)

**DO NOT:**
- Skip the PDF conversion step
- Tell user "PDF will be generated later" — generate it NOW

### 5.3 Deliver to User

After PDF is generated, inform the user:

```
"✓ Author guide complete: project-guides/AUTHOR-GUIDE.pdf"
```

---

## Output

**FINAL OUTPUT:** `project-guides/AUTHOR-GUIDE.pdf`

All source files (.md, .html, .plain.html) are deleted after PDF generation. Only the PDF remains.

**Location:** `project-guides/` folder

---

## Success Criteria

**Data Source Validation (CRITICAL):**
- [ ] Config Service API was called (`https://admin.hlx.page/config/{ORG}/sites.json`)
- [ ] Site list came from API response, NOT from fstab.yaml or codebase analysis
- [ ] DA/Block Library URLs derived from Config Service content source, NOT assumed from code.owner/repo

**Content Validation:**
- [ ] Quick Reference table with all project URLs
- [ ] All blocks documented in table format
- [ ] All templates documented with required metadata
- [ ] Configuration sheets documented
- [ ] Publishing workflow explained
- [ ] Common tasks documented
- [ ] Section/page metadata options listed
- [ ] Troubleshooting included

**Output Validation:**
- [ ] PDF generated successfully
- [ ] All source files cleaned up (only PDF remains)

---

## Tips for Clear Documentation

1. **Use tables** for compact reference information
2. **Keep language simple** - avoid technical jargon
3. **Use examples** from actual project content
4. **Test procedures** before documenting them
