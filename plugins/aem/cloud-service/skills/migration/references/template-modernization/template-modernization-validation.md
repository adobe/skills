# Template Modernization — Post-Generation Validation

Run after every generation pass. Each rule below is an `rg` assertion; if the expected match count doesn't hold, fix before committing. Skip a section if no artifact of that type was generated this pass.

All paths are rooted at the workspace. `<uiApps>` / `<uiContent>` / `<uiConfig>` come from `.migration/template-context.yml#apps[*].paths`. Use the Grep tool (not raw `rg`).

## 1. Editable templates

1.1 **Template root shape** — `<uiContent>/.../conf/*/settings/wcm/templates/*/.content.xml` must contain `jcr:primaryType="cq:Template"`, non-empty `allowedPaths="[…]"`, `status="enabled"`, `cq:templateType=` (matching `conventions.templateType`), and must **not** contain `cq:lastModified(By)?`.

1.2 **Editable flag on structure (exactly once)** — `rg -c 'editable="\{Boolean\}true"' <uiContent>/.../templates/*/structure/.content.xml` → exactly `1` per file (or N when context confirms multiple editable zones). `cq:template` = the template's own `/conf` path. `sling:resourceType` on `jcr:content` = `structureComponent.path` in context. `<cq:responsive>/breakpoints` values = `conventions.breakpoints` verbatim (no invented numbers).

1.3 **No editable in initial** — `rg 'editable="\{Boolean\}true"' <uiContent>/.../templates/*/initial/.content.xml` → **zero matches**. Initial must also lack `<cq:responsive>` / `cq:deviceGroups`. Every `namedChildren` entry with `placement ∈ {initial, structure+initial}` must be present; every `placement: structure` (locked) entry must be absent.

1.4 **Policies mapping shape** — root `jcr:content` uses `sling:resourceType="wcm/core/components/policies/mappings"`; children use `…/mapping` (singular). Any referenced `cq:policy` path must resolve inside `/conf`.

1.5 **`templates/.content.xml` preservation** — hash before, hash after: every pre-existing `<childName/>` entry still present; only new names appended.

## 2. Structure rewrite rules

2.1 **XML** — root `jcr:primaryType="nt:unstructured"`; `staticTemplate` ∈ context `templates[*].static.path`; `editableTemplate` ∈ `templates[*].editable.path` where `editable.exists==true`; file name = template name.

2.2 **OSGi config** — `PageRewriteRule-<appId>-<tpl>.cfg.json` has keys `static.template`, `sling.resourceType`, `editable.template`, `container.resourceType`. `sling.resourceType` = `<appId>/components/structure/<tpl>` (folder must exist). `container.resourceType` = `wcm/foundation/components/responsivegrid` (**not** the app container).

2.3 **Service config** — exactly one `StructureRewriteRuleService.cfg.json`; every path in `search.paths` exists.

## 3. Component rewrite rules

3.1 **`cq:copyChildren` present on every rule (highest-impact check)** —
`rg -L 'cq:copyChildren="\{Boolean\}true"' <uiApps>/.../apps/*/modernization/component-rewrite-rules/*.xml` → **zero files listed**. Any file here is a content-destroying bug waiting to fire.

3.2 **Replacement resourceType** = `conventions.contentContainerResourceType` from context (the app's container, **not** `wcm/foundation/components/responsivegrid`).

3.3 **Pattern = source** — root `@sling:resourceType` equals `<patterns>/<parsys>/@sling:resourceType` (typically `wcm/foundation/components/parsys`).

3.4 **Service config** — if both PID and `Impl` files already exist, `search.paths` must match in both. New project: use the non-`Impl` PID only.

## 4. Policy import rules

4.1 **XML** — `design` ∈ `designs[*].path`; `policyPath` under `/conf/<appId>/settings/wcm/policies/`; one file per design.

4.2 **Both PIDs registered** — `PolicyImportRuleService.cfg.json` and `PolicyImportRuleServiceImpl.cfg.json` present with identical `search.paths`.

## 5. Repoinit

Exactly one `RepositoryInitializer-aem-modernize.cfg.json` project-wide. `scripts` contains `/var/aem-modernize` + the four `job-data/*` subpaths. Must **not** contain `$[secret:]` / `$[env:]` — repoinit has no interpolation.

## 6. Filter coverage

Any editable template generated → `<filter root="/conf/<appId>/settings/wcm/templates"/>` in `ui.content/META-INF/vault/filter.xml`. Any modernization rule generated → `<filter root="/apps/<appId>/modernization"/>` in `ui.apps/META-INF/vault/filter.xml`. Missing filters = files not packaged.

## 7. Cross-reference integrity (catches "locked in initial" automatically)

Reload `.migration/template-context.yml` and confirm for every template touched this pass:

- Newly-created editable → all four files present (`root`, `structure/`, `initial/`, `policies/`).
- Every `namedChildren` with `placement: structure` appears in structure XML and is **absent** from initial XML.
- Every `namedChildren` with `placement: initial` or `structure+initial` appears in initial XML.
- Every `existingRules.*.exists` that flipped to true has both the XML rule and its OSGi factory config.

This is the only step that mechanically catches "locked component placed in `initial/`" — without it, the bug surfaces post-deploy when existing pages render wrong.

## Report

Emit pass/fail counts per section plus a list of failing `<file> : <rule> : <expected vs actual>`. **Blocking**: any failure blocks commit.
