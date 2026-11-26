# Extend pass — more pages of a delivered replica site

A delivered run (`replica handoff end`, every `done-check.mjs` gap closed) takes more pages of the same site, on
the same project and the same delivery site, as one **pass** — `x1`, `x2`, … — that delivers only its new pages:

```
$stardust replica <URL> --extend <url,url,...>    # the pages the owner names
$stardust replica <URL> --extend-next <n>         # the next n pages, in the first pass's selection order
```

A pass runs Phases 1 and 3–5 over its new pages only — never the whole procedure again, never Phase 2. Fewer than
`n` new pages found delivers those; none found ends the pass at once. A bounded pilot has no extend pass: it grows
to site scope by re-running Phase 1 with `--prep`, whose promotion replaces its spec (`preserve-direction.md`
§ 1a). A pilot is a project whose `stardust/direction.md` holds a spec line that starts `Synthesized
(bounded-single):`. A spec line that starts `Promoted:` is a full run, whatever else it mentions: after first page
first that line names the bounded spec it replaced.

## For a caller — a person, or a system that runs the skill unattended

For a pass, the command line is the whole request. `--hands-off` is the master skill's (`../../stardust/SKILL.md`
§ Hands-off mode): with it a pass asks no question, and records each decision.

| Call | When | Result |
|---|---|---|
| `$stardust replica <URL> --extend-next <n>` | the run is delivered | a new pass for the next `n` pages |
| `$stardust replica <URL> --extend <url,...>` | the run is delivered | a new pass for the named pages |
| `$stardust replica <URL>` | a session ended early, or a blocker was cleared | resumes the open pass, or the state report when none is open |

- **A restart is the same command, sent again.** With or without the extend flags, an open pass is resumed first.
  It selects and captures nothing twice, and opens no second pass.
- **`--extend-next <n>` counts pages to add,** not a total. For a target of 10 pages on a site with 3 delivered,
  send 7.
- **The state is one line:** `node stardust/scripts/stardust/ledger.mjs last replica`.

  | The line | Meaning |
  |---|---|
  | a line before the first `handoff end` with no `track` | the first run is not finished: send the plain command; `--extend*` is refused |
  | `handoff end`, no `track` | delivered, no pass yet |
  | any line with `track: x<N>` other than `extend end` | pass `x<N>` is open |
  | `event: blocked` with `track: x<N>` | pass `x<N>` is open and waits: `detail` says for what, `next` what to do |
  | `extend end` with `track: x<N>` | pass `x<N>` is closed: `detail` gives the count delivered, or `rejected:`, or `0 new pages found by discovery` |

- **Only a full first run can be extended.** A page list on the first run (`--pages <a,b>`, or `--single`) is read
  as the bounded entry: it makes a pilot, and a pilot is refused. No flag of the replica command starts a full run
  on a page list. To start with a few pages and add more later, the request must say it in words: Phase 1 runs
  `$stardust extract <URL> --prep --dynamics --pages <a,b>`, and pages outside the list are out of scope.
- **Only `track: x<N>` is a pass.** A hands-off first run writes lines with `track: first-page` and
  `track: site-scope` (`first-page-first.md`). They belong to the first run. Its `handoff end --track first-page` is
  one page delivered early, not the run delivered.
- **A refused request writes nothing,** not a ledger line: the state stays `handoff end` or `extend end`, and the
  reason is in the answer. § Entry lists the refusals.
- **Before a pass,** the checkout holds `stardust/migrated/` as the earlier passes committed it. `inventory.mjs`
  drops the coverage row of a delivered page whose migrated file is missing.
- **A blocked pass ends only by delivering.** Clear what `detail` names, then send the command again. Every
  `blocked` line of a pass carries `--next "<what to do, then the command to send>"`: a caller reads it, not the
  answer.

## Entry — when a pass opens

The ledger decides before replica installs, copies or stamps anything (`../SKILL.md` § Setup, step 0). The master
skill's Setup has run by then: it refreshes `stardust/scripts/`, and writes nothing else of the project.

