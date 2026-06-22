---
name: aem-cli
description: Reference for the Adobe AEM CLI (@adobe/aem-cli, formerly the helix-cli npm package; commands `aem up`, `aem import`, `aem content`) — installation, the local Edge Delivery dev server, .env / AEM_* configuration, HTTPS/TLS, proxy & certificate trust, content sync with da.live, and troubleshooting. Use when installing, running, or configuring the aem/hlx CLI, when `aem up` fails (port conflicts, cert errors, proxy 404s, pipeline vs. local-file confusion), or when migrating from the old helix-cli package. Do NOT use for da.live content-format rules or the DA Source API contract (use da-content); do NOT use for writing EDS block code (use content-driven-development).
license: Apache-2.0
metadata:
  version: "1.0.0"
---

# AEM CLI

Local development tool for AEM Edge Delivery Services. Three commands: `aem up` (local dev
server), `aem import` (import server + UI), `aem content` (da.live content sync).

Binary: `aem` (primary), `hlx` (alias from the former `helix-cli` package, renamed to
`@adobe/aem-cli` at v15.0.0).

---

## 1. Install

**Prerequisite:** Node.js 12.11 or newer (Node 22 LTS recommended). `[verified]`

```bash
# Global install
npm install -g @adobe/aem-cli

# One-off via npx (no global install needed)
npx -y @adobe/aem-cli up
```

**Verify:**
```bash
aem --version   # or: hlx --version
```

### Migrating from the old helix-cli package

If `npm install -g @adobe/aem-cli` fails with `File exists: …/hlx`, the old package is still
installed and owns the binary. Uninstall it first (npm package scoped under `@adobe`, named
`helix-cli`): `[verified]`

```bash
npm uninstall -g @adobe/helix-cli
npm install -g @adobe/aem-cli
```

The binary name changes from `hlx` to `aem`; both work after installation because `aem-cli`
ships `hlx` as an alias.

---

## 2. `aem up` — Local Dev Server

**Agent-standard invocation:**

```bash
aem up --no-open --forward-browser-logs
```

**Check the server is running:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
# Expected: 200
```

### Key flags

| Flag | What it does |
|---|---|
| `--no-open` | Do not open a browser window on startup |
| `--forward-browser-logs` | Forward browser console messages (log, error, warn, info) to the terminal |
| `--port <n>` | Listen on a different port (default: `3000`) |
| `--addr <addr>` | Bind address; use `*` to allow external connections (default: `127.0.0.1`) |
| `--url <url>` | Origin URL to proxy content from (overrides the project's default pages URL) |
| `--html-folder <dir>` | Serve local HTML files from `<dir>` without extensions |
| `--html-mount <path>` | URL path where `--html-folder` files are served (default: `/<dir>`) |
| `--no-livereload` | Disable automatic browser reload on file changes |
| `--stop-other` | Stop another AEM CLI instance on the same port before starting (default: true) |
| `--tls-cert <file>` | Path to `.pem` file for TLS (see §4) |
| `--tls-key <file>` | Path to `.key` file for TLS (see §4) |
| `--allow-insecure` | Allow insecure (self-signed cert) requests to the upstream server |
| `--print-index` | Print indexed records for the current page (debugging) |
| `--site-token <token>` | Site token for CLI access to the website |
| `--cookies` | Proxy all cookies (default: only `hlx-auth-token` is proxied) |

**`--html-folder`:** without it, local HTML files are never served — all requests proxy to the
remote pipeline, returning 404 for local-only paths. `[verified]`

### Serving import HTML locally (preview-import pattern)

```bash
aem up --html-folder drafts --no-open --forward-browser-logs
# Files in ./drafts/ are served at /drafts/<name> (no extension needed)
```

---

## 3. `.env` Configuration

All options can be persisted in `.env` at the project root; loaded automatically. `[verified]`

```dotenv
# .env example
AEM_PORT=8080
AEM_PAGES_URL=https://stage.myproject.com
AEM_FORWARD_BROWSER_LOGS=true
AEM_HTML_FOLDER=drafts
AEM_TLS_CERT=server.crt
AEM_TLS_KEY=server.key
AEM_OPEN=/products
```

See [references/command-reference.md](./references/command-reference.md) for the complete
`AEM_*` environment variable reference with defaults.

---

## 4. HTTPS / TLS

### Trusted local certificate (recommended — avoids browser warnings)

Install `mkcert` (`brew install mkcert` on macOS, `choco install mkcert` on Windows,
`go install filippo.io/mkcert@latest` elsewhere), then:

```bash
mkcert -install                                          # one-time CA install
mkcert -cert-file server.crt -key-file server.key localhost 127.0.0.1
aem up --tls-cert server.crt --tls-key server.key
```

### Self-signed certificate (no mkcert)

```bash
openssl req -new -newkey rsa:4096 -x509 -sha256 -days 365 -nodes \
  -out server.crt -keyout server.key -subj "/CN=localhost"
aem up --tls-cert server.crt --tls-key server.key
```

### Persisting TLS in .env

```dotenv
AEM_TLS_CERT=server.crt
AEM_TLS_KEY=server.key
```

---

## 5. Corporate Proxy and Certificate Trust

`aem up` fails with `unable to get local issuer certificate` behind HTTPS-intercepting proxies.
Export the corporate CA cert from your browser or ask IT, then set:
```bash
# macOS / Linux
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.crt
aem up

