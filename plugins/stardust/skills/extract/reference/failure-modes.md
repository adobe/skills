# stardust:extract: failure modes

The text of this part of `skills/extract/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

- **Network failure mid-crawl.** Continue, record in `_crawl-log.json`,
  end with a partial state. State.json reflects only successfully
  extracted pages. User can re-run; already-extracted pages are
  skipped unless `--refresh <slug>`.
- **HTTP 4xx/5xx, non-HTML content, soft-404s.** Validated explicitly
  per `reference/playwright-recipe.md` § Response validation. Each
  produces a distinct error class (`HTTPError`, `ContentTypeError`,
  `EmptyPageError`) recorded in `_crawl-log.json#crawl.failures[]`.
  Failed pages do **not** appear in `state.json` as `extracted` —
  they appear only in the failure log. Without this validation a 5xx
  page silently lands as an empty success and propagates wrong data
  to `direct` and `prototype`.
- **Login wall.** Do not attempt to authenticate. If the home page
  redirects to a login screen, capture that one page, mark the rest as
  unreachable, and ask the user how to proceed (provide cookies via
  Playwright config, change the entry URL, or scope to public pages).
- **Bot-management block (Akamai / Cloudflare / F5 / Imperva / CloudFront).**
  When the first navigation returns `ERR_HTTP2_PROTOCOL_ERROR`,
  `ERR_QUIC_PROTOCOL_ERROR`, or hangs through the hard-cap on a
  TLS/H2 fingerprint check, the issue is JA3/H2 fingerprinting on
  bundled-chromium-default headless mode — not auth, not network.
  `crawl.mjs` runs the fallback itself, window-free: real Chrome
  headless (`channel: 'chrome'`, its own identity, no launch
  flags) first, bundled Chromium only when Chrome is missing, one
  real-Chrome relaunch with the challenge-solve window on an
  entry-page block, and a wall — an edge 403 or a 200 verification
  interstitial — is named within seconds in `_crawl-log.json`
  (`discovery.botBlock`, per-page `BotChallenge` failures), never
  captured as content (`node crawl.mjs --help`; a hand-rolled recipe
  follows `reference/playwright-recipe.md` § Bot-management
  fallback). Note for asset harvest: a page-level bot wall usually
  does NOT gate assets — media/CSS/font URLs commonly return 200 to
  a plain browser-UA curl even while every page navigation is
  challenged (Cloudflare challenge, field-confirmed). Probe one
  asset with curl BEFORE reaching for in-page-fetch machinery; the
  in-page harvest is the fallback, not the default.
- **JavaScript-only content.** Playwright already handles this. If
  the configured wait condition never fires within the mode's hard
  cap (`reference/playwright-recipe.md` § Wait modes), fall back to
  `domcontentloaded` and capture what is rendered. Record the
  fallback in the per-page `_provenance.waitMode` and surface in the
  wait-summary line of the final report.
- **Synthesis attempt (forbidden).** When the agent (or a delegated
  sub-agent) cannot run a real Playwright render for a page —
  whether due to time pressure, token budget, or a tool/network
  failure — the only correct outcome is to record the page as a
  Phase 2 failure (`errorClass: "ProvenanceMissing"` in
  `_crawl-log.json#crawl.failures[]`) and continue. **Synthesizing
  a page record from `_brand-extraction.json` plus URL patterns
  plus captured photos at "semantically matching" template
  positions is forbidden.** The shortcut produces output
  indistinguishable from a successful run and propagates
  fabricated content through every downstream phase
  (2026-04-30 e-commerce run: 20 of 25 pages synthesized, caught
  four phases later).
