# AEM Modernization Rules — Structure / Component / Policy Rewrites

Generates rules for AEM Modernize Tools: structure rewrite (static → editable template pages), component rewrite (parsys → responsive grid), policy import (`/etc/designs/<name>` → `/conf/.../policies/`). Plus the one-per-project service configs and repoinit.

Inputs come from the confirmed `.migration/template-context.yml` — see [template-modernization-context.md](template-modernization-context.md). Each rule type runs independently for plan rows where its column is true. A row with **Create editable?** also true runs the editable generator first, same pass. Do not invent values here; if context still has `needs-user-confirm` / `missing`, stop.

---

## What This Pattern Does

Generates the three types of rules consumed by the **AEM Modernize Tools** package (`com.adobe.aem.aem-modernize-tools`):

| Rule Type | What it converts | Output location |
|-----------|-----------------|-----------------|
| **Structure Rewrite Rules** | Static template pages → editable template pages | `ui.apps/.../modernization/structure-rewrite-rules/` + `ui.config/.../osgiconfig/config.author/` |
| **Component Rewrite Rules** | Legacy `parsys` nodes → responsive grid containers | `ui.apps/.../modernization/component-rewrite-rules/` |
| **Policy Import Rules** | `/etc/designs/<design>` → `/conf/.../policies/` | `ui.apps/.../modernization/policy-import-rules/` |

Each rule type is independent. The user may ask for one, two, or all three in a session.

---

## Prerequisites — Read the Project First

**STOP. Before generating any file, ensure the confirmed context covers:**

1. **App ID(s):** Resolved `/apps/<appId>/` target and matching `ui.apps` / `ui.config` / `ui.content` paths.
2. **Static templates:** Template names, titles, and page structure resource types from the static templates in scope.
3. **Editable templates:** Whether each target template already exists under `/conf`.
4. **Existing structure rules:** Any existing files under `modernization/structure-rewrite-rules/`.
5. **Parsys / named children:** Inputs needed for component rewrite rules and rename / ignore decisions.
6. **App container resourceType:** The app's responsive grid container component.
7. **Existing component rewrite rules:** Any existing files under `modernization/component-rewrite-rules/`.
8. **Design paths:** `/etc/designs/` references and design names used by the project.
9. **Policy conf paths:** Existing `/conf/.../settings/wcm/policies/` trees per app.
10. **Existing service configs:** Any `com.adobe.aem.modernize.*.cfg.json` files already present.
11. **Repoinit initializer:** Whether `RepositoryInitializer-aem-modernize.cfg.json` already exists.

If any required field is ambiguous, unresolved, or still marked `needs-user-confirm` / `missing`, stop and resolve it before writing files.

---

## Sub-path A: Structure Rewrite Rules

Converts pages that use a static template to use an editable template. Requires two artifacts per template: an **XML rule node** (deployed via `ui.apps`) and an **OSGi factory config** (deployed via `ui.config`).

### A1 — XML rule node

**File path pattern:**
```
ui.apps/src/main/content/jcr_root/apps/<appId>/modernization/structure-rewrite-rules/<templateName>.xml
```

**Minimal format** (use for templates with no special container or component handling):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="nt:unstructured"
    jcr:title="Convert <appId> <templateName> static template to editable template"
    staticTemplate="/apps/<appId>/templates/<templateName>"
    editableTemplate="/conf/<appId>/settings/wcm/templates/<templateName>"/>
```

**Rules:**
- `jcr:primaryType` is always `nt:unstructured`
- `staticTemplate` = full JCR path to the existing static template node
- `editableTemplate` = full JCR path to the already-created editable template under `/conf`
- The file name (without `.xml`) must match the template name — used as the node name when installed

### A2 — OSGi factory config

**File path pattern:**
```
ui.config/src/main/content/jcr_root/apps/<appId>/osgiconfig/config.author/
  com.adobe.aem.modernize.structure.rule.PageRewriteRule-<appId>-<templateName>.cfg.json
