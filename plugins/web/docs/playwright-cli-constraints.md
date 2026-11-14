# playwright-cli Constraints

Only `plugins/web/cli/src/driver/playwright-cli.mjs` talks to `playwright-cli`
now; skills call the `web` CLI, which goes through that driver. This document is
the driver's reference: behaviours of `playwright-cli` that differ from the
Playwright API and break callers that are not aware of them. Skills use
`playwright-cli -s <session> …` directly only as an escape hatch on a browser
the `web` CLI opened.

## File Paths

Some `playwright-cli` versions restrict file I/O to the **project root** and the
**`.playwright-cli/`** directory and deny other absolute paths with a
`File access denied` error. 0.1.20 allows `/tmp/`, but skills cannot pin the
user's version, so keep files you generate for playwright-cli (configs,
temporary init scripts, screenshots) in the output directory or
`.playwright-cli/`.

```js
// ✗ Breaks on versions that restrict paths
const configPath = join(tmpdir(), `my-skill-${process.pid}-config.json`);

// ✓ Works everywhere — output dir is project-relative
const configPath = join(outputDir, `.tmp-${process.pid}-config.json`);
```

Clean up temp files after use to avoid polluting the output directory.

## Screenshot Syntax

The `screenshot` command takes an **optional element selector** as its positional
argument, not a file path. Passing a file path as a positional argument causes a
`Unexpected token while parsing css selector` error.

```bash
# ✗ Wrong — path is parsed as a CSS selector
playwright-cli screenshot /path/to/file.png

# ✓ Correct — use --filename flag
playwright-cli screenshot --filename .playwright-cli/file.png
```

Without `-s` the command targets the default session. Keep the path inside the
project or `.playwright-cli/` (see above), then view the saved image.

## eval Expression Constraints

`playwright-cli eval` wraps your input as `() => (EXPR)` internally. This means:

- **Semicolons silently fail** — the wrapper expects a single expression, not
  multiple statements separated by `;`. The command exits 0 but returns nothing.
- **`return` is not valid** — you're inside an arrow function expression body.
- **IIFEs work** — `(function(){ ...; return value; })()` is a valid expression.
- **Comma operator works** for chaining side effects:
  `(a.remove(), b.remove(), 'done')`
- **Promises are awaited** — call async page functions directly:
  `window.fn().then(r => JSON.stringify(r))`

```js
// ✗ Silent failure — semicolons split into statements
playwright-cli eval "a.remove(); b.remove(); 'done'"

// ✓ Comma operator
playwright-cli eval "(a.remove(), b.remove(), 'done')"

// ✓ IIFE
playwright-cli eval "(function(){ a.remove(); b.remove(); return 'done'; })()"
```

## initScript Paths

`browser.initScript` entries in a `--config` JSON are file paths. Use absolute
paths, keep generated scripts in the output directory or `.playwright-cli/`
(see File Paths). `.playwright-cli/` is playwright-cli's own scratch directory;
clean up anything you put in the output directory.

## Session Naming

Session names passed via `-s <name>` are global per user and machine
(not scoped to the working directory) and persist until closed. Always close sessions
explicitly with
`playwright-cli -s <name> close` to avoid stale sessions blocking future runs.

## `--json` Envelope

The driver always passes `--json`. Output is one document:

- Success from `eval` / `run-code`: `{ "result": "<json string>" }`. The value is
  a JSON string inside the JSON, so parse twice (`JSON.parse(JSON.parse(out).result)`).
- Failure: `{ "isError": true, "error": "<message>" }` (exit code can still be 0;
  check `isError`).

## `file:` URLs

`file:` URLs are refused by playwright-cli. Serve local pages over HTTP
(`node:http` on `127.0.0.1`) when a real page is needed, as the tests do.

## `run-code` Sandbox

`run-code` runs in a sandbox with no `setTimeout`. Wait with
`page.waitForTimeout(ms)` instead.
