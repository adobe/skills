# playwright-cli Constraints

All web plugin skills use `playwright-cli` as their browser layer. This document
covers constraints that affect skill authors — behaviours that differ from the
Playwright API and will silently break your skill if you're not aware of them.

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

Session names passed via `-s <name>` persist across calls in the same
working directory. Always close sessions explicitly with
`playwright-cli -s <name> close` to avoid stale sessions blocking future runs.
