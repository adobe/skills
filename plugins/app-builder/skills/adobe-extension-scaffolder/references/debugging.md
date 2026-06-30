# Adobe App Builder Extension Debugging

Troubleshooting guide for build, runtime, and integration failures across all supported surfaces (Content Hub, CF Console, CF Editor, Universal Editor, Assets View, ExC Shell).

---

## Dev Server / Build Issues

### `aio app run` exits immediately or never shows the localhost URL

**Cause:** Build failed, or Node.js version too old.

```bash
# Check Node version (must be 18+)
node -v

# Confirm npm install completed without errors
npm install

# Rebuild first
aio app build

# Then start
aio app run
```

If `aio app build` fails with a manifest validation error:
```bash
aio app build --no-config-validation
```
Fix the underlying YAML issue in `app.config.yaml` or `ext.config.yaml`, then rebuild without the flag.

### `aio app build` fails: "function not found" or "action file missing"

The action file path in `ext.config.yaml` does not match the actual file location.

Check:
```yaml
# ext.config.yaml
actions:
  generic:
    function: actions/generic/index.js   # relative to ext.config.yaml's directory
```

The file must exist at `src/<extDir>/actions/generic/index.js` (where `<extDir>` is `surfaceConfig.extDir`, e.g. `aem-assets-contenthub-1` for Content Hub).

---

## Local Testing Issues

### Panel or app is blank / nothing loads

**Most common cause:** Self-signed certificate not trusted.

```
Fix:
1. Open https://localhost:9080 in the same browser
2. Click Advanced → Proceed to localhost (unsafe)
   OR type "thisisunsafe" in Chrome
3. Reload the extension test URL
```

If the cert page shows an error (not just a warning), `aio app run` may not be running. Check the terminal.

### Extension not visible after opening the test URL

Check in order:

1. **`aio app run` not running** — Confirm the dev server is up and the terminal shows `-> https://localhost:9080`.

2. **`devMode=true` missing** — The local `ext=` URL param only works with `devMode=true` in the URL:
   ```
   https://experience.adobe.com/?devMode=true&ext=https://localhost:9080
   ```

3. **Wrong extension point in `app.config.yaml`** — The declared extension point must match the target surface (e.g. `aem/assets/contenthub/1` for Content Hub, `aem/cf-console-admin/1` for CF Console). Do not use deprecated IDs.

4. **Content Hub only — `allowedRepos` filtering** — The `repo` URL parameter doesn't match `allowedRepos`. Either empty the array for dev, or add the repo you're testing with.

5. **`register()` not called** — Check the browser console for errors. If `ExtensionRegistration` threw, `register()` never ran.

### `attach()` fails: "No extension with id ... found"

The `extensionId` in `TabPanel.js` does not match the `id` in `ExtensionRegistration.js`.

Both must import `extensionId` from `Constants.js`. Check that `Constants.js` has not been edited and both files import from it:
```js
import { extensionId } from './Constants';
```

### Host API returns undefined or throws

`attach()` must fully resolve before calling `host.*` methods. Always `await attach()` before using the connection:

```js
// Wrong — calling host API before attach resolves
const connection = attach({ id: extensionId });
const asset = await connection.host.assetDetails.getCurrentAsset(); // undefined connection

// Correct
const connection = await attach({ id: extensionId });
const asset = await connection.host.assetDetails.getCurrentAsset();
```

### Content Hub — panel shows but `getCurrentAsset()` returns null

This happens if the panel iframe loads before Content Hub has populated the asset context. Wrap in a try/catch and retry with a delay if needed, or check that the panel route is only rendered after `attach()` resolves.

> **Note:** `getCurrentAsset()` returns a plain string asset ID (e.g. `"urn:aaid:aem:..."`), not `{ id }`. Normalize it: `const asset = typeof raw === 'string' ? { id: raw } : raw;`

---

## Authentication Issues

### `aio login` needed / OAuth token expired

Run in a subshell with `CI`/`AIO_CLI_NO_TTY` unset — otherwise the browser is suppressed and login silently fails:

```bash
bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio login'
# If the token is stale (401 even when aio where shows logged in):
bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio login --force'
```

### `aio console project create` fails with 401

Token is expired or the wrong org is selected. Run `aio login`, then `aio console org select <orgId>`.

### `npm install` fails with E401

Adobe's internal npm registry config in `.npmrc` may be conflicting. Try:
```bash
npm install --registry https://registry.npmjs.org
```

---

## Developer Console Bootstrap Issues

### `aio console project create` returns "already exists"

```bash
aio console project list --json
# Find the project name/id and reuse it
```

### `aio console workspace create` returns "already exists"

```bash
aio console workspace list --projectName <projectName> --json
# Stage workspace already there — skip to workspace api add
```

### `aio console workspace api add` returns "product profile required"

Content Hub extensions only need I/O Runtime, which is free-tier and should not require a profile. If it does for your org:
```bash
aio console api list --json | grep -A5 AdobeIORuntime
# Find the required profile name, then:
aio console workspace api add \
  --projectName <p> --workspaceName Stage \
  --service-code AdobeIORuntime \
  --license-config "AdobeIORuntime=<ProfileName>" --json
```

### `aio app use` fails: workspace not found

Use explicit IDs rather than names:
```bash
PROJECT_ID=$(aio console project list --json | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log((d.find(p=>p.name==='<projectName>')||{}).id||'');
")
aio console project select "$PROJECT_ID"

WORKSPACE_ID=$(aio console workspace list --projectId "$PROJECT_ID" --json | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log((d.find(w=>w.name==='Stage')||{}).id||'');
")
aio console workspace select "$WORKSPACE_ID"
aio app use --no-input
```

---

## Post-Deployment Issues

### Extension deployed but invisible to some users

The App Builder project has extra services (Cloud Manager, AEM Assets Author API, etc.) that not all users are entitled to.

**Fix:** In Adobe Developer Console, remove all services except Runtime from the project. Redeploy and reapprove.

### Extension approved but not showing (no `ext=` param)

Wrong workspace. Approved in Stage but deployed to Production, or vice versa.
```bash
aio app use -w Production
aio app deploy
# Reapprove in Extension Manager
```

---

## Quick Diagnosis Checklist

Run through this in order when the extension doesn't work:

1. `aio where` — correct org, project, workspace?
2. `aio app run` output — localhost URL shown?
3. Browser console — any JS errors in `ExtensionRegistration`?
4. Test URL — includes `devMode=true` and `ext=https://localhost:9080`?
5. `https://localhost:9080` in browser — cert trusted?
6. `app.config.yaml` — extension point matches the target surface (correct, non-deprecated ID)?
7. `Constants.js` `extensionId` — imported correctly in both `ExtensionRegistration.js` and the panel/modal page?
8. **Content Hub only** — `allowedRepos` empty (dev) or contains the test repo?
9. **ExC Shell only** — `runtime.done()` called at the `register` level (not inside `onReady` or after a fetch)?
