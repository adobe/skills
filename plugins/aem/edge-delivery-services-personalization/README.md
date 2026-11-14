# aem-eds-personalization

Section-based personalization for AEM Edge Delivery Services pages authored in DA.

Authors personalize a **section** with `Personalization` rows in its Section Metadata. The section's
authored content is the default (what bots, failures, timeouts and visitors without consent see);
variants are EDS fragments chosen by rules, a decision engine, an A/B split or Adobe Target.
It implements the EDS personalization contract (v0.5): consent first (no consent, no
personalization, exceptions only with privacy/legal approval), one outcome per decision, `pzn:*`
measurement events per decision, and an edge handoff the browser trusts.

```
| Section Metadata               |                                                |
| Personalization                | home-hero                                      |
| Personalization Source         | rules   (default) | api | split | target       |
| Personalization Variants       | /fragments/personalization/home-hero/india     |
|                                | /fragments/personalization/home-hero/na-mobile |
| Personalization Rule India     | geo: IN                                        |
| Personalization Rule NA Mobile | geo: US, CA & device: mobile                   |
```

| Source | Decides |
|---|---|
| `rules` | First matching `Personalization Rule <Variant>` row: geo, device, new/returning visitor, URL/UTM param, page state, custom audiences |
| `split` | A/B(/n) test against the authored content (the control), weighted by `Personalization Split`, kept for the session |
| `api` | A decision engine over the v1 API (OF1 through the reference adapter), the Rule rows as the written fallback |
| `target` | Adobe Target (Delivery API or Web SDK) with JSON `{ "fragment" }` / `{ "control": true }` offers; inline, or a popup on scroll/view/load |

## Install

```bash
/plugin marketplace add adobe/skills
/plugin install aem-eds-personalization@adobe-skills
```

Then, in an EDS project:

```
/aem-eds-personalization:personalize geo hero on /home: India, US, Europe; TODO copy
/aem-eds-personalization:personalize A/B test the closing CTA section on /home 50/50
```

## Skills

| Skill | Description |
|-------|-------------|
| `personalize` | Installs the client runtime and `scripts.js` hooks, records and wires consent, authors Section Metadata and variant fragments, validates (contract schemas, simulator, project lint, Playwright checks for outcomes, events, re-evaluation, consent changes, faults, splits, popups, page speed and the pilot scenarios) and delivers to DA. Optional Cloudflare edge worker that decides `rules`, `split` and `api` sections before the HTML leaves the CDN (applied / selected / left, LCP-safe) and hosts the engine's server route. |

## Scope

- DA projects only; xwalk and document-based projects stop at preflight.
- Section Metadata must reach the page as section attributes: the pipeline's rendering v2, or an
  `aem.js` that still reads Section Metadata client-side.
- Not for creating Target activities, audiences or offers, AJO journeys, or text-token replacement
  (placeholders sheet). Page-level experiments stay with AEM Experimentation (a page running one
  gets no personalized sections).
- No personal data is read, stored or sent; engine keys stay on the server (a Worker secret).
- Works on any EDS site, and on top of a migration (for example after the `stardust` plugin's
  `deploy`) when the use case needs it. Nothing in another plugin chains it.
- The edge worker is generated and tested locally; `wrangler deploy` and secrets are always handed
  off to the site owner, never run by the agent.

## Requirements

- Node 22+, `@adobe/aem-cli` 16.21+ (`aem up`) for local preview
- Playwright with Chromium in the skill folder or `~/.cache/aem-eds-personalization/playwright`
  for `verify-preview` (never installed into the site)
- `wrangler` only for edge mode
- A `DA_TOKEN` (see the `da-auth` skill in `aem-edge-delivery-services`) or a DA MCP server for
  delivery

## Layout

```
skills/personalize/
├── SKILL.md         workflow (preflight → choices → install → author → configure → validate → edge → deliver)
├── reference/       authoring, criteria, consent, decisions and measurement, client and edge modes,
│                    engine API, split, Target, testing, DA
├── assets/          contract schemas and pilot scenarios, content templates, client runtime,
│                    popup styles, Cloudflare worker (with the OF1 adapter)
└── scripts/         detect, install, validate, simulate, verify, mock API/Target (+ tests)
evals/personalize/   task.md and criteria.json (seven runs on a DA sandbox)
```

## Tests

```bash
cd plugins/aem/edge-delivery-services-personalization/skills/personalize && npm test
```

The browser runtime tests run when Playwright resolves from the skill folder or the cache, and are
left out otherwise.
