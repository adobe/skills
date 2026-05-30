# playwright-cli Rules

## Always verify with Context7

When using any playwright-cli command — especially unfamiliar flags, subcommands, or argument syntax — look up the current docs via Context7 before writing code. Search Context7 for "Playwright CLI". Do not guess from codebase patterns or memory; the CLI evolves and has non-obvious conventions (e.g., `screenshot` takes a ref not a CSS selector, `eval` is expression-only, `--raw` strips envelope formatting).

## screenshot only accepts snapshot refs, not CSS selectors

`playwright-cli screenshot [ref]` takes a **snapshot ref** (e.g., `e5` from a prior `snapshot` command), NOT a CSS selector:

```bash
# Full-page screenshot
playwright-cli screenshot --filename=page.png

# Element screenshot by snapshot ref
playwright-cli snapshot          # get refs first
playwright-cli screenshot e5 --filename=element.png
```

**For element screenshots by CSS selector**, use `run-code` with Playwright's `locator.screenshot()`:

```bash
playwright-cli --raw run-code "async page => {
  await page.locator('header .header > :nth-child(1)').screenshot({ path: '/tmp/row.png' });
  return 'ok';
}"
```

Do NOT pass CSS selectors to `screenshot` — it only accepts refs.

## run-code for multi-statement logic

`playwright-cli run-code "async page => { ... }"` executes a full async function with `page` access. Unlike `eval` (expression-only), `run-code` supports statements, variables, `await`, and complex logic.

Use `--raw` to get clean output without the `### Result` / `### Ran Playwright code` envelope:

```bash
# Extract structured data without truncation
playwright-cli -s=session --raw run-code "async page => {
  return await page.evaluate(() => {
    return JSON.stringify(someComplexExtraction());
  });
}" > /tmp/output.json
```

**Prefer `--filename=` over inline strings** for complex code — avoids shell quoting issues:

```bash
# Write code to .playwright-cli/ (inside sandbox allowed roots)
mkdir -p .playwright-cli
cat > .playwright-cli/extract.js << 'SCRIPT'
async page => {
  return await page.evaluate(() => {
    return JSON.stringify(someComplexExtraction());
  });
}
SCRIPT
playwright-cli -s=session --raw run-code --filename=.playwright-cli/extract.js
```

**IMPORTANT: `--filename=` is sandboxed.** Files must be inside the project root or `.playwright-cli/`. `/tmp/` is blocked. Write temp scripts to `.playwright-cli/` and clean up after.

**When to use `run-code` vs `eval`:**
- `eval` — quick expressions: `document.title`, `el.getBoundingClientRect()`
- `run-code` — multi-statement extraction, large DOM reads, anything > 1 line
- `run-code --filename=` — complex code with special characters, or scripts > 3 lines

## eval only accepts pure expressions

`playwright-cli eval "EXPR"` wraps the argument as `page.evaluate(() => (EXPR))`. This means:

- **Works:** pure expressions — `42`, `document.title`, `JSON.stringify(obj)`, comma expressions `(x = 1, x + 2)`
- **Fails:** statements — `var x = 1; x`, `return 42`, `if (x) { ... }`, block bodies `{ ... }`
- **Fails:** IIFEs with statements — `(() => { var x = 1; return x; })()` errors with "result is not a function"

If you need to run multi-statement code, use one of:
1. **`initScript`** — inject a script file before navigation via config: `{"browser":{"initScript":["path/to/script.js"]}}`. **CRITICAL:** initScript runs in Playwright's isolated execution context, NOT the main world. `var` at top level does NOT propagate to `window`. You MUST use explicit `window.myGlobal = ...` to make globals visible to subsequent `eval` calls.
2. **Comma expressions** — chain pure expressions: `(window.x = compute(), window.y = transform(window.x), JSON.stringify({x: window.x, y: window.y}))`
3. **Two-step** — store to global in one eval, read in another: `eval "window.result = heavyComputation(), 'ok'"` then `eval "window.result.field"`

## Injecting large scripts (bundles, libraries)

Never inline a bundle into eval via `$(cat "file.js")` — it breaks shell quoting and hits the expression-only limitation.

Never serve from localhost and fetch/inject via `<script src>` — Chrome's Private Network Access (PNA) policy blocks HTTP requests from HTTPS pages to loopback addresses since Chrome 94.

**Always use `initScript`:**

```bash
CONFIG="/tmp/pw-config-$$.json"
echo '{"browser":{"initScript":["'"$BUNDLE_PATH"'"]}}' > "$CONFIG"
playwright-cli open "$URL" --config="$CONFIG"
# Bundle globals (e.g., window.__myLib) are now available
playwright-cli eval "window.__myLib.doThing()"
rm -f "$CONFIG"
```

The bundle file is read from disk by playwright-cli itself — no network request, no shell quoting, no expression limitation.

**Flag position:** `--config` is an option on the `open` subcommand — it goes after the URL: `playwright-cli open <url> --config=<path>`. Same for `--persistent`, `--browser`, `--headed`.

## Merging initScript with browser recipes

When combining a bundle injection with a browser recipe (from browser-probe), merge both into one config. The bundle should come first in the `initScript` array so it's available when the page loads:

```javascript
config.browser.initScript = ['bundle.js', ...existingInitScripts];
```

## Returning structured data from eval

When you need JSON output from `eval`, **return the object directly** — do NOT wrap in `JSON.stringify()`. playwright-cli serializes objects as clean JSON, but serializes strings with lossy quote-wrapping that breaks on content containing escaped quotes (e.g., CSS `url("...")`).

```bash
# GOOD — returns object, playwright-cli serializes as clean JSON
playwright-cli eval "window.__visualTree.captureVisualTree(1024)"

# BAD — returns string, playwright-cli wraps in quotes with broken escaping
playwright-cli eval "JSON.stringify(window.__visualTree.captureVisualTree(1024))"
```

All `eval` output is wrapped in a `### Result` / `### Ran Playwright code` envelope. Strip it before parsing:

```javascript
const rIdx = raw.indexOf('### Result');
const cIdx = raw.indexOf('### Ran Playwright code');
const value = rIdx === -1
  ? raw.trim()
  : raw.slice(rIdx + '### Result'.length, cIdx !== -1 ? cIdx : undefined).trim();
const result = JSON.parse(value);
```

**For large results**, redirect to a file instead of a shell variable:
```bash
playwright-cli eval "window.bigObj" > /tmp/result.txt
# then read file in Node and strip envelope
```

## Result size

`playwright-cli eval` returns results via stdout. For large results (100KB+), verify the output isn't truncated. If it is, use the two-step approach:

```bash
playwright-cli eval "window.__result = heavyComputation(), 'ok'"
playwright-cli eval "window.__result.field1"
playwright-cli eval "window.__result.field2"
```
