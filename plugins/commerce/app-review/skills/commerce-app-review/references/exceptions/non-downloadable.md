# Non-Downloadable App Exceptions

## Context

Non-downloadable apps are installed directly from Adobe Exchange with one click. Merchants never see the source code, never run CLI commands, and never configure environment variables manually. The following checks from the submission guidelines apply **only to downloadable apps** and must be suppressed for non-downloadable apps.

## Suppress the following findings for non-downloadable apps

- Missing `env.dist` or `env.example` file — merchants don't deploy from source
- `env.dist` variables not documented — merchants don't set env vars manually
- README missing CLI deployment steps (`aio app deploy`, `npm run predeploy`) — Exchange handles installation
- README missing App Builder project creation instructions — not needed
- README missing API workspace list — Exchange provisions APIs automatically
- Install guide contains CLI steps — non-downloadable apps must NOT have CLI steps in docs
- Missing `npm install` or `aio login` instructions — not applicable
- Any check requiring the merchant to run terminal commands

## What IS required for non-downloadable apps

- `ACCS-REST-API` declared in `deploy.yaml` — Exchange uses this to provision API access
- Merchant-facing installation guide hosted at the Exchange documentation URL
- All configuration documented so merchants can use the Exchange Configure UI
