---
name: handover
description: Generate project handover documentation for AEM Edge Delivery Services projects. Creates comprehensive guides for content authors, developers, and administrators. Use for "handover docs", "project documentation", "generate handover", "create guides".
license: Apache-2.0
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion, Skill, Agent
metadata:
  version: "1.0.0"
---

# Project Handover Documentation

Generate comprehensive handover documentation for Edge Delivery Services projects. This skill orchestrates the creation of guides for different audiences.

## When to Use This Skill

- "Generate project handover docs"
- "Create handover documentation"
- "Generate project guides"
- "Handover package"
- "Project documentation"

---

## Available Documentation Types

| Guide | Audience | Skill |
|-------|----------|-------|
| **Authoring Guide** | Content authors and content managers | `authoring` |
| **Developer Guide** | Developers and technical team | `development` |
| **Admin Guide** | Site administrators and operations | `admin` |

---

## Execution Flow

### Step 0: Navigate to Project Root and Verify Edge Delivery Services Project (MANDATORY FIRST STEP)

**CRITICAL: You MUST execute this `cd` command before anything else. Do NOT use absolute paths — actually change directory.**

```bash
# Navigate to git project root (works from any subdirectory)
cd "$(git rev-parse --show-toplevel)"

# Verify it's an Edge Delivery Services project
ls scripts/aem.js
```

**IMPORTANT:**
- You MUST run the `cd` command above using the Bash tool
- All subsequent steps operate from project root
- Do NOT use absolute paths to verify — actually navigate
- Guides will be created at `project-root/project-guides/`

**If `scripts/aem.js` does NOT exist**, respond:

> "This skill is designed for AEM Edge Delivery Services projects. The current directory does not appear to be an Edge Delivery Services project (`scripts/aem.js` not found).
>
> Please navigate to an Edge Delivery Services project and try again."

**STOP if check fails. Otherwise proceed — you are now at project root.**

---

### Step 0.5: Clean Up Stale Config

Remove any existing config to ensure fresh org and authentication for this project:

```bash
rm -f .claude-plugin/project-config.json
```

---

### Step 1: Ask User for Documentation Type

**MANDATORY:** Use the `AskUserQuestion` tool with EXACTLY these 4 options:

```json
AskUserQuestion({
  "questions": [{
    "question": "Which type of handover documentation would you like me to generate?",
    "header": "Guide Type",
    "options": [
      {"label": "All (Recommended)", "description": "Generate all three guides: Authoring, Developer, and Admin"},
      {"label": "Authoring Guide", "description": "For content authors and managers - blocks, templates, publishing"},
      {"label": "Developer Guide", "description": "For developers - codebase, implementations, design tokens"},
      {"label": "Admin Guide", "description": "For site administrators - permissions, API operations, cache"}
    ],
    "multiSelect": false
  }]
})
```

**DO NOT omit any option. All 4 options MUST be presented.**

### Step 1.5: Get Organization Name (Required Before Generating Guides)

**AFTER the user selects guide type(s), but BEFORE invoking any sub-skills**, ensure the organization name is available.

#### 1.5.1 Check for Saved Organization

```bash
# Check if org name is already saved
cat .claude-plugin/project-config.json 2>/dev/null | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1
```

#### 1.5.2 Prompt for Organization Name (If Not Saved)

**If no org name is saved**, you MUST pause and ask the user directly:

> "What is your Config Service organization name? This is the `{org}` part of your Edge Delivery Services URLs (e.g., `https://main--site--{org}.aem.page`). The org name may differ from your GitHub organization."

**IMPORTANT RULES:**
- **DO NOT use `AskUserQuestion` with predefined options** — ask as a plain text question
- **Organization name is MANDATORY** — do not offer a "skip" option
- **Wait for user to type the org name** before proceeding
- If user doesn't provide a valid org name, ask again

#### 1.5.3 Save Organization Name

Once you have the org name, save it so sub-skills can use it:

