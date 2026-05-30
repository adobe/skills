# Layer Command References

## Playwright MCP

Tools are already in your context. Use `mcp__plugin_playwright_playwright__*`
tools directly. Key guidance:

- **Targeting**: ref-based. Call `browser_snapshot` first to get an accessibility
  tree with element refs (`[ref="e5"]`). Use refs in `browser_click`,
  `browser_type`, etc.
- **Refs invalidate** after any state-changing action (click, type, navigate).
  Always re-snapshot before the next interaction.
- **Tabs**: `browser_tabs` handles list, create, select, and close.
- **Wait**: `browser_wait_for` accepts text to wait for or a timeout.
- **Screenshot**: `browser_take_screenshot` captures the current viewport.

## playwright-cli

Run `playwright-cli help` to get the installed command list. For detailed docs,
look up the Playwright CLI via Context7 (optional -- local help is
sufficient if Context7 is unavailable).

Key guidance:

- **Targeting**: ref-based. Run `playwright-cli snapshot` to get element refs.
  Use refs with `click`, `fill`, `dblclick`, `hover`, `select`.
- **Refs invalidate** after state-changing commands. Re-snapshot before next
  ref-based action.
- **Navigate current tab**: `playwright-cli goto <url>`
- **Open new tab**: `playwright-cli open <url>` (background) or
  `playwright-cli tab-new <url>`
- **Tabs**: `tab-list`, `tab-select <index>`, `tab-close`
- **Session history**: `cat /.playwright/session.md` for command log recovery.

## cmux-browser

Run these to get the command surface and discover browser surfaces:

```bash
cmux browser --help
cmux identify --no-caller
cmux list-pane-surfaces
```

If no browser surface exists, create one:

```bash
cmux new-surface --type browser --pane <ref> --url <url>
```

All commands follow the pattern: `cmux browser --surface <ref> <subcommand>`.

Key guidance:

- **Targeting**: selector-based. Use CSS selectors for `click`, `fill`, `type`.
- **Surface refs are dynamic** -- discover via `cmux identify`, never hardcode.
- **No `file://` URLs** -- content must be served over HTTP.
- **Snapshot**: `cmux browser --surface <ref> snapshot --compact`
- **Navigate**: `cmux browser --surface <ref> navigate <url>`
- **Eval**: `cmux browser --surface <ref> eval <expression>`
- **Tabs**: `cmux browser --surface <ref> tab new|list|switch|close`
- **Wait**: `cmux browser --surface <ref> wait --load-state complete`
- **Unique features**: `highlight <selector>`, `addstyle <css>`,
  `addscript <js>`, `state save|load <path>` for checkpointing.

## CDP

Store the resolved `CDP_JS` path. All commands use `node "$CDP_JS" <command>`.

Run `node "$CDP_JS"` (no args) to see the full command list.

Key guidance:

- **Targeting**: selector-based. Use CSS selectors for `click`, `type`.
- **Page understanding**: `ax-tree` is the primary method (semantic roles and
  names). Use `dom` as fallback for raw HTML.
- **Screenshots**: save to `/tmp/`, then use the Read tool to view the PNG.
- **Eval**: supports promises: `eval "await fetch('/api').then(r=>r.json())"`
- **Tab targeting**: use `list` to see tabs with IDs, then `--id <target-id>`
  on any command.
- **Tab workarounds**: `eval "window.open('<url>')"` then `list` for new tabs.
  `eval "window.close()"` to close (only works on script-opened tabs).
- **Streaming**: `console` and `network` commands stream events for debugging
  (not available in other layers).
