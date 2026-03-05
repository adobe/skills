# Universal Editor Troubleshooting

## Overview

Common issues when blocks don't work correctly in Universal Editor and their solutions.

## Critical Concepts

### Understanding Universal Editor Data Storage

**Universal Editor stores field values in `data-aue-prop` dataset attributes, NOT as visible DOM text.**

This is the MOST COMMON source of bugs when blocks work in production but break in Universal Editor.

**The Pattern:**
```javascript
// ❌ WRONG: Only reads production content
const value = col.textContent.trim();

// ✅ CORRECT: Universal Editor first, fallback to production
const value = col.dataset.aueProp || getColContent(col);
```

**Why this matters:**
- SELECT fields: Value in `data-aue-prop`, DOM text often empty
- TEXT fields: Value in `data-aue-prop`, DOM may show placeholder
- REFERENCE fields: URL in `data-aue-prop`, DOM shows preview
- BOOLEAN fields: "true"/"false" string in `data-aue-prop`

**Complete extraction helper:**
```javascript
function getColValue(col) {
  // Priority 1: Universal Editor dataset attribute
  if (col.dataset.aueProp) {
    return col.dataset.aueProp.trim();
  }
  
  // Priority 2: Nested content (production, or UE without dataset)
  const nested = col.querySelector('div, p, span');
  if (nested) {
    return nested.textContent.trim();
  }
  
  // Priority 3: Direct text content
  return col.textContent.trim();
}

// Use for ALL field value extraction
const platform = getColValue(cols[0]);
const url = getColValue(cols[1]);
const label = getColValue(cols[2]);
```

**Key points:**
- ALWAYS check `col.dataset.aueProp` first
- This is required for blocks to work in Universal Editor
- Production content doesn't have `data-aue-prop`, so fallback is necessary
- Boolean fields return string "true" or "false", not actual booleans
- Empty `data-aue-prop` means field not yet set by author

**Testing both modes:**
```javascript
// Test 1: Production content (no data-aue-prop)
document.body.innerHTML = `
  <div class="block">
    <div><div>facebook</div></div>
  </div>
`;

// Test 2: Universal Editor content (data-aue-prop present)
document.body.innerHTML = `
  <div class="block">
    <div data-aue-prop="facebook"></div>
  </div>
`;
```

**Commit reference:** The social-media-block was completely broken in Universal Editor because it only read `textContent`, never checking `dataset.aueProp`. After adding this pattern, all fields loaded correctly.

## Problem-Solution Catalog

### Problem: Platform/Item Name Not Showing in Content Tree

**Symptom:** Universal Editor Content Tree shows generic "Item" or block type name instead of meaningful labels (e.g., "Facebook", "Instagram")

**Root Cause:** Universal Editor uses the `name` field from your JSON model to auto-label items in the sidebar Content Tree.

**Solution:**
```json
{
  "id": "social-media-platform",
  "fields": [
    {
      "component": "select",
      "name": "name",  // ✅ CRITICAL: Use "name" for Content Tree display
      "label": "Platform",
      "valueType": "string",
      "required": true,
      "value": "",
      "options": [
        { "name": "Facebook", "value": "facebook" },
        { "name": "Instagram", "value": "instagram" }
      ]
    }
  ]
}
```

**Key points:**
- Field MUST be named `name` (not `platform`, `title`, `label`)
- Universal Editor reads this field's value for sidebar labels
- Without this, items show generic labels making authoring confusing
- The `description` property on the field can explain this is for Content Tree display

**Example:** Social media block uses `name` field with platform select → sidebar shows "Facebook", "Instagram" instead of "Social Media Platform"

### Problem: data-aue-label Contains Default Text

**Symptom:** JavaScript reads `row.dataset.aueLabel` and gets "Social Media Platform" or block type name instead of actual platform value

**Root Cause:** Universal Editor sets `data-aue-label` with the item definition `title` when items are first created, BEFORE authors select a value.

