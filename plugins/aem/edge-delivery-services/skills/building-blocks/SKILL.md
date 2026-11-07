---
name: building-blocks
description: "Use this when implementing code changes in AEM Edge Delivery Services (EDS, Franklin, Helix), whether new or modified blocks, core functionality (scripts.js, styles, delayed.js, etc.), or both. Creates and modifies block folders and decorate functions, updates core scripts, scopes CSS, and wires up delayed loading. For the overall development process use content-driven-development."
license: Apache-2.0
metadata:
  version: "2.0.2"
---

# Building Blocks

This skill guides you through implementing AEM Edge Delivery blocks following established patterns and best practices. Blocks transform authored content into rich, interactive experiences through JavaScript decoration and CSS styling.

**IMPORTANT: This skill should ONLY be invoked from the content-driven-development skill during Step 5 (Implementation).**

If you are not already following the CDD process, STOP and invoke the **content-driven-development** skill first.

## Related Skills

- **content-driven-development**: MUST be invoked before using this skill to ensure content and content models are ready
- **da-auth**: Obtain a valid Adobe IMS token if test content needs to be pushed to DA before implementation can begin
- **block-collection-and-party**: Use to find similar blocks for patterns
- **testing-blocks**: Automatically invoked during Step 5 for comprehensive testing

## When to Use This Skill

This skill is invoked automatically by **content-driven-development** during Step 5 (Implementation). It handles:

**Block Development:**
- Creating new block files and structure
- Implementing JavaScript decoration
- Adding CSS styling

**Core Functionality:**
- Scripts.js modifications (decoration, utilities, auto-blocking)
- Global styles (styles.css, lazy-styles.css)
- Delayed functionality (delayed.js)
- Configuration changes

**Combined:**
- Blocks with supporting core changes (utilities, global styles, etc.)

Prerequisites (verified by CDD):
- ✅ Test content exists (in CMS or local drafts)
- ✅ Content model is defined/documented (if applicable)
- ✅ Test content URL is available
- ✅ Dev server is running

## Block Implementation Workflow

Track your progress:
- [ ] Step 1: Find similar blocks for patterns (if new block or major changes)
- [ ] Step 2: Create or modify block structure (files and directories)
- [ ] Step 3: Implement JavaScript decoration (skip if CSS-only)
- [ ] Step 4: Add CSS styling
- [ ] Step 5: Test implementation (invokes testing-blocks skill)

**Note:** If your changes require core modifications (utilities in scripts.js, global styles, etc.), make those changes first, test them, then return to this workflow. See "When Modifying Core Files" below.

## Step 1: Find Similar Blocks

**When to use:** Creating new blocks or making major structural modifications

**Skip this step when:** Making minor modifications to existing blocks (CSS tweaks, small decoration changes)

**Quick start:**

1. Search the codebase for similar blocks:
   ```bash
   ls blocks/
   ```

2. Use the **block-collection-and-party** skill to find reference implementations

3. Review patterns from similar blocks:
   - DOM manipulation strategies
   - CSS architecture
   - Variant handling
   - Performance optimizations

## Step 2: Create or Modify Block Structure

### For New Blocks:

1. Create the block directory and files:
   ```bash
   mkdir -p blocks/{block-name}
   touch blocks/{block-name}/{block-name}.js
   touch blocks/{block-name}/{block-name}.css
   ```

2. Basic JavaScript structure:
   ```javascript
   /**
    * decorate the block
    * @param {Element} block the block
    */
   export default async function decorate(block) {
     // Your decoration logic here
   }
   ```

3. Basic CSS structure:
   ```css
   /* All selectors scoped to block */
   .{block-name} {
     /* block styles */
   }
   ```

### For Existing Blocks:

1. Locate the block directory: `blocks/{block-name}/`
2. Review current implementation:
   ```bash
   # View the initial HTML structure from the server
   curl http://localhost:3000/{test-content-path}
   ```
3. Understand existing decoration logic and styles

## Step 3: Implement JavaScript Decoration

Follow the project's existing blocks and lint rules. Easy to get wrong:

- **Move, don't copy:** move the delivered pictures, headings, paragraphs and links into the new structure. Copying their text or src into new elements, or rebuilding them with `innerHTML`, loses heading ids, image sizes and Universal Editor `data-aue-*` attributes.
- **Cells vary:** authors leave cells out and add extra ones. Find content by what it is (e.g. the cell with a `picture`), not by index alone.
- **Don't hold up the section:** a section stays hidden until all its blocks are decorated, and the first section gates LCP. Don't await slow fetches, large imports or third-party embeds in `decorate()`; load them with dynamic `import()` when the block comes into view (IntersectionObserver) or on interaction. Reserve their space up front (placeholder with the final size, e.g. `aspect-ratio`) so late content doesn't shift the layout (CLS).
- **aem.js:** vendored, never edit it. Import its helpers (`createOptimizedPicture`, `readBlockConfig`, `loadScript`, ...) from `../../scripts/aem.js`; project helpers go in `scripts/`.

## Step 4: Add CSS Styling

Follow the project's existing block CSS and lint rules. Easy to get wrong:

- **Page grid:** global styles set max-width, centering and inline padding on `main > .section > div`. Don't override them on the block. For outer layout like a full-bleed background, target `.{block-name}-container` (the section) or `.{block-name}-wrapper` (the block's parent), not `100vw` or `calc(50% - 50vw)`.
- **Platform classes:** aem.js adds `{block-name}-wrapper` and `{block-name}-container`. Don't reuse those names inside the block.
- **Embeds:** sites embedded with aem-embed load styles.css into a shadow root, so global custom properties go on `:root, :host`.

**Note on iterative validation:** While building, you can test changes in your browser as you go (load test content URL, check console, verify layout and functionality). For comprehensive testing guidance including browser testing techniques, responsive testing, and validation approaches, see the testing-blocks skill invoked in Step 5.

## Step 5: Test Implementation

**After implementation is complete, invoke the testing-blocks skill.**

The testing-blocks skill will guide you through:
- Browser testing (functionality, responsive behavior across viewports)
- Linting and fixing issues
- Writing unit and browser tests where they pay off, with the project's own test tools
- Screenshot capture for validation
- Performance validation

**Provide the testing-blocks skill with:**
- Block name being tested
- Test content URL(s) (from step 4 of CDD process)
- Any variants that need testing
- Screenshots of existing implementation/design/mockup to verify against
- Acceptance criteria to verify (from step 2 of CDD process)

**After testing is complete, return to CDD workflow.**

---

## When Modifying Core Files

If your changes require modifying core files (scripts.js, styles.css, delayed.js), follow these principles:

**Common core files:**
- **scripts.js** - Decoration utilities, auto-blocking logic, page loading
- **styles.css** - Global styles (eager), CSS custom properties
- **lazy-styles.css** - Global styles (lazy loaded)
- **delayed.js** - Marketing, analytics, third-party integrations

**Key principles:**

1. **Make core changes first** (before block changes that depend on them)
2. **Test core changes independently** with existing content before using in blocks
3. **Consider impact** - core changes can affect multiple blocks/pages
4. **Test thoroughly** - verify no regressions in existing functionality
5. **Keep it minimal** - only add what's necessary
6. **Document with code comments** - most core changes don't need separate docs

**Testing core changes:**
- Test with existing content URLs that use affected functionality
- For auto-blocking: test pages that should/shouldn't trigger it
- For global styles: test across multiple blocks and pages
- Check console for errors
- Verify responsive behavior