# Windows
set NODE_EXTRA_CA_CERTS=./certs/corporate-ca.pem
aem up
```

`NODE_EXTRA_CA_CERTS` is a Node built-in — set it in the shell profile or CI, not `.env`.

**Proxy env vars:**

| Variable | Purpose |
|---|---|
| `HTTP_PROXY` | Proxy for HTTP requests |
| `HTTPS_PROXY` | Proxy for HTTPS requests |
| `ALL_PROXY` | Fallback for either protocol |
| `NO_PROXY` | Comma-separated hosts to bypass; `*` disables all proxies |

---

## 6. `aem import` — Import Server

Local import server (default port 3001) serving the helix-importer-ui.

```bash
aem import                   # opens Importer UI in browser at port 3001
aem import --no-open         # headless / background start
aem import --port 3002       # different port
```

**Key flags:**

| Flag | Default | What it does |
|---|---|---|
| `--port` | `3001` | Import server port |
| `--no-open` | — | Do not open the browser window |
| `--allow-insecure` | `true` | Allow self-signed certs on the proxied site |
| `--ui-repo <url>` | helix-importer-ui repo on GitHub | Custom Importer UI repo |
| `--skip-ui` | `false` | Skip downloading/installing the UI |
| `--headers-file <file>` | — | JSON file of custom headers for proxy requests |
| `--cache <dir>` | — | Cache proxied responses to a local folder |
| `--dump-headers` | `false` | Print request headers to console for debugging |
| `--tls-cert` / `--tls-key` | — | TLS for the import server itself (see §4) |

**Workflow:** For writing the `import.js` transformation script or running the full import
pipeline, use the **page-import** or **generate-import-html** skills. This skill covers only
starting and configuring the server.

---

## 7. `aem content` — da.live Content Sync

```bash
aem content clone [--path /]   # auth via browser popup; clones into ./content/
aem content status             # show added / modified / deleted files
aem content diff [path]        # diff local vs remote
aem content merge [path]       # sync remote changes into local files
aem content add <files..>      # stage changes (like git add)
aem content commit -m "..."    # commit staged changes (like git commit)
aem content push               # upload committed changes to da.live
aem content push --force       # overwrite remote on conflict
```

Auth token cached at `.hlx/.da-token.json` (gitignored); browser OAuth on first use.

Read the token directly to authenticate curl calls:
```bash
TOKEN=$(jq -r .access_token .hlx/.da-token.json)
```

### Known behaviour: binary files

`aem content push` **silently no-ops on binary files** (images, PDFs, fonts). `[verified]`

Verify a binary upload landed:
```bash
curl -sI https://content.da.live/<org>/<repo>/path/to/image.png | grep -i "content-type"
```

If it 404s, upload the binary directly via the DA Source API:
```bash
TOKEN=$(jq -r .access_token .hlx/.da-token.json)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/png" \
  --data-binary @./image.png \
  "https://admin.da.live/source/<org>/<repo>/path/to/image.png"
```

### Known behaviour: pre-upload HTML normalization

Pre-upload normalization **strips EDS icon decorations** (`<span class="icon icon-X">` etc.).
`[verified]` For byte-faithful EDS HTML, POST directly to the DA Source API:
```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" \
  --data-binary @./page.html \
  "https://admin.da.live/source/<org>/<repo>/path/to/page.html"
```

See the **da-content** skill (platform reference §7) for the DA Source API contract and rate limits.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm install -g @adobe/aem-cli` → `File exists: …/hlx` | old `helix-cli` package still owns the binary | uninstall the old package (see §1) then reinstall |
| `aem up` → `EADDRINUSE: address already in use :::3000` | Port 3000 is taken | Pass `--port <other>` or kill the process on 3000 |
| `aem up` → `unable to get local issuer certificate` | Corporate proxy intercepts TLS | Export corp CA cert → `export NODE_EXTRA_CA_CERTS=/path/to/ca.crt` |
| `localhost:3000/mypath` returns 404 | Local HTML file in `mypath/` not mounted | Add `--html-folder mypath` (or `AEM_HTML_FOLDER=mypath` in `.env`) |
| `aem up` → pipeline 404 for pages that exist live | Wrong origin URL proxied | Pass `--url https://your-pages-url.aem.page` |
| `aem content push` reports success but binary is missing | CLI silently no-ops on binaries | Upload binary via DA Source API (see §7) |
| `aem content push` strips icon spans from HTML | Pre-upload normalization removes EDS decorations | POST directly to DA Source API for byte-faithful upload |
| `aem import` UI doesn't load | Port 3001 in use, or UI download failed | Try `--port 3002`; or `--skip-ui` and open the UI separately |

---

## Reference

- [references/command-reference.md](./references/command-reference.md) — exhaustive flag +
  `AEM_*` env-var tables for all commands
- Upstream docs: https://www.npmjs.com/package/@adobe/aem-cli — npm page for `@adobe/aem-cli`
  (the GitHub repo is named `helix-cli` for historical reasons)
- Importer UI: the helix-importer-ui (search npm or GitHub for `helix-importer-ui`) — served by `aem import`
