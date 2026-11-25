# Extend pass — more pages of a delivered replica site

A delivered run (`replica handoff end`, every `done-check.mjs` gap closed) takes more pages of the same site, on
the same project and the same delivery site, as one **pass** — `x1`, `x2`, … — that delivers only its new pages:

```
$stardust replica <URL> --extend <url,url,...>    # the pages the owner names
$stardust replica <URL> --extend-next <n>         # the next n pages, in the first pass's selection order
```

A pass runs Phases 1 and 3–5 over its new pages only — never the whole procedure again, never Phase 2. Fewer than
`n` new pages found delivers those; none found ends the pass at once. A bounded pilot (`stardust/direction.md`
records `bounded-single`) has no extend pass: it grows to site scope by re-running Phase 1 with `--prep`, whose
promotion replaces its spec (`preserve-direction.md` § 1a).

## Entry — when a pass opens

The ledger decides before anything is installed, copied or stamped (`../SKILL.md` § Setup, step 0):

| Latest replica line | Without `--extend*` | With `--extend*` |
|---|---|---|
| `handoff end` (no track) or `extend end` (track `x<N>`) | delivered: the state report, then stop — nothing written | open pass `x1` after `handoff end`, `x<N+1>` after `extend end` |
| any other line of track `x<N>` | resume pass `x<N>` (§ Opening, then its roster and units) | resume pass `x<N>` first; a new pass opens only after its `extend end` |
| a first-pass line (no track) before `handoff end` | the first pass resumes (`../SKILL.md` § Procedure) | refuse: the first pass is not delivered |

Opening a pass refuses, before writing anything, unless: `state.json.flow` is `replica`; `direction.md` does not
record `bounded-single`; `<URL>` is on the site of `state.json.site.originUrl` (a `www.` prefix aside — another
site's URL is refused, not crawled); exactly one of `--extend` / `--extend-next`; `--extend-next` a positive integer
(`0` would lift the crawl cap); every `--extend` URL http(s) on that site, without a query string. Then Setup runs:
its copy steps and those of `handoff-contract.md` § 4, plus `../../extract/scripts/` → `stardust/scripts/extract/`,
from the installed plugin (the project's copies can predate this pass's flags).

Every ledger line of the pass — replica, extract, migrate, rollout — carries `--track x<N>`, so its pairs never
close or reopen another pass's.

## Opening — idempotent on the open track

`git status --porcelain -- content/` must be empty (else stop: an uncommitted content edit is the owner's to
settle); the opening commit is the delivered baseline of § 4. The `extend start` line carries the request and that
commit, so a session that ends mid-opening loses neither:

```bash
L="node stardust/scripts/stardust/ledger.mjs"; F="node stardust/scripts/replica/foundation-freeze.mjs"
X=stardust/replica/extend/x1
$L replica extend start --track x1 --detail "extend-next 300 @ $(git rev-parse HEAD)" --strict   # never a value starting with --
mkdir -p $X; echo "--extend-next 300" > $X/request.txt; git rev-parse HEAD > $X/base.txt
SPEC="PRODUCT.md DESIGN.md DESIGN.json stardust/current/PRODUCT.md stardust/current/DESIGN.md stardust/current/DESIGN.json"
for f in $SPEC; do [ -f "$f" ] && mkdir -p "$X/spec/$(dirname "$f")" && cp -p "$f" "$X/spec/$f"; done   # the opening bytes
$F freeze --paths-if-present "$(echo $SPEC | tr ' ' ,)" --out $X/spec-freeze.json   # a missing one is recorded absent
$F freeze --from stardust/rollout/foundation-freeze.json   # the project's own set, re-hashed as delivered by the last C-final
```

Resuming an open pass whose track has no `extract start` yet: re-make each missing piece — `request.txt` and
`base.txt` from the `extend start` detail, the spec copy and both manifests — and never replace one that exists.
Once `extract start` is written, all of them exist; one missing is a `blocked` line, not a re-made baseline.

## 1. The spec is frozen

A pass never writes `stardust/current/PRODUCT.md`, `DESIGN.md`, `DESIGN.json` or the promoted root copies, and
Phase 2's promotion and `direction.md` do not re-run: extract's synthesis over the new pages alone would replace the
gated spec. `$F check --manifest $X/spec-freeze.json` runs after the extract and before `extend end`; on exit 1, copy
each `changed` / `missing` file back from `$X/spec/` and delete each `added` one (a spec file that did not exist —
its existence picks Phase 2's branch), never `git checkout`, then check again until it exits 0. A change a new page
needs is one line in `stardust/rollout/foundation-requests.md` (`handoff-contract.md` § 3, Fan-out discipline). The
register gains entries only for a new page type, appended.

## 2. The roster, then the extract

`replica extract start --track x<N>`. The roster is fixed BEFORE any capture, in `$X/urls.txt`, written only on
success; a resumed pass reads it and never selects again, and one without it selects again from `$X/request.txt`:

```bash
C=stardust/scripts/extract/crawl.mjs; O=<state.json site.originUrl>; K="--skip-captured stardust/state.json --delivered stardust/rollout/coverage/pages.json"
node $C --url $O --pages <url,url,...> $K --select-only > $X/urls.tmp && mv $X/urls.tmp $X/urls.txt                               # --extend
node $C --url $O --max <n> --first-run-order --skip-failed $K --select-only > $X/urls.tmp && mv $X/urls.tmp $X/urls.txt    # --extend-next
```

The crawler's history (`_crawl-log.json` `runs[]`, `../../extract/reference/ia-extraction.md` § `_crawl-log.json`
shape) gives the rest: `--first-run-order` takes the first run's order (link-first only on a recorded user-named
cap), `--skip-failed` leaves out every page a run failed on (a page the owner names is tried). In this mode one
delivery path is one slot — `www.`, `/index.html` and query strings fold — and a page whose path a coverage row
already holds (a page built outside the capture, such as a search page) is never selected; a named one exits 2. An
empty `urls.txt` ends the pass: `extract end`, the spec check, `extend end --detail "0 new pages found by
discovery"` — the report says discovery (sitemap, links) found nothing new, never that the site is complete.

