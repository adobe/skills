---
name: domain-mask
license: Apache-2.0
compatibility: macOS only. Requires mkcert and sudo (for port 443 and /etc/hosts modification).
description: >-
  Serves a real URL behind a custom display domain through a local
  trusted-HTTPS reverse proxy (mkcert certificate, /etc/hosts entry), so demos
  and recordings show a clean domain with a padlock. macOS only. Use when the
  user wants to mask, alias, or fake a domain for a demo, recording, or
  screenshot.
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

### Step 3: Have the user start the proxy

The command prompts for the sudo password and stays in the foreground until
Ctrl+C, so the user runs it in their own terminal. Give them the command with
the absolute path of this skill's directory (the folder containing this
SKILL.md) filled in:

```bash
sudo node <skill-dir>/scripts/domain-mask.mjs <display-domain> <target-url>
```

The script:

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

After the user stops the proxy, check that the hosts entry is gone (no output
means clean):

```bash
grep -Fx '127.0.0.1 <display-domain>' /etc/hosts
```

If the line is still there, have the user remove it. Escape the dots so `sed`
matches only that line, e.g. for `wknd.adventures`:

```bash
sudo sed -i '' '/^127\.0\.0\.1 wknd\.adventures$/d' /etc/hosts
```

## Limitations

- macOS only (`/etc/hosts` path, `brew install mkcert`)
- Requires sudo (privileged port 443 + hosts file)
- One display domain per invocation
- Does not rewrite URLs inside HTML/CSS/JS response bodies
