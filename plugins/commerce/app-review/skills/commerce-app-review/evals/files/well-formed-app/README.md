# Order Status App

An App Builder extension for Adobe Commerce that adds order status tracking
capabilities to your Commerce instance, configured through App Management.

## Prerequisites

- Adobe Commerce 2.4.5 or later (SaaS or PaaS), hosted (not local)
- [Admin UI SDK](https://developer.adobe.com/commerce/extensibility/admin-ui-sdk/) 3.3.0 or later

## Installing the app

Install this app from Adobe Exchange. Adobe automatically creates and
configures the App Builder environment for you — see
[Discover and Manage App Builder apps](https://developer.adobe.com/developer-distribution/experience-cloud/docs/guides/discoverAndManage/app-builder-discover)
for how this works.

## Configuration

After installing, associate the app with your Commerce instance from
Commerce Admin — see
[Manage installed apps](https://experienceleague.adobe.com/en/docs/commerce/app-management/manage-app/manage-app).
No credentials to enter: App Management stores the association and handles
Adobe IMS authentication automatically. Nothing further to configure.

## Usage

Once configured, the extension exposes two runtime actions, invoked as
authenticated HTTPS `GET` requests (they require a valid Adobe IMS bearer
token — `require-adobe-auth: true` — so calls typically come from another
integration or automation, not directly from a browser):

**`get-order`**
Query parameter: `orderId` (required, alphanumeric with hyphens allowed).
Example: `GET <action-url>/get-order?orderId=000000123`
On success, returns the order's ID and status. Returns a 400 response if
`orderId` is missing, invalid, or the app isn't associated with a Commerce
instance yet.

**`list-orders`**
Query parameter: `pageSize` (optional, defaults to `20`; invalid values —
non-integer, zero, or negative — fall back to the default).
Example: `GET <action-url>/list-orders?pageSize=50`
Returns a list of orders from Commerce.

Both actions return a 500 response if the Commerce API call itself fails.

## Resources

- [App Management overview](https://developer.adobe.com/commerce/extensibility/app-management/)
- [App Builder documentation](https://developer.adobe.com/app-builder/docs/overview/)
- [Commerce Extensibility documentation](https://developer.adobe.com/commerce/extensibility/)
- [Adobe Exchange submission guidelines](https://developer.adobe.com/commerce/extensibility/app-development/app-submission-guidelines/)
