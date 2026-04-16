# App Builder Template Catalog & Post-Init Playbook

Each section covers one template: when to use it, what it generates, and what to customize after initialization.

## @adobe/generator-app-excshell

| Field | Value |
| --- | --- |
| Extension Point | dx/excshell/1 |
| Categories | action, ui |
| Runtime | nodejs:22 |

**Best for:** General-purpose App Builder apps that need both a web UI (hosted inside Adobe Experience Cloud shell) and backend serverless actions. This is the default when the user's intent is unclear.

**Use when the user says:** "Create an App Builder app", "SPA with actions", "Experience Cloud app", "dashboard app", "app with UI and backend"

**Generated structure:**

```
src/dx-excshell-1/
  ext.config.yaml              # Extension manifest with runtimeManifest
  actions/
    generic/index.js           # Sample action with IMS auth
    utils.js                   # Shared action helpers
  web-src/
    index.html
    src/
      components/App.js        # React Spectrum app shell
      components/Home.js
      components/SideBar.js
      components/ActionsForm.js
      components/About.js
      exc-runtime.js
      index.js
      index.css
  test/
    generic.test.js
    utils.test.js
  e2e/
    generic.e2e.test.js
```

**Key config (**`ext.config.yaml`**):**

```yaml
operations:
  view:
    - type: web
      impl: index.html
actions: actions
web: web-src
runtimeManifest:
  packages:
    dx-excshell-1:
      license: Apache-2.0
      actions:
        generic:
          function: actions/generic/index.js
          web: 'yes'
          runtime: nodejs:22
          inputs:
            LOG_LEVEL: debug
          annotations:
            require-adobe-auth: true
            final: true
```

### Post-init customization

1. **Add custom actions.** The template creates a single `generic` action. Add more via:`.augment/skills/appbuilder-project-init/scripts/init.sh add-action "<name>"`Register each in `ext.config.yaml` under `runtimeManifest.packages.dx-excshell-1.actions`.
2. **Configure action inputs.** In `ext.config.yaml`, add environment-specific inputs:`inputs: LOG_LEVEL: debug API_KEY: $API_KEY BACKEND_URL: $BACKEND_URL annotations: require-adobe-auth: true final: true`Set corresponding values in `.env`.
3. **Headless variant (no frontend).** If the user only wants Runtime actions, remove the generated UI after init:`rm -rf src/dx-excshell-1/web-src/`Then remove `web: web-src` and any `operations.view` / `impl: index.html` entries from `src/dx-excshell-1/ext.config.yaml`. A headless project should not keep frontend files or stale web manifest references.
4. **Update the React UI.** Edit components under `web-src/src/components/`:

- `App.js` — main router; add new routes
- `Home.js` — landing page content
- `SideBar.js` — navigation; add entries for new pages
- `ActionsForm.js` — form for invoking actions; adapt to new action names

1. **Remove unused files.** Delete `ActionsForm.js` if the generic action form isn't needed. Remove `About.js` if not needed.
2. **Set runtime version.** Ensure all actions use `runtime: nodejs:22`.

## @adobe/aem-cf-admin-ui-ext-tpl

| Field | Value |
| --- | --- |
| Extension Point | aem/cf-console-admin/1 |
| Categories | action, ui |

**Best for:** Extending the AEM Content Fragment Admin Console with custom action bars, header menus, or panels.

**Use when the user says:** "AEM extension", "Content Fragment console", "AEM CF admin", "extend AEM UI", "AEM content fragment"

### Post-init customization

1. **Define extension points.** Edit `ext.config.yaml` to register action bar buttons, header menu items, or custom panels.
2. **Add backend actions.** AEM extensions often need actions to call AEM APIs:`.augment/skills/appbuilder-project-init/scripts/init.sh add-action "<name>"`Implement actions that accept the IMS token from `params.__ow_headers.authorization` and call AEM endpoints with proper `x-api-key` and `x-gw-ims-org-id` headers.
3. **Configure AEM host.** Add `AEM_HOST` to `.env` and reference it in action inputs:`inputs: AEM_HOST: $AEM_HOST`
4. **Test locally.** Run `aio app dev` and load the extension URL in the AEM Extension Tester.

## @adobe/generator-app-aem-react

| Field | Value |
| --- | --- |
| Extension Point | N/A |
| Categories | ui |

**Best for:** Building an AEM React Single Page Application using the WKND demo content model.

**Use when the user says:** "AEM React SPA", "WKND app", "AEM SPA Editor", "AEM React template"

### Post-init customization

1. **Configure AEM connection.** Set `AEM_HOST=https://<instance>.adobeaemcloud.com` in `.env`.
2. **Map components.** Map AEM page components to React components using the SPA Editor SDK.
3. **Update content model.** Replace WKND-specific components and content references with your project's content structure.

## @adobe/generator-app-api-mesh

| Field | Value |
| --- | --- |
| Extension Point | N/A |
| Categories | action, graphql-mesh |

**Best for:** Setting up an Adobe API Mesh configuration — orchestrating multiple APIs (REST, GraphQL, SOAP) behind a unified GraphQL endpoint.

**Use when the user says:** "API Mesh", "GraphQL gateway", "API orchestration", "mesh config", "unified API"

### Post-init customization

