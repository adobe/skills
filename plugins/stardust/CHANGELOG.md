# Changelog

This file starts at 0.14.0. Prior versions (0.3.0 – 0.13.1) are documented in
git history only (plus the branch-scoped notes in
`CHANGELOG-redesign-adobecom.md` and `CHANGELOG-delivery-media-fidelity.md`).

## 0.35.6 — the instrument counts fix rounds; one height bar per regime; one browser budget across jobs; the hide list is derived, not remembered

Retrospectives of recorded hands-off runs found the gate's economics kept in prose: the 3-round fix cap was a
sentence a new brief could reset, while gate-triage counted the tables on disk; the same page could PASS at
gate-all's 5 % height bar and FAIL at gate-evidence's 8 px; a browser slot bounded jobs, not browsers, so one
gate-all job opened up to six Chromiums inside it; and after an `--only` run, which never writes the roster
`summary.json`, an agent pointed `update-coverage --gate` at that file and was told
`not a gate-all summary (no rows[])` — a missing file reported as an empty one. Another recorded run knew its in-flow
location bar's selector from the preserve-direction step on and never wrote a hide list, because nothing linked the
register to the file; probed later, the recorded selector matched nothing on either side (the bar was the first
in-flow block above the header), and chrome-parity had printed `hidden live: … ×0` and carried on. Numbered 0.35.6
provisionally, stacked on 0.35.5.

