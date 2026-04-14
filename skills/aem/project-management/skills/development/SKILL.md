---
name: development
description: Generate comprehensive technical documentation for developers taking over an AEM Edge Delivery Services project. Analyzes codebase structure, custom implementations, design tokens, and produces a complete developer guide.
license: Apache-2.0
allowed-tools: Read, Write, Edit, Bash, Skill, Glob, Grep
metadata:
  version: "1.0.0"
---

# Project Handover - Development

Generate a complete technical guide for developers. This skill analyzes the codebase and produces actionable documentation that enables developers to understand, maintain, and extend the project.

## When to Use This Skill

- Onboarding new developers to a project
- Technical handover to maintenance team
- Code review and architecture documentation
- Creating developer-focused documentation

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
project-guides/DEVELOPER-GUIDE.md
```

**BEFORE WRITING ANY FILE:**
1. First, create the directory: `mkdir -p project-guides`
2. Then write to: `project-guides/DEVELOPER-GUIDE.md`

**WHY THIS MATTERS:** Files must be in `project-guides/` for proper organization and PDF conversion.

❌ **WRONG:** `DEVELOPER-GUIDE.md` (root)
❌ **WRONG:** `docs/DEVELOPER-GUIDE.md`
❌ **WRONG:** `/workspace/DEVELOPER-GUIDE.md`
✅ **CORRECT:** `project-guides/DEVELOPER-GUIDE.md`

---

## Output Format

**MANDATORY OUTPUT:** `project-guides/DEVELOPER-GUIDE.pdf`

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
3. Save to `project-guides/DEVELOPER-GUIDE.md` (EXACT PATH - no exceptions)
4. **IMMEDIATELY** invoke PDF conversion (see Phase 5.1)
5. Clean up all source files (only PDF remains)
6. Final output: `project-guides/DEVELOPER-GUIDE.pdf`

---

## Execution Checklist

```markdown
- [ ] Phase 1: Gather Project Information
- [ ] Phase 2: Analyze Project Architecture
- [ ] Phase 3: Document Design System
- [ ] Phase 4: Document Blocks, Models, and Templates
- [ ] Phase 5: Generate Professional PDF
```

---

## Phase 0: Get Organization Name (Required First)

**Whenever this skill runs** — whether the user triggered it directly (e.g. "generate developer guide") or via the handover flow — you must have the Config Service organization name before doing anything else. Do not skip this phase.

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

### 1.1 Get Project URLs and Repository

```bash
# Get repository info
git remote -v | head -1

# Get branch info
git branch -a | head -10
```

**Extract:**
- Repository owner and name
- Main branch name

### 1.2 Check Configuration Method

```bash
# Check for helix-config (very old projects)
ls helix-config.yaml 2>/dev/null && echo "Uses legacy helix-config" || echo "Uses Config Service (modern)"
```

**Document:** Project configuration method (Config Service for modern projects).

### 1.3 Fetch Sites via Config Service API

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
    }
  }
}
```

**Extract from response:**
- `code.owner` / `code.repo` — GitHub repository
- `content.source.url` — Content mountpath (e.g., `https://content.da.live/org/site/`)
- `content.source.type` — Content source type (markup, onedrive, google)

**⚠️ Do NOT use `fstab.yaml`** — use Config Service API instead.

**Record the result** (repoless or standard) — it is used in the Local Development Setup section to decide whether to include the `--pages-url` flag for `aem up`.

### 1.4 Check Node.js Requirements

```bash
# Check for Node version requirements
cat .nvmrc 2>/dev/null || cat package.json | grep -A2 '"engines"'
```

---

## Phase 2: Analyze Project Architecture

**Read site config from Phase 1:**
```bash
cat .claude-plugin/sites-config.json
```

### 2.1 Map Project Structure

```bash
# List top-level structure
ls -la

# List blocks
ls -la blocks/

# List scripts
ls -la scripts/

# List styles
ls -la styles/

# Check for templates
ls -la templates/ 2>/dev/null || echo "No templates folder"
```

### 2.2 Identify Boilerplate vs Custom Files

**CRITICAL:** Only document files that were actually customized.

```bash
# Check commit history for a file (skip if only "Initial commit")
git log --oneline --follow {file_path} | head -5

# Check who modified a file (skip aem-aemy[bot] only files)
git log --format="%an - %s" --follow {file_path} | head -5
```

**Rules for filtering:**

| Git History | Action |
|-------------|--------|
| Only "Initial commit" | Skip - boilerplate default, never worked on |
| Only `aem-aemy[bot]` commits | Skip - auto-generated |
| Multiple commits by team | Document - customized |
| Commits with feature descriptions | Document - customized |

