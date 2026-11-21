# Phone Input Missing From Published Build

## Problem/Feature Description

A developer finished the files of a `phoneinput` component a while ago. Authors report two problems: in the component browser it appears under the raw group name `.core-adaptiveform` instead of `Core Adaptive Form`, and on a published form the phone field has no behaviour because its script is not in the shared runtime bundle.

## Output Specification

Find and fix every wiring defect in `ui.af.apps` without rewriting the component or changing its version. Do not add the Java model, tests or examples. Write `FIX-REPORT.md` at the repository root listing each defect (file and cause), the fix, and how it was verified.

## Input Files

The project root is a working copy of `adobe/aem-core-forms-components`, already in place, with a `phoneinput` component folder copied in under `ui.af.apps/src/main/content/jcr_root/apps/core/fd/components/form/phoneinput/`. Only the wiring outside that folder was never done: `ui.af.apps/pom.xml` has no line for it and `core-forms-components-runtime-all` does not embed its clientlib. The Java model, tests, examples and Cypress spec are out of scope for this task. Maven and network access may be unavailable; if a command cannot run, say so instead of claiming it passed.
