# Content Hub Extension Deployment

Deployment for a Content Hub extension (`aem/assets/contenthub/1`) from Stage through Production approval. For the underlying GitHub Actions / secrets mechanics, this is the same `aio app deploy` pipeline as any other App Builder extension — see `references/github-actions-guide.md` and `references/secrets-management.md`. This file covers only what's different for Content Hub.

## Prerequisites

1. `aio app run` has succeeded locally (extension visible with the `ext=` URL param)
2. `allowedRepos` in `ExtensionRegistration.js` is populated with delivery repo IDs before deploying to Production
3. The correct org and project are selected (`aio where` shows the right state)

## Switch Workspace, Then Deploy

`aio app use` rewrites `.aio` and `.env` to point at the target workspace; run it before `aio app deploy` whenever you switch targets. Use a clean subshell so credentials are actually downloaded:

```bash
bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio app use -w Stage --overwrite --no-input'   # or -w Production
aio app deploy 2>&1 | tee /tmp/aio-deploy.log
```

If `-w <name>` doesn't resolve the workspace, use explicit flags (same clean subshell):

```bash
bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio app use --org <orgId> --project <projectName> --workspace Stage --no-input'
```

**Partial failure is still usable:** if web assets deployed but actions failed (Runtime not provisioned, or 401 on action deploy), the extension UI still loads — open the CDN URL and note that actions are unavailable rather than treating it as blocking.

## Open the Deployed Extension

Parse the CDN base from the deploy log (regardless of exit code) and open the test URL — replace the local `ext=https://localhost:9080` with the CDN base, keep the Content Hub deep-link hash:

```bash
CDN_URL=$(grep -Eo 'https://[^ ]+adobeio-static\.net[^ ]*' /tmp/aio-deploy.log | grep 'index\.html' | tail -1)
CDN_URL=${CDN_URL:-$(grep -Eo 'https://[^ ]+adobeio-static\.net[^ ]*' /tmp/aio-deploy.log | tail -1)}
open "https://experience.adobe.com/?devMode=true&ext=${CDN_URL}/index.html#/assets/contenthub/"
```

## Extension Manager Approval (Production only)

1. Open `https://experience.adobe.com/aem/extension-manager`
2. Find the extension by name and click **Approve**
3. The extension becomes visible to all entitled users in the org — no `ext=` URL parameter needed

## Troubleshooting

| Symptom | Cause / Fix |
| --- | --- |
| Visible with `ext=` but not after approval | Approved in the wrong workspace — `ext=` bypasses workspace checks. Confirm with `aio where`, switch to the right workspace, redeploy, re-approve. |
| Extension invisible to some users | The App Builder project has extra Adobe services attached (e.g. Cloud Manager) that not all users are entitled to. Remove non-required services from the project in Developer Console, keeping only Runtime, then redeploy and reapprove. |
| `aio app deploy` fails with an auth error | `.env` is missing or stale — re-run the workspace switch command above, then deploy again. |
| Extension shows the old version right after deploy | CDN propagation takes 1-2 minutes — wait and hard-refresh. |

## Deployment Checklist

- [ ] `aio where` shows the correct org, project, and workspace
- [ ] `aio app deploy` completed without errors (partial web-only success is still usable)
- [ ] Tested with the deployed CDN URL, not localhost
- [ ] Deployed URL opened with `?devMode=true&ext=<CDN>/index.html#/assets/contenthub/`
- [ ] `allowedRepos` populated with target delivery repo IDs before Production deploy
- [ ] For Production: approved in Extension Manager and verified without the `ext=` URL parameter
