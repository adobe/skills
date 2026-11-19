# Legacy Custom Component — Validation

- Re-run the dry-run (`node scripts/legacy-component-planner.js <root>`). It must report no project file changes, and `git status` must show none.
- Rich Text handoffs: validate with [dialog/validation.md](../dialog/validation.md) after the dialog converter runs, then confirm `rtePlugins` / `uiSettings` / `htmlRules` survived in the `_cq_dialog`. Overlays: confirm every affected component's `cq:dialog` carries the configuration before the overlay is retired. No script was rewritten or deleted.
- Parsys (`convert-parsys-supertype`): only the `sling:resourceSuperType` value in that component's `.content.xml` changed. Authored pages still render their children. Allowed components and styles resolve from `/conf` policies on the affected templates.
- Confirm no template (`/conf`, `templates/`) files were touched.
