# Per-module `AGENTS.md` generator

> **Beta Skill:** Outputs must be reviewed before applying to production.

This reference defines how the skill produces per-module `AGENTS.md` files.
The root `AGENTS.md` is **not** written by this skill — it is owned by
`ensure-agents-md`.

## 1. Discovery (recursive — handles nested AEM monorepos)

Per-module `AGENTS.md` generation walks the **AEM project tree**, not a
flat module list. Many real customer repos (e.g. multi-brand monorepos)
have a root pom whose `<modules>` are themselves full AEM archetypes.

Algorithm:

1. Read the root `pom.xml` `<modules>` section. For each `<module>`,
   confirm the directory exists. If a declared module's directory is
   missing, emit a `warningStubs` entry (`"declared module <name> has no
   directory; skipped"`) and continue with the rest. Do not abort.
2. For each present module, decide its **shape**:
   - **Nested AEM project** (sub-project) — the module is itself a full
     AEM archetype. Detection: the module's own `pom.xml` declares
     `<modules>` AND at least 2 of the following buckets appear as
     either sibling directories or sub-modules — `core`, `ui.apps` (or
     `ui.apps.structure`, counted as the same bucket), `ui.config`,
     `ui.content`, `ui.frontend`, `all`. The two-bucket threshold avoids
     misclassifying a skinny `ui.apps` + `ui.apps.structure`-only module
     as a sub-project.
   - **Leaf module** — otherwise.
3. For a **leaf module**, write `<module>/AGENTS.md` using the matching
   per-module template (§ 3 below).
4. For a **nested AEM project**:
   - Write `<module>/AGENTS.md` using
     [`templates/AGENTS.subproject.md.template`](./templates/AGENTS.subproject.md.template).
     This file is a sub-project overview: lists its modules, build
     commands, and pointers to its archetype-leaf files.
   - Recurse into `<module>` and apply step 2 again for the
     sub-project's own modules. Per-archetype-leaf files are written
     at `<module>/<sub-module>/AGENTS.md` (e.g. for a nested AEM project named `brand-site`, `brand-site/core/AGENTS.md`).
5. Recursion is bounded to 3 levels to prevent runaway behavior on
   pathological repos. When the depth cap is reached and additional
   nested AEM sub-projects exist beyond it, emit a `warningStubs` entry
   naming each truncated path (`"nested AEM project at <path> beyond
   3-level recursion cap; not bootstrapped"`) so the customer can re-run
   the skill from that directory if they want full coverage.
6. Git submodules at any level are out of scope — do not descend into
   them. The skill must be re-run from each submodule's root by the
   customer when they want per-archetype-leaf files there too.

### Top-level module-name collisions across nested AEM sub-projects

When two nested AEM sub-projects share a leaf name (e.g.
`brand-site-a/core` and `brand-site-b/core`):

- `.aem/context/components.json` keys by full JCR path, so component
  entries stay disambiguated.
- Per-module `AGENTS.md` files live under their own sub-project
  directory (`brand-site-a/core/AGENTS.md`, `brand-site-b/core/AGENTS.md`),
  so they do not collide.
- The **per-tool layer** (Cursor `globs:`, Copilot `applyTo`) is
  workspace-root scoped, so a glob like `**/ui.apps/**` matches both
  sub-projects. The agent therefore cannot disambiguate `brand-site-a`
  from `brand-site-b` from the rule alone. In this case the rule body
  defers to `.aem/context/conventions.md` and the per-sub-project
  `.aem/context/` for any sub-project-specific conventions; the
  guardrails block tells the agent to read whichever `.aem/context/` is
  closest to the file under edit.

### Discovery side-effects on the rest of the layer

- **Per-sub-project `.aem/context/`** — for each detected nested AEM
  project, the skill **also writes a scoped `.aem/context/`** at that
  sub-project root. The scoped indexes contain only that sub-project's
  components / services / models / conventions. The shared root
  `.aem/context/` continues to cover the whole monorepo for cross-cutting
  queries.
- Per-tool artifacts (`.claude/agents/`, `.cursor/rules/`,
  `.github/instructions/`, `.continue/rules/`) remain at the workspace
  root — they are project-scoped and shared across the whole
  monorepo. The role prompts reference whichever `.aem/context/` is
  closest to the file under edit (sub-project context when working inside
  a sub-project, root context otherwise).

### Custom-module heuristic (when name doesn't match a known archetype)

