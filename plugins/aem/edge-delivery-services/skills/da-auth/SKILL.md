---
name: da-auth
description: "Use this when another step needs to call admin.da.live or api.aem.live (Source Bus / Experience Workspace), for example before pushing HTML content, listing documents or triggering a preview, and you do not already have a token known to work for that API. Also use when these requests return 401/403 (Unauthorized/Forbidden) or a status 200 needs authentication verification. Covers obtaining, reusing and refreshing an Adobe IMS access token."
license: Apache-2.0
metadata:
  version: "1.1.0"
---

# DA Authentication

Get an Adobe IMS token for DA or Source Bus; callers can keep the name `DA_TOKEN`.
Reuse credentials already accepted by the target API. If **create-site** owns the
login, or an authenticated MCP/backend already handles it, use that flow instead.
Inspect the configured backend's tools; do not assume it exposes a login tool.

## Choose the API

Use the caller's known content source. If unclear, confirm the site configuration
or ask the user: a populated DA listing can contain onboarding documents while
the authored content lives in Source Bus. See **da-content** for content operations.

| Content source | Protected read example |
|---|---|
| DA | `https://admin.da.live/list/{{ORG}}/{{REPO}}/{{FOLDER}}` |
| Source Bus / Experience Workspace | `https://api.aem.live/{{ORG}}/sites/{{SITE}}/source/{{PATH}}` |

Choose a known, existing protected folder or document. A successful read does not
prove write/publish permission. `api.aem.live` accepts eligible IMS Bearer tokens
with `aem.frontend.all` or `aem.backend.all`; the helper requests `aem.frontend.all`.
DA acceptance does not prove access to a Source Bus site.

## Get or reuse a token

The helper caches `access_token` and `expires_at` (epoch milliseconds) in
`~/.aem/da-token.json`. It reuses unexpired tokens with a 60-second buffer;
missing expiry triggers login. Do not assume a fixed token lifetime.

Replace `{{READ_URL}}` with the intended protected read above. Obtain the token
and use it in the same shell; never print it, paste it into chat or commit it:

```bash
DA_TOKEN=$(npx github:adobe-rnd/da-auth-helper token) &&
  curl -sS -o /dev/null -w '%{http_code}\n' \
    -H "Authorization: Bearer $DA_TOKEN" "{{READ_URL}}"
```

The user completes browser sign-in and selects the IMS org that provides access.
If browser login cannot run here, have the user complete the flow locally or use
configured backend authentication; do not ask for a DevTools token.

Verify the API the caller will use, not a different store. On `api.aem.live`,
`/status/` can return 200 anonymously: that alone does not establish authentication.
An `auth_token` cookie can override the Bearer header; check without auth cookies
when testing that credential.

## Recover from 401 or 403

| Symptom | Check |
|---|---|
| 401 | Token missing, invalid or expired, or IMS user lookup failed. Check the credential and target API; do not loop `login`. |
| 403 | Current account/org lacks access for that path/action. Ask which IMS org supplies the user's group access; do not infer it from the URL's org or assume a new grant is needed. |

Both helper `login` and `token` reuse an unexpired cache, even when DA rejects it.
To replace a rejected or wrong-org helper credential:

```bash
npx github:adobe-rnd/da-auth-helper logout
```

This clears only the helper cache, not the browser session. Rerun the acquire-and-
verify command, select the intended IMS org, and retry the same protected read.
If 403 persists in the intended context, check path/action permissions; refreshing
credentials does not add grants.

If the browser keeps the wrong account/org context, these alternatives restored
access in live checks; neither is guaranteed to force an org chooser:

- **Private window:** while the helper waits for its callback, open its printed
  public authorize URL in a private window and select the intended org. Leave the
  automatically opened normal-browser login unfinished. There is no incognito flag.
- **Switch in da.live:** select the intended org in da.live, clear the helper cache,
  then rerun authentication. Switching da.live alone does not replace the helper's
  cached wrong-org token.

## References

https://github.com/adobe-rnd/da-auth-helper
https://opensource.adobe.com/da-admin/
https://www.aem.live/docs/api.html
