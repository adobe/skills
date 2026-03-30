# AEM Project Conventions

## Configuration Source

Project configuration is loaded from `.aem-skills-config.yaml` in the **project root** (same level as `pom.xml`).

> **AI AGENT - CONFIGURATION RULES:**
> 1. **READ `.aem-skills-config.yaml` FIRST** — always check for it before anything else
> 2. **If `configured: true`** → use `project`, `package`, and `group` values from the file. Do NOT re-detect or override them.
> 3. **If file is missing or `configured: false`** → auto-detect values from the codebase (pom.xml, existing components, Java files), present them to the user for confirmation, then create/update the config file with `configured: true`
> 4. **After config is established**, `.aem-skills-config.yaml` is the **SINGLE SOURCE OF TRUTH** — never re-infer values from the codebase

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
└── testcontext/
    └── AppAemContext.java          # Shared test context
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
6. Follow HTL (Sightly) best practices (see `component-htl-rules.md`)
7. Include proper JCR node types and properties
8. Use Touch UI dialogs (not Classic UI)

### Component Design
9. Implement `hasContent()` or `isEmpty()` in models
10. Handle null/empty gracefully
11. Use `data-cmp-is` attribute for JavaScript hooks
12. Support author edit mode appropriately

---

## Dialog Field Type Reference

> **Quick reference for mapping user field specifications to Granite UI types**

| User Input | Granite Resource Type | Property Type |
|------------|----------------------|---------------|
| Textfield | `granite/ui/components/coral/foundation/form/textfield` | String |
| Textarea | `granite/ui/components/coral/foundation/form/textarea` | String |
| Richtext | `cq/gui/components/authoring/dialog/richtext` | String (HTML) |
| Checkbox | `granite/ui/components/coral/foundation/form/checkbox` | Boolean |
| Select | `granite/ui/components/coral/foundation/form/select` | String |
| Pathfield | `granite/ui/components/coral/foundation/form/pathfield` | String (Path) |
| Fileupload | `cq/gui/components/authoring/dialog/fileupload` | Resource |
| Numberfield | `granite/ui/components/coral/foundation/form/numberfield` | Long/Double |
| Datepicker | `granite/ui/components/coral/foundation/form/datepicker` | Date |
| Multifield | `granite/ui/components/coral/foundation/form/multifield` | List |
| Hidden | `granite/ui/components/coral/foundation/form/hidden` | String |
| Colorfield | `granite/ui/components/coral/foundation/form/colorfield` | String |

> **For detailed dialog configuration**, see `component-dialog-rules.md`

---

## Sling Model Annotations Quick Reference

| Annotation | Purpose | Example |
|------------|---------|---------|
| `@ValueMapValue` | Simple property | `@ValueMapValue private String title;` |
| `@ChildResource` | Nested resource | `@ChildResource(name="image") private Resource img;` |
| `@ChildResource` | Multifield list | `@ChildResource(name="items") private List<Resource> items;` |
| `@SlingObject` | Current resource | `@SlingObject private Resource resource;` |
| `@PostConstruct` | Init logic | `@PostConstruct protected void init() {}` |

> **For detailed model patterns**, see `component-model-rules.md`

---

## Related Rules Files

This project uses modular rules files for specific aspects:

| Rules File | Purpose |
|------------|---------|
| `component-dialog-rules.md` | Dialog XML structure, field types, validation |
| `component-htl-rules.md` | HTL template patterns, expressions, accessibility |
| `component-model-rules.md` | Sling Model structure, annotations, patterns |
| `component-clientlib-rules.md` | Clientlib structure, JS/CSS patterns |
| `java-standards.md` | Java code quality, Javadoc, error handling |
| `testing-standards.md` | Unit test structure, scenarios, assertions |

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



