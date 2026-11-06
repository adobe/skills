# AEM Forms

Skills for building with **AEM Forms on Edge Delivery Services** — the Form block from [`aem-boilerplate-forms`](https://github.com/adobe-rnd/aem-boilerplate-forms).

```bash
/plugin install aem-forms@adobe-skills
```

## Skills

| Skill | Description |
|-------|-------------|
| [`create-custom-component`](skills/create-custom-component/SKILL.md) | Create a custom form component that extends an OOTB field type: scaffold, authoring schema (`_<name>.json`), `decorate` + `subscribe()` model wiring, registration in `mappings.js`, README, `build:json`, and validation |

## Validating generated components

`create-custom-component` treats validation as a required step, layered the same way other code-generating skills in this repo do (structural checks → lint/build → runtime in a browser):

| Gate | How | Required |
|------|-----|----------|
| A. Static validation | `node skills/create-custom-component/scripts/validate-component.mjs <name> [--root <project>] [--json]` — deterministic checks of naming, JSON schema, `fd:viewType`, `"..."` includes, JS conventions, registration, and build output. Exit `1` on errors | Yes |
| B. Lint | `npm run lint` in the forms project | Yes, if the project defines it |
| C. Build | `npm run build:json`, then re-run gate A | Yes |
| D. Runtime | Open a form using the component (e.g. `aem up` → `http://localhost:3000/...`) and evaluate `scripts/validate-registration.js` with any browser tool; check console and model/DOM sync | When a form URL or browser is available; otherwise reported as not run |

The validator has unit tests:

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
| `commit-value-on-complete` | Commit `model.value` only when entry is complete; README contract for rule authors |
| `repair-unregistered-star-rating` | Diagnose and fix a broken component (naming, viewType, registration, includes, legacy patterns) and report verification |
| `searchable-dropdown-authoring-schema` | Universal Editor widget choice, shared-field reuse, runtime `enum` updates |
