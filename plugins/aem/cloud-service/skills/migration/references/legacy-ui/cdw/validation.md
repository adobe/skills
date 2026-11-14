# Custom Classic Widget (CDW) — Post-Remediation Validation

Run after every CDW conversion pass. `<appRoot>` = `ui.apps/src/main/content/jcr_root/apps/<appId>`.

## 1. No custom xtypes remain in affected dialogs

1.1 **No remaining CDW xtypes** — for each xtype processed this session:
`rg 'xtype="<xtype>"' <appRoot>/components/` → **0 matches**. Blocking.

1.2 **No `cq:Widget` primary types in `_cq_dialog` folders** (session-affected components only) — for each `<componentRoot>` in `affectedComponents` from `.migration/cdw-context.yml`:
`rg 'jcr:primaryType="cq:Widget"' --glob '**/_cq_dialog/**' <componentRoot>/` → **0 matches**. Blocking. (Scope to affected components only — do not scan all of `<appRoot>` as this would flag pre-existing unconverted components outside this session.)

## 2. Custom Granite UI components present (scaffold-custom-component only)

2.1 **Component `.content.xml` exists** —
`ls <appRoot>/components/granite/form/<xtype-kebab>/.content.xml` → **file present**. Blocking.

2.2 **`sling:resourceSuperType` is `granite/ui/components/coral/foundation/form/field`** —
`rg 'sling:resourceSuperType="granite/ui/components/coral/foundation/form/field"' <appRoot>/components/granite/form/<xtype-kebab>/.content.xml` → **1 match**. Blocking. Without this, form value handling is broken.

2.3 **Clientlib category registered** —
`rg '<appId>.<xtype-kebab>.dialog' <appRoot>/clientlibs/clientlib-<xtype-kebab>/.content.xml` → **1 match**. Non-blocking.

2.4 **Dialog references clientlib** —
For each affected `_cq_dialog/.content.xml`: `rg 'extraClientlibs' <file>` → **1 match**. Non-blocking.

## 3. Known-mapping path: correct resource type set

3.1 **Replaced resource type present** — for each apply-mapping xtype:
`rg 'sling:resourceType="<coral3Equivalent.resourceType>"' <affected dialog files>` → **≥1 match**. Blocking.

## 4. filter.xml coverage (scaffold-custom-component only)

4.1 **Scaffold component path is in a filter root** —
`rg 'apps/<appId>/components/granite/form/<xtype-kebab>' ui.apps/src/main/content/META-INF/vault/filter.xml` → **≥1 match**. Blocking. The scaffold component will not be deployed if its path falls outside every `<filter root>`.

4.2 **Clientlib path is in a filter root** —
`rg 'apps/<appId>/.*clientlib.*<xtype-kebab>' ui.apps/src/main/content/META-INF/vault/filter.xml` → **≥1 match**. Blocking.

## 5. Developer action items (always surface)

- Scaffold components requiring HTL / JS implementation: list paths.
- `optionsProvider` shells requiring servlet: list paths.
- Listener sidecars requiring clientlib migration: list paths.
