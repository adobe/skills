# HTL Patterns for AEM Components

Patterns for creating HTL (HTML Template Language) templates following Adobe best practices.

---

## File Location
```
ui.apps/src/main/content/jcr_root/apps/[project]/components/{component-name}/{component-name}.html
```

---

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

---

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
|---------|---------|
| (default) | Plain text |
| `html` | Rich text content |
| `attribute` | HTML attributes |
| `uri` | URLs |
| `scriptString` | JavaScript strings |

**NEVER use** `@ context='unsafe'` in production.

---

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

---

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
|----------|-------------|
| `{var}List.index` | Zero-based index |
| `{var}List.count` | Total items |
| `{var}List.first` | True if first item |
| `{var}List.last` | True if last item |
| `{var}List.odd` | True if odd index |
| `{var}List.even` | True if even index |

### Check Before Iteration
```html
<sly data-sly-test="${model.tiles.size > 0}">
    <ul data-sly-list.tile="${model.tiles}">
        <li>${tile.tileTitle}</li>
    </ul>
</sly>
```

---

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

---

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

---

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

---

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

---

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

---

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

---

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
