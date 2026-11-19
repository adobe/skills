# Legacy Custom Component — Validation

After an approved change:
- Re-run the dry-run; the component must no longer report its prior classification, or must report `no files to change`.
- `richtext-overlay`: RTE plugin/`uiSettings` nodes preserved; dialog XML well-formed.
- `custom-parsys`: no remaining `resourceSuperType` pointing at legacy parsys; content under the component still resolves.
- Confirm no template (`/conf`, `templates/`) files were touched.
