# aem-eds-personalization

Placeholder-based personalization for AEM Edge Delivery Services pages authored in DA.

Authors place a **Personalization block** in a page. Its rows map conditions to EDS fragments; the
first match wins and the `default` row is the fallback that bots, failures, timeouts and
no-consent visitors see.

```
| Personalization              |                                                |
| id                           | home-hero                                      |
| geo: IN                      | /fragments/personalization/home-hero/india     |
| geo: US, CA & device: mobile | /fragments/personalization/home-hero/na-mobile |
| visitor: returning           | /fragments/personalization/home-hero/welcome-back |
| default                      | /fragments/personalization/home-hero/default   |
```

## Install

```bash
/plugin marketplace add adobe/skills
/plugin install aem-eds-personalization@adobe-skills
```

Then, in an EDS project:

```
/aem-eds-personalization:personalize geo hero on /home: India, US, Europe; TODO copy
```

## Skills

| Skill | Description |
|-------|-------------|
| `personalize` | Installs the client runtime and the Personalization block, authors the placeholder and its fragments, validates them (rules simulator, project lint, Playwright check) and delivers to DA. Optional Cloudflare edge worker for flicker-free, LCP-safe above-the-fold decisions. |

Criteria: geo, device, new/returning visitor, URL/UTM param, app or quiz state, custom audiences,
or a decision-engine API with local rules as fallback.

## Scope

- DA projects only; xwalk and document-based projects stop at preflight.
- Not for A/B tests or traffic splits, Adobe Target/AJO activity setup, or text-token replacement.
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
├── SKILL.md         workflow (preflight → install → author → validate → deliver)
├── reference/       authoring model, criteria, client and edge modes, API contract, testing, DA
├── assets/          content templates, client runtime, Cloudflare worker
└── scripts/         detect, install, validate, simulate, verify, mock API (+ tests)
evals/personalize/   task.md and criteria.json (seven runs on a DA sandbox)
```

## Tests

```bash
node --test plugins/aem/edge-delivery-services-personalization/skills/personalize/scripts/test/*.test.mjs
```

The browser runtime tests run when Playwright resolves from the skill folder or the cache, and are
left out otherwise.
