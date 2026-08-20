# require-adobe-auth: false

## Default

`MUST` — actions must enforce Adobe IMS authentication unless there is a clear and justified reason not to.

## Exception conditions

**Storefront-facing actions** called directly from the storefront (e.g. Edge Delivery Services) where the caller is an unauthenticated browser session and Adobe IMS authentication cannot be enforced.

**Third-party platform actions** called from external systems (e.g. OAuth redirect handlers, webhook receivers, OIDC callback endpoints) that cannot send Adobe IMS tokens. In this case an alternative authentication mechanism must be present — e.g. HMAC signature verification, OAuth state/nonce validation, or JWKS token verification.

## When the exception applies

Do not flag `require-adobe-auth: false` when:
- The action is storefront-facing — verify CORS is handled correctly instead (see `patterns/cors-storefront-actions.md`)
- The action is an OAuth/OIDC redirect handler with state/nonce validation
- The action uses HMAC signature verification with a shared secret stored as env var

If the purpose of the action is unclear from the code, flag as `MUST` and ask the vendor to justify.