**IMPORTANT:** Files with only an "initial commit" are boilerplate defaults that were never modified. Do not document these - they add no value to the developer guide.

### 2.3 Analyze scripts/aem.js (Core Library)

```bash
# List what aem.js exports (DO NOT MODIFY this file)
grep -E "^export" scripts/aem.js
```

**Document which functions the project imports from `aem.js`** (e.g., `sampleRUM`, `loadHeader`, `loadFooter`, `decorateBlock`, `loadBlock`, `loadCSS`). This helps developers understand which core utilities are available.

### 2.4 Analyze scripts/scripts.js (Eager + Lazy Phases)

```bash
# Extract imports and key function signatures
grep -E "^import|^export|^function|^async function|buildAutoBlocks|loadTemplate|getLanguage|getSiteRoot|decorateMain|loadEager|loadLazy|loadDelayed" scripts/scripts.js
```

**Document these customizations:**

| Pattern to Look For | What to Document |
|---------------------|------------------|
| `import` statements | What it imports from `aem.js` and `utils.js` |
| `loadEager` / `loadLazy` functions | Any custom logic added to E-L-D phases |
| `buildAutoBlocks` function | Auto-blocking logic |
| `loadTemplate` or template handling | Template system |
| `getLanguage` or language detection | Multi-language setup |
| `getSiteRoot` or site detection | Multi-site configuration (see also Phase 1.3) |
| Custom `decorateMain` additions | Page decoration extensions |
| External script loading | Which phase loads it — flag if loaded in eager (performance risk) |

**E-L-D check:** Note any third-party scripts or heavy logic added to `loadEager` or `loadLazy` that could impact LCP. These should typically be in `delayed.js`.

### 2.5 Analyze scripts/delayed.js (Delayed Phase)

```bash
# Extract imports and function calls to identify integrations
grep -E "^import|function|google|analytics|gtag|alloy|martech|OneTrust|launch|chatbot|widget" scripts/delayed.js
```

**Document:**
- Analytics integrations (Google Analytics, Adobe Analytics, etc.)
- Marketing tools (OneTrust, chat widgets, etc.)
- Performance monitoring
- Any custom delayed features
- Confirm no render-critical code is in this file (it loads ~3s after page load)

### 2.6 Check for Utility Functions

```bash
# Extract exported functions from utils
grep -E "^export|^function" scripts/utils.js 2>/dev/null || echo "No utils.js"

# List all script files
ls scripts/*.js

# Check which blocks/scripts import from utils
grep -rl "utils.js" blocks/ scripts/ 2>/dev/null
```

**Document:** Shared utility functions, their purposes, and which blocks/scripts import them.

### 2.7 Check for External Dependencies

```bash
# Check package.json for dependencies
grep -A 20 '"dependencies"' package.json 2>/dev/null | head -25

# Check for CDN imports in code
grep -r "cdn\|unpkg\|jsdelivr" scripts/ blocks/ --include="*.js" 2>/dev/null
```

---

## Phase 3: Document Design System

### 4.1 Extract CSS Custom Properties

```bash
# Get all CSS variables from styles.css
grep -E "^\s*--" styles/styles.css
```

**Organize into categories:**

| Category | Example Properties |
|----------|-------------------|
| Typography | `--body-font-family`, `--heading-font-family`, `--font-size-*` |
| Colors | `--primary-color`, `--background-color`, `--text-color` |
| Spacing | `--spacing-*`, `--nav-height`, `--section-padding` |
| Layout | `--content-width`, `--grid-gap` |

### 4.2 Document Font Setup

```bash
# Extract font-face declarations (font names, weights, formats)
grep -E "@font-face|font-family|font-weight|src:" styles/fonts.css 2>/dev/null

# Check fonts directory
ls fonts/ 2>/dev/null
```

**Document:**
- Font files and formats
- Font family names
- Font weights available
- Fallback fonts

### 4.3 Document Breakpoints

```bash
# Find media query breakpoints
grep -E "@media.*min-width|@media.*max-width" styles/styles.css | sort -u
```

**Standard EDS breakpoints:**
- Mobile: < 600px
- Tablet: 600px - 899px
- Desktop: 900px+
- Large: 1200px+

Document any deviations from standard.

### 4.4 Document Section Styles

```bash
# Find section-related styles
grep -A 5 "\.section\." styles/styles.css
grep -A 5 "\.section\[" styles/styles.css
```

**Document available section styles** (dark, highlight, narrow, etc.)

---

## Phase 4: Document Blocks, Models, and Templates

### Boilerplate Filtering (applies to blocks, models, and templates)