```

**Minimal config** (templates with a simple single container, no special handling):
```json
{
  "static.template": "/apps/<appId>/templates/<templateName>",
  "sling.resourceType": "<appId>/components/structure/<templateName>",
  "editable.template": "/conf/<appId>/settings/wcm/templates/<templateName>",
  "container.resourceType": "wcm/foundation/components/responsivegrid"
}
```

**Optional properties — add only when discovered in the project:**

| Property | Type | When to add |
|----------|------|-------------|
| `ignore.components` | `String[]` | When the page structure component contains parsys slots that must **not** be converted (e.g. targeting, LiveSync config nodes) |
| `rename.components` | `String[]` | When a parsys node must be **renamed** in addition to being retyped. Format: `"oldName=newName"` per entry |
| `order.components` | `String[]` | When child components must be reordered after conversion. List component names in desired order |
| `remove.components` | `String[]` | When the static page structure component renders fixed structural elements (logo, nav, header) that are no longer rendered by the editable template's page component — list their `sling:resourceType` values. These orphaned nodes will be deleted from page content during conversion instead of being left as dead data. |

**How to determine `sling.resourceType`:**
- Read the page structure component under `/apps/<appId>/components/structure/<templateName>/`
- The `sling.resourceType` value is `<appId>/components/structure/<templateName>`
- Verify by checking that folder exists in `ui.apps`

**How to determine `container.resourceType`:**
- This is always the WCM foundation responsive grid: `wcm/foundation/components/responsivegrid`
- This is **not** the app's content container — it refers to the structure-level grid in the editable template

**How to detect `ignore.components`:**
- Read the structure component's HTL files under `ui.apps/…/components/structure/<templateName>/`
- Look for `sling:include` / `data-sly-resource` calls that reference non-content nodes (e.g. `targeting`, `LiveSyncConfig`, header/footer fixed zones)
- Any named child that is a fixed/structural element — not a parsys — should be ignored

**How to detect `rename.components`:**
- Compare child node names in the static template's page structure to the editable template's structure
- If a parsys is named `par` in the static template but the editable template expects `responsivegrid`, add `"par=responsivegrid"` to `rename.components`
- Only add when names actually differ

### A3 — Service registration config

Required once per app. Controls which folder the `StructureRewriteRuleService` scans for rule nodes.

**File path:**
```
ui.config/src/main/content/jcr_root/apps/<appId>/osgiconfig/config.author/
  com.adobe.aem.modernize.structure.StructureRewriteRuleService.cfg.json
```

```json
{
  "search.paths": [
    "/apps/<appId>/modernization/structure-rewrite-rules"
  ]
}
```

**Note:** If multiple apps share rules, add all paths to the array. Only one config file is needed — it covers all apps.

### A4 — Folder scaffold nodes

Each new folder under `modernization/` needs a `.content.xml` to set the JCR node type:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    jcr:primaryType="sling:Folder"
    jcr:title="<AppId> Structure Rewrite Rules"/>
```

Create `.content.xml` for `modernization/` itself and for `modernization/structure-rewrite-rules/` if they don't already exist.

---

## Sub-path B: Component Rewrite Rules

Converts legacy `wcm/foundation/components/parsys` nodes in page content to responsive grid containers. This runs **on content** (not on templates) via the AEM Modernize Tools UI.

### B1 — XML rule node

**File path pattern:**
```
ui.apps/src/main/content/jcr_root/apps/<appId>/modernization/component-rewrite-rules/<ruleName>.xml
```

A typical rule name is `parsys-to-container`.

**Format:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0"
          xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
          xmlns:cq="http://www.day.com/jcr/cq/1.0"
    jcr:primaryType="nt:unstructured"
    jcr:title="Convert wcm parsys to <appId> responsive grid container"
    sling:resourceType="wcm/foundation/components/parsys">
    <patterns
        jcr:primaryType="nt:unstructured">
        <parsys
            jcr:primaryType="nt:unstructured"
            sling:resourceType="wcm/foundation/components/parsys"/>
    </patterns>
    <replacement
        jcr:primaryType="nt:unstructured">
        <container
            jcr:primaryType="nt:unstructured"
            sling:resourceType="<appId>/components/content/container"
            layout="responsiveGrid"
            cq:copyChildren="{Boolean}true"/>
    </replacement>