Then `$stardust extract <O> --prep --dynamics --pages <the urls.txt list>`, its crawl run with
`--skip-captured stardust/state.json`: a roster page captured before an interruption is not captured again — a
record under `stardust/current/pages/` counts even before its `state.json` row, and the crawl names such records:
add their rows (extract Phase 6) before going on. A new page never takes a slug an earlier pass holds; a
re-captured delivered page would change its JSON, and `inventory.mjs` would flag it `stale`. The pass runs
extract's Phases 1, 2, 2.5 and 6 and prep's page typing and typed slots (`../../extract/reference/prep-mode.md`
§ 2, § 4) — never Phases 3–5. Module detection matches the new pages against the frozen
`DESIGN.json.extensions.modules[]`; a repeat outside it is a row in the pass's journal section, never a
`DESIGN.json` edit. Capture gaps settle as in a first pass. `$X/slugs.txt` gets the `state.json` slug of each roster
row, one per line — every `--only` list of the pass comes from it. A roster page that still fails after one re-run
is named in the journal and the `extend end` detail (the crawl log keeps it for `--skip-failed`).

## 3. New page types only — Phases 3–4

A new page's type with an archetype in `stardust/replica/progress.json` goes straight to Phase 5 at sibling tier. A
type without one gets Phases 3–4 for that type only (`recreate` / `source-fidelity-gate` lines `--track x<N>`): its
archetype prototype imports the gated shared layers and iterates on its new modules only (`../SKILL.md` § Phase 3,
cumulative prototypes), then its C-archetype unit before its cluster.

## 4. Phase 5 — units of the pass

`replica handoff start --track x<N>`; rollout and migrate run their phases again with the pass's track, and each
script already skips what is delivered. **The publish list** `$X/publish.paths` holds the DA paths of the pass's
own pages (web paths, from the roster), plus the relinked pages the owner approves below. Every `deploy-batch.mjs`
run of the pass — a cluster's, G's re-deploy, an E2 fix — carries `--allow $X/publish.paths`, so the script sends
nothing outside it (a held page is named; a held page listed in `--paths` exits 1). A finding on an older page is
reported, never re-deployed.

