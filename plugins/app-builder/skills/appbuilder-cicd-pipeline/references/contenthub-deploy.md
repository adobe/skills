# Adobe App Builder Extension Deployment

Complete deployment workflow for a Content Hub extension (`aem/assets/contenthub/1`) from Stage through Production approval.

---

## Prerequisites

Before deploying:
1. `aio app run` has succeeded locally (extension visible with `ext=` URL param)
2. `allowedRepos` in `ExtensionRegistration.js` is populated with delivery repo IDs
3. The correct org and project are selected (`aio where` shows the right state)

---

## Stage Deployment

Stage is used for QA and stakeholder review before Production.

```bash
# Switch workspace — unset CI/AIO_CLI_NO_TTY in subshell so credentials are downloaded
bash -c 'unset CI AIO_CLI_NO_TTY TERM; printf "y\ny\ny\ny\n" | aio app use -w Stage --overwrite' 2>/dev/null

# Deploy — capture output
aio app deploy 2>&1 | tee /tmp/aio-deploy.log
```

After deploy completes, **always** parse the CDN URL from the log — even if actions failed:

```bash
CDN_URL=$(grep -Eo 'https://[^ ]+adobeio-static\.net[^ ]*' /tmp/aio-deploy.log | grep 'index\.html' | tail -1)
# If no index.html variant found, take any adobeio-static.net URL:
CDN_URL=${CDN_URL:-$(grep -Eo 'https://[^ ]+adobeio-static\.net[^ ]*' /tmp/aio-deploy.log | tail -1)}
```

Open Content Hub automatically with the deployed URL — **do not just print it**. Replace the local `ext=https://localhost:9080` with `ext=<CDN_URL>/index.html` and keep the Content Hub deep-link hash:

```bash
open "https://experience.adobe.com/?devMode=true&ext=${CDN_URL}/index.html#/assets/contenthub/"
```

**Partial failure rule:** If web assets deployed but actions failed (Runtime not provisioned in the org, or 401 on action deploy), still open the CDN URL. The extension UI loads correctly. Actions will fail only when called. Do not block on action deployment errors.

---

## Production Deployment

```bash
# Switch to Production workspace — unset CI/AIO_CLI_NO_TTY in subshell
bash -c 'unset CI AIO_CLI_NO_TTY TERM; printf "y\ny\ny\ny\n" | aio app use -w Production --overwrite' 2>/dev/null

# Deploy to Production
aio app deploy
```

Production deployment must be followed by an approval step before the extension is visible to all users in the org.

---

## Extension Manager Approval

1. Open `https://experience.adobe.com/aem/extension-manager`
2. Find your extension by name
3. Click **Approve**
4. The extension becomes visible to all users in your org — no `ext=` URL parameter needed

---

## Workspace Selection (`aio app use`)

`aio app use` rewrites `.aio` and `.env` to point at the specified workspace. Always run it before `aio app deploy` when switching targets.

```bash
# Check current workspace
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio where

# Switch workspace — unset CI/AIO_CLI_NO_TTY in subshell so credentials are downloaded
bash -c 'unset CI AIO_CLI_NO_TTY TERM; printf "y\ny\ny\ny\n" | aio app use -w Stage --overwrite' 2>/dev/null
bash -c 'unset CI AIO_CLI_NO_TTY TERM; printf "y\ny\ny\ny\n" | aio app use -w Production --overwrite' 2>/dev/null
```

If `aio app use -w <name>` does not find the workspace by name, use explicit flags (also in clean subshell):
```bash
bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio app use --org <orgId> --project <projectName> --workspace Stage --no-input'
```

---

## Re-deploy After Code Changes

```bash
# Rebuild and redeploy (from the project directory)
aio app deploy
```

For UI-only changes (no action changes), `aio app deploy` is still the right command — it rebuilds the web-src bundle and pushes to CDN.

---

## Troubleshooting Deployments

### Extension visible with `ext=` but not after approval

The extension was approved in the wrong workspace. The `ext=` URL param bypasses workspace checks.

```bash
aio where             # confirm you're on Production
aio app use -w Production
aio app deploy
# Then re-approve in Extension Manager
```

### Extension invisible to some users

The App Builder project includes extra Adobe services (AEM Assets Author API, Cloud Manager, etc.). Only users entitled to those services see the extension.

**Fix:** Remove all non-required services from the App Builder project in Adobe Developer Console. Keep only Runtime. Redeploy and reapprove.

### `aio app deploy` fails with auth error

`.env` is missing or stale. Re-wire the workspace (unset CI in a subshell so credentials are downloaded):
```bash
bash -c 'unset CI AIO_CLI_NO_TTY TERM; printf "y\ny\ny\ny\n" | aio app use -w Stage --overwrite' 2>/dev/null
aio app deploy
```

### CDN propagation delay

After `aio app deploy` succeeds, CDN propagation can take 1-2 minutes. If the extension shows the old version immediately after deploy, wait a moment and hard-refresh.

---

## Full Deployment Checklist

- [ ] `aio where` shows the correct org, project, and workspace
- [ ] `aio app use -w <workspace>` run in a clean subshell (`unset CI AIO_CLI_NO_TTY TERM`) before deploying
- [ ] `aio app deploy` completed without errors (partial web-only success is still usable)
- [ ] Tested with the deployed CDN URL (not localhost)
- [ ] **Content Hub / AEM surfaces** — deployed URL opened with `?devMode=true&ext=<CDN>/index.html`
- [ ] **Content Hub only** — `allowedRepos` populated with target delivery repo IDs before Production deploy
- [ ] For Production: approved in Extension Manager
- [ ] For Production: verified without `ext=` URL parameter