| Latest replica line | Without `--extend*` | With `--extend*` |
|---|---|---|
| `handoff end` with NO track, or `extend end` (track `x<N>`) | delivered: the state report, then stop — no state, spec, content or ledger line written | open pass `x1` after `handoff end`, `x<N+1>` after `extend end` |
| any other line of track `x<N>`, `handoff end --track x<N>` included | resume pass `x<N>` (§ Opening, then its roster and units) | resume pass `x<N>` first; a new pass opens only after its `extend end` |
| a first-pass line (no track) before `handoff end` | the first pass resumes (`../SKILL.md` § Procedure) | refuse: the first pass is not delivered |

Opening a pass refuses, before writing anything, unless: `state.json.flow` is `replica`; the spec line of
`direction.md` starts `Promoted:` (not a pilot, above); `<URL>` is on the site of `state.json.site.originUrl` (a
`www.` prefix aside — another
site's URL is refused, not crawled); exactly one of `--extend` / `--extend-next`; `--extend-next` a positive integer
(`0` would lift the crawl cap); every `--extend` URL http(s) on that site, without a query string. Then Setup runs:
its copy steps and those of `handoff-contract.md` § 4, plus `../../extract/scripts/` → `stardust/scripts/extract/`,
from the installed plugin (the project's copies can predate this pass's flags). Leave each skill's `test/` directory
out of the copy. With `--extend`, the named roster of
§ 2 is then checked once, `--out stardust/.work/extend-preflight.txt`, before `extend start`: its exit 2 — a named
page with a query string, or whose destination is delivered or an existing content document — refuses the pass with
that message, and nothing is opened.

Every ledger line of the pass — replica, extract, migrate, rollout — carries `--track x<N>`, so its pairs never
close or reopen another pass's.

## Opening — idempotent on the open track

`git status --porcelain -- content/` must be empty (else stop: an uncommitted content edit is the owner's to
settle). The `extend start` line carries the request and the opening commit, so a session that ends mid-opening
loses neither. Everything the pass keeps under `$X` is committed with the checkpoints. A clone of the last
checkpoint resumes it.

```bash
L="node stardust/scripts/stardust/ledger.mjs"; F="node stardust/scripts/replica/foundation-freeze.mjs"
X=stardust/replica/extend/x1
$L replica extend start --track x1 --detail "extend-next 300 @ $(git rev-parse HEAD)" --strict   # never a value starting with --
mkdir -p $X; echo "--extend-next 300" > $X/request.txt; git rev-parse HEAD > $X/base.txt
(cd content && find . -name '*.html' | sed 's|^\.||' | sort) > $X/opening.paths   # every document now, ignored ones too
SPEC="PRODUCT.md DESIGN.md DESIGN.json stardust/current/PRODUCT.md stardust/current/DESIGN.md stardust/current/DESIGN.json"
for f in $SPEC; do [ -f "$f" ] && mkdir -p "$X/spec/$(dirname "$f")" && cp -p "$f" "$X/spec/$f"; done   # the opening bytes
$F freeze --paths-if-present "$(echo $SPEC | tr ' ' ,)" --out $X/spec-freeze.json   # a missing one is recorded absent
$F freeze --from stardust/rollout/foundation-freeze.json --out $X/foundation-freeze.json   # the pass's own, as delivered
cp $X/foundation-freeze.json stardust/rollout/.ff.tmp && mv stardust/rollout/.ff.tmp stardust/rollout/foundation-freeze.json
```

Resuming an open pass whose track has no `extract start` yet: re-make each missing piece — `request.txt` and
`base.txt` from the `extend start` detail, `opening.paths`, the spec copy, `spec-freeze.json` — and never replace
one that exists. `$X/foundation-freeze.json` is the evidence the foundation
was re-frozen for this pass: missing, both foundation lines run again (the rollout manifest is replaced only after
it exists); present, only the copy runs again. Once `extract start` is written, all of them exist; one missing is a
`blocked` line, not a re-made baseline.

## 1. The spec is frozen

A pass never writes `stardust/current/PRODUCT.md`, `DESIGN.md`, `DESIGN.json` or the promoted root copies, and
Phase 2's promotion and `direction.md` do not re-run: extract's synthesis over the new pages alone would replace the
gated spec. `$F check --manifest $X/spec-freeze.json` runs after the extract and before `extend end`; on exit 1, copy
each `changed` / `missing` file back from `$X/spec/` and delete each `added` one (a spec file that did not exist —
its existence picks Phase 2's branch), never `git checkout`, then check again until it exits 0. Only the six `$SPEC`
paths are ever restored or deleted: a line naming any other path is a stop, never an action. A change a new page
needs is one line in `stardust/rollout/foundation-requests.md` (`handoff-contract.md` § 3, Fan-out discipline). The
register gains entries only for a new page type, appended.

## 2. The roster, then the extract

`replica extract start --track x<N>`. The roster is fixed BEFORE any capture, in `$X/urls.txt`, which
`extend-roster.mjs` writes only on success; a resumed pass reads it and never selects again, and one without it
selects again from `$X/request.txt`. The crawler lists source pages; `extend-roster.mjs` decides which the delivered
site can take — their EDS destination (`lib/paths.mjs`) is not captured, not a coverage row (a page built outside the
capture, such as a search page), not a document a deploy ledger records live (its file in the checkout or not) and
not an existing content document (nav, footer, fragments: no coverage row names them); one destination, one slot, a
query-less URL kept over a query one, so the roster replays as written. `--reserved-out` records every destination
taken now (captured ones included) in `$X/reserved.paths`, written before the roster: no output of the pass may
take one (§ 4). `--opening $X/opening.paths` keeps the destination of every document of the opening reserved, also
one that has left the tree since (a git-ignored draft the owner moved). A deploy ledger that cannot be read stops
the selection (exit 2, named):

```bash
C=stardust/scripts/extract/crawl.mjs; R="node stardust/scripts/replica/extend-roster.mjs"; O=<state.json site.originUrl>; S="--skip-captured stardust/state.json"
T="--slugs-out $X/reserved-slugs.txt --reserved-out $X/reserved.paths --opening $X/opening.paths"
printf '%s\n' <url> <url> > $X/named.txt; $R select --named --candidates $X/named.txt --out $X/urls.txt $T   # --extend
node $C --url $O --max 0 --first-run-order --skip-failed $S --select-only > $X/candidates.tmp && mv $X/candidates.tmp $X/candidates.txt \
  && $R select --candidates $X/candidates.txt --max <n> --out $X/urls.txt $T   # --extend-next
```

A request a resumed pass can never meet (exit 2 on a named URL) closes the pass: `extract end`, the spec check,
`extend end --detail "rejected: <the message>; 0 pages delivered"`; the owner's corrected request opens the next
pass. The crawler's history (`_crawl-log.json` `runs[]`, `../../extract/reference/ia-extraction.md` § `_crawl-log.json`
shape) gives the order and the failures: `--first-run-order` takes the first run's order (link-first only on a
recorded user-named cap), `--skip-failed` leaves out every page a run failed on (a page the owner names is tried);
`--max 0` lists every candidate, so delivered destinations never take one of the `n` slots. An
empty `urls.txt` ends the pass: `extract end`, the spec check, `extend end --detail "0 new pages found by
discovery"` — the report says discovery (sitemap, links) found nothing new, never that the site is complete.