```bash
# Create config directory if needed
mkdir -p .claude-plugin
# Ensure .claude-plugin is in .gitignore (contains auth tokens)
grep -qxF '.claude-plugin/' .gitignore 2>/dev/null || echo '.claude-plugin/' >> .gitignore

# Save org name to config file
# If "All" was selected, include allGuides flag to skip step 0 in sub-skills
echo '{"org": "{ORG_NAME}"}' > .claude-plugin/project-config.json
# OR if "All (Recommended)" was selected:
echo '{"org": "{ORG_NAME}", "allGuides": true}' > .claude-plugin/project-config.json
```

**Note:** Include `"allGuides": true` ONLY when user selected "All (Recommended)". This signals sub-skills to skip step 0 validation (orchestrator already validated).

Replace `{ORG_NAME}` with the actual organization name provided by the user.

**Why this matters:** The organization name is required by the Helix Admin API to determine if the project is repoless (multi-site). By gathering it once in the orchestrator, sub-skills running in parallel don't each need to prompt the user separately.

### Step 1.6: Authenticate with Config Service (Browser Login)

**AFTER saving the organization name, authenticate using Playwright browser automation.**

#### 1.6.1 Check for Existing Auth Token

```bash
AUTH_TOKEN=$(cat .claude-plugin/project-config.json 2>/dev/null | grep -o '"authToken"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"authToken"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
```

#### 1.6.2 Open Browser for Login (If No Token)

If no auth token exists, use Playwright CLI:

1. **Install Playwright (if needed)**:
```bash
npx playwright --version 2>/dev/null || npm install -g playwright
npx playwright install chromium 2>/dev/null || true
```

2. **Get first site name** (unauthenticated):
```bash
ORG=$(cat .claude-plugin/project-config.json | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
SITE=$(curl -s "https://admin.hlx.page/config/${ORG}/sites.json" | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/"name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
```

3. **Get user acknowledgment before opening browser**:

Use `AskUserQuestion` to ensure user is ready:

```json
AskUserQuestion({
  "questions": [{
    "question": "A browser window will open for authentication. After signing in, CLOSE THE BROWSER WINDOW to continue. Ready?",
    "header": "Authentication Required",
    "options": [
      {"label": "Open Browser", "description": "I understand - open the browser for login"}
    ],
    "multiSelect": false
  }]
})
```

**After user confirms**, run:
```bash
mkdir -p .claude-plugin && npx playwright open --save-storage=.claude-plugin/auth-storage.json "https://admin.hlx.page/login/${ORG}/${SITE}/main"
```

#### 1.6.3 Extract and Save Auth Token

After browser is closed, extract token from storage file:

```bash
echo "Browser closed. Extracting auth token..."

AUTH_TOKEN=$(node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('.claude-plugin/auth-storage.json', 'utf8'));
const cookie = data.cookies.find(c => c.name === 'auth_token');
console.log(cookie ? cookie.value : '');
")

ORG=$(cat .claude-plugin/project-config.json | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
echo "{\"org\": \"${ORG}\", \"authToken\": \"${AUTH_TOKEN}\"}" > .claude-plugin/project-config.json

rm -f .claude-plugin/auth-storage.json
echo "Auth token saved."
```

**Why authenticate in orchestrator:** By authenticating once here, all sub-skills running in parallel can use the saved token without each prompting for login separately.

### Step 2: Invoke Appropriate Skill(s)

Based on user selection:

| Selection | Action |
|-----------|--------|
| **All** | Invoke all three skills **in parallel** (see Step 3) |
| **Authoring Guide** | `Skill({ skill: "project-management:authoring" })` |
| **Developer Guide** | `Skill({ skill: "project-management:development" })` |
| **Admin Guide** | `Skill({ skill: "project-management:admin" })` |

### Step 3: For "All" Selection

**Execute all three guides in PARALLEL with streaming progress updates.**

**IMPORTANT:** Provide immediate feedback to user before starting parallel execution:

```
"Starting parallel generation of all 3 handover guides:
  📄 Authoring Guide - analyzing blocks, templates, configurations...
  📄 Developer Guide - analyzing code, patterns, architecture...
  📄 Admin Guide - analyzing deployment, security, operations...

You'll see progress updates as each guide moves through its phases."
```

