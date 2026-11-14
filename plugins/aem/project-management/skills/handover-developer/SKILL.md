---
name: handover-developer
description: Generate comprehensive technical documentation for developers taking over an AEM Edge Delivery Services project. Use when onboarding developers, creating technical handover documentation, or documenting a project's architecture — analyzes codebase structure, custom implementations, design tokens, and produces a complete developer guide.
license: Apache-2.0
allowed-tools: Read, Write, Edit, Bash, Skill, Glob, Grep
metadata:
  version: "1.0.0"
---

# Project Handover - Development

Generate a complete technical guide for developers. Analyzes the codebase and produces actionable documentation that enables developers to understand, maintain, and extend the project.

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
- [ ] Phase 1: Gather project information
- [ ] Phase 2: Analyze project architecture
- [ ] Phase 3: Document design system
- [ ] Phase 4: Document blocks, models, and templates
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

If `AUTH_REQUIRED`, invoke the auth skill:

```
Skill({ skill: "aem-project-management:auth" })
```

---

## Phase 1: Gather Project Information

### 1.1 Get Project URLs and Repository

```bash
git remote -v | head -1
git branch -a | head -10
```

Extract: repository owner, repo name, main branch name.

### 1.2 Check Configuration Method

```bash
ls helix-config.yaml 2>/dev/null && echo "Uses legacy helix-config" || echo "Uses Config Service (modern)"
```

### 1.3 Fetch Sites via Config Service API

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

Fetch per-site config:

```bash
curl -s -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/{site-name}.json"
```

Extract: `code.owner`, `code.repo`, `content.source.url`, `content.source.type`.

Multiple sites = repoless setup. Single site = standard setup. Record this — it affects the `aem up` local dev instructions.

### 1.4 Check Node.js Requirements

```bash
cat .nvmrc 2>/dev/null || cat package.json | grep -A2 '"engines"'
```

---

## Phase 2: Analyze Project Architecture

Read site config:

```bash
cat .claude-plugin/sites-config.json
```

### 2.1 Map Project Structure

```bash
ls -la && ls -la blocks/ && ls -la scripts/ && ls -la styles/
ls -la templates/ 2>/dev/null || echo "No templates folder"
```

### 2.2 Identify Boilerplate vs Custom Files

Only document files that were actually customized.

```bash
git log --oneline --follow {file_path} | head -5
git log --format="%an - %s" --follow {file_path} | head -5
```

| Git History | Action |
|-------------|--------|
| Only "Initial commit" | Skip — boilerplate default, never worked on |
| Only `aem-aemy[bot]` commits | Skip — auto-generated |
| Multiple commits by team | Document — customized |

### 2.3 Analyze scripts/aem.js (Core Library)

```bash
grep -E "^export" scripts/aem.js
```

Document which functions the project imports from `aem.js` (e.g., `sampleRUM`, `loadHeader`, `loadFooter`, `decorateBlock`, `loadBlock`, `loadCSS`).

### 2.4 Analyze scripts/scripts.js

```bash
grep -E "^import|^export|^function|^async function|buildAutoBlocks|loadTemplate|getLanguage|getSiteRoot|decorateMain|loadEager|loadLazy|loadDelayed" scripts/scripts.js
```

Document:

| Pattern | What to Document |
|---------|-----------------|
| `import` statements | What it imports from `aem.js` and `utils.js` |
| `loadEager` / `loadLazy` | Any custom logic added to E-L-D phases |
| `buildAutoBlocks` | Auto-blocking logic |
| `loadTemplate` / template handling | Template system |
| `getLanguage` / language detection | Multi-language setup |
| `getSiteRoot` / site detection | Multi-site configuration |
| External script loading | Which phase — flag if in eager (performance risk) |

### 2.5 Analyze the delayed phase

Current boilerplate projects load martech through `loadDelayed()` → `scripts/consent-check.js` → `scripts/consented.js` (after consent). Older projects use `scripts/delayed.js`. Check whichever the project has:

```bash
grep -E "^import|function|google|analytics|gtag|alloy|martech|OneTrust|launch|chatbot|widget" scripts/consented.js scripts/consent-check.js scripts/delayed.js 2>/dev/null
```

Document analytics integrations, marketing tools, performance monitoring and the consent mechanism. Confirm no render-critical code is in these files.

### 2.6 Check for Utility Functions

```bash
grep -E "^export|^function" scripts/utils.js 2>/dev/null || echo "No utils.js"
ls scripts/*.js
grep -rl "utils.js" blocks/ scripts/ 2>/dev/null
```

Document shared utility functions and which blocks/scripts import them.

### 2.7 Check for External Dependencies

