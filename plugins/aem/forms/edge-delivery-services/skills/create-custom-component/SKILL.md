---
name: create-custom-component
description: "Create a custom form component for an AEM Forms Edge Delivery Services (Form block) project — scaffold blocks/form/components/<name>, extend an OOTB field type (text-input, drop-down, panel, etc.), define authoring properties in _<name>.json, wire the decorate function to the form model with subscribe(), register it in mappings.js, build, and validate the output. Use when a user asks to create, scaffold, build, or fix a custom form component, form field widget, or viewType in an aem-boilerplate-forms project."
license: Apache-2.0
metadata:
  version: "1.0.0"
---

# Create Custom Form Component

Build a custom component for the AEM Forms **Form block** on Edge Delivery Services end to end — scaffold, authoring schema, `decorate` logic, model subscriptions, registration, documentation — and **prove** it works before reporting done.

## When to use

- The project is a forms project derived from `aem-boilerplate-forms` (it has `blocks/form/`, `blocks/form/mappings.js`, `blocks/form/rules/index.js`).
- The user wants a new field widget/variant (slider, rating, OTP input, searchable dropdown, card choice, consent panel…) or wants to fix one under `blocks/form/components/`.

Not for: generic EDS blocks (use the EDS `building-blocks` skill), AEM Sites HTL components (`create-component` in `aem-cloud-service`), or rule-editor logic.

## References (read as needed)

| File | Read when |
|------|-----------|
| `references/custom-form-components.md` | Always — architecture, folder layout, JSON schema, registration |
| `references/form-field-types.md` | Step 4 — the base HTML the `element` parameter already contains |
| `references/authoring-field-types.md` | Step 3 — widgets for the properties dialog (`text`, `select`, `container`, …) |
| `references/subscribe-api.md` | Step 4 — `subscribe()` patterns: own value, child fields, custom events |
| `scripts/validate-component.mjs` | Step 8 — static validator (Node 18+, no dependencies) |
| `scripts/create-e2e-test.mjs` | Step 8 — generates the component's Playwright e2e test + form JSON |
| `scripts/run-e2e-test.mjs` | Step 8 — runs those tests with the project's own Playwright setup (Chromium, no retries) |
| `assets/e2e/form-harness.js` | Test harness copied into the project's e2e test folder by `create-e2e-test.mjs` |
| `scripts/preview-component.mjs` | Step 9: opens the component in a browser, with a live model inspector, for user feedback |
| `scripts/validate-registration.js` | Optional — in-page check on an already deployed form |

Paths under `scripts/`, `assets/` and `references/` are relative to this skill's directory; resolve them to absolute paths before running commands from the repository root.

---

## Workflow

### Step 1: Gather requirements

Run every command in this skill from the **repository root** — the directory containing `package.json` and `blocks/form/`. Do not `cd` into a subfolder (such as `code/`) first. Then confirm — ask only for what the request does not already answer:

| Question | Why |
|----------|-----|
| Component name | Folder, file names, and `fd:viewType` (lowercase kebab-case, e.g. `star-rating`) |
| Which OOTB field type does it extend? | Base HTML and AEM resource type |
| Which authorable properties does it need? | Fields in `_<name>.json` |
| What model state does it read/write, and when should `model.value` be committed? | Drives `subscribe` wiring and the README contract |
| Is it a panel that watches child fields, or does it react to custom events? | Selects the subscribe pattern |
| Expected behaviour to prove (what the user does, what the model should hold, how often rules fire) | Assertions of the e2e test in Step 8 |

Supported base types: `text-input`, `number-input`, `drop-down`, `button`, `checkbox`, `radio-group`, `checkbox-group`, `panel`, `date-input`, `multiline-input`, `file-input`, `email`, `telephone-input`.

Check the name is not already used: `blocks/form/components/<name>/` must not exist and `<name>` must not be in `mappings.js`.

### Step 2: Scaffold

If `package.json` has a `create:custom-component` script, run it from the repository root (install dependencies first if `node_modules` is missing):

```bash
npm run create:custom-component -- --name <name> --base <base-type>
```

It creates `blocks/form/components/<name>/{<name>.js,<name>.css,_<name>.json}` and usually also registers the component (mappings, `_form.json` filter, `models/_component-definition.json`). **Do not assume it did — Step 8 verifies.**

If the script does not exist, create the three files by hand: copy the base type's `blocks/form/models/form-components/_<base>.json`, set `definitions[0].id` and `models[0].id` to `<name>`, set `template["fd:viewType"]` to `<name>`, and fix `"..."` include paths so they resolve from the component folder (`../../models/form-common/...`).

