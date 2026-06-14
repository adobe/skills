# Guardrails — text and rationale

> **Beta Skill:** Outputs must be reviewed before applying to production.

Guardrails are embedded into each per-module `AGENTS.md` and each
tool-specific role artifact (Claude / Cursor / Copilot / Continue /
Cline / Windsurf / Augment). They are deliberately text-shaped — they
steer the agent through its system prompt, not through a runtime
interceptor. Customers who need machine-enforced rules wire those into
their own CI / pre-commit / MCP enforcement pipeline; the skill does
not ship a pre-edit hook.

The rules are deliberately tool-agnostic. They never name specific MCP
server packages, IDEs, or other skills.

## 1. Canonical guardrails block

This block appears verbatim near the top of every per-module `AGENTS.md`
and in `templates/roles/role.guardrails.md` (used to project Cursor /
Copilot / Continue / Cline / Windsurf / Augment artifacts):

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
- **Run `/regen-context` after writing code that produces indexable
  artifacts** (a new component, Sling Model, OSGi service, or servlet).
  Do not mutate `.aem/context/*.json` directly — the skill recomputes the
  marker checksum from the canonical body during regeneration.
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

## 3. Inter-skill contract for `.aem/context/*.json`

`.aem/context/components.json` and `.aem/context/osgi-services.json` are
**skill-owned, read-only between regenerations**. Sibling skills
(`create-component`, `best-practices`, `migration`, future skills that
touch the same indexes) MUST NOT mutate these files; instead they call
`/regen-context` (or have the customer call it) after any change to
the underlying source that would change the index content. This is the
single shared contract that keeps the marker mechanism honest across
the plugin's skill set. The same rule applies to `aem-agentkit` itself
— the slash commands and roles delegate to `/regen-context` rather
than mutating in place.
