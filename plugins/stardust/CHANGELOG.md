# Changelog

This file starts at 0.14.0. Prior versions (0.3.0 – 0.13.1) are documented in
git history only (plus the branch-scoped notes in
`CHANGELOG-redesign-adobecom.md` and `CHANGELOG-delivery-media-fidelity.md`).

## 0.16.0 — two new entry points: replica (same-design migration) and reskin (content × donor design)

Round-1 outcome of the three-new-use-cases exploration (research, candidate
designs, and validation evidence in `notes/new-use-cases/`). Both flows were
validated on real pages before codification — replica converged aesop.com to
a 1.31% pixel diff with zero structural findings in 3 measured iterations;
reskin carried hirslanden.ch content byte-identically (2281/2281 chars,
47/47 slots, 13/13 metadata) onto stripe.com's token system with 91% of
slots mapped to named donor modules. No existing skill was modified (round-2
synergy candidates are listed in `notes/new-use-cases/ROUND-1-REPORT.md`).

- **`stardust:replica`** (new): same-design migration to AEM EDS. extract
  `--prep` unchanged → mechanical preserve-direction (current-state spec
  promoted verbatim as target; deltas only via the inconsistency register) →
  clean re-authored archetype recreation (values lifted from the source
  site's own CSS, never DOM copies) → measured source-fidelity gate per
  breakpoint (diff's two probes `--profile generic` + new
  `stitch-shot.mjs`/`pixel-compare.mjs` stitched pixel probe with per-band
  breakdown, ≤3 iterations) → migrate sibling tier / deploy
  (template-slotted bias) / rollout unchanged.
- **`stardust:reskin`** (new): byte-faithful content onto a donor design
  system (live URL via extract `--design-source`, or local prototypes;
  Figma donor contract-defined, not implemented). Content-model capture with
  scope declaration + executable normalization ledger → mapping brief
  (≥80% slots mapped to named donor modules, no silent improvisation) →
  programmatic render from the model (never retyped) → dual gates: content
  (vendored `dom-equality.mjs`, Apache-2.0 attribution, structure
  informational + `slot-coverage.mjs` incl. metadata) and design-adoption
  (`donor-probe.mjs` token assertions; selector-missing = FAIL).
- Both skills were smoke-tested for generalization on fresh sites before
  shipping (replica: hay.dk, desktop converged to 1.06%; reskin:
  ethz.ch × posthog.com, 4883/4883 text bytes, 101/101 slot checks) and
  hardened from the findings: replica gained pointer-park capture hygiene,
  the fixed/sticky-chrome × stitched-capture procedure, per-breakpoint CSS
  lifting, and the full four-patch adaptation set for the diff probes
  (upstreaming them as diff flags is the recorded round-2 candidate);
  reskin gained the document-ordered render stream in the content model
  (`ordered` + tiling verification), root-kind slot classification, a
  shared image-visibility predicate across capture and gate, the
  scope-granularity smell check, and the bounded donor-sampling recipe.
  Smoke evidence: `/Users/paolo/stardust/smoke-{replica,reskin}/SMOKE-REPORT.md`.
- New evals: `replica-source-fidelity/`, `reskin-content-fidelity/`.

### Field-test hardening (5+5 home pages, findings ledger in the 2026-07 field report)

A 10-site field test (replica: fritzhansen, rimowa, carhartt-wip, polestar,
maisonkitsune; reskin: kew×linear PASS, moma×intercom PASS, redcross×vercel)
produced an 18-finding ledger; all skill-wrong findings are folded:

- **Shared live-measurement hardening (F-G, F-R1, rimowa-1; HIGH).** New
  `diff/scripts/live-session.mjs` — the one home for hitting live sites to
  *measure* them, as robust as extract's capture engine: real-Chrome UA
  **plus the standard request headers** (Akamai fingerprints on the absence
  of `Accept`/`Accept-Language`/`sec-ch-ua`, so UA alone still 403s —
  reproduced on redcross.org, fixed to HTTP 200; the same header set
  un-blocked rimowa's gate headlessly), challenge detection that **fails
  loud** (exit 3, never silently measured as the source), headed-stealth
  escalation, and two-class overlay dismissal (consent + timed marketing
  modals, the carhartt `#wps_popup` case — CH-1). Consumed by diff's two
  probes, replica's stitch-shot, and reskin's three live-hitting scripts.
- **diff flags replace replica's 10 hand-edits (F-B).** `--ua`,
  `--wait-until`, `--dismiss`, `--headed`, `--locale` on both probes and
  visual-diff `--main`, backward-compatible for local/deploy use;
  `source-fidelity-gate.md` § Script adaptations rewritten — a hand-edited
  project copy is now a defect.
- **replica:** bounded `--single` entry gets a satisfiable promotion
  contract (`bounded-single` synthesis branch — rimowa-3); `--main body`
  banned with the 103-false-🔴 reproduction (F-C); hit-minimization +
  media-density iteration budget (rimowa-2, CH-2); mobile-@media-first and
  role-parity recreation guidance (CH-3/FH-2); locale pinning for capture
  determinism.
- **reskin:** ordered stream is now `innerText`-consistent by construction
  (F-R2 — kew's a11y ghost labels eliminated at the source; 8/8
  `orderedVerified` vs 5 false in the field) with a sanctioned documented
  fallback; `formControl` stream nodes carry select/option/input text
  verbatim (F-R3 — redcross course form now fully reconstructable, 13/13
  verified); slot-coverage gains a paint assertion so an origin-locked CDN
  can't hide behind a passing URL-string gate (F-R4, kew's 19 unpainted
  images); zero-output scope errors now guide discovery (F-D); first-match
  scope semantics and bounded-donor token sourcing documented (F-R5, F-R6).
- Manifest version aligned (F-A).

## 0.14.5 — crawler clears Cloudflare managed challenges

`extract/scripts/crawl.mjs` — the bot-management fallback now validates the
probe **response**, not just that the navigation resolved. A Cloudflare managed
challenge returns an HTTP 403 interstitial (`cf-mitigated: challenge`) *without
throwing* — `domcontentloaded` fires — so the old fallback (which only fired on
a thrown network-fingerprint error) sailed past it and the block surfaced later
as a fatal capture-time `HTTPError`. Observed on sagora.com during the 0.14.4
uplift validation batch, where it required hand-patching the crawler mid-run.

- **Challenge detection at the probe:** `isChallengeResponse()` flags an
  entry-URL 403/429/503 interstitial (`cf-mitigated`, `cf-ray`,
  `server: cloudflare`/`akamai`/edge markers). Either reject mode — a thrown
  fingerprint block *or* a challenge response — now triggers the headed
  fallback; the reason is recorded in `_crawl-log.json#discovery.botBlock`
  (`fingerprint | challenge`).
- **Stealth-hardened headed Chrome:** the fallback launches real Chrome with
  `--disable-blink-features=AutomationControlled` +
  `ignoreDefaultArgs: ['--enable-automation']` and spoofs
  `navigator.webdriver` via an init script on **every** context (probe +
  workers — the challenge re-fires per context, no cross-context cookie
  sharing). `fetchTechnique` becomes `headed-chrome-stealth`.
- **Challenge-solve window:** `clearChallenge()` waits for the non-interactive
  challenge's JS to set its clearance cookie and reloads before validating
  status — no-op on a normal 200, so zero overhead on the common path. If
  headed + stealth + the solve window still can't clear it, the run fails with
  a clear `BotChallengeError` (interactive solve required) rather than
  capturing the interstitial as content.
- Recipe doc (`extract/reference/playwright-recipe.md` § Bot-management
  fallback) updated with the two-reject-mode retry rule and the managed-
  challenge clearing procedure.

Validated end-to-end: patched crawler on sagora.com auto-detects the challenge,
switches to `headed-chrome-stealth`, and captures the homepage at HTTP 200
(2 headings, ~8.9k chars, 9 images); the common headless path (example.com) is
unchanged (no fallback, no botBlock).

## 0.14.4 — Tessl quality pass, part 1 (descriptions)

Description rewrites for the two skills whose tessl-review drag included
description criteria: `extract` (adds a "Use when…" clause + natural trigger
terms — analyze/reverse-engineer/capture design tokens — and a "Not for"
scraping disambiguation) and `prepare-migration` (plain-language framing of
the prep cascade + trigger phrases + "Not for" migrate/deploy
disambiguation). Body text untouched — zero behavioral surface; the
conciseness/progressive-disclosure restructuring of extract/deploy is a
separate follow-up with its own validation run.

## 0.14.3 — seventh-site validation harvest (stardust.style) + review fixes

Learnings L1–L9 from the final validation run (full pipeline on
stardust.style, hands-off) plus the PR-review findings, folded:

- **crawl.mjs:** trailing-slash forms kept verbatim with slash-insensitive
  dedupe + a guarded 404 slash-retry that records the resolved URL
  (`_crawl-log.json#crawl.slashRetries[]`); `reducedMotion: 'reduce'` on every
  context + an 800ms post-scroll settle (animated h1s were silently dropped);
  visible `<pre>` contents captured as `codeBlocks[]`; collision-safe slug
  assignment (query-variant / flattened-path pages no longer clobber one
  file); sitemap-index recursion (child-sitemap `.xml` locs no longer queued
  as pages); `page.close()` on every exit path via try/finally.
- **Specs:** playwright re-probe rule at the start of every rendering skill
  (`--no-save` installs are pruned by any later `npm i`); token-hygiene gate
  at the FIRST phase commit (master SKILL.md); partial-inventory broken-link
  carve-out reconciled across content-preservation / migration-procedure /
  template-and-module-rendering; cinematic sibling handling specced in
  migrate (assets carried, `cinematic-variant-not-consumed` recorded);
  key-facts-in-server-rendered-content ENCODE rule (#86) with the declaration
  site defined (`DESIGN.json.extensions.metadata.keyFacts[]`); stale
  "closed catalog / 5 weaknesses" references reconciled in the master skill,
  divergence-toolkit, and artifact-map; diff JOIN/SPLIT limitation documented
  (#87, code fix pending).
- **Versions realigned** across plugin.json / tile.json / marketplace.json /
  README / this file (the #230 drift class).

## 0.14.1 — six-site E2E hardening (round 1, folded into extract)

Released as part of the six-site validation cycle; the crawl.mjs items listed
under 0.14.2's last bullet were folded here first. Documented retroactively —
see git history (`4a61c83`) for the full diff.

## 0.14.2 — six-site E2E hardening (round 2)

Fixes folded from validating the pipeline end-to-end on six live sites
(virginatlantic, festool, hirslanden, theroadhome, 3m, sliccy), ranked by
cross-site frequency.

- **migrate no longer dead-ends on missing canon (blocking; 4 of 6 sites).**
  The documented `prototype → migrate → deploy` path never runs
  `prepare-migration`, so migrate arrived with no canon and hard-stopped.
  `migrate` § Setup now auto-bootstraps canon from the first approved
  prototype (the `prototype --prep` write-back, run on demand) when canon is
  absent and an approved prototype exists; it only stops when there is nothing
  to derive canon from. (`skills/migrate/SKILL.md`)
- **bootstrap-authorkit is transactional + refuses the drift-prone default
  (blocking; 2 sites).** Boilerplate removal now runs *after* the mandatory
  edits verify, so a drifted/incompatible source leaves the original runtime
  intact instead of bricking the repo; `author-kit@main` is refused unless
  `--ref <sha>`, `--from-sibling`, or `--allow-unpinned` is given.
  (`skills/deploy/scripts/bootstrap-authorkit.mjs`)
- **atomic delivery contract now asserts computed layout (silent-failure
  guard).** A `.plain.html` pass is not a layout pass — the AuthorKit
  `.<name>.block` scoping bug ships a stacked single-column page green. The
  contract's final gate is now a headless computed-style check (grid blocks
  must compute `display:grid`, blocks decorated, 0 pageerror) once per
  template. (`skills/deploy/SKILL.md`)
- **crawl.mjs, folded in 0.14.1 and confirmed by the runs:** five-field
  `_provenance` emission, apex→www origin adoption, Usercentrics shadow-DOM
  consent, `<video>`/`<iframe>` capture, and the playwright preflight
  (`--no-save --legacy-peer-deps`) + copy-to-project ESM-resolution guidance.

Backlog (single-site or lower-frequency) tracked in the consolidated E2E
learnings digest.

## 0.14.0 — Fable 5 refactor

### Design quality

- **Reference-grounded direction.** `direct` researches real-site references
  via the optional refero MCP (`skills/stardust/reference/reference-research.md`)
  before committing to a direction; the curated seed roll is demoted to the
  fallback when refero is absent.
- **Brand-adjacent refinement tier.** A directed middle ground between
  faithful reproduction and full re-direction, so "polish, don't reinvent"
  is a first-class target rather than an improvised compromise.
- **Opened catalogs.** The uplift/prototype candidate catalogs (what-if
  amplifications, motion registers) are no longer closed lists: the agent may
  extend them with evidence-gated entries justified from the captured brand
  surface.
- **Vision verification gates.** `extract` and `prototype` verify their own
  screenshots/renders with vision checks before a step may pass, catching
  blank captures, broken renders, and layout collapse early.

### New capabilities

- **`stardust:audit`** — new skill: a design + SEO + LLM-visibility audit of
  a site, producing a scored HTML report. Uses the marketing-skills
  `seo-audit` / `ai-seo` methodology when that plugin is installed and
  built-in heuristics otherwise.
- **Cross-site same-brand extraction.** `extract --brand-source` /
  `--design-source` capture brand and design evidence from a sibling property
  of the same brand, with automatic sibling discovery.
- **Hands-off production mode.** `skills/stardust/SKILL.md § Hands-off mode`
  runs the full migration chain without conversational gates, folding the
  previously external master migration prompt into the skills.
- **Run contracts.** A per-run learnings ledger plus a `stardust/status.jsonl`
  run-status contract, so long runs are observable and each run feeds the
  next.

### Fidelity

- **Runtime-contract detection** in deploy/rollout: probe what the target
  runtime actually serves instead of assuming the authored contract survived.
- **Atomic per-page delivery verify** — each page is verified as a unit
  immediately after delivery, not batched at the end.
- **Foundation-first gate** — global foundations (nav, footer, styles,
  indexes) must verify before page fan-out begins.
- **Link audit** across the delivered site.
- **Query-index resilience** — index delivery/verification no longer
  false-fails or silently drops rows on slow propagation.

### Performance

- **Parallelism contracts.** Concurrent agents coordinate through a
  state-machine merge-by-slug contract instead of last-writer-wins on
  `state.json`.
- **Parallel prototype variants** and **crawl concurrency** in `extract`.

### Fixed

- **Version/reference drift.** `plugin.json`, `tile.json`, and the README now
  carry one version, and the impeccable dependency is declared consistently
  as **hard** everywhere (tile.json previously listed it as a soft
  dependency).
