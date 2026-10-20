---
name: domain-mask
license: Apache-2.0
compatibility: macOS only. Requires Node 22+, mkcert and sudo (port 443, /etc/hosts); uses the web CLI (plugins/web/cli)
description: >-
  Serves a real URL behind a custom display domain through a local trusted-HTTPS
  reverse proxy (mkcert certificate, /etc/hosts entry) with `web mask`, so demos
  and recordings show a clean domain with a padlock. macOS only. Use when the user
  wants to mask, alias, or fake a domain for a demo, recording, or screenshot.
---

# domain-mask

Mask a URL behind a custom domain for demos and recordings. An HTTPS reverse
proxy makes the address bar show a clean domain (e.g. `wknd.adventures`) while
content is served from the real URL (e.g. `https://main--mysite--org.aem.page`).
Trusted certificate via mkcert, no browser warnings.

## Requirements

- Node 22+, mkcert (`brew install mkcert && mkcert -install`), sudo (port 443 and `/etc/hosts`)
- The `web` CLI (`playwright-cli` is not needed for this command). Locate it once:

```bash
# <skill-dir> is the directory containing this SKILL.md
WEB=$(command -v web || echo "node <skill-dir>/../../cli/dist/web.mjs")
```

then run `$WEB …`; it prints exactly one JSON document on stdout,
so `$WEB … > file.json` is safe.
Fallback when published: `npx -y @adobe/web-cli`. Use an absolute `<skill-dir>`; don't `cd` into it.

## Workflow

### Step 1: Gather inputs

Ask the user for (or extract from their message):

- **Display domain**: the domain to show (e.g. `wknd.adventures`)
- **Target URL**: the real URL to proxy (e.g. `https://gabrielwalt.github.io`)

### Step 2: Check prerequisites

```bash
which mkcert || echo "Install mkcert: brew install mkcert && mkcert -install"
```

If mkcert is missing, tell the user to install it and run `mkcert -install` once.

### Step 3: Have the user start the proxy

The command prompts for the sudo password and stays in the foreground until
Ctrl+C, so the user runs it in their own terminal. Give them the command with
`WEB` expanded to the resolved form:

```bash
sudo env CAROOT="$(mkcert -CAROOT)" $WEB mask "<display-domain>" "<target-url>"
```

`CAROOT` is resolved before `sudo`, so mkcert signs with the CA the user
installed rather than one under root's home, which the browser would not trust.
Without root the command exits 2 (USAGE).

It adds `127.0.0.1 <display-domain>` to `/etc/hosts`, generates a trusted
certificate via mkcert, starts an HTTPS reverse proxy on port 443, and prints
`{ url, displayDomain, targetUrl }`.

Tell the user:
- Open `https://<display-domain>`; the address bar shows the display domain with a padlock
- Press **Ctrl+C** when done: the hosts entry is removed and the certs are cleaned up

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
