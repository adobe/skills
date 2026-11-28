# Star Choice Component

## Problem/Feature Description

Authors need a `ratingstars` component where the user picks one of five choices, like a radio group but shown as stars. Choices are authored in the dialog and the selected value is submitted with the form.

## Output Specification

Create the `ratingstars` core component, building on the closest existing options component. Include the Java model, HTL, dialog, clientlibs, tests and examples, and the registration it needs. Write `REPORT.md` at the repository root with the files created and edited, the model you copied and why, and which checks could not run.

## Input Files

The project root is a working copy of `adobe/aem-core-forms-components`, already in place (modules `bundles/af-core`, `ui.af.apps`, `examples`, `it`, `ui.tests/test-module`). Existing sibling components such as `textinput`, `radiogroup` and `panelcontainer` are present. Maven and network access may be unavailable; if a command cannot run, say so instead of claiming it passed.
