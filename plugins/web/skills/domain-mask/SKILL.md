---
name: domain-mask
license: Apache-2.0
compatibility: macOS only. Requires mkcert and sudo (for port 443 and /etc/hosts modification).
description: >-
  Mask a URL behind a custom domain for demos and recordings. Adds a trusted
  HTTPS reverse proxy so the browser shows a clean display domain with a green
  padlock while serving content from the real target URL. Handles /etc/hosts,
  mkcert certificates, and cleanup automatically. Triggers on: "domain mask",
  "mask domain", "mock domain", "proxy URL", "demo URL", "fake domain",
  "demo proxy", "mask URL for demo", "domain-mask".
---

# domain-mask

Mask a URL behind a custom domain for demos and recordings. Opens an
HTTPS reverse proxy so the browser address bar shows a clean domain
(e.g., `wknd.adventures`) while content is served from the real URL
(e.g., `https://main--mysite--org.aem.page`). Trusted certificate via
mkcert — no browser warnings.

## Prerequisites

- Node 22+
- mkcert (`brew install mkcert && mkcert -install`)
- sudo access (for port 443 and /etc/hosts)

## Script Location

```bash
if [[ -n "${CLAUDE_SKILL_DIR:-}" ]]; then
  DOMAIN_MASK="${CLAUDE_SKILL_DIR}/scripts/domain-mask.mjs"
else
  DOMAIN_MASK="$(find ~/.claude -path "*/domain-mask/scripts/domain-mask.mjs" \
    -type f 2>/dev/null | head -1)"
fi
if [[ -z "$DOMAIN_MASK" || ! -f "$DOMAIN_MASK" ]]; then
  echo "Error: domain-mask.mjs not found." >&2
fi
```

## Workflow

### Step 1: Gather inputs

Ask the user for two values (or extract from their message):

- **Display domain** — the domain to show in the browser (e.g., `wknd.adventures`)
- **Target URL** — the real URL to proxy (e.g., `https://gabrielwalt.github.io`)

### Step 2: Check prerequisites

```bash
which mkcert || echo "Install mkcert: brew install mkcert && mkcert -install"
```

If mkcert is missing, tell the user to install it and run `mkcert -install`
once to set up the local CA.

### Step 3: Start the proxy

```bash
sudo node "$DOMAIN_MASK" <display-domain> <target-url>
```

The script handles everything automatically:

1. Adds `127.0.0.1 <display-domain>` to `/etc/hosts`
2. Generates a trusted HTTPS certificate via mkcert
3. Starts an HTTPS reverse proxy on port 443
4. Prints the URL to open

Tell the user:
- Open `https://<display-domain>` in their browser
- The address bar will show the display domain with a green padlock
- Press **Ctrl+C** when done — the script removes the hosts entry and
  cleans up temp certs automatically

### Step 4: Confirm cleanup

After the user stops the proxy, verify cleanup succeeded by checking
the script output. If it reports a warning about /etc/hosts cleanup,
help the user remove the entry manually:

```bash
sudo sed -i '' '/<display-domain>/d' /etc/hosts
```

## What the proxy does

- Forwards all requests to the target origin with rewritten `Host` header
- Rewrites `Location` headers in redirects back to the display domain
- Strips `strict-transport-security` headers (prevents cert conflicts)
- Strips `accept-encoding` (avoids compressed responses)
- Returns 502 on proxy errors

## Limitations

- macOS only (`/etc/hosts` path, `brew install mkcert`)
- Requires sudo (privileged port 443 + hosts file)
- One display domain per invocation
- Does not rewrite URLs inside HTML/CSS/JS response bodies