</jcr:root>
```

**Rules:**
- `sling:resourceType` on the root node = the **source** type being matched (always `wcm/foundation/components/parsys`)
- `<patterns>/<parsys>` = the node pattern to match. Use `sling:resourceType="wcm/foundation/components/parsys"` to match any parsys
- `<replacement>/<container>` = the output node. `sling:resourceType` here is the **app's content container**, not the WCM grid
- `cq:copyChildren="{Boolean}true"` — **always include** this to preserve existing child content components inside the converted container
- The replacement node name (`container` in the example) is arbitrary — the actual JCR node name is preserved from the source

**How to determine the replacement `sling:resourceType`:**
- This is the app's own responsive grid container, e.g. `<appId>/components/content/container`
- Verify by searching for a component that extends `wcm/foundation/components/responsivegrid` or `core/wcm/components/container` in the app
- If multiple apps are in the project, each app needs its own component rewrite rule with its own `sling:resourceType`

**Multiple apps:** Create one rule file per app under each app's own `modernization/component-rewrite-rules/` folder. Register both search paths in the service config (see B2).

### B2 — Service registration config

**File path:**
```
ui.config/src/main/content/jcr_root/apps/<appId>/osgiconfig/config.author/
  com.adobe.aem.modernize.component.ComponentRewriteRuleService.cfg.json
```

```json
{
  "search.paths": [
    "/apps/<appId>/modernization/component-rewrite-rules"
  ]
}
```

**Multiple apps** — a single config file can list multiple search paths:
```json
{
  "search.paths": [
    "/apps/<appId1>/modernization/component-rewrite-rules",
    "/apps/<appId2>/modernization/component-rewrite-rules"
  ]
}
```

**Note:** There is also an `impl` variant PID (`ComponentRewriteRuleServiceImpl.cfg.json`) with the same `search.paths` property. If both PIDs are already present in the project, update both. If starting fresh, use the non-impl PID only.

### B3 — Folder scaffold nodes

Same pattern as A4 — create `.content.xml` for `modernization/component-rewrite-rules/` if absent:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    jcr:primaryType="sling:Folder"
    jcr:title="<AppId> Component Rewrite Rules"/>
```

---

## Sub-path C: Policy Import Rules

Maps legacy `/etc/designs/<designName>` to the new `/conf/<appId>/settings/wcm/policies/` tree. Required when pages use design dialogs or when the modernization tool needs a design-to-policy mapping to import dialog values.

### C1 — XML rule node

**File path pattern:**
```
ui.apps/src/main/content/jcr_root/apps/<appId>/modernization/policy-import-rules/<designName>.xml
```

**Format:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="nt:unstructured"
    jcr:title="Map <designName> to conf policy tree"
    design="/etc/designs/<designName>"
    policyPath="/conf/<appId>/settings/wcm/policies/<appId>"/>
```

**Rules:**
- `design` = the full JCR path to the existing design node under `/etc/designs/`
- `policyPath` = the target path under `/conf` where policies will be created/imported
- One rule per design node. If the project has multiple designs, create multiple rule files.

**When to skip policy import rules:**
- If the design node has no content (no clientlibs, no dialog values stored under it) the rule still establishes the mapping — include it
- If `/etc/designs` is not used at all in the project, skip this sub-path entirely

### C2 — Service registration config

Two config files are needed (both PIDs register the same service):

**File 1:**
```
ui.config/.../osgiconfig/config.author/
  com.adobe.aem.modernize.policy.PolicyImportRuleService.cfg.json
```

**File 2:**
```
ui.config/.../osgiconfig/config.author/
  com.adobe.aem.modernize.policy.impl.PolicyImportRuleServiceImpl.cfg.json
