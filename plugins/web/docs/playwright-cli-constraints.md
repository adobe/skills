# playwright-cli Constraints

All web plugin skills use `playwright-cli` as their browser layer. This document
covers constraints that affect skill authors — behaviours that differ from the
Playwright API and will silently break your skill if you're not aware of them.

## File Path Restrictions

`playwright-cli` restricts all file I/O to the **project root** and the
**`.playwright-cli/`** directory. Absolute paths outside these roots are denied
at runtime with a `File access denied` error.

Affected commands:
- `screenshot --filename <path>`
- `run-code --filename <path>`

**Do not use `os.tmpdir()` or `/tmp/` for any file that playwright-cli reads or
writes.** Use the output directory (which must be project-relative) or
`.playwright-cli/` instead.

```js
// ✗ Breaks — /tmp/ is outside allowed roots
const configPath = join(tmpdir(), `my-skill-${process.pid}-config.json`);

// ✓ Works — output dir is project-relative
const configPath = join(outputDir, `.tmp-${process.pid}-config.json`);
```

Clean up temp files after use to avoid polluting the output directory.

## Screenshot Syntax

The `screenshot` command takes an **optional element selector** as its positional
argument, not a file path. Passing a file path as a positional argument causes a
`Unexpected token while parsing css selector` error.

```bash
# ✗ Wrong — path is parsed as a CSS selector
playwright-cli -s <session> screenshot /path/to/file.png

# ✓ Correct — use --filename flag
playwright-cli -s <session> screenshot --filename .playwright-cli/file.png
```

The `-s <session>` flag is required. The path must be within the allowed roots
(see above). After saving, use the `Read` tool to view the image.

## eval Expression Constraints

`playwright-cli eval` wraps your input as `() => (EXPR)` internally. This means:

- **Semicolons silently fail** — the wrapper expects a single expression, not
  multiple statements separated by `;`. The command exits 0 but returns nothing.
- **`return` is not valid** — you're inside an arrow function expression body.
- **IIFEs work** — `(function(){ ...; return value; })()` is a valid expression.
- **Comma operator works** for chaining side effects:
  `(a.remove(), b.remove(), 'done')`

```js
// ✗ Silent failure — semicolons split into statements
playwright-cli eval "a.remove(); b.remove(); 'done'"

// ✓ Comma operator
playwright-cli eval "(a.remove(), b.remove(), 'done')"

// ✓ IIFE
playwright-cli eval "(function(){ a.remove(); b.remove(); return 'done'; })()"
```

## initScript Path Resolution

When building a `--config` JSON that includes `browser.initScript`, paths must
also be within the allowed roots. Temp script files written to `/tmp/` will be
rejected.

Write initScript files to the output directory or `.playwright-cli/` and clean
them up after the session closes.

## Session Naming

Session names passed via `-s <name>` persist across calls in the same
working directory. Always close sessions explicitly with
`playwright-cli -s <name> close` to avoid stale sessions blocking future runs.
