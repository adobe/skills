# Fixture provenance & known limitations

`fixture/` is a hand-authored realization of this eval's Setup section: a
fictional regional credit union ("Meridian Coast Credit Union", a
financial-services site) at the moment the redesign flow reaches deploy —
two pages `approved` in `stardust/state.json`, their proposed prototypes on
disk, a vanilla `adobe/aem-boilerplate` checkout at the workspace root. It
lives OUTSIDE the fixture tree on purpose: everything under `fixture/` is
copied verbatim into the eval workspace, and notes like this one must not be
visible to the agent under test.

The same tree is used by `../ew-editability/fixture/` (byte-identical copy).
The two Setups describe different pages; each has its own prototype here:

| Setup | prototype | sections |
|---|---|---|
| ai-readability | `stardust/prototypes/home-proposed.html` | hero carousel (3 slides), 4-up card grid of card-links, calculator band (vendor mount `[data-widget-id="loan-calc"]` showing the default state; `vendor/embed.js` at the fixture root re-renders it at runtime — class `T`, `dynamic-features.md` row 6), locations band (12 branches, index-backed), newsletter band carrying the fragment trio (`data-fragment-source="/fragments/newsletter"`), FAQ accordion (6 collapsed `details`) |
| ew-editability | `stardust/prototypes/accounts-proposed.html` | hero (eyebrow + `h1` + lede + two CTAs), section head as prose above a 3-up card grid of card-links, testimonials marquee (4 looped slides), rates accordion (4), closing prose band |

Both prototypes share chrome, `:root` tokens and CSS conventions, so a run
that converts one page sees the other as the sibling it must not break.

## Where each shape came from

- Project root — `skills/deploy/SKILL.md` § Target runtime: `head.html`,
  `fstab.yaml`, `scripts/aem.js` + `scripts/scripts.js` (load chain
  `loadEager → loadLazy → loadDelayed`, `decorateButtons` in `scripts.js`
  matching `p a[href]` and emitting `a.button.primary/.secondary/.accent`
  inside `p.button-wrapper` for `<strong>`/`<em>`/`<em><strong>` only,
  `wrapTextNodes` in `decorateBlock`, `buildAutoBlocks` with the stock
  `buildHeroBlock`), `styles/styles.css` (demo layer + the structural layer
  the skill says to preserve: body gate, `--nav-height` reservation,
  `main > .section` scaffold), `styles/fonts.css`, `styles/lazy-styles.css`,
  `blocks/header`, `blocks/footer`, `blocks/fragment`, root `.gitignore`
  with the `# >>> stardust` managed block, lint config + `package.json`.
- `stardust/state.json` — `skills/stardust/reference/state-machine.md`
  (key order, `flow: redesign` so deploy's flow guard does not stop on the
  "to EDS" phrase, both pages `approved` with full history).
- `stardust/.gitignore` — byte copy of
  `skills/stardust/reference/stardust.gitignore` (master Setup step 6).
- `stardust/direction.md` — the file `state.json.direction.directionFile`
  points at; a short Mode-A brand-faithful direction so the pointer is not
  dangling. deploy does not read it.
- `stardust/dynamic-features.md` — `skills/dynamics/reference/triage.md`
  § file format. Row 2 marks the locations band `index-backed` over
  `/query-index.json`; row 3 records the newsletter as a fragment awaiting a
  backend decision.
- `vendor/embed.js` — the third-party calculator stand-in (`deploy/reference/
  ai-readability.md` § 3 Vendor widgets). It replaces the mount's content with
  its own markup carrying the same ~60 words plus a vendor footer line, so a
  block that keeps the authored default state in the DOM double-counts and a
  block that removes it on render counts once — the `excluded_block_decided`
  criterion is measurable either way. The prototype itself stays script-free;
  `data-vendor-src` on the mount names what the block loads.
- `helix-query.yaml` — `skills/dynamics/reference/listings.md`: a
  `locations` index scoped to `/locations/**`, targeting `/query-index.json`.
- `query-index.json` — 12 rows shaped like the published index (`path`,
  `title`, `image`, `description`, `address`, `city`, `hours`, `lat`, `lng`,
  `lastModified`). In a real project this file is pipeline-generated and is
  NOT a repo file; here it sits at the workspace root so any static server
  or `aem up` serves it at `/query-index.json`, as the Setup requires. The
  12 branch names, addresses and hours match the prototype's locations band
  exactly, so "the document, not the block, carries the 12 names" is checkable.
