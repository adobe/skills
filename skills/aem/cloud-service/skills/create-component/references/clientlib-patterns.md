# Client Library Patterns for AEM Components

Patterns for creating AEM client-side libraries (clientlibs) following Adobe best practices.

---

## MANDATORY: Every Component Needs CSS

**MUST CREATE** a runtime clientlib with CSS for EVERY AEM component that has UI rendering.

**When creating a component:**
1. ALWAYS create `clientlib-{component-name}/` with CSS
2. ALWAYS analyze mockup images to extract visual requirements
3. ALWAYS include base styles, responsive breakpoints, and accessibility CSS
4. NEVER skip CSS unless component has zero UI output

---

## File Structure

### Component Clientlib
```
ui.apps/src/main/content/jcr_root/apps/[project]/clientlibs/clientlib-{component-name}/
├── .content.xml
├── css.txt
├── css/
│   └── {component-name}.css
└── js/ (optional)
    └── {component-name}.js
```

### Dialog Clientlib (for custom validation)
```
ui.apps/src/main/content/jcr_root/apps/[project]/clientlibs/clientlib-{component-name}-dialog/
├── .content.xml
├── js.txt
└── js/
    └── {component-name}-dialog.js
```

---

## Configuration Files

### Component Clientlib .content.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0"
          xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:ClientLibraryFolder"
    categories="[[project].components.{component-name}]"
    allowProxy="{Boolean}true"/>
```

### Dialog Clientlib .content.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0"
          xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:ClientLibraryFolder"
    categories="[[project].{component-name}.dialog]"
    dependencies="[cq.authoring.dialog]"/>
```

### css.txt
```
#base=css
{component-name}.css
```

### js.txt
```
#base=js
{component-name}.js
```

---

## CSS Architecture (BEM)

### Basic Template
```css
/**
 * Component: {component-name}
 */

/* Base component styles */
.cmp-{component-name} {
    display: block;
    position: relative;
}

/* Element: Title */
.cmp-{component-name}__title {
    margin-bottom: 1rem;
    font-size: 1.5rem;
}

/* Element: Content */
.cmp-{component-name}__content {
    padding: 1rem;
}

/* Element: List */
.cmp-{component-name}__list {
    list-style: none;
    padding: 0;
    margin: 0;
}

.cmp-{component-name}__item {
    margin-bottom: 0.5rem;
}

/* Element: Link */
.cmp-{component-name}__link {
    text-decoration: none;
    color: inherit;
    transition: all 0.3s ease;
}

.cmp-{component-name}__link:hover,
.cmp-{component-name}__link:focus {
    text-decoration: underline;
    outline: 2px solid currentColor;
    outline-offset: 2px;
}

/* Modifier: Empty state */
.cmp-{component-name}--empty {
    border: 2px dashed #ccc;
    padding: 1rem;
    text-align: center;
    color: #666;
}

/* Responsive: Tablet */
@media (min-width: 768px) {
    .cmp-{component-name} {
        padding: 1.5rem;
    }

    .cmp-{component-name}__title {
        font-size: 2rem;
    }
}

/* Responsive: Desktop */
@media (min-width: 1024px) {
    .cmp-{component-name} {
        padding: 2rem;
    }
}
```

### BEM Naming
```
.cmp-{component}           - Block (component root)
.cmp-{component}__{element} - Element (child)
.cmp-{component}--{modifier} - Modifier (variant)
```

---

## CSS Checklist

Every component CSS MUST include:
- [ ] Base component class (`.cmp-{component-name}`)
- [ ] Element classes for all major DOM elements
- [ ] Hover and focus states for interactive elements
- [ ] Empty state styling for authoring mode
- [ ] At least 2 responsive breakpoints (768px, 1024px)
- [ ] Accessibility: focus outlines, color contrast

---

## Including Clientlib in HTL

```html
<sly data-sly-use.clientlib="/libs/granite/sightly/templates/clientlib.html">
    <sly data-sly-call="${clientlib.css @ categories='[project].components.{component-name}'}"/>
</sly>
```

---

## JavaScript Pattern

### Component Runtime JS
```javascript
(function() {
    'use strict';

    window.MYSITE = window.MYSITE || {};
    window.MYSITE.Components = window.MYSITE.Components || {};

    window.MYSITE.Components.ComponentName = {
        selectors: {
            self: '[data-cmp-is="componentname"]',
            button: '.cmp-componentname__button'
        },

        init: function(element) {
            if (!element) return;
            if (element.dataset.cmpInitialized) return;
            element.dataset.cmpInitialized = 'true';

            this.setupEventListeners(element);
        },

        setupEventListeners: function(element) {
            var button = element.querySelector(this.selectors.button);
            if (button) {
                button.addEventListener('click', this.handleClick.bind(this, element));
            }
        },

        handleClick: function(element, event) {
            event.preventDefault();
            // Handle click
        }
    };

    // Auto-initialize
    document.addEventListener('DOMContentLoaded', function() {
        var components = document.querySelectorAll(
            window.MYSITE.Components.ComponentName.selectors.self
        );
        components.forEach(function(element) {
            window.MYSITE.Components.ComponentName.init(element);
        });
    });
})();
```

