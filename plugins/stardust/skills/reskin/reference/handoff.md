# Reskin handoff — reskin → migrate / rollout

How a reskin archetype becomes the gated input of the existing pipeline. Reskin
adds no transport and no new state machine: it produces a gated archetype per
page type, a donor-sourced canon, and a ledger; `migrate`, `deploy` and
`rollout` run unchanged on top of them.

## The sequence

1. Phase 4 renders with `stream-render.mjs <slug> --register --type <type>`
   (state's `prototypePath`, and the page `type` — the archetype name its
   pages share; untyped pages fail preflight's `archetypes` and never
   migrate at the sibling tier), Phase 5 gates per page → `reskin-ledger.mjs record <slug>`
   (+ `eyeball`, `residual` for the two human judgments).
2. Approve the archetype (§ Approval) → `reskin-ledger.mjs record <archetype>`
   again, so `handoff.<type>` names it.
3. `canon-from-reskin.mjs <archetype>` — canon, donor-sourced `DESIGN.*`,
   `direction.md`, `dynamic-features.md` — and, per type with an approved
   archetype, its `extracted` pages advanced to `directed` (the status `migrate`
   renders at the sibling tier; `direct` refuses under reskin). It names the
   siblings it left: stale ones, and `prototyped` ones (`migrate render --all`
   skips them). Re-run it after approving another type's archetype.
