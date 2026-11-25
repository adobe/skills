# Reskin outputs

What a reskin run writes, by path.

| Path | Purpose |
|---|---|
| `stardust/canon-source/` | Donor capture + descriptive DESIGN.md/json (extract `--design-source`, unchanged; or `figma-donor.mjs` for Figma) |
| `stardust/canon-source/foundation/`, `{role,module}-candidates.json`, `spec-tables.json` | Figma donor only: normalized Figma values with node ids, and the candidates the agent curates from |
| `stardust/reskin/curation-rules.json` | Figma donor only: the authored rules, the one non-mechanical `curate` input |
| `stardust/reskin/donor-tokens.json` | Curated probe-able token sheet, pinned to one reference page |
| `stardust/reskin/donor-modules.md` | Enumerated donor module vocabulary (M1..Mn) with screenshot evidence |
| `stardust/reskin/content-model/<slug>/content-model.json` | Byte-oriented per-page content model (+ source screenshot) |
| `stardust/reskin/normalize/<slug>.mjs` | Per-page executable normalization ledger (shared capture ↔ gates) |
| `stardust/reskin/mapping.md` | The mapping brief: every slot → donor module, status, rationale |
| `stardust/reskin/mapping.json` | Per-section decisions the renderer reads |
| `stardust/reskin/renderers/<archetype>.mjs` | Programmatic renderers (model in, HTML out) |
| `stardust/reskin/pages/<slug>.html` | Rendered reskin pages |
| `stardust/reskin/reports/` | Per-page gate reports + screenshots |
| `stardust/reskin/figma-checks/<slug>.json`, `deltas/<slug>.json` | Figma checks (d); declared preview differences (e) |
| `stardust/reskin/ledger.json` | Per-page status, gate results, residuals |
| `stardust/scripts/reskin/` | Project-local copies of the skill scripts |
| `stardust/.work/reskin/` | Git-ignored: Figma REST cache, frame PNGs, per-leg gate evidence |