For top-level modules whose names don't match the standard AEM archetype
(`<brand>-frontend`, `<brand>-checkstyle`, `analyse`, `tools`, and similar
customer-specific names), the skill detects the module's purpose from its
`pom.xml` and content:

| Signal | Inferred purpose | Template |
|---|---|---|
| `pom.xml` references `maven-checkstyle-plugin` or `maven-enforcer-plugin` as primary build goal | Code quality / enforcement | `templates/AGENTS.module.code-quality.md.template` |
| `pom.xml` references `frontend-maven-plugin` and module name matches `*-frontend*` | Custom frontend | `templates/AGENTS.module.ui.frontend.md.template` (variant: custom) |
| `pom.xml` has `<packaging>pom</packaging>` and no archetype sub-modules | Analysis / scripting | `templates/AGENTS.module.analysis.md.template` |
| Otherwise | Unknown | `templates/AGENTS.module.generic.md.template` |

## 2. Module catalog

See [`module-catalog.md`](./module-catalog.md) for module descriptions and
add-on detection.

## 3. Per-module template selection

| Module | Template |
|---|---|
| `core` | [`templates/AGENTS.module.core.md.template`](./templates/AGENTS.module.core.md.template) |
| `ui.apps` | [`templates/AGENTS.module.ui.apps.md.template`](./templates/AGENTS.module.ui.apps.md.template) |
| `ui.apps.structure` | [`templates/AGENTS.module.generic.md.template`](./templates/AGENTS.module.generic.md.template) (variant: structure) |
| `ui.config` | generic (variant: config) |
| `ui.content`, `ui.content.sample` | generic (variant: content) |
| `ui.frontend` | [`templates/AGENTS.module.ui.frontend.md.template`](./templates/AGENTS.module.ui.frontend.md.template) |
| `dispatcher` | [`templates/AGENTS.module.dispatcher.md.template`](./templates/AGENTS.module.dispatcher.md.template) |
| `it.tests` | [`templates/AGENTS.module.it.tests.md.template`](./templates/AGENTS.module.it.tests.md.template) |
| `ui.tests` | [`templates/AGENTS.module.ui.tests.md.template`](./templates/AGENTS.module.ui.tests.md.template) |
| `all` | generic (variant: aggregator) |
| **Nested AEM project** (per § 1 detection) | [`templates/AGENTS.subproject.md.template`](./templates/AGENTS.subproject.md.template) |
| Any other | generic (variant: unknown) |

## 4. Required sections in every per-module `AGENTS.md`

In this order:

1. **Marker comment** (first content line).
2. **Title:** `# <module name>`
3. **Module purpose** (1–2 lines from the template).
4. **Agentic workflow guardrails** — compact block (5 bullets max) referencing the `.aem/context/*` indexes. Same content across modules — see [`guardrails.md`](./guardrails.md).
5. **Common entry points** — short bullet list of canonical files / paths in the module (max 8 entries; soft 40 lines, hard 80).
6. **Module-local conventions** — bullets derived from `.aem/context/conventions.md` filtered for this module. Each cites at most one evidence pointer (full set in `conventions.md`).
7. **What to avoid in this module** — short list pointing at `.aem/context/avoid.md`.
8. **Build / verify** — module-relevant commands (using `mvnw` if present, plain `mvn` otherwise).
9. **Pointer to the relevant `.aem/context/*` file**.

## 5. Build command resolution

| Signal | Effect |
|---|---|
| `mvnw` present at workspace root | Use `./mvnw` instead of `mvn` everywhere |
| `.cloudmanager/java-version` present | Read first line, strip whitespace, validate against `^(8\|11\|17\|21\|25)$`. Pass → insert "Build with Java N" line. Fail → emit `warningStubs` entry and omit the line. |
| `dispatcher` module exists | Add `cd dispatcher && ./bin/validate.sh src` in the dispatcher module file |
| `ui.frontend` exists | Add `cd ui.frontend && npm run build` / `npm start` in that module file |

`mvnw` (Maven wrapper) and `dispatcher/bin/validate.sh` are
customer-supplied executables. The skill recommends invoking them but
does not vouch for their contents. Reviewers should treat changes to
these files as security-sensitive.

## 6. Size budgets

| Artifact | Soft | Hard |
|---|---|---|
| Per-module `AGENTS.md` | 40 lines | 80 lines |

If a derived list would exceed the soft limit, truncate and append a TODO
pointing at the index for the full set.

## 7. Self-validation

After writing all per-module `AGENTS.md`:
- Every cited evidence pointer resolves.
- Every per-module file corresponds to an existing directory.
- No file contains marketing language.