4. Render each sibling: `stream-render.mjs <slug> --register --type <type>`
   (the archetype's type; it stays `directed`, with the `prototypePath` migrate reads as its source).
5. `reskin-preflight.mjs` exit 0 (§ The predicate).
6. `migrate render --all` with its default flags — archetypes at their own tier,
   same-type pages at the sibling tier; migrate merges `handoff.<type>.gates`
   into each first sidecar's `gatesPassed` / `gateEvidence`. Localized images
   (`stream-render --localize-images`: `src="assets/img/…"`, files in
   `stardust/prototypes/assets/img/` and mirrored beside the page) bundle from
   the default `--proto-dir`; no `--proto-dir` / `--current` override.
7. Sibling gate per migrated page (§ Sibling gate) →
   `reskin-ledger.mjs record <slug> --stage migrated`.
8. `deploy` / `rollout`, unchanged; `rollout` over the whole migrated site
   (§ Full inventory) re-checks the predicate.

## The predicate (`flow: reskin`)

`reskin-preflight.mjs` exit 0 is the reskin equivalent of replica's
"gated archetype per page type" (`stardust/replica/progress.json`). Per type,
the archetype (`ledger.handoff.<type>.archetype`, else the type's first
`approved`/`migrated` page) must have:

| condition | ledger field |
|---|---|
| every gate PASS, or a residual on that gate with verdict `accepted` | `pages[a].gates`, `pages[a].residuals[]` |
| no residual `needs-owner` or `blocked` | `pages[a].residuals[]` |
| the side-by-side eyeball recorded and `pass` | `pages[a].eyeball` |
| the prototype on disk is the one that was gated | `pages[a].prototypeSha` vs the file |
| Figma donors: `figma.join`, `figma.geometry`, `figma.ramp` PASS (M2b B0/B1/B3; B2 pixel is advisory, B4 register informational) | `pages[a].gates.figma` |
| when a preview deploy was gated (M2a): `deployed.content`, `.tokens`, `.parity`, `.sanity`, `.inherited` PASS, and the Figma re-run `deployed.figma.*` | `pages[a].gates.deployed` |
| the preview evidence still describes the EDS code: its `codeStamp` equals the project's now (`deployed-gate stamp`); a block, CSS or script change after the run fails it until `deployed-gate all` and `record` re-run | `pages[a].gates.deployed.codeStamp` |

`reskin-ledger.mjs record <a>` reads the M2 evidence itself:
`<dir>/.work/reskin/gates/<a>/figma/summary.json` (`figma-gate all`, regime
`local`) and `…/deployed/summary.json` (`deployed-gate all`, regime `preview`).
Their `ledgerFragment` lands in `gates.figma` / `gates.deployed`; a fragment
already in the ledger is kept when no fresh evidence exists. Fragment values
`PASS…`, `ADVISORY…` and `n/a:…` pass; `FAIL k/n` fails; `not run:…`/`CRASH:…`
are NOT-RUN and block. A Figma donor (`reskin/curation-rules.json`) whose
project has `scripts/reskin/figma-gate.mjs` but no figma fragment records
`figma.*` NOT-RUN. A residual names its family by `gate` or `class` (M2b's
residuals carry `class: figma.join|geometry|ramp`); one on `figma.<f>` also
covers `deployed.figma.<f>`. Hand-written string gate values (`"PASS"`) are read
like fragment values;
a `deployed.sanity` residual can never be `accepted` (M2a D7) — `reskin-ledger
residual` refuses it.

Plus the project-level checks (flow, canon `:root`, donor `DESIGN.json`, canon
record drift, active direction, dynamics dispositions, canon skeleton per
mapped module, approval honesty). A failing predicate blocks the type in
`migrate` (sibling tier) and `rollout`; hands-off is not a bypass.

Coverage of the deployed leg is a warning, not yet a condition: per type,
`deployed-coverage` warns when fewer than max(2, ⌈10 %⌉) of its `migrated`
pages (all of them when it has fewer than 2) carry preview evidence in the
ledger (`pages.<slug>.gates.deployed`, regime `preview`) — one gated
archetype does not show the blocks hold across the type. It names the count
and the pages to run the leg on (`deployed-leg.md`, then `reskin-ledger.mjs
record <slug>`).

## Approval (D3)

`approved` means a human accepted the archetype. `state.mjs advance <slug>
--to approved --by user --skill reskin` is the normal path (`--history-only`
when the page is already past `approved`). An agent may approve only when the run
is hands-off — `state.json` `handsOff: true` — and records `--by hands-off`,
after Phase 5 shows every gate PASS or accepted and the eyeball recorded.
Preflight fails `approval` on `approvedBy` `hands-off` / `autopilot` /
`agent` / `auto` without `handsOff: true`, and on any agent label other than
`hands-off` even with it. An "auto mode" request from the user is the
hands-off opt-in; record it as `handsOff: true` before approving.

## Tier record (D4)

A reskin archetype does not pass the prototype skill's gate stack — it never
runs `prototype`. `handoff.<type>.tier` states what it did pass and what is
waived, so `approved` is never read as "the full prototype stack passed":

| gate | reskin archetype |
|---|---|
| content fidelity (`dom-equality`) | **run** — `reskin-dom-equality` |
| slot coverage | **run** — `reskin-slot-coverage` |
| design adoption (`donor-probe`, incl. 1440/360 overflow) | **run** — `reskin-donor-probe` |
| mobile-adapt static (viewport, a `max-width` or range `(width <= …)` / `(width < …)` rule ≤640px) | **run** — `mobile-adapt-static` |
| mobile-adapt runtime (`mobile-nav-audit.mjs`, 360px) | **run** — `mobile-adapt-runtime` (NOT-RUN without Playwright → blocks unless accepted) |
| side-by-side donor eyeball | **run** — human / hands-off judgment, `eyeball` |
| critique, audit, anti-template, content-sourcing, motion-validation | **waived** — they judge a design authored from intent; the design here is the donor's and the content is byte-gated |

`tier.claimed` is `reskin-archetype`; `tier.passed[]` lists the gates that
were PASS at record time; `tier.waived[]` the list above.

## Full inventory (Q6)

The inventory is the full uncapped crawl of Phase 1's `extract --all`: every
junk-filtered page of the content site in `state.json`, each typed by reskin
(SKILL.md § Phase 1). Never extract's capped discovery mode, never only the
pages the user named; `--pages` narrows the archetype capture, not the
inventory, and a capped crawl is a setup error (SKILL.md § Setup step 5).

Reskin does not run `extract --prep --dynamics`: `dynamic-features.md` is
derived by the bridge from the content models — **form controls only**. That
is enough for the pages reskin gates; it is not the site's dynamic surface.
Before `rollout` fans out beyond the gated archetypes, run the `dynamics`
skill (Phases 1–3) on the project so scripts, embeds, search and listings get
dispositions; the bridge's file says the same in its header.

Full-site handoff is the default: every inventory page is migrated (at the
sibling tier against its type's archetype, or as an archetype of its own) and
shipped. Archetypes-only delivery (`rollout` archetypes-only mode, the rest
`content-pending`) happens only when the user asks for it, recorded as
`ledger.json#delivery = { scope: "archetypes-only", requestedBy: "user",
reason, at }` (default `scope: "full-site"`) and named in the handoff report.

## Archetype set

One approved archetype per page type, chosen by the user (or by hands-off on
the most representative captured page of the type). The first page of a type
recorded while `approved` becomes `handoff.<type>.archetype` and stays it;
later approved pages of the type only add their gates. A type with no
approved page fails `archetypes` in preflight and renders nothing at the
sibling tier.

## Sibling gate

The archetype gate proves the prototype; migrate re-renders siblings from the
canon, so each migrated page is gated again on migrate's output — the same
three gates against the source URL, reports in
`stardust/reskin/gates/<slug>/migrated/{dom-equality,slot-coverage,donor-probe}.md`
— and recorded with `reskin-ledger.mjs record <slug> --stage migrated`
(`pages[slug].migratedStatus`, `handoff.<type>.siblings`). Preflight warns
(`sibling-gates`) on migrated pages without a passing one; rollout does not
publish them.

When `state.json` `site.deployUrl` is set, `migrate` rewrites the page's
`canonical` and `og:url` to the deploy host, so the source's values no longer
match by design: the content gates read a delta file that ignores exactly
those two (`reference/deployed-leg.md` § The delta file), or slot-coverage
fails a healthy page on metadata. Without a deploy host, leave `--deltas` out.

```bash
# stardust/reskin/deltas/<slug>.migrated.json
# { "version": 1, "metadata": { "ignore": ["canonical", "og:url"] } }
node stardust/scripts/reskin/dom-equality.mjs \
  --source <page-url> --source-scope '<declared scope>' \
  --normalize stardust/reskin/normalize/<slug>.mjs \
  --rendered stardust/migrated/<outputPath> --rendered-scope main \
  --deltas stardust/reskin/deltas/<slug>.migrated.json \
  --report stardust/reskin/gates/<slug>/migrated/dom-equality.md
node stardust/scripts/reskin/slot-coverage.mjs \
  --model stardust/reskin/content-model/<slug>/content-model.json \
  --rendered stardust/migrated/<outputPath> \
  --deltas stardust/reskin/deltas/<slug>.migrated.json \
  --report stardust/reskin/gates/<slug>/migrated/slot-coverage.md
node stardust/scripts/reskin/donor-probe.mjs \
  --tokens stardust/reskin/donor-tokens.json \
  --rendered stardust/migrated/<outputPath> \
  --model stardust/reskin/content-model/<slug>/content-model.json \
  --report stardust/reskin/gates/<slug>/migrated/donor-probe.md
node stardust/scripts/reskin/reskin-ledger.mjs record <slug> --stage migrated
```

`<outputPath>` is the page's path under `stardust/migrated/` (its sidecar,
`_meta.json` or `<name>._meta.json`, sits beside it). Keep the file to those two keys: any other
difference on migrate's output is a finding, not a delta.

## Switching away

`$stardust <flow> --switch-flow` from `reskin` marks `prototyped`,
`migrated` **and** reskin-registered `approved` pages stale
(`staleReason: "flow-switch"`): the canon they were approved against is
the donor's, and the new flow will replace it.
