# Stealth Configuration Reference

## Stealth Init Script

Inject via `initScript` in the playwright-cli config (NOT via `eval` —
eval only accepts pure expressions, not multi-statement scripts). Write
this script to a temp file and add the path to `browser.initScript` in
the config. It runs before any page JS loads, patching browser
fingerprints that headless detection relies on.

```js
(function() {
  // Hide webdriver property (primary headless signal)
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // Add realistic plugins (headless Chrome has empty plugins array)
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ],
  });

  // Set realistic languages (headless may report empty)
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

  // Add chrome runtime object (missing in headless)
  window.chrome = { runtime: {} };
})()
```

## User-Agent Override

Chromium's headless mode injects `HeadlessChrome` into the HTTP User-Agent
header. Many WAFs (especially CloudFront) use simple string matching on this
token as a first-pass bot filter. This is an HTTP-level signal — JS stealth
patches cannot change it.

Fix: pass a realistic UA via Chrome launch arg in a `playwright-cli` config file:

```json
{
  "browser": {
    "browserName": "chromium",
    "launchOptions": {
      "args": ["--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"]
    }
  }
}
```

Usage: `playwright-cli -s=<session> open --config=<path-to-config>`

## Stealth HTTP Headers

These headers mimic a real Chrome session. Currently not injectable via
`playwright-cli` (no `extraHTTPHeaders` support). Documented for future use
or for scripts using Playwright API directly.

| Header | Value |
|--------|-------|
| `Accept` | `text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8` |
| `Accept-Language` | `en-US,en;q=0.9` |
| `Accept-Encoding` | `gzip, deflate, br` |
| `Cache-Control` | `no-cache` |
| `Sec-Ch-Ua` | `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"` |
| `Sec-Ch-Ua-Mobile` | `?0` |
| `Sec-Ch-Ua-Platform` | `"macOS"` |
| `Sec-Fetch-Dest` | `document` |
| `Sec-Fetch-Mode` | `navigate` |
| `Sec-Fetch-Site` | `none` |
| `Sec-Fetch-User` | `?1` |
| `Upgrade-Insecure-Requests` | `1` |

## Provider Signature Table

Maps observable signals (from `playwright-cli network` response headers and
page content) to CDN bot detection providers and typical remedies.

| Signal | Provider | Confidence | Typical fix |
|--------|----------|------------|-------------|
| `server: AkamaiGHost` or `server: AkamaiNetStorage` | Akamai | medium | System Chrome (`--browser=chrome`) — TLS fingerprint |
| `bm_sz` cookie in `set-cookie` | Akamai Bot Manager | high | System Chrome — TLS fingerprint |
| `_abck` cookie in `set-cookie` | Akamai Bot Manager | high | System Chrome — TLS fingerprint |
| `stealth` blocked + `stealth-ua` succeeds (no provider headers) | CloudFront UA filter | high | UA override (`--user-agent` launch arg) |
| `cf-ray` header present | Cloudflare | medium | Stealth script often sufficient |
| Page title contains "Just a moment" or "Checking your browser" | Cloudflare Challenge | high | System Chrome + stealth |
| `x-datadome` header present | DataDome | high | System Chrome + stealth |
| `x-amzn-waf-action` header present | AWS WAF | medium | Stealth script (UA-based detection) |
| `x-cdn: Imperva` or `x-iinfo` header | Incapsula/Imperva | medium | System Chrome + stealth |
| Page title contains "Access Denied" + `server: AkamaiGHost` | Akamai hard block | high | System Chrome — TLS fingerprint |
| `server: CloudFront` or `x-amz-cf-id` header | CloudFront | medium | Stealth script (often UA-based) |
| Page title contains "The request could not be satisfied" | CloudFront WAF block | high | UA override or stealth script |
| `stealth` (JS-only) succeeds, `default` blocked | JS fingerprint detection | high | Stealth script sufficient |
| `stealth` fails but `stealth-ua` succeeds | HTTP UA-based blocking | high | UA override (`--user-agent` launch arg) |
| Page title matches `/error\|denied\|blocked\|403\|captcha/i` + no known provider | Unknown WAF | low | Escalate to persistent profile |
| `status: 403` + `bodyLength < 500` | Generic block | low | Escalate through all steps |
