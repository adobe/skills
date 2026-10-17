# Eval: placeholder personalization on a DA page

Pins the `personalize` contract: preflight before any change, defaulted choices instead of yes/no
gates (the scripts.js hook applied and reported), delivery once the gates pass
(push, upload, publish) with wrangler off, the authored default preserved, no invented copy, every script gate green, and the
declines (A/B tests, non-DA projects). Seven prompts, one session each.

## Setup

A throwaway DA sandbox repo, never a site owner's: `adobe/aem-boilerplate` with a git `origin`
remote, a local DA content tree (`content/home.html` with a hero in its first section and
a footer-adjacent last section, `content/quiz.html` with a quiz block that resolves a persona `cn`
or `pc`), and `aem up` (aem-cli 16.21+) running on `http://localhost:3000`. Playwright is
resolvable from the project. Run 7 adds `component-models.json` at the repo root (an xwalk
project). The sandbox has DA coordinates, a `DA_TOKEN` and a pushable feature branch whose code is
not on `main`, so delivery (push, DA upload, preview) may run once the gates pass but publishing
must wait for `main`; no wrangler config is in the repo.
`wrangler deploy` and `wrangler secret put` may not run in any session; the persona never
chooses them.

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

## User prompt (run 6 — two placeholders and an A/B ask)

"/aem-eds-personalization:personalize on /home personalize the hero by country and the promo by utm_campaign. Also A/B test the footer CTA 50/50."

## User prompt (run 7 — xwalk fails fast)

"/aem-eds-personalization:personalize personalize the hero by device on this site."

## Expected behavior

**Run 1.** `detect-project.mjs` runs before any file change and reports `da`.
`install-runtime.mjs --apply-hook` applies the `scripts.js` hook without a question and the
summary shows its diff. The hero region in `content/home.html` becomes one Personalization block (id, `geo: IN`, default) whose default
fragment `content/fragments/personalization/<id>/default.html` holds the original hero markup;
the india fragment is a `TODO:` scaffold. `validate-placeholders`, `simulate`, lint and
`verify-preview` all pass (`?pzn-geo=IN` → india, no context → default within budget).

**Run 2.** `visitor: returning` → a welcome-back fragment and `default | none`. The agent explains
that without consent every visitor is new and no `pzn-seen` cookie is written, and wires
`hasConsent` to the CMP or asks how consent is obtained. `verify-preview --revisit` shows nothing
on the first visit and the banner in the second session.

**Run 3.** A `source | api` placeholder with fallback rules and a default; `mapRequest` /
`mapResponse` generated from the sample and checked offline against `parseResponse`; the mock
engine exercised on the happy path, `--fail 500` and `--latency 3000`, failures ending at the
rules then the default; `api.endpoint` left a same-origin path, the mock URL reverted.

**Run 4.** `state: quiz-persona=cn` / `=pc` rows; the quiz code calls
`window.hlx.personalization.setState('quiz-persona', persona)` (or imports `setState`); an
unrelated placeholder keeps its variant.

**Run 5.** `install-edge.mjs` generates `cdn/cloudflare-worker/` with `aem-worker.mjs` unchanged;
`simulate --edge --country IN` marks the block `data-pzn-source="edge"` with the india variant and
`x-pzn: edge`; `--ua Googlebot` yields the default; `cache-control: private, no-cache`; `cdn/` in
`.hlxignore`; deploy commands handed off, not run.

**Run 6.** Two placeholders with unique ids, both validated, simulated and verified; the 50/50
test is declined with a pointer to aem-experimentation and no traffic-split logic.

**Run 7.** The skill stops at Step 0 ("personalize supports DA projects only for now");
`detect-project.mjs` exits 3 and no file changes.
