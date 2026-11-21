# AEM Forms Core Components

Skills for building server-side Adaptive Forms components in [`adobe/aem-core-forms-components`](https://github.com/adobe/aem-core-forms-components).

```bash
/plugin install aem-forms-core-components@adobe-skills
```

## Skills

| Skill | Description |
|-------|-------------|
| [`create-core-component`](skills/create-core-component/SKILL.md) | Create a new Adaptive Forms Core Component (Sling Model, HTL, dialog, clientlibs, tests, examples) in a working copy of `aem-core-forms-components` and wire it into the build and runtime clientlibs. |

## Validating generated components

`create-core-component` treats validation as required, in gates:

| Gate | How | Required |
|------|-----|----------|
| A. Static validation | `node skills/create-core-component/scripts/validate-component.mjs <name> --root <checkout>`: naming, Sling Model, HTL, dialog, clientlibs, `pom.xml` replace line, runtime-all embed, README, Cypress spec. Exit `1` on errors | Yes |
| B. Unit test | `mvn -pl bundles/af-core test -Dtest=<Name>ImplTest` | Yes, if Maven is available |
| C. Accessibility | `references/accessibility-checklist.md` | Yes |
| D. Cypress | spec under `ui.tests/test-module/specs/<name>/`; needs a running AEM | Reported as not run when there is no instance |

The validator has unit tests:

```bash
node --test plugins/aem/forms/core-components/tests/*.test.mjs
```

## Evals

Scenarios in [`evals/`](evals) (`task.md` + `criteria.json`) run on PRs through a commit starting with `eval:` (see [CONTRIBUTING](../../../../CONTRIBUTING.md#requesting-evals)).
