# aio-lib-state Encryption

## Context

`@adobe/aio-lib-state` is Adobe's official state storage library for App Builder runtime actions. It encrypts all data at rest by default using AES-256-GCM — no additional encryption is needed by the app.

## Exception

Do not flag data stored in `aio-lib-state` as unencrypted or insecurely stored. The library handles encryption transparently.

Only flag a security issue if there is explicit evidence that:
- Sensitive data is stored outside of `aio-lib-state` (e.g. in plain files, hardcoded in source, or logged)
- The app is bypassing `aio-lib-state` and using a custom storage mechanism without encryption