**Launch all three skills simultaneously using parallel Agent tool calls (foreground mode):**

In a SINGLE message, invoke three Agent tools in parallel. Foreground agents have full tool permissions and run concurrently:

```javascript
// All three in ONE message - runs in parallel with full permissions
Agent({
  description: "Generate authoring guide",
  prompt: "Invoke skill project-management:authoring to generate the authoring guide PDF. Show progress as you complete each phase."
})

Agent({
  description: "Generate developer guide",
  prompt: "Invoke skill project-management:development to generate the developer guide PDF. Show progress as you complete each phase."
})

Agent({
  description: "Generate admin guide",
  prompt: "Invoke skill project-management:admin to generate the admin guide PDF. Show progress as you complete each phase."
})
```

**Why foreground agents:**
- Run all 3 in parallel (~3x faster than sequential)
- Full tool permissions (Bash, Read, Write, Glob, Skill)
- Progress updates stream as each agent works

**When all three complete, report final summary:**

```
"Handover documentation complete:

project-guides/
├── AUTHOR-GUIDE.pdf (full guide for content authors)
├── DEVELOPER-GUIDE.pdf (full guide for developers)
└── ADMIN-GUIDE.pdf (full guide for administrators)

All PDFs generated. Source files cleaned up."
```

**Benefits of parallel execution:**
- ~3x faster than sequential execution
- User sees continuous progress updates
- Each guide generates independently

---

## Output Files

| Selection | Output Files |
|-----------|--------------|
| All | `project-guides/AUTHOR-GUIDE.pdf`, `project-guides/DEVELOPER-GUIDE.pdf`, `project-guides/ADMIN-GUIDE.pdf` |
| Authoring Guide | `project-guides/AUTHOR-GUIDE.pdf` |
| Developer Guide | `project-guides/DEVELOPER-GUIDE.pdf` |
| Admin Guide | `project-guides/ADMIN-GUIDE.pdf` |

**Note:** Each sub-skill generates a PDF only. All source files (.md, .html, .plain.html) are cleaned up after PDF generation.

---

## ⚠️ CRITICAL PATH REQUIREMENT

**ALL FILES MUST BE SAVED TO `project-guides/` FOLDER:**

```
project-guides/AUTHOR-GUIDE.md
project-guides/DEVELOPER-GUIDE.md
project-guides/ADMIN-GUIDE.md
```

**WHY THIS MATTERS:** Files must be in `project-guides/` for proper organization and PDF conversion.

**BEFORE WRITING ANY FILE:** Run `mkdir -p project-guides` first.

---

## MANDATORY RULES

**STRICTLY FORBIDDEN:**
- ❌ Do NOT read or analyze `fstab.yaml` — it does NOT exist in most projects and does NOT show all sites
- ❌ Do NOT create `.plain.html` files
- ❌ Do NOT use `convert_markdown_to_html` tool
- ❌ Do NOT tell user to "convert markdown to PDF manually"
- ❌ Do NOT say "PDF will be generated later" — each sub-skill generates PDF immediately
- ❌ Do NOT save markdown to root directory or any path other than `project-guides/`

**REQUIRED:**
- ✅ Run `mkdir -p project-guides` before writing any files
- ✅ Each sub-skill MUST save markdown to `project-guides/` folder (EXACT PATH)
- ✅ Markdown files MUST have `title` and `date` fields in frontmatter
- ✅ Each sub-skill MUST invoke `project-management:whitepaper` to generate PDF immediately after saving markdown
- ✅ Each sub-skill MUST cleanup ALL source files (.md, .html, .plain.html) after PDF generation
- ✅ Final output is `.pdf` files ONLY in `project-guides/` folder

---

## Related Skills

This skill invokes:
- `project-management:authoring` - Author/content manager guide (generates PDF immediately)
- `project-management:development` - Developer technical guide (generates PDF immediately)
- `project-management:admin` - Admin operations guide (generates PDF immediately)
- `project-management:whitepaper` - PDF generation (invoked by each sub-skill after saving markdown)

