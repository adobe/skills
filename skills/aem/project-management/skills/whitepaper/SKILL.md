---
name: whitepaper
description: Creates professional PDF whitepapers from Markdown files. Use when the user wants to create a whitepaper, technical document, or PDF with professional formatting and typography.
license: Apache-2.0
allowed-tools: Read, Write, Edit, Bash
metadata:
  argument-hint: "[input.md] [output.pdf]"
---

# Professional PDF Generator

This skill converts Markdown files into professionally typeset PDF whitepapers using pandoc and typst.

## Assets

The skill includes (located in the plugin's root directory):
- **Typst template**: `templates/whitepaper.typ`
- **Source Sans 3 fonts**: `fonts/` — variable fonts supporting all weights (open source from Google Fonts)
- **Source Code Pro fonts**: `fonts/` (Regular, Bold, Italic, Bold Italic) — used for code blocks and inline code

**Plugin Root:** The plugin root is determined dynamically (see Step 2.5 below)

### Typography Hierarchy

| Element | Weight | Style |
|---------|--------|-------|
| Headlines (H1) | Black (900) | Large, tight tracking |
| Section headlines (H2) | Bold (700) | Blue accent line |
| Subheads (H3, H4) | Bold (700) | Medium size |
| Body copy | Regular (400) | Justified, comfortable leading |
| Code | Source Code Pro | Monospace |

## CRITICAL: FULLY AUTOMATIC EXECUTION

**THIS SKILL RUNS COMPLETELY UNATTENDED. DO NOT:**
- Ask "Should I proceed?" before generating PDF
- Ask "Should I delete these files?" before cleanup
- Ask "Is this okay?" at any step
- Wait for user confirmation between steps
- Pause to show intermediate results
- Request permission for file operations

**REQUIRED BEHAVIOR:**
- Execute all steps sequentially without stopping
- Generate PDF immediately when invoked
- Delete ALL source files immediately after PDF is created
- Only communicate with user AFTER everything is complete
- Report final result: "PDF created: [path]"

**If you find yourself about to ask the user a question during PDF generation or cleanup, STOP and just execute the operation instead.**

## Usage

When the user asks to create a PDF, follow these steps:

### 1. Determine Input and Output

- Parse `$ARGUMENTS` for the input markdown file and optional output PDF path
- If no output path is given, use the same name as the input with a `.pdf` extension
- If no input is given, ask the user which markdown file to convert
- Check the file's YAML frontmatter (see "Frontmatter Reference" below). If `title` is missing, ask the user for a title before proceeding. If `date` is missing, default to today's date.

### 2. Install Dependencies (if missing)

Run for each missing tool — the script auto-detects the platform:

```bash
OS=$(uname -s)
# pandoc
command -v pandoc >/dev/null 2>&1 || {
  [ "$OS" = "Darwin" ] && brew install pandoc || sudo apt-get update && sudo apt-get install -y pandoc
}
# typst
command -v typst >/dev/null 2>&1 || {
  [ "$OS" = "Darwin" ] && brew install typst || {
    curl -fsSL https://github.com/typst/typst/releases/latest/download/typst-x86_64-unknown-linux-musl.tar.xz \
      | tar xJ --strip-components=1 -C /usr/local/bin/ typst-x86_64-unknown-linux-musl/typst
    chmod +x /usr/local/bin/typst
  }
}
```

### 2.5 Locate Plugin Root Directory

**CRITICAL: Determine the plugin root before copying assets.**

The plugin root contains `templates/` and `fonts/` directories. Use this single command:

```bash
PLUGIN_ROOT=$([ -d ".claude/plugins/project-management" ] && echo ".claude/plugins/project-management" || echo "$CLAUDE_PLUGIN_ROOT")
echo "Using plugin root: $PLUGIN_ROOT"
ls "$PLUGIN_ROOT/templates/whitepaper.typ" || echo "ERROR: Template not found!"
```

**Expected location:** `.claude/plugins/project-management`

### 3. Copy Template to Output Directory

Copy the typst template to the same directory as the output PDF:

```bash
PLUGIN_ROOT=$([ -d ".claude/plugins/project-management" ] && echo ".claude/plugins/project-management" || echo "$CLAUDE_PLUGIN_ROOT")
cp "$PLUGIN_ROOT/templates/whitepaper.typ" <output-directory>/whitepaper.typ
```

Replace `<output-directory>` with the directory where the PDF will be generated (e.g., `project-guides/`).

### 4. Run Pandoc

Execute the conversion with these exact flags. Run from the output directory so the template is found:

```bash
cd <output-directory> && \
PLUGIN_ROOT=$(if [ -d "../.claude/plugins/project-management" ]; then echo "../.claude/plugins/project-management"; elif [ -d ".claude/plugins/project-management" ]; then echo ".claude/plugins/project-management"; else echo "$CLAUDE_PLUGIN_ROOT"; fi) && \
TYPST_FONT_PATHS="$PLUGIN_ROOT/fonts" pandoc <input.md> \
  -o <output.pdf> \
  --pdf-engine=typst \
  -V template="whitepaper.typ" \
  -V mainfont="Source Sans 3" \
  -V fontsize=10pt \
  -V papersize=a4
```

**Example for `project-guides/ADMIN-GUIDE.md`:**
```bash
cd content && \
PLUGIN_ROOT=$([ -d "../.claude/plugins/project-management" ] && echo "../.claude/plugins/project-management" || echo "$CLAUDE_PLUGIN_ROOT") && \
TYPST_FONT_PATHS="$PLUGIN_ROOT/fonts" pandoc ADMIN-GUIDE.md -o ADMIN-GUIDE.pdf --pdf-engine=typst -V template="whitepaper.typ" -V mainfont="Source Sans 3" -V fontsize=10pt -V papersize=a4
```

Note: Do **not** pass `--toc` — the template generates its own table of contents page with proper styling.

### 5. Clean Up (MANDATORY - DO NOT SKIP)

**CRITICAL: You MUST execute cleanup immediately after PDF generation. Only PDF should remain.**

```bash
# Remove ALL intermediate files in one command
rm -f <output-directory>/whitepaper.typ <input.md> <input-without-extension>.plain.html <input-without-extension>.html
```

**Example cleanup for `project-guides/AUTHOR-GUIDE.md`:**
```bash
rm -f project-guides/whitepaper.typ project-guides/AUTHOR-GUIDE.md project-guides/AUTHOR-GUIDE.plain.html project-guides/AUTHOR-GUIDE.html
```

**After cleanup, only `project-guides/AUTHOR-GUIDE.pdf` should exist. No .md, .html, or .plain.html files.**

### 6. Report Result

```
"PDF created: [output.pdf]"
```

## Frontmatter Reference

The template reads pandoc YAML frontmatter from the markdown file to populate the title page and footer. The frontmatter block must be the very first thing in the file, delimited by `---` lines.

### Required Fields

| Field | Purpose | Example |
|-------|---------|---------|
| `title` | Cover page headline, PDF metadata | `"AEM Code Sync for Edge Delivery Services"` |

### Recommended Fields

| Field | Purpose | Example |
|-------|---------|---------|
| `subtitle` | Second line on cover, below the accent line | `"Technical Architecture and Security Documentation"` |
| `date` | Cover page and page footer | `"January 29, 2026"` |

### Optional Fields

| Field | Purpose | Example |
|-------|---------|---------|
| `author` | Author list on cover page | See structured example below |

### Minimal Example

```yaml
---
title: "AEM Code Sync for Edge Delivery Services"
subtitle: "Technical Architecture and Security Documentation"
date: "January 29, 2026"
---
```

### Full Example with Authors

```yaml
---
title: "AEM Code Sync for Edge Delivery Services"
subtitle: "Technical Architecture and Security Documentation"
date: "January 29, 2026"
author:
  - name: "Jane Smith"
    affiliation: "Edge Delivery Services"
  - name: "John Doe"
    affiliation: "Security Engineering"
---
```

### What the Template Renders

- **Title**: Large black-weight text on the cover
- **Subtitle**: Lighter text below the accent divider line
- **Date**: Shown on the cover and in the page footer
- **Authors**: Listed on the cover with optional affiliation

### Common Mistakes

- Putting the frontmatter after a heading or blank line (it must be the first thing in the file)
- Using unquoted strings that contain colons, e.g. `title: AEM: A Guide` -- wrap in quotes
- Adding pandoc variables like `fontsize` or `papersize` in the frontmatter -- pass those as `-V` flags to pandoc instead (the skill handles this automatically)

## Template Design

The template provides professional document formatting:
- **Professional typography** using Source Sans 3 (open source font from Google Fonts)
- **Blue accent color** (#0066cc) for section dividers and links
- **Clean header** with title/subtitle (no separator line)
- **Footer** with date and page numbering (hidden on title page)
- **Source Code Pro** for code blocks and inline code
- **Automatic table of contents** page
- **Title page** with accent divider line

### Template Features

| Feature | Description |
|---------|-------------|
| Title page | Clean design with title, subtitle, date, authors |
| Table of contents | Auto-generated on page 2 |
| H1 headings | Black weight, page break before |
| H2 headings | Bold with blue accent line |
| Code blocks | Gray background, rounded corners |
| Blockquotes | Blue left border, light blue background |
| Tables | Light borders, bold header row |
| Links | Blue color (#0066cc) |

## Customizing the Document

The user can override pandoc variables with `-V key=value`:

| Variable | Default | Description |
|----------|---------|-------------|
| `papersize` | `a4` | Page size (`a4`, `us-letter`, etc.) |
| `fontsize` | `10pt` | Base font size |
| `template` | `whitepaper.typ` | Typst template file |
| `mainfont` | `Source Sans 3` | Main body font |

## Requirements

- `pandoc` and `typst` must be installed (the skill auto-installs them if missing)
  - **macOS**: via Homebrew (`brew`)
  - **Linux**: `pandoc` via `apt-get`, `typst` via GitHub release binary
- Source Sans 3 fonts are included in the plugin's `fonts/` directory

## Troubleshooting

If fonts are not found by typst, ensure the `TYPST_FONT_PATHS` environment variable is set correctly:

```bash
export TYPST_FONT_PATHS=${CLAUDE_PLUGIN_ROOT}/fonts
```

| Issue | Solution |
|-------|----------|
| Font not found | Check TYPST_FONT_PATHS points to plugin's fonts/ directory |
| Template not found | Ensure whitepaper.typ was copied to output directory |
| Tables not breaking | Template handles this automatically |
| Missing title page | Check frontmatter has `title` field |
