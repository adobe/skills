# AEM Reusable Component Library + Design System Guide

A comprehensive guide to building maintainable, scalable component architectures in Adobe Experience Manager.

---

## Table of Contents

1. [The Core Problem](#the-core-problem)
2. [Component Library Architecture](#component-library-architecture)
   - [Layer 1: Foundation (Design Tokens)](#layer-1-foundation-design-tokens)
   - [Layer 2: Core Components Extension](#layer-2-core-components-extension-strategy)
   - [Layer 3: Component Taxonomy](#layer-3-component-taxonomy)
   - [Layer 4: Sling Model Patterns](#layer-4-sling-model-patterns)
   - [Layer 5: Style System Architecture](#layer-5-style-system-architecture)
   - [Layer 6: Dialog Standardization](#layer-6-dialog-standardization)
3. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
4. [Governance & Process](#governance--process)
5. [ROI Calculation](#roi-calculation-example)

---

## The Core Problem

Most AEM projects fail at component reusability because:

1. **No upfront design system alignment** - Developers build what's in the wireframe, not what's in a system
2. **Component explosion** - 150+ components when 30 well-designed ones would suffice
3. **Copy-paste inheritance** - Teams duplicate components instead of extending
4. **Dialog inconsistency** - Same field configured 47 different ways across components

---

## Component Library Architecture

### Layer 1: Foundation (Design Tokens)

```
/apps/mysite/clientlibs/clientlib-base/
├── tokens/
│   ├── _colors.scss       # $color-primary, $color-secondary
│   ├── _typography.scss   # $font-heading, $font-body, scale
│   ├── _spacing.scss      # $space-xs, $space-sm, $space-md
│   └── _breakpoints.scss  # $bp-mobile, $bp-tablet, $bp-desktop
```

**Why it matters**: One token change updates entire site. Without this, you're hunting through 200 files to change a brand color.

---

### Layer 2: Core Components Extension Strategy

**Don't reinvent — extend Adobe Core Components:**

| Core Component | Your Extension | What You Add |
|----------------|----------------|--------------|
| `core/wcm/components/image` | `mysite/components/image` | Brand-specific renditions, lazy-load config |
| `core/wcm/components/teaser` | `mysite/components/card` | Card variants via style system |
| `core/wcm/components/container` | `mysite/components/section` | Background options, spacing presets |

**Sling Resource Merger approach:**

```xml
<!-- /apps/mysite/components/image/.content.xml -->
<jcr:root
    jcr:primaryType="cmp:Component"
    sling:resourceSuperType="core/wcm/components/image/v3/image"
    componentGroup="MySite - Content"/>
```

---

### Layer 3: Component Taxonomy

**Organize by atomic design principles:**

```
/apps/mysite/components/
├── atoms/
│   ├── button/          # Single CTA, no children
│   ├── icon/            # SVG sprite reference
│   └── badge/           # Labels, tags
├── molecules/
│   ├── card/            # Image + text + CTA
│   ├── form-field/      # Label + input + validation
│   └── breadcrumb/      # Navigation molecule
├── organisms/
│   ├── header/          # Logo + nav + search
│   ├── hero/            # Full-width showcase
│   └── product-grid/    # Collection display
├── templates/
│   └── layouts/         # Page structure containers
└── _shared/
    ├── models/          # Shared Sling Models
    └── utils/           # HTL templates, helpers
```

---

### Layer 4: Sling Model Patterns

#### Anti-Pattern: Fat models with business logic everywhere

```java
// Anti-pattern: 500-line model doing everything
@Model(adaptables = Resource.class)
public class MegaCardModel {
    // 47 @ValueMapValue fields
    // Complex conditional logic
    // Formatting, validation, transformation all mixed
}
```

#### Best Practice: Composition via interfaces and delegation

```java
// Pattern: Interface-based composition
@Model(adaptables = Resource.class,
       adapters = Card.class,
       defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class CardImpl implements Card, Linkable, Imageable {

    @Self @Via(type = ResourceSuperType.class)
    private Teaser coreTeaser;  // Delegate to core

    @ValueMapValue
    private String cardVariant;

    @Override
    public Link getLink() {
        return coreTeaser.getLink();
    }

    @Override
    public String getVariantClass() {
        return "card--" + StringUtils.defaultIfBlank(cardVariant, "default");
    }
}
```

---

### Layer 5: Style System Architecture

**The multiplier effect** — 1 component × Style System = many variants without code:

```json
// /apps/mysite/components/card/cq:design_dialog/.content.xml
{
  "tabs": {
    "styletab": {
      "styles": {
        "groups": [
          {
            "label": "Card Style",
            "items": [
              { "label": "Default", "value": "card--default" },
              { "label": "Featured", "value": "card--featured" },
              { "label": "Minimal", "value": "card--minimal" },
              { "label": "Horizontal", "value": "card--horizontal" }
            ]
          },
          {
            "label": "Card Size",
            "items": [
              { "label": "Small", "value": "card--sm" },
              { "label": "Medium", "value": "card--md" },
              { "label": "Large", "value": "card--lg" }
            ]
          }
        ]
      }
    }
  }
}
```

**Result**: 4 styles × 3 sizes = 12 visual variants, 1 component to maintain.

---

### Layer 6: Dialog Standardization

**Create reusable dialog snippets:**

```xml
<!-- /apps/mysite/components/_shared/dialogs/link-fields.xml -->
<linkFields jcr:primaryType="nt:unstructured">
    <linkUrl
        jcr:primaryType="nt:unstructured"
        sling:resourceType="granite/ui/components/coral/foundation/form/pathfield"
        fieldLabel="Link URL"
        name="./linkUrl"
        rootPath="/content"/>
    <linkTarget
        jcr:primaryType="nt:unstructured"
        sling:resourceType="granite/ui/components/coral/foundation/form/checkbox"
        text="Open in new tab"
        name="./linkTarget"
        value="_blank"
        uncheckedValue="_self"/>
    <linkAriaLabel
        jcr:primaryType="nt:unstructured"
        sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
        fieldLabel="Accessibility Label"
        name="./linkAriaLabel"/>
</linkFields>
```

**Include in any component dialog:**

```xml
<items jcr:primaryType="nt:unstructured">
    <linkGroup
        jcr:primaryType="nt:unstructured"
        sling:resourceType="granite/ui/components/coral/foundation/include"
        path="/apps/mysite/components/_shared/dialogs/link-fields.xml"/>
</items>
```

---

## Anti-Patterns to Avoid

| Anti-Pattern | Why It Hurts | Better Approach |
|--------------|--------------|-----------------|
| **One-off components** | Each page request spawns new component | Extend existing, use Style System |
| **Hardcoded breakpoints** | Can't adapt to design changes | Use token variables |
| **Logic in HTL** | Untestable, unmaintainable | Move to Sling Models |
| **Inline styles** | Authors create inconsistency | Predefined style options only |
| **Component per page type** | Explosion of similar components | Composable containers |
| **No component governance** | Wild west, duplicates emerge | Component review in PR process |

---

## Governance & Process

### Component Request Workflow

```
1. Author/Designer requests new component
         ↓
2. Check: Can existing component + Style System solve this?
         ↓ No
3. Check: Can we extend a Core Component?
         ↓ No
4. Design review: Atomic design placement, token usage
         ↓
5. Build with full documentation
         ↓
6. Add to component library showcase
```

### Living Documentation

**Build a component showcase page** (often called "Kitchen Sink" or "Pattern Library"):

- Every component rendered with all variants
- Copy-paste dialog configurations
- Accessibility annotations
- Performance benchmarks

---

## ROI Calculation Example

| Metric | Without Library | With Library |
|--------|-----------------|--------------|
| Components built | 150 | 35 |
| Avg time per component | 16 hours | 20 hours (more robust) |
| Total component dev time | 2,400 hours | 700 hours |
| New page build time | 40 hours | 8 hours |
| Bug fix propagation | Manual per instance | Single fix, everywhere |

**Net savings: 50-70% development time over project lifecycle**

---

## Quick Reference Checklist

### Before Building a New Component

- [ ] Can an existing component + Style System handle this?
- [ ] Can I extend a Core Component?
- [ ] Does it fit atomic design taxonomy?
- [ ] Are design tokens used (no hardcoded values)?
- [ ] Is the Sling Model using composition/interfaces?
- [ ] Are dialog fields reusing shared snippets?
- [ ] Is it documented in the component showcase?

### Component Health Metrics

- **Component count**: Target < 50 custom components
- **Style System coverage**: > 80% of components should use it
- **Core Component extension rate**: > 60% should extend core
- **Dialog snippet reuse**: > 70% of common fields shared

---

## Further Reading

- [Adobe Core Components Documentation](https://experienceleague.adobe.com/docs/experience-manager-core-components/using/introduction.html)
- [AEM Style System](https://experienceleague.adobe.com/docs/experience-manager-65/authoring/siteandpage/style-system.html)
- [Sling Models Documentation](https://sling.apache.org/documentation/bundles/models.html)
- [Atomic Design Methodology](https://atomicdesign.bradfrost.com/)