**Run all filtering silently** — do not show output to the user.

- **Include**: Items with 2+ commits AND at least one commit after "initial commit"
- **Exclude**: Items with only 1 commit that is "Initial commit" or similar boilerplate setup
- **Exclude**: Items with only `aem-aemy[bot]` commits (auto-generated)
- Items that only have an "initial commit" were never customized — do NOT document them.

### 4.1 Identify and Analyze Customized Blocks

**For each block that passed the filter**, run:

```bash
# Get block purpose from JS comments/structure
head -30 blocks/{blockname}/{blockname}.js

# Get block variants from CSS
grep -E "^\." blocks/{blockname}/{blockname}.css | head -30

# Check for variant handling
grep -E "classList\.contains|classList\.add" blocks/{blockname}/{blockname}.js
```

**Document for each customized block:**

| Field | What to Record |
|-------|----------------|
| Name | Block folder name |
| Purpose | What it does (from code analysis) |
| DOM Input | Expected HTML structure from CMS |
| DOM Output | Transformed structure after decoration |
| Variants | CSS classes that modify behavior |
| Dependencies | External libraries, other blocks, utils |
| Key Functions | Important internal functions |

### 4.2 Document Block Dependencies

```bash
grep "^import" blocks/{blockname}/{blockname}.js
```

### 4.3 Document Universal Editor Models (If Customized)

Apply the same boilerplate filtering to `models/*.json`. Also exclude standard boilerplate models (`_page.json`, `_section.json`, `_button.json`, `_image.json`, `_text.json`, `_title.json`) if unchanged. If all models are boilerplate, skip this section in the output.

### 4.4 Document Customized Templates

Apply the same boilerplate filtering to `templates/*/`. For each customized template, document its purpose, how it's applied (`template: name` in metadata), and what it changes.

---

## Phase 5: Generate Developer Guide

### Output File: `project-guides/DEVELOPER-GUIDE.md`

Generate a markdown document with the following structure:

```markdown
# [Project Name] - Developer Guide

## Quick Reference

| Resource | URL |
|----------|-----|
| Code Repository | {code.owner}/{code.repo} (from Config Service — may be GitHub or Cloud Manager) |
| Preview | https://main--{repo}--{owner}.aem.page/ |
| Live | https://main--{repo}--{owner}.aem.live/ |
| Local Dev | http://localhost:3000 |

## Architecture Overview

### Tech Stack
- Vanilla JavaScript (ES6+)
- CSS3 with Custom Properties
- No build step - files served directly
- Content from Document Authoring (DA)

### Project Structure
```
├── blocks/           # [X] blocks implemented
├── templates/        # [Y] templates (or N/A)
├── scripts/
│   ├── aem.js        # Core library (DO NOT MODIFY)
│   ├── scripts.js    # Custom page decoration
│   ├── delayed.js    # Analytics, marketing tools
│   └── utils.js      # Shared utilities
├── styles/
│   ├── styles.css    # Critical styles + design tokens
│   ├── fonts.css     # Font definitions
│   └── lazy-styles.css # Non-critical styles
└── icons/            # SVG icons
```

### Three-Phase Loading (E-L-D)

Edge Delivery Services uses a strict Eager-Lazy-Delayed loading strategy to achieve a Lighthouse score of 100. Every file and script must be placed in the correct phase.

| Phase | Purpose | What Loads | Performance Impact |
|-------|---------|------------|-------------------|
| **Eager** | Render above-the-fold content as fast as possible (LCP) | `styles/styles.css`, first section's blocks, `scripts/scripts.js` | Blocks LCP — keep minimal |
| **Lazy** | Load remaining page content after first paint | Remaining blocks, header, footer, `fonts.css`, `lazy-styles.css` | Runs after Eager completes — safe for non-critical UI |
| **Delayed** | Load non-essential third-party scripts | `scripts/delayed.js` (analytics, marketing tags, chat widgets) | Runs ~3s after page load — never blocks rendering |

**Rules for developers:**
- **Never add third-party scripts to `scripts.js`** — they block LCP. Always use `delayed.js`.
- **Never load fonts eagerly** — `fonts.css` is loaded lazily to avoid render-blocking.
- Blocks in the first section load eagerly; all others load lazily. This is automatic based on DOM position.
- The header and footer are loaded in the lazy phase via `loadHeader()` / `loadFooter()` from `aem.js`.

### Key Files & How They Connect

| File | Role | Connects To |
|------|------|-------------|
| `scripts/aem.js` | Core library — `loadBlock`, `loadCSS`, `decorateBlock`, `sampleRUM`, `loadHeader`/`loadFooter`. **DO NOT MODIFY.** | Imported by `scripts.js` and blocks |
| `scripts/scripts.js` | Entry point — orchestrates E-L-D phases (`loadEager` → `loadLazy` → `loadDelayed`). Contains `buildAutoBlocks`, `decorateMain`, template loading. | Imports from `aem.js`; may import `utils.js` |
| `scripts/delayed.js` | Loaded last via `loadDelayed()` — analytics, marketing tags, third-party scripts. | Called by `scripts.js` in delayed phase |
| `scripts/utils.js` | Shared helpers used across blocks and scripts. | Imported by blocks and `scripts.js` |
| `styles/styles.css` | Critical CSS + design tokens (CSS custom properties). Loaded eagerly. | Referenced by all blocks and pages |
| `styles/fonts.css` | Font `@font-face` declarations. Loaded lazily. | Font families referenced in `styles.css` |
| `styles/lazy-styles.css` | Non-critical global styles. Loaded lazily. | Supplements `styles.css` |
| `blocks/{name}/{name}.js` | Block logic — exports `default function decorate(block)`. Auto-loaded when the block class appears in DOM. | May import from `utils.js` or `aem.js` |
| `blocks/{name}/{name}.css` | Block styles — auto-loaded alongside block JS. | May use CSS custom properties from `styles.css` |
| `templates/{name}/{name}.js` | Template logic — loaded when page metadata has matching `template` value. Customizes page structure before blocks load. | Called by `scripts.js` via `loadTemplate()` |

**Execution flow:** page load → `scripts.js` → `loadEager()` (first section + eager blocks) → `loadLazy()` (remaining blocks, header, footer, `fonts.css`, `lazy-styles.css`) → `loadDelayed()` (loads `delayed.js`)

## Local Development Setup

### Prerequisites
- Node.js [version from .nvmrc]
- AEM CLI: `npm install -g @adobe/aem-cli`

### Setup Steps
```bash
# Clone repository (use the code repo URL from Config Service)
git clone {code-repo-url}
cd {repo}

