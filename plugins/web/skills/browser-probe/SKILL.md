---
name: browser-probe
license: Apache-2.0
compatibility: Requires Node 22+ and playwright-cli on PATH; uses the web CLI (plugins/web/cli)
description: >-
  Detects CDN bot protection (Akamai, Cloudflare, DataDome, AWS WAF) by probing a
  URL with escalating headless browser configurations through `web probe`, and
  writes a browser recipe that other web commands load with `--recipe`. Use when a
  page is blocked, empty, or shows a 403, "access denied", or captcha page in
  headless Chrome, or before automating a site known to block bots.
metadata:
  version: "1.0.0"
---

# Browser Probe

Detect CDN bot protection blocking headless Chrome and produce a browser recipe
for the other `web` commands.

## Requirements

Node 22+ and `playwright-cli` >= 0.1.20 on PATH (`playwright-cli --version`).
Locate the `web` CLI once:

```bash
# <skill-dir> is the directory containing this SKILL.md
WEB=$(command -v web || echo "node <skill-dir>/../../cli/dist/web.mjs")
```

then run `$WEB …`; it prints exactly one JSON document on stdout,
so `$WEB … > file.json` is safe.
Fallback when published: `npx -y @adobe/web-cli`. Use an absolute `<skill-dir>`; don't `cd` into it.

**Sessions.** If `WEB_SESSION` or `PLAYWRIGHT_CLI_SESSION` is set, do not pass
`--session`: every `web` command uses that browser and leaves it open. Otherwise
either run one-shot (`$WEB page tree "$URL"` opens and closes its own browser) or
start a browser and reuse the generated name:
`S=$($WEB browser open "$URL" | jq -r .session)` then `--session "$S"`.
Never invent a fixed session name.


## When to Use

When a `web` command exits 3 (blocked), a page comes back blocked or empty (403,
"access denied", "captcha"), or before automating a site known to block bots.

## Command

```bash
$WEB probe "$URL" [--output <dir>]
```

It tries up to 5 browser configurations and stops at the first success:

1. **default**: headless Chromium (baseline)
2. **stealth**: headless Chromium + JS stealth init script (patches `navigator.webdriver`, plugins, languages)
3. **stealth-ua**: stealth + User-Agent override (removes `HeadlessChrome` from the HTTP UA header)
4. **chrome**: system Chrome + stealth + UA override (fixes TLS fingerprint detection)
5. **persistent**: system Chrome + stealth + UA override + persistent profile (cookie/session challenges)

Progress goes to stderr. Files under `--output` (default `./.web`):
`probe-<id>/probe-report.json` and, on success, `probe-<id>/browser-recipe.json`. The path
is printed as `recipePath`. With `--save-recipe` the recipe goes to `--recipe` (default
`./recipe.json`) instead, replacing its `probe` entries and keeping its other types.

## Reading the JSON

`{ report: { url, timestamp, steps, firstSuccess, detectedSignals }, recipePath }`

- `firstSuccess` non-null: that configuration worked and is the minimum sufficient
  one; `recipePath` points at the recipe.
- A step with `headerError` could not read response headers, so `detectedSignals`
  may be incomplete; mention it in the report.
- Match `detectedSignals` against the Provider Signature Table in
  [references/stealth-config.md](references/stealth-config.md) to confirm why
  blocking occurred.

Exit 3 (`BLOCKED`): every step was blocked and **no recipe is written**. Do not
continue with a broken configuration. Report:

```
Browser probe failed for <url>. No headless configuration could load the page.
  Tried: default, stealth, stealth-ua, chrome, persistent
  Detected signals: <detectedSignals>

  Options:
  1. Use --headed for manual browser interaction
  2. Provide pre-captured data (DOM snapshot, screenshots) manually
  3. Check if the URL requires authentication or VPN access
```

On success report:

```
Browser probe complete for <url>.
  Working config: <firstSuccess>
  Detected: <detectedSignals or "no bot protection detected">
  Recipe: <recipePath>
```

## Chaining: use the recipe

Save the recipe once; every browser command (`browser open`, `page *`, `ext launch`) then
launches with it, from `--recipe <file>`, `$WEB_RECIPE`, or `./recipe.json` when it exists:

```bash
$WEB probe "$URL" --save-recipe                  # writes ./recipe.json
$WEB page tree "$URL"                            # picks it up
S=$($WEB browser open "$URL" | jq -r .session)
```

Without `--save-recipe`, pass the printed path: `--recipe "$($WEB probe "$URL" | jq -r .recipePath)"`.
The recipe applies when a browser is launched; a session that is already open keeps its own.

A recipe is one object with an array of entries per type. `probe` entries are
`{ url, config: { browserName, launchOptions }, persistent, stealth }` (`stealth: true`
when `firstSuccess` is stealth or later: the stealth script is injected at launch;
`persistent: true` when it is `persistent`). `page overlays --save-recipe` adds `overlays`
entries, see the page-prep skill.

## Escape hatch

`playwright-cli -s <session> …` drives the same browser.
