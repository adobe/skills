# Watch Mode Snippet

Inject via `playwright-cli eval` after cleanup to auto-handle overlays that
appear dynamically (SPAs, lazy-loaded banners). Set `MODE` to `'hide'` or
`'dismiss'` before injecting.

```js
window.__pagePrep = (() => {
  let timer = null;
  let pending = [];
  const MODE = 'hide'; // 'hide' | 'dismiss'

  function scan() {
    const found = window.__pagePrepScan?.() ?? [];
    if (found.length === 0) return;

    if (MODE === 'hide') {
      found.forEach(o => {
        const el = document.querySelector(o.selector);
        if (el) el.style.display = 'none';
      });
    } else {
      found.forEach(o => {
        if (!pending.find(p => p.id === o.id)) pending.push(o);
      });
    }
  }

  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 500);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  return {
    watch: () => observer.observe(document.body, { childList: true, subtree: true }),
    stop:  () => { observer.disconnect(); clearTimeout(timer); },
    pending: () => [...pending],
  };
})();
```

- **hide mode**: overlays removed automatically as they appear.
- **dismiss mode**: overlays queued in `window.__pagePrep.pending()` for the
  agent to process interactively (useful when consent must be recorded).
