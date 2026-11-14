# EDS personalization contract (vendored)

Copies of the JSON Schemas and the pilot baseline of the **EDS Personalization Contract v0.5**
(proposal, agreed for a bounded pilot), commit `9d004e2` (2026-11-10). The contract is the spec
this skill implements; these files are its machine-checkable part.

| File | Used by |
|---|---|
| `schemas/section.schema.json` | `validate-placeholders.mjs` (every personalized section) |
| `schemas/site-config.schema.json` | `validate-placeholders.mjs` (the JSON part of `config.js`) |
| `schemas/decision-request.schema.json`, `decision-response.schema.json`, `decision-feedback.schema.json` | Tests of `contract.js`, the OF1 adapter and the feedback beacon |
| `schemas/measurement-event.schema.json` | `verify-preview.mjs` (every `pzn:*` event of a run) and the tests |
| `schemas/target-offer.schema.json` | Tests of the Target sources |
| `pilot-scenarios.json` | `verify-preview.mjs --scenarios` (default file) and the tests |

Do not edit them here. When the contract changes, copy the new files over, run `npm test`, and
update the skill where the tests fail.
