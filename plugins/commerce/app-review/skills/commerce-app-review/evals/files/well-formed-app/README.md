# Order Status App

An App Builder extension for Adobe Commerce that adds order status tracking capabilities to your Commerce instance.

## Prerequisites

- Adobe Commerce 2.4.5 or later (SaaS or PaaS)
- [Adobe Developer App Builder](https://developer.adobe.com/app-builder/docs/overview/) access
- Node.js 22 LTS
- Adobe I/O CLI: `npm install -g @adobe/aio-cli`

## Setup

1. Create an App Builder project in [Adobe Developer Console](https://developer.adobe.com/console) and link it:
   ```bash
   aio app use
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment template and fill in your values:
   ```bash
   cp env.dist .env
   ```
4. Deploy:
   ```bash
   aio app deploy
   ```

## Environment Variables

| Variable | Deployment | Required | Description |
|---|---|---|---|
| `COMMERCE_BASE_URL` | All | Yes | Base URL of your Commerce instance — see [Connecting to Commerce](#connecting-to-commerce) |
| `LOG_LEVEL` | All | No | Logging verbosity (`error`, `warn`, `info`, `debug`). Defaults to `info`. |
| `OAUTH_CLIENT_ID` | SaaS | SaaS | Client ID from your Adobe Developer Console credential |
| `OAUTH_CLIENT_SECRETS` | SaaS | SaaS | JSON array of client secrets, e.g. `["secret"]` |
| `OAUTH_TECHNICAL_ACCOUNT_ID` | SaaS | SaaS | Technical account ID from Adobe Developer Console |
| `OAUTH_TECHNICAL_ACCOUNT_EMAIL` | SaaS | SaaS | Technical account email from Adobe Developer Console |
| `OAUTH_IMS_ORG_ID` | SaaS | SaaS | Adobe IMS Org ID |
| `OAUTH_SCOPES` | SaaS | SaaS | JSON array of OAuth scopes, e.g. `["AdobeID","openid"]` |
| `COMMERCE_CONSUMER_KEY` | PaaS | PaaS | Consumer key from your Commerce Integration |
| `COMMERCE_CONSUMER_SECRET` | PaaS | PaaS | Consumer secret from your Commerce Integration |
| `COMMERCE_ACCESS_TOKEN` | PaaS | PaaS | Access token from your Commerce Integration |
| `COMMERCE_ACCESS_TOKEN_SECRET` | PaaS | PaaS | Access token secret from your Commerce Integration |

See `env.dist` for the full template.

## Connecting to Commerce

The env vars you need to set depend on your Commerce deployment type. Copy `env.dist` to `.env` and fill in the relevant section.

**SaaS (Adobe Commerce as a Cloud Service)**

Set `COMMERCE_BASE_URL` to your tenant API base URL (e.g. `https://na1.api.commerce.adobe.com/<tenant_id>/`) and fill in the `SaaS (IMS OAuth)` block in `env.dist`. Retrieve your IMS credentials from the Adobe Developer Console — see [IMS Credentials documentation](https://developer.adobe.com/commerce/extensibility/starter-kit/checkout/connect/#adobe-identity-management-service-ims).

**PaaS (Adobe Commerce on Cloud Infrastructure) or On-Premise**

Set `COMMERCE_BASE_URL` to your Commerce base URL (e.g. `https://yourcommerce.com/rest/default/`) and fill in the `PaaS (Commerce Integration)` block in `env.dist`. Create a Commerce Integration to obtain the consumer key, consumer secret, access token, and access token secret — see [Commerce Integration documentation](https://developer.adobe.com/commerce/extensibility/starter-kit/checkout/connect/#create-a-commerce-integration).

## Usage

Once deployed, the extension exposes two runtime actions:

- **`get-order`** — Returns details for a single order by ID. Requires a valid IMS bearer token.
- **`list-orders`** — Returns a list of orders. Requires a valid IMS bearer token.

Both actions are protected by Adobe IMS authentication (`require-adobe-auth: true`).

## Resources

- [App Builder documentation](https://developer.adobe.com/app-builder/docs/overview/)
- [Commerce Extensibility documentation](https://developer.adobe.com/commerce/extensibility/)
- [Adobe Exchange submission guidelines](https://developer.adobe.com/commerce/extensibility/app-development/app-submission-guidelines/)
