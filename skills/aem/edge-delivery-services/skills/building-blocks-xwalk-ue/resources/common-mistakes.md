# Common Mistakes Reference

Quick-reference table of common mistakes when developing AEM Edge Delivery blocks with Universal Editor integration.

| Mistake | Fix |
|---------|-----|
| Not considering key-value pattern | Check the key-value decision tree BEFORE implementing |
| Using key-value for blocks with filter | Blocks with `filter` MUST NEVER have `key-value: true` — THE CRITICAL RULE |
| Using key-value for parent containers | Parent containers with children should NOT use key-value |
| Not using key-value for child items | Child components (accordion-item, card, etc.) SHOULD use key-value |
| Forgetting backward compatibility | Always provide fallback chain: config → dataset → default |
| Forgetting models registration | Block won't appear in Universal Editor. Add to `./models/` |
| Not asking about model placement | If not specified, ASK which model(s) block should be available in |
| Manually parsing config rows | ALWAYS use `readBlockConfig()` from aem.js for configuration |
| Creating images manually | Use `createOptimizedPicture()` for all images (WebP, responsive) |
| Manual button/icon decoration | Use `decorateButtons()` and `decorateIcons()` utilities |
| Hardcoding icon paths | Use `decorateIcons()` — automatically loads from `/icons/` |
| Custom class name sanitization | Use `toClassName()` for consistent class name generation |
| Hardcoding colors | Use CSS variables from `styles/styles.css` |
| Putting autoblocking in scripts.js | Autoblocking goes in `aem.js` (in `decorateSections`) |
| Putting editor code in block.js | Editor-only code goes in `editor-support.js` |
| Adding duplicate event listeners | Use `dataset.listenerAttached` guard pattern |
| Using readBlockConfig for parent containers | Parent containers with filter query children directly |
| Forgetting moveInstrumentation() | Universal Editor breaks. ALWAYS use it on DOM transformations. |
| Not reading data-aue-prop first | Check `col.dataset.aueProp` before `col.textContent` |
| Not testing edge cases | Empty blocks, missing config, invalid data all need consideration |
| Skipping accessibility | WCAG 2.1 AA is mandatory. Test ARIA attributes and keyboard navigation. |
| Using non-kebab-case in JSON field names | Field `name` MUST be kebab-case; `readBlockConfig()` uses `toClassName()` which outputs kebab-case |
| Condition `var` not matching field name | Condition references must exactly match kebab-case field `name` values |
| Not running linting | All files MUST pass linting. |