Then `$stardust extract <O> --prep --dynamics` over the roster, its crawl run with `--pages-file $X/urls.txt $S
--reserve-slugs $X/reserved-slugs.txt` — the file, never a comma list (a URL may hold a comma), and no new page
takes a coverage row's slug: a roster page captured before an interruption is not captured again — a
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
script already skips what is delivered.

**A pass never sends a document under `content/` that existed at its opening, and its localizer never rewrites
one.** That covers the pages, the nav, the footer and the fragments: `$X/opening.paths`. It does not cover the block
library under `/library/` in DA. `da-library.mjs` generates that catalogue from the delivered pages and sends it
whole in each pass, with the new pages counted in (F–I, below).

An earlier pass can have pointed a link to the source site for a page this pass delivers. Those older documents
keep their links. Relinking and re-publishing them is not part of a pass: the report names them (E2, below). A guard
file enforces the rule, so no caller has to remember a flag:

- **The guard.** `$R publish --pass $X` writes `content/.deploy-allow`, the DA paths of the pass's own documents.
  Run it at `handoff start`, where it writes an empty guard. While the guard exists, `deploy-batch.mjs` sends only
  the documents it lists, with or without `--force`. `localize-links.mjs` rewrites only those. A `--paths` entry
  the guard does not list exits 2 with nothing sent.