### Step 3: Define authoring properties (`_<name>.json`)

Read `references/authoring-field-types.md` to choose the widget for each property. Add custom fields to `models[0].fields`; reuse shared field groups instead of redefining them:

```json
{ "...": "../../models/form-common/_basic-validation-fields.json#/fields" }
```

Rules: every field has `component` and a unique `name`; `select`/`multiselect`/`radio-group`/`checkbox-group` have `options`; keep `fieldType`, `resourceType`, and `fd:viewType` from the scaffold.

### Step 4: Implement `decorate`

Read `references/form-field-types.md` (base HTML) and `references/subscribe-api.md`, then pick the pattern:

| The component… | Use |
|----------------|-----|
| Reacts to its own value / enum / visible changes | `subscribe(fieldDiv, formId, cb, { listenChanges: true })` — handle `'register'` and `'change'` |
| Watches child fields (panel) | Same on the parent; inside `'register'`, `subscribe()` each child wrapper found with `[data-id="${child.id}"]` |
| Reacts to custom events (`custom:<event>`) | `fieldModel.subscribe(cb, '<event>')` inside `'register'` — never `fieldDiv.addEventListener` |

Implementation rules:

- `export default function decorate(fieldDiv, fieldJson, container, formId)` and `return fieldDiv`.
- Import `subscribe` from `'../../rules/index.js'`; relative imports always include `.js`.
- Read authored properties from `fieldJson.properties.<prop>`.
- Enhance the existing OOTB markup in `fieldDiv`; scope DOM queries to it.
- When writing the value from custom UI, either set `model.value` or dispatch `new Event('change', { bubbles: true })` on the underlying input.
- Guard against loops: never set `model.value` in a value-change handler without comparing first.
- Know when the value is committed. Out of the box, the form block writes `model.value` only from the input's native `change` event (`blocks/form/rules/index.js`), which text-like inputs fire on blur/commit, not on each keystroke. So rules on the field's change event run once per edit, when the user leaves the field. If the component must commit on every keystroke (live counters, search-as-you-type, values derived while typing), handle the `input` event in the component and set `model.value` there, comparing with the current value first. When reformatting the display while typing (masks, grouping), don't dispatch `change` on each keystroke, or you turn the blur commit into a per-keystroke one.
- Prefix CSS classes with the component name in `<name>.css`.

### Step 5: Register

1. `blocks/form/mappings.js` — add `<name>` to `customComponents` (or to `OOTBComponentDecorators` for OOTB-style decorators). Must exactly equal `fd:viewType`.
2. If the component has no stylesheet, add it to `NO_CSS_COMPONENTS` when the project defines that set; otherwise keep `<name>.css`.
3. `blocks/form/_form.json` — make sure `<name>` is in the `"form"` filter `components` so authors can insert it.
4. `models/_component-definition.json` — make sure the custom-components group includes `../blocks/form/components/<name>/_<name>.json#/definitions` (unless the project includes components by glob).
5. Repository lint limits: check the project's ESLint config (`.eslintrc.cjs`, `eslint.config.*`, …) for per-model limits. The xwalk config usually sets `'xwalk/max-cells'`: it limits each model in the built `component-models.json` to 4 cells unless the model id has its own entry. A form component inherits its base type's fields, so it needs one. Add `'<name>': <cells>` next to the existing entries. The validator (Step 8, gate A) reports the exact count after `npm run build:json`. Follow any other per-model lint options the repository defines the same way.

### Step 6: Document

Create `blocks/form/components/<name>/README.md` (use an existing component README as a model):

| Section | Required | Content |
|---------|----------|---------|
| `# <Component Name>` | Yes | One-line summary |
| `## How to Use` / `## Authoring Properties` | Yes | How to configure it; table of custom properties |
| `## Model Subscriptions` | If applicable | Model changes / custom events it listens to |
| `## Events Dispatched` | If applicable | Custom events it fires |
| `## Model Properties Set` | If applicable | What it writes and **when `model.value` is committed**: on blur/`change` (the OOTB default), per keystroke (component-handled `input`), or external only. Also how often the field's change rules fire |
| `## Usage Notes` | Yes | Base type, `fd:viewType`, key behaviour |

If the project keeps a component catalog (for example a `component-registry.md`), add a one-line row for the component too.

### Step 7: Build

```bash
npm run build:json
```

Merges component JSON into `component-models.json`, `component-definition.json`, and `component-filters.json`. Without it, new properties never reach the Universal Editor.

### Step 8: Validate (mandatory)

Do not report the component as done until gates A–D pass. Fix and re-run on failure.

**A. Static validation** — from the repository root:

