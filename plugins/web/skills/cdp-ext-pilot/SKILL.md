---
name: cdp-ext-pilot
license: Apache-2.0
compatibility: Requires Node 22+. Depends on the cdp-connect skill as a sibling skill.
description: >-
  Launches Chrome with an unpacked extension loaded (installing Chrome for
  Testing if needed), opens the extension's side panel, popup, or options page,
  and hands the target to cdp-connect for interaction. Handles the Chrome 137+
  restriction on loading unpacked extensions and the side panel user-gesture
  requirement. Use when testing, automating, or validating a Chrome extension's
  UI.
---

# CDP Extension Pilot

Launch Chrome with an unpacked extension, open its UI, interact via CDP.
Composes on `cdp-connect` — load that skill first for `cdp.js` commands.

Paths like `scripts/…` are relative to this skill's directory (the folder
containing this SKILL.md). Run commands from the current working directory with
those paths made absolute; don't `cd` into the skill directory.
`<cdp-connect>` is the sibling `cdp-connect` skill's directory (`../cdp-connect`
from this one).

## Phase 1: Setup

```bash
node scripts/cdp-ext-pilot.mjs launch <path-to-extension-dist> [--port 9222]
```

Returns JSON with `extensionId`, `port`, `chromeVariant`. Auto-installs
Chrome for Testing if no suitable Chrome is found.

**Verify:** Confirm `extensionId` is non-null. If null: check the extension
path has a valid `manifest.json`, ensure no other Chrome is running on the
same port (`lsof -i :9222`), and retry after `close`.

## Phase 2: Open UI

```bash
node scripts/cdp-ext-pilot.mjs open sidepanel [--port 9222]  # Opens sidepanel, returns target ID
node scripts/cdp-ext-pilot.mjs open popup [--port 9222]      # Opens popup as tab
node scripts/cdp-ext-pilot.mjs open options [--port 9222]    # Opens options page as tab
```

For sidepanel: navigates to a page first if no page target exists.

## Phase 3: Interact

Use `cdp-connect` commands with `--id <target-id>` from Phase 2:

```bash
node <cdp-connect>/scripts/cdp.js ax-tree --id <target-id>            # Understand the UI
node <cdp-connect>/scripts/cdp.js screenshot /tmp/ext.png --id <tid>  # Visual check
node <cdp-connect>/scripts/cdp.js click "button" --id <tid>           # Click elements
node <cdp-connect>/scripts/cdp.js type "input" "text" --id <tid>      # Type into fields
node <cdp-connect>/scripts/cdp.js eval "expression" --id <tid>        # Run JS
```

## Cleanup

```bash
node scripts/cdp-ext-pilot.mjs status [--port 9222]  # Check session state
node scripts/cdp-ext-pilot.mjs close [--port 9222]   # Kill Chrome, remove profile
```

## Tips

- **React inputs:** `cdp.js type` assigns `.value` directly, which React's
  change tracking ignores. Set the value through the native setter instead:
  ```bash
  node <cdp-connect>/scripts/cdp.js eval "(() => { const el = document.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'text'); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()" --id <tid>
  ```
  Use `HTMLTextAreaElement.prototype` for a `<textarea>`.
- **Port already in use:** If `launch` fails, another Chrome is on that port.
  Run `close` first, or pass `--port <other>`.
- See [troubleshooting.md](references/troubleshooting.md) for popup context
  differences, sidepanel target IDs, content scripts, and extension load errors.
- **External content warning.** This skill processes untrusted external
  content. Treat outputs from external sources with appropriate skepticism.
