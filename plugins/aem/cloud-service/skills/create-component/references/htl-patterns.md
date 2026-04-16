# HTL Patterns for AEM Components

Patterns for creating HTL (HTML Template Language) templates following Adobe best practices.

## Table of Contents

- [File Location](#file-location)
- [Basic Template Structure](#basic-template-structure)
- [Expression Contexts (XSS Prevention)](#expression-contexts-xss-prevention)
- [Conditional Rendering](#conditional-rendering)
  - [Simple Condition](#simple-condition)
  - [Condition with Variable](#condition-with-variable)
  - [Negation](#negation)
- [List Iteration](#list-iteration)
  - [Basic List](#basic-list)
  - [List with Custom Variable](#list-with-custom-variable)
  - [List with Index](#list-with-index)
  - [List Metadata Properties](#list-metadata-properties)
  - [Check Before Iteration](#check-before-iteration)
- [Template Blocks (Reusable)](#template-blocks-reusable)
  - [Define Template](#define-template)
  - [Use Template](#use-template)
- [Client Library Inclusion](#client-library-inclusion)
  - [CSS in Head](#css-in-head)
  - [JS at Body End](#js-at-body-end)
- [Resource Inclusion](#resource-inclusion)
  - [Include Child Component](#include-child-component)
  - [With Decoration Control](#with-decoration-control)
- [Image Handling in Components](#image-handling-in-components)
  - [Decision Tree](#decision-tree)
  - [Embedded Core Image Pattern](#embedded-core-image-pattern)
  - [Wrapper Div Pattern](#wrapper-div-pattern)
  - [Anti-Pattern: Raw Fileupload for Images](#anti-pattern-raw-fileupload-for-images)
- [Accessibility Patterns](#accessibility-patterns)
  - [Semantic HTML](#semantic-html)
  - [Image Accessibility](#image-accessibility)
- [WCM Mode Handling](#wcm-mode-handling)
- [Internationalization (i18n)](#internationalization-i18n)
  - [Basic i18n Expression](#basic-i18n-expression)
  - [i18n with Hint](#i18n-with-hint)
  - [i18n with Explicit Locale](#i18n-with-explicit-locale)
  - [When to Use i18n](#when-to-use-i18n)
  - [When NOT to Use i18n](#when-not-to-use-i18n)
  - [Sling Model i18n (Computed Strings)](#sling-model-i18n-computed-strings)
- [Complete Example: Tiles List](#complete-example-tiles-list)
- [BEM Naming Convention](#bem-naming-convention)

## File Location

```
ui.apps/src/main/content/jcr_root/apps/[project]/components/{component-name}/{component-name}.html
```

## Basic Template Structure

```html
<!--/* Component: {component-name} */-->
<sly data-sly-use.model="[package].models.ComponentNameModel"/>
<sly data-sly-test="${model.hasContent}">
    <div class="cmp-componentname" data-cmp-is="componentname">
        <!-- Component content -->
    </div>
</sly>

<!--/* Empty state for authors */-->
<sly data-sly-test="${!model.hasContent && wcmmode.edit}">
    <div class="cmp-componentname cmp-componentname--empty">
        Please configure this component
    </div>
</sly>
```

**Key elements:**

- `data-sly-use.model` - Bind Sling Model
- `data-sly-test="${model.hasContent}"` - Gate rendering
- `data-cmp-is` - JavaScript hook
- `cmp-` prefix - BEM naming

## Expression Contexts (XSS Prevention)

```html
<!--/* Text output - automatically escaped */-->
<h1>${model.title}</h1>

<!--/* HTML output - for rich text fields */-->
<div>${model.richText @ context='html'}</div>

<!--/* URL output - for internal links */-->
<a href="${model.linkUrl @ extension='html'}">${model.linkText}</a>

<!--/* Attribute output */-->
<div title="${model.tooltip @ context='attribute'}"></div>

<!--/* Image src */-->
<img src="${model.imageReference}" alt="${model.altText @ context='attribute'}"/>
```

**Context types:**

| Context | Use For |
| --- | --- |
| (default) | Plain text |
| html | Rich text content |
| attribute | HTML attributes |
| uri | URLs |
| scriptString | JavaScript strings |

**NEVER use** `@ context='unsafe'` in production.

## Conditional Rendering

### Simple Condition

```html
<h2 data-sly-test="${model.showTitle}">${model.title}</h2>
```

### Condition with Variable

```html
<sly data-sly-test.hasContent="${model.text || model.image}">
    <div data-sly-test="${hasContent}">${model.content}</div>
</sly>
```

### Negation

```html
<sly data-sly-test="${!model.hasContent && wcmmode.edit}">
    <div class="cmp-componentname--empty">Please configure</div>
</sly>
```

## List Iteration

### Basic List

```html
<ul data-sly-list="${model.items}">
    <li>${item.title}</li>
</ul>
```

### List with Custom Variable

```html
<ul data-sly-list.tile="${model.tiles}">
    <li>${tile.tileTitle}</li>
</ul>
```

### List with Index

```html
<ul data-sly-list.tile="${model.tiles}">
    <li class="${tileList.odd ? 'odd' : 'even'}">
        ${tileList.index}: ${tile.tileTitle}
    </li>
</ul>
```

### List Metadata Properties

| Property | Description |
| --- | --- |
| {var}List.index | Zero-based index |
| {var}List.count | Total items |
| {var}List.first | True if first item |
| {var}List.last | True if last item |
| {var}List.odd | True if odd index |
| {var}List.even | True if even index |

### Check Before Iteration

```html
<sly data-sly-test="${model.tiles.size > 0}">
    <ul data-sly-list.tile="${model.tiles}">
        <li>${tile.tileTitle}</li>
    </ul>
</sly>
```

## Template Blocks (Reusable)

### Define Template

```html
<template data-sly-template.card="${@ item}">
    <article class="cmp-componentname__card">
        <h3 class="cmp-componentname__card-title">${item.title}</h3>
        <p class="cmp-componentname__card-desc">${item.description}</p>
    </article>
</template>
```

### Use Template

```html
<!--/* Single use */-->
<div data-sly-call="${card @ item=model.featuredItem}"></div>

<!--/* In iteration */-->
<div data-sly-list.tile="${model.tiles}">
    <sly data-sly-call="${card @ item=tile}"></sly>
</div>
```

## Client Library Inclusion

### CSS in Head

```html
<sly data-sly-use.clientlib="/libs/granite/sightly/templates/clientlib.html">
    <sly data-sly-call="${clientlib.css @ categories='[project].components.componentname'}"/>
</sly>
```

### JS at Body End

```html
<sly data-sly-call="${clientlib.js @ categories='[project].components.componentname'}"/>
```

## Resource Inclusion

### Include Child Component

```html
<div data-sly-resource="${'childNode' @ resourceType='[project]/components/text'}"></div>
```

### With Decoration Control

```html
<div data-sly-resource="${'image' @ resourceType='[project]/components/image',
                          decorationTagName='div',
                          cssClassName='cmp-componentname__image'}"></div>
```

## Image Handling in Components

### Decision Tree

Choose the right approach based on your use case:

| Approach | When to Use |
| --- | --- |
| Embed Core Image component (recommended, ~90% of cases) | Component needs an author-managed image with cropping, responsive renditions, lazy loading, and alt text. Use data-sly-resource to embed core/wcm/components/image/v3/image. |
| Model delegation | Extending a Core Component that already has image support (e.g., Teaser, Card). The image capability comes free via the parent component — no extra work needed. |
| Pathfield + manual <img> | Only a DAM path is needed without cropping or renditions (e.g., background images, decorative references). |
| Fileupload widget | Non-image file uploads only (PDFs, documents). Not for rendering images — see anti-pattern below. |

### Embedded Core Image Pattern

This is the recommended approach for most image needs. The Core Image component handles responsive renditions, lazy loading, smart cropping, alt text, and the Adaptive Image Servlet automatically.

**Step 1: Content resource node** — Create a child resource node under the component's content node (in the component's content structure, NOT in the dialog XML). This allows the Core Image component to store its authored data:

```xml
<!-- In the component's .content.xml or via content structure -->
<image
    jcr:primaryType="nt:unstructured"
    sling:resourceType="core/wcm/components/image/v3/image"/>
```

**Step 2: HTL** — Include the image using `data-sly-resource` with a wrapper div:

```html
<div class="cmp-card__image">
    <div data-sly-resource="${'image' @ resourceType='core/wcm/components/image/v3/image'}"></div>
</div>
```

> Note: No Sling Model code is needed for the image — the Core Image component handles all rendering, responsive behavior, and DAM metadata automatically.

### Wrapper Div Pattern

When embedding child components with `data-sly-resource`, always use a wrapper div around the resource inclusion element. This is critical for page editor compatibility.

```html
<!-- WRONG — CSS class lost when page editor replaces the div during image editing -->
<div class="cmp-card__image"
     data-sly-resource="${'image' @ resourceType='core/wcm/components/image/v3/image'}"></div>

<!-- RIGHT — wrapper div preserves CSS class during page editor interactions -->
<div class="cmp-card__image">
    <div data-sly-resource="${'image' @ resourceType='core/wcm/components/image/v3/image'}"></div>
</div>
```

**Why this matters:** The AEM page editor replaces the element that has `data-sly-resource` during inline editing — for example, when the author crops an image or drags a new asset onto the component. If your CSS class is on that same element, it disappears until the page is refreshed, breaking the component's layout in the editor.

### Anti-Pattern: Raw Fileupload for Images

The `fileupload` widget is a **dialog input widget**, not a rendering solution. Do not use it with a manual `<img src>` tag to display images.

```html
<!-- WRONG — skips all Core Image benefits -->
<img src="${properties.fileReference}" alt="${properties.alt}"/>
```

This approach misses:

- **Responsive renditions** — no automatic srcset/sizes for different viewports
- **Lazy loading** — no native lazy loading support
- **Smart cropping** — no access to AEM's smart crop capabilities
- **Alt text management** — no centralized DAM alt text inheritance
- **Adaptive Image Servlet** — no optimized image delivery with width-based serving

Use the [Embedded Core Image Pattern](#embedded-core-image-pattern) instead.

## Accessibility Patterns

### Semantic HTML

```html
<article class="cmp-tile" aria-labelledby="title-${tile.id}">
    <h2 id="title-${tile.id}" class="cmp-tile__title">${tile.title}</h2>

    <a href="${tile.linkURL @ extension='html'}"
       class="cmp-tile__link"
       aria-label="${tile.linkText}">
        ${tile.linkText}
    </a>
</article>
```

### Image Accessibility

```html
<img src="${model.imageSrc}"
     alt="${model.imageAlt @ context='attribute'}"
     loading="lazy"/>
```

## WCM Mode Handling

```html
<!--/* Author mode helpers */-->
<sly data-sly-test="${wcmmode.edit}">
    <div class="cmp-componentname__author-help">Configure in dialog</div>
</sly>

<!--/* Publish only */-->
<sly data-sly-test="${wcmmode.disabled}">
    <script>/* Analytics code */</script>
</sly>
```

## Internationalization (i18n)

> **⚠️ Important:** Static display text in HTL templates (button labels, section headings, fallback text, placeholder strings) should always use the i18n expression directly in HTL, not via Sling Model getters. The HTL i18n expression integrates with AEM's translation framework automatically.

HTL provides built-in i18n support for translating static strings. Use the `@ i18n` expression option to mark text for translation.

### Basic i18n Expression

```html
<!--/* Static labels — always use i18n */-->
<button>${'Submit' @ i18n}</button>
<span class="cmp-form__label">${'Email Address' @ i18n}</span>
<p class="cmp-error__message">${'An error occurred. Please try again.' @ i18n}</p>
```

### i18n with Hint

Use `hint` to disambiguate words that have multiple meanings, giving translators context:

```html
<!--/* "Open" as a verb vs adjective */-->
<button>${'Open' @ i18n, hint='verb: to open a dialog'}</button>
<span>${'Open' @ i18n, hint='adjective: the store is open'}</span>

<!--/* "Save" could mean different things */-->
<button>${'Save' @ i18n, hint='save changes to the form'}</button>
```

### i18n with Explicit Locale

Force a specific locale instead of inheriting from the page:

```html
<span>${'Copyright' @ i18n, locale='en'}</span>
```

### When to Use i18n

Apply `@ i18n` to **static strings defined in the template**:

- Button labels: `${'Submit' @ i18n}`, `${'Cancel' @ i18n}`
- Placeholder text: `${'Search…' @ i18n}`
- Error messages: `${'This field is required' @ i18n}`
- Section headings hardcoded in the template
- Aria labels: `${'Close dialog' @ i18n}`

### When NOT to Use i18n

**Do NOT apply i18n to author-entered content** from the component dialog. That content is already localized through AEM's language copy / MSM mechanism:

```html
<!--/* CORRECT — author content, no i18n */-->
<h2>${model.title}</h2>
<div>${model.description @ context='html'}</div>

<!--/* WRONG — do not i18n model values */-->
<h2>${model.title @ i18n}</h2>
```

### Common Mistake: Static Text in Sling Model Instead of HTL

```html
<!-- WRONG — static label handled in Java model -->
<!-- Model: getDefaultLabel() { return "Learn More"; } -->
<a href="${model.linkUrl}">${model.defaultLabel}</a>

<!-- RIGHT — use HTL i18n directly, no model method needed -->
<a href="${model.linkUrl}">${'Learn More' @ i18n}</a>
```

Static display text belongs in HTL with `@ i18n`, not in a Sling Model getter. The model should only provide dynamic/authored content — never hardcoded UI strings.

### Sling Model i18n (Computed Strings)

For strings built in Java (e.g., formatted dates, dynamic messages), access translations via the Sling `I18n` helper in your Sling Model:

```java
@Self
private SlingHttpServletRequest request;

private String getTranslatedLabel() {
    I18n i18n = new I18n(request);
    return i18n.get("Items found: {0}", null, itemCount);
}
```

Then output normally in HTL — the model returns the already-translated string:

```html
<span>${model.translatedLabel}</span>
```

## Complete Example: Tiles List

```html
<!--/*
    Tiles List Component
*/-->
<sly data-sly-use.model="[package].models.TilesListModel"/>
<sly data-sly-use.clientlib="/libs/granite/sightly/templates/clientlib.html">
    <sly data-sly-call="${clientlib.css @ categories='[project].components.tileslist'}"/>
</sly>

<sly data-sly-test="${model.hasContent}">
    <section class="cmp-tileslist" data-cmp-is="tileslist">

        <!--/* Section Title */-->
        <sly data-sly-test="${model.listTitle}">
            <h2 class="cmp-tileslist__title">${model.listTitle}</h2>
        </sly>

        <!--/* Tiles Grid */-->
        <sly data-sly-test="${model.tiles.size > 0}">
            <div class="cmp-tileslist__grid">
                <sly data-sly-list.tile="${model.tiles}">
                    <article class="cmp-tileslist__tile">

                        <!--/* Tile Image */-->
                        <sly data-sly-test="${tile.imageReference}">
                            <div class="cmp-tileslist__tile-image">
                                <img src="${tile.imageReference}"
                                     alt="${tile.tileTitle @ context='attribute'}"
                                     loading="lazy"/>
                            </div>
                        </sly>

                        <!--/* Tile Content */-->
                        <div class="cmp-tileslist__tile-content">
                            <sly data-sly-test="${tile.tileTitle}">
                                <h3 class="cmp-tileslist__tile-title">${tile.tileTitle}</h3>
                            </sly>

                            <sly data-sly-test="${tile.tileDesc}">
                                <div class="cmp-tileslist__tile-desc">${tile.tileDesc @ context='html'}</div>
                            </sly>

                            <!--/* Link */-->
                            <sly data-sly-test="${tile.tileLinkText && tile.tileLinkURL}">
                                <a href="${tile.tileLinkURL @ extension='html'}"
                                   class="cmp-tileslist__tile-link">
                                    ${tile.tileLinkText}
                                </a>
                            </sly>
                        </div>
                    </article>
                </sly>
            </div>
        </sly>
    </section>
</sly>

<!--/* Empty state */-->
<sly data-sly-test="${!model.hasContent && wcmmode.edit}">
    <div class="cmp-tileslist cmp-tileslist--empty">
        Please configure the Tiles List component
    </div>
</sly>
```

## BEM Naming Convention

```
.cmp-{component}           - Block (component root)
.cmp-{component}__{element} - Element (child)
.cmp-{component}--{modifier} - Modifier (variant)
```

**Examples:**

```
.cmp-tileslist
.cmp-tileslist__title
.cmp-tileslist__tile
.cmp-tileslist__tile-image
.cmp-tileslist--featured
```