**Solution - Multi-Layer Detection:**
```javascript
function parsePlatformItem(row) {
  const cols = Array.from(row.children);
  const hasAueResource = row.hasAttribute('data-aue-resource');
  
  // Layer 1: Try to read from first column content
  let platform = getColContent(cols[0]).toLowerCase();
  
  // Layer 2: Check data-aue-label, but ignore default text
  if (!platform && hasAueResource) {
    const aueLabel = (row.dataset.aueLabel || '').toLowerCase();
    if (aueLabel && aueLabel !== 'social media platform') {  // ✅ Ignore default
      platform = aueLabel;
    }
  }
  
  // Layer 3: Fallback detection (URL parsing, etc.)
  if (!platform) {
    // ... fallback logic
  }
  
  return platform;
}
```

**Key points:**
- ALWAYS check if `data-aue-label` matches your item definition `title` text
- Treat default text same as empty/missing value
- Use lowercase comparison for robustness: `aueLabel.toLowerCase() !== 'your item title'.toLowerCase()`
- Implement fallback detection layers when `data-aue-label` unreliable

### Problem: Can't Extract Values from Universal Editor Fields

**Symptom:** `col.textContent.trim()` returns empty string even though field has value

**Root Cause:** Universal Editor wraps field values in nested tags - not just `<div>`, but also `<p>`, `<span>`, or other elements

**Solution - Robust Content Extraction:**
```javascript
const getColContent = (col) => {
  // Check for nested content first (Universal Editor pattern)
  const nested = col.querySelector('div, p, span');
  return nested ? nested.textContent.trim() : col.textContent.trim();
};

// Use for all field value extraction
const platform = getColContent(cols[0]).toLowerCase();
const url = getColContent(cols[1]);
const labelOverride = getColContent(cols[2]);
```

**Key points:**
- Universal Editor may wrap values in `<p>` tags (not just `<div>`)
- ALWAYS check for nested elements before reading `textContent`
- Create helper function for consistent extraction across all columns
- Test both Universal Editor authored content AND programmatically created content

**Lesson Learned:** The social-media-block initially only checked `<div>` and failed to extract values from `<p>` tags, causing blank platforms.

### Problem: Select Field Has No Default Value

**Symptom:** JSON schema with select field but no `value` property causes serialization errors or unexpected behavior

**Root Cause:** Universal Editor requires explicit `value` property for proper field initialization, even if value is empty string

**Solution:**
```json
{
  "component": "select",
  "name": "name",
  "label": "Platform",
  "valueType": "string",
  "required": true,
  "value": "",  // ✅ CRITICAL: Always provide default, even empty string
  "options": [
    { "name": "Facebook", "value": "facebook" },
    { "name": "Instagram", "value": "instagram" }
  ]
}
```

**Key points:**
- Select fields MUST have `value` property
- Use empty string `""` for "no selection" state
- Required fields still need `value: ""` - required means "must be set before publish"
- Missing `value` causes serialization issues in Universal Editor

**Commit reference:** `5d7ca23` - "Fix: Add empty default value to name field for proper serialization"

### Problem: Block Shows Broken/Empty State in Universal Editor

**Symptom:** Newly added items in Universal Editor show as broken, empty, or with missing icons

**Root Cause:** Configuration fields not yet filled by author, but block JavaScript expects complete data

**Solution - Placeholder Pattern:**
```javascript
// Detect incomplete/placeholder state
const isPlaceholder = !platform || !url;

// Return placeholder data structure
if (hasAueResource && isPlaceholder) {
  return {
    platform: 'placeholder',
    url: '#',
    label: 'Select Platform',
    isPlaceholder: true,
    // ... other fields
  };
}

// In rendering function
function createPlatformLink(item) {
  const listItem = document.createElement('li');
  listItem.className = `social-media-block-item platform-${item.platform}`;
  
  if (item.isPlaceholder) {
    listItem.classList.add('is-placeholder');  // ✅ Style differently
  }
  
  // Use placeholder icon if custom icon missing
  const iconUrl = item.customIconUrl || 
    `${window.hlx.codeBasePath}/blocks/social-media-block/icons/${item.platform}.svg`;
  
  // ...
}
```

