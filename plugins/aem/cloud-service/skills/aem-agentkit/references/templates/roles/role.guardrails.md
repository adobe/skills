# Agentic workflow guardrails

Apply these rules to every change in this AEM as a Cloud Service repository. The rules are deliberately text-shaped — they steer the agent through its system prompt; machine enforcement (CI / pre-commit / MCP) is the customer's responsibility.

- **Search before create.** Before creating a component, model, service, or servlet, consult `.aem/context/components.json` and `.aem/context/osgi-services.json` (the closest scoped copy when working inside a nested AEM sub-project). Do not create duplicates.
- **Verify before import.** Before importing an AEM class, confirm it exists in the current AEM as a Cloud Service Javadoc. Do not invent class names.
- **Respect run-mode guards.** Preserve `isAuthor()`, `isPublish()`, and run-mode service-user configurations when refactoring or migrating patterns.
- **Never write under `/libs`.** Use `/apps` or `/conf/global/` overlays.
- **Stop on red.** A change is not complete until `mvn -B verify` (or `./mvnw -B verify` if a Maven wrapper exists) and `dispatcher/bin/validate.sh src` pass locally.
- **Run `/regen-context` after writing code that produces indexable artifacts** (a new component, Sling Model, OSGi service, or servlet). Do not mutate `.aem/context/*.json` directly — the skill recomputes the marker checksum from the canonical body during regeneration; inline mutation corrupts the marker.
- **Customer source files only.** Do not edit anything under `/libs`, Core Components packages, or vendor `target/` outputs.
- **Refuse on `truncated: true` indexes.** If any closest `.aem/context/*.json` has `truncated: true` at its top level, stop and surface the cap. The index is partial.

## Where to find context

- Conventions with evidence pointers: closest `.aem/context/conventions.md`
- Anti-patterns (with absolute Cloud Service documentation URLs): closest `.aem/context/avoid.md`
- Component catalog: closest `.aem/context/components.json`
- Sling Models / OSGi services / servlets: closest `.aem/context/osgi-services.json`
- Test patterns: closest `.aem/context/test-patterns.md`
- Domain glossary: closest `.aem/context/glossary.md`
- Per-module focused context: `<module>/AGENTS.md`
- Run manifest (every file the last run wrote + every heuristic decision): `.aem/context/.agentkit-manifest.json` (workspace root only)
- Heuristic overrides: `.aem/agentkit-overrides.yml` (workspace root, customer-authored)

The "closest" `.aem/context/` is the one nearest to the file under edit when walking up the directory tree — sub-project-scoped when inside a nested AEM project, workspace-root otherwise.
