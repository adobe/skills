# CDP Extension Pilot — Troubleshooting

## Popup context

Opening popup.html as a tab runs in a `page` context, not `popup`. Extension
code using `chrome.extension.getViews({ type: "popup" })` will see different
results than a real popup invocation.

## Sidepanel screenshots

Use the sidepanel's target ID (returned by `web ext open sidepanel`), not the page
target — they are separate CDP targets with separate JS contexts.

## Sidepanel fallback for extensions without content scripts

`web ext open sidepanel` triggers the panel via a content script context. Extensions
that declare no `content_scripts` fall back automatically: the sidepanel URL
is opened as a tab (`chrome-extension://<id>/<path>`) and the JSON output
becomes `{ surface, url, note }`, where `note` says why the gesture path was skipped. The UI renders fully and CDP interaction works
normally — the only difference is the JS context is `page`, not `sidepanel`,
so APIs like `chrome.extension.getViews({ type: "popup" })` behave differently.

`chrome.sidePanel.open()` requires a user gesture enforced at the browser
process level. There is no CDP command to bypass this; `Runtime.evaluate` with
`userGesture: true` runs in the renderer context and cannot reach the extension
service worker where the gesture check applies.

To get a true sidepanel context: add a `content_scripts` entry that matches
the target page URL, and handle `{type: "open_side_panel"}` in the service
worker by calling `chrome.sidePanel.open({ tabId })` synchronously inside
`chrome.runtime.onMessage`.

## Content scripts

Content scripts are reachable with `web browser cdp` on the page session. Use
`Runtime.enable` to enumerate execution contexts and find the extension's
isolated world.

## Cookie banners

Use the `page-prep` skill to dismiss overlays before testing extension
behavior on a target page.

## Extension failed to load

- Verify the path points to the directory containing `manifest.json` (not a
  parent directory).
- Branded Chrome 137+ refuses unpacked extensions without
  `--enable-unsafe-extension-debugging`; `web ext launch` handles this.
- If `extensionId` is null after retry, check the Chrome DevTools console for
  manifest parsing errors.
