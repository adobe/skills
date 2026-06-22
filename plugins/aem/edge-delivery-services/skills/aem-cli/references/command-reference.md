# AEM CLI — Complete Command Reference

All flags verified against `aem --help`, `aem up --help`, `aem import --help`, and
`aem content --help` for `@adobe/aem-cli` v16.19.1. `[verified]`

All options can be set via environment variables in a `.env` file at the project root,
which the CLI loads automatically. The env-var name follows the `AEM_<SCREAMING_SNAKE_CASE>`
convention derived from the long flag name.

---

## Global Options (all commands)

| Flag | Env var | Default | Description |
|---|---|---|---|
| `--log-file` / `--logFile` | `AEM_LOG_FILE` | `"-"` (stdout) | Log file; `"-"` writes to stdout |
| `--log-level` / `--logLevel` | `AEM_LOG_LEVEL` | `info` | One of: `silly`, `debug`, `verbose`, `info`, `warn`, `error` |
| `--version` | — | — | Print version and exit |
| `--help` | — | — | Show help |

---

## `aem up` — Development Server

Starts a local dev server (default port 3000) that proxies the AEM pipeline.

### Server options

| Flag | Env var | Default | Description |
|---|---|---|---|
| `--port` | `AEM_PORT` | `3000` | Server port |
| `--addr` | `AEM_ADDR` | `127.0.0.1` | Bind address; use `*` to allow external connections |
| `--stop-other` / `--stopOther` | `AEM_STOP_OTHER` | `true` | Stop another AEM CLI instance on the same port before starting |
| `--tls-cert` / `--tlsCert` | `AEM_TLS_CERT` | — | Path to `.pem` file for TLS |
| `--tls-key` / `--tlsKey` | `AEM_TLS_KEY` | — | Path to `.key` file for TLS |

### AEM options

| Flag | Env var | Default | Description |
|---|---|---|---|
| `--url` / `--pagesUrl` / `--pages-url` | `AEM_PAGES_URL` | _(project default)_ | Origin URL to proxy content from |
| `--open` | `AEM_OPEN` | `"/"` | Open browser at this path on startup |
| `--no-open` / `--noOpen` | `AEM_NO_OPEN` | `false` | Disable automatic browser open |
| `--livereload` | `AEM_LIVERELOAD` | `true` | Auto-reload browser on file changes |
| `--no-livereload` / `--noLiveReload` | `AEM_NO_LIVERELOAD` | — | Disable live-reload |
| `--forward-browser-logs` / `--forwardBrowserLogs` | `AEM_FORWARD_BROWSER_LOGS` | `false` | Forward browser console output (log, warn, error, info) to terminal |
| `--html-folder` / `--htmlFolder` | `AEM_HTML_FOLDER` | — | Serve HTML from this local folder (no file extension in URLs) |
| `--html-mount` / `--htmlMount` | `AEM_HTML_MOUNT` | `/<folder>` | URL path where `--html-folder` files are served |
| `--print-index` / `--printIndex` | `AEM_PRINT_INDEX` | `false` | Print indexed records for the current page (debug) |
| `--allow-insecure` / `--allowInsecure` | `AEM_ALLOW_INSECURE` | `false` | Allow insecure (self-signed cert) requests to upstream |
| `--cookies` | `AEM_COOKIES` | `false` | Proxy all cookies; default proxies only `hlx-auth-token` |
| `--site-token` / `--siteToken` | `AEM_SITE_TOKEN` | — | Site token for authenticated site access |
| `--alpha-cache` / `--alphaCache` | — | — | ⚠️ Alpha: path to local response-cache folder (may be removed without notice) |
| `--cache` | — | — | Path to local response-cache folder |

---

## `aem import` — Import Server

Starts a local import server (default port 3001) that serves the helix-importer-ui.

### Server options

