---
name: aem-cli
description: Use this when running or troubleshooting the local Edge Delivery dev server or the Adobe AEM CLI (@adobe/aem-cli, formerly helix-cli; `aem up`, `aem content`, `aem import`). Covers starting `aem up` and its port (git worktrees, a port already in use), serving local test pages from `./content/`, cloning da.live content locally with `aem content clone` to preview, inspect or edit it and pushing edits back, `aem up` failures (cert errors, proxy 404s, local pages not found), .env / AEM_* configuration, HTTPS, installing or upgrading the CLI, and the importer server. For da.live content-format rules or the DA Source API use da-content; for writing EDS block code use content-driven-development.
license: Apache-2.0
metadata:
  version: "1.0.0"
---

# AEM CLI

Local tooling for AEM Edge Delivery Services: `aem up` (dev server), `aem content` (da.live
content sync), `aem import` (importer UI). Needs Node 18+.

Check the version before relying on `./content/` or `aem content`, or when a content
operation returns **403**: compare `aem --version` with `npm view @adobe/aem-cli version`;
upgrade with `npm install -g @adobe/aem-cli@latest`. `aem content` and `./content/`
serving need 16.18+, explicit IMS login 16.22.3+, worktree port handling 16.22.12+.
For persistent 403s, invalidate the active project/environment’s cached token and
retry with the intended IMS org before assuming DA permissions need changing.

## `aem up`

```bash
aem up --no-open --no-stop-other
```

- **Port:** 3000 by default, but in a git worktree `aem up` picks a port from the branch
  name and logs `Git worktree detected. Using port N`. Always use the port it logs.
- **Another server on the port:** by default `aem up` stops it, even another checkout's.
  `--no-stop-other` exits with `Port N already in use` instead: reuse that server if it is
  this checkout's, otherwise pass `--port <free port>`.
- **Local pages:** `aem up` serves `./content/` before proxying, with no flag:
  `content/drafts/x.html` is at `/drafts/x` (and `/drafts/x.plain.html`). The file is a full
  document (`<body><header></header><main>…</main><footer></footer></body>`). Use
  `--html-folder <dir>` only for HTML outside `./content/`, such as import output.
- **Other origin:** `--url https://main--<site>--<org>.aem.page` (e.g. stage).
- **`.env`:** every flag has an `AEM_` variable read from the project's `.env`: `AEM_PORT`,
  `AEM_PAGES_URL`, `AEM_TLS_CERT`, `AEM_TLS_KEY`, `AEM_NO_OPEN=true` (not `AEM_OPEN=false`).
- **HTTPS:** `--tls-cert <crt> --tls-key <key>` (mkcert or openssl).
- **Corporate TLS proxy** (`unable to get local issuer certificate`): export
  `NODE_EXTRA_CA_CERTS=<ca.pem>` in the shell or CI. Not in `.env`: Node reads it only at
  start.

## `aem content` (da.live)

Clone da.live pages to preview, inspect or edit them locally; `aem up` serves them from
`./content/`:

```bash
aem content clone --path /drafts       # or --all; browser sign-in; writes ./content/
```

To send edits or new pages back:

```bash
aem content add drafts/page.html       # paths relative to ./content/
aem content commit -m "Add test page"
aem content push
```

- `clone` fails if `./content/` exists (`--force` deletes it). Clone first, then add pages;
  move existing local pages aside and copy them back in.
- Org and site come from the git remote; override with `--org` / `--site`.
- Pages you add or edit must be in DA's HTML format; see da-content.
- Sign-in token: `.hlx/.da-token.json` (git-ignored). Don't ask for a token by hand.
- `push` writes the DA source only. Preview the page (Sidekick, or
  `POST https://admin.hlx.page/preview/<org>/<site>/main/<path>` with an IMS
  Bearer token, see da-auth) before `https://main--<site>--<org>.aem.page/<path>`
  shows it.
- `aem content push` can report success without storing media files (PNG/SVG
  verified on 16.22.16). Upload them with a DA Source API `PUT` using multipart
  field `data`; see da-content.
- `status`, `diff`, `merge` work like their git counterparts.

## `aem import`

`aem import --no-open` serves the importer UI on port 3001. For writing `import.js` use
page-import.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm install -g @adobe/aem-cli` → `File exists: …/hlx` | `npm uninstall -g @adobe/helix-cli`, then install |
| `Unknown argument: content` | CLI too old; upgrade |
| Local page 404s | Put it under `./content/` (or `--html-folder` for other dirs) |
| Live page 404s locally | Wrong origin: `--url https://main--<site>--<org>.aem.page` |
| Pushed page not on `.aem.page` | Preview it (see above) |
