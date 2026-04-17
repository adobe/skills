# AEM Project Conventions

## Configuration Source

Project configuration is loaded from `.aem-skills-config.yaml` in the **project root** (same level as `pom.xml`).

> **AI AGENT GATE CHECK** - Read `.aem-skills-config.yaml` FIRST:
> - If file is missing or `configured: false` → **STOP IMMEDIATELY**. Do NOT read any other files. Do NOT explore the codebase. Display the configuration error message and WAIT.
> - If `configured: true` → Read `project`, `package`, and `group` values from that file. Proceed with component creation.

> **⚠️ AI AGENTS - ABSOLUTE RULES:**
> 1. **READ `.aem-skills-config.yaml` FIRST** - If missing or `configured: false`, STOP
> 2. **DO NOT read any other files** in the repository to find values
> 3. **DO NOT explore** `/apps/`, `core/`, `pom.xml`, or any existing components
> 4. **DO NOT infer** values from folder structures, package names, or existing code
> 5. **ONLY USE VALUES FROM `.aem-skills-config.yaml`** after `configured: true`
> 6. **VIOLATION = IMMEDIATE FAILURE** - Any inference attempt is a rule violation

---

## File Structure

### Component Files
```
ui.apps/src/main/content/jcr_root/apps/[project]/components/{component-name}/
├── .content.xml                    # Component definition
├── {component-name}.html           # HTL template
├── _cq_dialog/
│   └── .content.xml                # Component dialog
└── _cq_editConfig.xml              # Edit configuration (optional)
```

### Sling Models
```
core/src/main/java/[package-path]/
├── models/
│   ├── {ComponentName}Model.java   # Main component model
│   └── {ItemName}.java             # Child model (for multifield)
├── filters/
├── servlets/
├── services/
└── schedulers/
```

> **Note**: `[package-path]` = `[package]` with dots replaced by slashes (e.g., `com/mysite/core`)

### Unit Tests
```
core/src/test/java/[package-path]/
├── models/
│   └── {ComponentName}ModelTest.java
└── testcontext/                    # (optional)
    └── AppAemContext.java          # Optional shared test context helper
```

### Clientlibs
```
ui.apps/src/main/content/jcr_root/apps/[project]/clientlibs/
├── clientlib-base/                 # Base styles/scripts
├── clientlib-site/                 # Site-wide
├── clientlib-dependencies/         # Third-party
└── clientlib-{component-name}-dialog/  # Component dialog clientlib
```

---

## Component Definition Template

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:Component"
    jcr:title="{Component Display Title}"
    jcr:description="{Component Description}"
    componentGroup="[group]"
    generatedBy="aem-dev-agent"/>
```

---

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Component folder | kebab-case | `hero-banner`, `tiles-list` |
| HTL file | match folder name | `hero-banner.html` |
| Sling Model class | PascalCase + Model | `HeroBannerModel.java` |
| Multifield item class | PascalCase | `TileItem.java`, `LinkItem.java` |
| Test class | PascalCase + Test | `HeroBannerModelTest.java` |
| CSS class (BEM) | `cmp-{name}__{element}` | `cmp-hero-banner__title` |
| Dialog clientlib category | `[project].{name}.dialog` | `[project].hero-banner.dialog` |
| Site clientlib category | `[project].{type}` | `[project].base`, `[project].site` |

### Name Transformation Examples

| Component Name | Model Class | Test Class | CSS Prefix |
|----------------|-------------|------------|------------|
| `hero-banner` | `HeroBannerModel` | `HeroBannerModelTest` | `cmp-hero-banner` |
| `tiles-list` | `TilesListModel` | `TilesListModelTest` | `cmp-tiles-list` |
| `contact-form` | `ContactFormModel` | `ContactFormModelTest` | `cmp-contact-form` |

---

## General Rules

### Code Quality
1. Always use Apache 2.0 license header in Java files
2. Follow BEM naming for CSS: `cmp-{component-name}__{element}--{modifier}`
3. Use meaningful, descriptive names
4. Keep files focused (single responsibility)

### AEM Best Practices
5. Use Sling Models for business logic (not JSP/scripts)
6. Follow HTL (Sightly) best practices (see `htl-patterns.md`)
7. Include proper JCR node types and properties
8. Use Touch UI dialogs (not Classic UI)

### Component Design
9. Implement `hasContent()` or `isEmpty()` in models
10. Handle null/empty gracefully
11. Use `data-cmp-is` attribute for JavaScript hooks
12. Support author edit mode appropriately

---

## Dialog Field Type Reference

For field type mappings (dialog field types → Granite resource types, Sling Model annotations), see `assets/field-type-mappings.md` or the Quick Reference table in SKILL.md.

> **For detailed dialog configuration**, see `dialog-patterns.md`

---

## Sling Model Annotations Quick Reference

| Annotation | Purpose | Example |
|------------|---------|---------|
| `@ValueMapValue` | Simple property | `@ValueMapValue private String title;` |
| `@ChildResource` | Nested resource | `@ChildResource(name="image") private Resource img;` |
| `@ChildResource` | Multifield list | `@ChildResource(name="items") private List<Resource> items;` |
| `@SlingObject` | Current resource | `@SlingObject private Resource resource;` |
| `@PostConstruct` | Init logic | `@PostConstruct protected void init() {}` |

> **For detailed model patterns**, see `model-patterns.md`

---

## Related Rules Files

This project uses modular rules files for specific aspects:

| Rules File | Purpose |
|------------|---------|
| `dialog-patterns.md` | Dialog XML structure, field types, validation |
| `htl-patterns.md` | HTL template patterns, expressions, accessibility |
| `model-patterns.md` | Sling Model structure, annotations, patterns |
| `clientlib-patterns.md` | Clientlib structure, JS/CSS patterns |
| `java-standards.md` | Java code quality, Javadoc, error handling |
| `test-patterns.md` | Unit test structure, scenarios, assertions |

---

## Cross-File Coordination

When creating components, ensure consistency across all files:

```
Dialog field name="./title"
        ↓
Model: @ValueMapValue private String title;
        ↓
HTL: ${model.title}
        ↓
CSS: .cmp-component__title
```

| Dialog Property | Model Field | HTL Expression | CSS Class |
|-----------------|-------------|----------------|-----------|
| `./title` | `title` | `${model.title}` | `__title` |
| `./description` | `description` | `${model.description @ context='html'}` | `__description` |
| `./linkURL` | `linkURL` | `${model.linkURL @ extension='html'}` | `__link` |
| `./items` (multifield) | `List<ItemModel> items` | `${model.items}` via `data-sly-list` | `__item` |

---

## Placeholder Reference

All other rules files use these placeholders. The AI will substitute your configured values:

| Placeholder | Substituted With | Used In |
|-------------|------------------|---------|
| `[project]` | Your project name | Paths, resource types, clientlib categories |
| `[package]` | Your Java package | Model imports, package declarations |
| `[group]` | Your component group | Component definitions |
| `[package-path]` | Package as path | Directory structures |



