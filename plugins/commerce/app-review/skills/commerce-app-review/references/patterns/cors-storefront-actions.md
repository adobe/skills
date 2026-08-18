# CORS Handling for Public Storefront-Facing Runtime Actions

## Context

App Builder runtime actions called directly from the storefront (e.g. Edge Delivery Services) cannot enforce Adobe IMS authentication (`require-adobe-auth: false`). CORS must be handled explicitly. Two deployment models are supported: API Mesh (CORS at mesh level) and direct call (CORS in the action via an optional installation-time parameter).

## Required implementation

1. Add an optional `ALLOWED_ORIGINS` parameter to `app.config.yaml` and `.env`
2. When the parameter is not set, the action omits the `Access-Control-Allow-Origin` header (API Mesh deployment assumed)
3. When the parameter is set, the action validates the request `Origin` against the configured value and sets the header only if it matches
4. The parameter and its behaviour must be clearly documented so a commerce admin knows when and how to configure it depending on their deployment model

Note: the CORS parameter format (single string, comma-separated list, regex) is left to the vendor's discretion.

## Findings

| Condition | Severity |
|---|---|
| Storefront-facing action, no `ALLOWED_ORIGINS` parameter, no API Mesh in use | `MUST` |
| `Access-Control-Allow-Origin` hardcoded (e.g. `*`) instead of driven by a parameter | `MUST` |
| `ALLOWED_ORIGINS` present but not validated against the request `Origin` | `MUST` |
| `ALLOWED_ORIGINS` parameter undocumented | `NICE` |
| `ALLOWED_ORIGINS` present, conditionally applied, and documented | `NA` |
| CORS handled at API Mesh level | `NA` |
