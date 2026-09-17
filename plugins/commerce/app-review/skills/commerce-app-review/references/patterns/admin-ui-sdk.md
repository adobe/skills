# Admin UI SDK Pattern

## Context

Apps using the Admin UI SDK extend the Commerce Admin with custom menus and pages using the `commerce/backend-ui/1` extension point.

**Detection:** Apply this pattern when `commerce/backend-ui/1` is present in `app.config.yaml` or `ext.config.yaml`, or when `@adobe/uix-guest` / `@adobe/uix-core` is in `package.json`.

## Findings

| Condition | Severity |
|---|---|
| `app.config.yaml` uses an `applications` block instead of an `extensions` block for the Admin UI SDK extension | `MUST` |
| `App.js` routing does not redirect to the `ExtensionRegistration` component at the index route | `MUST` |
| `ext.config.yaml` is missing or has no runtime action for the Admin UI SDK registration | `MUST` |
| Registration runtime action in `ext.config.yaml` does not have `require-adobe-auth: true` | `MUST` |
| Extension registration does not use a unique extension ID | `MUST` |
| Extension ID contains invalid characters (only alphanumeric, hyphens, and dots allowed for menu extension points) | `MUST` |
| `extension-manifest.json` is missing | `MUST` |
| `install.yaml` is missing or does not reference `commerce/backend-ui/1` extension point | `MUST` |
| `server.js`, `key.pem`, or `cert.pem` local testing files are included in the submission | `MUST` |
| `innerHTML` is used anywhere in the SPA (`web-src/`) — prohibited to prevent XSS vulnerabilities | `MUST` |
| `@adobe/uix-core` or `@adobe/uix-guest` version is below `1.0.3` | `MUST` |
| Main page uses shared context but the extension ID used in `attach` differs from the one used in `register` | `MUST` |
| Code is not organized within a `commerce-backend-ui-1` folder containing `actions` and `web-src` subdirectories | `NICE` |
| Different extension IDs used across `extension-manifest.json`, registration action, `attach`, and `register` | `NICE` |
| App uses `commerce/backend-ui/1` — Adobe recommends migrating to v2 (`commerce/backend-ui/2`) using the `commerce-app-migrate` skill | `NICE` |

## Notes

- `innerHTML` must be searched across ALL files in `web-src/src/` — check every `.js`, `.jsx`, `.ts`, `.tsx` file.
- Local testing files (`server.js`, `key.pem`, `cert.pem`) are for development only and must never be in the submission.
- The extension ID used in `attach()` and `register()` must match exactly — this is required when the main page needs shared context data.
