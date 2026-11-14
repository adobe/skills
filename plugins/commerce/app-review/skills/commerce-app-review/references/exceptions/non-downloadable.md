# Non-Downloadable App Exceptions

## Context

Non-downloadable apps are installed directly from Adobe Exchange with one click. 
Merchants never see the source code and never run CLI commands. 
Merchants also never manually edit a `.env` file or configuration files directly — but values they enter through the Exchange Configure UI (via `configSchema` in `app.config.yaml`, or via App Management's `app.commerce.config`) may still reach the app as environment variables or business config under the hood; the merchant just never manages that mapping themselves. The following checks from the submission guidelines apply **only to downloadable apps** and must be suppressed for non-downloadable apps.

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

- Merchant-facing installation guide hosted at the Exchange documentation URL
- All configuration documented so merchants can use the Exchange Configure UI
