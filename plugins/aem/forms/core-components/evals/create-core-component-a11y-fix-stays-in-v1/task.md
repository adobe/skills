# Accessibility Bug in Text Input Errors

## Problem/Feature Description

A screen reader user reports that the error message of `textinput` v1 is not announced when validation fails. A colleague suggests creating `textinput` v2 to ship the fix.

## Output Specification

Decide where the fix belongs and make it. Write `DECISION.md` at the repository root with the decision, the reason, the files you changed, and the checks you ran or could not run.

## Input Files

The project root is a working copy of `adobe/aem-core-forms-components`, already in place (modules `bundles/af-core`, `ui.af.apps`, `examples`, `it`, `ui.tests/test-module`). Existing sibling components such as `textinput`, `radiogroup` and `panelcontainer` are present. Maven and network access may be unavailable; if a command cannot run, say so instead of claiming it passed. The repository's `docs/architecture/component-versioning.md` is present.