# Install dependencies
npm install

# Start local server
aem up
```

### Local Server
- URL: http://localhost:3000
- Auto-reload on file changes
- Uses preview content by default

**If repoless/multi-site was detected in Phase 1.3**, also include this subsection in the output:

> ### Local Server — Repoless/Multi-Site
> For repoless setups with multiple sites sharing one repository, you must specify the site's preview URL when starting the local server:
>
> ```bash
> aem up --pages-url=https://main--{site}--{org}.aem.page
> ```
>
> Replace `{site}` and `{org}` with the actual site and organization names from the Config Service.
>
> Without `--pages-url`, the AEM CLI cannot resolve content for the correct site and local preview will fail or show wrong content.

**If the project is a standard single-site setup**, omit the repoless subsection entirely — it would only confuse developers.

### Linting
```bash
npm run lint
```

## Design System

### CSS Custom Properties

#### Typography
```css
--body-font-family: [value];
--heading-font-family: [value];
```

#### Colors
```css
--primary-color: [value];
--secondary-color: [value];
--background-color: [value];
--text-color: [value];
```

#### Spacing
```css
--spacing-s: [value];
--spacing-m: [value];
--spacing-l: [value];
--nav-height: [value];
```

### Breakpoints
| Name | Min-Width | Usage |
|------|-----------|-------|
| Mobile | 0 | Default styles |
| Tablet | 600px | `@media (min-width: 600px)` |
| Desktop | 900px | `@media (min-width: 900px)` |
| Large | 1200px | `@media (min-width: 1200px)` |

### Fonts
| Family | Weights | Usage |
|--------|---------|-------|
| [Font Name] | [weights] | [body/headings] |

## Blocks Reference

| Block | Purpose | Variants | Key Features |
|-------|---------|----------|--------------|
| [block-name] | [What it does] | `variant1`, `variant2` | [Important details, gotchas] |

[Generate one row per customized block]

## Templates

| Template | Purpose | Applied Via | Special Behavior |
|----------|---------|-------------|------------------|
| [template-name] | [What type of pages] | `template: [name]` | [What it does differently] |

[Generate one row per customized template. Skip templates with only "initial commit".]

## Common Development Tasks

### Add a New Block
1. Create `blocks/{name}/{name}.js`
2. Create `blocks/{name}/{name}.css`
3. Implement `export default function decorate(block)`
4. Test locally at http://localhost:3000
5. Push to feature branch

### Modify Global Styles
1. Edit `styles/styles.css`
2. Use CSS custom properties
3. Test across multiple pages
4. Watch for CLS impact

### Add Analytics/Marketing Tool
1. Add to `scripts/delayed.js`
2. Never add to `scripts.js` (blocks performance)
3. Test with Network tab to verify delayed loading

### Debug a Block
1. Check browser console for errors
2. Inspect DOM: expected structure vs actual
3. Check if variant classes are applied
4. Verify CSS specificity

## Environments

| Environment | URL Pattern | Purpose |
|-------------|-------------|---------|
| Local | http://localhost:3000 | Development |
| Feature Branch | https://{branch}--{repo}--{owner}.aem.page | PR testing |
| Preview | https://main--{repo}--{owner}.aem.page | Staging |
| Live | https://main--{repo}--{owner}.aem.live | Production |

## Git Workflow

### Branch Naming
- Features: `feature/description`
- Fixes: `fix/description`
- Keep names short (URL length limits)

### PR Requirements
1. Include preview URL in PR description
2. Pass linting
3. Test on feature branch preview
4. No console errors

## Troubleshooting

### Block not loading?
1. Check block folder name matches class name
2. Verify JS exports `default function decorate`
3. Check browser Network tab for 404s

### Styles not applying?
1. Check CSS specificity
2. Verify file is loading (Network tab)
3. Check for CSS syntax errors

### Content not updating?
1. Clear browser cache
2. Check preview was triggered in DA
3. Wait for CDN cache (1-2 min)

## Resources

| Resource | URL |
|----------|-----|
| EDS Documentation | https://www.aem.live/docs/ |
| Developer Tutorial | https://www.aem.live/developer/tutorial |
| Block Collection | https://www.aem.live/developer/block-collection |
| E-L-D Loading | https://www.aem.live/developer/keeping-it-100 |
| Best Practices | https://www.aem.live/docs/dev-collab-and-good-practices |

## Support Contacts

[Add project-specific contacts]
```

