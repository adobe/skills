# stardust:deploy: step 1, audit

The text of this part of `skills/deploy/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

### 1. Audit (light)

**First, normalize the input to static HTML.** If a prototype is React/JSX (an HTML shell that mounts `.jsx` into `#root`), **pre-render it to static HTML** before auditing (#24). The reliable recipe:
```bash
# 1. serve the prototype's OWN folder with a plain static server (NOT file:// —
#    babel-standalone XHRs the .jsx and file:// CORS-blocks it; the aem dev
#    server CSP-blocks the inline scripts too).
( cd samples/<proto> && python3 -m http.server 8765 & )
# 2. load in Playwright (React/babel load from unpkg — needs internet), wait for
#    mount, capture #root's innerHTML, save it for the block agents to read:
#    page.goto('http://localhost:8765/<file>.html'); waitForTimeout(4000);
#    fs.writeFileSync('stardust/.work/prerender/<proto>.html', root.innerHTML)   # never write into samples/ (user input)
```
From there it converts like an external-CSS prototype (semantic classes + the prototype's `.css`). If it's `<x-dc>` document-content, the sections are still `<section>`/`<div>` elements; just expect inline `style="…"` instead of a `<style>` block. The rest of this skill assumes a static `<main>` exists.

**View behind routing / sign-in (#27).** If the view you want is not the default render (e.g. a signed-in dashboard behind a sign-on flow), **seed the app's persisted state before it boots** rather than capturing the landing page. Many prototypes persist their route to `localStorage`: `page.addInitScript(() => localStorage.setItem('<key>', JSON.stringify({page:'dashboard', user:'Alex'})))` then navigate. Generic alternatives: drive the UI to the view (fill + submit the sign-on form, then capture) or set the router hash/URL. Capture `#root` for the view you actually intend to convert.

Read every prototype's `<main>` markup (skip the `<style>` for now) and produce a per-page section list:

```
home: hero, work, approach, team, clients, closing
approach: approach-hero, manifesto, tenets-detailed, cadence, closing
team: team-hero, team-roster, work-style, recent, careers, closing
…
```

A useful pattern: dispatch a read-only exploration subagent with this exact ask where the harness offers one (Claude Code: the `Explore` agent at thoroughness=quick); otherwise run the search inline. You don't need a 22-pattern punch list — you need filenames + section names. **Resist the urge to "find shared patterns."** Pattern reuse will emerge organically when two sections turn out to be byte-identical.

**Fingerprint per-instance variation BEFORE writing block code (#90).** A section-name list is
copy-level; it does NOT reveal that instances *inside* a repeated group look different — an active
filter chip vs its outline siblings, a filled accent CTA among outline CTAs, image cards vs
image-less title-cards. Those are the details a copy-driven conversion silently flattens (a whole
grid of identical cards, one CTA styled like the rest), and the mandatory gates (one `<h1>`, grids
compute `grid`) still pass. So run the proactive probe up front:
`node skills/deploy/scripts/style-fingerprint.mjs "file://<abs>/<proto>.html"`. For every group of
sibling instances it clusters each instance by a COMBINED signature — computed **style-delta**
(`background/border/color/background-image/weight/align`) AND **structural** (`hasImg`, `hasSvg`,
child count) — and reports any group with >1 cluster as a **candidate** per-instance variation for
the owning block to reproduce. It is advisory: it will also flag legitimate variation (a footer with
one bold link among plain ones), so filter false positives with judgment — but never flatten a real
variant (an active chip, an accent CTA, an image-less card) just because the block treats siblings uniformly.
The structural half is load-bearing: image-vs-image-less cards (and any `:has()`/`:not()`-driven
variant) share the same top-level computed style, so a style-only probe misses them — include the
structural signals. The manifest becomes the block author's checklist — every cluster of a repeating group is a
variant word the block declares with `@variants` (ENCODE contract #134), never a style value in a cell; this is the pre-block
complement to Step 10's post-deploy `content-diff` (which catches the same class of miss too late).
