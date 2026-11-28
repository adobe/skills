# Troubleshooting playbook

Match the evidence (outcome, error text, log lines) to a row. Say how sure you are, and name the evidence. Never present a guess as fact.

## What the outcomes mean

| Outcome | Meaning |
|---|---|
| `success` | The action ran and returned normally. |
| `http 4xx/5xx` | The action returned an HTTP error. Shown as `http 500` when the action returned it as a normal result (Runtime counts the run as successful), or `http 500 (app error)` when it returned `{ error: … }`. |
| `app error` | The action threw an error or returned `{ error }`. Usually a bug or bad input. |
| `dev error` | The action couldn't start or crashed, for example a syntax error, a missing module or running out of memory. |
| `timeout` | The action ran longer than allowed. Web actions get 60 seconds at most. |
| `sys error` | A problem on Adobe's side, not in the developer's code. |
| `cold` / `warm` | Whether Runtime had to start a new container first. Cold starts add some time. |

## Symptoms

| Evidence | Likely cause | How to confirm | Fix (with consent) |
|---|---|---|---|
| `401`, `cannot authorize request, reason: missing authorization header` or `… x-gw-ims-org-id header` | The UI isn't sending the user's token and org with the call. A common newcomer cause is opening the app at `https://localhost:9080` on its own instead of inside the Adobe product, so there's no signed-in user or org | `checked` lists a `__secured_<action>` entry (the action is secured), and the UI calls `actionWebInvoke` without those headers, or the app was opened standalone | Open the app through the product's preview link. Send `authorization: Bearer <token>` and `x-gw-ims-org-id: <org>` (see the create-app skill's `references/app-patterns.md`) |
| `401` with `request is invalid, reason: unauthorized. Please verify your organization ID…` on a deployed secured action | The token is from another org or environment, has expired, or the user lacks access to the workspace's product profiles | The row is the `<pkg>/<action>` sign-in check, with no matching `__secured_<action>` row | Reload the page inside the Adobe product to get a fresh token, and open the app in the same org. If it persists, an admin checks the user's product access in Admin Console |
| `400`, `missing header(s)` or `missing parameter(s)` | The generated input check found a required header or parameter missing | The error text names it | Send it from the UI, or remove the requirement if the action doesn't need it |
| `http 500`, logs mention `API_ENDPOINT`, `ERR_INVALID_URL`, `Only absolute URLs are supported`, `fetch failed` or `Invalid URL` | The generated `generic` action still calls an empty example endpoint | The action's code fetches `params.API_ENDPOINT` | Replace the example code with the real logic |
| `timeout` (error: `The action exceeded its time limits of <n> milliseconds`) | The action ran longer than its limit | The duration is close to the limit. In the browser the call failed with `400 Response is not valid 'message/http'` | Make the work faster, raise `limits.timeout` (web calls allow at most 60 s), or move slow work to a non-web action invoked asynchronously |
| The browser shows `400 {"error":"Response is not valid 'message/http'."}` | The action threw an error or timed out, so Runtime had no HTTP response to return | A matching `app error` or `timeout` row; its error text names the cause (for example `TypeError: Invalid URL`) | Fix the cause shown in the row. Wrap risky code in `try`/`catch` and return `errorResponse(...)` |
| Logs show `403` or `401` from an Adobe API (not from the app itself) | The API isn't added to **this** workspace, or its product profile doesn't allow the operation | For the linked workspace: `get_credentials`, then `get_credential_services` for each credential. Is the API there, with a product profile? | Add the API to this workspace with the `dev-console-subscribe-api` skill. Each workspace needs its own |
| `Cannot find module '…'` | A dependency is missing from `package.json`, or it was added after the last deploy | The module name in the error | `npm install <module>`, then redeploy |
| `memory`, `exceeded`, `killed` | The action ran out of memory (256 MB by default) | Large payloads or files in the logs | Process less data at once, or set `limits: { memory: 512 }` on the action (up to 4096) |
| `429`, `Too Many Requests` | A rate limit was hit (per namespace, per minute) | Many runs in a short window | Retry with backoff. Reduce how often the UI calls the action |
| `The requested resource does not exist` | The action isn't deployed in this workspace | `aio rt action list <package>` doesn't list it | Deploy (the `app-builder-deploy` skill) |
| `sys error` | An Adobe platform issue | Repeats across different actions | Retry later. Check https://status.adobe.com. Contact Adobe support with the activation id |
| The browser shows `Failed to fetch` or a CORS error, and no run is found | The call never reached the action: wrong URL, local certificate not accepted, or not deployed | `config.json` key used, network tab | Open the local URL once and accept the certificate, use the `"<ext-folder>/<action>"` key, and deploy if needed |
| Unknown error text | – | – | Call `search_adobe_docs` with the exact (redacted) error text |

## When nothing is found

Say which of these may apply. Don't conclude that nothing failed.
- **Successful web runs aren't stored.** I/O Runtime keeps failed runs, but drops successful ones from web calls. That includes an action that **returns** an HTTP error such as `{ statusCode: 500 }`: the browser shows 500, but Runtime counts the run as successful, so it may not be stored. To capture every run while testing, call the action with the header `X-OW-EXTRA-LOGGING: on` (development only, limited to 600 calls a minute). Alternatively, return errors as `{ error: { statusCode, body } }`, as the generated `errorResponse` helper does.
- **Activations are kept for 7 days.**
- The time window, the action name, or the **workspace** is different from where the problem happened. The script reads the workspace the folder is linked to.
- The problem happened while running locally with `aio app dev`. Local runs aren't recorded in Runtime, so their errors are in the `aio app dev` output.
- **Logs are forwarded** (`no log lines returned` with a log destination other than `adobe_io_runtime`): the logs are in that destination (for example Splunk or Azure Log Analytics). The script reads only the destination name. Don't run `aio app config get log-forwarding` yourself, because its settings can contain credentials.
