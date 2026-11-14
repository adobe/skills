---
name: preview-import
description: Use this when you need to preview and verify content you imported into a local AEM Edge Delivery Services (EDS, Franklin, Helix) dev server on localhost. Starts the dev server against the imported HTML, checks block rendering, inspects DOM structure, compares against the original page, and troubleshoots broken references and 404s.
license: Apache-2.0
metadata:
  version: "2.0.2"
---

# Preview Import

Open and verify imported content in local development server.

## When to Use This Skill

Use this skill when:
- You have generated HTML file (from generate-import-html)
- Ready to preview in browser and verify rendering
- Need to compare with original page structure

**Invoked by:** page-import skill (Step 5)

## Prerequisites

From previous skills, you need:
- ✅ HTML file at correct path (from generate-import-html)
- ✅ Images folder in same directory
- ✅ screenshot.png from scrape-webpage (for comparison)
- ✅ documentPath from metadata.json (for URL construction)

## Related Skills

- **page-import** - Orchestrator that invokes this skill
- **generate-import-html** - Provides HTML file to preview
- **scrape-webpage** - Provides screenshot for comparison

## Preview Workflow

### Step 1: Start Development Server with HTML Folder Flag

**Determine the folder from `paths.htmlFilePath` in metadata.json:**
- Use the first path segment of `htmlFilePath` (e.g., `us` for `us/en/about.plain.html`)
- If `htmlFilePath` has no folder (e.g., `index.plain.html`, `about.plain.html`), serve the project root instead

**Command:**
```bash
aem up --html-folder {top-level folder}
# root-level files:
aem up --html-folder . --html-mount /
```

**Examples based on imported content location:**

| HTML File Location | Command | Preview URL |
|-------------------|---------|-------------|
| `us/en.plain.html` | `aem up --html-folder us` | `http://localhost:3000/us/en` |
| `products/widget.plain.html` | `aem up --html-folder products` | `http://localhost:3000/products/widget` |
| `blog/2024/post.plain.html` | `aem up --html-folder blog` | `http://localhost:3000/blog/2024/post` |
| `index.plain.html` | `aem up --html-folder . --html-mount /` | `http://localhost:3000/` |

**Why this is required:**
- Without `--html-folder`, AEM CLI proxies requests to the remote server
- The remote server doesn't have your locally imported content
- Result: 404 "Page not found" errors

---

### Step 2: Navigate in Browser

**Preview URL:** `http://localhost:3000` + `paths.documentPath` from metadata.json, with a trailing `index` removed:
```
us/en/about.plain.html  → http://localhost:3000/us/en/about
index.plain.html        → http://localhost:3000/
us/index.plain.html     → http://localhost:3000/us/
```

---

### Step 3: Verify Rendering

**Check the following:**
- ✅ Blocks render with correct styling
- ✅ Layout matches original page structure (compare to screenshot.png)
- ✅ Images load (or show appropriate placeholders)
- ✅ No raw HTML visible
- ✅ Metadata appears in page source (view source, check `<meta>` tags)
- ✅ Section styling applied correctly

---

### Step 4: Compare with Original

**Side-by-side comparison:**
1. Open `./import-work/screenshot.png` alongside browser preview
2. Check that content structure matches
3. Verify blocks decorated correctly
4. Confirm section boundaries align
5. Validate styling consistency

---

## Troubleshooting

**Blocks don't render correctly:**
- Check HTML structure matches expected format
- Verify block names match exactly (case-sensitive)
- Review [../content-driven-development/references/html-structure.md](../content-driven-development/references/html-structure.md) for format guidance

**Images not loading:**
- Verify images folder is in same directory as HTML file
- Check image paths are `./images/...` format
- Ensure images were copied correctly from `./import-work/images/`

**Raw HTML visible:**
- Block name might not match existing block in project
- Check browser console for JavaScript errors
- Verify block exists in `blocks/` directory

**Metadata not in page source:**
- Check metadata block is at end of HTML file
- View page source and search for `<meta>` tags in `<head>`
- Verify metadata properties match expected format

**Dev server not running:**
- Start server with `aem up`
- Check for port conflicts (default 3000)
- Verify you're in correct project directory

**Page not found (404):**
- **Most common cause:** Missing `--html-folder` flag - restart server with `aem up --html-folder {top-level folder}`
- Verify HTML file exists at expected path
- Check documentPath from metadata.json matches URL
- For index files, use `/` not `/index`
- Check terminal output confirms "Serving HTML files from folder: {folder}"

---

## Output

This skill provides:
- ✅ Verified preview that matches original page structure
- ✅ Visual confirmation of correct rendering
- ✅ Validated block decoration
- ✅ Confirmed metadata presence

**Import complete when all verification points pass.**