- Prototypes — `skills/prototype/reference/proposed-file-shell.md`
  (provenance comment first in `<head>`, `:root` token block first in
  `<style>` per `token-contract.md`, `data-section/-intent/-layout` on every
  section per `data-attributes.md`, self-contained, no JS). Section class
  names equal `data-section` values so `block-roundtrip`'s default
  `section.<name>` / `[data-section="<name>"]` lookup resolves without
  `--map`.

## Deliberate design choices

- **Images are inline SVG data URIs** so the prototypes render offline and
  `section-schema` counts them as media. They carry descriptive `alt`; the
  agent is expected to treat them as `<image-slot>`-class placeholders when
  authoring (empty image cells or DA-hosted uploads), never to ship data URIs.
- **The carousel is a scroll-snap track** in the static prototype (no JS).
  The "looped slides" of the Setup is a delivery decision: the inventory
  records the source ran a loop carousel with text-carrying clones, which is
  what criteria `clones_presentational` / `clones_stripped_interactive_hosts`
  test.
- **Slide 1 carries the page `<h1>`, slides 2–3 carry `<h2>`** (one `<h1>`
  per page). The accounts hero owns that page's `<h1>`.
- **Card-as-link grids** (`<a class="card">` wrapping heading + copy + a
  label) on both pages, 4-up on home and 3-up on accounts, so a
  reuse-with-variant decision (`cards` + variant class) has a real reason.
- **Visible UI strings are all authored in the prototype** ("Learn more",
  "View details", "View all branches", "Sign me up") so a block that generates
  them instead is a measurable defect, not a judgment call.
- **`currentStatePath` is `null`** and `stardust/current/` is omitted: deploy
  never reads the capture, and shipping five captured-page JSONs would triple
  the fixture for no signal. A state report that expects the capture will note
  the gap; that is a known fixture limitation, not a skill defect.

## What is NOT in the fixture (and why)

- `stardust/eds-schema/` — produced by deploy Step 2b (`section-schema.mjs`);
  pre-generating it would do the agent's work.
- `stardust/runtime-contract.json` — the Setup does not say the probe ran;
  writing it is the skill's first step.
- `content/` — every content page, `/nav`, `/footer` and the fragment are
  deploy output.
- Stock demo blocks `hero`/`cards`/`columns` — omitted so no demo CSS
  collides with the agent's blocks; the task names header/footer/fragment as
  the minimal runtime set. `scripts.js` still ships the stock
  `buildHeroBlock` auto-block, which the agent must notice (a page whose first
  `<picture>` precedes its `<h1>` gets auto-blocked).
- `fonts/*.woff2` — `fonts.css` references the stock Roboto files, which are
  not shipped (binary); fallback faces render. A harness 404 on them is expected.
- Playwright, `node_modules/` — the Setup says "Node + Playwright available";
  the runner workspace has neither installed. The runtime preflight
  (`preflight-runtime.mjs` → `stardust/node_modules`) installs it, which needs network.

## Known limitations — don't mistake these for skill bugs

- `ai-readability.mjs` has URL mode only (`--origin`). The "harness mode"
  the Setup names is a local server serving the built harness page (the
  skill's Local-QA `build-harness.mjs` + `aem up` or any static server) plus
  `/query-index.json`; the served side is then the authored `<main>`, the
  rendered side the decorated DOM. Expected-behavior item 5 is satisfiable
  offline this way; the "published page" wording in the skill's checklist is not.
- Nothing here can be pushed: no DA token, no `content.da.live` mount that
  resolves, no code branch on GitHub. The user prompt says "ready to push",
  so the eval scores the pre-push steps; a run that attempts the push will
  fail on transport, and that failure is environmental.
- Fictional hostnames use the `.example` TLD; `fstab.yaml` points at a
  `content.da.live` path that does not exist. `aem up` will proxy-fail for
  paths it does not find locally — only local files (harness, code,
  `query-index.json`) are servable.
- Rates, addresses, routing number and every quote are invented for a
  fictional institution.

`answers.md` (sibling of this file) is the simulated-user persona consumed
by the runner's auto-responder; it is also not part of the fixture tree.
