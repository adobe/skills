# First page first — one page delivered while the site is still being defined

The opening of a full-site replica run (`--first-page <url|home>`; hands-off: home). Setup (flow stamp included) runs
once; then two tracks run together, meet once at RECONCILE, and the flow continues with one page already delivered.

## Who writes what

One writer per path; ownership moves only at RECONCILE, while neither track writes. Shared and append-only:
`stardust/status.jsonl` (every `ledger.mjs` line tagged `--track first-page` or `--track site-scope`) and
`stardust/journal.md` (each track appends its own `## ` sections, never edits one).

| Path | Before RECONCILE | From RECONCILE on |
|---|---|---|
| `stardust/first-page/**` (capture, breakpoints, dynamics, gate state and tables) | Track A | read-only evidence |
| `stardust/current/**` (the captured design spec included), `stardust/state.json`, `stardust/dynamic-features*.md`, `stardust/dynamics/` | Track B | RECONCILE, then the flow |
| root `PRODUCT.md`, `DESIGN.md`, `DESIGN.json`; `stardust/direction.md` | Track A (bounded design spec) | RECONCILE, then the flow |
| `stardust/replica/**`, `stardust/prototypes/**`, code, DA | Track A | RECONCILE, then the flow |

## Track A — the first page, to the published origin

The bounded entry, with every path Track B also writes moved under `stardust/first-page/`: read
`stardust/first-page/current/` wherever a procedure names `stardust/current/`.

- **Capture:** `node stardust/scripts/crawl.mjs --url <url> --max 1 --dynamics --out stardust/first-page/current`
  (extract § Setup's copy), then `cap-probe.mjs <url> --write-design stardust/first-page/current/DESIGN.json`.
  Phase 3's asset harvest puts fonts and media in `stardust/first-page/current/assets/`.
- **Phase 2 is always the bounded branch** (`preserve-direction.md` § 1a), even once Track B has written
  `current/PRODUCT.md`. Triage: `dynamics-detect.mjs --out stardust/first-page/current`, `dynamics-plan.mjs --in
  stardust/first-page/current/_dynamics.json --out stardust/first-page/dynamics`, curated into
  `stardust/first-page/dynamic-features.md`.
- **Phases 3–4** for this page; approval is a ledger line, not a `state.json` write (RECONCILE records it).
- **Phase 5:** `deploy`, then per width `gate-all.mjs --state stardust/first-page/state.json --out
  stardust/first-page/gates/all-<w>`, from a one-row state file (`slug`, `url`, `status: deployed`, `liveUrl`) Track A
  writes.

Ledger `replica first-page start|end --track first-page`. Its dynamic features ship their interim tier.

## Track B — the site scope, knowledge only

Phase 1 `--prep`, page types, module catalog, dynamics detect + triage, owner questions; ledger lines `--track
site-scope`. The roster caps go in its extract `end` line; a finding that needs code waits for RECONCILE.

## RECONCILE — when Track B is done

Starts after Track B's last `end`, once Track A is at a phase boundary past Phase 2; Track A writes nothing until it
ends. Ledger `replica reconcile-first-page` (no track). In order:

1. **Promote.** Phase 2 re-runs on the full-prep branch (`preserve-direction.md` § 1a): Track B's design spec
   (`current/PRODUCT.md`, `DESIGN.*`) replaces the bounded one verbatim; `direction.md` (with the roster caps) and the
   target breakpoints (§ 4) are rewritten.
2. **Check**, one row each in `stardust/reconcile-first-page.md`: `confirmed | corrected (<commit>) | deferred (<why>)`.
   1. **Page type** — type and archetype role match the catalog.
   2. **Blocks** — each maps to a catalog module; names, variants and content models fit the reusing siblings
      (generalise now as a variant, never fork later).
   3. **Chrome** — the catalog's header/footer variants fit; the nav/footer documents cover them.
   4. **Dynamics** — every row of `stardust/first-page/dynamic-features.md` is in `dynamic-features.md` (built or
      interim tier), endpoints as planned.
   5. **Listings** — the page's metadata fits the listings contract.
   6. **Scope** — no link treats a decided-out or app-routed path as an EDS page.
   7. **Canon** — base styles, tokens and breakpoints match the promoted design spec, or the deltas are applied now.

   Corrections are code and DA-document commits, never design-spec edits, so a canon delta survives the promotion; a
   block or chrome correction re-runs the published-origin gate. Hands-off: they apply without asking and the run
   summary lists them.
3. **Record.** On the `state.json` row whose `url` is Track A's (the slugs may differ): `state.mjs advance <slug> --to
   approved --by <who> --prototype stardust/prototypes/<Track A slug>-proposed.html`.

## Then

Phase 3 recreates the remaining types on the first page's blocks and chrome (rollout's C0 freezes, never rebuilds
them). After rollout's inventory, hand the page over through its gate record, never a bare status write:

1. `update-coverage.mjs --gate stardust/first-page/gates/all-<w>/summary.json --pin`, per width (prints the slug).
2. `verify.mjs --slug <slug>`.

The pinned row keeps its delivery when migrate re-renders the page; `update-coverage.mjs <slug> --status stale`
re-delivers it.
