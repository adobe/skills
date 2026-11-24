# Developer Guide Template

Use this structure when generating `project-guides/DEVELOPER-GUIDE.md`. Replace all placeholders with project-specific values gathered during analysis phases.

---

```markdown
---
title: "[Project Name] - Developer Guide"
date: "[Full Date — e.g., February 17, 2026]"
---

# [Project Name] - Developer Guide

## Quick Reference

| Resource | URL |
|----------|-----|
| Code Repository | {code.owner}/{code.repo} |
| Preview | https://main--{repo}--{owner}.aem.page/ |
| Live | https://main--{repo}--{owner}.aem.live/ |
| Local Dev | http://localhost:3000 |

## Architecture Overview

### Tech Stack
- Vanilla JavaScript (ES6+)
- CSS3 with Custom Properties
- No build step — files served directly
- Content from Document Authoring (DA)

### Project Structure
```
├── blocks/           # [X] blocks implemented
├── templates/        # [Y] templates (or N/A)
├── scripts/
│   ├── aem.js        # Core library (DO NOT MODIFY)
│   ├── scripts.js    # Custom page decoration
│   ├── consent-check.js # Loads consented.js once the visitor consents
│   ├── consented.js  # Analytics, marketing tools (older projects: delayed.js)
│   └── utils.js      # Shared utilities
├── styles/
│   ├── styles.css    # Critical styles + design tokens
│   ├── fonts.css     # Font definitions
│   └── lazy-styles.css # Non-critical styles
└── icons/            # SVG icons
```

### Three-Phase Loading (E-L-D)

Edge Delivery Services uses a strict Eager-Lazy-Delayed loading strategy to achieve a Lighthouse score of 100.

| Phase | Purpose | What Loads | Performance Impact |
|-------|---------|------------|-------------------|
| **Eager** | Render above-the-fold content (LCP) | `styles/styles.css`, first section's blocks, `scripts/scripts.js` | Blocks LCP — keep minimal |
| **Lazy** | Load remaining content after first paint | Remaining blocks, header, footer, `fonts.css`, `lazy-styles.css` | Runs after Eager — safe for non-critical UI |
| **Delayed** | Load non-essential third-party scripts | `loadDelayed()` in `scripts/scripts.js` imports `consent-check.js`, which loads `consented.js` (analytics, marketing, chat) once the visitor consents. Older projects: `scripts/delayed.js` | Runs after the lazy phase — never blocks rendering |

Rules: Never add third-party scripts to the eager or lazy phases: analytics and marketing go in `consented.js` (older projects: `delayed.js`). Never load fonts eagerly. Blocks in the first section load eagerly; all others load lazily.

### Key Files

| File | Role |
|------|------|
| `scripts/aem.js` | Core library — `loadBlock`, `loadCSS`, `decorateBlock`, `sampleRUM`, `loadHeader`/`loadFooter`. DO NOT MODIFY. |
| `scripts/scripts.js` | Entry point — orchestrates E-L-D phases, `buildAutoBlocks`, `decorateMain`, template loading |
| `scripts/consent-check.js` | Loaded by `loadDelayed()`; loads `consented.js` after consent |
| `scripts/consented.js` | Analytics, marketing tags, third-party scripts, only after consent (older projects: `scripts/delayed.js`, loaded last without a consent check) |
| `scripts/utils.js` | Shared helpers used across blocks and scripts |
| `styles/styles.css` | Critical CSS + design tokens. Loaded eagerly. |
| `styles/fonts.css` | Font `@font-face` declarations. Loaded lazily. |
| `blocks/{name}/{name}.js` | Block logic — exports `default function decorate(block)`. Auto-loaded when class appears in DOM. |
| `templates/{name}/{name}.js` | Template logic — loaded when page metadata has matching `template` value. |

## Local Development Setup

### Prerequisites
- Node.js [version from .nvmrc]
- AEM CLI: `npm install -g @adobe/aem-cli`

### Setup Steps
```bash
git clone {code-repo-url}
cd {repo}
npm install
aem up
```

### Local Server
- URL: http://localhost:3000
- Auto-reload on file changes

[If repoless/multi-site detected in Phase 1.3, include this subsection:]

### Local Server — Repoless/Multi-Site

For repoless setups, specify the site's preview URL when starting:

```bash
aem up --pages-url=https://main--{site}--{org}.aem.page
```

Without `--pages-url`, the AEM CLI cannot resolve content for the correct site.

[End conditional subsection]

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
| [block-name] | [What it does] | `variant1`, `variant2` | [Important details] |

[Generate one row per customized block]

## Templates

| Template | Purpose | Applied Via | Special Behavior |
|----------|---------|-------------|------------------|
| [template-name] | [What type of pages] | `template: [name]` | [What it does differently] |

[Generate one row per customized template]

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
1. Add to `scripts/consented.js` (older projects: `scripts/delayed.js`)
2. Never add to the eager or lazy phases (blocks performance)
3. Test with the Network tab that it loads last, and only after consent (`?consent=accept` with the boilerplate's placeholder check)

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

| Issue | Check |
|-------|-------|
| Block not loading | Folder name matches class name? JS exports `default function decorate`? 404s in Network tab? |
| Styles not applying | CSS specificity? File loading? Syntax errors? |
| Content not updating | Browser cache cleared? Preview triggered in DA? CDN cache (1-2 min)? |

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
