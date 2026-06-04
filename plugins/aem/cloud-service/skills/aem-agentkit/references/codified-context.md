# Codified context — `.aem/context/*`

> **Beta Skill:** Outputs must be reviewed before applying to production.

This reference defines the schemas, discovery rules, and stability rules for
every file under `.aem/context/`.

## 1. Discovery scope

- **Components.** Walk `**/src/main/content/jcr_root/apps/**/components/**`
  in every FileVault content-package module (typically `ui.apps`, optionally
  `ui.apps.*` siblings). Do **not** index Core Components or anything under
  `/libs`. Key by full JCR path (e.g. `/apps/wknd/components/byline`) so
  duplicates across component groups stay distinguishable.
- **Sling Models, OSGi services, Sling Servlets.** Walk every module
  containing `src/main/java/**`. Exclude `target/`, `generated-sources/`,
  `out/`, `build/`, `node_modules/`.
- **Multiple HTL files per component.** Index the primary HTL file
  (`<componentname>.html` matching directory name) under `htlPath`; list
  others under `siblingHtmlFiles`.
- **Dialogs.** Index both `cq:dialog` and `cq:editConfig` when present.
- **Multi-adaptable Sling Models.** Include every adaptable in the entry.
- **Multi-impl services.** Each impl is its own entry; entries include
  `siblingImpls` (count of other impls of the same interface).
- **Symlinks.** Walk by logical path. Do not follow symlinks pointing
  outside the workspace root. Deduplicate inside-workspace symlinks via
  canonical inode.
- **Off-limits.** Never read `.cloudmanager/env*.json`,
  `.cloudmanager/secrets*`, `.env`, `.env.*`, `**/credentials*`,
  `**/*creds*`, `**/*secret*`, `**/*.pem`, `**/*.key`, `**/*.p12`, or
  anything inside `.git/` besides top-of-tree state.
- **Zero-X sanity.** If a `ui.apps` module exists but discovery returns
  zero components, treat as discovery error: emit a clear warning and
  do **not** overwrite an existing `components.json`. Same rule for
  `core/` with zero Java files.
- **Multi-module repos.** Discover from each module that exists. Repo
  with no `ui.apps` (decoupled / EDS) → `components.json` is an empty list
  with a `warningStubs` entry noting the layout.

## 2. Output stability

- JSON: 2-space indent, sorted keys at every level, LF line endings, final
  newline, UTF-8 no BOM.
- Markdown: LF line endings, final newline, UTF-8 no BOM, no trailing
  whitespace.
- `generatedAt` is ISO-8601 in UTC.
- Discovery enumerates with sorted directory listings.

## 3. `components.json`

```json
{
  "_generatedBy": "aem-agentkit",
  "_skillVersion": "0.1.0-beta",
  "schemaVersion": "1",
  "generatedAt": "2026-06-04T00:00:00Z",
  "warningStubs": [],
  "components": [
    {
      "componentGroup": "WKND - Content",
      "dialogFieldNames": ["name", "occupations"],
      "dialogPath": "ui.apps/src/main/content/jcr_root/apps/wknd/components/byline/_cq_dialog/.content.xml",
      "editConfigPath": null,
      "htlPath": "ui.apps/src/main/content/jcr_root/apps/wknd/components/byline/byline.html",
      "jcrPath": "/apps/wknd/components/byline",
      "resourceType": "wknd/components/byline",
      "siblingHtmlFiles": [],
      "slingModelFqcn": "com.adobe.aem.guides.wknd.core.models.Byline",
      "title": "Byline"
    }
  ]
}
```

Notes:
- `slingModelFqcn` is the interface (not impl) when both exist.
- `dialogFieldNames` is best-effort: extract `name="./<field>"` attributes
  from `cq:dialog`'s `.content.xml`.

## 4. `osgi-services.json`

```json
{
  "_generatedBy": "aem-agentkit",
  "_skillVersion": "0.1.0-beta",
  "schemaVersion": "1",
  "generatedAt": "2026-06-04T00:00:00Z",
  "warningStubs": [],
  "services": [
    {
      "configPids": [],
      "dsAnnotationsPackage": "org.osgi.service.component.annotations",
      "dsGeneration": "R7",
      "implFqcn": "com.adobe.aem.guides.wknd.core.services.impl.SomeServiceImpl",
      "implPath": "core/src/main/java/com/adobe/aem/guides/wknd/core/services/impl/SomeServiceImpl.java",
      "interfaceFqcn": "com.adobe.aem.guides.wknd.core.services.SomeService",
      "references": [
        {"interface": "org.apache.sling.api.resource.ResourceResolverFactory", "name": "resourceResolverFactory"}
      ],
      "siblingImpls": 0
    }
  ],
  "servlets": [
    {
      "implFqcn": "com.adobe.aem.guides.wknd.core.servlets.PermissionCheckServlet",
      "implPath": "core/src/main/java/com/adobe/aem/guides/wknd/core/servlets/PermissionCheckServlet.java",
      "registration": {
        "sling.servlet.methods": ["GET"],
        "sling.servlet.paths": ["/bin/wknd/permission-check"],
        "sling.servlet.resourceTypes": []
      }
    }
  ],
  "slingModels": [
    {
      "adaptables": ["org.apache.sling.api.SlingHttpServletRequest"],
      "modelFqcn": "com.adobe.aem.guides.wknd.core.models.Byline",
      "modelImplFqcn": "com.adobe.aem.guides.wknd.core.models.impl.BylineImpl",
      "modelPath": "core/src/main/java/com/adobe/aem/guides/wknd/core/models/impl/BylineImpl.java",
      "resourceType": "wknd/components/byline"
    }
  ]
}
```

