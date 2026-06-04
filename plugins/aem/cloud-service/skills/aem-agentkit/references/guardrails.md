# Guardrails — text and rationale

> **Beta Skill:** Outputs must be reviewed before applying to production.

Guardrails are embedded into each per-module `AGENTS.md` and each
tool-specific role artifact (Claude / Cursor / Copilot / Continue). They
are **advisory** in this beta release — text, not enforcement.
Deterministic enforcement (pre-edit hook, MCP check tool) is on the v2
roadmap.

The rules are deliberately tool-agnostic. They never name specific MCP
server packages, IDEs, or other skills.

## 1. Canonical guardrails block

This block appears verbatim near the top of every per-module `AGENTS.md`
and in `templates/roles/role.guardrails.md` (used to project Cursor /
Copilot / Continue artifacts):

```markdown
## Agentic workflow guardrails

- **Search before create.** Before creating a component, model, service, or
  servlet, consult `.aem/context/components.json` and
  `.aem/context/osgi-services.json`. Do not create duplicates.
- **Verify before import.** Before importing an AEM class, confirm it exists
  in the current AEM as a Cloud Service Javadoc. Do not invent class names.
- **Respect run-mode guards.** Preserve `isAuthor()`, `isPublish()`, and
  run-mode service-user configurations when refactoring or migrating
  patterns.
- **Never write under `/libs`.** Use `/apps` or `/conf/global/` overlays.
- **Stop on red.** A change is not complete until the project build (`mvn`
  or `./mvnw -B verify`) and `dispatcher/bin/validate.sh src` pass locally.
- **Honor the indexes after writing code.** When you add a new component,
  model, service, or servlet, append the new entry to the corresponding
  `.aem/context/*.json` file and update its marker checksum.
- **Customer source files only.** Do not edit anything under `/libs`, Core
  Components packages, or vendor `target/` outputs.
```

## 2. Compressed block (per role)

Each authoring role's canonical source opens with:

```markdown
Before any other action, read AGENTS.md, the relevant per-module
AGENTS.md, and the index files under .aem/context/ that apply to your
role. Apply every rule under "Agentic workflow guardrails".
```

This is enough on its own — the agent then loads the full block from
AGENTS.md / per-module AGENTS.md, which has the canonical text.

## 3. Rationale

- "Search before create" — the most common hallucination is duplicating an existing component or service under a slightly different name.
- "Verify before import" — coding agents invent plausible-sounding AEM class names. The Javadoc is authoritative.
- "Respect run-mode guards" — common refactoring mistake to remove `isAuthor()` blocks when migrating patterns.
- "Never write under `/libs`" — the most expensive Cloud Service mistake.
- "Stop on red" — local verification is fast and prevents pipeline waste.
- "Honor the indexes" — keeps the codified context current between explicit `/regen-context` runs.
