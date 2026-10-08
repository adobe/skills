# CORS reference

Probe after contracts and before implementation:

```bash
node scripts/api-cors.mjs --owner <owner> --repo <repo> --branch <branch> --prod <url> [--dir stardust/api]
```

## Origins checked

For every contracted integration, the script evaluates:

- Branch preview: `https://<branch>--<repo>--<owner>.aem.page`.
- Live: `https://<branch>--<repo>--<owner>.aem.live`.
- Production domain from `--prod`.

Production is treated as same-origin only when the endpoint origin exactly matches it.

## Evaluation rules

The probe sends safe OPTIONS preflights with the needed method and request headers. For GET reads it also sends one actual GET and records only status and CORS policy headers. It evaluates:

- `Access-Control-Allow-Origin` must allow the tested origin; `*` is blocked when credentials are needed.
- `Access-Control-Allow-Methods` must include the method when preflight is required.
- `Access-Control-Allow-Headers` must include requested non-simple headers.
- `Access-Control-Allow-Credentials` must be compatible with credential needs.

Results are written to `stardust/api/cors.json` and merged into each contract as `cors`. Preview/live blocks set status to `blocked-cors`; production-only findings remain visible in the CORS data.

## Owner action items

Action items must name exactly what the backend team needs to allow:

```text
Allow origin <origin> for <METHOD> <endpoint> with headers <headers-or-none>
```

Do not build a proxy to hide a CORS issue. Ship safe interim UI when possible and record the owner decision in the report.