1. **Verify **`mesh.json`** is at the project root.** After `aio app init` and `npm install`, confirm `./mesh.json` exists. If the only copy is under `node_modules/@adobe/generator-app-api-mesh/templates/mesh.json`, copy it into the project root:`cp node_modules/@adobe/generator-app-api-mesh/templates/mesh.json ./mesh.json`The `node_modules/` file is only the generator template source. API Mesh commands should use the project's root-level `mesh.json`.
2. **Define mesh sources.** Customize the root `mesh.json` with the user's real backends. For multi-backend scenarios, configure at least two source handlers so the mesh can join data from multiple systems.Example:`{ "sources": [ { "name": "commerce", "handler": { "graphql": { "endpoint": "https://commerce.example/graphql" } } }, { "name": "inventory", "handler": { "openapi": { "source": "./openapi/inventory.yaml", "baseUrl": "https://inventory.example" } } } ] }`
3. **Add transforms.** Configure field renaming, type merging, and response filtering.
4. **Set authentication.** Add API keys and auth tokens as action inputs.
5. **Test queries.** Use the GraphQL playground to verify source integration.
6. **Deploy.** Run `aio api-mesh:create` or `aio api-mesh:update`.

## @adobe/generator-app-asset-compute

| Field | Value |
| --- | --- |
| Extension Point | dx/asset-compute/worker/1 |
| Categories | action |

**Best for:** Building custom Asset Compute workers for AEM as a Cloud Service that process assets during upload.

**Use when the user says:** "Asset Compute", "custom worker", "asset processing", "AEM asset rendition", "image processing worker"

### Post-init customization

1. **Implement worker logic.** Read source from `params.source`, apply transformations, write to `params.rendition`.
2. **Add dependencies.** Install image processing libraries (e.g., `npm install sharp`).
3. **Configure rendition parameters.** Define the rendition profile in AEM's Processing Profiles.
4. **Test locally.** Use the Asset Compute Dev Tool via `aio app dev`.

## @adobe/generator-app-remote-mcp-server-generic

| Field | Value |
| --- | --- |
| Extension Point | N/A |
| Categories | action |

**Best for:** Building a Model Context Protocol (MCP) server hosted on Adobe I/O Runtime.

**Use when the user says:** "MCP server", "AI tools", "Model Context Protocol", "tool server", "MCP on App Builder"

### Post-init customization

1. **Define MCP tools.** Edit the MCP server action to register tools with names, descriptions, and input schemas.
2. **Implement tool handlers.** Add handler actions via:`.augment/skills/appbuilder-project-init/scripts/init.sh add-action "<name>"`
3. **Configure authentication.** Set up API keys or IMS tokens for any Adobe APIs the tools call.
4. **Test MCP integration.** Configure an MCP client (Cursor, Claude Desktop, etc.) to connect to the deployed server URL.

## No template (standalone/bare project)

**Best for:** Starting from scratch when the user wants full control and does not want any pre-scaffolded actions or web assets.

**Use when the user says:** "blank project", "no template", "start from scratch", "just actions, no UI", "headless only"

### Setup steps

1. **Initialize:** `init.sh init-bare [path]`
2. **Treat the result as truly bare.** The expected starting point is:This matters because "bare" means the user wants to configure the project from scratch; keeping scaffolded action or UI code would contradict that request.

- `app.config.yaml` with an empty or minimal `application.runtimeManifest`
- `package.json` with the basic project dependencies
- No `src/`, `web-src/`, or `actions/` directories

1. **Clean up auto-generated directories if needed.** If `init-bare` still creates `actions/`, `src/`, or `web-src/`, remove them before doing any custom setup so the project matches the user's requested minimal starting point.For a headless/backend-only result, also remove any `web` / `operations.view` references from `app.config.yaml` before building.
2. **Add actions only when the user asks for them:**`.augment/skills/appbuilder-project-init/scripts/init.sh add-action "my-action"`
3. **Add web assets only if the user later decides they need a UI:**`.augment/skills/appbuilder-project-init/scripts/init.sh add-web-assets`
4. **Configure manifest.** For a bare project, start with an empty or minimal manifest in `app.config.yaml`, then add packages/actions only after you intentionally create them:`application: runtimeManifest: packages: {}`

## Quick Selection Guide

```
User intent ─────────────────────────────────── Template
  │
  ├─ "App with UI + actions"  ──────────────── @adobe/generator-app-excshell
  │
  ├─ "AEM extension"  ─────────────────────── @adobe/aem-cf-admin-ui-ext-tpl
  │
  ├─ "AEM React SPA"  ─────────────────────── @adobe/generator-app-aem-react
  │
  ├─ "API Mesh / GraphQL"  ────────────────── @adobe/generator-app-api-mesh
  │
  ├─ "Asset Compute worker"  ──────────────── @adobe/generator-app-asset-compute
  │
  ├─ "MCP server"  ────────────────────────── @adobe/generator-app-remote-mcp-server-generic
  │
  └─ "Blank / headless"  ──────────────────── init.sh init-bare
```

## Common post-init tasks (all templates)

1. **Update **`.env` with project-specific credentials and configuration values.
2. **Edit action manifests** directly (in `ext.config.yaml` or `app.config.yaml`) to set `runtime`, `inputs`, and `annotations` as needed.
3. **Review **`.gitignore` to ensure `.env` and `node_modules/` are excluded.
4. **Run linting:** `npm run lint`
5. **Run tests:** `npm test`
6. **Initialize git:** `git init && git add . && git commit -m "Initial scaffold"` if not already a repo.