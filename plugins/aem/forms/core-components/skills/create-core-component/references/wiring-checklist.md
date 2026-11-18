# Wiring Checklist (outside the component folder)

A component that has all its own files still fails in a released build if these are missing. Each item was checked against `adobe/aem-core-forms-components`; `validate-component.mjs` section 13 checks them.

## 1. Component browser group: `ui.af.apps/pom.xml`

The component `.content.xml` carries `componentGroup=".core-adaptiveform"`. The build replaces that token per component, so add one line next to the existing ones:

```xml
<replace file="target/jcr_root/libs/core/fd/components/form/<name>/v1/<name>/.content.xml" token=".core-adaptiveform" value="Core Adaptive Form" />
```

Without it the component shows under the raw token. This is the step most often missed in past version bumps (`docs/architecture/component-versioning.md`).

## 2. Runtime clientlib: `core-forms-components-runtime-all`

File: `ui.af.apps/src/main/content/jcr_root/apps/core/fd/af-clientlibs/core-forms-components-runtime-all/.content.xml`.
Add the site clientlib category (`core.forms.components.<name>.v1.runtime`) to the `embed` list. Take the exact string from the component's own `clientlibs/site/.content.xml`: it is not always the lowercase name (for example `datePicker`).

The comment at the top of that file also holds the replace-or-add rule for version bumps: replace the old category only if the new clientlib is fully self-contained, otherwise keep both.

The `it/apps/.../custom-forms-components-runtime-all` embed is not per component: do not add to it.

## 3. Documentation and examples

- `README.md` in the component folder: Use Object (Sling Model), edit dialog properties, BEM, extension points. Model it on `textinput/v1/textinput/README.md`.
- Example proxy under `examples/ui.apps/.../forms-components-examples/components/form/<name>/` and an example page under `examples/ui.content/.../library/adaptive-form/<name>/`.

## 4. Tests

- Unit test, `test-content.json` and exporter JSON in `bundles/af-core/src/test/`.
- IT content page under `it/content/.../content/dam/formsanddocuments/core-components-it/samples/<name>/<variant>/` (for example `textinput/basic`).
- Cypress spec in `ui.tests/test-module/specs/<name>/`: `<name>.runtime.cy.js`, plus `<name>.authoring.cy.js` if the dialog has custom behaviour. Use `cy.previewForm(pagePath)`; guard toggle-dependent assertions with `cy.fetchFeatureToggles()` and `cy.af.isLatestAddon()`.

## 5. New version of an existing component

Not a wiring step. Follow the 8-item checklist in `docs/architecture/component-versioning.md` of the checkout: new version folder, standalone clientlib copy, dialog inheritance via `sling:resourceSuperType`, Java constant only if the exported JSON changed, the pom line, the embed list, IT content that still points at the old version, and an e2e spec.