```bash
node <skill-dir>/scripts/validate-component.mjs <name>
```

Checks folder/file naming, valid JSON, definition/model ids, `fd:viewType` = name, `fieldType`/`resourceType`, resolvable `"..."` includes, unique field names, ES-module syntax, default export, `subscribe` import path and `{ listenChanges: true }`, `.js` import extensions, legacy/anti-patterns (`fieldModel.subscribe(…, 'change')`, non-bubbling `change`, `#id` child selectors), README sections, registration in `mappings.js` / `_form.json` / `_component-definition.json`, whether the build output contains the component, and, when the ESLint config sets `xwalk/max-cells`, whether the built model's cell count fits its limit (it prints the entry to add). Exit `0` = no errors; `1` = errors (must fix); warnings must be fixed or explicitly justified in the report. Use `--json` for machine-readable output.

**B. Lint** — if `package.json` has a `lint` script, run `npm run lint` and fix every issue in the new/changed files.

**C. Build** — `npm run build:json` succeeds, and re-running gate A shows `build.json` passing.

**D. End-to-end test** — no deployed form or URL is needed. The harness renders a local EDS page whose form block holds a form JSON in `<pre><code>`, loads the project's `head.html` (`aem.js`, `scripts.js`) and serves the repository root, so the real form block, rule engine, `mappings.js` and the component run as in production.

1. Generate the test (add `--props '<json>'` for authored property values):

   ```bash
   node <skill-dir>/scripts/create-e2e-test.mjs <name> --props '{"maxStars":5}'
   ```

   It writes the tests into the repository's own Playwright test folder: `<testDir>/custom-components/form-harness.js` and `<testDir>/custom-components/<name>/{<name>.form.json,<name>.spec.js}`, where `<testDir>` comes from the repo's Playwright config (default `test/e2e`). Missing folders are created. A minimal root `playwright.config.mjs` is added only if the repo has no Playwright config. It warns if the test folder isn't excluded by `.hlxignore` (it would be published to Edge Delivery Services) or by ESLint. Relay those warnings to the user with the suggested lines; don't edit the ignore files unasked. The form JSON contains a field with `":type": "<name>"` plus a following text field. For panels, add the children the component expects; for rules, add `events`/`rules` to the JSON. Keep `action` ending in `/<form id>`: `createForm()` derives the `formId` passed to components from it, and on a mismatch `subscribe()` callbacks never fire.
2. Replace every `TODO` in the spec (they fail on purpose). Cover, with the harness helpers `renderForm`, `field`, `getModel`, `setModel`, `dispatchModelEvent`, `trackChanges`:
   - the component-specific markup after `data-component-status="loaded"`;
   - each authored property (re-render with a modified copy of the form JSON);
   - model → UI: `setModel(page, id, 'value', …)` (or `enum`, `visible`, …), then assert the component's UI;
   - UI → model: click/fill/type as a user, then assert `getModel` and, with `trackChanges`, how many `value` changes rules would see (e.g. exactly 1 for commit-on-complete);
   - custom events (`dispatchModelEvent(page, id, 'custom:<event>')`) and keyboard operation where relevant.
3. Run it from the repository root; all tests must pass with none skipped:

   ```bash
   node <skill-dir>/scripts/run-e2e-test.mjs <name>
   ```

   It runs the repo's own Playwright and config on that folder only, without retries and limited to the `chromium` project when the config has one. In other words: `npx playwright test <testDir>/custom-components/<name>/ --project=chromium --retries=0`. The tests become part of the repo's e2e suite, so they also run with its usual command (e.g. `npm run test:e2e`). If the repo's config fails to load, or doesn't exist, the runner falls back to a temporary standalone config (Chromium, no retries, written to the OS temp folder). For example, secure-bank's `globalSetup: … : null` is rejected by newer Playwright. The runner prints why; pass that on to the user so they can fix the repo config. The harness also fails a test on console errors from `/blocks/form/`, including exceptions thrown by `decorate()`: `mappings.js` swallows those and still marks the field `loaded`. If `@playwright/test` is missing (exit 2), install it as a dev dependency (`npm i -D @playwright/test && npx playwright install chromium`). If that is not possible, keep the spec, report the test as not run, and give the command.

`scripts/validate-registration.js` can additionally be evaluated on an already deployed form (`(<file contents>)('<name>')`) to confirm registration there.

### Step 9: Preview and collect feedback

Once gates A–D pass, let the user try the component before you finish.

