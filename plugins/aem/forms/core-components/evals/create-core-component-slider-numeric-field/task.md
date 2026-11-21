# Slider Component for Calculator Forms

## Problem/Feature Description

Two calculator forms for a lending customer need a slider so applicants can choose an amount and a term, and the chosen numbers must feed the form's calculations. Today each form carries its own customer-specific slider code. The Forms team wants one reusable Adaptive Forms Slider core component instead.

Authoring:
- Authors can add the Slider to an Adaptive Form.
- The dialog configures minimum value, maximum value, step increment and default value.
- Standard field properties are supported: name, label, description or help text, required, disabled and read-only.
- The dialog validates its configuration: minimum must be less than maximum, step must be positive, and the default value must respect the configured range and step.

Runtime:
- Mouse, touch and keyboard interaction work.
- The current numeric value is displayed and updates as the slider moves.
- The value stays within the configured range and step increments.
- Disabled and read-only states are respected.
- Layout is responsive and the component works with the existing Core Components styling mechanisms.

## Output Specification

Create the `slider` core component with every file it needs and wire it so it is published with the other components. Write `REPORT.md` at the repository root listing the files created and edited, the sibling you copied and why, the commands you ran and their results, and every check you could not run with the exact command for the user.

## Input Files

The project root is a working copy of `adobe/aem-core-forms-components`, already in place (modules `bundles/af-core`, `ui.af.apps`, `examples`, `it`, `ui.tests/test-module`). Sibling components such as `numberinput` and `textinput` are present. Maven and network access may be unavailable; if a command cannot run, say so instead of claiming it passed.
