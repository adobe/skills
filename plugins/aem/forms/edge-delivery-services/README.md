# AEM Forms on Edge Delivery Services

Skills for building forms with **AEM Forms on Edge Delivery Services** — the Form block from [`aem-boilerplate-forms`](https://github.com/adobe-rnd/aem-boilerplate-forms).

```bash
/plugin install aem-forms-edge-delivery-services@adobe-skills
```

## Skills

| Skill | Description |
|-------|-------------|
| [`create-custom-component`](skills/create-custom-component/SKILL.md) | Create a custom form component that extends an OOTB field type: scaffold, authoring schema (`_<name>.json`), `decorate` + `subscribe()` model wiring, registration in `mappings.js`, README, `build:json`, and validation |

## Validating generated components

`create-custom-component` treats validation as a required step, layered the same way other code-generating skills in this repo do (structural checks → lint/build → browser end-to-end test):

| Gate | How | Required |
|------|-----|----------|
| A. Static validation | `node skills/create-custom-component/scripts/validate-component.mjs <name> [--root <project>] [--json]` — deterministic checks of naming, JSON schema, `fd:viewType`, `"..."` includes, JS conventions, registration, build output, and the repository's `xwalk/max-cells` lint limit for the new model. Exit `1` on errors | Yes |
| B. Lint | `npm run lint` in the forms project | Yes, if the project defines it |
| C. Build | `npm run build:json`, then re-run gate A | Yes |
| D. End-to-end | `node skills/create-custom-component/scripts/create-e2e-test.mjs <name>` generates a Playwright spec and form JSON in the repo's Playwright test folder (`<testDir>/custom-components/`, default `test/e2e`). The harness renders the form JSON in a local form block (`<pre><code>`) with the project's `aem.js`/`scripts.js` — no deployed form or URL. The agent fills in model ↔ UI, authored-property and keyboard assertions and runs `node skills/create-custom-component/scripts/run-e2e-test.mjs <name>` (the repo's own Playwright config, Chromium, no retries; a minimal config is added only if the repo has none, and a temporary standalone config is used if the repo's config fails to load) | Yes; reported as not run only if Playwright cannot be installed |

After the gates pass, the skill opens the component for you to try (`skills/create-custom-component/scripts/preview-component.mjs <name>`): a Chromium window, or a local URL, rendering the form JSON with a live model inspector. It then asks for your feedback and iterates until you approve.

The validator, e2e generator and preview have unit tests:

```bash
node --test plugins/aem/forms/edge-delivery-services/tests/*.test.mjs
```

## Evals

Tessl eval scenarios live in [`evals/`](evals) (`task.md` + `criteria.json` weighted checklists) and run on PRs via a commit starting with `eval:` (see [CONTRIBUTING](../../../../CONTRIBUTING.md#requesting-evals)).

| Scenario | What it measures |
|----------|------------------|
| `range-slider-from-number-input` | End-to-end component: files, `fd:viewType`, authoring model, `subscribe` with `listenChanges`, registration, README, honest validation report |
| `panel-watches-child-checkboxes` | Panel component subscribing to child fields via `[data-id]` wrappers |
| `custom-event-verification-badge` | Custom events through `fieldModel.subscribe(cb, '<event>')`, not DOM listeners |
| `commit-value-per-keystroke` | OOTB commits on blur; the component commits on each keystroke (formatted display, raw value) and documents the contract |
| `repair-unregistered-star-rating` | Diagnose and fix a broken component (naming, viewType, registration, includes, legacy patterns) and report verification |
| `searchable-dropdown-authoring-schema` | Universal Editor widget choice, shared-field reuse, runtime `enum` updates |
