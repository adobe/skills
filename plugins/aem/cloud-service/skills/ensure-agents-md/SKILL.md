---
name: ensure-agents-md
description: |
  **Run FIRST (before any other skill or task)** when workspace root has no AGENTS.md and the repo
  is an AEM Cloud Service project. Creates AGENTS.md and CLAUDE.md (tailored via pom.xml). Applies on
  every user request until AGENTS.md exists — not only the first chat. Never overwrites existing files.
license: Apache-2.0
compatibility: AEM as a Cloud Service projects (Java stack, Maven, Dispatcher).
---

# Ensure AGENTS.md and CLAUDE.md (bootstrap)

## Mandatory order (all cases)

**Before** any other work — including dispatcher, create-component, code edits, MCP, or answers — the agent MUST:

1. Check whether **`AGENTS.md` exists at the workspace (repository) root**.
2. If it **exists** → skip this skill entirely and continue with the user’s request.
3. If it **does not exist** and the repo is an AEM Cloud Service project (see Gate check) → **run this skill completely first** (create `AGENTS.md` and `CLAUDE.md` if missing), **then** fulfill the user’s original request.

This applies to **every** user message and **any** intent (bugs, features, questions, dispatcher, etc.) until `AGENTS.md` is present. Do not defer bootstrap to “after” the main task.

It creates **AGENTS.md** and **CLAUDE.md** at the repository root so every AI coding agent (Claude Code, Cursor, etc.) gets project guidance, optionally tailored using the module catalog and add-on detection.

## Gate check

1. Look for `AGENTS.md` at the **workspace root**. If it exists → skip, move on.
2. Verify this is an AEM Cloud Service project: root `pom.xml` exists and references
   `com.adobe.aem:aem-sdk-api` or `aem-project-archetype` or contains `<modules>` with
   typical AEM module names (`core`, `ui.apps`, `dispatcher`, etc.).
   If not an AEM project → skip.

## Steps

### 1. Resolve project name

Check in order:
- Root `pom.xml` → `<name>` element (preferred, usually human-readable).
- Root `pom.xml` → `<artifactId>`, then humanize: strip leading `aem-`, replace `-` with spaces,
  title-case (e.g. `aem-guides-wknd` → `WKND`, `my-site` → `My Site`).
- Directory name of the workspace.
- Fallback: `"AEM Cloud Service Project"`.

### 2. Discover modules

Read root `pom.xml` `<modules>` section. For each `<module>`, confirm the directory actually exists.
Build a list of present modules.

### 3. Detect add-ons and frontend type

Scan the project for:

| Signal | Add-on / variant |
|---|---|
| `pom.xml` depends on `cif-connector` or `aem-core-cif-components` | **CIF (Commerce)** |
| `ui.frontend/package.json` contains `react` or `@adobe/aem-react-editable-components` | **React SPA** |
| `ui.frontend/package.json` contains `@angular/core` or `@adobe/aem-angular-editable-components` | **Angular SPA** |
| `ui.frontend` has no `clientlib.config.js` and pom.xml references `frontend-maven-plugin` but outputs no clientlibs | **Decoupled frontend** |
| `pom.xml` depends on `aem-forms-*` or `forms.core` | **AEM Forms** |
| Module `ui.frontend.react.forms.af` exists | **Headless Forms** |
| `pom.xml` uses `precompiled-scripts-provider` | **Precompiled Scripts** |

If none of these are detected, treat as **General Webpack** frontend (the default archetype).

### 4. Generate AGENTS.md

Read the template at [references/AGENTS.md.template](./references/AGENTS.md.template).
Apply the following adaptations:

#### a. Title
Replace `{{PROJECT_NAME}}` with the resolved project name.

#### b. Add-ons section
If any add-ons were detected (CIF, Forms, Headless Forms, Precompiled Scripts), insert an
**"Add-ons and extensions"** section after the intro paragraph. Use descriptions from the
[references/module-catalog.md](./references/module-catalog.md) add-ons table. If none detected, omit
the section entirely.

#### c. Modules section
Only include modules that **actually exist** in the project. For each module, use the matching
description from the [module catalog](./references/module-catalog.md). Pay attention to:
- `ui.frontend` — use the variant that matches the detected frontend type (General, React, Angular, Decoupled).
- `dispatcher` — only include if the `dispatcher` directory exists.
- `it.tests` / `ui.tests` — only include if they exist.

#### d. Build commands
- Include frontend commands (`npm run build`, `npm start`) only if `ui.frontend` exists.
- Include dispatcher validate command only if `dispatcher` module exists.
- For React/Angular SPA, note that `npm start` requires AEM running.

#### e. Important resources
Always include the base resources from the template. Additionally:
- If React or Angular SPA detected → add SPA Editor and framework-specific resources (see module catalog).
- If CIF detected → add Commerce resources.
- If Forms detected → add Forms resources.
- If Decoupled frontend → add Frontend Pipeline resource.

### 5. Create CLAUDE.md

If `CLAUDE.md` does **not** exist at the workspace root, create it with exactly this content (so Claude/Cursor picks up project guidance):

```
@AGENTS.md
```

Do not overwrite an existing `CLAUDE.md`.

### 6. Inform the user

Briefly tell the user:
> "I created `AGENTS.md` and `CLAUDE.md` in your project root with guidance tailored to your project structure. These help AI coding agents understand your project."

Then continue with the user's original request.

## Reference files

| File | Purpose |
|---|---|
| [references/AGENTS.md.template](./references/AGENTS.md.template) | Base template with `{{PROJECT_NAME}}` placeholder and all default sections |
| [references/module-catalog.md](./references/module-catalog.md) | Module descriptions, add-on descriptions, conditional resources — the source of truth for adapting the template |

## Rules

- **Never overwrite** an existing `AGENTS.md` or `CLAUDE.md`. Only create when missing.
- **Never hallucinate modules**. Only list modules whose directories actually exist.
- Keep the generated AGENTS.md clean — no skill metadata, no comments about "generated by skill".
- Project name should be human-readable (e.g. "WKND Sites Project", "My Site"), not only a raw artifactId unless that is the desired title.
- **Do not** add sections that tell agents to use specific MCP servers, Cursor/Claude skills, or how to discover tools. Coding assistants pick those up from product configuration and tool metadata; if something is not discovered, fix metadata or MCP setup — do not duplicate that in AGENTS.md.
- The resource links must point to `experienceleague.adobe.com/en/docs/experience-manager-cloud-service/...`
  (Cloud Service URLs), never to AEM 6.5 URLs.
