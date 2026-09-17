# External Documentation References

Use these links when the user needs context to answer a question or identify their
project type. Surface them at decision points, not on every run.

## Integration Starter Kit (ISK)

**URL:** https://developer.adobe.com/commerce/extensibility/starter-kit/integration/

Use when:

- `starterKitType` is `"unknown"` and the user needs to identify their project
- The user asks what ISK-style eventing or bidirectional sync looks like
- Explaining why certain action package names (e.g. `product-commerce`, `order-backoffice`)
  were detected

Key concepts: event providers, event subscriptions, bidirectional sync actions,
`starter-kit-registrations.json`, onboarding scripts.

## Checkout Starter Kit (CSK)

**URL:** https://developer.adobe.com/commerce/extensibility/starter-kit/checkout/

Use when:

- `starterKitType` is `"unknown"` and the user needs to identify their project
- The user asks about webhook-based payment, shipping, or tax integrations
- Explaining why `raw-http: true` actions or `COMMERCE_WEBHOOKS_PUBLIC_KEY` were detected

Key concepts: out-of-process webhooks, payment methods, shipping carriers,
tax integrations, `sync-oauth-credentials`.
