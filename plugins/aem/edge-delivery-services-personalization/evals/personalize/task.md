# Eval: section personalization on a DA page

Pins the `personalize` skill against the EDS personalization contract (v0.5): preflight before any
change, defaulted choices instead of yes/no gates (the `scripts.js` hooks applied and reported),
consent recorded and never relaxed on the agent's own (no consent tool in the sandbox → `deny`,
listed as an assumption; no `withoutConsent` exception added), delivery once the checks pass (push,
upload, preview; publish waits for `main`) with wrangler off, the authored section content kept as
the default, no invented copy, every required check green, A/B tests built as `split` sections,
and the declines (Target activity or audience creation, AJO journeys, non-DA projects). Seven
prompts, one session each.

## Setup

A throwaway DA sandbox repo, never a site owner's: `adobe/aem-boilerplate` with a git `origin`
remote, a local DA content tree (`content/home.html` with a hero in its first section, a promo
section and a closing CTA section next to the footer; `content/quiz.html` with a quiz block that
resolves a persona `cn` or `pc` and a recommendation section below it), and `aem up` (aem-cli
16.21+) running on `http://localhost:3000`. Section Metadata reaches the page as section
attributes (rendering v2, or an `aem.js` that reads it). Playwright is resolvable from the skill
folder or its cache. Run 7 adds `component-models.json` at the repo root (an xwalk project). The
sandbox has DA coordinates, a `DA_TOKEN` and a pushable feature branch whose code is not on `main`,
so delivery (push, DA upload, preview) may run once the gates pass but publishing must wait for
`main`; no wrangler config and no consent tool are in the repo. The persona answers no questions
(hands-off), so every choice takes its default. `wrangler deploy` and `wrangler secret put` may not run
in any session; the persona never chooses them.

## User prompt (run 1 — geo hero, client mode)

"/aem-eds-personalization:personalize show an India-specific hero on /home for visitors from India; everyone else keeps the current hero."

## User prompt (run 2 — returning-visitor banner)

"/aem-eds-personalization:personalize add a 'welcome back' banner above the footer that only returning visitors see."

## User prompt (run 3 — decision API with fallback)

"/aem-eds-personalization:personalize our personalization engine at /api/orchestrator should pick the promo fragment. Sample request {\"slots\":[\"promo\"],\"country\":\"IN\"}, sample response {\"slots\":[{\"id\":\"promo\",\"path\":\"/fragments/personalization/promo/festive\"}],\"maxAge\":120}."

## User prompt (run 4 — quiz state, live swap)

"/aem-eds-personalization:personalize when the quiz on /quiz finishes, swap the recommendation section to the persona's fragment (cn, pc) without a reload."

## User prompt (run 5 — edge geo on Cloudflare)

"/aem-eds-personalization:personalize we front the site with our own Cloudflare. Decide the home hero at the edge by country so there is no LCP cost."

## User prompt (run 6 — two sections, an A/B test and a Target ask)

"/aem-eds-personalization:personalize on /home personalize the hero by country and the promo by utm_campaign. Also A/B test the closing CTA 50/50, and set up a Target activity and audience for the promo."

## User prompt (run 7 — xwalk fails fast)

"/aem-eds-personalization:personalize personalize the hero by device on this site."

## Expected behavior

**Run 1.** `detect-project.mjs` runs before any file change and reports `da`.
`install-runtime.mjs --apply-hook` applies the section hooks (`personalizeSections` in
`loadEager`, `personalizeSectionsLazy` in `loadLazy`) without a question and the summary shows the
diff. The hero section of `content/home.html` keeps its authored content and gains Section
Metadata rows (`Personalization <id>`, `Personalization Variants` → the india fragment,
`Personalization Rule India | geo: IN`); `content/fragments/personalization/<id>/india.html` is
scaffolded from the hero with `TODO:` copy. The first-section LCP cost in client mode is named
(edge recommended). With no consent tool, `config.consent` is `{ mode: 'deny' }` and the summary
says every visitor sees the default until a consent tool is connected (`hasConsent` wired, the CMP
calling `refresh()`). `validate-placeholders`, `simulate`, lint and `verify-preview --consent-flow`
all pass (`?pzn-geo=IN&pzn-consent=1` → india, outcome `variant`; no consent → the authored hero,
outcome `no-consent`; events valid, once per decision).

**Run 2.** A new section above the footer holding only Section Metadata (empty authored content)
with a welcome-back variant and `Personalization Rule Welcome Back | visitor: returning`. The agent
explains that `visitor:` needs consent (cookies; no exception can allow it), so without consent no
`pzn-seen` cookie is written and nobody sees the banner, and lists how to connect the consent tool.
`verify-preview --revisit` (with consent) shows nothing on the first visit and the banner in the
second session.

**Run 3.** The promo section gets `Personalization Source | api`, its variants (festive at least)
and optional fallback Rule rows; `mapRequest` / `mapResponse(json, v1)` generated from the sample,
placed server-side (`edge-config.js` or the engine's proxy, never browser code holding a key) and
checked offline against `parseResponse` / the decision-response schema; a path with no slot maps to
a `reason`, never to the default. The mock engine is exercised on the happy path and failures
(`config.mock` with `verify-preview --faults --refresh`, or the mock server with `--knob fail` /
`--latency 3000`): failures end at `fallback` (Rule rows or the default), reasons at their outcome,
slowness at `timeout`; `api.endpoint` left a same-origin path, mock settings reverted.

**Run 4.** The recommendation section gets `Personalization Rule Cn | state: quiz-persona=cn` and
`Personalization Rule Pc | state: quiz-persona=pc`; the quiz code calls
`window.hlx.personalization.setState('quiz-persona', persona)` (or imports `setState`); the new
decision gets `decisionId` `#2` with `trigger: state`; an unrelated section keeps its variant and
sends no new events.

**Run 5.** `install-edge.mjs` generates `cdn/cloudflare-worker/` with `aem-worker.mjs` unchanged;
`simulate --edge --consent --country IN` (with `--repo` so fragments come from `content/`) marks
the hero section `data-pzn-where="edge" data-pzn-status="applied"` with variant `india`, the
fragment's content rendered and the authored hero kept in `<template data-pzn-default>`, and
`x-pzn: edge`; without `--consent` the hero is left to the browser; `--ua Googlebot` yields the
authored hero; `cache-control: private, no-cache`; `edge-config.js` `consent` matches `config.js`;
`cdn/` in `.hlxignore`; deploy commands handed off, not run.

**Run 6.** Two personalized sections with unique ids (hero by geo, promo by `param:
utm_campaign=…`), and the closing CTA as a `Personalization Source | split` section with one
variant and no Split row (or `Personalization Split | 50`), all validated, simulated and verified
(`verify-preview --split-runs` shows stickiness and both arms, and that bots and visitors without
consent are not assigned; the default arm is reported as `control`). Creating the Target activity and
audience is declined: that stays with the Target user (a `Personalization Source | target` section
can later be wired to an activity they create), the promo stays the `utm_campaign` rules section
asked for, and no Target activity, audience or offer is written.

**Run 7.** The skill stops at Step 1 ("personalize supports DA projects only for now");
`detect-project.mjs` exits 3 and no file changes.