- **One writer.** Every page or fragment of the pass is sent by `deploy-batch.mjs`, a single document too
  (`--paths`). The hand-written PUT, preview and publish requests that `handoff-contract.md` § 2 permits are never
  used for a document during a pass: they do not read the guard. An older document that needs a repair (nav,
  footer, an earlier page) is a `blocked` line for the owner, never sent.
- **Fail closed.** Both scripts read the run ledger beside `content/`. While it shows an extend pass open (an
  `extend start` without its `extend end`) and the guard is missing, they send and write nothing, and name the
  `publish` command that puts it back. The guard names its pass: one that names another pass, or none, is refused
  too, and only the open pass may run `publish`. The guard is committed with the checkpoints.
- **The pass's documents.** `migrate.mjs render` writes `stardust/migrated/`, never `content/`: the guard stays
  empty during migrate. The conversion of `handoff-contract.md` § 2 writes each `content/<page>.html`. Right after
  it, before the localizer and the PUT, the unit runs `$R output --pass $X --unit <unit> --files <them>`, then
  `$R publish --pass $X`. `--files` takes paths below `content/`: `visit/index.html`, not
  `content/visit/index.html`. `output` records the files, one per roster page, in `$X/outputs/<unit>.paths`. A new
  fragment the pages need is one line in `$X/also.paths`, written by the unit that creates it. `publish` holds and
  names any other new document: an owner's draft, or a file at a roster page no unit recorded. A page no unit
  recorded is not sent, and `done-check.mjs` reports it unfinished. Units may run `publish` at the same time: it
  works under a lock. A file at a destination of `$X/reserved.paths`, or a symbolic or hard link, is refused.
  `publish` also stops (exit 2) on a second file at a pass page's path, such as `visit.html` beside the recorded
  `visit/index.html`: remove or rename it.

The units:

- **Migrate,** one render unit at a time on the main agent (`state.mjs` and `migrate.mjs` each rewrite the whole
  `state.json` — never two at once), never `--all` and never `--force`, which re-render delivered pages. A new type's
  representative, approved in § 3, renders as in a first pass (`migrate.mjs render <slug>`); its sidecar reads
  `fidelityTier: "archetype"`. Its siblings, and every new page of a known type, are `extracted`: `state.mjs advance
  <sibling slugs> --to directed --skill replica` (the frozen direction); each one's slot-filled clone
  (`handoff-contract.md` § 1 row 2) at `stardust/prototypes/<slug>-proposed.html` or `--source <slug>=<file>`; then
  `migrate.mjs render <sibling slugs> --archetype <slug>=<arch>`. Each of those sidecars reads `fidelityTier:
  "sibling"` and names its archetype; a sibling's that reads `archetype` stops the unit.
- **Units:** every new unit in both `progress.json` files is named `<unit>-x<N>` (`archetype-<template>-x1`,
  `<cluster>-x1`, `gate-all-1440-x1`); a `done` unit of an earlier pass is never reopened, and a new page of a known
  template joins a new cluster unit. No `foundation` unit: the foundation is delivered and frozen.