---

### 5.1 Convert to Professional PDF (MANDATORY)

**THIS STEP IS NOT OPTIONAL. YOU MUST GENERATE THE PDF NOW.**

1. Save markdown to: `project-guides/DEVELOPER-GUIDE.md`
   - File MUST start with YAML frontmatter:
     ```yaml
     ---
     title: "[Project Name] - Developer Guide"
     date: "[Full Date - e.g., February 17, 2026]"
     ---
     ```
   - **Date format**: Always use full date with day, month, and year (e.g., "February 17, 2026"), NOT just month and year

2. **IMMEDIATELY after saving the markdown**, invoke the PDF conversion skill:

   ```
   Skill({ skill: "project-management:whitepaper", args: "project-guides/DEVELOPER-GUIDE.md project-guides/DEVELOPER-GUIDE.pdf" })
   ```

3. Wait for PDF generation to complete (whitepaper skill auto-cleans source files)

**DO NOT:**
- Skip the PDF conversion step
- Tell user "PDF will be generated later" — generate it NOW

### 5.2 Deliver to User

After PDF is generated, inform the user:

```
"✓ Developer guide complete: project-guides/DEVELOPER-GUIDE.pdf"
```

---

## Output

**FINAL OUTPUT:** `project-guides/DEVELOPER-GUIDE.pdf`

All source files (.md, .html, .plain.html) are deleted after PDF generation. Only the PDF remains.

**Location:** `project-guides/` folder

---

## Success Criteria

**Data Source Validation (CRITICAL):**
- [ ] Config Service API was called (`https://admin.hlx.page/config/{ORG}/sites.json`)
- [ ] Site list came from API response, NOT from fstab.yaml or codebase analysis
- [ ] Repoless/standard determination came from Config Service, NOT inferred from code

**Content Validation:**
- [ ] Quick Reference with all project URLs
- [ ] Architecture overview accurate to project
- [ ] Design system fully documented (tokens, fonts, breakpoints)
- [ ] Project-specific blocks documented
- [ ] Custom scripts.js functions documented
- [ ] delayed.js integrations documented
- [ ] Templates documented (if applicable)
- [ ] Local development setup verified
- [ ] Common tasks have clear instructions
- [ ] Troubleshooting section covers common issues
- [ ] Resources linked

**Output Validation:**
- [ ] PDF generated successfully
- [ ] All source files cleaned up (only PDF remains)

---

## Tips for Clear Documentation

1. **Focus on what's unique** - Document project-specific implementations
2. **Use code examples** - Show actual code from the project
3. **Document the "why"** - Explain reasoning behind custom implementations
4. **Include gotchas** - Note any tricky behavior or edge cases
5. **Test the setup instructions** - Verify they work from scratch
6. **Keep it maintainable** - Don't over-document things that change often
