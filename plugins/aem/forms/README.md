# AEM Forms

Skills for building **AEM Forms**, grouped by platform:

- `skills/edge-delivery-services/`: forms on Edge Delivery Services (the Form block from [`aem-boilerplate-forms`](https://github.com/adobe-rnd/aem-boilerplate-forms))
- `skills/core-components/`: Adaptive Forms built with Core Components (no skills yet)

```bash
/plugin install aem-forms@adobe-skills
```

## Skills

### Edge Delivery Services

| Skill | Description |
|-------|-------------|
| [`create-custom-component`](skills/edge-delivery-services/create-custom-component/SKILL.md) | Create a custom form component that extends an OOTB field type: scaffold, authoring schema (`_<name>.json`), `decorate` + `subscribe()` model wiring, registration in `mappings.js`, README, `build:json`, and validation |

## Validating generated components

`create-custom-component` treats validation as a required step, layered the same way other code-generating skills in this repo do (structural checks → lint/build → browser end-to-end test):

| Gate | How | Required |
|------|-----|----------|
| A. Static validation | `node skills/edge-delivery-services/create-custom-component/scripts/validate-component.mjs <name> [--root <project>] [--json]` — deterministic checks of naming, JSON schema, `fd:viewType`, `"..."` includes, JS conventions, registration, and build output. Exit `1` on errors | Yes |
| B. Lint | `npm run lint` in the forms project | Yes, if the project defines it |
| C. Build | `npm run build:json`, then re-run gate A | Yes |
| D. End-to-end | `node skills/edge-delivery-services/create-custom-component/scripts/create-e2e-test.mjs <name>` generates a Playwright spec and form JSON under `test/e2e/custom-components/`. The harness renders the form JSON in a local form block (`<pre><code>`) with the project's `aem.js`/`scripts.js` — no deployed form or URL. The agent fills in model ↔ UI, authored-property and keyboard assertions and runs `node skills/edge-delivery-services/create-custom-component/scripts/run-e2e-test.mjs <name>` (project's `@playwright/test` + the skill's own Playwright config — no config needed in the project) | Yes; reported as not run only if Playwright cannot be installed |

The validator and the e2e generator have unit tests:

```bash
node --test plugins/aem/forms/tests/*.test.mjs
```

## Evals

Tessl eval scenarios live in [`evals/`](evals) (`task.md` + `criteria.json` weighted checklists) and run on PRs via a commit starting with `eval:` (see [CONTRIBUTING](../../../CONTRIBUTING.md#requesting-evals)).

| Scenario | What it measures |
|----------|------------------|
| `range-slider-from-number-input` | End-to-end component: files, `fd:viewType`, authoring model, `subscribe` with `listenChanges`, registration, README, honest validation report |
| `panel-watches-child-checkboxes` | Panel component subscribing to child fields via `[data-id]` wrappers |
| `custom-event-verification-badge` | Custom events through `fieldModel.subscribe(cb, '<event>')`, not DOM listeners |
| `commit-value-per-keystroke` | OOTB commits on blur; the component commits on each keystroke (formatted display, raw value) and documents the contract |
| `repair-unregistered-star-rating` | Diagnose and fix a broken component (naming, viewType, registration, includes, legacy patterns) and report verification |
| `searchable-dropdown-authoring-schema` | Universal Editor widget choice, shared-field reuse, runtime `enum` updates |