| Flag | Env var | Default | Description |
|---|---|---|---|
| `--port` | `AEM_PORT` | `3001` | Import server port |
| `--addr` | `AEM_ADDR` | `127.0.0.1` | Bind address |
| `--stop-other` / `--stopOther` | `AEM_STOP_OTHER` | `true` | Stop another AEM CLI on the same port |
| `--tls-cert` / `--tlsCert` | `AEM_TLS_CERT` | — | TLS cert for the import server |
| `--tls-key` / `--tlsKey` | `AEM_TLS_KEY` | — | TLS key for the import server |

### Importer options

| Flag | Env var | Default | Description |
|---|---|---|---|
| `--open` | `AEM_OPEN` | `/tools/importer/helix-importer-ui/index.html` | Browser path to open on startup |
| `--no-open` / `--noOpen` | `AEM_NO_OPEN` | — | Disable automatic browser open |
| `--allow-insecure` / `--allowInsecure` | `AEM_ALLOW_INSECURE` | `true` | Allow self-signed certs on the proxied site |
| `--ui-repo` / `--uiRepo` | `AEM_UI_REPO` | helix-importer-ui repo on GitHub | Custom Importer UI repo; append `#<branch>` for a non-main branch |
| `--skip-ui` / `--skipUI` | `AEM_SKIP_UI` | `false` | Skip downloading/installing the UI |
| `--cache` | — | — | Cache proxied responses to a local folder |
| `--headers-file` / `--headersFile` | — | — | JSON file with custom request headers for the proxy |
| `--dump-headers` / `--dumpHeaders` | — | `false` | Print request headers to console (debug) |

---

## `aem content` — Content Sync

Git-style subcommands for syncing content with da.live.

| Subcommand | Description |
|---|---|
| `aem content clone [--path /]` | Clone da.live content into local `content/` (triggers browser auth) |
| `aem content status` | Show locally added, modified, and deleted files |
| `aem content diff [path]` | Diff local vs remote content |
| `aem content merge [path]` | Pull remote changes into local files |
| `aem content add <files..>` | Stage changes (like `git add`) |
| `aem content commit [-m "..."]` | Commit staged changes (like `git commit`) |
| `aem content push [--force]` | Upload committed changes to da.live |

**Auth token cache:** `.hlx/.da-token.json` (gitignored). Reused across commands; refreshed via
browser OAuth when expired.

**Limitation — binary push:** `push` silently no-ops on binary files. Use the DA Source API
for images, PDFs, and fonts. `[verified]`

**Limitation — HTML normalization:** `push` strips EDS-specific decorations (e.g. icon spans)
before upload. Use the DA Source API for byte-faithful EDS HTML. `[verified]`

---

## Proxy and Certificate Trust

### Proxy environment variables

| Variable | Purpose |
|---|---|
| `HTTP_PROXY` | Proxy for HTTP requests |
| `HTTPS_PROXY` | Proxy for HTTPS requests |
| `ALL_PROXY` | Fallback proxy for either protocol |
| `NO_PROXY` | Comma-separated host list to bypass (use `*` to disable all proxies) |

Matching rules: exact host match, or suffix match if the entry begins with `.` or `*`.

### Enterprise CA trust

When a corporate proxy intercepts HTTPS connections, Node.js cannot verify the replaced
certificate. Fix by adding the corporate CA:

```bash
# macOS / Linux — set before running aem
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.crt
aem up

# Windows
set NODE_EXTRA_CA_CERTS=./certs/corporate-ca.pem
aem up
```

`NODE_EXTRA_CA_CERTS` is a Node.js built-in; it is not an `AEM_*` variable and is not
loaded from `.env`. Set it in your shell profile or CI environment.

---

## `.env` File Example

```dotenv
# Dev server
AEM_PORT=8080
AEM_PAGES_URL=https://main--mysite--myorg.aem.page
AEM_FORWARD_BROWSER_LOGS=true
AEM_NO_OPEN=true

# Local HTML serving (import/preview)
AEM_HTML_FOLDER=drafts

# TLS
AEM_TLS_CERT=server.crt
AEM_TLS_KEY=server.key

# Logging
AEM_LOG_LEVEL=debug
```