**CSS for placeholder state:**
```css
.social-media-block-item.is-placeholder {
  opacity: 0.5;
  pointer-events: none; /* Disable clicks in edit mode */
  border: 2px dashed var(--color-info-300);
}

.social-media-block-item.is-placeholder::after {
  content: 'Configure Platform';
  position: absolute;
  /* ... styling ... */
}
```

**Key points:**
- ALWAYS handle incomplete data when `data-aue-resource` present
- Use `is-placeholder` class for visual distinction
- Provide fallback icon (e.g., `placeholder.svg` with hash `#` symbol)
- Don't break rendering - show helpful guidance to authors
- Test with empty Universal Editor items, not just complete data

**Example:** Social-media-block shows placeholder.svg with gray styling and "Configure Platform" text when author first adds item.

### Problem: URL-Based Fallback Detection

**Symptom:** Platform field empty but URL contains obvious platform domain (e.g., `facebook.com`)

**Solution - Intelligent URL Parsing:**
```javascript
// Layer 3: Parse platform from URL as fallback
if (!platform) {
  const urlText = getColText(cols[1]);
  if (urlText) {
    // Match common social media domains
    const urlMatch = urlText.match(/(?:https?:\/\/)?(?:www\.)?([a-z]+)\./i);
    if (urlMatch) {
      const detectedPlatform = urlMatch[1].toLowerCase();
      // Validate against known platforms
      if (PLATFORM_DEFAULTS[detectedPlatform]) {
        platform = detectedPlatform;
      }
    }
  }
}
```

**Key points:**
- URL parsing is FALLBACK, not primary detection
- Only use for known/supported platforms (check against whitelist)
- Handle variations: `http://`, `https://`, `www.`, no protocol
- Case-insensitive matching: `.toLowerCase()`
- Don't assume URL format - validate match exists

**Commit reference:** `c2be40b` - "Add URL-based platform detection as fallback"

### Problem: Icon Reference vs Actual File

**Symptom:** Block JavaScript references icon like `icon-facebook` but actual file is `facebook.svg`

**Solution - Consistent Icon Naming:**
```javascript
// Option 1: Use decorateIcons() for automatic loading
import { decorateIcons } from '../../scripts/aem.js';

// In your block HTML
<span class="icon icon-facebook"></span>

decorateIcons(block);  // Auto-loads /icons/facebook.svg

// Option 2: Manual icon loading with consistent paths
const iconUrl = item.customIconUrl || 
  `${window.hlx.codeBasePath}/blocks/${blockName}/icons/${item.platform}.svg`;
```

**Key points:**
- `decorateIcons()` expects `icon-name` class → loads `/icons/name.svg`
- Block-specific icons: store in `blocks/blockname/icons/`
- Fallback pattern: custom icon → platform icon → placeholder icon
- Test icon loading with missing files (404 handling)

**Directory structure:**
```
blocks/social-media-block/
  ├── icons/
  │   ├── facebook.svg
  │   ├── instagram.svg
  │   ├── placeholder.svg  ← Fallback for unknown platforms
  ├── social-media-block.js
  ├── social-media-block.css
  └── _social-media-block.json
```

## Testing Checklist for Universal Editor Integration

When developing blocks with Universal Editor, test these scenarios:

- [ ] **Empty item** - Add item in Universal Editor, don't fill any fields
- [ ] **Partial data** - Fill only required fields, leave optional empty
- [ ] **Default text** - Verify `data-aue-label` handling when item first created
- [ ] **Content Tree labels** - Check sidebar shows meaningful names (requires `name` field)
- [ ] **Nested content** - Verify extraction from `<p>`, `<div>`, `<span>` tags
- [ ] **Select field defaults** - Confirm `value: ""` in JSON for proper initialization
- [ ] **Placeholder state** - Visual indication when config incomplete
- [ ] **Fallback detection** - URL parsing or other fallbacks work correctly
- [ ] **Icon loading** - Custom, platform, and placeholder icons all render
- [ ] **Re-open for editing** - Save item, close, re-open - values persist correctly
