# Deploy failures: symptom → cause → fix

Match the first error line of `aio app deploy` (or `aio app build`) against this table. Fix only with the developer's consent, then retry once. Don't add `--force-*` flags to get past an error. The only forced deploy is the explicit published-app override in SKILL Step 6.

| Output contains | Likely cause | Fix |
|---|---|---|
| `This application is published and the current workspace is Production, deployment will be skipped` | The Production app was published to the org, so the CLI won't overwrite it (exit code 0, so this is **not** a success) | Report as **skipped**. Updating it means retracting the app in Adobe Exchange first (an org admin can do this), then deploying. Offer Stage instead. |
| `deploy-actions skipped by hook` / `deploy-static skipped by hook` | A hook in `app.config.yaml` / `ext.config.yaml` stopped part of the deploy | Report as **partial**. Show which hook ran and what it printed. |
| `No actions deployed`, or `verify-actions.mjs` reports missing actions | The CLI's local record of uploaded code (in `dist`) matched, often after switching workspaces | Run `aio app clean`, deploy again, then re-run `verify-actions.mjs`. |
| `Developer Terms of Service have not been accepted` | Terms pending for the org | Use the Terms flow (`app-builder-setup` Step 5): show the Terms link, and call `accept_developer_terms` only after the developer explicitly agrees. Never answer the CLI's own Terms prompt. |
| `login`, `invalid_token`, `token is expired`, `401` from Developer Console or IMS | The CLI sign-in expired or belongs to another account | Hand off to `app-builder-setup` for its `scripts/login.mjs` helper and readiness check. Do not run login directly or expose its output. |
| `AIO_RUNTIME_AUTH`, `AIO_RUNTIME_NAMESPACE` (any case, e.g. `AIO_runtime_auth`), `missing runtime credentials` | `.env` lacks the workspace's Runtime credentials | Re-link the workspace with the guarded switch (SKILL Step 4) using the current workspace id. |
| `not authorized`, `403` from Runtime (`adobeioruntime.net`) | The local credentials belong to a different workspace or namespace | Re-run `app-context.mjs`. If the workspace isn't the intended one, use the guarded switch. |
| `kind 'nodejs:16'` (or another old Node version) `not supported` | The action uses a Node.js runtime Runtime no longer offers | Set `runtime: nodejs:22` for every action under `runtimeManifest.packages.<package>.actions` in `src/<extension folder>/ext.config.yaml` (or in `app.config.yaml` for standalone apps and Experience Hub). |
| `Module not found`, `SyntaxError`, `Failed to build`, `parcel`, `webpack` | A code or dependency error in the UI or an action | Run `aio app build`, fix the reported file and line, and run `npm install` if a package is missing. |
| `must NOT have additional properties`, `config validation` | `app.config.yaml` / `ext.config.yaml` doesn't match the schema | Fix the key at the path the error names (often indentation or a misspelt key). |
| `Request entity too large`, `413`, `exceeds` (action size) | An action bundle is too large | Remove unused dependencies from the action, or split it. |
| `429`, `Too Many Requests` | Rate limit | Wait a minute, then retry once. |
| `ETIMEDOUT`, `ECONNRESET`, `ENOTFOUND`, `socket hang up` | Network or proxy | Retry once. If it repeats, check the VPN or proxy (`HTTPS_PROXY`). |
| `Workspace … not found`, or `Do you wish to create a new workspace?` | A wrong workspace id or name | Re-resolve it with `list_workspaces`. Never let the CLI create a workspace. |
| Anything else | Unknown | Call `search_adobe_docs` with the exact error text. If the deploy succeeded but the app misbehaves, use the `app-builder-troubleshoot` skill. |
