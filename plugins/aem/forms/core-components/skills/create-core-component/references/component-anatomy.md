# AEM Core Forms Component Anatomy

## Complete File Checklist

To create a new component `{componentname}` at version v1, the following files are required:

### Java Backend (bundles/af-core/src/main/java/com/adobe/cq/forms/core/components/)

| # | File | Purpose |
|---|------|---------|
| 1 | `models/form/{ComponentName}.java` | Public interface |
| 2 | `internal/models/v1/form/{ComponentName}Impl.java` | Sling Model implementation |
| 3 | `internal/form/FormConstants.java` (edit) | Add `RT_FD_FORM_{COMPONENT}_V1` constant |

### Tests (bundles/af-core/src/test/)

| # | File | Purpose |
|---|------|---------|
| 4 | `java/.../internal/models/v1/form/{ComponentName}ImplTest.java` | Unit tests |
| 5 | `resources/form/{componentname}/test-content.json` | Mock JCR content |
| 6 | `resources/form/{componentname}/exporter-{componentname}.json` | Expected JSON export |

### UI AF Apps (ui.af.apps/src/main/content/jcr_root/apps/core/fd/components/form/)

| # | File | Purpose |
|---|------|---------|
| 7 | `{componentname}/v1/{componentname}/.content.xml` | Component definition |
| 8 | `{componentname}/v1/{componentname}/{componentname}.html` | HTL template |
| 9 | `{componentname}/v1/{componentname}/{componentname}.js` | Renderer path config |
| 10 | `{componentname}/v1/{componentname}/_cq_dialog/.content.xml` | Author dialog |
| 11 | `{componentname}/v1/{componentname}/clientlibs/site/.content.xml` | Runtime clientlib definition |
| 12 | `{componentname}/v1/{componentname}/clientlibs/site/js/{componentname}view.js` | Client-side view class |
| 13 | `{componentname}/v1/{componentname}/clientlibs/site/js.txt` | JS manifest |
| 14 | `{componentname}/v1/{componentname}/clientlibs/site/css/{componentname}.less` | Styles |
| 15 | `{componentname}/v1/{componentname}/clientlibs/site/css.txt` | CSS manifest |
| 16 | `{componentname}/v1/{componentname}/clientlibs/editor/.content.xml` | Editor clientlib |

### Examples

| # | File | Purpose |
|---|------|---------|
| 17 | `examples/ui.apps/.../form/{componentname}/.content.xml` | Example proxy component |
| 18 | `examples/ui.content/.../adaptive-form/{componentname}/.content.xml` | Example content page |

### Integration Tests

| # | File | Purpose |
|---|------|---------|
| 19 | `it/content/.../content/dam/formsanddocuments/core-components-it/samples/{componentname}/{variant}/.content.xml` | IT test content (for example `textinput/basic`) |
| 20 | `{componentname}/v1/{componentname}/README.md` | Component documentation |
| 21 | `ui.tests/test-module/specs/{componentname}/{componentname}.runtime.cy.js` | Cypress runtime spec |
| 22 | `ui.af.apps/pom.xml` and `core-forms-components-runtime-all/.content.xml` (edit) | See `wiring-checklist.md` |

---

## Naming

Given `ImageChoice`:

| Variant | Value |
|---------|-------|
| PascalCase | `ImageChoice` |
| lowercase (folder, files) | `imagechoice` |
| FormConstant | `RT_FD_FORM_IMAGE_CHOICE_V1` |
| BEM block | `cmp-adaptiveform-imagechoice` |
| `data-cmp-is` | `adaptiveFormImageChoice` |
| Resource type | `core/fd/components/form/imagechoice/v1/imagechoice` |
| Clientlib category | `core.forms.components.imagechoice.v1.runtime` (check the sibling: `datePicker` is camelCase) |

---

## Interface & Implementation Hierarchy

This skill does **not** embed a copy of the interface/implementation class hierarchy or
its per-class property lists — that surface evolves with the framework. Read the
authoritative hierarchy from the **latest released GA Maven artifact** of core
components (see `core-components-artifact.md`): the interfaces under
`com/adobe/cq/forms/core/components/models/form/` (`Base`, `BaseConstraint`, `Field`,
`StringConstraint`, `NumberConstraint`, `DateConstraint`, `OptionsConstraint`, …) and
the abstract implementations under
`com/adobe/cq/forms/core/components/internal/models/v1/form/`
(`AbstractFormComponentImpl` → `AbstractBaseImpl` → `AbstractFieldImpl` →
`AbstractOptionsFieldImpl`, plus `AbstractContainerImpl`). Confirm the exact getters,
JCR names, and which base class owns each property directly from those sources.

Choose the appropriate base class:
- **Simple text/number field** -> extend `AbstractFieldImpl`
- **Options-based field** (checkboxes, radios, selects) -> extend `AbstractOptionsFieldImpl`
- **Container/panel** -> extend `AbstractContainerImpl`
- **Non-input component** (button, text, image) -> extend `AbstractBaseImpl`

---

## FormConstants Pattern

```java
public final static String RT_FD_FORM_PREFIX = "core/fd/components/form/";
// Pattern: RT_FD_FORM_{COMPONENT}_V{N} = RT_FD_FORM_PREFIX + "{componentname}/v{n}/{componentname}"
public final static String RT_FD_FORM_TEXT_V1 = RT_FD_FORM_PREFIX + "textinput/v1/textinput";
```

## FieldType Values

Do not hardcode the field-type list — read the authoritative values from the
`FieldType` enum in the latest released GA Maven artifact (see
`core-components-artifact.md`) and use the exact string constant your component needs.

---

## ReservedProperties

All JCR property names used by the framework are declared in `ReservedProperties.java`. When adding new JCR properties for a custom component, check that names do not collide with existing reserved properties. If the property is framework-level (reusable across components), add it to `ReservedProperties`.