- **Migrate:** a new sibling is `extracted`, and `migrate.mjs` renders the sibling branch only for a `directed` page
  with a source file. Per render unit, one unit at a time on the main agent (`state.mjs` and `migrate.mjs` each
  rewrite the whole `state.json` — never two at once): `state.mjs advance <slugs> --to directed --skill replica`
  (the frozen direction); each sibling's slot-filled clone (`handoff-contract.md` § 1 row 2) at
  `stardust/prototypes/<slug>-proposed.html` or `--source <slug>=<file>`; then `migrate.mjs render <slugs>
  --archetype <slug>=<arch>` — never `--all` and never `--force`, which re-render delivered pages. Every new sidecar
  reads `fidelityTier: "sibling"` and names the archetype; one that reads `archetype` stops the unit.
- **Units:** every new unit in both `progress.json` files is named `<unit>-x<N>` (`archetype-<template>-x1`,
  `<cluster>-x1`, `gate-all-x1`); a `done` unit of an earlier pass is never reopened, and a new page of a known
  template joins a new cluster unit. No `foundation` unit: the foundation is delivered and frozen.
- **A, B:** `inventory.mjs` keeps delivered rows and adds the new ones `pending`, so optimize, verify and
  `done-check.mjs` cover them; `blocks.mjs`, then `plan.mjs --pending-only` (a block a delivered page runs is
  `reuse`, never `convert`). **B2:** the new pages' dynamic surface — `dynamic-features.md` gains rows, never loses
  one.
- **Relinked pages — published only on the owner's yes, in every mode.** Every `localize-links.mjs` run of the pass
  runs with `--json` and appends its `perFile` keys to `$X/relinked.paths`: a page this pass delivers can be a link
  target an earlier pass repointed to the source. A delivered page listed there is a candidate only when `git diff
  $(cat $X/base.txt) -- content/<file>` shows href changes alone. Show the owner the exact list and say that a re-PUT
  replaces the DA document, so an edit made in DA since delivery is lost. Approved paths join `publish.paths` and are
  re-driven (`deploy-batch.mjs --paths <them> --force`). The rest — declined, unanswered, hands-off, or with other
  changes — go back to their delivered bytes (`git show $(cat $X/base.txt):content/<file> > content/<file>`), so the
  local tree stays what is published, and are named in `replica extend blocked --track x<N> --detail "republish
  awaits the owner: <n> pages"`. The question is asked at C-final, before unit `gate-all-x<N>`, and again at E2 when
  its run rewrites more. After an approved re-PUT, `gate-all.mjs --only <their slugs>` captures them again (a
  recorded pass hashed the relinked bytes before they were served; a fresh capture replaces it), then unit
  `gate-all-x<N>` again and `update-coverage.mjs --gate` on its summary.
- **C-deliver** (`--track x<N>`; one start/end pair per pass): C-archetype units for the new types, cluster units
  with `gate-all.mjs --only <their slugs>`, then C-final: the pass's queued foundation requests applied once and the
  published gate re-run on every affected archetype, any pass's; the relinked pages, above; unit `gate-all-x<N>` is
  `gate-all.mjs --skip-existing` over every delivered page — the new pages are gated, and an earlier page too when
  an input of its reuse key changed (#793: its content, a block, the frozen reference); the others' verdicts are
  reused, and `summary.json` stays complete for `update-coverage.mjs --gate`.
- **D, D2:** the served sitemap count grows by the pass's pages (`D-site end` names it); every parity row replays.
- **F–I** as in a first pass, except G: `autofix-aem.mjs --slug <s>` once per line of `$X/slugs.txt` (no site-level
  fix: the foundation is frozen), the re-deploy with `--allow`. Then `done-check.mjs --track x<N>` exit 0 — the
  pass's own `I-dashboard end`, never an earlier pass's — `replica handoff end --track x<N>`, `$F check` on the spec
  manifest, `replica extend end --track x<N> --detail "<n> pages delivered (x<N>), <total> live[; republish awaits
  the owner: <n>]"`.
