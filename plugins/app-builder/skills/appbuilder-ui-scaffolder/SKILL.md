---
name: appbuilder-ui-scaffolder
description: >-
  Generate React Spectrum UI components for Adobe Experience Cloud Shell SPAs and AEM UI Extensions.
  Provides patterns for pages, forms, data tables, dialogs, and navigation using @adobe/react-spectrum.
  Guides ExC Shell integration with @adobe/exc-app including runtime.done(), IMS token passthrough,
  and shell theming. Guides AEM UI Extension development with @adobe/uix-guest for Content Fragment
  Console, CF Editor, Universal Editor, and Assets View surfaces. Trigger on: building App Builder UI,
  React Spectrum components, ExC Shell pages, forms, data tables, dialogs, modals, navigation, theming,
  web-src, Spectrum design system, @adobe/exc-app, AEM extension, AEM UI extension, Content Fragment
  Console, Universal Editor extension, uix-guest, @adobe/uix-guest, extension points for AEM,
  customizing AEM surfaces.
metadata:
  category: frontend
license: Apache-2.0
compatibility: Requires Node.js 18+, npm, and @adobe/react-spectrum
allowed-tools: Bash(npm:*) Bash(node:*) Bash(npx:*) Read Write Edit
---
# App Builder UI Scaffolder

Generate React Spectrum UI for Adobe Experience Cloud Shell SPAs. This is a reference-based skill — the agent reads patterns and generates context-appropriate code rather than copying static templates.

## Pattern Quick-Reference

Identify the user's intent, then read the referenced sections to generate tailored code.

| User wants | Reference | Key components |
| --- | --- | --- |
| New page with shell context | `references/ui-patterns.md` § Page + `references/shell-integration.md` | `View`, `Heading`, `Content` |
| Form with validation | `references/ui-patterns.md` § Form | `Form`, `TextField`, `NumberField`, `Picker`, `Button` |
| Data table (sortable, paginated) | `references/ui-patterns.md` § Table | `TableView`, `TableHeader`, `Column`, `TableBody`, `Row`, `Cell` |
| Confirmation dialog / modal | `references/ui-patterns.md` § Dialog | `DialogTrigger`, `AlertDialog`, `Dialog` |
| Navigation layout | `references/ui-patterns.md` § Navigation | `Tabs`, `Breadcrumbs`, `Flex` |
| ExC Shell setup | `references/shell-integration.md` | `@adobe/exc-app`, `Provider`, `defaultTheme` |
| Connect UI to backend actions | `references/action-integration.md` | `fetch()` with IMS token |
| AEM UI Extension (CF Console, CF Editor, Universal Editor) | `references/aem-extensions.md` | `@adobe/uix-guest`, `register()`, `sharedContext` |
| Debug UI issues | `references/debugging.md` | Shell spinner, CORS, blank screen, auth |

## Fast Path (for clear requests)

When the user's request maps unambiguously to a single pattern above — they name a specific component type, reference a UI pattern, or describe a use case that clearly matches one entry — proceed directly:

1. Read the user's existing project structure (`web-src/src/`) for conventions (file naming, import style, existing components)
2. Read the matched `references/` file for component guidance and annotated examples
3. Generate code that fits the user's existing conventions
4. Wire into existing routing if React Router is present
5. Validate against `references/checklist.md`

Examples of fast-path triggers:
- "Add a data table page" → Read `references/ui-patterns.md` § Table, generate directly
- "Create a form for submitting data" → Read `references/ui-patterns.md` § Form, generate directly
- "Add a confirmation dialog" → Read `references/ui-patterns.md` § Dialog, generate directly
- "Set up the shell integration" → Read `references/shell-integration.md`, generate directly

- "Build a Content Fragment Console extension" → Read `references/aem-extensions.md` § CF Console, generate directly
- "Add a header menu button to the Universal Editor" → Read `references/aem-extensions.md` § Universal Editor, generate directly
- "Create an AEM extension with uix-guest" → Read `references/aem-extensions.md` § Core Registration, generate directly

If there is any ambiguity — multiple patterns could fit, constraints are unclear, or the user hasn't specified enough — fall through to the full workflow below.

## Quick Reference

