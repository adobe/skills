# AEM CLI Setup and Troubleshooting

## Problem/Feature Description

A developer on a corporate machine is setting up a local AEM Edge Delivery Services development
environment. They currently have the old `@adobe/helix-cli` package installed globally. They need to:

1. Install the current `@adobe/aem-cli` package
2. Configure a local dev server that:
   - Uses HTTPS (TLS) on port 8443 instead of the default port 3000
   - Proxies content from `https://main--mysite--myorg.aem.page` as the pages URL
   - Does not open a browser window automatically
   - Persists all this configuration in a `.env` file so it survives restarts
3. After starting the server, they hit the following error:
   `unable to get local issuer certificate`
   They believe this is related to their company's SSL inspection proxy. Their corporate CA
   certificate is available at `/etc/ssl/certs/corporate-ca.crt`.

## Output Specification

Walk through all three steps end-to-end. Execute or explain each step concretely — do not give
abstract advice. For the TLS setup, generate the certificate using `mkcert` if available,
otherwise fall back to `openssl`. Show the `.env` file contents after all configuration is
applied. Diagnose the certificate error accurately and provide the exact command to resolve it.
