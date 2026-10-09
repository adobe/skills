---
name: browser-probe
license: Apache-2.0
compatibility: Requires playwright-cli on PATH. Run `playwright-cli --help` for usage.
description: >-
  Detects CDN bot protection (Akamai, Cloudflare, DataDome, AWS WAF) by probing
  a URL with escalating headless browser configurations, and writes a
  browser-recipe.json that other playwright-cli skills use to load the page.
  Use when a page is blocked, empty, or shows a 403, "access denied", or
  captcha page in headless Chrome, or before automating a site known to block
  bots.
---

# Browser Probe

Detect CDN bot protection blocking headless Chrome and produce a browser recipe
for downstream `playwright-cli` consumers. Node 22+ required. No npm
dependencies.

## When to Use

Run when a `playwright-cli` page or a downstream script comes back blocked or
empty (403, "access denied", "captcha"), or before automating a site known to
block bots.

Paths like `scripts/…` are relative to this skill's directory (the folder
containing this SKILL.md). Run commands from the current working directory with
those paths made absolute; don't `cd` into the skill directory.

## Workflow

### Step 1 — Run the probe

```bash
node scripts/browser-probe.js "$URL" "$OUTPUT_DIR"
```

The script tries up to 5 browser configurations, stopping at the first success:

1. **default** — headless Chromium (baseline)
2. **stealth** — headless Chromium + JS stealth init script (patches `navigator.webdriver`, plugins, languages)
3. **stealth-ua** — headless Chromium + JS stealth + User-Agent override (removes `HeadlessChrome` from HTTP UA header via `--user-agent` launch arg)
4. **chrome** — system Chrome (`--browser=chrome`) + JS stealth + UA override (fixes TLS fingerprint detection)
5. **persistent** — system Chrome + JS stealth + UA override + persistent profile (cookie/session challenges)

Output: `$OUTPUT_DIR/probe-report.json`

### Step 2 — Read the report

Load `probe-report.json`. Check `firstSuccess`:
- If non-null: a configuration worked. Proceed to Step 3.
- If null: all configurations failed. Skip to Step 5.

A step with `headerError` could not read response headers, so
`detectedSignals` may be incomplete. Mention the error in the Step 5 report.

### Step 3 — Interpret results

Match `detectedSignals` against the Provider Signature Table in
`references/stealth-config.md` to confirm why blocking occurred and validate
that `firstSuccess` is the minimum sufficient config.

### Step 4 — Generate recipe

Write `browser-recipe.json` to `$OUTPUT_DIR`:

```json
{
  "url": "<probed URL>",
  "generated": "<ISO timestamp>",
  "cliConfig": {
    "browser": {
      "browserName": "chromium",
      "launchOptions": {
        "channel": "<channel column, omit if —>",
        "args": ["<args column, omit if —>"]
      }
    }
  },
  "stealthInitScript": "<contents of scripts/stealth-init.js, or null>",
  "notes": "<1-2 sentence explanation of what was detected and why this config>"
}
```

**Config mapping from `firstSuccess`:**

| firstSuccess | channel | args | stealthInitScript |
|---|---|---|---|
| `default` | — | — | null |
| `stealth` | — | — | `scripts/stealth-init.js` |
| `stealth-ua` | — | `--user-agent=<UA>` | `scripts/stealth-init.js` |
| `chrome` | `chrome` | `--user-agent=<UA>` | `scripts/stealth-init.js` |
| `persistent` | `chrome` | `--user-agent=<UA>` | `scripts/stealth-init.js` |

`<UA>` is the User-Agent string under "User-Agent Override" in
`references/stealth-config.md`. It is the same one the probe used.

If `firstSuccess` is `persistent`, add `"persistent": true` to the recipe.

### Step 5 — Report results

**If a configuration worked:**
```
Browser probe complete for <url>.
  Working config: <firstSuccess>
  Detected: <detectedSignals or "no bot protection detected">
  Recipe: <path to browser-recipe.json>
```

**If all configurations failed:**
```
Browser probe failed for <url>. No headless configuration could load the page.
  Tried: default, stealth, stealth-ua, chrome, persistent
  Detected signals: <detectedSignals>

  Options:
  1. Use --headed flag for manual browser interaction
  2. Provide pre-captured data (DOM snapshot, screenshots) manually
  3. Check if the URL requires authentication or VPN access
```

Do NOT produce a recipe when all steps fail. Do NOT silently continue
with a broken configuration.

## How Consumers Use the Recipe

`page-collect` accepts the recipe directly (`--browser-recipe <path>`). For
other `playwright-cli` work, write the recipe's `cliConfig` object to a JSON
file and pass it as `playwright-cli open --config=<file>`. If the recipe has
`stealthInitScript`, save it to a `.js` file and list that path in
`browser.initScript` in the same config (not via `eval`, which accepts a single
expression only). If `"persistent": true`, also pass `--persistent`. Run
`playwright-cli --help` for the full command reference.