- **A, B:** `inventory.mjs`, without `--state` (with it every page becomes its own template), keeps delivered rows
  and adds the new ones `pending`, so optimize, verify and `done-check.mjs` cover them; `blocks.mjs`, then
  `plan.mjs --pending-only` (a block a delivered page runs is `reuse`, never `convert`). **B2:** the new pages'
  dynamic surface — `dynamic-features.md` gains rows, never loses one.
- **C-deliver** (`--track x<N>`; one start/end pair per pass): C-archetype units for the new types, cluster units
  with `gate-all.mjs --only <their slugs>`. That gate reads rows with status `deployed`: after the PUT and before
  the gate, `update-coverage.mjs <slug> --status deployed --url <the page>` for each page of the unit. Then
  C-final: the pass's queued foundation requests applied once and the published gate re-run on every affected
  archetype, any pass's. Then `deploy-batch.mjs --force --ledger
  stardust/deploy/ledger-x<N>-final.json`, once: it sends every document of the guard again. A later cluster's
  localizer can change a pass page after its PUT, and a plain re-run skips a page its ledger reads live. Then the
  final units exactly as `handoff-contract.md` § 3, row C (C-final), names them, each name suffixed:
  `gate-all-1440-x<N>`, `gate-all-360-x<N>`, `gate-all-wide-x<N>`, then `update-coverage.mjs --gate` per width. Over
  every delivered page with `--skip-existing`, the new pages are gated, and an earlier page too when an input of its
  reuse key changed (#793); the others' verdicts are reused, and each summary stays complete.
- **D, D2:** the served sitemap count grows by the pass's pages (`D-site end` names it); every parity row replays.
- **E2:** `localize-links.mjs --source-host <host> --json` names in `held` each document it left alone though a
  link in it can now be localized. Write to `$X/relink-pending.txt` the entries that `$X/opening.paths` lists: the
  older documents. A draft made during the pass is not one. The report gives the count and the file. Never edit or
  send those documents: the owner decides, outside the pass.
- **F–I** as in a first pass, with three changes. `autofix-aem.mjs` and `da-library.mjs` read the first file that
  matches a page's path, so run `$R publish --pass $X` before each: its exit 0 says that no second file sits at a
  pass page's path. G: `autofix-aem.mjs --slug <s>` once per line of `$X/slugs.txt` (no site-level fix: the
  foundation is frozen), then `deploy-batch.mjs --force --paths <the pages it changed>`. The library refresh
  (`done-check.mjs`'s `library_missing` remedy) is `da-library.mjs`, as in a first pass.
- **Header and footer.** A pass sends no nav or footer document, and the foundation is frozen. So
  `done-check.mjs` reads the header parity record of the first run. If the pass applied a foundation request that
  touches `blocks/header/` or `blocks/footer/`, the header is explored and compared again before `done-check.mjs`
  (`handoff-contract.md` § 3, `header_parity`).
- **The end.** The guard stays through every check and every retry: a `pages_not_live` gap is closed by a
  re-deploy, and that re-deploy needs it. List each opening document that changed, moved or went missing on disk:
  `git diff --no-renames --diff-filter=MD --name-only $(cat $X/base.txt) -- 'content/*.html'`. The guard sent none
  of them. Name each in the report and leave it as it is. The owner settles that edit, and the pass never restores
  it. Then `done-check.mjs --track x<N>` exit 0 — the pass's own `I-dashboard end`, never an earlier pass's —
  `replica handoff end --track x<N>`, `$F check` on the spec manifest, `replica extend end --track x<N> --detail
  "<n> pages delivered (x<N>), <total> live[; <n> older documents not relinked (relink-pending.txt)]"`. Only
  then `rm content/.deploy-allow`, the last step of the pass. A pass that ends before Phase 5 (rejected, or 0 new
  pages) never wrote a guard.
