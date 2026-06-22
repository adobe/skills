# code-assessment

Single AEM as a Cloud Service **code-quality** skill: detects and fixes code issues entirely against the local workspace — no external services.

- Name the files to fix, or ask it to scan the repo and find issues itself.
- It plans, applies surgical edits (git branch or in-place), and verifies with `mvn compile`.

Patterns are **self-contained expert skills** (one subdirectory each):

- [`outdated-dependencies/`](outdated-dependencies/SKILL.md) — Maven version upgrades.
- [`inject-in-sling-model/`](inject-in-sling-model/SKILL.md) — `@Inject` → injector-specific annotations.

The runbook and contracts live in [`references/`](references/): `runbook.md` (the run procedure),
`git-workflow.md`, `shared-principles.md`, `troubleshooting.md`, `_template.md`.

See [`SKILL.md`](SKILL.md) for routing and classification.
