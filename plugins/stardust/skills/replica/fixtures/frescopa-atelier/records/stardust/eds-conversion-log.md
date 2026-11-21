# EDS conversion log (deploy log)

Project: {{ORG}}/{{SITE}} (branch main) · preview https://{{BRANCH}}--{{SITE}}--{{ORG}}.aem.page/ · live https://{{BRANCH}}--{{SITE}}--{{ORG}}.aem.live/
Source: https://markszulc.github.io/frescopa-atelier/index.html (replica, one page, landing)

## Publish decision (recorded once)

**PUBLISH** — decided by the operator before Phase 5 (hands-off). Every delivered page and the chrome
documents (`/nav`, `/footer`) go PUT → preview → live (`POST https://admin.hlx.page/live/{{ORG}}/{{SITE}}/main/<path>`).

## C0 foundation (2026-11-21T07:40:42Z)

- Runtime contract: `stardust/runtime-contract.json` (vanilla EDS; buttons formatted-only in `p.button-wrapper`;
  strong = terracotta + arrow, em = ghost, strong+em = cream + arrow; empty-section collapse on).
- `styles/styles.css`: prototype tokens verbatim (stylelint normalised oklch notation to % / deg — same values),
  prototype reset, boilerplate structural layer kept (body gate, chrome reservation with `--nav-height: 0` — overlay
  header #108), section scaffold (default content capped at `--content` 1120 + `--gutter`; block wrappers full-bleed,
  blocks cap their own `.container`), shared primitives (.container, .eyebrow, .lede-wrap, .link / .link-wrap, .reveal,
  .sr-only, .skip-link), button system, EW edit-mode repaint.
- Fonts: Schibsted Grotesk + Hanken Grotesk variable woff2 (SIL OFL 1.1 — no licensing alert) self-hosted in `fonts/`,
  `@font-face` in `styles/fonts.css`; metric-matched fallbacks on Liberation Sans / Arimo computed from the woff2
  (glyph-width average vs Liberation Sans). Roboto boilerplate fonts removed.
- Favicon: the captured `stardust/current/assets/favicon.svg` → `/favicon.svg` + one `head.html` link; boilerplate
  `favicon.ico` removed.
- Chrome — tier **template-slotted**: `blocks/header` (brand / nav / tools sections of `/nav`; morph + drawer JS as
  observed), `blocks/footer` (brand / signup / columns / legal sections of `/footer`; columns reconstructive on h3).
  Icons: `icons/*.svg` (prototype vectors, currentColor) inlined by `scripts/inline-icons.js`.
- Site-wide behaviour: `scripts/reveal.js` (operator instruction overrides deploy's "no reveal in scripts" default).
- Stock demo blocks `cards`, `columns`, `hero` removed (unused; the archetype unit authors its own blocks).
- Media: 8 prototype images uploaded to DA `media/frescopa-atelier/` (ledger `stardust/deploy/media-ledger.json`);
  both logo SVGs pure-vector (no `<image>` / base64), 6.9 KB.
- DA documents (content/*.html, exactly as PUT): `/nav`, `/footer` — PUT 201, preview 200, live 200; both carry
  `Robots | noindex`. `.plain.html`: 200, 0 about:error, 2 + 1 pictures with alt, icons as `span.icon`.
- Lint: `npm run lint` clean (eslint + stylelint + breakpoint-lint `--target 561,761,901,981 --dirs blocks,styles,templates`;
  `scripts/aem.js` is vendored and its 600px picture breakpoint is outside the lint by design). `stardust/` added to
  `.eslintignore` (captured source JS must never be lint-fixed — a first `lint:fix` touched it and was reverted).
  `content/` added to `.hlxignore`.

## C-deliver unit archetype-landing (2026-11-21)

- Page `/` (DA `index`, template `landing`, slug `frescopa-atelier-index-html`): `content/index.html` exactly as PUT
  (sanitised; metadata block in its own LAST section — a first-section metadata block leaves an empty first section
  and pushes the hero out of the eager LCP section). PUT 201 → preview 200 → live 200.
- Blocks (9), decode tier: **template-slotted** hero, intro, sustain, cafe, cta; **template-slotted + reconstructive**
  learn (profiles one per heading row), mood (days one per numbered row), feed (cards one per heading row; flat-cell
  fallback segments on the card heading), voices (quotes classified by the opening quotation mark).
- Interactive data is AUTHORED, not baked into JS: radar profiles (label | heading + note | six values) and calendar
  days (number | tag + heading + note; empty second cell = muted day; bold number = initially selected). Inactive
  profile / day panels are `hidden` (EW: editable once selected). Profile/day controls are `div[role=button]`
  hosting the authored label (EW7: no `<button>` hosts authored text); keyboard Enter/Space handled.
  `@ew-exempt` profile values (text-as-metadata) and the weekday initials (block-built).
- Reveal: blocks add `.reveal` synchronously and load `scripts/reveal.js` by dynamic `import()` (static imports break
  the block-roundtrip harness, which inlines block JS); scripts.js `observeReveals()` is the backstop.
- Local asserts: block-roundtrip `--ew` exit 0 (EW editable 88/88, dead 0, duplicated 0; 🟡/🟠 EXTRA = inactive
  profile/day panels whose copy the prototype keeps in JS / data attributes). qa-gate: 42 ok, 1 fail = 3 broken chrome
  logos through the local `aem up` proxy (preview.da.live is auth-gated; delivered page loads them) — harness artefact.
  delivery-lint 0 P0/P1 (1 P2 cross-origin-optimize, reconciled: 6 hosted); davids-model-lint PASS (5 🟡: D1 hero/cta
  are bespoke compositions, D3 differing cell counts = head row + data rows by design); localize-links --check PASS
  (nav targets kept absolute to the source by decision); `npm run lint` clean.
- Delivered `.plain.html`: 200, 1 h1, 6 img / 6 alt, 0 about:error, no `/img/`. ai-readability code 100 % (strict 100 %).
  Computed-style guard: 9 blocks loaded, grids/flex as authored, 0 pageerror, every image clientWidth > 0, title +
  description from the metadata block.
