# Figma Design Integration Rules for AEM Components

Rules for fetching Figma designs via the Figma MCP server and translating them into
AEM component HTML, CSS, and JS files with pixel-perfect visual fidelity.

## Table of Contents

- [Prerequisite: Figma MCP Server](#prerequisite-figma-mcp-server)
- [Rule 1: Detect Figma URL Input](#rule-1-detect-figma-url-input)
  - [When to Trigger](#when-to-trigger)
  - [URL Parsing Rules](#url-parsing-rules)
  - [Example Parsing](#example-parsing)
- [Rule 2: Invoke the Figma MCP Server](#rule-2-invoke-the-figma-mcp-server)
  - [Primary Tool: `get_design_context`](#primary-tool-getdesigncontext)
  - [Required Call Format](#required-call-format)
  - [Parameter Rules](#parameter-rules)
  - [Fallback Tools](#fallback-tools)
  - [Large Frame Strategy](#large-frame-strategy)
- [Rule 3: Interpret the Figma Response](#rule-3-interpret-the-figma-response)
  - [CRITICAL: Response is a REFERENCE, Not Production Code](#critical-response-is-a-reference-not-production-code)
  - [What the Response Contains and How to Use It](#what-the-response-contains-and-how-to-use-it)
  - [FORBIDDEN Actions](#forbidden-actions)
- [Rule 4: Extract Design Tokens from Figma Response](#rule-4-extract-design-tokens-from-figma-response)
  - [Color Extraction](#color-extraction)
  - [Typography Extraction](#typography-extraction)
  - [Font Family Fallback Stacks](#font-family-fallback-stacks)
  - [Spacing Extraction](#spacing-extraction)
  - [Border & Effects](#border-effects)
  - [Layout Extraction](#layout-extraction)
- [Rule 5: Convert Figma HTML to AEM HTL](#rule-5-convert-figma-html-to-aem-htl)
  - [Conversion Process](#conversion-process)
  - [JSX-to-HTL Mapping Table](#jsx-to-htl-mapping-table)
  - [Absolute Positioning to Layout Conversion](#absolute-positioning-to-layout-conversion)
  - [Semantic Element Selection](#semantic-element-selection)
- [Rule 6: Place CSS in Component Clientlib](#rule-6-place-css-in-component-clientlib)
  - [File Location](#file-location)
  - [CSS Creation from Figma Design](#css-creation-from-figma-design)
  - [CSS File Structure](#css-file-structure)
  - [Pixel-Perfect Fidelity Checklist](#pixel-perfect-fidelity-checklist)
- [Rule 7: Place JS in Component Clientlib (When Needed)](#rule-7-place-js-in-component-clientlib-when-needed)
  - [File Location](#file-location)
  - [When JS is Created, Also Update](#when-js-is-created-also-update)
  - [JS Pattern](#js-pattern)
- [Rule 8: Handle Figma Image Assets](#rule-8-handle-figma-image-assets)
  - [Temporary URLs](#temporary-urls)
  - [Rules](#rules)
- [Rule 9: Verification and Quality Gates](#rule-9-verification-and-quality-gates)
  - [Post-Creation Verification](#post-creation-verification)
  - [Figma-to-AEM File Mapping Summary](#figma-to-aem-file-mapping-summary)

---

## Prerequisite: Figma MCP Server

The Figma design integration requires the **`plugin-figma-figma` MCP server** to be enabled and connected in the IDE.

| MCP Server Status | Action |
|-------------------|--------|
| **Available** | Proceed with Rules 1–9 below |
| **NOT available** | Skip Figma integration entirely. Create basic structural CSS using `clientlib-patterns.md` instead. Inform the user: *"Figma design integration requires the `plugin-figma-figma` MCP server to be enabled in your IDE. Please enable it and try again, or provide a mockup image as an alternative."* |

---

## Rule 1: Detect Figma URL Input

### When to Trigger

Activate Figma design integration when the user provides ANY of these URL patterns:

| URL Pattern | Type |
|-------------|------|
| `figma.com/design/:fileKey/:fileName?node-id=:nodeId` | Standard design file |
| `figma.com/design/:fileKey/branch/:branchKey/:fileName` | Branch design file |
| `figma.com/make/:makeFileKey/:makeFileName` | Figma Make file |

### URL Parsing Rules

1. **Extract `fileKey`**: The segment immediately after `/design/` (or use `branchKey` for branch URLs)
2. **Extract `nodeId`**: The `node-id` query parameter value with **`-` converted to `:`**
   - URL has `node-id=4-103` → `nodeId = "4:103"`
   - URL has `node-id=12-456` → `nodeId = "12:456"`
3. **Branch URLs**: Use `branchKey` (not `fileKey`) as the file identifier
4. **Make URLs**: Use `makeFileKey` as the file identifier

### Example Parsing

```
Input:  https://www.figma.com/design/nIRsoy3t8Jmu9NHSBvIgG4/Untitled?node-id=4-103&m=dev
Result: fileKey = "nIRsoy3t8Jmu9NHSBvIgG4", nodeId = "4:103"

Input:  https://www.figma.com/design/abc123/branch/def456/MyFile?node-id=10-20
Result: fileKey = "def456", nodeId = "10:20"

Input:  https://www.figma.com/make/xyz789/MyMakeFile
Result: fileKey = "xyz789", nodeId = "" (root)
```

---

## Rule 2: Invoke the Figma MCP Server

### Primary Tool: `get_design_context`

**MCP Server**: `plugin-figma-figma`
**Tool Name**: `get_design_context`

This is the **PRIMARY and PREFERRED** tool for fetching component designs. Always use this first.

### Required Call Format

```json
{
  "server": "plugin-figma-figma",
  "toolName": "get_design_context",
  "arguments": {
    "nodeId": "<extracted-node-id>",
    "fileKey": "<extracted-file-key>",
    "clientLanguages": "html,css,javascript",
    "clientFrameworks": "htl"
  }
}
```

### Parameter Rules

| Parameter | Required | Value |
|-----------|----------|-------|
| `nodeId` | **Yes** | Extracted from URL, format `"123:456"` |
| `fileKey` | **Yes** | Extracted from URL |
| `clientLanguages` | Recommended | `"html,css,javascript"` (for AEM projects) |
| `clientFrameworks` | Recommended | `"htl"` (for AEM HTL templates) |
| `excludeScreenshot` | No | Default `false` — **ALWAYS** include screenshot for visual reference |
| `forceCode` | No | Only set `true` if initial response returned metadata-only due to size |

### Fallback Tools

Use these when `get_design_context` alone is insufficient:

| Situation | Fallback Tool | Purpose |
|-----------|---------------|---------|
| Large/complex frame returns metadata-only | `get_design_context` with `forceCode: true` | Force code generation for oversized nodes |
| Need structural overview of a page | `get_metadata` | Get node tree structure, then call `get_design_context` on specific sub-nodes |
| Need visual reference only | `get_screenshot` | Get a rendered screenshot without code output |
| Design uses Figma variables/tokens | `get_variable_defs` | Get reusable design token variable definitions (colors, spacing, etc.) |

### Large Frame Strategy

If the Figma node is a full page or complex frame:

1. **First** call `get_metadata` to see the node tree
2. **Identify** the specific component sub-node from the metadata
3. **Then** call `get_design_context` on that sub-node for better, more focused results
4. **Avoid** selecting entire pages — break into logical component chunks

> **Why?** Large selections slow the tools down, cause errors, or result in
> incomplete responses. Smaller sections produce faster, more reliable results.

---

## Rule 3: Interpret the Figma Response

### CRITICAL: Response is a REFERENCE, Not Production Code

The `get_design_context` tool returns:

1. **Code** — React + Tailwind format (reference structure only — must be converted)
2. **Screenshot** — Visual rendering of the design node (the visual truth)
3. **Asset URLs** — Temporary image download URLs (**expire in 7 days**)
4. **Contextual hints** — Design annotations, Code Connect snippets, design tokens

### What the Response Contains and How to Use It

| Response Element | Use For |
|------------------|---------|
| JSX/HTML structure | Derive semantic HTML element hierarchy for HTL |
| Tailwind inline classes (`text-[#hex]`, `text-[Npx]`, etc.) | Extract exact CSS values (colors, spacing, fonts, sizes) |
| `className` values | Map to BEM CSS class names (`cmp-{name}__{element}`) |
| `data-name` attributes | Understand Figma layer naming for semantic meaning |
| `data-node-id` attributes | Reference back to specific Figma nodes if further detail needed |
| Screenshot image | **Visual truth** — compare your output against this |
| Image/SVG constants | Temporary placeholder URLs (do NOT hardcode in templates) |

### FORBIDDEN Actions

- **DO NOT** use the React/JSX code as-is in AEM components
- **DO NOT** install or reference Tailwind CSS in the AEM project
- **DO NOT** use absolute positioning from Figma output for layout (translate to flexbox/grid)
- **DO NOT** hardcode Figma temporary image URLs into HTL templates or CSS
- **DO NOT** keep `data-name` or `data-node-id` attributes in production HTL
- **DO NOT** keep `className` (React syntax) — convert to `class` (HTML)
- **DO NOT** carry over React-specific patterns (`{variable}`, `&&` conditional rendering, `.map()`)

---

## Rule 4: Extract Design Tokens from Figma Response

### Color Extraction

From Tailwind classes like `text-[#58181d]`, `bg-[#dc6e52]`, `border-[#aaa]`:

- Extract the hex value **exactly as-is**
- Map to CSS: `color: #58181d;`, `background-color: #dc6e52;`
- **Preserve exact hex values** — do NOT substitute, approximate, or "improve" colors

### Typography Extraction

From patterns like `font-['Baskerville:Regular',sans-serif]` and `text-[32px]`:

| Figma Token Pattern | CSS Property | Extraction Rule |
|---------------------|-------------|-----------------|
| `font-['Family:Weight',fallback]` | `font-family` | Use exact family name, add proper fallback stack (see table below) |
| Weight qualifier in font name (Regular, Bold, Light, Semi Bold) | `font-weight` | Map: Light=300, Regular=400, Medium=500, Semi Bold=600, Bold=700, Extra Bold=800 |
| `text-[Npx]` | `font-size` | Use exact pixel value |
| `leading-[Npx]` | `line-height` | Use exact pixel value |
| `not-italic` / `italic` | `font-style` | Map directly to `normal` / `italic` |
| `tracking-[N]` | `letter-spacing` | Use exact value with unit |
| `whitespace-nowrap` | `white-space` | `nowrap` |
| `uppercase` / `lowercase` / `capitalize` | `text-transform` | Map directly |

### Font Family Fallback Stacks

Always add a fallback stack when extracting font families from Figma:

| Figma Font | CSS `font-family` Value |
|------------|------------------------|
| Baskerville | `Baskerville, 'Baskerville Old Face', 'Book Antiqua', Georgia, serif` |
| Helvetica | `Helvetica, Arial, sans-serif` |
| Georgia | `Georgia, 'Times New Roman', Times, serif` |
| Roboto / Open Sans / Lato / Montserrat | `{Font}, 'Helvetica Neue', Arial, sans-serif` |
| Playfair Display / Garamond | `{Font}, Georgia, serif` |
| Other/custom | Use exact name, add generic fallback (`serif` / `sans-serif` / `monospace`) |

### Spacing Extraction

From Tailwind classes like `left-[40px]`, `top-[30px]`, `pt-[20px]`, `gap-[16px]`:

| Tailwind Pattern | CSS Property |
|------------------|-------------|
| `p-[N]`, `px-[N]`, `py-[N]`, `pt-[N]`, `pr-[N]`, `pb-[N]`, `pl-[N]` | `padding` / `padding-top` / `padding-right` etc. |
| `m-[N]`, `mx-[N]`, `my-[N]`, `mt-[N]`, `mr-[N]`, `mb-[N]`, `ml-[N]` | `margin` / `margin-top` / `margin-right` etc. |
| `gap-[N]` | `gap` |
| `w-[N]`, `min-w-[N]`, `max-w-[N]` | `width`, `min-width`, `max-width` |
| `h-[N]`, `min-h-[N]`, `max-h-[N]` | `height`, `min-height`, `max-height` |
| `left-[N]`, `top-[N]`, `right-[N]`, `bottom-[N]` | Convert to padding/margin — NOT absolute position (see Rule 5) |

### Figma Dimensions Are Border-Box

Figma frame dimensions are always **outer dimensions** that include padding. When a Figma frame reports 500×278px with 40px horizontal and 48px vertical padding, the 500×278px measurements already include the padding — they are not content-only measurements.

CSS defaults to `content-box`, which adds padding **on top of** `width`/`height`. This causes rendered components to be larger than the Figma design. To match Figma's sizing model, apply `box-sizing: border-box` to any element whose `width`, `height`, `min-width`, or `min-height` is derived from a Figma frame size. This ensures padding is subtracted from the specified dimensions rather than added on top.

```css
/* Figma frame: 500×278px with 40px horizontal, 48px vertical padding */
.cmp-hero {
  box-sizing: border-box;
  min-height: 278px;
  width: 100%;
  max-width: 500px;
  padding: 48px 40px;
}
```

> **Why this matters:** Without `border-box`, the element above would render as
> 580px wide (500 + 40 + 40) and 374px tall (278 + 48 + 48) instead of the intended 500×278px.

### Border & Effects

| Figma Token Pattern | CSS Property |
|---------------------|-------------|
| `border-[#hex]` | `border-color: #hex;` |
| `border-solid` / `border-dashed` | `border-style: solid;` / `border-style: dashed;` |
| `border-[Npx]` / `border-N` | `border-width: Npx;` |
| `rounded-[Npx]` | `border-radius: Npx;` (round to nearest integer if decimal) |
| `shadow-[...]` | `box-shadow: ...;` |
| `opacity-[N]` | `opacity: N;` |

### Layout Extraction

| Tailwind Pattern | CSS Property |
|------------------|-------------|
| `flex` | `display: flex;` |
| `flex-col` | `flex-direction: column;` |
| `flex-row` | `flex-direction: row;` |
| `items-center` | `align-items: center;` |
| `items-start` | `align-items: flex-start;` |
| `justify-center` | `justify-content: center;` |
| `justify-between` | `justify-content: space-between;` |
| `shrink-0` | `flex-shrink: 0;` |
| `grow` | `flex-grow: 1;` |
| `overflow-hidden` | `overflow: hidden;` |

---

## Rule 5: Convert Figma HTML to AEM HTL

### Conversion Process

1. **Analyze JSX structure** from `get_design_context` response
2. **Identify semantic purpose** of each element using `data-name` attributes and visual hierarchy
3. **Map to semantic HTML**: heading containers → `<h2>`, link containers → `<a>`, image wrappers → `<img>`, text blocks → `<p>` or `<div>`
4. **Apply BEM class names**: `cmp-{component-name}__{element}`
5. **Replace static text** with Sling Model expressions: `${model.propertyName}`
6. **Add HTL directives**: `data-sly-test`, `data-sly-use`, `data-sly-list`
7. **Apply XSS contexts**: `@ context='html'` for rich text, `@ extension='html'` for internal URLs, `@ context='attribute'` for attribute values

### JSX-to-HTL Mapping Table

| Figma/React Pattern | AEM HTL Equivalent |
|---------------------|-------------------|
| `className="..."` | `class="cmp-{name}__{element}"` |
| `{variable}` or `` {`text`} `` | `${model.property}` |
| `<p>` with heading font/size | `<h2>` or `<h3>` (use correct semantic level) |
| `<div>` wrapping a link shape | `<a href="..." class="cmp-{name}__link">` |
| `<img src={imageConst} />` | `<img src="${model.image}" alt="${model.title @ context='attribute'}" loading="lazy"/>` |
| `{condition && <Element>}` | `<sly data-sly-test="${model.condition}"><Element>...</Element></sly>` |
| `{items.map(item => <El/>)}` | `<sly data-sly-list.item="${model.items}"><El>...</El></sly>` |
| `style={{ color: '#fff' }}` | Move to CSS file, reference via BEM class |
| `onClick={handler}` | Move to component JS file, bind via `data-cmp-is` selector |

### Absolute Positioning to Layout Conversion

Figma often outputs absolute positioning (`absolute`, `left-[40px]`, `top-[30px]`).
**ALWAYS convert to proper CSS layout:**

| Figma Pattern | Convert To |
|---------------|-----------|
| Vertically stacked absolute elements | `display: flex; flex-direction: column;` with `gap` or `margin` |
| Horizontally placed absolute elements | `display: flex; flex-direction: row;` with `gap` or `margin` |
| Grid-like arrangement of absolutes | `display: grid; grid-template-columns: ...;` |
| Single centered element | `margin: 0 auto;` or flexbox centering |
| Overlapping elements (genuine overlay) | `position: absolute;` (only for true overlays/decorations) |

> **NEVER** use `position: absolute` with pixel offsets from Figma output for normal layout.
> Only use absolute positioning for genuine overlay or decorative elements.

### Semantic Element Selection

Use `data-name` attributes from the Figma response to determine the correct HTML element:

| `data-name` Pattern | HTML Element |
|---------------------|-------------|
| "Heading", "Title", "H1"-"H6" | `<h1>`–`<h6>` (match heading level to visual hierarchy) |
| "Paragraph", "Body", "Description", "Copy" | `<p>` or `<div>` (for rich text: `<div>` with `@ context='html'`) |
| "Link", "Button", "CTA" | `<a>` (with `href`) or `<button>` |
| "Image", "Photo", "Thumbnail" | `<img>` (with `alt`, `loading="lazy"`) |
| "List", "Items" | `<ul>` + `<li>` or `<ol>` + `<li>` |
| "Container", "Wrapper", "Section" | `<div>` or `<section>` |
| "Card", "Tile" | `<article>` |
| "Navigation", "Nav" | `<nav>` |

---

## Rule 6: Place CSS in Component Clientlib

### File Location

```
ui.apps/src/main/content/jcr_root/apps/[project]/clientlibs/clientlib-{component-name}/css/{component-name}.css
```

### CSS Creation from Figma Design

1. **Extract ALL design tokens** from the `get_design_context` response using Rule 4
2. **Use BEM naming** exclusively: `.cmp-{component-name}`, `.cmp-{component-name}__{element}`
3. **Preserve exact Figma values** for:
   - Colors (hex values — no substitution)
   - Font families (with proper fallback stacks from Rule 4)
   - Font sizes (exact px values from Figma)
   - Font weights (numeric values)
   - Line heights (exact px values)
   - Spacing: padding, margin (exact px values)
   - Border radius (round decimals to nearest integer)
   - Border widths and colors
4. **Add interactive states** (hover, focus, active) — use a darker shade for hover, focus outline for accessibility
5. **Add responsive breakpoints** at minimum 768px (tablet) and 1024px (desktop)
6. **Add empty/authoring state** CSS (`.cmp-{component-name}--empty`)

### CSS File Structure

Follow the template in `clientlib-patterns.md`. Add a header comment referencing the Figma node ID and key colors. Organize sections in this order: Block → Elements (DOM order) → Interactive states → Empty state → Responsive breakpoints (768px, 1024px).

### Pixel-Perfect Fidelity Checklist

Before finalizing CSS, verify against the Figma screenshot:

- [ ] Colors, font families, font sizes, font weights, and line heights match exactly
- [ ] Spacing (padding/margin), border radius, border widths/colors match
- [ ] Layout direction matches (flex row vs column, grid)
- [ ] Elements with Figma-derived dimensions use `box-sizing: border-box` so rendered size matches the design spec
- [ ] No Tailwind classes or React inline styles remain
- [ ] Interactive states (hover, focus) are present for all clickable elements
- [ ] Responsive breakpoints (768px, 1024px) are included

---

## Rule 7: Place JS in Component Clientlib (When Needed)

Create component JavaScript **ONLY** when the Figma design implies interactivity beyond CSS (e.g., toggles, carousels, accordions, tabs, scroll behaviors, form validation). **Do NOT** create JS for simple hover effects, CSS transitions, or static content.

### File Location

```
ui.apps/src/main/content/jcr_root/apps/[project]/clientlibs/clientlib-{component-name}/js/{component-name}.js
```

### When JS is Created, Also Update

1. Add `js.txt` in the clientlib folder (contents: `#base=js` + `{component-name}.js`)
2. Include JS in HTL: `<sly data-sly-call="${clientlib.js @ categories='[project].components.{component-name}'}"/>`

### JS Pattern

Follow the standard AEM component JS pattern using the `data-cmp-is` selector:

```javascript
(function() {
    'use strict';

    var COMPONENT_SELECTOR = '[data-cmp-is="{component-name}"]';

    function init(element) {
        if (!element || element.dataset.cmpInitialized) return;
        element.dataset.cmpInitialized = 'true';
        // Bind events and initialize behavior
    }

    document.addEventListener('DOMContentLoaded', function() {
        document.querySelectorAll(COMPONENT_SELECTOR).forEach(init);
    });
})();
```

---

## Rule 8: Handle Figma Image Assets

### Temporary URLs

Image and SVG assets returned by `get_design_context` are stored on Figma's CDN
and **expire after 7 days**. These are placeholder references only.

### Rules

1. **NEVER hardcode** Figma asset URLs into HTL templates, CSS, or JS
2. **Use Sling Model properties** to reference DAM assets in HTL: `${model.image}`
3. **Dialog pathfields** (with `rootPath="/content/dam"`) allow authors to select real DAM images at runtime
4. **For icons/SVGs** embedded in the design:
   - If the SVG is simple, extract the SVG markup and inline it directly in HTL
   - If the SVG is complex, store as a static file in the component folder (e.g., `icon.svg`) and reference via `data-sly-resource`
5. **For background images** in the design:
   - Map to a dialog pathfield so authors can configure the DAM asset
   - In CSS, use the Sling Model property to inject the background: apply via inline style in HTL (`style="background-image: url('${model.backgroundImage}');"`) or use a dedicated CSS class

---

## Rule 9: Verification and Quality Gates

### Post-Creation Verification

After generating all component files from a Figma design, verify:

1. **Visual comparison**: Compare the Figma screenshot against the generated HTML structure — every visual element must have a corresponding HTL element and CSS class
2. **CSS completeness**: Every visible element in the Figma screenshot has corresponding CSS rules
3. **No React artifacts**: No JSX syntax (`className`, `{variable}`, `&&`, `.map()`), Tailwind classes, or React patterns remain in any file
4. **No absolute positioning for layout**: All layout uses flexbox or grid (not absolute pixel offsets from Figma)
5. **BEM naming**: All CSS classes follow `.cmp-{component-name}__{element}` pattern
6. **HTL correctness**: All dynamic content uses proper Sling Model expressions (`${model.*}`) with correct XSS contexts
7. **Responsive design**: At least two breakpoints (768px, 1024px) are included, even if Figma only shows one viewport
8. **Accessibility**: `alt` attributes on images, `aria-label` on buttons/links, visible focus outlines
9. **Image handling**: No Figma temporary URLs — all images use Sling Model properties backed by dialog pathfields

### Figma-to-AEM File Mapping Summary

| Figma Output | AEM Destination File |
|--------------|---------------------|
| JSX structure (semantic elements) | `{component-name}.html` (HTL template) |
| Tailwind inline styles (colors, fonts, spacing) | `clientlib-{component-name}/css/{component-name}.css` |
| Interactive behavior hints | `clientlib-{component-name}/js/{component-name}.js` (only if needed) |
| Image asset URLs | Dialog pathfield → Sling Model property → `${model.image}` in HTL |
| Component hierarchy and structure | Sling Model properties + HTL conditional rendering |
| Design token variables (if Figma variables are used) | CSS custom properties or direct values |

