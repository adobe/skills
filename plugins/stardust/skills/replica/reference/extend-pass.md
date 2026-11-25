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
| `handoff end` with NO track, or `extend end` (track `x<N>`) | delivered: the state report, then stop — no state, spec, content or ledger line written | open pass `x1` after `handoff end`, `x<N+1>` after `extend end` |
| any other line of track `x<N>`, `handoff end --track x<N>` included | resume pass `x<N>` (§ Opening, then its roster and units) | resume pass `x<N>` first; a new pass opens only after its `extend end` |
| a first-pass line (no track) before `handoff end` | the first pass resumes (`../SKILL.md` § Procedure) | refuse: the first pass is not delivered |

Opening a pass refuses, before writing anything, unless: `state.json.flow` is `replica`; `direction.md` does not
record `bounded-single`; `<URL>` is on the site of `state.json.site.originUrl` (a `www.` prefix aside — another
site's URL is refused, not crawled); exactly one of `--extend` / `--extend-next`; `--extend-next` a positive integer
(`0` would lift the crawl cap); every `--extend` URL http(s) on that site, without a query string. Then Setup runs:
its copy steps and those of `handoff-contract.md` § 4, plus `../../extract/scripts/` → `stardust/scripts/extract/`,
from the installed plugin (the project's copies can predate this pass's flags). With `--extend`, the named roster of
§ 2 is then checked once, `--out stardust/.work/extend-preflight.txt`, before `extend start`: its exit 2 — a named
page with a query string, or whose destination is delivered or an existing content document — refuses the pass with
that message, and nothing is opened.

Every ledger line of the pass — replica, extract, migrate, rollout — carries `--track x<N>`, so its pairs never
close or reopen another pass's.

## Opening — idempotent on the open track

`git status --porcelain -- content/` must be empty (else stop: an uncommitted content edit is the owner's to
settle), so every tracked document's opening bytes are the opening commit's, recoverable from any clone that has
it. The `extend start` line carries the request and that commit, so a session that ends mid-opening loses neither.
Everything the pass keeps under `$X` is committed with the checkpoints; a shallow clone of the last checkpoint
resumes it. The opening runs `opening-check` (local, read-only): it lists every page the library refresh reads — a
coverage row `deployed`/`verified` — whose published bytes cannot be recovered from its file or a commit (a page
delivered by hand, a row from before ledgers kept digests) in `$X/unproven.paths`, and exits 1 while any is left.
The opening goes on; the report names them up front, and C-deliver settles them before the pass's first PUT (§ 4). A
document no coverage row names (a ledger-only nav) is no input: it stays reserved and untouched. `inventory` then writes
`$X/reserved.paths`: every DA document a ledger records live, its file in the checkout or not — no pass output may
take one. A deploy ledger that cannot be read stops `select`, `inventory` and every later command (exit 2, named).

```bash
L="node stardust/scripts/stardust/ledger.mjs"; F="node stardust/scripts/replica/foundation-freeze.mjs"
X=stardust/replica/extend/x1
$L replica extend start --track x1 --detail "extend-next 300 @ $(git rev-parse HEAD)" --strict   # never a value starting with --
mkdir -p $X; echo "--extend-next 300" > $X/request.txt; git rev-parse HEAD > $X/base.txt
R="node stardust/scripts/replica/extend-roster.mjs"
$R opening-check --pass $X || true   # unproven delivered pages: named in the report, settled at C-deliver (§ 4)
$R inventory --pass $X   # every document: path, sha256, tracked or git-ignored; reserved.paths
SPEC="PRODUCT.md DESIGN.md DESIGN.json stardust/current/PRODUCT.md stardust/current/DESIGN.md stardust/current/DESIGN.json"
for f in $SPEC; do [ -f "$f" ] && mkdir -p "$X/spec/$(dirname "$f")" && cp -p "$f" "$X/spec/$f"; done   # the opening bytes
$F freeze --paths-if-present "$(echo $SPEC | tr ' ' ,)" --out $X/spec-freeze.json   # a missing one is recorded absent
$F freeze --from stardust/rollout/foundation-freeze.json --out $X/foundation-freeze.json   # the pass's own, as delivered
cp $X/foundation-freeze.json stardust/rollout/.ff.tmp && mv stardust/rollout/.ff.tmp stardust/rollout/foundation-freeze.json
```

Resuming an open pass whose track has no `extract start` yet: re-make each missing piece — `request.txt` and
`base.txt` from the `extend start` detail, `inventory.tsv` (only while content is still the opening commit's: `git
diff --quiet $(cat $X/base.txt) -- content/`), the spec copy, `spec-freeze.json` — and never replace one that
exists. `$X/foundation-freeze.json` is the evidence the foundation
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
capture, such as a search page) and not an existing content document (nav, footer, fragments: no coverage row names
them); one destination, one slot, a query-less URL kept over a query one, so the roster replays as written:

```bash
C=stardust/scripts/extract/crawl.mjs; R="node stardust/scripts/replica/extend-roster.mjs"; O=<state.json site.originUrl>; S="--skip-captured stardust/state.json"
printf '%s\n' <url> <url> > $X/named.txt; $R select --named --candidates $X/named.txt --out $X/urls.txt --slugs-out $X/reserved-slugs.txt   # --extend
node $C --url $O --max 0 --first-run-order --skip-failed $S --select-only > $X/candidates.tmp && mv $X/candidates.tmp $X/candidates.txt \
  && $R select --candidates $X/candidates.txt --max <n> --out $X/urls.txt --slugs-out $X/reserved-slugs.txt                           # --extend-next
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
script already skips what is delivered. **The publish list:** a unit whose pages rendered records the exact files it
wrote, `$R output --pass $X --unit <unit> --files <them>`, in its own `$X/outputs/<unit>.paths` (one file per roster
page; an older or reserved document, a second file for one page or a non-roster file is refused). `$R publish --pass $X`, run again before each deploy, writes `$X/publish.paths`:
those outputs plus `$X/also.paths` (a fragment the pages need, written there by the unit that creates it). Any other
new document — an owner's draft, a file at a roster page whose capture or render failed — is held and named. It also
writes `$X/targets.paths` (link targets: every opening document a ledger records live or coverage delivers, plus the
publish list) and `$X/rewrite.paths` (what the localizer may rewrite: the publish list, and an opening document only
when its published bytes are in a commit — never one whose only proven copy is its working file). Every `deploy-batch.mjs`
run of the pass — a cluster's, G's re-deploy, an E2 fix — carries `--allow $X/publish.paths`, so the script sends
nothing outside it. The localizer runs twice, as `handoff-contract.md` § 2 orders: `localize-links.mjs … --targets
$X/targets.paths --rewrite $X/rewrite.paths --receipt $X/receipts/<unit>-<UTC time>.json` (a new file per run), then
`localize-links.mjs … --targets $X/targets.paths --rewrite $X/rewrite.paths --check`, which writes nothing and takes
no receipt. An older page is sent only as an
approved revision, below; a finding on one is reported.

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
- **A, B:** `inventory.mjs` keeps delivered rows and adds the new ones `pending`, so optimize, verify and
  `done-check.mjs` cover them; `blocks.mjs`, then `plan.mjs --pending-only` (a block a delivered page runs is
  `reuse`, never `convert`). **B2:** the new pages' dynamic surface — `dynamic-features.md` gains rows, never loses
  one.
- **Relinked pages — published only on the owner's yes, in every mode.** A page this pass delivers can be a link
  target an earlier pass pointed to the source, so `localize-links.mjs` rewrites older documents too. Its receipts
  are the only evidence of what it changed — each names the bytes that run read and wrote, so concurrent clusters
  never share a record. `$R relink-status --pass $X` names each older document a receipt covers:
  - `candidate` — the localizer's own edit and nothing else, measured against the document's last published bytes
    (the committed copy — any pass's opening blob or approved revision — whose digest the newest live row records). Show
    the owner the exact list and say that a re-PUT replaces the DA document, so an edit made in DA since delivery is
    lost.
  - `conflict` — an edit before or after the localizer's runs, or changes other than links (the owner's work):
    held, the file kept exactly as it is, named to the owner.
  - `held` — no known published bytes: git-ignored, never published, a newest live row without a digest, a version
    whose bytes are in no commit, or a clone without the opening commit (the line names the `git
    fetch` that brings it).

  Approved candidates: `$R relink-approve --pass $X --files <them>` freezes the bytes it classified in
  `$X/approved/r<k>/`;
  **commit that checkpoint before sending**, then `deploy-batch.mjs --content $X/approved/r<k> --allow
  $X/approved/r<k>.paths`, then commit its ledger. A resume that finds a revision without a live ledger runs that
  same command again. Declined candidates: `$R relink-restore --pass $X --files <them>` (a file saved since
  it was classified is kept and refused as a conflict). Unanswered (hands-off)
  candidates are restored too, and counted. The script acts on candidates only. `replica extend blocked --track x<N>
  --detail "republish awaits the owner: <n> pages"` counts held documents, conflicts and unanswered candidates. The
  question is asked at C-final, before its final units, and again at E2 when its run rewrites more; `relink-status`
  runs once more last, so its `relink-status.json` tells the next pass what was left. After an approved revision
  lands, it is gated again in each final unit's own mode. A page document: `gate-all.mjs --width <w> --only <slugs>`
  then `--width <w> --compare-only` per delivery width, and `--wide --only` then `--wide --compare-only` for the
  advisory report. A shared document (nav, footer, any chrome a page's metadata names: no coverage row, no slug): the
  three final units again over every delivered page WITHOUT `--skip-existing` (a reuse key names only files called
  `nav.html`/`footer.html` at the content root or one level below — a fresh capture is the only proof). Then
  `update-coverage.mjs --gate` on the delivery tables only (`all-<w>`, never `wide-<w>`).
- **C-deliver** (`--track x<N>`; one start/end pair per pass) settles what the opening deferred, before any PUT:
  `$R opening-check --pass $X`. On exit 1 nothing is sent — the library refresh would refuse those pages, and no
  platform record proves which revision is live — and the owner decides: re-deliver them from their committed bytes,
  saying that a re-PUT replaces the DA document, or end the pass (`replica extend blocked` names them meanwhile). On
  the yes: `$R redeliver --pass $X --files <them>` freezes the opening commit's bytes in `$X/approved/r<k>/` (never
  the working file); commit it; `deploy-batch.mjs --content $X/approved/r<k> --allow $X/approved/r<k>.paths` (a retry
  is the same command, its ledger inside the revision); commit the ledger; `opening-check` exits 0. Then: C-archetype units for the new types, cluster units
  with `gate-all.mjs --only <their slugs>`, then C-final: the pass's queued foundation requests applied once and the
  published gate re-run on every affected archetype, any pass's; `$R reconcile --pass $X`, which lists in
  `$X/redrive.paths` every document of the publish list whose bytes are not its newest verified delivery in any
  ledger — a page a later cluster's localizer changed after its PUT, a C-archetype representative a sibling's run
  relinked, a declared fragment never sent — and `deploy-batch.mjs --paths $X/redrive.paths --allow
  $X/publish.paths --force --ledger stardust/deploy/ledger-x<N>-reconcile.json` (`--force`: a plain re-run skips
  a page its ledger reads live and the origin serves; a resume runs `reconcile` again first); the relinked older pages, above; then the
  final units
  exactly as `handoff-contract.md` § 3, row C (C-final), names them, each name suffixed: `gate-all-1440-x<N>`,
  `gate-all-360-x<N>`, `gate-all-wide-x<N>`, then `update-coverage.mjs --gate` per width. Over every delivered page
  with `--skip-existing`, the new pages are gated, and an earlier page too when an input of its reuse key changed
  (#793); the others' verdicts are reused, and each summary stays complete.
- **The library refresh** (`done-check.mjs`'s `library_missing` remedy) reads delivered bytes, never working files: `LIB=$(mktemp
  -d)/library-src; $R published --pass $X --out $LIB` writes each document at the bytes its newest live row's digest
  names (the working file or any pass's committed copy), and names the rest withheld; then `da-library.mjs --content $LIB`. It exits 1 while a delivered page is withheld (a conflict's published bytes missing, a pass page
  not delivered as it is): close that first, or a `blocked` line names it.
- **D, D2:** the served sitemap count grows by the pass's pages (`D-site end` names it); every parity row replays.
- **F–I** as in a first pass, except G: `autofix-aem.mjs --slug <s>` once per line of `$X/slugs.txt` (no site-level
  fix: the foundation is frozen), the re-deploy with `--allow`. After C-final, any phase that changes a pass
  document — G's autofix, an E2 fix — runs `$R reconcile --pass $X` and the forced deploy of `$X/redrive.paths` again
  (as at C-final) before it verifies; a plain re-deploy skips a page its ledger reads live. Then `done-check.mjs --track x<N>` exit 0 — the
  pass's own `I-dashboard end`, never an earlier pass's — `replica handoff end --track x<N>`, `$F check` on the spec
  manifest, `replica extend end --track x<N> --detail "<n> pages delivered (x<N>), <total> live[; republish awaits
  the owner: <n> (held, conflicts, unanswered)]"`.