```

Both files have identical content:
```json
{
  "search.paths": [
    "/apps/<appId>/modernization/policy-import-rules"
  ]
}
```

### C3 — Folder scaffold nodes

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    jcr:primaryType="sling:Folder"
    jcr:title="<AppId> Policy Import Rules"/>
```

---

## Repoinit Initializer (required once per project)

The AEM Modernize Tools store job tracking data under `/var/aem-modernize/`. This path must be initialized by repoinit before any jobs can run.

**Check first:** Glob `**/osgiconfig/config.author/org.apache.sling.jcr.repoinit.RepositoryInitializer-aem-modernize.cfg.json`. If it exists, skip.

**If absent, create:**
```
ui.config/.../osgiconfig/config.author/
  org.apache.sling.jcr.repoinit.RepositoryInitializer-aem-modernize.cfg.json
```

```json
{
  "scripts": [
    "create path (sling:Folder) /var/aem-modernize\ncreate path (sling:Folder) /var/aem-modernize/job-data\ncreate path (sling:Folder) /var/aem-modernize/job-data/structure\ncreate path (sling:Folder) /var/aem-modernize/job-data/component\ncreate path (sling:Folder) /var/aem-modernize/job-data/policy\ncreate path (sling:Folder) /var/aem-modernize/job-data/full"
  ]
}
```

**Do not add `$[secret:]` or `$[env:]` placeholders to this file** — repoinit scripts do not support interpolation.

---

## Packaging in `ui.apps`

All XML rule nodes are deployed via `ui.apps`. Confirm the `filter.xml` (or `filters.xml`) for the `ui.apps` package includes the `modernization/` subtree.

**Expected filter entry:**
```xml
<filter root="/apps/<appId>/modernization"/>
```

If the filter is missing, add it. Do not add filters for `/var/aem-modernize` — that path is created by repoinit, not packaged.

---

## Output summary (what to report to the user)

After generating files, report:

```
Sub-path A — Structure Rewrite Rules
  XML rules created   : <list of templateName.xml files>
  OSGi configs created: <list of PageRewriteRule-*.cfg.json files>
  Service config      : StructureRewriteRuleService.cfg.json (created / already existed)

Sub-path B — Component Rewrite Rules
  XML rules created   : <list of ruleName.xml files per app>
  Service config      : ComponentRewriteRuleService.cfg.json (created / already existed)

Sub-path C — Policy Import Rules
  XML rules created   : <list of designName.xml files>
  Service configs     : PolicyImportRuleService.cfg.json + PolicyImportRuleServiceImpl.cfg.json

Repoinit initializer  : created / already existed
Filter entries        : added / already present

Review required:
  <list any ambiguous items, missing editable templates, or unknown design paths>
```

Post-generation: run sections 2–7 of [template-modernization-validation.md](template-modernization-validation.md). Section 3.1 (`cq:copyChildren` presence) is the highest-impact check — a missing flag silently destroys parsys children at conversion time.

---

## Critical rules

- **Read before writing** — use the confirmed context; if any required field is still `needs-user-confirm` / `missing`, stop
- **Do not recreate** existing rules — check for existing files before writing
- **Do not modify repoinit** — if the initializer already exists, leave it alone
- **Do not add placeholders** to repoinit scripts — interpolation is not supported there
- **One rule file per template** for structure rules — do not combine multiple templates into one XML node
- **`cq:copyChildren="{Boolean}true"` is mandatory** on component rewrite replacements — omitting it destroys existing content inside parsys
- **Ask before guessing** on `sling.resourceType`, container resourceType, or design paths — wrong values cause silent failures at runtime
- **Do not create editable templates here** — this generator only creates the rules that reference them; the templates themselves must already exist in `/conf`

Post-generation: run sections 2–7 of [template-modernization-validation.md](template-modernization-validation.md). Section 3.1 (`cq:copyChildren` presence) is the highest-impact check — a missing flag silently destroys parsys children at conversion time.