---

## Dialog JavaScript Pattern

> **CRITICAL**: Coral UI components render asynchronously. You MUST use `foundation-contentloaded` 
> (not `dialog-ready`) and the Foundation Field API for reliable field manipulation.

```javascript
/**
 * Dialog clientlib for conditional field validation
 * Category: [project].{component-name}.dialog
 * 
 * IMPORTANT: 
 * - Use "foundation-contentloaded" event (fires AFTER Coral UI components are rendered)
 * - Use adaptTo("foundation-field").setDisabled() for proper Granite UI field control
 * - Apply granite:class directly to the input field element in dialog XML
 */
(function(document, $) {
    "use strict";

    /**
     * Selector for the controlling field (e.g., link text input)
     * NOTE: granite:class must be on the textfield node in dialog XML
     */
    var LINK_TEXT_SELECTOR = ".cmp-componentname__link-text";
    
    /**
     * Selector for the dependent field (e.g., link URL pathfield)
     */
    var LINK_URL_SELECTOR = ".cmp-componentname__link-url";

    /**
     * Toggle the disabled state of dependent field based on controlling field value
     */
    function toggleDependentField($controlField, $dependentField) {
        var controlValue = $controlField.val();
        
        if (controlValue && controlValue.trim().length > 0) {
            // Enable the dependent field
            $dependentField.prop("disabled", false);
            $dependentField.adaptTo("foundation-field").setDisabled(false);
        } else {
            // Disable the dependent field
            $dependentField.prop("disabled", true);
            $dependentField.adaptTo("foundation-field").setDisabled(true);
        }
    }

    /**
     * Initialize dialog functionality when dialog content is fully loaded
     * NOTE: "foundation-contentloaded" fires AFTER Coral UI components are rendered,
     * unlike "dialog-ready" which may fire before inputs exist in the DOM
     */
    $(document).on("foundation-contentloaded", function(e) {
        var $dialog = $(e.target);
        
        // Find all multifield items in the dialog
        $dialog.find("coral-multifield-item").each(function() {
            var $multifieldItem = $(this);
            var $controlField = $multifieldItem.find(LINK_TEXT_SELECTOR);
            var $dependentField = $multifieldItem.find(LINK_URL_SELECTOR);
            
            if ($controlField.length && $dependentField.length) {
                // Set initial state
                toggleDependentField($controlField, $dependentField);
                
                // Listen for changes on controlling field
                $controlField.on("input change", function() {
                    toggleDependentField($controlField, $dependentField);
                });
            }
        });
    });

    /**
     * Handle multifield add event - initialize new items
     */
    $(document).on("coral-collection:add", function(e) {
        var $addedItem = $(e.target);
        
        // Check if this is a multifield item
        if ($addedItem.is("coral-multifield-item")) {
            var $controlField = $addedItem.find(LINK_TEXT_SELECTOR);
            var $dependentField = $addedItem.find(LINK_URL_SELECTOR);
            
            if ($controlField.length && $dependentField.length) {
                // Set initial state for new item
                toggleDependentField($controlField, $dependentField);
                
                // Listen for changes on controlling field
                $controlField.on("input change", function() {
                    toggleDependentField($controlField, $dependentField);
                });
            }
        }
    });

})(document, Granite.$);
```

### Key Requirements

- **MUST** use `foundation-contentloaded` event (NOT `dialog-ready`) - ensures Coral UI is fully rendered
- **MUST** use `adaptTo("foundation-field").setDisabled()` for proper Granite UI field enable/disable
- **MUST** use `Granite.$` for jQuery in AEM dialogs
- **MUST** listen for `coral-collection:add` for multifield support
- **SHOULD** use BEM-style class names (e.g., `.cmp-componentname__field-name`)
- **SHOULD** apply `granite:class` directly to the field node in dialog XML

### Dialog XML Example

Correct `granite:class` placement on field nodes:

```xml
<linkText
    jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
    fieldLabel="Link Text"
    name="./linkText"
    granite:class="cmp-componentname__link-text"/>
<linkURL
    jcr:primaryType="nt:unstructured"
    sling:resourceType="granite/ui/components/coral/foundation/form/pathfield"
    fieldLabel="Link URL"
    name="./linkURL"
    granite:class="cmp-componentname__link-url"/>
```

---

## Clientlib Types Summary

| Type | Category Pattern | allowProxy | Loads On | Included Via |
|------|------------------|------------|----------|--------------|
| **Component** | `[project].components.{name}` | Yes | Author + Publish | HTL |
| **Dialog** | `[project].{name}.dialog` | No | Author dialog only | `extraClientlibs` |

---

## Mockup Analysis Workflow

**If mockup/image provided:**
1. Identify layout structure (flexbox, grid, block)
2. Extract spacing values (padding, margins)
3. Note typography (font sizes, weights, colors)
4. Identify interactive states (hover, focus, active)
5. Check for responsive variations

**If no mockup:**
1. Create basic structural CSS
2. Include focus/hover states
3. Add responsive breakpoints
