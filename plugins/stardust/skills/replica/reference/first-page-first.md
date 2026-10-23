# First page first — one page delivered while the site is still being defined

The opening of a full-site replica run (`--first-page <url|home>`; hands-off: the home page). Setup (SKILL.md § Setup,
the flow stamp included) runs once; then two tracks start together, meet once at RECONCILE, and the flow continues as
before with one page already delivered.

## Who writes what

One writer per path at any time; ownership moves only at RECONCILE, while neither track writes. The two run logs are
shared and append-only: `stardust/status.jsonl` (one `ledger.mjs` line per call, each tagged `--track first-page` or
`--track site-scope` — the start guard pairs per track, `last replica --track <t>` reads one track) and
`stardust/journal.md` (each track appends its own `## ` sections, never edits one).

| Path | Before RECONCILE | From RECONCILE on |
|---|---|---|
| `stardust/first-page/**` (capture, breakpoints, dynamics, gate state and tables) | Track A | read-only evidence |
| `stardust/current/**`, `stardust/state.json`, `stardust/dynamic-features*.md`, `stardust/dynamics/`, the spec | Track B | RECONCILE, then the flow |
| root `PRODUCT.md`, `DESIGN.md`, `DESIGN.json`; `stardust/direction.md` | Track A (bounded spec) | RECONCILE, then the flow |
| `stardust/replica/**`, `stardust/prototypes/**`, code, DA | Track A | RECONCILE, then the flow |

## Track A — the first page, to the published origin

The bounded entry, with every path Track B also writes moved under `stardust/first-page/`; on this track, read
`stardust/first-page/current/` wherever a procedure names `stardust/current/`:

- **Capture:** `node stardust/scripts/crawl.mjs --url <url> --max 1 --dynamics --out stardust/first-page/current`
  (extract § Setup's copy; it writes nothing outside `--out` and no `state.json` row), then `cap-probe.mjs <url>
  --write-design stardust/first-page/current/DESIGN.json`. Fonts and media come from Phase 3's asset harvest into
  `stardust/first-page/current/assets/`.
- **Phase 2 is always the bounded branch** (`preserve-direction.md` § 1a), whether or not Track B has written
  `current/PRODUCT.md`. Its triage: `dynamics-detect.mjs --out stardust/first-page/current`, `dynamics-plan.mjs --in
  stardust/first-page/current/_dynamics.json --out stardust/first-page/dynamics`, curated into
  `stardust/first-page/dynamic-features.md`.
- **Phases 3–4** for this page; approval is a ledger line, not a `state.json` write (RECONCILE records it).
- **Phase 5** for this page: `deploy`, then the published-origin gate per width — `gate-all.mjs --state
  stardust/first-page/state.json --out stardust/first-page/gates/all-<w>`, from a one-row state file (`slug`, `url`,
  `status: deployed`, `liveUrl`) Track A writes for it.

Ledger `replica first-page start|end --track first-page` around the track. Track A **owns the code and DA**: styles,
fonts, header/footer, its blocks and documents. Its dynamic features ship their interim tier.

## Track B — the site scope, knowledge only

Phase 1 `--prep` (the roster's caps said out loud), page types, module catalog, dynamics detect + triage, owner
questions; every ledger line `--track site-scope`. It writes only its row above — never code, DA, the root spec or
`direction.md`: the roster caps go in its extract `end` line and reach `direction.md` at RECONCILE. A finding that
needs code waits for RECONCILE.

## RECONCILE — when Track B is done

Starts after Track B's last `end`, once Track A is at a phase boundary past Phase 2 (finished, or between two phases);
Track A writes nothing until it ends. Ledger `replica reconcile-first-page` (no track). In order:

1. **Promote.** Phase 2 re-runs on the full-prep branch: Track B's `current/` spec **replaces** the bounded one
   verbatim, never merged (`preserve-direction.md` § 1a); `direction.md` is rewritten with the verbatim provenance
   and the roster caps; target breakpoints are re-written (§ 4).
2. **Check**, one row per check in `stardust/reconcile-first-page.md`: `confirmed | corrected (<commit>) | deferred
   (<why>)`.
   1. **Page type** — type and archetype role match the catalog.
   2. **Blocks** — each maps to a catalog module; names, variants and content models fit the siblings that will reuse
      it (generalise now as a variant, never fork later).
   3. **Chrome** — the catalog's header/footer variants fit as variants; the nav/footer documents cover them.
   4. **Dynamics** — each row of `stardust/first-page/dynamic-features.md` is in `dynamic-features.md`, built or on
      its interim tier; endpoints match the plan.
   5. **Listings** — the page's metadata fits the listings contract.
   6. **Scope** — no link treats a decided-out or app-routed path as an EDS page.
   7. **Canon** — its base styles, tokens and breakpoints match the promoted spec, or the deltas are applied now.

   A correction changes code and DA documents, never the promoted spec, so a canon delta survives: it is a commit
   made after the promotion it was measured against. A correction to blocks or chrome re-runs the page's
   published-origin gate. Under hands-off, corrections apply without asking and the run summary lists them.
3. **Record.** The page's `state.json` row is the one whose `url` is Track A's (the slugs may differ): `state.mjs
   advance <slug> --to approved --by <who> --prototype stardust/prototypes/<Track A slug>-proposed.html`.

## Then

Phase 3 recreates the remaining types; the first page's blocks and chrome are the foundation (rollout's C0 freezes
them, never rebuilds them). After rollout's inventory, hand the page over through its gate record, never a bare status
write:

1. `update-coverage.mjs --gate stardust/first-page/gates/all-<w>/summary.json --pin`, per width — rows match by path,
   so the inventory's slug need not be Track A's; it writes `delivery.gate`, pins the row, moves it to `deployed` and
   prints the slug.
2. `verify.mjs --slug <slug>` — `verified` only when the page renders and its gate passed.

When a later change to its render inputs (the canon, the spec) makes migrate re-render the page, inventory keeps a
pinned row's delivery instead of flagging it `stale`, so C-deliver never re-delivers it. A later gate verdict still
applies, and `update-coverage.mjs <slug> --status stale` asks for re-delivery.
