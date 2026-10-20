# web plugin evals

Tessl scenarios (`<scenario>/task.md`, `criteria.json`, `resources/`). Run with
`tessl eval run plugins/web`; CI runs them on an `eval:` commit (see CONTRIBUTING.md).

The Tessl sandbox has network access and can install playwright-cli and download
Chromium, but the browser crashes on launch (missing system libraries, no root).
So scenarios give the agent browser output captured from live pages in
`resources/` and test what the skill adds after the browser step:

| Scenario | Skill | Fixture source |
|---|---|---|
| browser-probe-recipe-from-report | browser-probe | `web probe` report (CloudFront UA block) |
| browser-probe-all-blocked | browser-probe | `web probe` report, every step blocked (Akamai Bot Manager; exit 3) |
| page-reduce-skeleton-from-phase1 | page-reduce | `web page reduce` output from https://www.aem.live/ |
| page-langs-audit-from-capture | page-langs | browser-step output of `web page langs` (signals and text) from a local en/es/de test page, URL rewritten |
| page-prep-throwaway-session-cleanup | page-prep | `web page overlays` detection report from https://www.20minutes.fr/ |
| domain-mask-demo-domain | domain-mask | none |

cdp-connect (a pointer), cdp-ext-pilot, page-tree and page-collect have no scenarios: what they
add happens inside a live browser.

To refresh a fixture, rerun the skill's `web` command locally and replace the file in
`resources/`; keep the facts the criteria rely on (named in each `criteria.json`
context).