```bash
grep -A 20 '"dependencies"' package.json 2>/dev/null | head -25
grep -r "cdn\|unpkg\|jsdelivr" scripts/ blocks/ --include="*.js" 2>/dev/null
```

---

## Phase 3: Document Design System

### 3.1 Extract CSS Custom Properties

```bash
grep -E "^\s*--" styles/styles.css
```

Organize into categories: Typography, Colors, Spacing, Layout.

### 3.2 Document Font Setup

```bash
grep -E "@font-face|font-family|font-weight|src:" styles/fonts.css 2>/dev/null
ls fonts/ 2>/dev/null
```

Document: font files and formats, family names, weights, fallback fonts.

### 3.3 Document Breakpoints

```bash
grep -E "@media.*min-width|@media.*max-width" styles/styles.css | sort -u
```

Standard breakpoints: Mobile < 600px, Tablet 600-899px, Desktop 900px+, Large 1200px+. Document any deviations.

### 3.4 Document Section Styles

```bash
grep -A 5 "\.section\." styles/styles.css
grep -A 5 "\.section\[" styles/styles.css
```

---

## Phase 4: Document Blocks, Models, and Templates

### Boilerplate Filtering

Run silently — do not show output to user.

- Include: Items with 2+ commits and at least one after "Initial commit"
- Exclude: Items with only "Initial commit" or only `aem-aemy[bot]` commits

### 4.1 Identify and Analyze Customized Blocks

```bash
head -30 blocks/{blockname}/{blockname}.js
grep -E "^\." blocks/{blockname}/{blockname}.css | head -30
grep -E "classList\.contains|classList\.add" blocks/{blockname}/{blockname}.js
```

Document for each customized block:

| Field | What to Record |
|-------|----------------|
| Name | Block folder name |
| Purpose | What it does |
| DOM Input | Expected HTML structure from CMS |
| DOM Output | Transformed structure after decoration |
| Variants | CSS classes that modify behavior |
| Dependencies | External libraries, other blocks, utils |

### 4.2 Document Universal Editor Models (If Customized)

Apply boilerplate filtering to `models/*.json`. Exclude standard boilerplate models (`_page.json`, `_section.json`, `_button.json`, `_image.json`, `_text.json`, `_title.json`) if unchanged. Skip section if all models are boilerplate.

### 4.3 Document Customized Templates

Apply boilerplate filtering to `templates/*/`. For each customized template, document purpose, how it's applied (`template: name` in metadata), and what it changes.

---

## Phase 5: Generate Developer Guide

### 5.1 Output File

Save to `project-guides/DEVELOPER-GUIDE.md` (run `mkdir -p project-guides` first).

Read `resources/developer-guide-template.md` for the full document structure. Fill in all sections using data gathered in Phases 1–4 — replace every `[placeholder]` with actual project values.

### 5.2 Convert to Professional PDF

Save the completed markdown to `project-guides/DEVELOPER-GUIDE.md` with YAML frontmatter (title, date using full date format e.g., "February 17, 2026"). Then immediately invoke PDF conversion:

```
Skill({ skill: "aem-project-management:whitepaper", args: "project-guides/DEVELOPER-GUIDE.md project-guides/DEVELOPER-GUIDE.pdf" })
```

The whitepaper skill auto-cleans source files. Final output: `project-guides/DEVELOPER-GUIDE.pdf`.

Inform the user: "Developer guide complete: project-guides/DEVELOPER-GUIDE.pdf"

---

## Success Criteria

| Category | Check |
|----------|-------|
| **Data Source** | Config Service API called (`https://admin.hlx.page/config/{ORG}/sites.json`) |
| **Data Source** | Site list from API response, not fstab.yaml or codebase analysis |
| **Data Source** | Repoless/standard determination from Config Service, not inferred from code |
| **Content** | Quick Reference with all project URLs |
| **Content** | Architecture overview accurate to project |
| **Content** | Design system fully documented (tokens, fonts, breakpoints) |
| **Content** | Project-specific blocks documented |
| **Content** | Custom scripts.js functions documented |
| **Content** | Delayed-phase integrations documented (`consented.js` or `delayed.js`) |
| **Content** | Templates documented (if applicable) |
| **Content** | Local development setup verified |
| **Content** | Common tasks have clear instructions |
| **Content** | Troubleshooting section covers common issues |
| **Output** | PDF generated at `project-guides/DEVELOPER-GUIDE.pdf` |
| **Output** | All source files cleaned up (only PDF remains) |

---

**Communication:** Never use "EDS" as an acronym — always write "Edge Delivery Services" or "AEM Edge Delivery Services" in all output and documentation.
