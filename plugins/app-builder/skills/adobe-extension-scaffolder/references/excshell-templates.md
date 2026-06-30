# Experience Cloud Shell SPA Templates (`dx/excshell/1`)

The ExC Shell surface is **not** a UIX extension — it's a standalone App Builder SPA that runs inside the Experience Cloud Shell iframe. It uses **`@adobe/exc-app`** (`register()` + `runtime.done()`), NOT `@adobe/uix-guest`. There are no extension points and no `methods` object.

Reuse from [`file-templates.md`](file-templates.md): `index.html`, `index.css`, `actions/utils.js`, `actions/generic/index.js`, `hooks/post-deploy.js`, `.eslintrc.js`. Everything below is ExC-Shell-specific.

Placeholders: `{{EXTENSION_NAME}}`, `{{DISPLAY_NAME}}`, `{{EXTENSION_DESCRIPTION}}`, `{{EXTENSION_DIR}}` (= `dx-excshell-1`).

---

## `package.json`

Same as Content Hub but swap `@adobe/uix-guest` for `@adobe/exc-app`:

```json
{
  "name": "{{EXTENSION_NAME}}",
  "version": "1.0.0",
  "description": "{{EXTENSION_DESCRIPTION}}",
  "license": "Apache-2.0",
  "scripts": {
    "test": "jest --passWithNoTests --testPathIgnorePatterns web-src",
    "dev": "aio app run",
    "build": "aio app build",
    "deploy": "aio app deploy",
    "undeploy": "aio app undeploy"
  },
  "dependencies": {
    "@adobe/aio-sdk": "^5.0.0",
    "@adobe/exc-app": "^1.4.17",
    "@adobe/react-spectrum": "^3.33.0",
    "chalk": "^4.0.0",
    "js-yaml": "^4.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-error-boundary": "^4.0.0"
  },
  "devDependencies": {
    "@adobe/eslint-config-aio-lib-config": "^3.0.0",
    "eslint": "^8.0.0",
    "jest": "^29.0.0"
  },
  "engines": { "node": "^18 || ^20" }
}
```

---

## `app.config.yaml`

```yaml
extensions:
  dx/excshell/1:
    $include: src/dx-excshell-1/ext.config.yaml
```

---

## `src/dx-excshell-1/ext.config.yaml`

```yaml
$schema: https://unpkg.com/@adobe/aio-schemas@latest/schemas/aio.schema.json
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
          runtime: 'nodejs:18'
          inputs:
            LOG_LEVEL: debug
          annotations:
            require-adobe-auth: true
            final: true
operations:
  view:
    - type: web
      impl: index.html
hooks:
  post-deploy: hooks/post-deploy.js
```

> Unlike the AEM surfaces, ExC Shell actions typically set `require-adobe-auth: true` because the SPA forwards the shell's IMS token. If the app has no backend, you may delete the `actions`/`runtimeManifest` blocks entirely.

> `index.js` and `index.css` are identical to the shared skeleton in [`file-templates.md`](file-templates.md) — reuse those directly.

## `src/dx-excshell-1/web-src/src/components/App.js`

The entire shell handshake lives here. **`runtime.done()` MUST be called at the `register` level** (not after data fetch) or the shell shows an infinite spinner.

```js
import React, { useState, useEffect } from 'react';
import { Provider, defaultTheme, View, Heading, Text, Button, ProgressCircle, Divider } from '@adobe/react-spectrum';
import { register } from '@adobe/exc-app';
import actions from '../config.json';

export default function App() {
  const [shellReady, setShellReady] = useState(false);
  const [ctx, setCtx] = useState({});           // { imsOrg, imsToken, imsProfile, locale }
  const [actionResponse, setActionResponse] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    register({ id: '{{EXTENSION_NAME}}' }, (runtime) => {
      runtime.ready({
        onReady: ({ imsOrg, imsToken, imsProfile, locale }) => {
          setCtx({ imsOrg, imsToken, imsProfile, locale });
          setShellReady(true);
        },
      });
      // CRITICAL: dismiss the shell loading spinner immediately — never wait for data here.
      runtime.done();
    });
  }, []);

  async function callAction() {
    try {
      const res = await fetch(actions['dx-excshell-1/generic'], {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ctx.imsToken}`,
          'x-gw-ims-org-id': ctx.imsOrg,
        },
        body: JSON.stringify({}),
      });
      setActionResponse(await res.json());
    } catch (e) {
      setError(e.message);
    }
  }

  if (!shellReady) {
    return (
      <Provider theme={defaultTheme}>
        <View padding="size-400" UNSAFE_style={{ display: 'flex', justifyContent: 'center' }}>
          <ProgressCircle aria-label="Loading…" isIndeterminate />
        </View>
      </Provider>
    );
  }

  return (
    <Provider theme={defaultTheme} locale={ctx.locale} colorScheme="light">
      <View padding="size-400">
        <Heading level={2}>{{DISPLAY_NAME}}</Heading>
        <Divider marginY="size-200" />
        <Text>Signed in as {ctx.imsProfile?.name} — org {ctx.imsOrg}</Text>
        {error && <View marginTop="size-200" backgroundColor="negative" padding="size-100" borderRadius="regular"><Text>{error}</Text></View>}
        {actionResponse && (
          <View marginTop="size-200" padding="size-100" backgroundColor="gray-100" borderRadius="regular"
            UNSAFE_style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
            <Text>{JSON.stringify(actionResponse, null, 2)}</Text>
          </View>
        )}
        <Button variant="accent" marginTop="size-300" onPress={callAction}>Call backend action</Button>
      </View>
    </Provider>
  );
}
```

---

## `src/dx-excshell-1/web-src/src/config.json`

```json
{
  "dx-excshell-1/generic": "https://localhost:9080/api/v1/web/dx-excshell-1/generic"
}
```

Overwritten by `aio app run` (localhost) and `aio app deploy` (CDN). Do not edit by hand.

---

## Key differences from the AEM/Content Hub surfaces

| | AEM / Content Hub (`uix-guest`) | ExC Shell (`exc-app`) |
| --- | --- | --- |
| SDK | `@adobe/uix-guest` | `@adobe/exc-app` |
| Entry call | `register({ id, methods })` | `register({ id }, (runtime) => …)` |
| Auth | `host.auth` / `sharedContext.get('auth')` | `runtime.ready({ onReady })` context |
| Extension points | yes (`assetDetails`, `actionBar`, …) | none — it's a full SPA |
| Must call `runtime.done()` | no | **yes — or the shell spins forever** |
| Local view | inside an AEM surface via `?ext=` | the SPA serves directly at `https://localhost:9080` |

See [`../appbuilder-ui-scaffolder/references/shell-integration.md`](../../appbuilder-ui-scaffolder/references/shell-integration.md) for pitfalls, host-API reference, and IMS token passthrough patterns.
