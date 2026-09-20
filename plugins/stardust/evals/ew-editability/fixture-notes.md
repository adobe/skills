# Fixture provenance & known limitations

`fixture/` is a byte-identical copy of `../ai-readability/fixture/` — the same
fictional regional credit union (a financial-services site) at the moment the
redesign flow reaches deploy: two pages `approved` in `stardust/state.json`,
their proposed prototypes on disk, a vanilla `adobe/aem-boilerplate` checkout
at the workspace root. Read `../ai-readability/fixture-notes.md` for where
every file's shape comes from, the deliberate design choices and what is
left out (eds-schema, runtime-contract, content, demo blocks, fonts,
Playwright). This file only records what is specific to THIS eval. It lives
OUTSIDE the fixture tree on purpose: nothing here is visible to the agent
under test.

Keep the two trees in sync by re-copying, never by editing one side.

## The page this eval converts

`stardust/prototypes/accounts-proposed.html` (the prompt names it). Its
sections map onto the Setup and onto the criteria as follows:

| section (`data-section`) | Setup item | what it exists to catch |
|---|---|---|
| `hero` | eyebrow + `h1` + lede + two CTAs | CTAs are `<p><a class="btn …">` in the prototype; the runtime buttonizes only `<strong>`/`<em>`-wrapped links (`scripts/scripts.js` → `decorateButtons`), so the agent must author marks, move `a.closest('p')` whole, and ship the `.prosemirror-editor` repaint (`cta_paragraph_moves`, `foundation_edit_mode_snippets`) |
| `account-types` | section head as default content above a 3-up card grid of card-links | `.section-head` prose must be reabsorbed by MOVING the default-content wrapper's children; each `<a class="card">` holds `p.rate`, `h3`, `p`, `ul` and a `span.card-cta` label — the label is not a prose element, so authoring it as a `<p>` and unwrapping the anchor in the live DOM is the only editable route (`move_not_rebuild`, `wrapper_descendant_selectors`) |
| `testimonials` | carousel/marquee band with looped slides | 4 `<figure>` slides; `figcaption` mixes `<strong>` + text in one line. The static prototype has no clones — the inventory (`stardust/dynamic-features.md` row 1 pattern) is what says clones are presentational, so `stripInstrumentation()` is exercised (`clones_stripped_interactive_hosts`) |
| `rates-faq` | accordion | 4 `<details>`/`<summary>`; the question must not end up inside a `<button>`/`<summary>` in the block (`clones_stripped_interactive_hosts`) |
| `closing` | — | a plain prose band with one primary CTA; the control case where NO block is the right answer |

The sibling page `home-proposed.html` stays in the tree so a run that converts
`accounts` sees the other approved page it must not break, and so
`styles/styles.css` foundations are written for the site, not one page.

## Deliberate design choices (this eval)

- **Rates, fees and quotes are visible text authored in the prototype**
  (`$0`, `4.10% APY`, "Member since 2023"); a block that derives or formats
  them is a dead text, not a nicety, which is what `exemptions_declared` is
  for.
- **No `.btn` styling exists in the boilerplate** — the prototype's
  `.btn-primary`/`.btn-secondary` are prototype-only classes. The agent has to
  map them onto the runtime's `a.button.primary/.secondary` family, not port
  the class names.
- **`section-head` is reused on three sections** with two shapes (with and
  without a lede), so the reabsorbed section head is a pattern decision, not
  a one-off.

## Known limitations — don't mistake these for skill bugs

- Setup says "Impeccable installed": that is the sibling plugin the runner
  loads into the session, not a fixture file. Nothing in `fixture/` depends
  on it.
- Expected-behavior item 7 ("where a previous version of a block exists, the
  published render is pixel-identical") has NO baseline here — the boilerplate
  ships no `hero`/`cards`/`carousel`/`accordion` blocks. Only the round-trip
  half of `fidelity_not_traded` is checkable; the pixel half cannot fail or
  pass in this fixture.
- `ew-editability-probe.mjs --simulate-editor` and `block-roundtrip.mjs` need
  Playwright and a local server; neither is pre-installed (the runtime
  preflight installs it into `stardust/node_modules`, which needs network). A run without
  network can author blocks and content but cannot produce the probe
  evidence `ew_gate_run_and_green` / `edit_mode_simulation_clean` look for.
- Nothing can be pushed: no DA token, the `fstab.yaml` mount does not
  resolve. The prompt says "ready to push", so the eval scores the pre-push
  steps; a push attempt fails on transport, and that failure is environmental.

`answers.md` (sibling of this file) is the simulated-user persona consumed
by the runner's auto-responder; it is also not part of the fixture tree.