DS generation detection:
- `org.osgi.service.component.annotations` → `R7`
- `org.apache.felix.scr.annotations` → `R6`
- Both in the same impl → `R6`, emit a TODO to migrate.

## 5. `conventions.md`

Sections (each cites ≥ 3 evidence pointers, otherwise becomes a TODO):

1. Package naming
2. Sling Model annotation style
3. OSGi DS annotation style
4. HTL naming
5. Logging style
6. Dispatcher includes
7. Build / verify commands (derived from Maven wrapper detection and
   `.cloudmanager/java-version`)

Evidence-pointer format: `<repo-relative-posix-path>:<1-based-line>`.

Soft size limit: 80 lines. Hard: 150. If derived rules exceed the budget,
truncate per-rule evidence to 3 pointers and append a TODO pointing at
`.aem/context/components.json` / `osgi-services.json` for the full sample
set.

## 6. `avoid.md`

Detected anti-patterns. Each entry has:
- Pattern name and one-line description.
- Where it was found (evidence pointer).
- Pointer to the supported replacement in the existing `best-practices`
  skill — do not duplicate that guidance.

Detection signals (initial set):

| Pattern | Signal |
|---|---|
| `Scheduler` + `Runnable` | imports `org.apache.sling.commons.scheduler.Scheduler` + `Runnable` in same class |
| JCR observation `EventListener` | implements `javax.jcr.observation.EventListener` |
| OSGi `EventHandler` (substantive) | implements `org.osgi.service.event.EventHandler` with non-trivial body |
| Direct `Replicator` call | uses `com.day.cq.replication.Replicator` |
| Legacy `AssetManager` create/remove | uses deprecated `com.day.cq.dam.api.AssetManager` ops |
| `getAdministrativeResourceResolver` | direct call |
| Felix SCR annotations | `org.apache.felix.scr.annotations` import |
| HTL redundant constant comparison | `data-sly-test` containing `== 'something'` or `=== 'something'` |

For each match, link to the existing pattern module in
`../best-practices/references/<file>.md`.

Soft: 60 lines. Hard: 120.

## 7. `glossary.md`

Domain disambiguation only. Extracted terms:
- Component `cq:title` values from `.content.xml` under
  `ui.apps/.../components/**/.content.xml`.
- Content Fragment model titles from
  `/conf/*/settings/dam/cfm/models/**/.content.xml`.
- Taxonomy node names from `ui.content/.../tags/**`.

Soft: 60. Hard: 120.

## 8. `test-patterns.md`

How this project writes tests. Derive from existing test sources:
- Test framework (JUnit 4 vs JUnit 5).
- AemContext usage (`io.wcm.testing.mock.aem.junit5.AemContextExtension`
  vs `SlingContextRule`).
- Mocking (Mockito vs other).
- Integration test client (`org.apache.sling.testing.clients`).

Each derivation cites ≥ 2 evidence pointers (tests are usually uniform so
fewer samples are needed).

Soft: 60. Hard: 120.

## 9. `aem-api-namespaces.md`

Static reference of canonical AEM as a Cloud Service API package roots
(`com.adobe.aem.*`, `com.adobe.cq.*`, `com.adobe.granite.*`,
`com.day.cq.*`, `org.apache.sling.*`, `org.osgi.service.component.annotations.*`,
SLF4J, JCR, etc.). Used by the "verify before import" guardrail so the
agent can sanity-check imports against a static list before fabricating
class names. Complements (does not replace) live Javadoc lookup.

Rendered from [`templates/aem-api-namespaces.md.template`](./templates/aem-api-namespaces.md.template).
The template is project-agnostic, so the rendered file is byte-identical
across repos — but it still carries a checksum-bearing marker so
idempotency rules apply uniformly.

## 10. `README.md` (context index)

Plain Markdown pointing at the indexes and the derived files. No
evidence pointers; just a navigation aid for humans.

## 11. Per-sub-project scope (nested AEM monorepos)

When `per-module-agents-md.md` detects a nested AEM project, the skill
also writes a scoped `.aem/context/` at that sub-project root. The
scoped indexes contain only that sub-project's components / services /
models / conventions. The shared root `.aem/context/` continues to
cover the whole monorepo for cross-cutting queries.

Subagents and rules reference whichever `.aem/context/` is closest to
the file under edit (sub-project context when working inside a
sub-project, root context otherwise).

## 12. Self-validation (this step only)

After writing all `.aem/context/*` files:
- Every evidence pointer resolves to an existing file (and line when given).
- Every `slingModelFqcn` in `components.json` resolves to an existing
  `.java` file.
- Every `implFqcn` in `osgi-services.json` resolves to an existing `.java` file.
- No file contains marketing language; framing stays factual.

Failure aborts the entire skill run; no partial outputs are left on disk.