- **Fix rounds are counted by the instrument (#134, extends #126).** Every `gate-all --only` run that yields a
  verdict counts one round per page in `<out>/<slug>/rounds.json` (an INCONCLUSIVE row does not count, a reused row
  does); a fourth round is refused before any capture — `gate-all: refused to start, no verdict — cap reached —
  re-prototype decision: <slug> 3/3 @<w> …`, exit 2, nothing written. Only the re-prototype decision starts a new
  count: `--round-reset "<reason>"`, recorded in rounds.json `resets` and the row's `roundReset`; `--max-rounds`
  (1..3) may only lower the cap. Concurrent rounds of one page are refused through `<slug>/rounds.lock`; a project
  without rounds.json is seeded from its run tables. Rows carry `round`; gate-triage reads the same count (`rounds
  n/max` per row in triage.md, `cap reached (<slug>@<w> n/max): re-prototype decision now`) instead of counting
  tables, and `update-coverage --gate` records it per width in `delivery.gate.rounds`.
- **One height bar per regime.** Without a pixel table, gate-evidence judges a `gate.sh` round at |Δh| ≤ 8 px in
  the prototype regime and ≤ 5 % of the origin height in the published regime — gate-all's bar; a table row, either
  stage, still decides at 5 %. The origin height comes from pixel-compare's `A <w>x<h>`; a round whose log has none
  reads `OPEN: no origin height in the round's log — re-run`, never a pass. `--height-tolerance <v>`: v ≤ 1 a
  fraction of the origin height, v > 1 pixels, for both regimes. Evidence lines name their bar, e.g.
  `[published regime: |Δh| ≤ 5 % of origin 3000px = 150px]`.
- **One browser budget across jobs.** run-bg gives a slot-holding job `STARDUST_BROWSERS_PER_SLOT = max(1,
  floor(STARDUST_BROWSER_BUDGET (default 3) / STARDUST_BROWSER_SLOTS))`: the contract's 3 browsers = budget 3 across
  all jobs; a larger machine raises `STARDUST_BROWSER_BUDGET`, and the slots with it; a budget below the slots says
  so in one `run-bg:` line. Inside a slot gate-all clamps its origin / EDS / probe pools to that share (1 → 1/1/1,
  the origin captures before the EDS ones; 3 → 2/1/2), and its roster estimate — run-bg's deadline for a gate-all job
  without `--timeout` — follows the pools (×4 at one browser per slot). gate.sh runs its `--full` probes that many at
  a time, so a bounded round takes the sum of their times; one stderr line names the bound and, when it holds probes
  back, the remedy (start the round through run-bg with `--timeout 1800`, or raise `STARDUST_BROWSER_BUDGET`). Run
  without a slot, nothing changes.
- **update-coverage ingests every gate-all table.** New: `--gate` takes the gate dir `all-<w>/` (its summary.json,
  then runs/*.json in name order; the newest row per page and width wins), beside the roster `summary.json` and an
  `--only` run's `runs/<ts>-<slug>.json` it already took. A `summary.json` absent beside `runs/` tables ingests those
  with one stdout note,
  `summary.json absent — an --only run writes runs/<ts>-<slug>.json; ingested <n> table(s) from <dir>/runs/`.
  The refusals are distinct (exit 1, nothing written): `<path> not found`, `<path> cannot be read (<code>)`,
  `<path> does not parse as JSON (<error>)`, `<path> is not a gate-all summary (no rows[])` — now only a parsed
  file without rows — and `<dir> holds no gate-all table (no summary.json, no runs/*.json)`.
- **An override must be a deviation's size.** gate-all lets an `overrides.json` entry lift a row only within 2 × the
  bars on the row's own measured numbers — pixel % ≤ 2 × `--threshold` and |Δh| ≤ 2 × `--height-tol` × origin
  height, inclusive; a reused row is re-checked. Beyond that the row stays FAIL with
  `override exceeds magnitude: use --hide / presence.json` — a capture or hide-list problem, not a deviation —
  counted in `totals.overrideMagnitude` and named on one summary.md line,
  `Override exceeds magnitude (fix the capture / hide list, not a deviation): <path>, …`.
- **The host measured is named.** The published gate still measures the preview host by default (coverage
  `deployedUrl`); the C-final roster gate and the gate before done-check run with
  `--eds-host <rollout.json site.liveHost>`. gate-all's first status line ends `; build host <origin> (<from>)`
  (`--eds-host`, `coverage deployedUrl`, `state liveUrl` or `--proto-base`); every row records `host`, the origin of
  its EDS capture, so `--compare-only` names the host the pixels came from; `update-coverage --gate` records it as
  `delivery.gate.host` (the row's `host`, else the table's `_provenance.eds`, else null).
- **A fix round triages itself.** A published `--only` run of a page that already had a row in the out dir runs
  gate-triage's triage on that dir in-process (offline: no parity, nothing routed) — `<out>/triage.{json,md}`, its
  head printed under the table as the next round's input. A triage failure is one `triage: skipped — <why>` line and
  never changes the verdict or the exit code; a page's first gating, full runs and the prototype stage do not triage.
- **gate-all takes `--dismiss <sel,…>`** like gate.sh and anchor.mjs: both stitches dismiss the site's own overlays
  before the hide list; its probes keep their built-in dismissal. The list is recorded in origin.json / eds.json,
  probes.json inputs and the gate key; a capture taken with another list is not reused (`dismiss list differs`), and
  a kept origin taken with another dismiss / hide list makes the row INCONCLUSIVE —
  `origin capture polluted: kept origin taken with another dismiss/hide list`.
- **One hide list per site (#135, extends #125).** `stardust/replica/presence.json` — a gate dir's presence.json
  shape, `"*"` and per slug — lists the in-flow per-visitor regions once; live-session's `mergePresence` puts it under
  a gate dir's file (the gate dir's value wins per key and field). gate-all, gate.sh, chrome-parity, chrome-explore
  and chrome-compare read it with no flag (`--slug` no longer needs `--presence`); gate-triage passes it to
  chrome-parity when the gate dir has none, and an edited site list re-runs stored parity; the diff probes get the
  merged list as `--hide`. Its selectors print as `site presence.json`; a malformed one is an error naming it
  (gate.sh: exit 1 before any capture). After a change to the site `"*".hide`, re-explore both sides — chrome-compare
  reports `hide-mismatch` for records explored without it.
- **Writing the list is a step.** New `presence.mjs`: `seed` writes the runner's overlay selectors
  (`stardust/.labs/run.json` `siteOverlays`, env `STARDUST_SITE_OVERLAYS`) at Setup;
  `add --hide <sel,…> [--slug <s>] [--reason <R-nn>]` records the region the preserve-direction step identified (its
  register entry, `kind: per-visitor-region`, carries the `selector`) — idempotent, atomic, a malformed file refused
  with nothing written. `suggest <url>` lists the candidates read off the live page; `add --verify <url>` refuses
  (exit 2, nothing written) a selector that still matches nothing after a poll window and names the candidates
  instead; without `--verify`, add warns
  `presence: not verified against a live page — add --verify <url> (presence.mjs suggest <url> lists candidates)`.
- **A hide that matched nothing is never silent.** live-session derives the candidates from the DOM —
  `inFlowRegionsAboveHeader`, the in-flow blocks above the header (0-px wrappers kept), each with a selector verified
  unique — and `recountHides` counts each hide selector again right before the capture; one that matched nothing at
  both counts gives one line,
  `hide matched nothing on live — candidates: <selector> (<tag>, <h>px); … (<sel>, …)`.
  stitch-shot's `--json` record carries each hide's `nAtCapture` and `hideMiss { sels, candidates }`; gate-all
  (`WARNING <slug>: …`, the row's `hideMiss`, `totals.hideMiss`, one summary.md line), gate.sh
  (`gate.sh: WARNING …`, a reused live.png's record included) and chrome-parity (`WARNING …`, `hideMiss` in `--json`)
  print it — a warning, never a verdict. chrome-parity also prints
  `hint: an in-flow region above the header — presence.mjs add --hide <candidate selector>` when the header and its
  texts are offset by the same Δy on one side.
- **gate-evidence survives an error row.** A pixel-table row without a pixel measurement (a stitch error, a missing
  capture) no longer throws: the gate reads `OPEN: no pixel measurement — <the row's error> — —, height delta —, …`,
  never FAIL and never a pass, and the printed row shows `1440=—/Δ—`.
- **gate-all refuses a value flag without its value.** A missing value, or one that starts with `-` (another flag, a
  negative number), is one stderr line and the usage, exit 2, before any I/O:
  `gate-all --eds-host --only home` → `gate-all: --eds-host needs a value, got "--only"` (`got nothing` at the end of
  the arguments).

## 0.35.5 — a gate names what it could not measure; an override must earn its row

Recorded hands-off runs measured fix rounds against origin captures a consent wall or a geo modal had polluted, and
still got numeric PASS / FAIL verdicts with the normal exit code; one 99-page run then delivered 94 pages through
`overrides.json` rows that nothing validated or counted. The overlay sweep on the gate path knew English labels and
one consent manager by id; a stronger multilingual sweep existed twice, unused by the gates.

- **One consent table, one sweep (live-session).** `CONSENT_CANDIDATES` gains Cookiebot, Usercentrics (its accept
  button inside the shadow root), TrustArc, Didomi and "Allow all"; when no candidate matches, the last pass is
  `CONSENT_LABEL_SWEEP` — the multilingual accept labels (accept-like first, `decline` last) clicked only inside a
  dialog, a consent container or a fixed / sticky / high-z layer, open shadow roots included. style-census's own
  pass is now that sweep (a style-census next to an older live-session.mjs exits 2: re-copy it). Consent is still
  clicked, never removed.
- **dismissOverlays says what it left behind:** `overlayLeft` names an open modal dialog, a banner-sized part of a
  known consent root still visible, a fixed or sticky layer painting over ≥ 80 % of the viewport (content of the page beneath it — a sticky
  hero at the top is not one), `html` / `body` `overflow:hidden`, or a sweep click that navigated away. The label
  sweep never submits a form or follows a link out of a merely sticky header. stitch-shot runs the check
  once after its last sweep and `--hide`, prints `overlay-left: <sel>`, and `--json <file>` writes a capture record
  (`overlayLeft`, `fontsFailed`, dismissals, hides, height, overflow) — exit codes unchanged.
- **gate-all: INCONCLUSIVE rows.** A row whose origin fell back to the crawl screenshot, or whose either capture left
  an overlay (or wrote no capture record), has no pixel or height verdict: `inconclusive: true`, reasons
  `origin capture polluted: <why>` / `build capture polluted: <why>`, INCONCLUSIVE in `summary.md`,
  `totals.inconclusive`; the run exits 2. No such row is reused; fix rounds and live.png reuse refuse a capture whose
  record predates the check or names an overlay; `--skip-existing` re-shoots such a capture, and under `--compare-only`
  or a failed `--recapture-origin` it reads unchecked. gate-evidence reads the row OPEN (never FAIL); `update-coverage
  --gate` keeps the page's status and records `delivery.gate.inconclusive` (`pass: false` — no verdict is no pass);
  gate-triage lists it as "fix the capture — `--hide` / presence.json — not the page".
- **Overrides are validated mechanically.** An `overrides.json` row counts only when its `verdict` is `tier-shift`,
  `instrument-artifact` or `source-volatile`, its `reason` names an `R-<nn>` present in
  `stardust/replica/inconsistency-register.md`, and the row's clip and content checks PASS (n/a is no pass; the
  prototype stage has no content criterion) on a row that was measured — an override never stands in for a missing
  pixel comparison; otherwise the row stays FAIL with `override rejected: <rule>`. The
  summary prints counted / rejected overrides and their share of the roster; update-coverage records
  `delivery.gate.override = {verdict, reason, valid}` (an override from an older table, without `valid`, does not
  count); gate-triage triages rejected overrides as failing rows.
- **Fonts must load.** A declared face whose `document.fonts` status is `error` on either side (stitch-shot's existing
  check, now in its `--json` record) is the row reason `font-not-loaded:<family>`; the row cannot PASS. A check that
  could not run is recorded as not checked (`fontsFailed: null`, carried into gate.sh's `live.json`) and reads
  `font-check-skipped:<side>` — no PASS either.
- **gate.sh gives no verdict on an overlay left and settles both sides.** A live or build capture that prints
  `overlay-left:` ends the round with exit 1 ("no verdict: fix the capture"); a polluted live.png is removed, and a
  live.png whose `live.json` does not record the overlay check is retaken once. The build capture now runs with
  `--settle` like the live one, so a consent manager an EDS build loads late is dismissed there too; the gate
  reference drops its known-limit note. A stitch-shot copy without `--json` is refused up front (re-copy it).

Numbered 0.35.5 provisionally — the stack is renumbered at merge (the contract now says overrides are validated, which
may make the merged release a minor). No threshold or criterion moves: rows measured on clean captures keep their
verdicts; what changes is that a polluted capture, a face that did not load and an unvalidated override no longer
read as a pass. Costs: one extra origin capture per page whose record
predates the check, a slower settled build capture in gate.sh. crawl.mjs keeps its own label list until its owner
imports the shared table (a live-session test fails if the two drift).

## 0.35.1 — gate-all reads its published roster from the rollout coverage; `--eds-host` takes a bare host

Two recorded hands-off runs, a 100-page and a 10-page one, each hand-wrote a script that built a gate state file
from the rollout coverage: gate-all selected only `state.json` pages `deployed` with a `liveUrl` — which nothing in
the delivery flow writes — while the handoff contract told the agent to run gate-all with no state file. One run
lost a 43-minute roster run to "no pages selected"; the agent also found that `--eds-host` needed the scheme.

- **`gate-all.mjs --coverage <file>` is the published stage's roster** (default `stardust/rollout/coverage/pages.json`
  when it exists, else `--state`): rows `deployed` / `verified`, and `failed` with a `gate:` error so a fix round
  re-gates them, each with `delivery.deployedUrl` (the gated URL, its host rewritten by `--eds-host`) and
  `source.sourceUrl` (the origin). A `state.json` beside it is optional and lends `template` / `fidelityTier` /
  `deployedPath` by slug, so a page that was already selectable keeps its template, tier and units — and its gate
  key while its coverage `deployedUrl` / `source.sourceUrl` equal the state's `liveUrl` / `url`. The coverage
  wins over `--state` for the published stage; `--state` keeps the prototype stage and legacy projects (no coverage
  file). run-bg's roster estimate resolves the source the same way; an explicit `--coverage` also feeds the gate
  key's block list (the default path did already).
- **The first status line names the roster's source:** `roster: …` ends
  `; source: coverage|state <path> (<q> of <N> row(s) / page(s) qualified)`, counted before `--only`.
- **An empty selection names both files** (absolute paths) with their counts — coverage rows deployed / verified /
  gate-failed with a `deployedUrl` (and how many lack a source url), state pages deployed with a `liveUrl` — and the
  roster's source; exit 1 kept. From a coverage roster the hint says the coverage wins and points at
  `update-coverage.mjs <slug> --status deployed --url <deployedUrl>` (or `--coverage <file>`); a state roster keeps
  the `--coverage` / `--state` / deploy-first hint.
- **`--eds-host` takes a bare host or `https://<host>`.** gate-all adds `https://` when there is no scheme and
  normalises to `<protocol>//<host>` (lower-case host, a non-default port kept); a path, query, hash or credentials
  are refused before any I/O — one stderr line and the usage line, exit 2. A bare host had produced `host/path`
  capture URLs and `new URL` failures. The summary's `edsHostOverride` records the normalised origin. gate-triage
  normalises each page's recorded host the same way, so its re-gate commands carry `https://<host>` and a bare host
  and its URL form share one command (a value gate-all refuses is kept raw). gate.sh is unchanged — it takes full
  URLs, never a host.
- **The contract and docs name the roster source:** the handoff contract (§ 1 row 5, § 3 row C), the replica and
  rollout skills, the gate reference and the scripts index — coverage rows `deployed` / `verified`, and `failed` by
  the gate; the coverage row is recorded `deployed` with its URL before gate-all reads it; no state file, no
  hand-built roster. The stardust skill names an agent-written roster builder for gate-all as a deviation to record.

Patch: an input source added, no verdict change. Numbered 0.35.1 provisionally — the stack is renumbered at merge.
No threshold, criterion, capture or reuse change; a page that was already selectable keeps its template, tier and
units, and its gate key while its coverage `deployedUrl` / `source.sourceUrl` equal the state's `liveUrl` / `url`.

## 0.34.5 — replica self-hosts the source's brand faces; one hide list for in-flow bars across captures, probes and the header contract; cap-probe lists unpaired modules

A recorded ten-page hands-off run passed all four gated archetypes at both widths, but three of its six register
entries and most residual pixels came from one cause — the substituted brand face; a per-visitor bar shifted
every live measurement; and two probes misbehaved: cap-probe failed a module pair that compared two different
things, and content-diff read hidden image placeholders as missing icons.

- **replica follows deploy § 4 principle 2 from the archetype on (#133, extends #80).** The source's brand faces
  are self-hosted as-is (the files the live site serves, same weights and styles); the brand family stays first in
  every stack and a metric-matched substitute is only the fallback entry; proprietary faces raise deploy's
  licensing alert (banner, `fonts/LICENSING.md` at delivery, the hand-off message) plus ONE deferred register entry
  for all of them. The substitute had cost calibration iterations (derived font files with digit-width and
  ascent/descent overrides) and still re-wrapped paragraphs (+56 px on one archetype, line-count changes on
  others). The gate's pass bar treats a font fork as a defect (usually a face that did not load), never a justified
  substitute; the eval's `font_policy` criterion follows.
- **chrome-parity `--hide <sel,…>` and `--presence <file> --slug <slug>`** remove in-flow per-visitor regions (a
  location-suggestion bar above the header) on both sides after the settle, before measuring, and record them
  (`hidden live:` / `hidden build:`, JSON `hidden`); `--dismiss` clears overlays only. The bar had read as −88 px
  at 1440 and −268 px at 360 on all chrome text, logged as a residual on every archetype. chrome-parity imports
  playwright lazily (its `--help` and pure parts need no browser) and has a contract test.
- **The hide is a style rule too.** live-session's shared `hideRegions` hides every match inline AND injects one
  `<style data-stardust-hide>` rule per selector (one adopted stylesheet when a CSP blocks inline styles), so a bar
  the page re-renders after the hide pass stays hidden; chrome-parity uses it. Hardening: a bar the page renders
  after the hide pass escapes an inline-only removal.
- **One hide list for the captures, the probes and the header contract.** stitch-shot, content-diff, visual-diff,
  content-presence and clip-probe take `--hide <sel,…>` (two-sided probes apply the same list to both sides) and
  print/record what was hidden; presence.json gains `hide` per slug and `"*": { "hide": [...] }` for a site-wide
  bar. gate.sh merges its `--hide` with presence.json `hide` (its own regime's table first) for both captures and
  every probe but unit-geometry (chrome-parity: `--hide` + `--presence`), records the list in `live.json` and
  retakes `live.png` when it changed (or, hiding regions, when no `live.json` records it); gate-all reads only
  presence.json `hide` (both stitches, content-presence, clip-probe; rows record `hide`, origin/eds.json the
  stitch's hidden line). chrome-explore hides the list after every load and records it (`--hide`,
  `--presence --slug`); chrome-compare takes the expected list and raises one `hide-mismatch` error when the
  records differ; qa's header check re-explores with the contract's list. A capture, probe or cache taken with
  another list is not reused automatically; keys gain the list only when it is non-empty. content-diff removes
  the matches from the DOM (its inventories read `display:none` text).
  Recorded: the first delivered page passed only through a documented override — 1440 7.82 % / Δh 88 px, 360
  22.78 % / Δh 268 px, both the bar — and the header contract could not be compared at 360 because the bar hid
  the header from chrome-explore.
- **gate-triage's parity runs hide the gate's regions:** the gate's presence.json (`--presence --slug`) and the
  row's `hide` reach chrome-parity; `triage.json` records `parity.hide` and `_provenance.presence`, the md line
  names what was hidden. Recorded: triage's parity groups reported the bar's offset as a property delta.
- A malformed presence.json reads `presence.json <file> unreadable (…)` (chrome-parity said
  `--presence <file> unreadable`), exit 1; gate.sh now stops any round on it before capturing.
- **cap-probe lists an implausible module pair as `○ unpaired`** — widths differing by more than 40 % of the wider
  AND different cap elements (tag or role) — instead of failing it; the verdict line names
  `modules scored <s> of <n>[, <u> unpaired]`; fewer than half paired → `INCONCLUSIVE` (exit 0, a note to check
  `--main` / `--build-main`), while a failing wrapper/content-cap row still FAILs. Recorded: a FAIL the agent had
  to label an artifact — module 4/4 paired a live pagination list (552 px) with a build media column (280 px).
- **content-diff reads a hidden image placeholder as a placeholder, never a missing icon.** A ≤ 64 px image that is
  not shown, has a placeholder signal (data: URI, small intrinsic size, aria-hidden, a loaded sibling with the same
  alt or file) and its full image loaded or declared is listed under `placeholder images` (attributes line, JSON
  `attrs.placeholders`); an image with no current source stays an icon. The emitter was content-diff — clip-probe,
  content-presence and visual-diff raise no 🔴 on a hidden image. Its `--live-cache` key gains an inventory
  version, so an older cache re-probes once. Recorded: a hub archetype ended with two structural 🔴 —
  `MISSING ICON` on ~20×11 px lazy placeholders inside hidden tab panels, inside links, invisible on both sides.

Minor in substance: the replica font rule changes behaviour (a substitute becomes a self-hosted brand face with a
licensing alert). Numbered 0.34.5 provisionally — 0.35.0 is reserved; renumber at PR time if main moved.
Without hides, captures are unchanged (a malformed presence.json now stops a gate.sh round, exit 1) and verdicts
move only through content-diff's placeholder rule, cap-probe's unpaired rows / INCONCLUSIVE and chrome-parity:
`gate.sh --full` and gate-triage pass an existing presence.json to it, which hides that slug's
`variable` regions — its argv, its `chrome-live.json` / stored-result key and its verdict can change. Records gain
`hide` / `presence` fields (gate.sh's `live.json` always records `hide`, `triage.json` its
`_provenance.presence`); content-diff's live cache re-probes once (inventory version) and its JSON `attrs` gains
`placeholders`. No threshold change.

## 0.34.4 — roster gates sized to their deadline; an older gate table never reverts a newer verdict

A recorded 100-page hands-off run lost about 58 minutes to discarded roster gates (run-bg's 900 s default deadline
killed a 99-page roster at 1440 that needed 2152 s) and reverted 8 passing pages by ingesting an older gate table.

- **`update-coverage.mjs --gate`: the newest row per page and width wins.** `delivery.gate` records `at` as when
  the row was measured (a whole-row reuse's `reused` time, else the table's `_provenance.writtenAt`), not the
  ingest time; `width` is the table's breakpoint, `atByWidth` the newest applied row time per width. An older row
  of either width is skipped and counted (`N older row(s) skipped`); a gate recorded before 0.34.4 never blocks a row.
- **gate-all names the cause of an empty selection** instead of `no deployed pages selected`: the state file it
  read, its page count, how many are `deployed` with a `liveUrl` (published) or have a `prototypePath` (prototype),
  an `--only` that matched none, and the hint to pass `--state` from the project root or deploy first; exit 1 kept.
- **A roster gate starts only when its deadline can hold it.** gate-all prints its estimate (25 s × pages × widths)
  on each run's first status line (stdout, `_run.log`). run-bg exports the job's deadline as `RUN_BG_DEADLINE_SEC`;
  below it gate-all refuses to start (exit 2, no verdict, nothing written), naming `--timeout <estimate>`.
  `run-bg.mjs start` without `--timeout` gives a gate-all job max(900 s, the estimate summed over its gate-all
  invocations), logged; an explicit `--timeout` and every other job are unchanged; both `--help` texts say so.
- **The cluster verdict line records `first pass 360: x/y`**: x of the cluster's y siblings (archetype out) passed
  on their first row at 360. `gate-triage.mjs --unit <cluster>` prints `first pass <w>: x/y` (stdout only); handoff
  contract § 3 row C, the `progress.json` verdict and the replica skill's C-deliver sentence carry it.
- **The scripts-index lint cap is 13 KiB** (was 12): the index is 12,600 bytes and keeps its rows at full text.

Patch: no verdict, threshold, criterion, gate-row or capture change; the refusal fires only when a job's deadline
could not hold the roster; `delivery.gate` only gains fields; the verdict gains one advisory count, no unit step.

## 0.34.3 — gate-triage: failing gate rows grouped by shared cause before the next pixel round

A failing all-pages table usually holds a few causes repeated across many pages. One advisory script names them
before the next fix round, so each cause is fixed once and re-gated over the pages it touches.

- **`gate-triage.mjs` groups failing gate rows by shared cause, diffs the failing region's properties and routes
  foundation causes to `foundation-requests.md`; it never applies a fix.** It reads each gate table
  (`summary.json` and `--only` runs, newest row per page, each row's source recorded) with the page's `pixel` /
  `clip` / `content` / `units` evidence, the coverage share map and the unit families; files every failing row
  under `block:<name>`, `encoder:<template>`, `layout:<template>` (re-prototype candidate) or, from the property
  diff, `token:<property>`; runs `chrome-parity.mjs --no-defaults --region … --live-cache` once per group
  representative (at most 4 per run across all gate dirs; `--no-parity` skips it); names each group's re-gate scope
  (never smaller than its rows) with one `gate-all.mjs --only` command per eds host the pages were measured on;
  writes `triage.{json,md}` into each gate table dir, byte-identical on a re-run. Frozen-foundation causes become
  one `foundation-requests.md` line per width in the contract's format (a cause@width is queued once; a line whose
  property diff did not run says so, and a later real diff is queued once beside it; non-frozen shared blocks stay
  cluster fixes). Foundation causes are re-gated at C-final, after the queue is applied; with
  `stardust/rollout/units/<unit>.paths`, a cause with no row on the unit's pages reads "another unit's". On a
  recorded hands-off run's tables it filed 105 of 108 failing rows (97.2 %) under 21 shared causes.
- **replica Phase 5, handoff contract § 3 row C and the failing-row paragraph name it as advisory:** run it
  between fix rounds and act on causes with rows on your own pages; the rows stay the verdict, the 3-round cap
  and the foundation freeze stay.

Patch: a new advisory script and three one-sentence doc additions; no verdict, threshold, criterion, row or
capture change; the C-deliver wording is advisory, not a new required unit step.

## 0.34.2 — the source oracle holds still: fix rounds measure against this run's captured origin; browser budgets split

A fix round compares the build against the source capture its run already took instead of loading the source
again, the diff probes cache their live side the way chrome-parity always did, and browser jobs share one
machine-wide budget so parallel projects stop starving each other.

- **Fix rounds measure against the captured origin while it is fresh.** `gate-all --only …` (and
  `--recapture-eds`) reuse `<slug>/origin.png` and its presence inventory (`content-presence --origin-cache`)
  when they were captured in this run — at or after the last rollout `A-inventory` or replica `extract` start in
  `stardust/status.jsonl`; older captures are retaken once. Cross-run reuse is opt-in (`--origin-max-age <h>` /
  `STARDUST_ORIGIN_MAX_AGE_H`); `--recapture-origin` forces. Every reuse is recorded: the row's `originReused
  { from, at, policy }` and `presenceReused`, `origin.json`, `_run.log`. The published stage can also take the
  archetype round's `live.png` when its `live.json` matches gate-all's own stitch (URL, width, viewport height,
  locale, settle, built-in dismissal only) — in the documented order that capture (Phase 4) predates rollout's
  `A-inventory` start, so only under `--origin-max-age`. `--skip-existing` and a failed re-shoot keep the
  previous origin as a recorded reuse (`stale` plus a warning when it predates the run); a new origin capture
  drops the old presence inventory, and probes replay against a reused origin only when `probes.json` recorded
  it (`pair`). One policy for all of it in `diff/scripts/live-session.mjs`.
- **content-diff and visual-diff cache the live side like chrome-parity** (`--live-cache <json>`): the source
  side's inventories, or metrics and screenshots, under the same freshness rule and an exact key; the build side
  is always measured. `gate.sh --full` passes `content-live.json`, `visual-live.json` and `presence-live.json`, so
  later rounds of a run make no live navigation for those three probes. A blank or failed source render is
  measured but never cached, and retaking `live.png` drops the three caches. visual-diff answers `--help`
  without playwright installed.
- **gate-all `--one-load` (opt-in): presence, clip and unit inventories from the same settled load it stitches.**
  `stitch-shot --inventory` takes them at the top of the settled page, before the freeze; gate-all builds
  `content.json`, `clip.json` and `units.json` with the probes' own report builders, both sides on headed real
  Chrome — one navigation per side per page. A side without a usable inventory falls back to the standalone
  probes, logged and recorded (`oneLoad`); a fix round keeps only a one-load origin.
- **A machine-wide browser semaphore; origin and EDS pools have separate budgets.**
  `stardust/scripts/browser-lock.mjs` (ported from the `stardust/next` branch, attribution in its header;
  adapted: atomic slot handling — a slot file still being written counts as held, so two jobs racing for the
  last slot no longer both keep it) keeps one slot file per browser job under `~/.stardust/locks/browser/`
  (`STARDUST_BROWSER_SLOTS`, default 3, `0` = off). `run-bg.mjs` takes one slot per browser job and releases it
  when the job ends (`--lock` / `--no-lock` override); the job's children run inside it. A job waits for its slot
  queued, without a limit unless `STARDUST_BROWSER_WAIT` (seconds) is set — then exit 124, no verdict; a CLI
  holder keeps the 600 s default. gate-all's pools stay origin 2 (the source's bot budget) / EDS 4 / probe 2
  inside a slot: a slot bounds jobs, not browsers, and raising the EDS / probe pools (no bot risk) raises the
  job's Chromium peak. The master skill's write boundary names the lock dir.
- **unit-geometry's origin cache is per width** (`stardust/current/measure/<slug>-units-<w>.json`, URL in the
  key, same freshness rule): a 360 round no longer reads the 1440 origin inventory. A hit reaches the gate-all row
  (`unitsReused`) and `_run.log`.
- **gate.sh pins the capture locale and records `live.json`.** Both stitched captures run `--locale en-US`, as
  gate-all's do; a live capture writes `live.json` (URL, width, locale, settle, dismissal, capture time).

Patch: defaults unchanged except recorded same-run reuse of source captures on fix rounds (gate-all `--only`,
later `gate.sh --full` rounds) — the archetype gate's rule (one live capture per run, reused across iterations)
extended to the probes and to gate-all, bounded by the run's start line and recorded per row. Nothing else moves a
measurement: no threshold, criterion or pairing rule changes; the locale pin applies to both sides; the lock
only queues jobs (gate-all's pools unchanged); `--one-load` and cross-run reuse are opt-in; the new row and JSON
fields are additive (`originReused`, `presenceReused`, `unitsReused`, `oneLoad`, `liveCache`, `originCache`,
`pair`, `live.json`).

## 0.34.1 — replica speed instruments: measure the run, stop paying for the same evidence twice

One new instrument shows where a run's tokens go; the gate, the deploy batch and the B2 dynamics probe stop
re-measuring evidence they already hold, and skip it only while it is provably unchanged.

- **`stardust/token-ledger.mjs` (ported from the `stardust/next` branch): advisory token usage per phase and per
  recorded unit.** It reads the session transcripts and writes `stardust/usage.{md,json}`: one row per ledger phase
  and per recorded C-deliver / migrate unit (unit timestamps read as instants, any ISO offset). `usage: unknown` when
  no transcripts are reachable; exit 0 except usage errors (exit 2).
- **gate-all `--skip-existing` replays a page's probes while its capture pair is unchanged.** Content presence, clip
  and unit geometry are replayed from `<slug>/probes.json` only while both captures they were taken against are the
  ones on disk; `--recapture-eds` / `--recapture-origin` invalidate them; the row says `reused`.
- **One published gate per unchanged build.** Rows carry a `gateKey` (frozen-foundation manifest, shared and page
  blocks with what they import, the page's document and every nav, footer and fragment document, the gate's
  criteria, sidecar entries and instruments with the modules they load), issued only while the gated host serves
  that tree (every hashed code path pushed on the host's branch and repo; documents equal to their delivered
  deploy-ledger `contentSha` for that org/repo). Under `--skip-existing` a PASS row with the same key is reused
  whole, and an EDS capture only while `<slug>/gate-key.json` proves it current (the same key, or — key unknown —
  the same hashed tree, reason and ledger rows); any other EDS side is re-shot. The C-archetype unit's
  `gate-all --only` row is the archetype's published row of record;
  cluster and C-final runs pass `--skip-existing`, and C-final re-freezes the foundation after applying the queued
  requests, before the roster gate.
- **The overflow assert reads the stitched build capture's own output.** `stitch-shot.mjs` prints an
  `overflow: scrollWidth=… viewport=… delta=…` line and `gate.sh` reads it instead of launching `measure.mjs` — one
  Chromium launch and navigation fewer per gate round; the verdict lines and `GATE_OVERFLOW_TOLERANCE` are unchanged,
  and `measure.mjs` stays the diagnosis tool. `stitch-shot.mjs` answers `--help` without playwright installed.
- **No timed late-modal window on EDS build and preview hosts.** One dismissal sweep, after the EDS delayed phase has
  fired, so a consent manager the build enables is still dismissed; live source sites keep their poll.
- **deploy-batch skips a live page only when its document is byte-identical to the one it delivered to the same
  org/repo** (`contentSha`, `verifiedOn` in the ledger). A changed document, or a page last delivered to another
  org/repo, re-deploys without `--force`, which now only means re-publishing identical documents. A page verified
  within `--verify-max-age` minutes (default 60) is skipped without a request; older ones are re-verified inside the
  pool. Ledger rows written before this version re-drive once.
- **B2 reuses a fresh `_dynamics.json`** (`dynamics-detect.mjs --reuse-if-fresh`): written after the run's
  `A-inventory` start, with the same probed URLs and rollout roster and every page loaded without error; `--fresh`
  re-probes; every reuse is appended to its provenance.

Minor: one contract step is new — C-final re-freezes the foundation after applying `foundation-requests.md`, before
the C-final roster gate. No threshold, criterion or pairing rule changes; the new row fields, sidecars and ledger
fields stay additive (`gateKey`, `reused`, `probes.json`, `gate-key.json`, `contentSha`, `verifiedAt`, `verifiedOn`);
every skip is recorded where it happened.

## 0.33.1 — consent overlays are dismissed on gate captures; the archetype ledger keeps its shape

Fixes from a recorded hands-off replica run on a site with a consent manager, verified against its artifacts.

- **`replica/scripts/gate.sh` dismisses overlays on its captures the way its probes do.** The probes ran under
  `--dismiss` while the stitched live capture had no way to receive a site-specific selector: the run captured
  the live side with the consent banner and its scrim up, and the first pixel rounds measured them as page
  difference (18–50 % hot bands) until `live.png` was re-taken by hand. Both captures now run the shared
  dismissal by default, `--no-dismiss` turns it off everywhere in the round (new on `stitch-shot.mjs` as well),
  and `--consent <sel>` / `--dismiss <sel,…>` — stitch-shot's own vocabulary — reach both captures, the diff
  probes and chrome-parity; `--no-dismiss` with either is a usage error. `diff/scripts/live-session.mjs` knows
  the `cmp`-prefixed consent-manager buttons, so that manager needs no flag; its candidate list has a test.
- **`stardust/replica/progress.json` is the map of every archetype — never one archetype's record.** The
  residual-logging example in `replica/reference/source-fidelity-gate.md` showed a bare
  `{pageType, archetype, breakpoints}` object, and the run wrote exactly that as the whole file, destroying the
  `types` map, the `siblings` / `migrate` blocks `gate-evidence.mjs` writes and the `_provenance` block the resume
  and unit-boundary readers depend on. The example now shows the record inside `types.<archetype>` beside those
  blocks, with the rule that the file is extended per entry; `gate-evidence.mjs` wraps a ledger whose top level
  is one archetype's record under `types.<archetype>` (lossless, noted in its output) and refuses only a record
  that names no archetype; a ledger with a `types` map is never second-guessed; with a test; `replica/SKILL.md`
  names the keys.

## 0.33.0 — martech: the source's Web SDK is read and offered as an `aem-martech` switch, off

Field learning: a full run on a consumer-brand site on Launch + Web SDK carried the tag stack over, but
the hand-off only said "aem-martech is an owner project". It gave the owner nothing to act on. The Launch library
already held everything the plugin needs: orgId, the Web SDK instance, edge CNAME, datastreams (two, chosen
by a data element per brand domain), and a self-hostable 2.34.2 extension. It also showed 129 data-layer rules
that only fire if the new pages push the same events. None of it was read.

- **`spec-martech.mjs`** reads the Launch orgId and the Web SDK extension: version, self-hosted support, library
  type, and each instance's edge domain, `defaultConsent` and datastream ids (resolving a `%data element%` to the
  ids it holds). Rules now record their event types.
- **`vendors.json`** gains a Web SDK row (`adoberesources.net`, `alloy.js`) carrying the `aem-martech` plugin
  facts: repo, path, default edge, the source's default consent, required Launch extensions.
- **`martech-contract.json`** gains `aemMartech`, always `enabled: false`. Its config comes from that evidence.
  Ambiguous datastreams stay null, with the candidates listed. A rebuild keeps the owner's choices.
- **`martech-handoff.md`** adds a data-layer section for any tag manager: the data-layer globals to keep, Launch
  rules with their push events and a count per event, the tag managers whose rules were not parsed, and a request for
  the owner's tagging plan. `spec-martech.mjs` saves every other tag-manager library (GTM and gtag by container id,
  read from inline snippets; Tealium, Ensighten, ... by src) to `martech/tags/`; the model reads them into the
  contract's `tagNotes` in Launch's shape (rules, data elements, consent groups, each citing `from`), which survive a
  rebuild and render in the same rewrite, data-layer and consent sections, marked as read by the model. The consent
  model comes from parsed evidence only; the model's reading is listed as evidence and never changes it. A Google
  Consent Mode default (inline `gtag('consent', 'default', …)`, or a saved library that sets one) is saved to
  `martech/consent-mode.json`; inline on the pages, it makes the model `google-consent-mode`. A custom GTM data-layer name
  (`l=`) is kept. Its header adds `dynamics-check.mjs` after the scaffold re-run. It also adds a Web SDK
  section: the values found, the consent default to keep (`in` on the source, `pending` in the plugin), missing extensions, and the four switch steps.
- **`martech-scaffold.mjs`**: with `aemMartech.enabled`, it loads the CMP, then `initMartech`/`martechEager`;
  `martechLazy` runs from `loadLazy()` after `loadFooter`, as the plugin documents, so page views do not wait for
  the delayed phase; `martechDelayed` loads the Launch property through `launchUrls`. A category starts the Web SDK
  `pending` whatever the source value and grants `collect` on consent.
  The scaffold refuses missing values, a missing `plugins/martech`, or the same property also enabled as a route.
  Off, the output is unchanged byte for byte.
- **Target** is read the same way: the at.js extension (or a page-level at.js) and the Web SDK rules that render
  decisions. The contract gains `target`, off, and the hand-off a Personalization section. With `target.enabled`,
  the scaffold sets `personalization`, only on top of `aemMartech`. at.js activities stay an owner move.
- **`dynamics-check`** treats the edge host as a route: forbidden on `/`, gated with a category, and expected on
  accept once enabled.

## 0.32.1 — spec knowledge, wave 4: what a reviewing client had to guess

Wave 4 of how clients use a spec's `stardust/spec/knowledge/`. A spec viewer that lets people review the spec
inferred four facts with a model or recomputed them; the judgement now records them. All four fields are additive, so
older judgement files still build (the fields read null).

- **`open-questions.json` `default_option`:** the index of the option the default is, or null when the default mixes
  or conditions options. A reviewer sees the default as a selected option without matching prose to labels. On a
  sports-federation run, 23 of 28 defaults are one of their options. An index outside the options stops S10.
- **`blocking` is defined:** confirm the default before launch, because a different answer means rework. The work
  proceeds on the default either way; read as "work waits", it contradicted "every open question ships a default".
- **`findings.json` `chapter` and `rank`:** where a finding belongs in the spec's story (`start`, `pages`, `build`,
  `dynamic`, `risks`, `decide`) and its rank there, so a client places the agent's interpretation next to the numbers
  it explains and leads with the most important one. An unknown chapter stops S10.
- **`redirects.jsonl` `needs_entry`:** 1 on a `migration` row whose path changes beyond the `.html`, index-name and
  trailing-slash rule. On the sports-federation run, 5,287 of 12,072 migration rows need their own entry. The
  template's redirect finding counted all of them; it now counts `needs_entry=1`.
- `templates/open-questions.json` gives every generic question a `default_option`; `templates/findings.json` shows
  `chapter` and `rank`. Tests cover the four fields and the two stops.

## 0.32.0 — the header is a contract: its behaviour is recorded from the source and gated before done (#132)

Field learning: several runs shipped headers that passed every pixel and style gate while every menu was wrong. They
had boilerplate one-level click dropdowns for hover mega menus, search and cart as plain links, and a static list for
a drill-down drawer. Every visual instrument sees the header at rest, with the pointer parked and motion frozen. Deploy
told the agent to keep the stock header's interaction code and treat the prototype's menu script as a visual reference.
Nothing in the final verdict looked at the header.

- **`diff/chrome-explore.mjs`** records the header by using it, at 1440 and 390. It hovers (desktop), clicks and
  opens from the keyboard every control, and records each opened state: links, headings, crop, `aria-expanded`,
  focus, scroll lock, motion, and close paths (Escape with focus return, outside click, toggle, pointer leave). It
  descends into tabs, flyouts and drawer levels within a budget, and a hit is reported. It types into search to record
  typeahead and the URL the submit lands on, and samples the header scrolled down, up and back. Navigations are
  answered 204, so the page never leaves.
- **`diff/chrome-compare.mjs`** is the header-parity gate. It exits 2 on any of these:
  - a missing control or state (hover rebuilt as click included);
  - missing panel links or headings;
  - keyboard behaviour, `aria-expanded`, close paths or scroll lock that differ.

  The `replica` profile adds open-state crops (2 % bar, with the crop gate's texture so a font substitution is
  visible), motion (every duration within max(80 ms, 25 %)) and scroll states. `functional`, for redesign and reskin,
  checks behaviour and content.
- **Only the site owner clears a finding**, in `stardust/chrome/header-decisions.json`; an entry signed by an agent is
  ignored and reported.
- **Wiring:**
  - extract `--prep` records the contract (`stardust/chrome/header-contract.json`) and puts its summary in the prep
    summary;
  - deploy Step 6 builds the header from the contract, with the stock code as the accessibility floor and large panels
    as nav fragments;
  - deploy Step 10 and replica C0 gate the foundation on it;
  - `done-check` gains `header_parity` for migration projects (contract, a fresh comparison of the flow's profile at
    every contract width on the live host, no undecided error);
  - qa gains a `chrome` check;
  - `dynamics-plan --chrome` adds a row per control family (cart and account decide their backend, the UI ships);
  - spec S9 explores the home header and knowledge gains `header.json`, its size per width.
- **The replica eval** gains `header_contract_recorded`.

Field run (a museum network's home page, a new EDS site):
- **The contract:** at desktop, 6 click mega menus and a search overlay (14 states, 35 links); at mobile, a drawer with
  a search form and 6 accordion levels (14 states, 37 links). It took about 5 minutes for both widths.
- **The stock EDS header** with the same nav content got 37 errors. Every accordion was flattened into one open list,
  search was a link, nothing had motion, the header was 64 px instead of 201 px, and the crops differed by 62–91 %. It
  correctly passed the desktop click, keyboard and close behaviour the source shares with the boilerplate.
- **A header block built from the contract** reached 0 errors under `functional`. Under `replica`, 7 open-state crops
  remain at 2.1–3.9 %. They come from the licensed brand face replaced by a system font: an owner decision.
  `done-check` listed them as `header_parity:7` and qa reported the same.
- **The field run fixed the explorer:**
  - a `<nav>` carrying `aria-expanded` was taken for a control;
  - items scrolled out of a scroll container read as hidden;
  - icon words in `aria-label`s and transparent-font icons broke pairing;
  - POST search forms were not followed to their results URL;
  - crops took the links' parent instead of the panel box;
  - one duration per property lost a second animated element.

## 0.31.6 — spec knowledge, wave 3: what a migration still had to recover from raw files

Wave 3 of how other skills use a spec's `stardust/spec/knowledge/`. These are the facts consumers still could not
get from the committed knowledge.

- **`urls.jsonl` `blocked`:** why an `error` row was not read (`challenge`, `refused`, `network`, `archive-miss`).
  Gate 4 probes those instead of treating them as dead. On the museum field run: 61 `challenge`, 2 `network`, and
  no `error` row without a reason.
- **Search probes** carry `feature`, `path` and `param` (the source search URL). `dynamics-plan --knowledge` drafts
  `dynamic-features.generated-parity.json`: one `search-query` check per probe, with the source's expectations and
  `resultSelector` left to the curator.
- **`martech.json` `evidence`:** spec-martech's `launch.json` and `onetrust.json`, unchanged. `martech.mjs
  readEvidence` accepts a knowledge folder. On a sports-federation run (about 12,000 pages), the martech contract
  from knowledge is identical to the one from the raw folder: OneTrust, 4 routes, 58 rewrite rules.
- **`archetypes.json`** (decision P3, step 2):
  - within each template, the layout variants covering 80% of its pages are page types;
  - the larger tail folds into the template's largest type;
  - a one-page variant or template is `unique`;
  - each type has one `rep_url`, so migrate's one-archetype-per-type rule holds;
  - extract `--prep` takes its types from it, and prototype `--prep`, replica and reskin take their representative.

  Every live page is placed exactly once: 29 types for 12,072 pages; 11 for 89 on the museum run, where the
  exhibitions listing became `unique` instead of borrowing the exhibition-page archetype.
- **Rollout pages record `sourceUrl`** (from the sidecar, else `state.json` by slug; schema updated). qa
  `from-knowledge` and `seed-redirects` join coverage by it, so a renamed page still matches.
- **qa routing** checks every expected redirect: a `stardust/redirects.tsv` row absent from the live
  `/redirects.json` is `redirect-missing` (error); a different destination is `redirect-dest-differs` (warn).
  Live, a planted missing row was reported, and the real 5 rows passed.
- **Additive fields:** `knowledge.md` now states that a patch only adds fields and clients ignore the ones they do
  not know; removing or renaming a field is a minor release.

## 0.31.5 — spec knowledge seeds dynamics, qa, rollout and the archetype pickers

Wave 2b of how the other skills use a spec's `stardust/spec/knowledge/`: each consumer reads it when present and
never requires it. Reading adds no wall time.

- **dynamics** (`dynamics-plan.mjs --knowledge [dir]`): the spec's curated features become draft rows. They keep
  the axes as judged (S10 checks them against the dynamics vocabulary). Their decision is the linked open
  questions' answer, or else the default. It also works without a detector run. A `decided-out` row with no
  recorded owner answer is flagged (`triage.md`). Phase 1's search probes: a spec's `search-probes.json` already
  holds them.
- **qa** (`qa/scripts/from-knowledge.mjs`, new): writes two inputs.
  - `stardust/template-map.json`: the inventory by layout variant at served URLs, delivered pages only when
    rollout's coverage exists.
  - Allowlist entries for links the source already had broken, as authored and as served.

  On a sports-federation run (about 12,000 pages): 114 variants and 1,251 source-inherited 404s that would
  otherwise read as migration defects.
- **rollout:**
  - D2 starts `helix-query.yaml` from the spec's draft;
  - Gate 4 reads dead (`http-*`, `redirect-broken`, `loop`) and bodyless source pages from `knowledge/urls.jsonl`
    instead of probing them. An `error` row was never read (on the museum field run, 63 pages behind a bot wall),
    so it is still probed.
- **Archetypes:** prototype `--prep`, replica Phase 3 and reskin default their representative page to the spec's
  `rep_url` of the type's largest layout variant.
- **Prose:** rollout's query-index paragraph restated `dynamics/reference/listings.md` § Getting an index at all
  step by step; it now points there.
- **Field run** (10 pages of a museum site on a new EDS site, with these scripts):
  - spec's draft `helix-query.yaml`, committed unchanged, indexed all 10 pages;
  - `dynamics-plan --knowledge` added 8 spec rows to 46 detector rows, all within the dynamics vocabulary;
  - qa's sweep with the derived template map ran on every delivered page.

  It also found three bugs, fixed here:
  - **qa missed the 0.31.4 folder-index rule.** It fetched `/x` and `/x.plain.html`, but a folder index lives at
    `/x/` and `/x/index.plain.html`. The inventory now keeps each page's served `url` next to its key, and its
    slash probe checks that a folder index still answers at `/x` (the redirect spec records) instead of expecting
    a leaf's `/x/y/`, which 404s by design.
  - **`seed-redirects` wrote redirects into pages of later waves.** qa reported 5 redirects landing on 404s. With
    rollout's coverage, only redirects to delivered pages are written; re-run the seed after each wave.
  - **Gate 4 would have dropped pages a bot wall hid.** It counted outcome `error` as dead, and all 63 such rows on
    the museum site were pages behind the bot wall.

## 0.31.4 — a folder index lives at `/x/`: sitemap, probes and links follow EDS

EDS serves a folder index (`x/index.html`) at `/x/`, and `/x` 404s on a plain site (one site seen adds a 301); a leaf page lives at `/x/y`, and
`/x/y/` 404s (checked on a live origin). Stardust's rule was "never a trailing slash", which is right for leaves
and wrong for folder indexes. Three consequences:
- the rollout sitemap listed every folder index at a URL that 404s;
- `done-check`'s live probe (`HEAD`, no redirects, 200 only) counted every delivered folder index as not live;
- `localize-links` wrote folder-index links that 404, and delivery-lint flagged the correct `/x/` as a P1;
- spec could not tell a folder index from its source path, so its redirects pointed at `/x`.

- **Rollout** (`lib.mjs publicUrl`): `pages[].path` stays the key; a page whose migrated file is `…/index.html` is
  published, fetched and probed at `path/` (`assemble.mjs` sitemap, `verify.mjs`, `loadPageHTML`, `done-check`).
- **`localize-links`** writes the served URL (`eds-path.mjs deliveredUrl`): `/x/` for a folder index, `/x/y` for a
  leaf; redirect destinations resolve the same way. Matching still uses the lookup key.
- **delivery-lint** judges a trailing slash by its target, with the content tree (`--content`, default `./content`):
  - a leaf's slash stays P1;
  - a folder index's slash passes;
  - a folder index without it is a new P1, `folder-index-slash` (it 404s);
  - a target outside the tree is a P2 advisory.

  First test file for the lint.
- **Docs:** the rule ("no `.html`; a slash only on a folder index") replaces "EDS 404s on `/x/`" in deploy and
  rollout.
- **spec** (`servedUrls`): a page with pages below it is a folder index, so its `eds_path` is `/x/` and a migration
  redirect `/x` → `/x/` is recorded (a plain EDS site 404s on `/x`).
- **Field rollout** of 10 pages (4 folder indexes) on a new EDS site: every sitemap URL, `done-check` probe and
  localised link answers 200; `/x` without the slash 404s, as above.

## 0.31.3 — one delivered-path contract; spec redirects seed rollout

Five path rules disagreed on the same input: spec's `edsPath`, rollout's path-safety lint, deploy's `canonicalPath`
and its copy in `davids-model-lint`, and rollout's own delivered path. `/a/index.html` gave `/a/`, `/a/index.html`
and `/a`. Checked on live EDS sites: a folder index is served at `/a/` (`/a` 404s on a plain site, `/a/index` too), a leaf
page at `/a/b` (`/a/b/` 404s), and `.html` 404s.

- **`deploy/scripts/eds-path.mjs`** (new, pure): `deliveredUrl` (spec's rule, now also collapsing `//`), `daPath`
  (`/a/` ↔ `/a/index`) and `pathKey` (the lookup key). spec's knowledge, `localize-links` and `davids-model-lint`
  import it, so the two `canonicalPath` copies are gone. spec's Setup copies the deploy scripts too.
- **`rollout/scripts/seed-redirects.mjs`** (new): when a spec exists, Gate 3 first appends its redirects to
  `stardust/redirects.tsv`:
  - every source URL that changes on EDS;
  - the source's own redirects, pointed at the delivered page.

  Rows already there win; external targets, targets outside the knowledge and loops are counted and skipped. On a
  sports-federation run (about 12,000 pages) it seeds 12,312 rows, 241 of them existing redirects made one hop; on a
  museum run, 33.
- **Prose:** rollout's path-safety rules are written once, in `delivery-gates.md` § Gate 3; two recorded anecdotes
  in deploy's link-localisation paragraph are folded.
- **A field rollout** (10 pages of a museum site on a new EDS site) found two more:
  - `localize-links` rewrote links through any redirect, including the seeded ones to pages of later waves, so 8
    links would have 404ed. A redirect now rewrites links only to a page of the content tree; the rest stay absolute.
  - The redirects sheet never matches a source containing `:` or `%` (those requests 404 first; measured with probe
    rows), and 31 of the museum site's 33 seeded rows had one. `seed-redirects` writes those to
    `stardust/redirects-cdn.tsv`, as CDN rules.
- **Open (next release):** rollout publishes a folder index at `/a`, which 404s on a plain EDS site, and the link
  rules call a trailing slash a 404 although a folder index is served there.

## 0.31.2 — notes cleanup: two retired notes removed, dangling note citations dropped

`notes/` held two documents nothing reads at run time, and six skill docs cited notes that were never in
this repository.

- **Removed** `notes/deploy-improvements-archive.md` (the frozen deploy ledger, findings #1–#80) and
  `notes/multi-agent-distribution.md` (the 2026-09 multi-harness assessment). The `(#NN)` citations stay as
  provenance; `deploy/SKILL.md` § References now says how to read the ledger from git
  (`git show 940b8795:plugins/stardust/notes/deploy-improvements-archive.md`). The README and
  `replica/reference/handoff-contract.md` no longer point at either file.
- **Dropped citations of missing notes:** `notes/variant-convergence.md` (`prototype/SKILL.md`, the
  `composition-delta-trivial` fixture), `notes/migrate-template-canon-refactor.md`
  (`prepare-migration/SKILL.md`, `stardust/reference/artifact-map.md`,
  `stardust/reference/data-attributes.md`) and `notes/prototype-broken-by-default-detector-2026-04-29.md`
  (`prototype/SKILL.md`). The rules they backed are unchanged.

## 0.31.1 — spec knowledge, wave 1: complete redirects, the dynamics vocabulary, a scoping entry

A review of how the other skills can read `stardust/spec/knowledge/` found gaps in spec's own output, and small
readers that would fail on it.

- **Redirects** (`spec-knowledge.mjs`): a migration row for every page whose delivered path differs from its
  source path. A path that changed only by its `.html` had no row, yet EDS answers 404 on `.html` and rollout
  wants a sheet row for each. On a sports-federation run (about 12,000 pages) the rows grow from 5,287 to 12,072.
- **Feature vocabulary:** S10 checks class, disposition, reproducibility and status against the dynamics triage
  vocabulary (`TAXONOMY`, exported by `dynamics/scripts/lib.mjs`) and stops naming each value outside it. The
  field run's judgement used five values dynamics would have rejected later.
- **Router:** a flow-neutral scoping entry ("scope / estimate / plan / spec the migration of X" → `spec`, never
  stamps `flow`). "Build a migration plan" no longer routes to `replica`. A large site (1,000+ sitemap URLs, no
  spec) gets a one-line offer to scope it first; it is never run unasked. The two copies of the wrong-flow anecdote
  are folded.
- **Ledger:** spec's stages are phases (`s1-inventory` … `s10-knowledge`); spec writes its status lines.
- **`localize-links --redirects`** reads JSON Lines (`{src, target}`, spec's `knowledge/redirects.jsonl`) and the
  published sheet (`{data:[{Source, Destination}]}`). It reported 0 pairs from the first and threw on the second.
  First test file for the script.
- **`crawl.mjs --max 0`** means no cap. It silently became 25, so a `--all` crawl translated to `--max 0` kept 25
  pages.
## 0.31.0 — publish always; done is one verdict

Two contracts a hands-off run had to be told from outside the skill, because the skill left them open. Both
are now the skill's own.

- **Publish always** (contract change). The replica handoff contract said "Publish is a decision… stay
  preview-only until it is made", while rollout Phase C says publish in the loop. Which rule won depended on
  which document the agent read last, and nobody owned the decision under hands-off. Now every delivered page,
  the redirects sheet and the chrome documents go live (`PUT → preview → live`). The decision step and its
  `eds-conversion-log.md` record are gone, C0 and the cluster deploys no longer hold `--no-publish`, and the DA
  protocol's publish step is the default rather than optional. `deploy-batch.mjs --no-publish` remains for an
  explicit preview-only ask. Deploy's font-licensing hold (self-hosted proprietary faces) is unchanged.
- **`done-check.mjs`** (new, rollout). One completion verdict from the ledgers the run already writes:
  - `pages_unfinished`: coverage rows not verified.
  - `pages_failed`: failed rows, or a failed published-origin gate.
  - `pages_not_live`: delivered rows that do not answer 200 on the live host.
  - `open_p1`: the optimize gate's own count, source parity excluded.
  - `rollout_incomplete`: the last `I-dashboard` line is not an `end`.

  Exit 0 complete, 1 gaps, 2 usage. `--offline` skips the live probe, and `--json` prints
  `{ complete, gaps[], liveChecked }`. Every reader that needs "is the run done" previously re-derived it from
  the same files.
- **Replica handoff** writes `replica handoff end` only on `done-check.mjs` exit 0, and closes each gap with its
  own remedy (handoff contract § 5). A gap only the owner can close is a `blocked` line.
- **Bounded entry captures dynamics:** `extract --single --dynamics` (and `--pages … --dynamics`), because Phase 2's
  dynamic-surface gate needs the per-page reach signals that `--single` alone does not record.

## 0.30.3 — spec: knowledge files instead of a database; one rule format instead of SQL

`spec` ended at `spec.sqlite`, but no stardust skill read it. Its one client, a viewer application, loads it into
its own database, and the file carried that viewer's tables, onboarding text and HTML findings. The skill now ends
at JSON files clients read, and knows no client. **Contract change** (released as a patch): `knowledge/` replaces
`spec.sqlite`, and judgement rules replace SQL.

- **Output** (`spec/reference/knowledge.md`): `stardust/spec/judgement/` (the agent's decisions) and
  `stardust/spec/knowledge/` (computed by S10, `spec-knowledge.mjs`): urls, page blocks, blocks with variants,
  templates, variants, redirects, broken links, bad links grouped by target, features with their pages, martech,
  metadata, query indexes with a draft `helix-query.yaml`, locales, open questions, findings. Committed. Raw
  material, captures and crops stay in `stardust/.work/spec/`. On a sports-federation site (about 13,000 URLs)
  the folder is 37 MB, about 2.5 MB compressed.
- **Rule format** (`rules.mjs`, knowledge.md § Rules) for feature `reach`, question `impact` and `{{…}}` in findings:
  URL terms (`live`, `sitemap`, `block:`, `signal:`, `nested`, `verdict:`), filters with globs, `urls`, `count`,
  `sum`, keyed and `max:` lookups. A rule that cannot be computed stops S10. `sql:`, `url:` and `bvariant:` are
  retired; `block:` no longer implies the sitemap (write `sitemap block:x`). No SQL engine is left in the skill.
- **Answers** in `judgement/answers.json` replace a question's default in `knowledge/open-questions.json`; the
  default stays recorded.
- **No viewer concerns:** no viewer tables, no tour or header label, findings as plain `{ title, text, numbers }`.
- **Config** at `stardust/spec/spec.config.json`; `work` names the raw-material folder.
- **Shared instruments:** spec-martech classifies hosts with the dynamics skill's `vendorFor` (a missing table now
  fails instead of returning nothing); the index yaml follows the dynamics skeleton (description meta, image as a
  path, robots, the chrome and search excludes); Setup copies the diff and dynamics scripts, which S1, S2 and S9 need.
- **Verified** on two recorded runs. Every rule from their judgement files (150) gives its SQL value on the same
  data, apart from an empty sum (0, not null). On the 13,000-URL run, `spec-knowledge.mjs` reproduces all 25 sets
  of its `spec.sqlite`, and a database rebuilt from `knowledge/` matches it table for table (meta aside).
- **Field run** on a museum site behind bot protection (generic profile, headed tier, 300-URL sample): S1–S10 ran in
  the new layout from the Setup copies, and a client database built from its knowledge. The CDN turned the headed
  browser away after about 100 pages; the spec covers the 89 pages read, and a finding says so. It found three
  0.30.1 bugs, fixed here:
  - **Drupal names:** the generic namer took the first nameable class, so `paragraph` hid
    `paragraph--type--<name>` and every paragraph became one component. Block-style classes now win (`lib.mjs`,
    shared by parse and capture).
  - **S4 refusals:** a bot wall's 403 on a link counted as a broken link. `spec-links` records it as `blocked`, not
    a 404 (`blockedBy` moved to `lib.mjs`).
  - **S1 crawl:** the crawl kept `<link>` icons, fonts and manifests as pages (`NOT_PAGE` widened).
- **Existing projects:** move `<dir>/{inventory,fetch,parse,links,rum,martech,dynamics,media,sheets}` to
  `stardust/.work/spec/`, `judgement/page-blocks.jsonl` and `variants.json` to `.work/spec/map/`, the config into
  `stardust/spec/`, then rewrite `sql:` rules and HTML findings.

## 0.30.2 — opt-in martech: carry the source consent and tag managers over, switched off

A migration dropped the source's CMP and tag managers silently, or left an agent to re-wire them by hand
against accounts it does not own. Martech now has one contract, built only when the owner asks, from the
evidence `spec-martech.mjs` already reads (`dynamics/reference/martech.md`).

- **Evidence**: `spec-martech.mjs --urls … --out stardust/martech` runs standalone, without a spec.
- **Contract** (`dynamics-plan.mjs --martech`): `stardust/martech-contract.json` and
  `martech-handoff.md`. It holds the CMP with its id, the source consent model (`per-tag` or
  `owner-decision`), the categories from the CMP configuration, one route per tag-manager loader, and
  the Launch rules and data elements to rewrite. Every part is written disabled, and a rebuild keeps
  the owner's choices. CMP scripts and loader patterns live in `vendors.json`; detection is unchanged.
- **Runtime** (`deploy/scripts/martech-scaffold.mjs`): `scripts/martech.js` from the enabled parts. The
  CMP loads in `loadEager()`, tag managers from `delayed.js`, and a route with a `category` waits for
  that consent group. Tags load only on production hosts; on preview `?martech=on` (plus
  `&consent=accept`) turns them on.
- **Verification** (`dynamics-check.mjs`, qa `dynamics`): a `martech` check aborts cross-site requests
  after recording the host. It asserts nothing loads by default, gated routes wait for consent, and
  enabled hosts are requested after accept.

## 0.30.1 — spec: any website, a page cap, and blocked origins

`spec` parsed AEM sites only. A WordPress news site (2,061 sitemaps, about 412,000 URLs) and a Next.js site with
utility-class markup showed what a generic parser and a cap need.

- **`generic` parser profile** (`spec/reference/config.md`): below main, single-child wrappers are skipped and the
  children are components, named from a component attribute, a block-style class (`wp-block-*`,
  `elementor-widget-*`, `paragraph--type--*`), a BEM or CSS-module block, or a shape label (`section.h2.list`) where
  classes are only utilities; hash prefixes are dropped (`stripPrefix` for a site's own). One rule set
  (`lib.mjs genericRules`) runs in the parser and in the capture tagger: on 5 of 6 sampled pages the two found
  identical path ids. The AEM profiles are unchanged: a re-parse of 12,345 AEM Core pages was byte-identical.
- **One rule set per profile, one layout walk** (`lib.mjs` `profileRules`, `componentLayout`): the capture tagger
  ran a hand-written copy of the AEM rules; parse and capture now share them, so path ids cannot drift. Parse output
  byte-identical on 12,345 AEM Core pages (5,192 grid rows), 200 AEM classic pages (651 column controls) and four
  generic sites; capture path ids and rows identical on the sampled pages of each profile.
- **Main region fallback** for sites without `main`: `[role=main]`, `#main`, `#content`, `#main-content`,
  `article`, then the body without header, footer and nav.
- **Inventory**: stops when the origin redirects (two of three sampled sites were configured with the wrong host);
  crawls links from the scope root when no sitemap URL is in scope; `--max` / `maxPages` keeps an even sample per
  section and the database says so (`meta.sample_note`, `inventory_total`).
- **Template**: a path-only rule (`{ "pathSegments": 1 }`) names templates by section alone.
- **Blocked origins** (a museum site behind a bot challenge): S1 and S2 classify challenges with the diff skill's
  `live-session.mjs` (the edge signatures replica's gate uses) and stop at 10% (exit 3) with the choice for the user —
  allow-list the crawler, `--headed` (the plugin's stealth real-Chrome tier: 5 of 6 sampled pages on the first pass,
  where bundled headless Chromium got 2), or `--archive <date>` (Internet Archive raw captures, recorded per page and
  in `meta.evidence_note`). `fetch/technique.json` records the tier so later stages start in it, as extract's
  `fetchTechnique` does. Pages not read plainly are captured from the fetched HTML with live assets; a page still
  showing a challenge is an error, never a screenshot. Parse and capture agreed on every path id of the captured pages.

## 0.30.0 — new skill `spec`: the migration spec before the migration, as one documented database

Scoping a migration was rebuilt by hand per engagement: a crawl, spreadsheets of templates and redirects, a
block-reuse guess, a list of "things to ask". Two recorded runs made the method a skill. The first, on a
medical-technology corporate site (about 2,900 sitemap URLs, AEM classic components), produced the method
and the database contract. The second, on a sports-federation site (about 12,400 sitemap URLs, AEM Core
Components), ran from the skill alone. It ended with 114 layout variants, 28 blocks (7 reuse, 5 variant, 16 new),
27 dynamic features and 28 open questions, and no component left unmapped.

- **Stages S1–S10** (`spec/SKILL.md`): inventory, resumable fetch (every redirect hop recorded), parse, link
  check, optional real-user data, capture, mapping, layout variants, implementation, package.
  S1–S6 and S8 measure; S7 and S9 are judgement files under `judgement/` with a rationale per decision.
- **Two parser profiles** (`reference/config.md`): `aem-classic` (`c-*` roots, colctrl rows) and `aem-core`
  (grid members, column widths → rows; the root is the first non-`aem-` class). Lazy images
  (`data-cmp-src`, `data-src`, `picture`) count as images.
- **Template rules** cover body attribute, body class or meta, plus `pathSegments` for sites whose CMS has one
  template for every page: the second run grouped by section, then by layout variant.
- **Mapping rules engine** (`spec-map.mjs`): direct, layout, styled sections, nesting containers, carousel
  slides, row heuristics, `dropIfEmpty` / `whenKids`. Re-run until nothing is unmapped. Measured against
  the first run's hand-built mapping, 26 of 29 blocks came out identical and the variant clustering was
  identical.
- **Martech from public artefacts** (`spec-martech.mjs`): headers and CSP, vendor hosts via the dynamics
  vendor table, tag-manager rules with path conditions, DOM selectors and the hosts their custom code loads,
  data elements that read the DOM, consent geo rule sets and categories.
- **Open questions ship a default** (`templates/open-questions.json`, 24 generic ones); findings carry
  `{{SELECT …}}` for every number, so no figure is typed.
- **One output, `spec.sqlite`** (`reference/database.md`): neutral meta keys and tables, plus consumer-owned
  tables (recorded decisions, saved views) that a reload keeps. Showing it is a separate application's job:
  the skill ships no viewer, and a consumer reads the database without crawling or judging.
- **Limits recorded**: bot protection answered 403 to the dynamics detector on 28 of 44 sample pages in the
  second run (logged as a site-config item, not retried around). Content behind a role or rendered after load
  can differ from the parsed HTML; the capture tagger maps paths at DOMContentLoaded and falls back to the
  current DOM. A redirected locale tree is measured by final URL, not by the sitemap path.

## 0.29.1 — replica `--target-breakpoints`: deliver on the platform's steps, map by intent, gate the shift (#131)

A recorded replica migration of a medical-technology site (about 105 pages) moved its breakpoints to
the EDS steps 600 / 900 / 1200 after delivery. Reused boilerplate blocks already sat on those steps
while recreated blocks copied the source's (the gate rewards matching them): about 20 distinct
breakpoint values in one codebase, spotted at once in review. Moving about 250 rules was quick; the
before/after re-gate (about 105 pages × 6 widths × 2 builds) took a night against a live CDN. At 900
the pass count fell from 35 to 2, yet every failure checked was one of two intended changes (desktop
header at 900 instead of 1024, about 40 px lower content; listings in their desktop row layout).
Optional and off by default: without the flag, output, gate widths and register are unchanged.

- **Input and state** (replica `SKILL.md` § Inputs): `--target-breakpoints <list>` (mobile-first
  `min-width` steps; `--breakpoints` keeps meaning gate widths), persisted once as `DESIGN.json`
  `extensions.breakpoints.target` — the one permitted addition to the promoted spec. The content cap
  is untouched.
- **Map in Phase 2, before any CSS** (`preserve-direction.md` § 4): source switch points from the
  live stylesheets, mapped by intent (layout tier, not nearest number) into
  `stardust/replica/breakpoint-map.md`; 1px pairs collapse, `max-width` becomes `min-width`. Phase 3
  and C0 apply the map, CSS and JS alike, and never decide it. One register entry, evidenced by a
  source | before | after strip.
- **Gate** (`source-fidelity-gate.md` § Target breakpoints): widths add each target step; inside a
  shifted band a failure is tier-shift (logged against the register entry, not iterated, outside the
  cap; an `overrides.json` row at the delivery gate) or a defect (still fails). A noise check covers
  widths outside every band.
- **Lint** (`breakpoint-lint.mjs`, new): every `@media` width, `matchMedia` string and `innerWidth`
  comparison under `blocks/ templates/ styles/ scripts/` must switch at a target step, all query
  forms normalised to their switch width; skipped when no target is set. C0 wires it into
  `npm run lint` (handoff contract § Boilerplate lint), so deploy and rollout run it before delivery.
  `--inventory` lists a source's switch points for the map.
- **`crop-compare.mjs --strip <out.png> [--c <c.png>]`** writes the bands side by side — the
  register entry's image from the gate's own captures.
- **Wording:** extract's content-cap line and recreation's cap rule no longer say the target keeps
  its own two breakpoints (true of a redesign only); deploy's `--nav-height` rule follows the target
  steps when set.

## 0.29.0 — the capture freeze is capture state, never the spec: media must play (#130)

A recorded replica run shipped "poster + paused video" and static first slides across a site while
26/26 dynamics parity rows passed. Four causes, all in the skills: the gate defined truth as what the
frozen instrument sees (stitch-shot pauses every `<video>` at t=0 and clears timers), so autoplay
loops were masked as "nondeterministic media, permanent residual"; the interaction-parity rule
"implement only behaviours that fired" read the frozen sampler's silence as dead; the freeze written
as a deferral became the delivery brief verbatim; and parity's `video-plays` verified presence
("video elements present and controllable"), as did qa's rendered sweep. Contract change (a mask is
now a promise, `video-plays` passes on playback), so a minor bump.

- **Capture state is a promise** (replica `recreation-procedure.md` § Carousels, § Interaction
  parity; `source-fidelity-gate.md` § Residual logging format): every freeze or mask the gate needs
  is a `captureState[]` entry whose `restoreAtDelivery` names the live behaviour as observed
  (autoplay muted loop, rotation interval, marquee speed; `null` only when live is static too).
  Timer-driven media IS a fired behaviour — "dead" means never fired on live, never "stopped by the
  freeze". "Poster + paused" is a capture artefact, not a deliverable.
- **The list travels with the brief** (`handoff-contract.md` fan-out discipline + Phase E row;
  rollout `SKILL.md` Phase C step 1, Phase E render check): C-deliver's brief carries the
  archetype's `restoreAtDelivery` list verbatim and implements it before `done`; Phase E asserts an
  `autoplay` video ≥ ¼ visible is playing and a rotating carousel advances unpoked.
- **The observer no longer blinds itself**: `motion-observe.mjs` samples a `media` block before
  any scroll or poke — per `<video>` autoplay/loop/muted, paused and `currentTime` twice 1.5 s
  apart (playing = advancing), plus class mutations that fire with nothing touched (timer
  rotation). `motion-compare.mjs` gains the `media` class: live playing → build must play (a
  paused/poster build is MISSING), unpoked live mutations → `auto-advance` MISSING when the build
  has none; older observations without `media` still load.
- **Parity means playback**: `dynamics-check.mjs video-plays` scrolls the `<video>` to ≥ ¼ visible
  and requires `!paused` + advancing `currentTime`; `playbackHost` is now optional (native video)
  and `reducedMotionPauses` reloads under `prefers-reduced-motion` and requires paused. Pure
  `judgeVideoPlayback` is unit-tested; `patterns.md § media-as-url` and `parity-report.md` rule 1
  say presence is not a pass.
- **qa `video-not-playing`** (rendered, error): an autoplay `<video>` ≥ ¼ visible that is paused,
  not advancing, or never buffered (`readyState < 2` — the `content.da.live` 401 class) with src,
  readyState, paused and Δt as evidence; `video-probe-failed` (info) when the probe errors.
  Fixture-tested (`judgeVideos`).

## 0.28.0 — a migration keeps its design unless the ask says to redesign it (#129)

A recorded hands-off run resolved a bare "migrate" to the redesign flow (brand-faithful mode) because
the ask carried no keep-design phrase; the owner expected a like-for-like move and got the prototype's
reinterpretation — a static poster for the hero motion, a rebuilt mega-menu, pages that differed
wholesale from the source. The master skill's third routing bucket ("anything else → ask; hands-off →
redesign") was the root cause. Contract change, so a minor bump. Touches 0.23.0 (flow keys),
0.19.1 (zero-movement hand-off).

- **Routing** (master § Two migration flows): the redesign flow is selected only by an explicit
  redesign phrase ("redesign", "modernise", "refresh", "new look", …); nothing is inferred. Every
  other migration ask is `replica` with `flowSource: "default"`, no question, interactive and
  hands-off alike; the first response carries replica's "Say `switch to redesign` now" line so the
  one decision stays visible.
- **Flow keys** (state-machine.md): `flowSource` is `user-phrase | default | question`;
  `hands-off-default` is gone. `prepare-migration` Setup stamps `redesign` only on an explicit
  phrase and hands anything else to `replica`; `migrate`'s flow guard reads the same default.
- **Eval** `routing-migration-flow`: prompt 1 expects `replica` without a question and
  `flowSource: "default"`.

## 0.27.2 — the favicon miss becomes a failing check: `favicon-default` (#128)

Several recent first passes shipped the aem-boilerplate icon. The rule was already written in three
places (deploy Step 3 § Favicon, replica's C0 foundation unit, prepare-migration assets prep) and
extract had captured the icon every time; what was missing was an instrument — the QA check HEADed
`/favicon.ico` and the boilerplate's own file answered 200, so every sweep passed. Prose repeated a
fourth time would not have changed that. Touches #110–#112 (deploy favicon WARN), 0.19.1 (favicon
HEAD at the origin).

- **qa `metadata`**: resolves the icon the home page links (any `rel~=icon`, default `/favicon.ico`),
  fetches the bytes and reports `favicon-broken` (error, was warn), `favicon-default` (error: sha256
  equals the boilerplate's `favicon.ico` — the site's icon never shipped) or `favicon-mismatch`
  (warn: differs from `stardust/current/assets/favicon.<ext>` when that capture exists — a format
  conversion is legitimate). `lib.mjs fetchUrl` gains `binary: true`; `test/favicon.test.mjs`.
- **rollout foundation-first gate** runs `qa.mjs --checks metadata` against the origin and names
  `favicon-default` as the first-pass miss; **deploy Step 3 § Favicon** step 4 points at the same
  check instead of a bare HEAD.

## 0.27.1 — site search is `self`, never decided-out by a hands-off assumption (#127)

A recorded hands-off run of a 100-page medical-device site had the query index live and the plan
script drafting the header search as `index-backed` / `self`, then wrote "site search out of scope"
into its own named assumptions, let the triage table cite that as the owner's decision (`decided-out`)
and left the header form posting to the source origin's results page — the one query-index feature
dropped while its three listing siblings shipped. The start prompt had named search as a dynamic
surface to handle. Touches 0.20.0 (dynamics triage) and 0.25.1 § Index, sitemap, search.

- **A hands-off assumption is the run's, never the owner's.** It may pick an interim tier; it cannot
  set `decided-out`, which takes an owner's statement or a hard blocker. Dynamics SKILL.md Phase 3 and
  § Hands-off resolutions, triage.md § Reproducibility, the hands-off table in the stardust skill.
- **Search over the site's own pages is `self` once the index exists** and ships over the migrated
  corpus; a corpus smaller than the source's is a parity note, not a reason to exclude. The header
  form never keeps the source origin's results URL (triage.md rule 4, patterns.md § search-index-backed).
- `dynamics-plan.mjs` no longer poses "results page scope" as the decision on the search row; it
  reads `none (corpus = the migrated pages; second corpora stay out)`.
- Folded: the search ranking summary repeated in dynamics SKILL.md Phase 4 and triage.md rule 9 now
  points at patterns.md.

## 0.27.0 — archetype-first delivery: deploy and gate the archetype at the origin before its siblings render (#126)

A recorded 96-page run migrated 78 siblings from archetypes whose EDS encoding had never been gated,
then re-deployed whole families in a five-workstream fix program; its sibling pixel bar ran on local
renders whose numbers understated on every page. The flow now proves the archetype where it counts
before anything inherits from it, and gates siblings once, where it counts.

- **Order.** C-deliver gains unit `C-archetype`, one per template, between the foundation and its
  cluster: convert the gated archetype (the encoder every sibling reuses) → PUT → preview → the full
  gate row on the preview URL (`gate-all.mjs --only`, both widths) → fix rounds, cap 3 → `done`; only
  then `migrate.mjs render` for the template's siblings. Handoff contract § 1 intro and § 3 row C,
  `progress.json` kind `archetype`, replica Phase 5, rollout Phase C, migrate Phase 2, fidelity-tiers.
- **Siblings gate once, at the published origin.** § 1 row 5 (the local prototype-regime sibling pixel
  bar) is replaced by the gate row after PUT + preview; `gatesPassed` pixel gates come from the page's
  row in `gates/all-<w>/summary.json`. Row 2: the structural clone is the encoder's INPUT, never a
  gated prototype; where it flattens a composition the encoder reads the hydrated capture.
- **What a failing row means** (gate doc): one block → fix the block, re-gate every sharing page;
  content in the capture but missing → fix the encoder, re-render; a composition the archetype cannot
  express → re-prototype (new archetype when two or more pages share it, else a standalone one). Cap
  3 fix rounds per page at the published origin, then that decision — never a fourth round.
- Not in this release: a scriptable per-template encoder in the plugin (today the deploy convert step,
  proven on the archetype, plays that role); when it lands, migrate emits `content/<path>.html` directly.

## 0.26.0 — published-origin gate hardened: element-level criteria beside the pixel number (#125)

A 96-page rollout of a pharmacy retailer gated every deployed page on stitched captures and
pixel-compare; its coupon-listing page PASSED at 6.7 % / Δh 69 px while all 284 cards were broken —
a fixed-height card with `overflow: hidden`, the body ~30 px low, the description clipped mid-glyph,
the details link pushed under the primary button, the sort control on another default. The links
were in the served DOM: pure CSS geometry, which pixelmatch underweights (16.5 % over the text
boxes alone). "PASS" meant "right shapes at the right places", not "every element present and
legible". Element presence and legibility are checkable — so the gate checks them. Cross-references
#115 (chrome crop gate), #124 (content-cap row) and the run's feedback items A1–A3.

- **New `replica/scripts/gate-all.mjs` (D0)** — the all-pages published-origin gate: per deployed
  page in `state.json`, stitched captures of both sides, `pixel-compare`, then the two DOM probes
  below in the same window-free real-Chrome tier; per-page dir + `summary.{json,md}`, `runs/` for
  `--only`. **Verdict = pixel % ≤ 10 AND |Δh| ≤ 5 % of origin height AND clipped ≤ 0 (+ documented
  allowance) AND content MISSING + HIDDEN links / headings = 0** (+ required repeated units within
  4 px); the pixel-only verdict is recorded beside it — every run is calibration data. Sidecars, each
  entry documented: `masks.json`, `overrides.json` (shown beside the number, never replacing it),
  `clip-allow.json`, `presence.json`, `units.json`. Origin fallback live → previous → crawl shot
  (asymmetric, flagged); `--eds-host` gates a code branch; a union (white-padded) pixel metric was
  tried as the height guard and rejected (white gaps score as matches) — the guard is explicit.
- **New `diff/scripts/clip-probe.mjs` (D1)** — text lines and controls against every overflow-
  clipping ancestor: TEXT CLIPPED / HIDDEN, CONTROL HIDDEN / CLIPPED counted (exit 2); line-clamp,
  "read more" collapsibles (`--more-words`), scrollable containers, horizontal cuts advisory;
  collapsed menus, sr-only, hidden subtrees, off-page boxes never reported. Emits the visible text
  line boxes. Recorded page: 379; the live origin and two known-good pages: 0.
- **New `diff/scripts/content-presence.mjs` (D2)** —
  visible headings, links (visible text), buttons, images, text blocks per band (h1–h3 aligned by
  LCS) + control state (`--count-words`); MISSING / HIDDEN LINK ×n and HEADING 🔴, buttons and
  CONTROL STATE 🟠, MOVED / EXTRA / COUNT / HEADING AS TEXT 🟡; symmetric scope, chrome left to
  the crop gate unless `--chrome`, `--variable` regions as counts (HIDDEN still counts), origin
  HTTP ≥ 400 fails loud (exit 4). Recorded page: HIDDEN 284, CONTROL STATE 2.
- **New `diff/scripts/unit-geometry.mjs` (D3) + `diff/scripts/measure-live.mjs`** (library) — the shared
  settle / session / shadow-DOM measurement lifted from the project measure scripts; per-element
  Δx / Δy / Δw / Δh of the first N repeated units relative to the unit, `hidden` where clipped,
  origin cached per slug. Recorded card: body +28…+47 px, details link +28 and hidden, badge
  70×70 at (−10,−10) vs 64×64 at (−27,−30), card 260 → 238.
- **`pixel-compare.mjs --text-boxes` (D4, auxiliary)**; `textBoxPct` exported. (`--pad`, the rejected
  union metric, is not shipped.)
- **The pixel-table rule.** Every crafted prototype and every deployed page is a row:
  `gate-all --stage prototype --proto-base <url>` writes `gates/prototypes-<w>/summary.{json,md}` at the
  end of Phase 4 (reusing each archetype's cached `live.png`), the default stage writes `gates/all-<w>/`;
  `gate-evidence.mjs` reads the tables as the source of record (`--tables`; a page without a row is
  `OPEN: no table row`, `--check` names a missing table), the eval requires the prototype table, rollout
  Phase H reports both totals. `gate.sh --full` runs clip-probe on the build side in every regime,
  content-presence in the published regime, unit-geometry when `stardust/replica/units.json` declares a
  repeated-unit family for the slug (`{ family: { origin, build, n, required, pages[], templates[] } }`
  — replica recreation-procedure § Repeated-unit families); element lines fail the round and outrank a
  pixel PASS in gate-evidence the way the overflow assert does.
- **Coverage carries the verdict; the roster run is a recorded unit** (review notes on the PR).
  `update-coverage.mjs --gate <summary.json>` writes each row into `delivery.gate` and flips a failing
  page (no documented override) to `failed`; `verify.mjs` never marks a page `verified` while
  `delivery.gate.pass` is false — completion derives from one place. Handoff contract § 3: each cluster
  subagent runs `gate-all --only` over its own pages inside the fan-out; C-final's roster run is unit
  `gate-all` (recorded `running` → `done`, resumable at its boundary) followed by `--gate`. Setup probes
  the deps before installing them (a harness that resolves them leaves the code repo untouched).
- **Upstreamed feedback.** A1 `launchStealthHeaded` is WINDOW-FREE by default
  (`STARDUST_HEADED_WINDOW=1` opts in). The tier is the BEST AVAILABLE and REGISTERED: Chrome when
  installed, else bundled Chromium with a warning, and every probe records `tier` (`chrome` |
  `chromium-fallback` | `chromium`) in its evidence; gate-all's summary has a `browser` column and
  counts degraded pages. A2 Akamai's HTTP
  400 escalation is a challenge marker. A3 setup steps install `playwright pixelmatch pngjs cheerio`
  as devDependencies, never `--no-save`. `deploy-batch.mjs` appends the admin `x-error` header to
  4xx (the DA 200-images-per-document cap; protocol step 3a').
- **Docs** — gate doc § The all-pages published-origin gate; replica Phase 5 + Setup; deploy
  Step 10 item 7; rollout Phase E; diff SKILL § The published-origin probes; scripts index. **Tests**
  for the four instruments (pure parts browser-free; clip-probe end-to-end on a fixture where
  playwright resolves). Calibration on the recorded roster: pixel-only 66 PASS → full 28 PASS.
- **Open** — default tolerances (`--clip-max 0`, `--unit-tol 4`, 25 % counts), how projects declare
  repeated-unit block families, whether buttons / control state should block.

## 0.25.2 — content cap: the container sizing model is measured, persisted and gated at a derived wide width (#124)

A hands-off replica run delivered a site whose live pages centre their content in two nested caps —
a 1920 px page shell and a 1600 px content article — as an edge-to-edge build: the token was
declared (`--container-max: 1920px`) and never applied, `main > .section > div { max-width: none }`,
and BOTH pixel gates passed (1440 ≈ 1.2 %, 360 within residuals) because 1440 is narrower than
either cap — the defect was invisible by construction. Extract had recorded the shell in a bespoke
field and missed the article; the optional ≥1920 box-map spot check (#116) never ran, and pinned at
1920 it could not have seen the shell: a probe AT a cap's width reads the cap as the viewport. The
two pixel gates are unchanged (1440 and 360, no third pixel gate); one cheap geometry-only read at a
DERIVED wide width is added and made mandatory. Cross-references #13 (qa-gate's hardcoded 1600 wide
pass) and #116 (the fluid-vs-fixed spot check, now folded into the row).

- **New shared instrument `replica/scripts/cap-probe.mjs`** — extract, replica and deploy all call
  the same script. Capture: render a page at 1440, then read the same boxes at a derived width (max(2560, largest
  cap × 1.25); re-read once wider when a cap sits at ≥ probe ÷ 1.25) and at 0.9 × that width —
  resizes, not navigations; a box is capped when the two wide reads agree (a 90 % container
  scales, a max-width does not) — and list every cap ORIGIN (a capped box not merely inheriting,
  padded or auto-margined inside a capped parent) with its
  px, how it is authored (`max-width` / fixed / other), DOM tier and KIND — `shell` (outermost cap
  holding ≥ 90 % of the content root's text), `content` (a further wrapper inside it), `module`
  (one top-level section); chrome caps are not modelled. `contentMaxWidth` = the innermost
  wrapper cap, else the module cap shared by half the capped sections, else null (fluid).
  `--write-design` merges `extensions.breakpoints.{containerMaxWidth, probeWidth, shellMaxWidth,
  caps[], modules[], capRegister[]}` into DESIGN.json; several archetypes aggregate, and a cap that
  differs between archetypes or sits on a single module lands in `capRegister` for the
  inconsistency register (a cap on the shell or on every archetype is design intent, whatever its
  value; source breakpoints are never inherited). Compare (`<live> --against <build> [--design
  DESIGN.json] [--slug <s>]`): rows by KIND — `wrapper cap`, one `module i/n` per section (advisory
  while the section counts differ), `content cap` when neither side has a wrapper — never by DOM
  depth; PASS = every live cap held within ±20 px, nothing capped only on the build; a ✗ prints the
  scaffold rule to change (`main { max-width }` for a wrapper cap, the section div for a module
  cap), never a pixel target. Evidence lands in `stardust/replica/gates/<slug>-<probeWidth>/
  cap-<label>.{json,txt}` like the pixel rounds. Exit 0 / 2 FAIL / 1 / 3 bot challenge / 125 usage;
  `--probe-width` pins the width for evidence runs only. `probePage` and the pure functions are
  exported; `test/cap-probe.test.mjs` covers classification, aggregation, rows, args, the
  DESIGN.json merge and — where playwright resolves — an end-to-end fixture (nested 1920/1600/1180
  page vs a fluid and a fixed build, plus the pinned-1920 blind spot). `scripts-index.md` row added.
- **Extract records the sizing MODEL, not a number.** `extract/SKILL.md` Phase 3: run the probe
  once over the archetypes (`--write-design stardust/current/DESIGN.json`, one navigation each,
  after the census); the `extensions` note names `breakpoints`; `brand-surface.md` § Spacing marks
  `containerMaxWidth` as measured; `token-contract.md` § Sizing: the replica flow inherits
  `containerMaxWidth` and `probeWidth` as-is, the step-up rules are redesign-only.
- **Replica pass bar gains the mandatory content-cap row.** `SKILL.md` Phase 4 command + pass-bar
  bullet; `source-fidelity-gate.md` § Pass bar item 6 (the ≥1920 § Wide-viewport fluid check is
  folded into it — same-KIND pairing, re-lift upstream, no pixel iteration);
  `recreation-procedure.md` § Lift the sizing MODEL reads the measured cap model before lifting,
  encodes a wrapper cap on `main` and a module cap on the section column, and never reproduces a
  source breakpoint. `evals/replica-source-fidelity`: `both_breakpoints_gated` also requires the
  row's evidence; `task.md` names skipping it as a failure mode.
- **Deploy.** Step 3 Foundation: the section scaffold honours the captured cap at its tier
  (`main { max-width: var(--max-width); margin: 0 auto }` for a shell/content cap, the boilerplate
  section div for a module cap, with the full-bleed escape for sections `modules[]` lists fluid).
  `qa-gate.mjs --design DESIGN.json` (default `./DESIGN.json`): the wide pass runs at DESIGN.json's
  `probeWidth` instead of a hardcoded 1600, asserts the OUTER cap through the shared `probePage`
  (FAIL when the content cap does not hold within ±20 px of `containerMaxWidth`, or when the build
  caps a fluid source), then the per-block `--maxw` warnings (default now `containerMaxWidth`); no
  DESIGN.json or no probe beside the script → one ⚠ and the old behaviour. Step 10 item 5 is the
  cap row on the deployed URL; Local QA paragraph, pitfall 13 and the checklist follow;
  `handoff-contract.md` § 4 row updated.
- **Evidence (anonymised, 2026-09-24).** A commerce home page. Capture: `shell 1920px max-width
  main > div.<cms-list> (tier 1, holds 98% of the text)`, `content 1600px max-width … > article
  (tier 2)`, `contentMaxWidth: 1600px shellMaxWidth: 1920px probeWidth: 2560 consistent: yes`.
  Pinned `--probe-width 1920`: only `shell 1600px` — the 1920 shell read as the viewport and
  vanished, the reason the width is derived, never fixed. Compare live vs the deployed origin:
  `✗ wrapper cap: live 1600px (content, … > article) → build NONE: content runs 2560px wide at
  2560 (module caps only: 620px ×2, 340px ×2, 1180px ×1, …) — fix the sizing rule, not pixels —
  deploy Step 3 scaffold: main { max-width: 1600px; margin: 0 auto }` → `cap-probe: FAIL at 2560 —
  1 of 5 rows failed`. After that rule in the project's `styles.css`, served locally by the dev
  server: `✓ wrapper cap: live 1600px = build 1600px (±20)` → `cap-probe: PASS at 2560 — 0 of 5
  rows failed`; `qa-gate.mjs --design` on the same render: `✓ content cap 1600px holds at 2560
  (#124)`. Second validation, the inverse defect on another delivered replica (a financial-services
  home page, `--main` at the live section wrapper): live modules are fluid (90 % framework
  containers, `contentMaxWidth fluid`), the build caps every section at 1430 px — `✗ content cap:
  build 1430px (module caps only: 1430px ×8) but live modules are fluid — fix the sizing rule, not
  pixels: remove the module cap` → `FAIL at 2560`. Skill prose is net smaller than before (the spot
  check section, duplicated port-probe and hardening rationale were folded).

## 0.25.1 — replica run follow-ups: gates that passed a broken site, index/sitemap/search verification, capture gaps, the thumbnail cap, token files, recorded migrate units

Fixes from two recorded hands-off replica runs of one 36-page source site — one at 0.22.1, one at
0.25.0 — verified against their artifacts. The shared documents carry the same rules:
`replica/reference/handoff-contract.md` (§ 1 rows 4, 5, 9 and the acceptance paragraph; § 3 rows D,
D2, E2; § 4 rows for `measure.mjs`, `thumb.mjs`, `ledger.mjs`, the uploader, the batch driver and
the rollout writers; § 5 ledger rule and migrate units), `stardust/reference/scripts-index.md` usage
lines, `state-machine.md` `site.captureGaps`, `journal-format.md`'s heading rule and
`replica/SKILL.md`'s pass bar.

### Gates that passed a broken site

- **`replica/scripts/gate.sh`, `measure.mjs`, `gate-evidence.mjs` — horizontal overflow is a hard
  assert, not a residual.** `measure.mjs` prints a root line per width per side (scrollWidth beside
  scrollHeight and the viewport, `◄◄ OVERFLOW +<n>px`; `root`/`rootDeltas` in the JSON); `gate.sh`
  runs it on the build side every round (no live hit) and fails the round on an overflow of more than
  `GATE_OVERFLOW_TOLERANCE` px (default 4 — scrollWidth and clientWidth are integers, a correct page
  whose widest box is 360.4 px reads +1, and the qa skill's rendered sweep fails above the same 4 px;
  a real overflow is 13 px and up) whatever the pixel number says; `gate-evidence.mjs` records `FAIL: horizontal overflow` over a PASS pixel line,
  withholds `pixel-gate-<w>`, shows `/ovf+<px>` on the row and `overflowX` in the ledger. A recorded
  hands-off run delivered two pages 373 and 400 px wide at a 360 viewport and passed them as
  "logged, not iterated further (3-iteration cap reached)"; `source-fidelity-gate.md` § Iteration
  discipline names the assert no cap waives.
- **`diff/scripts/content-diff.mjs` compares attributes and icons, not text nodes only — on the
  main root AND the chrome roots.** A second in-page inventory (`placeholder`, `aria-label`,
  `title`; small images by file name, inline svg, icon-font glyphs by `::before`/`::after` content,
  css icons, empty icon boxes) and a pure differ — MISSING/EXTRA <ATTR>, MISSING ICON, ICON DIFF,
  ICON KIND, EXTRA ICON, ICON MOVED. Severity: MISSING PLACEHOLDER / ARIA-LABEL, MISSING ICON and
  ICON DIFF are 🔴 on an interactive element (input, button, link or inside one) and 🟡 elsewhere;
  MISSING TITLE is 🟡 always (a title tooltip is not read by most assistive tech and is commonly
  dropped by design); ICON MOVED, ICON KIND and every EXTRA are 🟡. Roots: `--main` takes a
  comma-separated selector list; `--chrome` (default on) adds the `header` and `footer` roots — the
  first `<header>`/`[role=banner]` and `<footer>`/`[role=contentinfo]` outside the main root(s) —
  and `--no-chrome` disables; the report has one block per root, every finding line carries its
  root (`[header]`), `--json` gains `findings[]` (with `root`) and `roots{}`; the `Findings:` line
  gate.sh and gate-evidence read and the exit codes are unchanged; playwright loads lazily so
  `--help` and the unit test need no browser. Recorded first: every delivered page lacked the
  search input's localized placeholder, a locale root carried the wrong flag, social links were
  empty boxes — and the probe read 0 🔴. Then measured on a delivered 36-page replica (5 page
  pairs): real regressions found on 4 of 5 pages — share links without aria-labels and icons,
  dropped CTA aria-labels, a dropped localized search placeholder — and two false-red sources of
  the layer's own removed: anchor-only icon pairing (7 present icons read as missing on one page —
  the build hosts an FAQ page's accordion glyphs in text-less `<button>`s anchored `button#1…#7`
  where the source anchors each to its question; leftover icons now pair by identity and document
  order, within the same nearest block first, as `ICON MOVED` 🟡) and chrome outside the default
  root (the two chrome cases the layer was written for were invisible unless the caller passed
  `--main header`). `source-fidelity-gate.md` and `handoff-contract.md` § 1 row 4 say content-diff
  covers main and chrome roots on every gate page — the recreate and C-deliver commands need no
  new flag.
- **`replica/scripts/measure.mjs` reports the rendition per `<img>`** (`naturalWidth ×
  naturalHeight`, current source file; `img.naturalWidth`/`img.file` deltas) and
  `recreation-procedure.md` § Image renditions per breakpoint records which rendition live selects
  at each gate width and authors the same `srcset`/`sizes`; a sub-3 px root-height delta with equal
  boxes is a rendition-ratio symptom, not a layout bug (recorded: 0.64 px per inline image summed to
  2.2 px and cost iterations).
- **Box model is a lifted value.** `boxSizing` joins `measure.mjs`'s default props so `--against`
  names a content-box/border-box fork per box; `recreation-procedure.md` § Box model is a lifted
  value lifts it per container, declares it per block and scopes the boilerplate reset on a replica,
  never universal (recorded: a universal `border-box` reset over content-box source grids — chrome
  −9 px, a facts row −106 px at 360 — while every prototype gated ≤ 0.1 %).
- **`replica/scripts/gate-evidence.mjs` no longer demands media-reconcile on prototype files.**
  `--content <dir>` (default `content`); without the page's delivered content file the gate reads
  `n/a: no delivered content file yet` (never OPEN) and leaves the sibling acceptance set and
  `--check`; it is required again once the file exists. `source-fidelity-gate.md` places
  media-reconcile in the delivery chain (row C). Recorded: every sibling sidecar carried
  `media-reconcile: OPEN` until C-deliver.
- **`replica/scripts/gate.sh` retries a capture that exits 1 once.** Live capture, build capture and
  the overflow probe; two exit-1 attempts end the round with exit 1 "re-queue, not a verdict"
  (3/4/124 stay final; run-bg slots unchanged at 3). Recorded: about 8 of 62 sibling gate rounds
  under parallel Chromium load ended `build capture failed (exit 1)` and were read as verdicts.

### Index, sitemap, search

- **rollout Phase D / `assemble.mjs` — the served sitemap is verified, chrome is `noindex`.** The
  assembled `site/sitemap.xml` is the EXPECTED set only (`stardust/rollout/` is in `.hlxignore`; the
  platform serves its own `/sitemap.xml` from its index of published documents). Chrome and fragment
  documents (`/nav`, `/footer`, per-locale `nav-*` / `footer-*`, locale shells that are not pages)
  carry a `Robots | noindex` metadata row at write time; new `--verify-origin <live-origin>` fetches
  the SERVED sitemap (a sitemap index followed), compares its `<loc>` paths with the coverage rows,
  prints served / assembled counts with every extra and missing path, records
  `manifest.json.servedSitemap` and exits 1 on a mismatch; the `D-site end` ledger detail names the
  SERVED count. `helix-sitemap.yaml` + `helix-query.yaml` exclude globs documented as the additive
  alternative. A recorded hands-off run reported "sitemap 36 urls" from the local file while the
  served one listed 58 (every page plus 22 chrome documents).
- **rollout Phase D2 / dynamics — a missing query index is a yaml file, not a service.** A 404 on
  `/query-index.json` means no `helix-query.yaml` in the code branch: author it (skeleton in
  `dynamics/reference/listings.md` § Getting an index at all — `og:title` title, description, image,
  lastModified; chrome and search documents excluded), push, publish live, poll no more often than
  every 5 s for at most 10 minutes; no configuration-service write is involved (a 403 there with the
  migration token is expected); the sheet-backed interim index is the fallback only when the code
  branch is not writable (triage rule 8, patterns.md). A recorded hands-off run read the 403 as "no
  index can be configured" and built the interim index.
- **dynamics search — parity is count + titles, not presence.** `patterns.md` § search-index-backed:
  title matches rank first, description and body text only while fewer than N title hits (N = the
  source's visible count, read during detect), dedupe by title + description, cap the dropdown at N.
  `dynamics-check.mjs` `search-query` gains `expectCount` / `expectTitles` (+ `titleSelector`,
  `countTolerance`) and compares result COUNT and the top-3 titles with the source's recorded
  values, failing on a count mismatch or duplicates — pure `compareSearchResults()` with a fixture
  test (`dynamics/scripts/test/dynamics-check.test.mjs`). A recorded hands-off run's typeahead
  returned 10 unbounded entries for a term the source answered with 3.
- **rollout `update-coverage.mjs --new` — pages built outside the migrated tree enter coverage,
  once.** `--new <slug> --path </path> --template <id> --origin <origin> [--title …] [--status …]`
  adds a schema-shaped row under the coverage lock (the pages schema allows no origin property: the
  origin is recorded in `source.migratedHtml` as `<origin>:<slug>`), creates or extends the template
  row, is idempotent by slug and refuses captured slugs and taken paths; `assemble.mjs`, `verify.mjs
  --all` and `optimize.mjs` include the row. `inventory.mjs` keeps such rows on a re-run (the origin
  marker identifies them; status untouched, one `Kept` report line) until the migrated tree holds a
  file for the slug or a migrated page owns the path — the page is registered once, never
  re-registered after every inventory run (`inventory.test.mjs`). A recorded hands-off run left its
  D2-built search page out of all three.

### Bookkeeping, capture, tooling

- **`ledger.mjs` start guard.** An `end` now needs an open `start` for the same skill + phase — an
  earlier `start` with no later `end`, paired in canonical forms; missing → warning, and under
  `--strict` exit 2 with nothing written and one stderr line naming the missing start command.
  `run-status.md` § Rules: the `start` line is the FIRST command of a phase, before any script runs.
  Recorded: a hands-off run wrote a phase's `start` and `end` one second apart after 109 minutes of
  work, so its supervisor saw an idle run.
- **`ledger.mjs` journal check.** On `end`, a `stardust/journal.md` beside the ledger with no `## `
  heading naming the phase (case- and separator-insensitive) gets one warning — never an exit-code
  change; an absent journal is not checked. `replica/SKILL.md` bookkeeping: every phase, extract and
  preserve-direction included, opens with the start line and closes with `end` plus a journal
  section `## <Phase name> — <what happened> (<date>)`; `journal-format.md` reconciles its `##
  <ISO-8601 timestamp> — <one-line summary>` heading with it — in a stardust phase the summary
  starts with the phase name, and `ledger.mjs` accepts either shape. Recorded: one run's journal
  began at Session 2; another's had one section for the whole run.
- **`crawl.mjs` locale-root capture gaps.** After the crawl, every captured locale root (a one- or
  two-segment path of locale codes — `/en`, `/fr-ca`, `/ca/en`) has the same-origin links on that
  page under its own path listed and the uncaptured ones written to `_crawl-log.json#captureGaps`
  (`roots[{root, slug, linked, uncaptured[]}]` + a ready `detail` string, `uncaptured first-level
  targets: ca/en 15, fr/fr 0`) with one stderr line; `extract --prep` copies `roots[]` to
  `state.json.site.captureGaps` (documented in `state-machine.md`) and carries `detail` in its `end`
  ledger line. `crawl.mjs` is now importable (playwright imported inside `main`, real-path main
  guard) and has a fixture-HTML unit test. Recorded: two runs captured `/ca/en` while 15 `/ca/en/*`
  pages existed and learned it six hours later from the rollout link audit (15 × 404, then repointed
  because 15 > the 12-page threshold).
- **`thumb.mjs --max-bytes`.** Default 150000: a thumbnail over the cap is re-encoded at a lower
  `--max-height` (the same bottom crop) until it fits; every line now ends with the final size, a
  capped one also notes `re-encoded for --max-bytes <b>`; a cap unmeetable at one row is written,
  named on stderr, exit 1. `extract/SKILL.md` Phase 2.5: a thumbnail enters the context only after
  `thumb.mjs` has written it (≤ 150 KB), or the vision check runs in a subagent returning one line
  per thumbnail. Recorded: eight thumbnails of 268–608 KB — 3.2 MB — read into one context.
- **`thumb.mjs --max-bytes` scales the width before it crops, bisects on measured size, keeps at
  least 60 % of the page.** The first hands-off run with the cap cropped 25 of 27 thumbnails to a
  median 28 % of each page (minimum 9 %) — a hero strip the vision check read as the whole page —
  and landed at ~7.5 KB under a 120 KB cap: the crop was the first lever and the byte-ratio shrink
  loop overshot by an order of magnitude (PNG size is not linear in rows). Now a thumbnail over the
  cap is re-encoded narrower first (480 → 400 → 320 → 240 px, the whole page each time), then
  shorter by bisection on the measured size, never below `--min-share` (default 60 %); still over
  at the floor, the floor thumbnail is written, named on stderr, exit 1. New `--offset <px>`
  thumbnails the rows below a crop (`<dst>` gains `-<offset>`), the stdout line names the scale and
  the kept share, and `extract/SKILL.md` Phase 2.5 has the agent read a cropped page's `--offset`
  slice too. pngjs also resolves through `NODE_PATH`.
- **`da-media-upload.mjs` and `deploy-batch.mjs` — `--token-env <NAME>` / `--token-file <path>`.**
  The token comes from the variable named by `--token-env` (default `DA_TOKEN`) or from
  `--token-file` (read once at start, trimmed; never both; a missing or empty file is a usage error
  naming the path; the uploader's dry run reads no file); the expiry, HALT and re-run lines name the
  variable or file, never the value, and the file-mode re-run command carries no `<var>=<fresh
  token>` prefix. JWT-expiry preflight and the 401 policy unchanged; `deploy/SKILL.md` token
  paragraph: both drivers take both flags. Both test suites cover both flags
  (`deploy-batch.test.mjs` + 2 checks); the uploader drops an unused import. Recorded: the hands-off
  harness provided the token as a file while the uploader read `DA_TOKEN` only.
- **rollout `optimize.mjs` — findings that mirror the source are informational.** With the extract
  capture present (`--current <captureDir>`, default `stardust/current`: `pages/<slug>.json` +
  rendered sidecar), a baseline finding whose condition the source shares — the same `<title>`
  (title-length / title-missing), no meta description on the source either, no JSON-LD on the source
  either, the same title or description shared by the same pages — is tagged `fixability:
  out-of-scope` with the evidence prefix `source parity:` and autofix unavailable (the findings
  schema has no parity property); listed in its own report section and excluded from the health
  score, the open P1/P2/P3 counts and the gate (`lib.mjs`: `isSourceParity`, `markSourceParity`,
  `sourceParityCounts`; `computeScorecard` skips them). A recorded hands-off run accepted 63 such
  findings by hand.
- **migrate renders as recorded units.** The migrate phase — plan, the render of every sibling,
  state-and-report — is bookkept in `stardust/migrate/progress.json` with the C-deliver unit
  ledger's shape (`units.<name>: {status: pending|running|done|failed, kind:
  plan|render|assets|report, templates[], pages: n, startedAt, endedAt, verdict}`): one `plan` unit,
  one `render` unit per template cluster of at most ~8 siblings (`migrate.mjs render <slug…>` takes
  the slug list), one `assets` unit when media is rehosted there, one `report` unit. Per unit: the
  progress write, then the checkpoint commit, then the next unit — a unit end is a safe resume
  point; a session resumed inside migrate runs only the units not `done`, and a `running` unit
  re-renders its slugs (the driver is idempotent). `handoff-contract.md` § 1 row 9 + § 5,
  `migrate/SKILL.md` Phase 2. Recorded: on the 0.25.0 run the whole phase — 31 siblings through five
  parallel builders — ran as ONE unit inside one session, the most expensive session of the run,
  with no resume point between the plan and the final report.

## 0.25.0 — hands-off cost and autonomy: background instruments, inspection helpers, `--help` everywhere, bookkeeping writers, the Phase 5 contract

Source: Karl Pauls' `stardust/replica-cache-perf` (13 commits, recorded hands-off replica runs of
2026-09-18 to 2026-09-22), re-sliced into thematic commits, rebased over 0.22.2–0.23.1 and
hardened after a code review and a cross-check against the `stardust/next` research branch. The
theme is one number: a hands-off session's cost is its context, re-read on every model call and
re-written whenever a step outlives the five-minute prompt cache.

### Background instruments and the prompt-cache window

- **`replica/scripts/run-bg.mjs`** (new): `start` detaches an instrument under `run-capped`
  (900 s default) behind a first-come slot cap; `wait` returns within `--max` (100 s, ceiling
  110 s — inside the shell tool's default timeout of about two minutes, which applies only to a
  call that declares none; a declared longer timeout is honoured, and a recorded run completed
  waits of 179–181 s under a declared 200 s) with one line per job plus its verdict
  lines only, exit 75 while jobs are still going; `log --grep` reads the rest from
  `stardust/.work/replica/bg/<job>.log`; `wait`/`status` with no names report the latest batch.
  Recorded: one gate batch — three parallel steps, each `sleep 5|10|15;` then two rounds —
  blocked for 15 minutes and the next call re-wrote a 513k-token context, $6.30 for one silent
  gap, while every other gap in that session stayed under 184 s at a 96 % cache-hit ratio.
  Slots default to 3 (env override: `RUN_BG_SLOTS`, else `STARDUST_BROWSER_SLOTS`, lowers it on a
  small machine or raises it on a large one): each capture is a Chromium and a `gate.sh --full`
  round holds three at its peak, yet at 3 slots a recorded hands-off fan-out still queued 84 of
  272 jobs for more than 10 s (90th percentile 78 s). Job liveness is checked against the
  wrapper's recorded process identity, never a bare PID (a recycled PID after a reboot read
  "running" forever and `clean --all` would have signalled a stranger); the wrapper is the only
  writer of its state file after spawn; `clean --all` escalates to SIGKILL on the process group.
- **`gate.sh --full` + `--help`**: the whole Phase 4 probe set in one round — after the pixel
  verdict, content-diff, visual-diff and chrome-parity run in parallel under `GATE_PROBE_TIMEOUT`
  (300 s), reports to the gate dir, one verdict line each; exit 124 on any deadline, 2 on a pixel
  fail / structural 🔴 / chrome delta, 1 when a probe errored (no verdict is never a pass). When
  the pixel step itself gave no verdict (124, 1, 3, 4) the probes are skipped. The published round
  is the same command with the preview URL and `--marker`. The stale-instrument reaper matches
  node processes only, skips `--inspect`, and sends TERM before KILL.
- **Port probe without lsof** (replica, deploy, diff cards; gate.sh): `curl -sI localhost:<port>/`
  is the probe, a HEAD of your own file the reuse check; `lsof … || echo free` printed "free"
  beside a live listener on an image without lsof.
- **Cards**: the master card's 0.22.2 wait discipline gains the harness-neutral form (run-bg,
  `wait` as the next call, never after a `sleep`, never two long instruments as parallel tool
  calls, the main agent bound like its subagents — a 338 s foreground turn cost one cache
  re-write); one shell one working directory; author large files in parts (~150 lines a write —
  two whole-document writes each re-wrote a ~200k-token context).

### Inspection helpers and the reading discipline

- **`replica/scripts/section.mjs`, `css-rules.mjs`, `json-query.mjs`, `html-slice.mjs`** (new):
  a Markdown outline or one section (multi-section `--all` capped at 20 KB); the rule blocks
  matching a selector regex with their @media condition; the shape, key union or a bounded
  filtered table of any capture JSON, `--tsv` / `--path` for values a command consumes; one
  element of a captured page, attributes stripped, scripts and inline SVG removed. Recorded: 172
  steps carried 750k characters of tool output into a 535k-token context in 77 minutes.
- **`extract/scripts/thumb.mjs`** (new): box-filtered whole-page thumbnails (`--width 480`) so
  1-px rules survive the brand-gestalt read; the one exception to "one crop per fact".
- **`replica/reference/reading-discipline.md`** (new; the replica card goes from 35 KB on the
  source branch to 31 KB): the rules in full — which helper reads
  what, instrument output only through `run-bg.mjs wait` and `log --grep`, one crop per fact,
  never a stitched page or the live/build/diff triplet, script flags from the index then
  `--help`, never the source. The replica card carries a 15-line pointer.
- **`stardust/reference/scripts-index.md`** (new) + **`evals/lint/scripts-index.mjs`**: every
  shipped script on one line, kept complete by the lint (cap 12 KB).

### `--help` on every script

- Every script under `skills/*/scripts` prints its usage header on `--help` / `-h` and exits 0
  before parsing, reading a file or opening a browser (recorded: `section-schema` navigated to
  `--help` as a URL, `style-fingerprint` crashed, `davids-model-lint` and `sanitise` read it as a
  file). Scripts that write artifacts carry a `Writes:` block. The six scripts whose playwright
  import preceded the guard import it lazily, so `--help` answers without playwright.
- **`evals/lint/script-help.mjs`** (new, chained in `lint:stardust` and the validate workflow):
  runs every script with `--help` in an empty cwd; fails on a non-zero exit, missing usage text or
  a file written; pure libraries exempt by list.
- **Main-module guards by real path**: node resolves the entry's symlinks for `import.meta.url`
  but not for `process.argv[1]`; a symlinked checkout made each CLI a silent no-op.
- **Value flags never swallow the next flag**: `--to --force`, `--name --dir` and the like are a
  usage error naming the flag in the new parsers — run-bg, ledger, state, migrate,
  da-media-upload, the inspection helpers, thumb, measure, style-census, motion-compare (a
  status of "--force" would otherwise land in state.json).
- **`impeccable-version-check.mjs --where`** prints impeccable's skill directory offline.

### Bookkeeping writers

- **`stardust/scripts/ledger.mjs`** and **`state.mjs`** (new): one conformant `status.jsonl`
  line per phase transition, the phase name normalised against each skill's table (`--strict`
  refuses an unknown one; optional `--next` / `--owner`); `state.mjs advance <slug…> --to
  <status>` follows state-machine.md (backward refused without `--force`, `--history-only` for
  the re-prototype case, the 0.23.0 `flow` keys kept in place). Recorded: one run wrote five
  archetypes' ledger lines a session later from a throwaway script.
- **`migrate/scripts/migrate.mjs`** (new): the per-page render driver — page map, URL-literal
  output path (collisions checked on the AEM-folded path too), internal-link rewrite, asset
  bundling, `<head>` composition, strict validation, `_meta.json` sidecar, idempotent skip, the
  `migrate` block of `state.json` merged not replaced; `gate` / `deviation` / `decision` /
  `variant` / `modules` for the judgments only the agent records. Refuses to render on a
  project whose `state.json` carries no `flow` (0.23.0 routing).
- **`replica/scripts/gate-evidence.mjs`** (new): derives the sibling acceptance gates from
  run-bg job evidence into `gatesPassed[]` and `progress.json`, attributing jobs by their
  arguments and taking the latest ended job per page × instrument × width. A sibling absent from
  a variance probe is OPEN, never passed on the archetype's summary; a job that hit its deadline
  or gave no verdict is OPEN; every pixel line names its regime (`[prototype regime]` on a local
  build URL, `[published regime]` otherwise); `--check` fails on a gate whose latest evidence
  regressed; writes are atomic. `content-fidelity` stays the agent's declaration.
- **`replica/scripts/foundation-freeze.mjs`** (new): `freeze` writes the sha256 manifest of the
  delivery foundation (`styles/`, `fonts/`, `head.html`, `scripts/`, header and footer blocks);
  `check` exits 1 on any drift. Symlinks recorded, not followed.
- **`rollout/scripts/inventory.mjs`**: an archetype whose sidecar leaves `template` null groups
  under its own slug; its representative is the archetype; empty `modules[]` counted.
- **`rollout/scripts/lib.mjs` `blockCounts` + `update-coverage.mjs`**: a module the agent maps to
  EDS default content (title, text, image, button — no block needed) is recorded
  `--block <id> --status converted --eds-name default-content` and is never counted pending,
  whatever its status; `blocks.mjs` re-runs keep the mapping and the dashboard snapshot uses the
  same count. A recorded hands-off run left four such rows at `status: pending`,
  `rollout.json.lastRun.blocks.pending` stayed 4 with every page live and verified, and a
  downstream completeness check read the finished run as unfinished.

### Media and delivery

- **`deploy/scripts/da-media-upload.mjs`** (new): the DA media protocol as a script — multipart
  PUT, persistent ledger (atomic), capped retries, content URLs printed, the token never;
  `--scope media/<name>` refused (a recorded run doubled the folder, 242 wrong uploads). 401
  policy from both recorded failures: a JWT past its `exp` exits 3 before any request; the first
  upload runs alone to prove the token and a burst 401 on it is retried (a valid token was
  answered 401 across a whole first burst); a 401 that persists after the token was accepted
  HALTS the batch (exit 3, ledger persisted, the same command resumes) — never a per-file FAIL
  (an expired token once left an 894-row batch failing file by file for 5.5 hours).
- **`deploy/scripts/deploy-batch.mjs`** follows the same 401 policy: a JWT past its `exp` exits 3
  before any request; a 401 on PUT, preview or live is retried like a 429; a 401 that persists
  through its retries on any page HALTS the batch — exit 3, no new page started, pages in flight
  finished, ledger persisted through the lock-safe merge, the halted page keeps its status
  (`attempts` incremented), one stderr `HALT <path> 401 after <n> attempts — refresh DA_TOKEN and
  re-run: <the same command>` line. Before, 401 was not retryable there, the page went `put-fail`
  and the batch ran on through every remaining page with exit 1 — the shape the uploader's rule
  was written against. Exit codes documented (0 / 1 failed pages / 2 usage / 3 token halt);
  `--backoff-ms` and the env test hooks `DA_SOURCE_BASE`, `AEM_ADMIN_BASE`, `DEPLOY_VERIFY_ORIGIN`
  (production defaults unchanged); contract test `deploy/scripts/test/deploy-batch.test.mjs`
  against a local fake of the three hosts.
- **`rollout/scripts/media-reconcile.mjs`**: content-host URLs are decided `hosted` against the
  media ledger (`--media-ledger`, auto-detected), never fetched anonymously; a hosted URL missing
  from the ledger fails; with no ledger at all the URLs are `unresolved` (exit 1) — never a pass.
- **Shared ledgers safe under a fan-out** (`rollout/scripts/lib.mjs` + `update-coverage.mjs`,
  `deploy/scripts/file-lock.mjs` + `da-media-upload.mjs` + `deploy-batch.mjs`): the coverage
  files, the media ledger and the batch ledger were read whole, mutated in memory and rewritten
  in place — with several cluster subagents recording at once the last writer won, and a lost
  media row then failed the media gate. Each writer now takes a cross-process lock (a lock
  directory, stale after 60 s, a 30 s bounded wait), re-reads the file on disk, merges its own
  rows over it and writes through a tmp + rename. Contract tests spawn eight concurrent
  coverage updates and a second uploader's rows.
- **`deploy/scripts/build-harness.mjs`**: folds `section-metadata` blocks as the pipeline does
  and remaps DA image URLs to captured files via `--media-ledger`.
- **`replica/scripts/measure.mjs`** and **`extract/scripts/style-census.mjs`** (new): box-by-box
  live-vs-prototype deltas for a selector list; the computed-style census over every captured
  page. Both open the live side through the diff skill's `live-session.mjs` (real-Chrome UA and
  headers, consent dismissal, bot challenge = exit 3), never a bare launch; the census runs once,
  in the background, after the crawl.
- **`replica/scripts/motion-compare.mjs`** (new, advisory): one line per behaviour between two
  motion-observe outputs plus a summary; a MISSING / EXTRA line is confirmed on the class lines,
  never a gate by itself (the sampler misses class-toggled and pseudo-element mechanics).

### Phase 5 contract and fan-out rules

- **`replica/reference/handoff-contract.md`** (new): what the Phase 5 executor needs from
  migrate, deploy and rollout — sibling-tier steps, the editability, decode and DA protocols,
  rollout phases A–I with their ledger strings, one usage line per script, bookkeeping. C-deliver
  runs as recorded units in `stardust/rollout/progress.json`: C0 foundation authored and deployed
  by one foundation subagent, gated by the main agent on the published origin, then
  `foundation-freeze.mjs freeze` + commit; C1…Cn one subagent per template cluster runs the whole
  chain — local asserts, PUT → preview, the published-origin gates — driving its own
  `deploy-batch.mjs --paths … --ledger stardust/deploy/ledger-<cluster>.json --concurrency 2`
  (the shared ledgers are lock-safe, so clusters deploy at once; a recorded 36-page hands-off run
  delivered 36/36 this way with zero 401s and its coordinator at or below 131k tokens of context)
  and reports one verdict line; the main agent only spawns, waits and records; C-final applies the
  queued `foundation-requests.md` once. A unit end is a resume point, never by itself a reason
  to end the session.
- **The foundation is a subagent's unit**: a recorded run's main agent authored, deployed, gated
  and fixed the foundation itself in C0 and grew from 107k to 337k tokens of context inside that
  one unit — more than its four cluster units together; the coordinator now gates the shell only,
  and a failing gate goes back to the foundation subagent as one message carrying the numbers.
- **Rules placed where the agent acts** (replica, rollout, deploy cards): lint and commit the
  foundation before any cluster subagent spawns, no frozen-file rename after fan-out; lint rules in
  every brief; disjoint clusters spawn concurrently; the root `/` is served by the `index`
  document and must answer 200 (a `/` redirect row only when the source root itself redirects);
  captured pages are always delivered — the ≤ 12 default is for uncaptured in-scope targets,
  which are a capture gap (crawl first) when the direction caps meant to include them and scope
  extension (repoint) otherwise, both recorded in `direction.md`; one-shot helpers live under
  `stardust/.work/<skill>/probes/`; every `url()` in a lifted CSS rule is rehosted under
  `stardust/current/assets/`.
- **Sibling pixel bar**: each sibling is gated at 1440 AND 360 before delivery through run-bg
  (eleven siblings once failed the published 360 bar at 17–27 % after inheriting a gated
  archetype); recorded as prototype-regime evidence that never replaces the published-origin
  gate.
- **source-fidelity-gate.md**: the header/footer `crop-compare.mjs` invocation is complete on
  the card, each band number named with the shipped output it comes from; the published round is
  the Phase 4 command with the preview URL.

## 0.23.1 — chrome: hover-dropdown reachability rule (deploy § 6, replica mechanism cloning) + qa `dropdown-unreachable` rendered check

Recurring chrome defect: a hover-opened desktop dropdown whose sub-list is absolutely positioned
with an offset below the hovered `<li>` closes as the pointer crosses the gap; every crop and pixel
gate passes because the resting state is identical (recorded 2026-09-19: 5/5 dropdowns unreachable
on a deployed origin; an earlier same-symptom `pointer-events: none` case in the 2026-08 harvest).

- **`deploy/SKILL.md` § 6**: "Hover dropdowns need a contiguous hover surface" — `<li>` spans the
  nav row with the sub-list at `top: 100%`, or keep the lifted geometry and bridge the gap with an
  invisible `::before` (off in the mobile query; preferred in replica mode); pre-deploy grep.
- **`replica/reference/recreation-procedure.md`** Mechanism cloning rule item 4: hover-path
  reachability is part of the state machine — verify trigger → first sub-link keeps the menu open.
- **qa `dropdown-unreachable`** (rendered, desktop 1440, error): submenus discovered generically as
  header elements that become visible on hover over a `header nav li`; the pointer walks in 2 px
  steps straight down to the first sub-link; fails if the menu closes on the way or on arrival or
  the sub-link is not under the pointer. Once per distinct header; fixture test
  `qa/scripts/test/dropdown-unreachable.test.mjs`.

## 0.23.0 — routing enforcement: the migration flow is chosen once, recorded, and guarded at every entry

Evidence base: the same 48 field sessions. 0.18.5 fixed the routing *surface* (the two-flow table,
"never mix", the never-chain descriptions) and the class survived it: on 0.21.1 a keep-design ask
("migrate … to the final fidelity") loaded `prepare-migration`; on 0.18.5 a "same design" ask adopted
a redesign-only "train the template, then compile" plan and reverted it after an hour, 45 turns and
36 M tokens; a 144-hour resume session invoked no stardust skill at all and followed memory. Earlier
in the corpus (0.18.1–0.18.2): "build a 1:1 migration plan" ran the redesign cascade for two hours
before `direct` was asked for an "exact replica" and kept going — 2,207 pages published at 24–28 %
pixel diff; a migration assessment ran the prep cascade 3.5 hours before the user asked for the
keep-design flow and the work was discarded; `migrate <url>` / `extract <url>` as first commands on
two same-design migrations led to hand-built compilers tuned by eye. Routing must be enforced at the
sub-skill entry points and on the resume path, not only described in the master skill.

- **`state.json.flow`** (`"redesign" | "replica" | "reskin"`, + `flowChosenAt`, `flowSource:
  user-phrase | question | hands-off-default`) — `reference/state-machine.md` § Flow keys: stamped
  once by whichever entry resolves the choice (master routing, `replica` / `prepare-migration` /
  `reskin` Setup, `direct`'s hand-off); changed only by an explicit `--switch-flow`, which records a
  `MODE SWITCH` in `direction.md` and marks the old flow's prototyped/migrated pages stale.
- **Master skill § Two migration flows**: keep-design phrases ("exact replica", "1:1",
  "pixel-perfect", "faithful", "same design", "keep the current design", "re-platform only", every
  axis pinned) select `replica` without a question; redesign phrases select the redesign flow;
  anything else asks the one keep-vs-redesign question (hands-off: keep-design phrase → `replica`,
  else `redesign`, recorded). Planning aids are named per flow; a redesign procedure inside a
  replica run (or the reverse) is a routing defect to refuse or flag. § Routing: a resume (new
  session, "continue", memory-driven) starts with the state report and enters the next phase through
  its skill. § Journal rule: agent-authored crawlers, compilers, importers and gates that replace a
  skill phase are **named deviations** in `direction.md`. Description now says "resume a … migration".
- **Entry guards**: `migrate`, `deploy`, `rollout` and a migration-intent `extract` refuse to start a
  migration on a project with `state.json` and no `flow` (two-flow table, hand back);
  `prepare-migration` refuses under `flow: replica` and resolves an absent flow before running;
  `replica` refuses under `flow: redesign` and stamps `replica` when absent; `reskin` stamps `reskin`.
  A bare `extract` for redesign/audit/uplift and `deploy` on hand-authored prototypes (no
  `state.json`) are unaffected.
- **`direct` Phase 1**: a zero-movement phrase (every axis pinned) is not a direction — write the
  hand-off note, stamp `flow: replica`, stop with "run replica"; hands-off does not skip this.
  intent-dimensions § 9 says the same in one line.
- **First gate carries the choice**: `prepare-migration` Phase 1 gate prints `Flow: redesign …
  switch to replica`; `replica` Phase 1 surfaces `Flow: replica … switch to redesign`. The state report
  gains a `Flow:` line and replica-flow recommendations from `progress.json` (last gate numbers per
  archetype).
- **Gated-archetype precondition** (`flow: replica`): `migrate` (sibling tier) and `rollout` Setup
  read `stardust/replica/progress.json` and block a page type whose archetype has no gate result at
  each breakpoint that is a pass or over-the-bar with every residual carrying a `cause`. Reuses the
  gate's pass/residual semantics; thresholds unchanged.
- **`evals/routing-migration-flow/`** (new): four phrasings; asserts the flow is named first, the one
  question for plain asks, `flow` recorded, `replica` invoked and `prepare-migration` never loaded for
  keep-design, `migrate` never first, no hand-built pipeline.

Deferred to the T13 progress-surface work: the enriched state report as a script (`stardust status`).

## 0.22.2 — wait discipline: the coordinator never parks the conversation past the prompt-cache window

Evidence base: the same 48 field sessions (Aug–Sep 2026, 24 projects), 20.7k main-session
requests. 1,271 requests re-wrote most of their context (649 M of 713 M cache-creation tokens);
1,222 of them followed an idle gap of ≥ 5 minutes. Classified by what preceded each: 46 % were the
agent's own blocking waits — a foreground `sleep` (median 480 s), a 5–10-minute foreground gate
sweep, crawl or publish loop, or a blocking read of an agent's output with a 10-minute timeout —
worth 325 M tokens; 33 % were the user typing after a pause; 11 % were background-task
notifications that arrived after 5 minutes. The cliff is sharp: a foreground `sleep` of ≤ 240 s
missed the cache in 10 % of cases, 271–300 s in 18 %, ≥ 301 s in 85–87 %. Nothing in the plugin
mentioned the cache window; the existing rule forbade `sleep N; kill` around instruments only.

- **Master skill, hands-off defaults**: a "Wait discipline" bullet — long steps run in the
  background with a progress/summary file; the coordinator does independent work or checks the
  file at most every 4 minutes; never a fixed `sleep` ≥ 5 minutes, never a blocking output read
  with a long timeout, never a foreground command expected to exceed ~2 minutes. Ending the turn
  is for the user's benefit, not the cache's (a notification after 5 minutes misses too), so it is
  reserved for waits over ~45 minutes or decisions the user should take. A Claude Code-marked
  note names `run_in_background` and the harness's `promptCacheTtl: "1h"` owner setting (2× write
  price instead of 1.25×; on these sessions it alone would have cut cache-side spend by ~29 %,
  the rule alone by ~18 %).
- **Mirrors**: deploy § 7 (brief/reading discipline), source-fidelity-gate § Iteration discipline
  (gate rounds over several pages run in the background, not as foreground `for` loops — 58 % of
  the recorded 5–10-minute sweeps re-wrote the prefix), rollout execution model (the batch driver's
  log and ledger are the progress file).
- No instrument, gate, threshold or verdict changes; the DA protocol's capped `until … sleep 3`
  waits (≤ 3 min) stay as they are.

## 0.22.1 — replica instruments: the pixel-compare hang fixed, deadlines, live-side caches, a path lint

Evidence base: 48 field sessions (Aug–Sep 2026, 24 projects) plus the notes those runs wrote about
themselves. `pixel-compare.mjs` was slow or timed out in 17 of 24 runs and on every plugin version
since 0.18.1; seven projects' own notes name it, four describe it sitting at 0 % CPU after printing
its verdict; agents answered with `sleep 150; kill` loops that cost one page 30 fixed minutes.
Reproduced 2026-09-18: with stdout redirected (as gate.sh and every agent pipeline run it),
`process.exit()` after the compare hung Node's platform shutdown (`Environment::Exit →
DisposePlatform → WorkerThreadsTaskRunner::Shutdown → uv_thread_join`) in roughly 1 run in 4; nine
such processes from earlier migrations were still alive on the test machine, some for six days.

- **pixel-compare.mjs**: exits by draining (`process.exitCode`) instead of `process.exit()` —
  0 hangs in 10 runs where the original hung; plus a supervised `--timeout` (default 120 s,
  exit 124 = no verdict, not a FAIL) because the compare is synchronous and cannot time itself out.
- **run-capped.mjs** (new): the deadline wrapper — macOS ships no `timeout`; kills the whole
  process group (Chromium children included), passes exit codes through, 124 on the deadline.
- **gate.sh**: every capture runs under `run-capped` (`GATE_STITCH_TIMEOUT` 300 s,
  `GATE_COMPARE_TIMEOUT` 120 s), a partial live.png is never left for reuse, and this user's
  replica instruments older than `GATE_REAP_MIN` (15) minutes are reaped before a round.
- **chrome-parity.mjs `--live-cache`, anchor.mjs `--cache`**: the live side's measurement is
  probed once per breakpoint and reused while URL, width and selectors match — the same contract
  gate.sh already had for live.png (recorded: 5½-minute chrome-parity rounds ×3 ×4 archetypes).
  anchor.mjs also warns when `--main` matched a wrapper that still contains header/footer (the
  false-structural-red class recorded on four archetypes at once).
- **evals/lint/script-paths.mjs** (new, in `npm run lint:stardust` and CI): every plugin-internal
  `skills/<skill>/scripts/…` and `skills/<skill>/reference/…` path a skill doc names must exist.
  It found two dangling references on main (a gate example pointing at the wrong skill's
  `content-diff.mjs`, a hypothetical migrator path); both fixed.
- Docs: source-fidelity-gate § Iteration discipline names the deadlines and caches; replica Phase 4
  snippet uses them; deploy § 7 and the master skill's hands-off defaults get a brief-size and
  read-by-section rule (across twelve runs deploy/SKILL.md was read whole ~20× per run, once per
  dispatched agent; in one recorded run the watchdog-killed agents carried the fattest briefs); the DA protocol's two
  `until … sleep 3` waits are capped and fail loud.

## 0.22.0 — stardust owns `stardust/`: write boundary and versioning policy

Field projects answered "what do I commit" by hand, each differently; one lost its state machine
to a bare `state.json` exclude. Now: stardust writes only to `stardust/`, the impeccable root files
and the EDS project (via deploy / rollout / dynamics); run-only files go under `stardust/.work/`.
Three leaks fixed (replica's script copies left the boilerplate `scripts/`, deploy's harness left
root `qa/`, deploy's pre-render left `samples/`). New Setup step 6 installs `stardust/.gitignore`
(everything tracked except screenshots, `current/assets/`, `replica/gates/`, `migrated/assets/`,
`rollout/qa/`, `.work/`, run residue, session state), covers `.env`, lists `stardust/` in
`.hlxignore`, asserts `state.json` is not ignored, offers LFS above 50 MB. State report gains a
`Repo:` block; artifact-map gains § Versioning; qa baselines are local.

## 0.21.1 — evals: criteria.json in the tessl `weighted_checklist` schema

`tessl plugin publish` validates every `evals/*/criteria.json` against the registry schema
(`context`, `type: "weighted_checklist"`, `checklist[{ name, max_score, description }]`); the
plugin's evals used the runner's own `{ criteria[{ id, weight, description }], total }` shape, so
0.20.0 and 0.21.0 both failed to publish. All eleven rubrics are converted (ids → `name`, weights →
`max_score`); the runner normalises either shape (`normalizeCriteria`), so scoring is unchanged.

## 0.21.0 — AI readability: the checker formula, one gate, document-first listings

Four migrations (a family-entertainment chain, a semiconductor company's replica, a UK
package-holiday retailer, a beverage brand pilot) were scored 40–58 % by Adobe's "AI Content
Visibility Checker" while every stardust gate was green. Each session reverse-engineered a
different model of the tool — served-text parity, hidden text, markdown line diff — and each spent
a round on a fix the score did not reward (inlining nav/footer into 143 documents; clipping instead
of hiding; unwrapping generated anchors). The extension's own analyzer code settles it:
**score = min(100, served words ÷ rendered-DOM words)**, landmarks stripped by default, hidden text
counted as rendered, a count ratio and not a word-set diff. Reproduced to the word on one site.

- **New reference `deploy/reference/ai-readability.md`** (on demand): the formula and its
  consequences (what JS adds to the DOM is the whole defect; hidden text, chrome and generated
  anchors are neutral; served-only text inflates; short pages suffer most), the two metrics kept
  apart (checker score vs served-text parity), a cause-class table with remediation (loop clones,
  index-fed cards, runtime fragments, definition-driven forms, generated labels), six block rules,
  chrome inlining as a documented option with its trade-off, and the gate contract.
- **New gate `deploy/scripts/ai-readability.mjs`**: exact reimplementation, both toggles, `code`
  score (fragments credited, app blocks excluded), per-block served-gap attribution, allowlist by
  block + string, JSON report, exit 1 below `--min` (98). Runs in the deploy atomic delivery
  contract on the published page, as the new `qa` check `ai-readability` (K), and in `audit`
  Phase 4.
- **Block rule (deploy, always-on, one bullet): `decorate()` adds no words to the DOM** — clones
  presentational, listings document-first, generated text only for allowlisted runtime values.
  The D12 key-facts paragraph shrinks to a one-liner that points at the reference (net always-on
  growth ≈ 0).
- **Listings contract rewritten (`dynamics/reference/listings.md`)**: document-first — one authored
  row per item with the card's text, a heading row per group, a label-list row; the block uses the
  index for non-text fields and top-up; re-runs replace their own rows. Dynamics Phase 4 and
  rollout D2 point at it.
- **Replica**: loop clones carry no text/alt/href/aria (`recreation-procedure.md`).
- **Eval `evals/ai-readability/`**: clones, document-first listing, explicit fragment decision, no
  generated text, gate reported, checker facts stated correctly.
- Not adopted, on evidence: clip-instead-of-hide rules (hidden text is neutral), inlining nav/footer
  into every document as a default (does not move the default score; two of three owners declined),
  CSS-stretched links *for the score* (kept as the accessible-name shape only).

## 0.20.0 — dynamics: the dynamic surface of a migration

Three real migrations (a US health insurer's employers section rebuilt greenfield, a UK
package-holiday site on an existing EDS library, a consumer-credit site re-platformed at
~5,900 URLs) found the same thing: a site's dynamic surface — modals, players, forms,
search, tags, APIs, client-rendered and sheet-backed content — is invisible to a
block-scoped, pixel-verified pipeline, and invisible in a way every gate certifies as
correct. This release makes it visible, forces a decision per row before import, and
proves the behaviour after delivery. Migration-bound by design: default-on in both
migration flows, never for redesign-only work.

- **New sub-skill `stardust:dynamics`** (`skills/dynamics/`): detect → classify → triage →
  implement → verify. Triage on **four axes** — class (`L S F M V T A R X I18N CR D`),
  disposition (`rebuild-native · index-backed · data-fed · embed-passthrough · client-only ·
  static-snapshot · decided-out`), reproducibility (`self · needs-credential ·
  needs-human-capture · needs-backend · needs-business-decision`), status. Only `self` ships
  autonomously; the rest is one owner decision batch. Hard rules: reconcile against the
  migrated output first, never fabricate a blank client-rendered page, never auto-wire a
  regulated-PII form, a search box implies a results page, decided-out is explicit.
- **References** (loaded on demand, not in the always-on skills): classes-and-signals,
  triage (+ the `stardust/dynamic-features.md` inventory format, which subsumes the former
  dynamic-blocks map), patterns (catalogue with contracts and three embedded example
  mechanisms — modal loader, index search, JSON post with honeypot), listings (folded from
  rollout's dynamic-listings), off-origin-data (host-keyed endpoint indirection, code-bus
  snapshots, fetch shim, per-state rendered snapshots + `Source` row, sheet sync, chrome URL
  space), forms (controls not form tags; intake by content source; regulated data),
  parity-report, locale-trees. The plugin ships **contracts and tooling, not blocks**: no
  block was reused as-is across the three cases and an existing library must be fed, not
  forked.
- **Tooling** (`skills/dynamics/scripts/`, verified end to end on a local fixture):
  `dynamics-detect.mjs` (network log by host, first-party API paths with status, POST
  bodies, forms **and form-less control groups**, the trigger → dialog → content graph,
  player ids, iframes without src, tag-manager mount divs, settings-object keys, framework,
  auth/commerce/locale, client-rendered slots and pages, listing candidates; `--from-state`
  for one page per type; `--reach` folds the crawl's per-page signals in),
  `dynamics-plan.mjs` (four-axis draft per finding, `--target-origin` **host-bound** probe of
  every recorded API path, `--migrated` reconcile against delivered output, regulated-PII
  flag), `dynamics-check.mjs` (parity replay over a closed set of check types —
  `fetch-json`, `dom-count`, `click-dialog`, `search-query`, `form-flow`, `video-plays`,
  `consent-gate`, `no-page-errors` — third-party request statuses recorded per check),
  `snapshot-api.mjs`, `snapshot-forms.mjs`, `sync-sheets.mjs`, `vendors.json` (the
  classification engine: host pattern → class + role, product names only).
- **Hooks in the existing skills, ≤15 lines each:** `extract --dynamics` (opt-in per-page
  reach signals; never set by a bare extract, `uplift` or `audit`); `prepare-migration`
  Phase 4.5 and `replica` Phase 2 run Phases 1–3 as the pre-import gate; `migrate` Phase 1
  is the safety net for the hand-run flow; `deploy` reads the inventory as brief input and
  never flattens `client-only` / modal-bearing sections into prose; `rollout` B2 verifies the
  inventory against fresh evidence, D2 implements the `self` set and batches the rest, H
  reports parity; `qa` gains the `dynamics` check (`parity-missing` / `parity-failed` /
  `parity-env-limit` / `parity-unchecked`); master routing + both flows name it.
- **Origin-scoped site auth everywhere.** `resolveSiteAuth` / `attachOriginAuth` in the shared
  live-session helper and the qa runner (`--auth-header` / `--token-env`, default
  `SITE_TOKEN`): the secret rides a route filter on the base origin only — a context-wide
  header leaked it to a video vendor's playback API, whose CORS check then produced a player
  error real users never see.
- **Learnings ledger** failure classes `dynamic-gap` / `api-dependency` now point at the
  dynamics references. Removed: `rollout/reference/dynamic-listings.md` and the 0.19.9
  `dynamic-capabilities.md` (folded into `skills/dynamics/reference/`).

## 0.19.8 — impeccable dependency: unpinned by design, with an update hint

- **Dependency declaration** moves to the documented cross-marketplace object
  form — `{ "name": "impeccable", "marketplace": "impeccable" }` — still with
  NO version range, on purpose: impeccable's design craft should always be
  the current one. (The root marketplace's `allowCrossMarketplaceDependenciesOn`
  already lists `impeccable`.)
- **New `stardust/scripts/impeccable-version-check.mjs`** — Claude Code only
  announces plugin updates through marketplace auto-update, which is off by
  default for third-party marketplaces, so a user can sit on an old
  impeccable indefinitely. Setup step 1 now runs this check once per session
  and surfaces its one line when a newer impeccable exists (installed
  version from the plugin registry or `--local <dir>`; latest from the
  upstream manifest with a 6s timeout, falling back to the cached
  marketplace catalog; `--offline`, `--json`). Advisory only: always exits 0,
  fails silently to "unknown" — the registry paths it reads are Claude Code
  implementation details, not an API.
- **Manifest drift fixed:** the adobe-skills marketplace entry and the Tessl
  manifest both still said 0.18.1 while `plugin.json` was at 0.19.7 (the
  validator warned; `plugin.json` wins at install, so users were unaffected,
  but `claude plugin tag` requires agreement). All three now read 0.19.8.

## 0.19.7 — sibling variance probe (P12)

- **New `replica/scripts/sibling-variance.mjs`** — before cloning a gated
  archetype onto its siblings, probe the template-defining computed values on
  every sibling's LIVE page and diff against the archetype: per `--probe
  name=<sel>` the match count, first match's box + computed group (background
  layers incl. gradient scrims, colour, padding, font, radius), first heading
  and image, list-style and `::before` mechanism, and the number of distinct
  style families among matches; plus the top-level section list. Defaults
  (first section, most-repeated class, `li`) when no probes are given.
  Live-session hardening as the other replica instruments. Exit 0 constant,
  2 variance found. Read-only — it never edits the clone.
  Field evidence: eight "same-template" siblings varied in hero template
  (441 vs 528px), scrim direction, bullet mechanism and terms shape — all
  found late at the pixel gate.
- **Fidelity tiers:** the sibling tier is "variance-probed" first; new
  § Sibling variance probe — every delta is budgeted as a block VARIANT class
  emitted on the sibling's content (blocks stay generic, never forked per
  page); `gatesPassed` gains `variance-probe`, `_meta.json` gains
  `variants[]`. Replica Phase 5 and migrate's A′ branch point at it.

## 0.19.6 — replica: glyph-dense chrome noise floor, evidence-gated (P6)

- **`crop-compare.mjs` reports the diff TEXTURE** — the share of differing
  pixels with ≥5 differing neighbours: thin-edge = glyph-antialiasing noise,
  thick = blocks/bands (misalignment, missing paint). Reported in text and
  `--json`; never changes the exit code.
- **Gate doc, pass bar item 5:** a glyph-dense chrome band that fails the 2%
  bar may be logged as a justified residual (`cause: "glyph-antialiasing"`)
  — never a pass — only when all three hold and are attached as artifacts:
  `chrome-parity.mjs` exit 0 for the region at 1px tolerance, crop-compare
  texture thin-edge (≤15% thick), and a text-dense region (no imagery/icons).
  Field evidence: a ~50-link footer bottomed out at ~5% with every metric
  numerically identical; a hinted licensed face vs a self-hosted webfont
  rasterise differently per glyph. The 2% bar is unchanged; residual logging
  format gains the entry shape.

## 0.19.5 — deploy: link localization as a pipeline stage (P24)

- **New `deploy/scripts/localize-links.mjs`** — dependency-free, idempotent.
  Builds the URL map from the content tree (every served path, extensionless,
  `x/index.html` → `/x`) plus `--redirects` (rollout's `stardust/redirects.tsv`
  or a JSON map), rewrites every source-host `<a href>` (with/without `www.`,
  http/https/protocol-relative) whose path resolves in the map to the
  canonical root-relative form — no `.html`, no trailing slash, query and
  fragment preserved — and normalizes root-relative internal hrefs the same
  way. Everything else stays absolute and is REPORTED (the not-yet-migrated
  boundary). `--dry-run`, `--json`, and `--check` (write nothing, exit 2 when
  localizable links remain — the pre-deploy assertion).
  Field evidence: ~500 source-domain links across ~150 pages bounced visitors
  back to the live site for pages that existed on the new origin.
- **Deploy stage:** the Deploy table and the per-page atomic delivery contract
  gain the stage (run after every generator and before every write, over the
  WHOLE tree; re-run after every wave). The ENCODE D4 bullet and
  `davids-model.md` now say what D4 is — a capture-fidelity rule for media and
  external targets — and that internal links to migrated pages are
  root-relative. Checklist item added. Rollout Phase E2 points at the stage
  instead of a hand rewrite.
- **Lint (advisory):** `davids-model-lint.mjs --source-host <host[,host]>
  [--content-root <dir>]` flags a source-host `<a href>` whose path exists in
  the content tree as 🟡 D4 LOCALIZE. Advisory by design in this release;
  promote to 🔴 after one rollout has run the stage cleanly.

## 0.19.4 — replica: chrome-parity probe (P3)

- **New `replica/scripts/chrome-parity.mjs`** — computed-style parity for
  chrome. Probes the same regions on live and build (default header +
  footer; `--region strip=<liveSel>|<buildSel>` for sticky strips), pairs
  every text-bearing element by text, and prints only the deltas: font
  family / size / weight / style / line-height / letter-spacing / transform /
  colour / background / padding / radius, element rect, the clickable box
  of links and buttons, plus an icon inventory (count, size, signature)
  paired by order; MISSING / EXTRA texts on either side. Live-side hardening
  via the shared `live-session.mjs` (UA + headers, challenge fail-loud exit
  3, overlay dismissal, `--headed`, `--locale`). Exit 0 quiet, 2 deltas.
  Field evidence: one run found what many pixel-band rounds had not
  (italic-vs-normal note, regular-vs-bold link, wrong nav link colour, 12px
  row offsets, 97×40 vs 71×32 button, six missing icons).
- **Gate doc, pass bar item 5:** styles diagnose, pixels confirm — run the
  probe BEFORE any pixel iteration on chrome and clear its deltas; iteration
  discipline gains the same rule. Replica SKILL setup copies the script and
  the Phase 4 snippet shows the call; deploy Step 10 item 4 points at it for
  the deployed-origin chrome gate. The ≥98% crop gate remains the pass bar —
  the probe is a diagnostic, not a new threshold.

## 0.19.3 — replica field harvest, part 2: row-level instruments, masks, detectors (P1, P11, P22, P16, P19, P15, P20)

Second fold of the 2026-09 same-design-migration ledger: the entries that
needed a flag or a small script. Each is additive — a new instrument, a new
flag, or a lint/gate DETECTOR; nothing changes what the pipeline emits.

- **Replica — pass bar item 5 (chrome crop gate):** chrome means every
  site-wide repeating band (header, sticky strips, footer); crops are
  element-anchored PER SIDE (fixed-y crops false-read the moment one side's
  rhythm shifts — a strip read 66% mis-anchored, 1.6% re-anchored); and
  authored-volatile regions (campaign heroes) are masked out of the number.
  `pixel-compare.mjs --mask <yA:h[@yB]>` neutralises the row band on both
  sides, removes it from the denominator and prints every mask on the
  verdict line (P1).
- **Replica — new `scripts/row-profile.mjs`:** (1) a per-column colour-class
  scan (white/dark/brand/photo run lengths at N x positions) to establish
  section boundaries from the capture instead of eyeballing crops (P11);
  (2) brand-colour landmarks — rows dominated by a saturated brand colour,
  paired live-vs-proto in order, with per-pair delta and `gapShift` naming
  the one inter-landmark gap that absorbed a vertical offset (P22). Gate doc
  § Reading the band breakdown documents both; replica SKILL setup copies it.
- **Extract — `crawl.mjs` saves the settled rendered DOM** as
  `pages/<slug>.html` (`renderedHtml` field): capture once, parse offline;
  migrate's inputs name it as the structure source for importers (P16).
- **Deploy — Step 3:** page templates that cap `main > .section > div`
  define ONE full-bleed escape at template specificity; `qa-gate.mjs
  --full-bleed a,b` warns when a listed block's section wrapper computes
  narrower than the viewport (P19).
- **Deploy — D15 lint:** inline-script text lifted as copy (`window.`,
  `try {`, `function (`) is 🔴; ALL_CAPS_TOKEN tracking lookalikes are 🟡
  advisory. Detector only — no capture-time filtering was added (P15).
- **Deploy — `block-roundtrip`:** a dead text whose words are absent from
  the decorated unit is reported as **DROPPED CONTENT** (the decoder never
  consumed that element type) rather than DEAD TEXT; Step 8 names the full
  default-content set every decorate() must consume. Detector only — no
  leftovers pass was added to the scaffold (P20).

Deferred by design: P3 (chrome-parity probe), P6 (depends on P3), P12
(sibling variance probe), P24 (link-localization stage + lint tier).

## 0.19.2 — housekeeping: no site names in the plugin

Every reference to a real customer, test or donor site — in skill text,
reference docs, script comments, the deploy IMPROVEMENTS log, the notes
folder and this changelog — is replaced by a generic sector descriptor
("a financial-services site, 8 pages", "a fashion retailer's newsletter
modal"). Numbers, dates, finding IDs and technical content are unchanged;
no script logic was touched (comment lines only, syntax-checked). Kept as
is: vendor/platform names (Akamai, Cloudflare, OneTrust, Typekit, Shopify,
DA/EDS), Adobe's own properties, fictional sample brands (Wasatch Back,
Ledgerline, Evergreen Bank, Meridian Airways), design-vocabulary brands used
as aesthetic references, and the eval suite's live crawl target.
`notes/improvement-plan-2026-08-rwe-centene.md` is renamed to
`notes/improvement-plan-2026-08-replica-deploy.md`.

## 0.19.1 — replica field harvest (2026-09), part 1: one-bullet learnings (P2, P4, P5, P7–P10, P13, P14, P17, P18, P21, P23, P25)

First fold of a 25-entry learnings ledger from a same-design migration of
a large vendor-templated site (2026-08/09, published-origin gated, ~150
pages). This part ships
only the findings that scored 3/3/3 on general / safe / small — each is a
single bullet or an edit to an existing one; no scripts, no new sections.
The remaining entries (element-anchored + masked chrome crops, a
computed-style chrome-parity probe, sibling variance probing, capture-time
code-artifact filtering, rendered-DOM capture, a bundled link-localization
stage + lint tier) follow in separate PRs.

- **Replica — recreation procedure:** authoring step 1 reconciles component
  COUNTS from the capture before authoring (vendor templates repeat whole
  widgets; a big height delta with matching section order is a duplicate,
  not a missing section) and points at the paragraph-boundary rule; canon
  chrome is re-verified against EACH new archetype's live page before page
  content is iterated, with page-level compensation flagged for canon
  back-port; no foundation `text-wrap: balance` in replica prototypes/block
  CSS; the overlay-scrim bullet now reads the full computed
  `background-image` layer list FIRST and luminance-fits only when the scrim
  is genuinely undiscoverable; the sizing-MODEL lift covers heights and
  overlaps at two or three widths with the vw encoding formula; icons and
  vectors are harvested from the live DOM (`svg.outerHTML`), never
  approximated.
- **Replica — gate:** iteration discipline gains the post-pass typography
  spot-check (a pixel pass at the wrong base metric is latent sibling
  debt; compensating spacing is the tell); the wide-viewport check samples
  heights and one intermediate width; the published-origin gate gains two
  rules — re-probe live chrome metrics at deploy time (crawl captures are
  the content source, live-now the chrome source; mask authored-volatile
  regions) and budget one anchors-driven reconcile round at the published
  origin (the harness number is provisional); the EDS transform list notes
  that authored inner blocks may flatten, so `:has()`/block-class selectors
  are verified against the delivered `.plain.html`.
- **Migrate — content preservation:** paragraph boundaries come from the
  source's block-level nodes, never from splitting captured text on
  newlines (inline elements fragment a 5-paragraph disclaimer into 16
  `<p>`s and double the section height).
- **Deploy:** favicon delivery is verified with a `HEAD` at the published
  origin; Step 3 section styles that paint several wrappers as one surface
  contain child margins with `display: flow-root` (margin collapse through
  an unpadded wrapper paints a ground-colored stripe inside a "card");
  Step 6 chrome rows never pair a fixed `height` with vertical `padding`
  under the border-box reset; the Step 7 brief bans `<br>` inside flex/grid
  containers (it becomes a sized item) and bare `> span`-style child rules
  in variant CSS (they resurrect hidden elements); Step 10 item 5 samples
  section heights at an intermediate width.

## 0.19.0 — Experience Workspace editability contract (EW1–EW10) + gate

Every text an author wrote in a DA document must be inline-editable in
Experience Workspace (da.live canvas, "quick-edit") once generated block JS
has decorated the page — and the block must look the same while it is being
edited. Field finding (an energy-company site, 2026-09-03, two rounds: 3 blocks, then 17):
over a 29-page covering sample only 841 of 1452 authored texts were
editable; every template-slotted block was 0 %. The generated blocks were
correct implementations of the skill's own guidance (value-slotting,
`text(cell)`, clone-the-anchor) — the guidance was the bug. Mechanism
verified against da.live `editor-utils.js`/`prose2aem.js` and da-nx
`quick-edit.js`/`prose.js`; deploy improvement #123. Minor bump: new gate +
new qa check.

- **Deploy:** § Target runtime documents the workspace instrumentation
  (`data-prose-index` on outermost editables, `decorate()` re-runs over it,
  only surviving indices become editors). § 2b redefines template-slotted as
  **node-slotting** and bans value-slotting. § 3 ships three edit-mode
  foundation snippets (CTA repaint from `<strong>/<em>` marks under
  `.prosemirror-editor`, card-as-link inner anchor, `:where()` wrapper
  variants at equal specificity) + EW10 for section prose. § 5 Buttons,
  #55, #62/#71, #70 and § Section heads rewritten to MOVE authored elements.
  § 8 gets a move-based scaffold (`wrapNode`, `labelWrap`,
  `stripInstrumentation`) and the named **Experience Workspace editability
  contract (EW1–EW10)** with the gate command; Step-7 brief carries the
  contract; Local QA + Checklist gain the EW gate, edit-mode simulation,
  static review and pixel-parity lines; anti-patterns 18 (value-slotting)
  and 19 (class on the authored element); References cite the da.live/da-nx
  sources.
- **Scripts:** new `deploy/scripts/ew-editability-probe.mjs` (URL and
  `--content` harness modes, `--simulate-editor` drift report, `@ew-exempt`
  JSDoc tags); `block-roundtrip.mjs --ew` (default on) fails dead
  non-exempt texts and duplicated indices 🔴; `render-harness.mjs --ew
  --simulate-editor` + hides `body > header`; `section-schema.mjs` emits
  `editableTexts` per section; `content-inventory.mjs` exports the
  outermost-editable classifier and `content-diff` reports an
  `EDITABLE COUNT` advisory.
- **qa:** new `editability` check (`editability/dead-text` error,
  `editability/duplicated-index` warn, per-page summary; `--blocks-dir` /
  `--ew-exempt` for exemptions).
- **replica / rollout / reskin / migrate fidelity-tiers:** every block-authoring
  handoff cites the contract and the EW gate (the brief skipped it on 27/27
  blocks because it did not carry it).
- **Evals:** new `ew-editability` (node-slotting, move-not-rebuild,
  wrapper-descendant selectors, gate evidence, fidelity not traded).
- **Ledger:** deploy `IMPROVEMENTS.md` #123; master `reference/learnings.md`
  example entry.

## 0.18.5 — migration-flow routing: replica subsumes prepare-migration

Routing-surface fix, no pipeline behaviour change. Field finding
(an air-cargo site, 2026-09-03): asked "how do I migrate X to EDS with
stardust", the agent correctly proposed `replica` for the keep-the-design
route but could not say whether `prepare-migration` was also needed — the
subsumption fact lived only in `replica/SKILL.md`'s Phase 1–5 body, which
is never in context until replica is already invoked, and `replica` was
absent from the master skill's routing table altogether. One clarification
round-trip per migration conversation.

- **Master skill:** routing table gains the missing `replica` and `reskin`
  rows and marks `prepare-migration` as redesign-flow only. New § Two
  migration flows — pick one, never mix: redesign
  (`prepare-migration` → `migrate` → `deploy`/`rollout`) vs. keep-design
  (`replica` → `migrate` → `deploy`/`rollout`, where replica runs
  `extract --prep`, a mechanical direction-preservation step, and gated
  archetype recreation in place of the prep cascade), plus `reskin` for
  donor-design/same-content. Instructs stating the chosen flow — and that
  replica needs no separate prep — in the first response.
- **prepare-migration description:** "Redesign-flow only — for same-design
  migrations `stardust:replica` runs its own preserve-mode prep cascade;
  never chain prepare-migration with replica."
- **replica description:** "subsumes the `stardust:prepare-migration` prep
  cascade in preserve mode — no separate prep step; never chain the two."

Descriptions are the always-loaded routing surface, so the disambiguation
now holds even when only the sub-skill frontmatter is in context.

## 0.18.4 — commerce-site field harvest: chrome crop gate, sizing-model lifts, EDS authoring traps

Harvest of three learnings ledgers from a five-design Magento-PageBuilder →
EDS migration (two sibling commerce sites, be/nl + nl, 2026-08, published-origin
gated). The headline failure class: **small-area, high-salience defects that
pass the full-page bar** — both pilot runs shipped "green" pages whose
header/footer measured only 93–97% match, and a frozen `width:720px` lifted
from an authored `width:50%` passed both gate breakpoints byte-identically.
All changes are site-agnostic; deploy improvements #115–#122.

- **Replica:** new `scripts/crop-compare.mjs` (per-y-band pixelmatch,
  per-side offsets, default bar 2%); the pass bar gains item 5 — header AND
  footer bands each ≥98% over the same stitched captures, no extra live hit
  (#115). New § Wide-viewport fluid check: a ≥1920 box-map spot check
  catches fluid-vs-fixed width freezes both standard breakpoints render
  identically (#116). Recreation procedure gains § Lift the sizing MODEL,
  not the resolved value (two-width lift diff; encode the authored
  `%`/`vw`/max-width rule, never the resolved px; layout models, not
  wrap outcomes). Iteration discipline gains geometry-fix verification
  hygiene — rule-bearing element, cache-free serving check
  (`curl --compressed | grep`), back-computed reviewer viewport (#117).
- **Deploy:** ENCODE contract — never author `<hr>` (it is the section
  delimiter; fractures the section at ingestion — lint 🔴, rule `HR`,
  #119); rehost assets only from the CAPTURED src and diff
  dimensions/bytes after fetch (commerce CDNs answer 200 with a generic
  fallback for guessed paths, #118). Step 3 — one section-metadata `style`
  value per section (multi-value delivered only the first class; anchor a
  second axis with content-scoped `:has()`, #120); empty-section
  `display` overrides must scope to `[data-section-status='loaded']` or
  they defeat pre-load hiding (measured 0.75 CLS, #121). Step 10 gains the
  chrome crop gate, the ≥1920 box check, and the verification-hygiene
  items. The deployed computed-style guard also asserts `clientWidth > 0`
  per visible loaded image — loaded ≠ rendered; circular flex sizing
  collapses an image to 0×0 with `naturalWidth` still > 0 (#122).
  `sanitise.js` now refuses >2 arguments: the two-arg <input> <output>
  convention made a 3-file batch silently overwrite the second file with
  the first's content.
- **QA:** new `zero-size-image` check (warn) — loaded image renders 0px
  wide while participating in layout (`getClientRects()` guards against
  display:none false-flags).
- **Reskin:** Image-paint gate documents the same loaded-≠-rendered blind
  spot (paint asserts `naturalWidth`, not rendered area).

## 0.18.3 — dual-session field harvest: consent fallback, gate identity assertion, capture-freeze hardening

Harvest of two independent replica+deploy sessions (an energy-company site and a healthcare-insurer site,
2026-08-26/27, on 0.18.2). Three failures recurred in BOTH sessions and lead
the release: a stale cross-project `:8791` server silently gated a foreign
site (once in each direction — every skill doc suggests the same port, so
collision on a shared machine is guaranteed); consent widgets missed by the
selector list (on the healthcare-insurer site the banner baked into ground truth AND all 7 stitch
seams → 32% false pixel diff, one gate round invalidated); and live-data
embeds (mirroring the SAME src cancels the data out in the pixel diff —
freezing a snapshot guarantees a widget-sized residual). All changes are
site-agnostic and additive; the high-impact-but-not-low-risk items
(shared-classifier element-boundary separators, stitch-shot `--fullpage`,
per-project default ports) are deliberately deferred with rationale in
`notes/improvement-plan-2026-08-replica-deploy.md`.

- **Extract:** `crawl.mjs` consent dismissal gains a visible-button
  text-match fallback — exact short labels (Accept / Accept all / Allow all /
  Agree / OK / Decline / Alle akzeptieren / Accepter), overlay-container
  scoped, runs ONLY when the selector pass matched nothing, so existing
  selectors keep priority and an in-content link can never match. Favicon is
  now captured on the ENTRY page in every mode (bounded `--pages` extracts
  skip Phase 3 where favicon capture lived; deploy then skipped silently and
  shipped the default icon) via an in-page fetch that inherits the context's
  fingerprint. Bot-wall note: page-level walls usually do NOT gate assets —
  probe one asset with a browser-UA curl before building in-page-fetch
  machinery.
- **Replica scripts:** `gate.sh` asserts build-side identity BEFORE any
  capture — the fetched page must contain a marker (default: the `<slug>`;
  `--marker` overrides), exit 4 names the port listener via `lsof`; the
  documented default port is unchanged (the assertion makes collisions loud
  at near-zero cost). `stitch-shot.mjs`'s freeze now also pauses every
  `<video>` at t=0, clears all pending JS timers, and clicks the first
  slick-convention carousel dot — CSS-only freezing stopped neither video
  playback (~20% of one page was video noise) nor slick autoplay (slide
  identity arbitrary per capture; residual 4% → 0.8% once reset). Symmetric
  on both sides; a static page's capture is byte-identical to 0.18.2's.
- **Replica motion parity (observe, don't infer):** new
  `motion-observe.mjs` (sibling of stitch-shot, same live-session
  hardening, exit 3 on challenge) records what the live page actually
  DOES — animationstart/transitionstart events with element paths + text
  snippets, class mutations exposing the trigger mechanism, a down+up
  header-state timeline (dense near the top), `--click` widget frames,
  `--hover` computed-style diffs with the changed-property list
  precomputed. The interaction-parity pass is now a REQUIRED gate output
  per archetype — a motion inventory in `progress.json`
  (`motion: {observed, implemented, dead[]}`; live-classed-but-dead
  behaviors recorded as NOT implemented, the correct replica of a dead
  class) — because when optional it was skipped on 5 of 7 archetypes and
  every skipped one shipped visibly static. § Interaction parity is
  rewritten around the evidence rule: implement ONLY behaviors that
  measurably fired — static lifting invented motion three field-recorded
  ways (dead animation classes: 2 of 8 classed caption families ever
  fired; hover rules whose scope never matches at runtime; approximated
  chrome mechanisms allowing states impossible on live, e.g. a
  double-rendered header) — with static CSS remaining the authority for
  the exact keyframe/easing VALUES of fired animations, mechanisms cloned
  as the observed state machine, and a two-direction verification
  (pixel-compare must return to the gated number — field: 1.01% gated →
  1.06% with invented motion → 1.01% exact after the evidence-only
  rewrite — plus a behavior-match assertion off the observe JSON). Full
  spec: `notes/replica-motion-parity.md`.
- **Replica docs:** two new permanent-residual classes in the capture-state
  policy (live-data embeds — load the SAME embed same-src on both sides;
  randomized decorative elements — log, don't chase); AEM-classic richtext
  byte patterns are load-bearing (mirror them; diff `innerHTML` when a
  wrap-count mismatch survives width parity); `display: flow-root`
  reproduces clearfix margin containment (fixed −48/−20px per-section errors
  in one rule); iteration discipline gains the no-op-fix check (an unchanged
  differing-pixel count means the rule never applied — the round doesn't
  count); a "verify the port is yours" line wherever `:8791` is suggested
  (also in deploy Step 10 and the diff SKILL).
- **Deploy:** Step 3's reset now REQUIRES the global `border-box` the
  boilerplate doesn't ship — a bootstrap-era %-width+padding grid silently
  wrapped every column, +1731px doc height, all text gates green (#106);
  block DOM must not emit semantic `<header>` (the stock reservation clamps
  every one at once, #107); overlay chrome documented as the no-reservation
  #81 case (`--nav-height: 0` + absolute header, measured CLS 0.0004, #108);
  the block brief requires mobile overrides at the variant's own specificity
  (#109), `flow-root` on un-floating overrides (#113), and wrapper resets at
  lower specificity than the block's own rules (#114); never copy the
  pipeline's fallback `<img src>` (750px rendition) into a CSS background —
  rewrite `width=2000` (#110); `line-height: 0` on image paragraphs cancels
  the `<picture>` wrapper's baseline descender (#111); whitespace-only
  authored content is dropped by the pipeline — model live spacer line boxes
  as block CSS (#112); the no-favicon path is a loud WARN recorded in the
  deploy log, never a silent skip.

## 0.18.2 — replica field harvest: font-fork instrument fix, interaction parity, published-origin gate

Harvest of a full `stardust:replica` e2e run (a financial-services site → EDS,
2026-08-25/26, on 0.18.1): a home-page archetype gated to 3.55%/5.56% pixel
diff, then 8 pages published and gated against the live origin. All changes
are site-agnostic; the validated discipline (measure-first, fail-loud,
≤10% / Δ≤8px / 0-structural-red, hit minimization, no DOM copying) is
unchanged.

- **Instrument fix (diff `live-session.mjs`, F-B2):** the standard
  anti-bot header set now rides DOCUMENT requests only (via
  `context.route`), never subresources. Forced on every request it made
  cross-origin CORS-mode webfont fetches non-simple — they died with
  `net::ERR_FAILED` and every live capture silently rendered fallback type,
  poisoning the whole gate (live doc height moved 6669→6518 after the fix).
  Bot managers fingerprint the navigation request, which still carries the
  full set. Companion hardening: stitch-shot asserts fonts loaded after
  `document.fonts.ready` and warns loudly on any declared face with
  FontFace status `error` (gate doc rule 14 owns the instrument-induced vs
  capture-state decision).
- **Replica scripts:** new `anchor.mjs` (per-section `[y, height]` probe —
  run on both sides, fix the first mismatched section top-down; roughly
  halved iterations vs band-reading alone in the field) and `gate.sh` (one
  pixel round in one command, live capture cached, fail-loud on exit 3).
- **Replica gate doc:** new § The published-origin gate — only the
  published number counts for platform-delivered pages, with the three
  recurring EDS pipeline deltas (`<p><picture>` wrapping, empty
  metadata-section padding, `/media_<hash>` rewrites); calibration honesty
  (prototype-regime vs published-origin-regime numbers, same ≤10% bar);
  probe schedule per fix round (pixels every round, content/visual at
  milestones — content/visual re-runs cost 2 live hits each); iteration-cap
  bookkeeping (instrument-invalidated runs excluded once the defect is
  fixed and named; build-side-only probe passes are free); the script-edit
  rule narrowed (re-implementing retired adaptations stays a defect; a
  commented, ledgered, flagged-for-upstream instrument-bug fix is the
  correct move — fail-loud outranks script immutability).
- **Recreation procedure:** CSS lifting gains the text-rendering group
  (`text-rendering`, `-webkit-font-smoothing`, `font-synthesis`,
  `font-variant-numeric`, `font-kerning`) + the literal-string width
  diagnostic; new § Interaction parity (hover-diff and behavior-diff probe
  patterns, Swiper-lock semantics and the scroll-based replica that
  auto-degrades to the static case); new § Wrap-junction margins
  (collapsing-margin trap on cards-on-a-canvas sites); capture-state policy
  gains nondeterministic live elements (tickers, dates, counts — freeze a
  captured value, log as permanent residual); granularity parity states the
  widget policy: widgets are implemented, not justified away.
- **Replica SKILL:** archetype prototypes are per-archetype and CUMULATIVE
  (shared canon CSS + per-archetype CSS; never skip to direct platform
  authoring — prototyped archetypes held 3.5%/5.6% while direct-authored
  pages plateaued at 8–16%); Phase 5's final proof is now the mandatory
  published-origin gate.
- **Deploy:** preview `409 "error from content-bus"` gets a two-step
  fail-loud diagnosis (known-good doc to the same path, then a per-image
  sweep for SVGs over the ~40KB hard pipeline limit — rasterize to PNG);
  #99 extended accordingly.
- **Migrate:** sibling content-fidelity is now measured per page at import
  time — a role-classified node-count acceptance (headings / body / CTAs /
  images vs the captured page JSON; drops not covered by a logged
  `contentDeviations[]` entry fail the page), so dropped-content importer
  bugs surface while the importer is still cheap to fix.

## 0.17.0 — vanilla aem-boilerplate is the only deploy runtime; David's Model becomes a mechanical gate

The AuthorKit runtime dependency is removed end to end: `stardust:deploy`
targets stock `adobe/aem-boilerplate` — no runtime port, no vendored files,
no `.eslintignore`, no pinned author-kit ref. Validated by three full e2e
conversions onto a fresh boilerplate + DA site (6/11/13-section pages, root
and subfolder scopes); the third run shipped with zero live-only defects.

- **Runtime (deploy):** `bootstrap-authorkit.mjs` deleted; new "Target
  runtime" contract documents what stock boilerplate provides (never
  modified). Buttons are the vanilla family (`a.button.primary`/`.secondary`/
  `.accent` in `p.button-wrapper`; the probe records per-target drift —
  older clones emit `button-container`). Fonts move to `styles/fonts.css` +
  metric-matched `<brand>-fallback` faces (the stock convention); the
  `body.appear` gate is the runtime's and stays. Chrome is authored `/nav` +
  `/footer` documents fed to template-slotted `header`/`footer` blocks —
  nav links become authorable and interactive chrome is real block JS;
  per-page `nav:`/`footer:` metadata replaces `header: off` (and makes
  multilingual chrome routing a content concern, no runtime patching).
- **David's Model (deploy):** new `davids-model.md` maps all 15 rules to
  their enforcement points (`D#N` citations); the ENCODE contract gains the
  missing structural rules (D2 nested blocks, D3 spans, D4 URLs, D10
  columns, D13 alt-text, D15 code-as-text, D1 auto-blocked embeds); Step 2
  opens with D1/D11 triage (prose sections land as default content with a
  small closed section-`style` vocabulary; Block Collection patterns mirror
  collection models). New `davids-model-lint.mjs` gates the atomic delivery
  chain — three consecutive e2e runs produced 0 🔴 first-pass content
  structure with no model instruction in the run prompt.
- **New gates + findings from the validation runs:** `qa-gate.mjs` (stock
  Local-QA assertion run driven by the page's eds-schema — replaces
  hand-rolled probes); Local-QA scope boundary (CLS, `content-diff`/
  `visual-diff`, and chrome overrides are deployed-URL-only checks — the
  harness false-passes CLS); findings #96–#101 in `deploy/IMPROVEMENTS.md`,
  including: the pipeline `<p>`-wraps nav trigger links (#98),
  bitmap-embedding SVGs 409 the preview (#99, lint advisory added), and the
  metadata-first empty section defeats `waitForFirstImage` so hero blocks
  must eager-load their LCP image and reserve the media slot (#100).
- **Cross-skill:** rollout delivers chrome as published `/nav` + `/footer`
  documents (roster + coverage semantics updated; multilingual routing via
  per-language documents); diff's `BLANK_RENDER` hint now points at the
  runtime not booting instead of advising removal of the stock display gate;
  `edsName()` guards `-wrapper`/`-container` suffix collisions.

Measured effect across the validation runs: single-page conversion time fell
from ~74 to ~42 minutes as findings fed back into the skill, with fidelity
gates green throughout (content+roles matched 41/41, 94/94, 71/71 text
nodes; live CLS ≤ 0.01 after #100).

## 0.16.1 — container-width sizing guidance in the token contract

Docs only, no behavioral surface. New `## Sizing --max-width` section in
`skills/stardust/reference/token-contract.md`: stardust ships no default
container width — inherit the captured container when it holds up (widening
one step within the site's own framework vocabulary when it reads dated),
measure-first (1200–1280px) when the capture has no measurable container,
and persist the derived value to DESIGN.json
`extensions.breakpoints.containerMaxWidth` with the change flagged in the
page-shape brief. Cross-referenced from
`skills/prototype/reference/page-shape-brief.md` § Layout strategy.

## 0.16.0 — two new entry points: replica (same-design migration) and reskin (content × donor design)

Round-1 outcome of the three-new-use-cases exploration (research, candidate
designs, and validation evidence in `notes/new-use-cases/`). Both flows were
validated on real pages before codification — replica converged a typographic retail home page to
a 1.31% pixel diff with zero structural findings in 3 measured iterations;
reskin carried a healthcare site's content byte-identically (2281/2281 chars,
47/47 slots, 13/13 metadata) onto a payments-company donor's token system with 91% of
slots mapped to named donor modules. No existing skill was modified (round-2
synergy candidates are listed in `notes/new-use-cases/ROUND-1-REPORT.md`).

- **`stardust:replica`** (new): same-design migration to AEM EDS. extract
  `--prep` unchanged → mechanical preserve-direction (current-state spec
  promoted verbatim as target; deltas only via the inconsistency register) →
  clean re-authored archetype recreation (values lifted from the source
  site's own CSS, never DOM copies) → measured source-fidelity gate per
  breakpoint (diff's two probes `--profile generic` + new
  `stitch-shot.mjs`/`pixel-compare.mjs` stitched pixel probe with per-band
  breakdown, ≤3 iterations) → migrate sibling tier / deploy
  (template-slotted bias) / rollout unchanged.
- **`stardust:reskin`** (new): byte-faithful content onto a donor design
  system (live URL via extract `--design-source`, or local prototypes;
  Figma donor contract-defined, not implemented). Content-model capture with
  scope declaration + executable normalization ledger → mapping brief
  (≥80% slots mapped to named donor modules, no silent improvisation) →
  programmatic render from the model (never retyped) → dual gates: content
  (vendored `dom-equality.mjs`, Apache-2.0 attribution, structure
  informational + `slot-coverage.mjs` incl. metadata) and design-adoption
  (`donor-probe.mjs` token assertions; selector-missing = FAIL).
- Both skills were smoke-tested for generalization on fresh sites before
  shipping (replica: a furniture retailer, desktop converged to 1.06%; reskin:
  a university site × an analytics-vendor donor, 4883/4883 text bytes, 101/101 slot checks) and
  hardened from the findings: replica gained pointer-park capture hygiene,
  the fixed/sticky-chrome × stitched-capture procedure, per-breakpoint CSS
  lifting, and the full four-patch adaptation set for the diff probes
  (upstreaming them as diff flags is the recorded round-2 candidate);
  reskin gained the document-ordered render stream in the content model
  (`ordered` + tiling verification), root-kind slot classification, a
  shared image-visibility predicate across capture and gate, the
  scope-granularity smell check, and the bounded donor-sampling recipe.
  Smoke evidence: `/Users/paolo/stardust/smoke-{replica,reskin}/SMOKE-REPORT.md`.
- New evals: `replica-source-fidelity/`, `reskin-content-fidelity/`.

### Field-test hardening (5+5 home pages, findings ledger in the 2026-07 field report)

A 10-site field test (replica: a furniture maker, a luggage brand, a fashion
retailer, an EV maker, a fashion house; reskin: botanic-garden×SaaS-donor PASS,
museum×messaging-vendor PASS, humanitarian-nonprofit×hosting-vendor)
produced an 18-finding ledger; all skill-wrong findings are folded:

- **Shared live-measurement hardening (F-G, F-R1, luggage-brand-1; HIGH).** New
  `diff/scripts/live-session.mjs` — the one home for hitting live sites to
  *measure* them, as robust as extract's capture engine: real-Chrome UA
  **plus the standard request headers** (Akamai fingerprints on the absence
  of `Accept`/`Accept-Language`/`sec-ch-ua`, so UA alone still 403s —
  reproduced on the humanitarian nonprofit's origin, fixed to HTTP 200; the same header set
  un-blocked the luggage brand's gate headlessly), challenge detection that **fails
  loud** (exit 3, never silently measured as the source), headed-stealth
  escalation, and two-class overlay dismissal (consent + timed marketing
  modals, the fashion retailer's `#wps_popup` case — CH-1). Consumed by diff's two
  probes, replica's stitch-shot, and reskin's three live-hitting scripts.
- **diff flags replace replica's 10 hand-edits (F-B).** `--ua`,
  `--wait-until`, `--dismiss`, `--headed`, `--locale` on both probes and
  visual-diff `--main`, backward-compatible for local/deploy use;
  `source-fidelity-gate.md` § Script adaptations rewritten — a hand-edited
  project copy is now a defect.
- **replica:** bounded `--single` entry gets a satisfiable promotion
  contract (`bounded-single` synthesis branch — luggage-brand-3); `--main body`
  banned with the 103-false-🔴 reproduction (F-C); hit-minimization +
  media-density iteration budget (luggage-brand-2, CH-2); mobile-@media-first and
  role-parity recreation guidance (CH-3/FH-2); locale pinning for capture
  determinism.
- **reskin:** ordered stream is now `innerText`-consistent by construction
  (F-R2 — the botanic-garden site's a11y ghost labels eliminated at the source; 8/8
  `orderedVerified` vs 5 false in the field) with a sanctioned documented
  fallback; `formControl` stream nodes carry select/option/input text
  verbatim (F-R3 — the humanitarian nonprofit's course form now fully reconstructable, 13/13
  verified); slot-coverage gains a paint assertion so an origin-locked CDN
  can't hide behind a passing URL-string gate (F-R4, the botanic-garden site's 19 unpainted
  images); zero-output scope errors now guide discovery (F-D); first-match
  scope semantics and bounded-donor token sourcing documented (F-R5, F-R6).
- Manifest version aligned (F-A).
- **PR-review P1 fixes** (multi-agent review of PR #238): donor-probe expands
  CSS box shorthands canonically (3-value `[t,r,b,r]`, not cyclic — a
  pixel-perfect render no longer false-fails the design gate); stitch-shot
  fails loud on scroll-stall (inner-scroller/scroll-jacked pages can no
  longer produce silent black-row captures); the diff probes regain their
  advisory exit contract for HTTP errors (`gotoLive httpError:'measure'` —
  a 404 build side reports flags at exit 0 again; challenges still exit 3;
  reskin's byte gate keeps fail-loud); `defaultWaitUntil` centralized in
  live-session with a three-tier rule (localhost and `*.aem.page/.aem.live/
  .hlx.page/.hlx.live` → networkidle, other live → domcontentloaded) so
  deploy Step 10 never measures a half-decorated EDS page.
- **PR-review P2/P3 fixes**: the challenge solve-window runs headed-only —
  a challenged headless run now costs exactly 1 hit (was 4, the entire
  recorded Akamai block budget) before exit 3; slot-coverage routes live
  `--rendered` targets through live-session like its siblings (challenge →
  exit 3, no more swallowed navigation errors); case-insensitive stream
  matching no longer reuses indexes across case-folded strings (Turkish İ
  class — corrupted stream bytes fixed at the source); bootstrap re-runs
  preserve the favicon `<link>` when overwriting head.html (idempotent
  re-injection); typo'd `--flags` now error loudly in dom-equality /
  donor-probe / slot-coverage; the QA harness derives its favicon link from
  the shipped `favicon.<ext>` (or keeps the request-free `data:,` no-op).
## 0.15.0 — deploy accuracy: close the ENCODE/DECODE round-trip at authoring time (#93–#95)

The six-site e2e campaign showed `stardust:diff`'s structural probe catching
real dropped-CTA / role-swap defects on every site — post-deploy, when each
fix costs a redeploy loop. Root cause: authored rows (ENCODE) and block
decode (DECODE) are written independently and hoped to be inverses. This
release moves the defect-finding to conversion time so `deploy` Step 10
becomes a proof, not a repair loop:

- **#93 `section-schema.mjs`** (deploy, new): the per-section ENCODE/DECODE
  shared contract — ordered role inventory + repeating-unit groups emitted
  from the rendered prototype; authored rows and block decode are both
  written from it (new Step 2b).
- **#94 `block-roundtrip.mjs`** (deploy, new): in-loop per-block gate —
  decorates the authored content locally with the block's own JS+CSS (no DA,
  no dev server), diffs the decorated section against the prototype section
  with content-diff's own classifier, exit 2 on structural 🔴 or on any
  decorate error (a block that throws or whose inlined JS fails to install
  must never pass — its raw rows can false-match the prototype). Required per
  block before deploy, plus one whole-page run before the DA push.
- **#95 decode tiers** (deploy): template-slotted (verbatim prototype DOM +
  role slots — fidelity by construction, for fixed-composition sections
  nobody structurally edits) vs reconstructive (for authorable repeat
  groups); tier recorded per block.
- **diff**: classifier + differ factored into
  `skills/diff/scripts/content-inventory.mjs`, shared by content-diff /
  section-schema / block-roundtrip so every fidelity gate measures with the
  same instrument (content-diff CLI behavior unchanged).

## 0.14.5 — crawler clears Cloudflare managed challenges

`extract/scripts/crawl.mjs` — the bot-management fallback now validates the
probe **response**, not just that the navigation resolved. A Cloudflare managed
challenge returns an HTTP 403 interstitial (`cf-mitigated: challenge`) *without
throwing* — `domcontentloaded` fires — so the old fallback (which only fired on
a thrown network-fingerprint error) sailed past it and the block surfaced later
as a fatal capture-time `HTTPError`. Observed on a bot-challenged site during the 0.14.4
uplift validation batch, where it required hand-patching the crawler mid-run.

- **Challenge detection at the probe:** `isChallengeResponse()` flags an
  entry-URL 403/429/503 interstitial (`cf-mitigated`, `cf-ray`,
  `server: cloudflare`/`akamai`/edge markers). Either reject mode — a thrown
  fingerprint block *or* a challenge response — now triggers the headed
  fallback; the reason is recorded in `_crawl-log.json#discovery.botBlock`
  (`fingerprint | challenge`).
- **Stealth-hardened headed Chrome:** the fallback launches real Chrome with
  `--disable-blink-features=AutomationControlled` +
  `ignoreDefaultArgs: ['--enable-automation']` and spoofs
  `navigator.webdriver` via an init script on **every** context (probe +
  workers — the challenge re-fires per context, no cross-context cookie
  sharing). `fetchTechnique` becomes `headed-chrome-stealth`.
- **Challenge-solve window:** `clearChallenge()` waits for the non-interactive
  challenge's JS to set its clearance cookie and reloads before validating
  status — no-op on a normal 200, so zero overhead on the common path. If
  headed + stealth + the solve window still can't clear it, the run fails with
  a clear `BotChallengeError` (interactive solve required) rather than
  capturing the interstitial as content.
- Recipe doc (`extract/reference/playwright-recipe.md` § Bot-management
  fallback) updated with the two-reject-mode retry rule and the managed-
  challenge clearing procedure.

Validated end-to-end: patched crawler on the bot-challenged site auto-detects the challenge,
switches to `headed-chrome-stealth`, and captures the homepage at HTTP 200
(2 headings, ~8.9k chars, 9 images); the common headless path (example.com) is
unchanged (no fallback, no botBlock).

## 0.14.4 — Tessl quality pass, part 1 (descriptions)

Description rewrites for the two skills whose tessl-review drag included
description criteria: `extract` (adds a "Use when…" clause + natural trigger
terms — analyze/reverse-engineer/capture design tokens — and a "Not for"
scraping disambiguation) and `prepare-migration` (plain-language framing of
the prep cascade + trigger phrases + "Not for" migrate/deploy
disambiguation). Body text untouched — zero behavioral surface; the
conciseness/progressive-disclosure restructuring of extract/deploy is a
separate follow-up with its own validation run.

## 0.14.3 — seventh-site validation harvest (stardust.style) + review fixes

Learnings L1–L9 from the final validation run (full pipeline on
stardust.style, hands-off) plus the PR-review findings, folded:

- **crawl.mjs:** trailing-slash forms kept verbatim with slash-insensitive
  dedupe + a guarded 404 slash-retry that records the resolved URL
  (`_crawl-log.json#crawl.slashRetries[]`); `reducedMotion: 'reduce'` on every
  context + an 800ms post-scroll settle (animated h1s were silently dropped);
  visible `<pre>` contents captured as `codeBlocks[]`; collision-safe slug
  assignment (query-variant / flattened-path pages no longer clobber one
  file); sitemap-index recursion (child-sitemap `.xml` locs no longer queued
  as pages); `page.close()` on every exit path via try/finally.
- **Specs:** playwright re-probe rule at the start of every rendering skill
  (`--no-save` installs are pruned by any later `npm i`); token-hygiene gate
  at the FIRST phase commit (master SKILL.md); partial-inventory broken-link
  carve-out reconciled across content-preservation / migration-procedure /
  template-and-module-rendering; cinematic sibling handling specced in
  migrate (assets carried, `cinematic-variant-not-consumed` recorded);
  key-facts-in-server-rendered-content ENCODE rule (#86) with the declaration
  site defined (`DESIGN.json.extensions.metadata.keyFacts[]`); stale
  "closed catalog / 5 weaknesses" references reconciled in the master skill,
  divergence-toolkit, and artifact-map; diff JOIN/SPLIT limitation documented
  (#87, code fix pending).
- **Versions realigned** across plugin.json / tile.json / marketplace.json /
  README / this file (the #230 drift class).

## 0.14.1 — six-site E2E hardening (round 1, folded into extract)

Released as part of the six-site validation cycle; the crawl.mjs items listed
under 0.14.2's last bullet were folded here first. Documented retroactively —
see git history (`4a61c83`) for the full diff.

## 0.14.2 — six-site E2E hardening (round 2)

Fixes folded from validating the pipeline end-to-end on six live sites
(site D (airline), site E (tools retailer), site A (healthcare), site F (nonprofit
shelter), site B (industrial conglomerate), site C (agency)), ranked by
cross-site frequency.

- **migrate no longer dead-ends on missing canon (blocking; 4 of 6 sites).**
  The documented `prototype → migrate → deploy` path never runs
  `prepare-migration`, so migrate arrived with no canon and hard-stopped.
  `migrate` § Setup now auto-bootstraps canon from the first approved
  prototype (the `prototype --prep` write-back, run on demand) when canon is
  absent and an approved prototype exists; it only stops when there is nothing
  to derive canon from. (`skills/migrate/SKILL.md`)
- **bootstrap-authorkit is transactional + refuses the drift-prone default
  (blocking; 2 sites).** Boilerplate removal now runs *after* the mandatory
  edits verify, so a drifted/incompatible source leaves the original runtime
  intact instead of bricking the repo; `author-kit@main` is refused unless
  `--ref <sha>`, `--from-sibling`, or `--allow-unpinned` is given.
  (`skills/deploy/scripts/bootstrap-authorkit.mjs`)
- **atomic delivery contract now asserts computed layout (silent-failure
  guard).** A `.plain.html` pass is not a layout pass — the AuthorKit
  `.<name>.block` scoping bug ships a stacked single-column page green. The
  contract's final gate is now a headless computed-style check (grid blocks
  must compute `display:grid`, blocks decorated, 0 pageerror) once per
  template. (`skills/deploy/SKILL.md`)
- **crawl.mjs, folded in 0.14.1 and confirmed by the runs:** five-field
  `_provenance` emission, apex→www origin adoption, Usercentrics shadow-DOM
  consent, `<video>`/`<iframe>` capture, and the playwright preflight
  (`--no-save --legacy-peer-deps`) + copy-to-project ESM-resolution guidance.

Backlog (single-site or lower-frequency) tracked in the consolidated E2E
learnings digest.

## 0.14.0 — Fable 5 refactor

### Design quality

- **Reference-grounded direction.** `direct` researches real-site references
  via the optional refero MCP (`skills/stardust/reference/reference-research.md`)
  before committing to a direction; the curated seed roll is demoted to the
  fallback when refero is absent.
- **Brand-adjacent refinement tier.** A directed middle ground between
  faithful reproduction and full re-direction, so "polish, don't reinvent"
  is a first-class target rather than an improvised compromise.
- **Opened catalogs.** The uplift/prototype candidate catalogs (what-if
  amplifications, motion registers) are no longer closed lists: the agent may
  extend them with evidence-gated entries justified from the captured brand
  surface.
- **Vision verification gates.** `extract` and `prototype` verify their own
  screenshots/renders with vision checks before a step may pass, catching
  blank captures, broken renders, and layout collapse early.

### New capabilities

- **`stardust:audit`** — new skill: a design + SEO + LLM-visibility audit of
  a site, producing a scored HTML report. Uses the marketing-skills
  `seo-audit` / `ai-seo` methodology when that plugin is installed and
  built-in heuristics otherwise.
- **Cross-site same-brand extraction.** `extract --brand-source` /
  `--design-source` capture brand and design evidence from a sibling property
  of the same brand, with automatic sibling discovery.
- **Hands-off production mode.** `skills/stardust/SKILL.md § Hands-off mode`
  runs the full migration chain without conversational gates, folding the
  previously external master migration prompt into the skills.
- **Run contracts.** A per-run learnings ledger plus a `stardust/status.jsonl`
  run-status contract, so long runs are observable and each run feeds the
  next.

### Fidelity

- **Runtime-contract detection** in deploy/rollout: probe what the target
  runtime actually serves instead of assuming the authored contract survived.
- **Atomic per-page delivery verify** — each page is verified as a unit
  immediately after delivery, not batched at the end.
- **Foundation-first gate** — global foundations (nav, footer, styles,
  indexes) must verify before page fan-out begins.
- **Link audit** across the delivered site.
- **Query-index resilience** — index delivery/verification no longer
  false-fails or silently drops rows on slow propagation.

### Performance

- **Parallelism contracts.** Concurrent agents coordinate through a
  state-machine merge-by-slug contract instead of last-writer-wins on
  `state.json`.
- **Parallel prototype variants** and **crawl concurrency** in `extract`.

### Fixed

- **Version/reference drift.** `plugin.json`, `tile.json`, and the README now
  carry one version, and the impeccable dependency is declared consistently
  as **hard** everywhere (tile.json previously listed it as a soft
  dependency).
