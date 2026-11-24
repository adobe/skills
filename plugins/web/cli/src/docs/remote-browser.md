# Remote browsers: fill the cache past bot protection

When a site blocks the local browser (challenge pages, Access Denied after a few pages),
let a remote browser load it instead: an unblocking service such as Bright Data's Browser
API, or any Chrome that exposes a DevTools (CDP) endpoint. A recipe points every `web`
command that launches a browser at that endpoint. The cache commands then record what the
remote browser loads into the usual HARs, and downstream agents replay them offline at the
real URLs, never reaching the site.

## Recipe

```json
{
  "probe": [
    {
      "config": {
        "cdpEndpoint": "env:BD_WSS_ENDPOINT",
        "cdpTimeout": 120000
      }
    }
  ]
}
```

- `cdpEndpoint`: the remote browser, `wss://…` or `http://host:port`. `env:NAME` reads it
  from the environment, so the file holds no credentials and can be committed. `cdpHeaders`
  values accept `env:NAME` too (`{ "Authorization": "env:REMOTE_AUTH" }`).
- `cdpTimeout`: how long connecting may take (ms).
- `isolated` defaults to `true` with a `cdpEndpoint`: `web` opens its own browser context
  on the remote browser, which the cache needs (HAR recording, service worker blocking).
  `false` reuses the remote browser's default context; `cache record` then fails with
  `HAR not written`.
- Do not add `stealth` or overlay rules meant for a local browser: an unblocking service
  manages the fingerprint itself.

Pass it with `--recipe <file>` or `WEB_RECIPE=<file>`. A file named `recipe.json` in the
working directory is loaded by every command; `web probe --save-recipe` rewrites its
`probe` entries, so keep the remote recipe in its own file.

## Timeouts

A remote unblocking browser can take up to two minutes on a first navigation. Every
playwright-cli call is bounded by 60 s by default, and so is navigation. Raise both:

```bash
export WEB_TIMEOUT=120000   # ms per browser step: navigation timeout, call timeout +5 s
```

It also bounds how long `cache record` waits for the page's load event (30 s otherwise).

A navigation refused for rate limiting (`bucket_rate_limit`) is retried after 5, 15 and
30 s. It happens when several remote sessions start at once: fill one site at a time.

## Fill

The session cache stores everything the remote browser loads and serves repeat requests
from disk, so a second pass costs no remote traffic. Misses are still fetched by the remote
browser, never from this machine.

```bash
export WEB_RECIPE=$PWD/remote-recipe.json WEB_TIMEOUT=120000
S=$(web browser open https://example.com/ --cache .site-cache | jq -r .session)
web page tree https://example.com/about --session "$S" >/dev/null   # navigate more pages
web browser run "async page => { for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 800); await page.waitForTimeout(400) } }" --session "$S"
web browser close --session "$S"   # → cache: { hits, misses, stored, errors }
```

`web cache record <url> --cache .site-cache` works with the same recipe (one page per call,
everything fetched again each time).

## Replay downstream

No network, no remote browser: a local browser reads the cache through the proxy, and a miss
answers 504. Replay must not use the remote recipe: `--proxy` cannot route a browser that is
already running, so `browser open --proxy` refuses a recipe with a `cdpEndpoint` (exit 2).
`WEB_RECIPE=` (empty) opens without any recipe, `./recipe.json` included; `--recipe <file>`
picks a local one.

```bash
web cache proxy --cache .site-cache --offline --port 0 > proxy.json &
P=$(jq -r .url proxy.json)     # wait until the file is written
S=$(WEB_RECIPE= web browser open https://example.com/ --proxy "$P" | jq -r .session)
curl -s "$P/__status"          # hits, misses, missed: URLs to fill again
```

What usually stays missed is harmless: analytics beacons whose URLs carry timestamps, bot
detection sensors, CAPTCHA widgets.

## Bright Data Browser API

- Endpoint: `wss://<zone user>:<password>@brd.superproxy.io:9222`, from the zone's
  Overview tab. Pin a country by adding `-country-<cc>` to the user
  (`brd-customer-…-zone-…-country-se`).
- One session navigates one domain; open a new session for another site. Assets from other
  domains (CDNs) load normally.
- Sessions end after 5 minutes idle and 60 minutes in total.
- Billed by traffic: the session cache's hits are free, `cache record` pays every time.
- Password entry is disabled unless the account passed Bright Data's KYC.

## Credentials

- Keep the endpoint in the environment (`env:NAME`), not in the recipe or on the command
  line: a `wss://user:pass@…` argument is visible to `ps`.
- `web` redacts URL credentials (`scheme://user:pass@`), `Authorization` header values and
  `Basic`/`Bearer` tokens from what it prints: error documents, argument errors, warnings
  and the `WEB_DEBUG=1` echo. Other secrets in a message (a token in a query string) and
  logs written by other tools, such as playwright-cli's own daemon logs, are not covered.