- **UI entry point:** Place components in `web-src/src/components/`. This is the standard App Builder SPA layout.
- **Shell integration:** Always initialize with `@adobe/exc-app` and call `runtime.done()` to dismiss the loading spinner. See `references/shell-integration.md`.
- **Spectrum imports:** All components from `@adobe/react-spectrum`. See `references/spectrum-components.md` for the full catalog.
- **Routing:** Use `react-router-dom` for SPA navigation within the shell. See `references/routing-patterns.md`.
- **Backend calls:** Pass the shell's IMS token when calling App Builder actions. See `references/action-integration.md`.
- **Theming:** Wrap the app in `<Provider theme={defaultTheme}>` for Spectrum styling.
- **Accessibility:** All Spectrum components have built-in ARIA support. Add labels to interactive elements. See `references/checklist.md`.
- **Debugging:** For common issues (blank screen, CORS errors, auth failures, slow loads), see `references/debugging.md`.

## Full Workflow (for ambiguous or complex requests)

1. Read the user's project — check `web-src/` structure, React version, existing imports, routing setup, `app.config.yaml` for extension type
2. Confirm target outcome, constraints, and acceptance criteria with the user
3. Identify the UI pattern(s) needed from the quick-reference table above
4. Read the corresponding `references/` files for component guidance and annotated examples
5. Generate code that fits the user's existing conventions (not a generic template)
6. Wire into existing routing if React Router is present (`references/routing-patterns.md`)
7. Connect to backend actions if data fetching is needed (`references/action-integration.md`)
8. Validate against `references/checklist.md` before marking done
9. If the user reports issues, consult `references/debugging.md` for common SPA debugging scenarios
10. Summarize decisions, component choices, and any follow-up actions

## Example User Prompts

- "Add a page to my App Builder SPA that shows a data table."
- "Create a form for submitting customer data in my App Builder app."
- "Set up the Experience Cloud Shell integration for my App Builder app."
- "Add a confirmation dialog before deleting a record."
- "Build a navigation sidebar for my App Builder SPA."
- "My App Builder app needs a settings page with form fields."
- "Build a Content Fragment Console extension with an action bar button."
- "Add a custom RTE toolbar button in the Content Fragment Editor."
- "Create a Universal Editor extension with a header menu button."

## Inputs To Request

- Current repository path and `web-src/` structure
- Target UI pattern and specific data requirements
- Existing routing setup (if any)
- Backend action URLs for data fetching (if applicable)
- Non-functional constraints: accessibility requirements, responsive breakpoints

## Deliverables

- React Spectrum component files matching the user's project conventions
- Updated routing configuration (if applicable)
- Integration with backend actions (if applicable)
- Validation against quality checklist

## Quality Bar

- All generated components use React Spectrum — no custom CSS for standard patterns
- Shell integration includes `runtime.done()` call
- Interactive elements have accessible labels
- Loading and error states are handled
- IMS token passed correctly to backend action calls

## References

- Use `references/ui-patterns.md` for annotated UI pattern examples (page, form, table, dialog, navigation).
- Use `references/spectrum-components.md` for React Spectrum v3 component catalog with imports, props, and accessibility.
- Use `references/shell-integration.md` for ExC Shell integration (`@adobe/exc-app`, `runtime.done()`, IMS tokens).
- Use `references/routing-patterns.md` for SPA routing with React Router in ExC Shell.
- Use `references/action-integration.md` for calling backend actions from the SPA.
- Use `references/checklist.md` for pre-handoff UI quality validation.
- Use `references/aem-extensions.md` for AEM UI Extension patterns (`@adobe/uix-guest`, Content Fragment Console/Editor, Universal Editor, Assets View).
- Use `references/debugging.md` for common SPA debugging scenarios (shell spinner, CORS, auth, blank screen, performance).

## Chaining

- Chains FROM `appbuilder-project-init` (after SPA project is scaffolded with `dx/excshell/1` extension)
- Works alongside `appbuilder-action-scaffolder` for full-stack features (UI calls backend actions)
- Chains TO `appbuilder-testing` (test generated UI components)
- Chains TO `appbuilder-cicd-pipeline` (deploy frontend changes)
