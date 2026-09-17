# page-prep Data Formats

## Detection Report Format

Returned by the bundle injection (Step 5). Parse to enumerate overlays.

```jsonc
{
  "overlays": [
    {
      "id": "overlay-0",
      "type": "cookie-consent",
      "source": "cmp-match",       // "cmp-match" | "heuristic"
      "cmp": "cookiebot",          // CMP name (only for cmp-match)
      "selector": "#CybotCookiebotDialog",
      "confidence": 1.0,
      "hide": ["#CybotCookiebotDialog { display:none!important }"],
      "dismiss": [{ "action": "click", "selector": "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll" }]
    },
    {
      "id": "overlay-1",
      "type": "unknown-modal",
      "source": "heuristic",
      "selector": "div.gdpr-wall",
      "confidence": 0.45,
      "signals": ["high-z-index", "keyword-match", "scroll-lock-boost"],
      "hide": ["div.gdpr-wall { display:none!important }"],
      "dismiss": null               // agent composes dismiss (see Agent Fallback)
    }
  ],
  "scroll_locked": true,
  "scroll_fix": "html,body { overflow:auto!important; height:auto!important }"
}
```

## Recipe Manifest Format

Produced by Step 7. Combines hide and dismiss recipes for all overlays.

```json
{
  "overlays": [
    {
      "id": "cookiebot",
      "hide": { "css": ["#CybotCookiebotDialog { display: none !important; }"] },
      "dismiss": { "steps": [{ "action": "click", "selector": "#accept-btn" }] }
    }
  ],
  "scroll_fix": "document.body.style.overflow=''"
}
```
