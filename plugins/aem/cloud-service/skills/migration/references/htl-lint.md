# htlLint flow

`{code-assessment}` is the `code-assessment` skill, next to this one: `../../code-assessment/` from this file.

`htlLint` does not use BPA CSV or CAM/MCP. Instead:

1. **Read** [`{code-assessment}/references/data-sly-test-redundant-constant.md`](../../code-assessment/references/data-sly-test-redundant-constant.md): its **Workflow**, the **Proactive Discovery** `rg` patterns and the four fix patterns.
2. **Discover** targets with those `rg` commands (scope: `ui.apps/**/jcr_root/**/*.html` or the user's content package paths), **group** the hits by file and **fix** each per its pattern section.
3. **Report**, and recommend that the user run `mvn clean install` or HTL validate to confirm that no warnings remain.