1. Start the preview from the repository root **as a background process** (it keeps running):

   ```bash
   node <skill-dir>/scripts/preview-component.mjs <name>
   ```

   It renders the e2e form JSON (`<testDir>/custom-components/<name>/<name>.form.json`) in a local form block with the project's `aem.js`/`scripts.js`. If the project has `@playwright/test`, it opens a visible Chromium window. An inspector panel shows the field's live model (`value`, `valid`, `visible`, `enabled`, …) and a log of model changes. It prints `PREVIEW_URL=<url>`. Without Playwright or a display (or with `--no-browser`) it only serves the page, so give the user the URL to open. To preview other property values, edit the form JSON or pass `--form <file>`.
2. Tell the user the URL and what to try: each interaction, the authored properties, and keyboard use. Then ask, using the agent's question tool if it has one: does it look and behave as expected, and what should change?
3. For each piece of feedback: change the component, add or adjust e2e assertions for the new behaviour, re-run gates A–D, and ask the user to reload the page (files are served fresh on each request). Ask again.
4. Repeat until the user approves, then stop the preview process.

If the user can't be reached (non-interactive run), skip this step and say so in the report, with the preview command.

### Step 10: Report

Finish with: files created/changed, the validator summary (errors/warnings), lint and build results, the e2e results (passed/failed per test, or why it could not run), the preview feedback rounds and changes made (or why the preview was skipped), and any justified warnings.

---

## Quick reference: file locations

| File | Purpose |
|------|---------|
| `blocks/form/components/<name>/<name>.js` | Component logic (`decorate`) |
| `blocks/form/components/<name>/<name>.css` | Component styles |
| `blocks/form/components/<name>/_<name>.json` | Definition + authoring model |
| `blocks/form/components/<name>/README.md` | Component documentation |
| `blocks/form/mappings.js` | Registration (`customComponents`, `OOTBComponentDecorators`) |
| `blocks/form/_form.json` | `"form"` filter — which components authors can insert |
| `models/_component-definition.json` | Component palette (custom-components group) |
| `blocks/form/rules/index.js` | `subscribe` source |

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Folder name ≠ JS file name ≠ `fd:viewType` | All three must be identical |
| Not in `customComponents` | JS/CSS never load — validator `register.mappings` |
| `subscribe` without `{ listenChanges: true }` or legacy `fieldModel.subscribe(cb, 'change')` | Use the standard pattern in `references/subscribe-api.md` |
| Child field selected with `#id` | Use `[data-id="${child.id}"]` (the wrapper) |
| Custom event handled via `addEventListener` | `fieldModel.subscribe(cb, '<event>')` in `'register'` |
| `new Event('change')` without `{ bubbles: true }` | Change never reaches the form model |
| Setting `model.value` inside its own change handler | Compare before assigning |
| Assuming the model updates while the user types | OOTB commits on blur (`change`); handle `input` in the component if rules need each keystroke, and document it in `## Model Properties Set` |
| Dispatching `change` on every keystroke while formatting | Turns the blur commit into a per-keystroke one; let the native `change` commit, or commit deliberately |
| Forgot `npm run build:json` | Properties missing in the Universal Editor — validator `build.json` |
| No `xwalk/max-cells` entry for the new model | `npm run lint` fails with "Avoid using more than 4 cells"; add `'<name>': <cells>` to the ESLint config. Validator `lint.max-cells` gives the number |
| Reporting done without running Step 8 | Always run gates A–D; report any gate that could not run |
| Leaving the preview server running | Stop the background preview process once the user approves or the step is skipped |
| Trusting `data-component-status="loaded"` alone | It is set even when `decorate()` throws — the e2e harness checks the console |

## Example

**User:** "Create a star rating component based on number-input with a configurable maximum number of stars."

1. Scaffold `npm run create:custom-component -- --name star-rating --base number-input`.
2. `_star-rating.json`: add `{ "component": "number", "name": "maxStars", "label": "Maximum stars", "valueType": "number" }`.
3. `star-rating.js`: hide the number input, render `maxStars` buttons, set `model.value` on click, sync the selected stars on `'change'` of `value`, using `subscribe(..., { listenChanges: true })`.
4. Register in `mappings.js` / `_form.json`, write `README.md`, run `npm run build:json`.
5. `node <skill-dir>/scripts/validate-component.mjs star-rating` → `PASS: 0 error(s)`; `npm run lint` clean.
6. `node <skill-dir>/scripts/create-e2e-test.mjs star-rating --props '{"maxStars":5}'`, then write the spec: the stars render, `maxStars: 3` renders 3 stars, `setModel(… 'value', 4)` selects 4 stars, clicking star 3 sets the model to `3` with exactly one `value` change, keyboard Enter on a star works. Then `node <skill-dir>/scripts/run-e2e-test.mjs star-rating` → all passed.
