# Agentic workflow guardrails

Apply these rules to every change in this AEM as a Cloud Service repository. They are advisory but reduce the most common failure modes for coding agents.

- **Search before create.** Before creating a component, model, service, or servlet, consult `.aem/context/components.json` and `.aem/context/osgi-services.json`. Do not create duplicates.
- **Verify before import.** Before importing an AEM class, confirm it exists in the current AEM as a Cloud Service Javadoc. Do not invent class names.
- **Respect run-mode guards.** Preserve `isAuthor()`, `isPublish()`, and run-mode service-user configurations when refactoring or migrating patterns.
- **Never write under `/libs`.** Use `/apps` or `/conf/global/` overlays.
- **Stop on red.** A change is not complete until `mvn -B verify` (or `./mvnw -B verify` if a Maven wrapper exists) and `dispatcher/bin/validate.sh src` pass locally.
- **Honor the indexes after writing code.** When you add a new component, model, service, or servlet, append the new entry to the corresponding `.aem/context/*.json` file and update its marker checksum.
- **Customer source files only.** Do not edit anything under `/libs`, Core Components packages, or vendor `target/` outputs.

## Where to find context

- Conventions with evidence pointers: `.aem/context/conventions.md`
- Anti-patterns to avoid: `.aem/context/avoid.md`
- Component catalog: `.aem/context/components.json`
- Sling Models / OSGi services / servlets: `.aem/context/osgi-services.json`
- Test patterns: `.aem/context/test-patterns.md`
- Domain glossary: `.aem/context/glossary.md`
- Per-module focused context: `<module>/AGENTS.md`
