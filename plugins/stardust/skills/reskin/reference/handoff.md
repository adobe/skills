# Reskin handoff — reskin → migrate / rollout

How a reskin archetype becomes the gated input of the existing pipeline. Reskin
adds no transport and no new state machine: it produces a gated archetype per
page type, a donor-sourced canon, and a ledger; `migrate`, `deploy` and
`rollout` run unchanged on top of them.

## The sequence

1. Phase 5 gates per page → `reskin-ledger.mjs record <slug>` (+ `eyeball`,
   `residual` for the two human judgments).
2. Approve the archetype (§ Approval) → `reskin-ledger.mjs record <archetype>`
   again, so `handoff.<type>` names it.
3. `canon-from-reskin.mjs <archetype>` — canon, donor-sourced `DESIGN.*`,
   `direction.md`, `dynamic-features.md`.
4. `reskin-preflight.mjs` exit 0 (§ The predicate).
5. `migrate render` — archetypes at their own tier, same-type pages at the
   sibling tier; migrate merges `handoff.<type>.gates` into each first
   sidecar's `gatesPassed` / `gateEvidence`.
6. Sibling gate per migrated page (§ Sibling gate) →
   `reskin-ledger.mjs record <slug> --stage migrated`.
7. `deploy` / `rollout`, unchanged; rollout re-checks the predicate.

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

`reskin-ledger.mjs record <a>` reads the M2 evidence itself:
`<dir>/.work/reskin/gates/<a>/figma/summary.json` (`figma-gate all`, regime
`local`) and `…/deployed/summary.json` (`deployed-gate all`, regime `preview`).
Their `ledgerFragment` lands in `gates.figma` / `gates.deployed`; a fragment
already in the ledger is kept when no fresh evidence exists. Fragment values
`PASS…`, `ADVISORY…` and `n/a:…` pass; `FAIL k/n` fails; `not run:…`/`CRASH:…`
are NOT-RUN and block. A Figma donor (`reskin/curation-rules.json`) whose
project has `scripts/reskin/figma-gate.mjs` but no figma fragment records
`figma.*` NOT-RUN. A residual on `figma.<f>` also covers `deployed.figma.<f>`;
a `deployed.sanity` residual can never be `accepted` (M2a D7) — `reskin-ledger
residual` refuses it.

Plus the project-level checks (flow, canon `:root`, donor `DESIGN.json`, canon
record drift, active direction, dynamics dispositions, canon skeleton per
mapped module, approval honesty). A failing predicate blocks the type in
`migrate` (sibling tier) and `rollout`; hands-off is not a bypass.

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
| mobile-adapt static (viewport, a `max-width` rule ≤640px) | **run** — `mobile-adapt-static` |
| mobile-adapt runtime (`mobile-nav-audit.mjs`, 360px) | **run** — `mobile-adapt-runtime` (NOT-RUN without Playwright → blocks unless accepted) |
| side-by-side donor eyeball | **run** — human / hands-off judgment, `eyeball` |
| critique, audit, anti-template, content-sourcing, motion-validation | **waived** — they judge a design authored from intent; the design here is the donor's and the content is byte-gated |

`tier.claimed` is `reskin-archetype`; `tier.passed[]` lists the gates that
were PASS at record time; `tier.waived[]` the list above.

## Bounded inventory (Q6)

Reskin does not run `extract --prep --dynamics` over the whole site. The
inventory is the roster in `state.json` (the pages the user named or the
capture listed), and `dynamic-features.md` is derived by the bridge from the
content models — **form controls only**. That is enough for the pages reskin
gates; it is not a site inventory. Before `rollout` fans out beyond the
roster, run the `dynamics` skill (Phases 1–3) on the project so scripts,
embeds, search and listings get dispositions; the bridge's file says the same
in its header.

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

## Switching away

`$stardust <flow> --switch-flow` from `reskin` marks `prototyped`,
`migrated` **and** reskin-registered `approved` pages stale
(`staleReason: "flow-switch"`): the canon they were approved against is
the donor's, and the new flow will replace it.
