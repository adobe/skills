# URL Input Component

## Problem/Feature Description

The Forms team wants a dedicated `urlinput` form component that renders an `<input type="url">`, so authors can drop it into an Adaptive Form without configuring a text input by hand. It must behave like the other single-value fields.

## Output Specification

Create the `urlinput` core component with every file it needs and wire it into the build so it is published with the other components. When finished, write `REPORT.md` at the repository root listing the files created and edited, the commands you ran and their results, and every check you could not run with the exact command for the user.

## Input Files

The project root is a working copy of `adobe/aem-core-forms-components`, already in place (modules `bundles/af-core`, `ui.af.apps`, `examples`, `it`, `ui.tests/test-module`). Existing sibling components such as `textinput`, `radiogroup` and `panelcontainer` are present. Maven and network access may be unavailable; if a command cannot run, say so instead of claiming it passed.
