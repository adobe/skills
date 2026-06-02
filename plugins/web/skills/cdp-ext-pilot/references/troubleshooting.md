# CDP Extension Pilot — Troubleshooting

## Popup context

Opening popup.html as a tab runs in a `page` context, not `popup`. Extension
code using `chrome.extension.getViews({ type: "popup" })` will see different
results than a real popup invocation.

## Sidepanel screenshots

Use the sidepanel's target ID (returned by `open sidepanel`), not the page
target — they are separate CDP targets with separate JS contexts.

## Content scripts

Content scripts are accessible via `cdp-connect` on the page target. Use
`Runtime.enable` to enumerate execution contexts and find the extension's
isolated world.

## Cookie banners

Use the `page-prep` skill to dismiss overlays before testing extension
behavior on a target page.

## Extension failed to load

- Verify the path points to the directory containing `manifest.json` (not a
  parent directory).
- Check `status` output for `chromeVariant` — branded Chrome 137+ requires
  the pipe dance (`--enable-unsafe-extension-debugging`), which is handled
  automatically by `cdp-ext-pilot.mjs`.
- If `extensionId` is null after retry, check the Chrome DevTools console for
  manifest parsing errors.
