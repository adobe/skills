---
name: create-core-component
description: "Create a new server-side Adaptive Forms Core Component (Java Sling Model, HTL, dialog, site/editor clientlibs, tests, examples) in a working copy of adobe/aem-core-forms-components, and wire it into that repo's build and runtime clientlibs. Use when asked to add, scaffold or build a new core form component or field in that repo. Not for Edge Delivery Services Form-block components (aem-forms-edge-delivery-services plugin), React headless components (create-headless-component), or AEM Sites HTL components (aem-cloud-service create-component)."
license: Apache-2.0
---

# Create a Core Form Component

Build a component across Java, HTL, dialog, clientlibs, tests and examples, wire it in, and prove it works before saying done. Run every command from the root of the `aem-core-forms-components` checkout (it has `bundles/af-core/` and `ui.af.apps/`). Paths below starting `scripts/` or `references/` are relative to this skill's directory: resolve them to absolute paths first.

## 1. Gather requirements

Ask only what the request does not answer.

| Need | Why |
|------|-----|
| Component name | Drives every path, class, category and BEM name (naming table in `references/component-anatomy.md`) |
| Kind: simple field, options field, container, display-only | Picks the Java base class and the closest sibling to copy |
| Custom JCR properties, widget markup, constraints | Dialog fields, Sling Model getters, HTL |
| Forms Core Components version and platform | Only needed if there is no checkout: see `references/core-components-artifact.md`. Never hardcode a version |

Stop if `ui.af.apps/.../components/form/<name>/` or a `FormConstants` entry for it already exists.

## 2. Copy a sibling, do not invent

Read the closest existing component in the checkout (`textinput`, `dropdown`, `checkboxgroup`, `panelcontainer`, `text`) and its `README.md`, then follow `references/templates.md` and the file list in `references/component-anatomy.md`. Create in this order: `FormConstants` entry, interface, Sling Model impl, then the `ui.af.apps` files, tests, example proxy and page.

## 3. What a model gets wrong without this skill

- `@Model` adapters list the interface and `ComponentExporter`; `resourceType` uses the `FormConstants` constant; optional properties use `InjectionStrategy.OPTIONAL`.
- Site clientlib category is `core.forms.components.<name>.v1.runtime`, depends on `core.forms.components.runtime.base`, has `allowProxy`. The view class extends `FormView.FormFieldBase` and registers with `FormView.Utils.setupField`.
- Root HTL `<div>` needs `data-cmp-is`, the four state attributes, `data-cmp-data-layer` and `id="${component.id}"`; the widget id is `<id>-widget`.
- Wiring outside the component folder is what gets missed. Do all of it, see `references/wiring-checklist.md`:
  1. `ui.af.apps/pom.xml`: a `<replace ... token=".core-adaptiveform">` line, or the component lands in the wrong group.
  2. `core-forms-components-runtime-all/.content.xml`: add the clientlib category to `embed`, or the component works only in the IT package.
  3. The component `README.md`, the example proxy and page, and a Cypress spec.
- A bug fix, including an accessibility fix, goes into the existing version. Bump `v1` to `v2` only when DOM, JS contract or authored properties break: follow `docs/architecture/component-versioning.md` in the checkout.

## 4. Validate (do not report done before this)

A. Static check. Exit 1 means fix and re-run:

```bash
node scripts/validate-component.mjs <name> --root .
```

B. Build and unit test (Maven and Java 11 or 17 are needed): `mvn -pl bundles/af-core test -Dtest=<Pascal>ImplTest`.

C. Accessibility: walk `references/accessibility-checklist.md`.

D. Cypress runtime spec modelled on `ui.tests/test-module/specs/textinput/textinput.runtime.cy.js`. It needs a running AEM with the IT content deployed.

If a gate cannot run (no Maven, no network, no AEM instance), do not claim it passed: say which one, why, and the exact command for the user.

## 5. Report

List files created and edited (including the wiring files), the validator summary with every WARN, the build and test result, and each gate not run with its command.

## References

- `references/component-anatomy.md`: file list, naming table, class hierarchy
- `references/templates.md`: one template per file type
- `references/wiring-checklist.md`: registration steps outside the component folder
- `references/accessibility-checklist.md`: WCAG 2.1 AA with the AEM ARIA patterns
- `references/core-components-artifact.md`: reading source from the Maven artifacts when there is no checkout
