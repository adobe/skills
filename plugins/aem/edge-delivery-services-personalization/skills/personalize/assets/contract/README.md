# Schemas and pilot scenarios

The JSON Schemas of the shapes this skill reads and writes (sections, site config, decision API
requests, responses and feedback, measurement events, Target offers), and the pilot baseline
scenarios. They are the machine-checkable part of the skill's rules.

| File | Used by |
|---|---|
| `schemas/section.schema.json` | `validate-placeholders.mjs` (every personalized section) |
| `schemas/site-config.schema.json` | `validate-placeholders.mjs` (the JSON part of `config.js`) |
| `schemas/decision-request.schema.json`, `decision-response.schema.json`, `decision-feedback.schema.json` | Tests of `contract.js`, the OF1 adapter and the feedback beacon |
| `schemas/measurement-event.schema.json` | `verify-preview.mjs` (every `pzn:*` event of a run) and the tests |
| `schemas/target-offer.schema.json` | Tests of the Target sources |
| `pilot-scenarios.json` | `verify-preview.mjs --scenarios` (default file) and the tests |

Change them only together with the runtime: run `npm test` and update the skill where the tests
fail.
