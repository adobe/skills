# Template Modernization — Discovery & Context

Shared discovery for editable-template creation and AEM Modernize Tools rule generation. Runs once; both downstream generators consume the same output.

**Output:** `.migration/template-context.yml` — echoed to the user for `confirmed` reply before anything generates. Add `.migration/` to `.gitignore`.

## Schema

```yaml
apps:
  - id: <appId>
    paths: { uiApps, uiContent, uiConfig }                    # relative
    conventions:
      contentContainerResourceType: <appId>/components/content/container  # or needs-user-confirm
      breakpoints: [ { name, width, title }, ... ]            # or source: needs-user-confirm
      templateType: /conf/<appId>/settings/wcm/template-types/page       # or missing
    templates:
      - name: <templateName>
        static: { path, jcrTitle, allowedPaths, pageResourceType, pageResourceTypeExists }
        editable: { path, exists }
        structureComponent:
          path: <relative> | missing
          namedChildren:
            - { name, source: "file:line", resourceType,
                classification: parsys | locked | required-runtime | initial-only | unknown,
                presentOnExistingPages: true | false | unknown,
                placement: structure | structure+initial | initial | runtime-only | needs-user-confirm,
                reason }
        existingRules: { structure: {exists, path}, component: {...}, policy: {...} }
    designs:  [ { path: /etc/designs/<name>, referencedBy: [<templateName>...] } ]
    contentScan: { performed: bool, sampledPagesPerTemplate: N }
```

Every field is required. Unknown values use the literal sentinel `needs-user-confirm` (or `missing`, `unknown`). No silent defaults.

## Discovery steps

1. **Apps.** `pom.xml` / filevault plugin configs → `apps[*].id` + `paths`. No POM: first directory under `**/jcr_root/apps/`.
2. **Conventions.** Per app: breakpoints from any existing `/conf/<appId>/.../templates/*/structure/.content.xml#cq:responsive`; content container from `ui.apps` grep of `layout="responsiveGrid"` on a `/apps/<appId>/components/content/*` component; template type from `/conf/<appId>/settings/wcm/template-types/page/.content.xml` existence. Missing → `needs-user-confirm` / `missing`. Do not hardcode 768/1200.
3. **Static templates.** Glob `**/jcr_root/apps/<appId>/templates/*/.content.xml` → `templates[*].static.*`. Verify `pageResourceType` folder exists → `pageResourceTypeExists`.
4. **Existing editable templates.** Glob `**/jcr_root/conf/<appId>/.../templates/*/.content.xml`, match by folder name → `editable.exists` per template.
5. **Structure components + classify named children (combined).** For each template where `pageResourceTypeExists`: read HTL/JSP for `data-sly-resource` / `sling:include` / `cq:include` calls. For each named child, classify **by this table** (first matching row wins):

    | Signal | classification | placement |
    |---|---|---|
    | resourceType is `wcm/foundation/components/parsys` / `responsivegrid` or `core/wcm/components/container` | `parsys` | `structure` |
    | Child appears on ≥1 page under `/content/<appId>` (step 6) | `locked` | `structure` |
    | resourceType prefix `cq/` or well-known runtime name (`targeting`, `LiveSyncConfig`, …) | `required-runtime` | `initial` |
    | In static template `jcr:content` but absent from `/content` scan | `initial-only` | `initial` |
    | No signal resolves | `unknown` | `needs-user-confirm` (prompt once per distinct child before generation) |

    Cite provenance in `reason` (e.g. `"/content/<appId>/us/en/.content.xml has header → locked"`). **This classification is what replaces "don't put locked components in initial/" — data-driven, not judgement.**

6. **Content scan (drives step 5).** Glob `**/jcr_root/content/<appId>/**/.content.xml` up to 20 pages/template. For each page whose `cq:template` matches an in-scope static template, record which named children appear. No `/content` subtree → `contentScan.performed = false`; unresolved children → `needs-user-confirm`.
7. **Existing rules + designs.** Glob `**/apps/<appId>/modernization/{structure,component,policy}-rewrite-rules/*.xml` and OSGi configs under `config.author/`. Grep `/etc/designs/` in `ui.apps` + `ui.config` → `designs[*]`.
8. **Emit + confirm.** Write YAML → show to user → ask: *"Confirm this context. Flag any `needs-user-confirm` / `missing`. Reply `confirmed` to proceed."* Do not proceed until every such field is resolved.

## Plan table

From the confirmed context, derive one row per template:

| Template | Create editable? | Create structure rule? | Create component rule? | Create policy rule? |
|---|---|---|---|---|
| … | `!editable.exists` | `!existingRules.structure.exists` | `!existingRules.component.exists && has-parsys-child` | `has-design && !existingRules.policy.exists` |

Show the table, get a second `confirmed`, then execute per-row. Rows are independent — a row with all four columns true runs all four generators in one pass; a failure on row Y does not block row X.

Post-execute: run [template-modernization-validation.md](template-modernization-validation.md).
