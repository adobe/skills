# Order Status App

An App Builder extension for Adobe Commerce that adds order status tracking
capabilities to your Commerce instance, configured through App Management.

## Prerequisites

- Adobe Commerce 2.4.5 or later (SaaS or PaaS), hosted (not local)
- [Admin UI SDK](https://developer.adobe.com/commerce/extensibility/admin-ui-sdk/) 3.3.1 or later

## Installing the app

Install this app from Adobe Exchange. Adobe automatically creates and
configures the App Builder environment for you — see
[Discover and Manage App Builder apps](https://developer.adobe.com/developer-distribution/experience-cloud/docs/guides/discoverAndManage/app-builder-discover)
for how this works.

## Configuration

After installing, associate the app and configure it from Commerce Admin —
see [Manage installed apps](https://experienceleague.adobe.com/en/docs/commerce/app-management/manage-app/manage-app).
You'll be asked for your Commerce connection details and credentials,
depending on your deployment type:

**SaaS (Adobe Commerce as a Cloud Service)**

Provide your Commerce GraphQL/REST base URL and your IMS Server-to-Server
credentials. Generate these from the
[Adobe Developer Console](https://developer.adobe.com/console): select your
project and workspace, then add an **OAuth Server-to-Server** credential.

**PaaS (Adobe Commerce on Cloud Infrastructure) or On-Premise**

Provide your Commerce base URL and Commerce Integration credentials. Create
these in Commerce Admin under **System > Extensions > Integrations** — see
[Create a Commerce Integration](https://developer.adobe.com/commerce/extensibility/starter-kit/integration/create-integration#create-an-integration-in-adobe-commerce-as-a-cloud-service)
for the full steps.

## Usage

Once configured, the extension exposes two runtime actions, invoked as
authenticated HTTPS `GET` requests (they require a valid Adobe IMS bearer
token — `require-adobe-auth: true` — so calls typically come from another
integration or automation, not directly from a browser):

**`get-order`**
Query parameter: `orderId` (required).
Example: `GET <action-url>/get-order?orderId=000000123`
Response: `{ "orderId": "000000123", "status": "processing" }`, or
`{ "error": "orderId is required", "statusCode": 400 }` if omitted.

**`list-orders`**
Query parameter: `pageSize` (optional, defaults to `20`).
Example: `GET <action-url>/list-orders?pageSize=50`
Response: `{ "orders": [ ...Commerce order objects ] }`.

Both actions return `{ "error": "...", "statusCode": 502 }` if the Commerce
API call itself fails (e.g. invalid credentials, unreachable instance).

## Resources

- [App Management overview](https://developer.adobe.com/commerce/extensibility/app-management/)
- [App Builder documentation](https://developer.adobe.com/app-builder/docs/overview/)
- [Commerce Extensibility documentation](https://developer.adobe.com/commerce/extensibility/)
- [Adobe Exchange submission guidelines](https://developer.adobe.com/commerce/extensibility/app-development/app-submission-guidelines/)
