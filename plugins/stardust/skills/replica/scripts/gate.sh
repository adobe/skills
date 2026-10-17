#!/bin/bash
# skills/replica/scripts/gate.sh — one pixel-gate round in one command
#
# Stitches both sides, each settled (--settle — one symmetric instrument; live
# capture CACHED across iterations — hit minimization, source-fidelity-gate.md
# § Iteration discipline), reads the horizontal-overflow assert from the build
# capture's own overflow line, runs pixel-compare, and prints the verdict lines
# that drive the loop (size / height delta / differing % / hot bands /
# overflow). The prototype/build side is re-captured every round; the live side
# only when live.png is absent, was taken hiding a different list (--hide) or
# has no live.json recording the overlay-left check — delete it explicitly to
# re-take for anything else (site changed, capture hardening changed, a new
# --consent / --dismiss selector).
#
# Usage:
#   stardust/scripts/replica/gate.sh <slug> <live-url> <build-url> <width> [iter-label]
#       [--marker <string>] [--full] [--main <selector>] [--consent <sel>] [--dismiss <sel,…>]
#       [--no-dismiss] [--hide <sel,…>] [--help]
#
# Horizontal-overflow assert (every round, build side only — no live hit, no
#   extra page load): the build capture prints one root line,
#   `overflow: scrollWidth=<n> viewport=<n> delta=<n>` — document.documentElement's
#   scrollWidth at <width>, read on the page the pixels came from, after its
#   chunk loop, back at the top with finite animations finished (the page at
#   rest where measure.mjs read it after a scroll pass — a slide-in reveal
#   below the fold is not an overflow, a too-wide header row that a scroll
#   handler pins further down still is); its stdout is overflow-<label>.txt
#   in the evidence dir and the last such line decides. A document wider than
#   its viewport by more than GATE_OVERFLOW_TOLERANCE px (default 4 —
#   scrollWidth and clientWidth are integers, so a correct page whose widest
#   box is 360.4 px reads +1; the qa skill's rendered sweep fails above the
#   same 4 px) prints
#   `gate.sh: OVERFLOW at <w> — build scrollWidth <n> > viewport <n> (+<n>px) → FAIL`
#   and the round exits 2 whatever the pixel number says; a clean root, or one
#   inside the tolerance, prints `gate.sh: overflow assert at <w> — … → ok`
#   (the px over and the tolerance named). This is the hard assert no
#   iteration cap waives (source-fidelity-gate.md § Iteration discipline): a
#   recorded hands-off run delivered two pages 373 and 400 px wide at a 360
#   viewport and logged them as residuals. gate-evidence.mjs reads the same
#   line, so a PASS pixel line never earns pixel-gate-<w> over an overflow.
#   The line follows the build capture's exit classes (below); a build capture
#   that printed no overflow line is exit 1 (a stale stitch-shot.mjs copy —
#   re-copy it). measure.mjs stays the tool for finding the box that overflows.
#
# Capture retry: a capture (live or build) that exits 1
#   is retried ONCE before the round declares anything — under parallel
#   Chromium load (three rounds in flight, nine Chromiums with --full) a
#   recorded run saw about 8 of 62 sibling rounds exit 1 from the build
#   capture and read them as verdicts. Two exit-1 attempts end the round with
#   exit 1: "no verdict, re-queue the round" — never a FAIL, never a spent
#   iteration. Only exit 1 is retried; 3 (bot challenge), 4 (identity) and
#   124 (deadline) are final on the first attempt.
#
# Overlay dismissal (both captures AND the probes, one vocabulary): stitch-shot runs the shared
#   dismissOverlays (live-session.mjs — the built-in consent candidates + timed marketing modals) on
#   the live and the build capture alike, as the diff probes do under --dismiss; --consent <sel> and
#   --dismiss <sel,…> hand a site's own selectors to every step; --no-dismiss turns dismissal off
#   everywhere in the round. Symmetric by construction — the build side has nothing to dismiss, so
#   the same flags on both sides cannot bias the diff.
#   An overlay left on either capture is no verdict: stitch-shot's final check (after dismissal and --hide) prints
#   `overlay-left: <descriptor>` when a consent root is still visible, a fixed / sticky layer covers most of the
#   viewport or the root is scroll-locked; the round then prints `gate.sh: overlay left on the <live|build> capture —
#   <descriptor> — no verdict: fix the capture (--consent / --dismiss / --hide), not the page` and exits 1 before
#   anything is compared — never retried (the same flags leave the same overlay). A live one also drops live.png,
#   live.json and the probes' live caches; a build one stops before pixel-compare and the overflow line. Both captures
#   write their record (--json live-shot.json / build-shot.json in the evidence dir).
#
#   --full   the whole probe set in one round: after the pixel verdict the other
#            probes run IN PARALLEL (bounded under run-bg — Concurrency, below), each
#            under its own deadline — content-diff
#            (structural 🔴 count), visual-diff (advisory flags), chrome-parity
#            (header/footer deltas, live side cached), clip-probe on the BUILD side
#            (text / controls cut or hidden by an overflow ancestor — no live hit;
#            #125, a fixed-height card clipped every link on a pixel-PASS page),
#            content-presence live vs build in the PUBLISHED regime only (a build URL
#            that is not localhost / 127.0.0.1 / file:; GATE_REGIME=published|prototype
#            overrides), and unit-geometry when stardust/replica/units.json declares a
#            repeated-unit family for the slug — and only their verdict lines are
#            printed. Evidence per probe lands next to the pixel evidence:
#            content-diff-<label>.txt, visual-diff-<label>.txt + vdiff-<label>/,
#            chrome-parity-<label>.txt, clip-<label>.{txt,json},
#            content-presence-<label>.{txt,json}, units-<label>.{txt,json}. The live side of
#            content-diff, visual-diff and content-presence is cached like chrome-parity's
#            chrome-live.json: content-live.json, visual-live.json, presence-live.json — live
#            side probed once per run, later rounds reuse it; older only under
#            STARDUST_ORIGIN_MAX_AGE_H; delete to re-probe (retaking live.png drops
#            them too, and live.json — every round's record of how live.png was
#            taken, its capture checks included (overlayLeft; fontsFailed — a
#            list = checked, null = not checked), which gate-all reads before it
#            reuses live.png). Needs the diff skill's
#            scripts at stardust/scripts/diff/ (Setup step 4). The build URL may be
#            a served prototype or the published/preview origin — the published-
#            origin gate is the same command with the preview URL (pass --marker
#            when the slug string does not occur in the served page).
#            The probes run only when the pixel step gave a verdict (exit 0 or 2).
#            Any other pixel exit (124 deadline, 1 error, 3 bot challenge, 4
#            identity) prints one "probes skipped" line and exits with that code —
#            a round with no pixel verdict does not spend three Chromiums.
#            Exit with --full: the pixel rc when it is not a verdict (above); 124 on
#            any probe deadline; else the pixel verdict, then 2 on a structural 🔴,
#            a chrome delta, a clipped count > 0, a content-presence MISSING / HIDDEN
#            link or heading, or a required unit off; 1 when a probe errored (it gave
#            no verdict), 0 only when every probe ran and passed.
#            Concurrency: run directly, a --full round starts every probe at once — up
#            to SIX Chromiums at its peak. Under run-bg the round holds ONE machine-wide
#            browser slot (stardust/scripts/stardust/browser-lock.mjs, STARDUST_BROWSER_SLOTS;
#            the job's env carries STARDUST_BROWSER_SLOT=<slot file>) and its probes run
#            at most STARDUST_BROWSERS_PER_SLOT at a time, in the order above: run-bg sets
#            it to max(1, floor(STARDUST_BROWSER_BUDGET / STARDUST_BROWSER_SLOTS)) (budget
#            3, slots 3 by default → 1), so S slots × that many probes stay within the
#            budget B whenever B ≥ S (one probe per slot is the floor); unset or not a
#            positive integer (an older run-bg) → 1. Each probe keeps its own deadline, exit
#            code and verdict line, and the round's exit rule is unchanged. A bounded round
#            takes the SUM of its probes' times, not the slowest: run-bg's default job
#            deadline (900 s) can end it with exit 124, no verdict (a recorded round with
#            three probes in sequence took 15 minutes) — start a --full round through run-bg
#            with --timeout 1800 (or raise STARDUST_BROWSER_BUDGET). One stderr line names
#            the bound and, when it holds back some of this round's probes, that remedy —
#            plus the job's deadline (RUN_BG_DEADLINE_SEC) when it is below 1800 s: a note,
#            never a refusal or a verdict. RUN_BG_SLOTS lowers the job count on a small
#            machine. Start the rounds all at once and let the slots pace them — no sleep
#            staggering.
#   --main <selector>   content root for the diff probes (default: main)
#   --consent <sel>     site-specific consent-accept selector (clicked before the built-in candidates) —
#                       reaches both captures, the diff probes and chrome-parity
#   --dismiss <sel,…>   extra overlay-dismiss selectors (marketing modals with non-standard closers), same reach
#   --no-dismiss        do not dismiss consent/marketing overlays — on the captures or the probes (exit 125
#                       together with --consent / --dismiss: they contradict)
#   --hide <sel,…>      in-flow per-visitor regions (a location-suggestion strip above the header; --dismiss is
#                       for overlays and cannot remove one) hidden on both captures and every --full probe but
#                       unit-geometry, the same list live and build; repeatable. The presence files add their "*"
#                       then <slug> `hide` after it: gate-all's gate-dir presence.json (gates/all-<w>/ or
#                       prototypes-<w>/, this regime's first) merged over the site-wide stardust/replica/presence.json
#                       (one hide list for every page and round) — per top-level key, per field, the gate dir's value
#                       wins (a gate-dir "*".hide replaces the site's "*".hide, it does not add to it); keys and
#                       fields only one file has are kept; either file malformed = exit 1 naming it, nothing captured.
#                       chrome-parity reads the presence itself: --presence <gate-dir file> --slug <slug>, or
#                       --presence stardust/replica/presence.json --slug <slug> when only the site file exists. live.json
#                       records the list; a round with a different list (or with hides and no live.json) retakes
#                       live.png and says so — as it does a live.png with no live.json, or one whose live.json
#                       predates the overlay-left check (no overlayLeft) or records an overlay left: one line, once.
#                       A hide selector that matched nothing on the live capture is never silent: when the live
#                       capture's record (live-shot.json — a reused live.png's too) carries hideMiss, one stderr line
#                       `gate.sh: WARNING hide matched nothing on live — candidates: <selector> (<tag>, <h>px); …
#                       (<missed sel>, …)` names the in-flow blocks above the header on that page (a 0-px one reads
#                       `(<tag>, 0px now — a block that grows later is still hidden by the persistent display:none
#                       !important rule)`; none → `none found above the header`) and the selectors that missed — put
#                       the right one in the hide list. A warning only: the verdict and the exit code are unchanged.
#
# Example (iteration 2 of the home archetype at 1440):
#   stardust/scripts/replica/gate.sh home "https://<site>/" \
#     "http://localhost:8791/home-proposed.html" 1440 iter2
#
# Evidence lands in stardust/replica/gates/<slug>-<width>/
# (live.png + live.json, live-capture.txt = the live capture's stdout, build.png, diff-<label>.png,
# overflow-<label>.txt = the build capture's stdout, live-shot.json / build-shot.json = the captures' records).
#
# Fail-loud contract: a stitch-shot bot challenge (exit 3) or capture error
# aborts the round — a missing/blocked side must never be compared. Exit
# codes: 0 gate PASS, 2 gate FAIL (over threshold, or horizontal overflow on
# the build side), 3 bot challenge, 1 capture/compare error (after the one
# retry — re-queue, not a verdict), a malformed presence.json — the gate
# dir's or the site-wide stardust/replica/presence.json (fix the file;
# re-queuing won't help), an overlay left on either capture (no
# verdict: fix the capture — --consent / --dismiss / --hide — not the page)
# or a project stitch-shot.mjs that predates --json (re-copy it; no capture),
# 4 build-side identity assertion failed
# (the URL serves something that isn't this project's page — wrong/stale
# server), 124 instrument deadline exceeded (not a measurement — see below),
# 125 unknown argument (usage).
#
# Instrument deadlines + stale reap: every node step runs under
# run-capped.mjs (macOS has no `timeout`). Three field migrations (2026-08/09)
# recorded stitch-shot / pixel-compare sitting at 0 % CPU for 10+ minutes;
# the leftover processes from earlier rounds (and from OTHER projects on a
# shared machine — 8 found in one run) held Chromium + memory and slowed every
# later round, and agents responded with ad-hoc `sleep 150; kill` loops that
# burned a fixed 30 min per page. Before a round this script stops this
# user's replica instruments older than GATE_REAP_MIN whole minutes (a healthy
# capture or compare finishes in seconds to a few minutes): only `node` (or
# <path>/node) processes running one of the instrument scripts, never one
# under `--inspect` (someone's debugger); SIGTERM first, SIGKILL only if still
# alive ~2 s later. Overrides:
#   GATE_STITCH_TIMEOUT  seconds per stitch-shot              (default 300)
#   GATE_OVERFLOW_TOLERANCE  px of build scrollWidth over the viewport still ok (default 4; 0 = exact)
#   GATE_COMPARE_TIMEOUT seconds per pixel-compare        (default 120)
#   GATE_REAP_MIN        stale-instrument age in minutes  (default 15; 0 disables)
#   GATE_PROBE_TIMEOUT   seconds per --full probe          (default 300)
set -u

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,/^set -u$/p' "$0" | grep -E '^#' | sed -E 's/^# ?//'
  exit 0
fi

SLUG=${1:?usage: gate.sh <slug> <live-url> <build-url> <width> [iter-label] [--marker <string>]}
LIVE_URL=${2:?missing <live-url>}
BUILD_URL=${3:?missing <build-url>}
W=${4:?missing <width>}
LBL=iter
MARKER="$SLUG"
FULL=0
MAIN=main
DISMISS=1
CONSENT=""
DISMISS_EXTRA=""
HIDE=""
shift 4
if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then LBL=$1; shift; fi
while [ $# -gt 0 ]; do
  case "$1" in
    --marker) MARKER=${2:?--marker needs a value}; shift 2 ;;
    --full) FULL=1; shift ;;
    --main) MAIN=${2:?--main needs a selector}; shift 2 ;;
    --consent) CONSENT=${2:?--consent needs a selector}; shift 2 ;;
    --dismiss) DISMISS_EXTRA=${2:?--dismiss needs a selector list}; shift 2 ;;
    --no-dismiss) DISMISS=0; shift ;;
    --hide) case "${2:-}" in ''|--*) echo "gate.sh: --hide needs a selector list (see --help)" >&2; exit 125 ;; esac; HIDE="${HIDE:+$HIDE,}$2"; shift 2 ;;
    --help|-h) sed -n '2,/^set -u$/p' "$0" | grep -E '^#' | sed -E 's/^# ?//'; exit 0 ;;
    *) echo "gate.sh: unknown argument $1 (see --help)" >&2; exit 125 ;;
  esac
done

if [ "$DISMISS" = 0 ] && { [ -n "$CONSENT" ] || [ -n "$DISMISS_EXTRA" ]; }; then
  echo "gate.sh: --no-dismiss contradicts --consent / --dismiss — drop one (see --help)" >&2; exit 125
fi
# Overlay flags per step (header § Overlay dismissal). stitch-shot and chrome-parity take --consent <sel> and
# --dismiss <sel,…>; the diff probes take one --dismiss [sel,…] (bare = the built-in candidates only), so the site's
# selectors are joined for them; both stitched captures also pin --locale en-US, the locale gate-all's stitches pin.
# Arrays expand as ${a[@]+"${a[@]}"}: macOS /bin/bash is 3.2, where an empty array under set -u is an unbound variable.
STITCH_OPTS=(); PROBE_OPTS=(); CHROME_OPTS=()
if [ "$DISMISS" = 1 ]; then
  [ -n "$CONSENT" ] && { STITCH_OPTS+=(--consent "$CONSENT"); CHROME_OPTS+=(--consent "$CONSENT"); }
  [ -n "$DISMISS_EXTRA" ] && { STITCH_OPTS+=(--dismiss "$DISMISS_EXTRA"); CHROME_OPTS+=(--dismiss "$DISMISS_EXTRA"); }
  EXTRA="${CONSENT:+$CONSENT,}$DISMISS_EXTRA"; EXTRA=${EXTRA%,}
  if [ -n "$EXTRA" ]; then PROBE_OPTS=(--dismiss "$EXTRA"); else PROBE_OPTS=(--dismiss); fi
else
  STITCH_OPTS=(--no-dismiss)
fi
STITCH_OPTS+=(--locale en-US)
# --hide is independent of the overlay flags. chrome-parity takes the flag list as given and reads presence.json's
# `hide` itself (--presence, below) so its source attribution stays right; the captures and the other probes get the
# effective list (below).
[ -n "$HIDE" ] && CHROME_OPTS+=(--hide "$HIDE")

HERE=$(cd "$(dirname "$0")" && pwd)
DIR="stardust/replica/gates/$SLUG-$W"
mkdir -p "$DIR"

STITCH_TIMEOUT=${GATE_STITCH_TIMEOUT:-300}
COMPARE_TIMEOUT=${GATE_COMPARE_TIMEOUT:-120}
PROBE_TIMEOUT=${GATE_PROBE_TIMEOUT:-300}
OVF_TOL=${GATE_OVERFLOW_TOLERANCE:-4}
case "$OVF_TOL" in ''|*[!0-9]*) echo "gate.sh: GATE_OVERFLOW_TOLERANCE must be a whole number of px (got '$OVF_TOL')" >&2; exit 125 ;; esac
REAP_MIN=${GATE_REAP_MIN:-15}

# Regime (gate-evidence.mjs regimeOf semantics): localhost / 127.0.0.1 / file: build URL = prototype, else published.
case "${GATE_REGIME:-auto}" in
  prototype|published) REGIME=$GATE_REGIME ;;
  *) case "$BUILD_URL" in http://localhost*|http://127.0.0.1*|file:*) REGIME=prototype ;; *) REGIME=published ;; esac ;;
esac
# gate-all's presence.json: this regime's sidecar first (published → gates/all-<w>/, prototype → gates/prototypes-<w>/),
# then the other stage's at the same width; under it the site-wide stardust/replica/presence.json (project root = cwd).
# chrome-parity reads the presence itself (variable regions and `hide`): --presence <gate-dir file>, else the site file.
PRES=""
if [ "$REGIME" = published ]; then STAGES="all prototypes"; else STAGES="prototypes all"; fi
for st in $STAGES; do
  [ -f "stardust/replica/gates/$st-$W/presence.json" ] && { PRES="stardust/replica/gates/$st-$W/presence.json"; break; }
done
SITE_PRES=""
[ -f "stardust/replica/presence.json" ] && SITE_PRES="stardust/replica/presence.json"
if [ -n "$PRES" ]; then CHROME_OPTS+=(--presence "$PRES" --slug "$SLUG")
elif [ -n "$SITE_PRES" ]; then CHROME_OPTS+=(--presence "$SITE_PRES" --slug "$SLUG"); fi
# The effective hide list (header § --hide): the --hide list, then the merged presence's "*".hide and <slug>.hide; comma
# lists split, trimmed, empty dropped, de-duplicated in order, joined with ','. The merge: the site file under the gate
# dir's — per top-level key { ...site[k], ...gate[k] } (the gate dir's field wins; keys / fields only one file has are
# kept; a missing file = {}). hideList / mergePresence restate live-session.mjs's parseHideList / presenceHide /
# mergePresence on purpose — node -e here imports nothing (a pixel round needs no diff skill); keep them in step. Either
# file malformed is exit 1 before any capture, naming it. Captures and probes get one --hide "$EFF_HIDE".
HIDE_JS='const hideList = (...v) => { const out = []; const add = (x) => { if (Array.isArray(x)) { x.forEach(add); return; }
  if (typeof x !== "string") return; for (const p of x.split(",")) { const s = p.trim(); if (s && !out.includes(s)) out.push(s); } };
  v.forEach(add); return out; };'
EFF_HIDE=""
if [ -n "$HIDE" ] || [ -n "$PRES" ] || [ -n "$SITE_PRES" ]; then
  EFF_HIDE=$(node -e "$HIDE_JS"'const fs = require("fs"); const [gateFile, siteFile, slug, flag] = process.argv.slice(1);
    const read = (f) => { if (!f) return {}; try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {
      fs.writeSync(2, `gate.sh: presence.json ${f} unreadable (${String(e.message).replace(/\s+/g, " ")}) — fix or delete it; nothing captured\n`); process.exit(1); } };
    const obj = (x) => (x && typeof x === "object" ? x : {});
    const mergePresence = (site, gate) => { const s = obj(site); const g = obj(gate); const out = {};
      for (const k of new Set([...Object.keys(s), ...Object.keys(g)])) out[k] = { ...s[k], ...g[k] }; return out; };
    const gate = read(gateFile); const j = mergePresence(read(siteFile), gate);
    const of = (k) => (j[k] && typeof j[k] === "object" ? j[k].hide : null);
    process.stdout.write(hideList(flag, of("*"), of(slug)).join(","));' -- "$PRES" "$SITE_PRES" "$SLUG" "$HIDE") || exit 1
fi
HIDE_OPTS=()
[ -n "$EFF_HIDE" ] && { STITCH_OPTS+=(--hide "$EFF_HIDE"); HIDE_OPTS=(--hide "$EFF_HIDE"); }
capped() { local t=$1 l=$2; shift 2; node "$HERE/run-capped.mjs" --timeout "$t" --label "$l" -- "$@"; }
# One retry on exit 1 only (the capture/compare error class — Chromium under parallel load); 3, 4 and 124 are
# final. $1 names the step for the log line; the rest is the command (a function or a program).
retry_once() {
  local label=$1 rc; shift
  "$@"; rc=$?
  if [ "$rc" -eq 1 ]; then
    echo "gate.sh: $label exited 1 — retrying once (a capture error under load is not a verdict)" >&2
    "$@"; rc=$?
  fi
  return "$rc"
}

# Stale-instrument reap (own user, node processes running a replica instrument
# only, by basename so the plugin tree and the project copy both match; nothing
# under --inspect). ps etime is [[dd-]hh:]mm:ss; mins truncates, so 14:30 is 14
# and survives REAP_MIN=15. SIGTERM, then SIGKILL for whatever is still alive ~2 s later.
if [ "$REAP_MIN" -gt 0 ] 2>/dev/null; then
  REAPED=$(ps -U "$(id -un)" -o pid=,etime=,command= 2>/dev/null \
    | grep -E '^ *[0-9]+ +[^ ]+ +([^ ]*/)?node ' \
    | grep -E '/(stitch-shot|pixel-compare|chrome-parity|anchor|crop-compare|visual-diff|measure|clip-probe|content-presence|unit-geometry|measure-live)\.mjs( |$)' \
    | grep -v -E 'run-capped|grep|--inspect' \
    | while read -r pid etime cmd; do
        mins=$(printf '%s' "$etime" | awk -F'[-:]' '{ n=NF; m=(n>=2)?$(n-1):0; h=(n>=3)?$(n-2):0; d=(n>=4)?$(n-3):0; printf "%d", d*1440 + h*60 + m }')
        if [ "${mins:-0}" -ge "$REAP_MIN" ]; then
          kill -TERM "$pid" 2>/dev/null && { echo "gate.sh: reaped stale instrument pid $pid (running $etime): $(printf '%s' "$cmd" | grep -oE '[a-z-]+\.mjs' | head -1)" >&2; echo "$pid"; }
        fi
      done)
  if [ -n "$REAPED" ]; then
    sleep 2
    for pid in $REAPED; do
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null && echo "gate.sh: stale instrument pid $pid survived SIGTERM — SIGKILL" >&2
    done
  fi
fi

# Identity assertion — NEVER diff an unverified build URL (two field
# harvests, 2026-08: the same incident in both sessions, opposite directions —
# a stale localhost:8791 server from ANOTHER stardust project served a foreign
# site into a gate round; 73% diff misread as "prototype broke" on one, the
# foreign prototype measured as "the build" on the other. Every skill doc
# suggests the same port, so cross-project collision is guaranteed on a shared
# machine). Fetch the build side and require a page-specific marker: default
# is the <slug> (already in the served filename/URL path, so it normally
# appears in the HTML); pass --marker when the slug string genuinely doesn't
# occur in the page. KNOWN LIMIT of the slug default: when the stale server
# is ANOTHER stardust project sharing the slug (two projects both serving
# home-proposed.html), its page likely contains the slug too and false-
# passes — on shared machines pass --marker with a site-specific string
# (brand name, domain). Runs BEFORE any capture so a collision costs one
# curl, not a gate round. -L: published/preview origins redirect (https,
# trailing slash) — an unfollowed redirect must not read as a mismatch.
PAGE=$(curl -fsSL --max-time 10 "$BUILD_URL" 2>/dev/null) || PAGE=""
if ! printf '%s' "$PAGE" | grep -qiF -- "$MARKER"; then
  echo "gate.sh: IDENTITY ASSERTION FAILED — $BUILD_URL does not serve a page containing \"$MARKER\" (or did not respond)." >&2
  echo "gate.sh: the server on that port is likely another project's (stale http.server?) — not comparing." >&2
  PORT=$(printf '%s' "$BUILD_URL" | sed -nE 's|^[a-z]+://[^:/]+:([0-9]+).*|\1|p')
  if [ -n "$PORT" ]; then
    if command -v lsof >/dev/null 2>&1; then
      echo "gate.sh: port $PORT listener:" >&2
      lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || echo "gate.sh: (nothing listening on :$PORT)" >&2
    else
      # no lsof on this image (recorded): curl is the probe — a 200/404 line means something serves the port, no line means nothing listens
      echo "gate.sh: (no lsof here — probe the port with: curl -sI localhost:$PORT/ | head -1)" >&2
    fi
  fi
  echo "gate.sh: move to a per-project port (never kill a listener you did not start), or pass --marker <string> if the slug legitimately doesn't appear in the page." >&2
  exit 4
fi

# A project copy of stitch-shot.mjs from before the capture record rejects --json: both captures would exit 1 twice
# and read as "re-queue the round". Name the stale copy instead — before any capture.
if ! grep -q -e '--json' "$HERE/stitch-shot.mjs" 2>/dev/null; then
  echo "gate.sh: $HERE/stitch-shot.mjs predates the --json capture record — re-copy it from the plugin (no verdict)" >&2
  exit 1
fi

# Live side: captured once per breakpoint per full gate run and reused
# (--settle: live JS-heavy pages need the lazyload pass — the build side
# settles the same way; STITCH_OPTS: the round's overlay dismissal, header
# § Overlay dismissal). Never swallow the output — exit 3 here means
# "blocked, escalate --headed", not "skip".
# live.json records how live.png was taken (url, width, locale, settle, dismissal, hide list, overlayLeft, fontsFailed
# — a list = checked, null = not checked —, at) — gate-all reads it before reusing live.png; it goes with live.png when
# the capture is retaken (live.png keeps its delete-to-retake rule), and so do the --full probes' live caches (content-,
# visual-, presence-live.json; chrome-live.json keeps its own rule). live.png is reused only when live.json records the
# same hide list (missing field or unreadable record = []; ordered lists after the same dedupe) AND the overlay check
# (overlayLeft present, null); anything else is retaken with one line — the hide-list line when the list is what differs
# (no live.json + hides: nothing says the bar was hidden on that capture), else the overlay one (no live.json or no
# overlayLeft: it predates the check).
# One node call reads both: the hide list, a newline, then checked | unchecked | left <descriptor>.
RETAKE=0
if [ -f "$DIR/live.png" ]; then
  OLD_HIDE=""; OLD_OVL=unchecked
  if [ -f "$DIR/live.json" ]; then
    OLD=$(node -e "$HIDE_JS"'let j = null;
      try { j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); } catch (e) { j = null; }
      const o = j && typeof j === "object" && !Array.isArray(j) ? j : {};
      const ovl = !("overlayLeft" in o) ? "unchecked" : o.overlayLeft === null ? "checked" : `left ${String(o.overlayLeft).replace(/\s+/g, " ")}`;
      process.stdout.write(`${hideList(o.hide).join(",")}\n${ovl}`);' -- "$DIR/live.json")
    OLD_HIDE=${OLD%$'\n'*}; OLD_OVL=${OLD##*$'\n'}; OLD_OVL=${OLD_OVL:-unchecked}
  fi
  if [ ! -f "$DIR/live.json" ] && [ -n "$EFF_HIDE" ]; then
    echo "gate.sh: live.png has no live.json record; this round hides [${EFF_HIDE//,/, }] — retaking it" >&2
    RETAKE=1
  elif [ -f "$DIR/live.json" ] && [ "$OLD_HIDE" != "$EFF_HIDE" ]; then
    echo "gate.sh: live.png was taken hiding [${OLD_HIDE//,/, }]; this round hides [${EFF_HIDE//,/, }] — retaking it" >&2
    RETAKE=1
  elif [ "$OLD_OVL" = unchecked ]; then
    echo "gate.sh: live.png predates the overlay-left check — retaking it" >&2
    RETAKE=1
  elif [ "$OLD_OVL" != checked ]; then
    echo "gate.sh: live.png's live.json records an overlay left (${OLD_OVL#left }) — retaking it" >&2
    RETAKE=1
  fi
fi
# A capture that printed `overlay-left: <descriptor>` (header § Overlay dismissal) gives no verdict: one stderr line,
# return 0 — the caller exits 1. Not a capture error, so never retried. $1 live|build, $2 the capture's stdout file.
overlay_left() {
  grep -qE '^overlay-left: ' "$2" || return 1
  echo "gate.sh: overlay left on the $1 capture — $(grep -E '^overlay-left: ' "$2" | tail -1 | sed -E 's/^overlay-left: //') — no verdict: fix the capture (--consent / --dismiss / --hide), not the page" >&2
}
# A hide selector that matched nothing on live (header § --hide): the live capture's record carries
# hideMiss { sels, candidates } (null when none) → one stderr WARNING line, never a verdict. The text restates
# live-session.mjs's hideMissLine / formatCandidates on purpose (import-free, like HIDE_JS) — keep them in step. An
# absent or unreadable record says nothing (the fontsFailed note covers a fresh capture's).
hide_miss_warn() {
  [ -f "$DIR/live-shot.json" ] || return 0
  node -e 'const fs = require("fs"); let j = null;
    try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (e) { j = null; }
    const m = j && typeof j === "object" && j.hideMiss && typeof j.hideMiss === "object" ? j.hideMiss : null;
    const sels = m && Array.isArray(m.sels) ? m.sels.filter((s) => typeof s === "string" && s) : [];
    if (!sels.length) process.exit(0);
    const list = Array.isArray(m.candidates) ? m.candidates.filter((c) => c && typeof c === "object" && typeof c.selector === "string") : [];
    const one = (c) => { const h = Math.round(Number(c.height) || 0);
      return `${c.selector} (${c.tag}, ${h ? `${h}px` : "0px now — a block that grows later is still hidden by the persistent display:none !important rule"})`; };
    const cands = list.length ? list.map(one).join("; ") : "none found above the header";
    const line = `hide matched nothing on live — candidates: ${cands} (${sels.join(", ")})`;
    fs.writeSync(2, `gate.sh: WARNING ${line.replace(/[\r\n]+/g, " ")}\n`);' -- "$DIR/live-shot.json"
}
if [ "$RETAKE" = 1 ] || [ ! -f "$DIR/live.png" ]; then
  # Its stdout goes to live-capture.txt, then to ours (each attempt rewrites it — the last one decides); its record to
  # live-shot.json (deleted first, so a stale one is never read).
  LIVE_OUT="$DIR/live-capture.txt"
  capture_live() {
    rm -f "$DIR/live.png" "$DIR/live.json" "$DIR/live-shot.json" "$DIR/content-live.json" "$DIR/visual-live.json" "$DIR/presence-live.json"
    LIVE_AT=$(node -e 'process.stdout.write(new Date().toISOString())')
    capped "$STITCH_TIMEOUT" "stitch-shot live $SLUG@$W" node "$HERE/stitch-shot.mjs" "$LIVE_URL" "$DIR/live.png" --width "$W" --settle --json "$DIR/live-shot.json" ${STITCH_OPTS[@]+"${STITCH_OPTS[@]}"} > "$LIVE_OUT"
    local rc=$?
    cat "$LIVE_OUT"
    return $rc
  }
  retry_once "live capture" capture_live
  rc=$?
  [ $rc -ne 0 ] && rm -f "$DIR/live.png" "$DIR/live.json"   # never leave a partial live capture to be reused
  [ $rc -ne 0 ] && { echo "gate.sh: live capture failed (exit $rc) — not comparing$([ $rc -eq 1 ] && printf ' (twice: no verdict — re-queue the round)')" >&2; exit $rc; }
  hide_miss_warn
  if overlay_left live "$LIVE_OUT"; then
    rm -f "$DIR/live.png" "$DIR/live.json" "$DIR/content-live.json" "$DIR/visual-live.json" "$DIR/presence-live.json"
    exit 1
  fi
  # argv-passed values, JSON.stringify — never shell-interpolated JSON; a failed write only costs gate-all's reuse.
  # overlayLeft: null — the capture printed no overlay-left line (above). fontsFailed is three-valued: the record's list
  # (checked; [] = every declared face loaded) or null = not checked — the record's own null (its check could not run)
  # or no readable record (one stderr note). Never [] for an unchecked capture: downstream [] reads as "all loaded".
  node -e 'const fs = require("fs"); const [f, rec, url, w, dismiss, consent, extra, hide, at] = process.argv.slice(1);
    let fontsFailed = null; let read = false;
    try { const j = JSON.parse(fs.readFileSync(rec, "utf8"));
      if (Array.isArray(j.fontsFailed)) { fontsFailed = j.fontsFailed.filter((s) => typeof s === "string"); read = true; } else if (j.fontsFailed === null) read = true;
    } catch (e) { read = false; }
    if (!read) fs.writeSync(2, `gate.sh: the live capture left no readable record (${rec}) — live.json records fontsFailed: null (not checked)\n`);
    fs.writeFileSync(f, `${JSON.stringify({ writtenBy: "gate.sh", url, width: Number(w), locale: "en-US", settle: true,
      dismiss: { off: dismiss === "0", consent: consent || null, extra: extra || null }, hide: hide ? hide.split(",") : [],
      overlayLeft: null, fontsFailed, headed: false, at }, null, 2)}\n`);' \
    -- "$DIR/live.json" "$DIR/live-shot.json" "$LIVE_URL" "$W" "$DISMISS" "$CONSENT" "$DISMISS_EXTRA" "$EFF_HIDE" "$LIVE_AT" \
    || echo "gate.sh: could not write $DIR/live.json — gate-all will not reuse this live.png" >&2
else
  hide_miss_warn   # a reused live.png: its capture's record still names a hide that matched nothing
fi

# Build side: re-captured every iteration; exit 1 retried once (header § Capture retry); settled like the live side
# (--settle: the same lazyload pass and post-load wait) with the same overlay flags — a symmetric instrument (the build
# has nothing to dismiss, so the flags are no-ops there). Its stdout is the overflow evidence (header § Horizontal-
# overflow assert): each attempt rewrites $OVF, so the last one decides; its record goes to build-shot.json (deleted
# first). An overlay-left line there is no verdict (exit 1) — before pixel-compare and the overflow verdict line.
OVF="$DIR/overflow-$LBL.txt"
capture_build() {
  rm -f "$DIR/build-shot.json"
  capped "$STITCH_TIMEOUT" "stitch-shot build $SLUG@$W" node "$HERE/stitch-shot.mjs" "$BUILD_URL" "$DIR/build.png" --width "$W" --settle --json "$DIR/build-shot.json" ${STITCH_OPTS[@]+"${STITCH_OPTS[@]}"} > "$OVF"
  local rc=$?
  cat "$OVF"
  return $rc
}
retry_once "build capture" capture_build
rc=$?
[ $rc -ne 0 ] && { echo "gate.sh: build capture failed (exit $rc) — not comparing$([ $rc -eq 1 ] && printf ' (twice: no verdict — re-queue the round)')" >&2; exit $rc; }
overlay_left build "$OVF" && exit 1

# Horizontal-overflow assert (header § Horizontal-overflow assert): the build capture's own root line — BUILD side
# only, no live hit, no second page load. The verdict line is printed after pixel-compare's so the loop reads
# pixels, then the assert.
LINE=$(grep -E '^overflow: scrollWidth=[0-9]+ viewport=[0-9]+ delta=[0-9]+' "$OVF" | tail -1)
[ -z "$LINE" ] && { echo "gate.sh: the build capture printed no overflow line ($OVF) — re-copy stitch-shot.mjs from the plugin; the assert needs it" >&2; exit 1; }
SW=$(printf '%s' "$LINE" | sed -E 's/^overflow: scrollWidth=([0-9]+) .*/\1/')
VP=$(printf '%s' "$LINE" | sed -E 's/^.* viewport=([0-9]+) .*/\1/')
D=$(printf '%s' "$LINE" | sed -E 's/^.* delta=([0-9]+).*/\1/')
OVER=""
[ "$D" -gt 0 ] && OVER=$D

# pixel-compare supervises its own deadline (--timeout); exit 124 = no verdict.
node "$HERE/pixel-compare.mjs" "$DIR/live.png" "$DIR/build.png" --out "$DIR/diff-$LBL.png" --timeout "$COMPARE_TIMEOUT"
PIXEL_RC=$?
# The overflow assert rules a PASS: a build wider than its viewport by more than the tolerance is a FAIL
# (exit 2) whatever the pixel number says; a round with no pixel verdict (124 / 1 / 3 / 4) keeps that code —
# the line is still printed. Within the tolerance (integer rounding of a subpixel width) the line says so.
if [ -n "$OVER" ] && [ "$OVER" -gt "$OVF_TOL" ]; then
  echo "gate.sh: OVERFLOW at $W — build scrollWidth $SW > viewport $VP (+${OVER}px) → FAIL (hard assert: no iteration cap waives horizontal overflow; evidence $OVF)"
  [ "$PIXEL_RC" = 0 ] && PIXEL_RC=2
elif [ -n "$OVER" ]; then
  echo "gate.sh: overflow assert at $W — build scrollWidth $SW vs viewport $VP (+${OVER}px, within the ${OVF_TOL}px rounding tolerance) → ok"
else
  echo "gate.sh: overflow assert at $W — build scrollWidth $SW = viewport → ok"
fi
[ "$FULL" = 1 ] || exit $PIXEL_RC
# No pixel verdict (124 deadline, 1 error, 3 bot challenge, 4 identity): the probes would spend three
# Chromiums on a round that already has to be re-run — say so in one line and exit with the pixel rc.
case "$PIXEL_RC" in
  0|2) ;;
  *) echo "gate.sh: probes skipped — the pixel round gave no verdict (exit $PIXEL_RC); re-run the round" >&2; exit $PIXEL_RC ;;
esac

# --full: the other Phase 4 probes, each under a deadline — all at once, or at most STARDUST_BROWSERS_PER_SLOT at a
# time while run-bg holds a machine browser slot for this round (header § --full, Concurrency). One recorded round that
# ran them one after another took 15 minutes; in parallel the round costs the slowest probe. Their full reports go to
# evidence files; stdout carries one verdict line each so the loop reads verdicts, not reports.
DIFF="$HERE/../diff"
if [ ! -f "$DIFF/content-diff.mjs" ] || [ ! -f "$DIFF/visual-diff.mjs" ]; then
  echo "gate.sh: --full needs the diff skill's scripts at $DIFF (Setup step 4) — pixel verdict above stands" >&2
  exit $PIXEL_RC
fi
CD="$DIR/content-diff-$LBL.txt"; VD="$DIR/visual-diff-$LBL.txt"; CP="$DIR/chrome-parity-$LBL.txt"
CL="$DIR/clip-$LBL.txt"; PR="$DIR/content-presence-$LBL.txt"; UG="$DIR/units-$LBL.txt"
UNITS_FILE="stardust/replica/units.json"
# The probe bound: PROBE_MAX 0 = every probe at once (no slot held — the fan-out as it always was); with a slot, the
# per-slot value, or 1 when it is unset or not a positive integer (an older run-bg). bash 3.2 has no `wait -n`: the
# launched pids queue in launch order (Q_PID, with the name of each probe's RC_* variable in Q_RC); before a launch,
# while PROBE_MAX or more are unwaited, the OLDEST is waited and its exit code stored in its RC_* (printf -v); after the
# last launch the rest are waited in the same order. Every pid is waited exactly once; a probe never launched keeps 0.
# The bound line (header § --full, Concurrency) adds the remedy when the bound holds back some of this round's probes
# (N_PROBES: the four always launched, content-presence, unit-geometry), and the job's deadline when run-bg exported
# one (RUN_BG_DEADLINE_SEC; 0 = none) below 1800 s — one line, a note only.
RUN_PR=0; [ "$REGIME" = published ] && RUN_PR=1
RUN_UG=0; [ -f "$UNITS_FILE" ] && [ -f "$DIFF/unit-geometry.mjs" ] && RUN_UG=1
N_PROBES=$((4 + RUN_PR + RUN_UG))
PROBE_MAX=0
if [ -n "${STARDUST_BROWSER_SLOT:-}" ]; then
  PER=${STARDUST_BROWSERS_PER_SLOT:-}
  case "$PER" in ''|*[!0-9]*) PROBE_MAX=0 ;; *) PROBE_MAX=$((10#$PER)) ;; esac
  if [ "$PROBE_MAX" -ge 1 ]; then
    WHY="STARDUST_BROWSERS_PER_SLOT=$PER"
  else
    PROBE_MAX=1
    if [ -z "$PER" ]; then WHY="STARDUST_BROWSERS_PER_SLOT unset — an older run-bg"; else WHY="STARDUST_BROWSERS_PER_SLOT='$PER' is not a positive integer"; fi
    WHY="$WHY; 1 is the conservative bound"
  fi
  NOTE=""
  if [ "$PROBE_MAX" -lt "$N_PROBES" ]; then
    NOTE="; this round's $N_PROBES probes take the sum of their times — start a --full round through run-bg with --timeout 1800 (or raise STARDUST_BROWSER_BUDGET)"
    DL=${RUN_BG_DEADLINE_SEC:-}; DLI=${DL%%.*}
    case "$DLI" in ''|*[!0-9]*) ;; *)
      if [ "$((10#$DLI))" -gt 0 ] && [ "$((10#$DLI))" -lt 1800 ]; then NOTE="$NOTE; the job's deadline $DL s may end the round with no verdict (exit 124)"; fi ;;
    esac
  fi
  echo "gate.sh: browser slot held — the --full probes run at most $PROBE_MAX at a time ($WHY)$NOTE" >&2
fi
RC_CD=0; RC_VD=0; RC_CP=0; RC_CL=0; RC_PR=0; RC_UG=0
Q_PID=(); Q_RC=(); Q_HEAD=0
probe_reap() { wait "${Q_PID[$Q_HEAD]}"; printf -v "${Q_RC[$Q_HEAD]}" '%s' "$?"; Q_HEAD=$((Q_HEAD + 1)); }
probe_slot() { [ "$PROBE_MAX" -gt 0 ] || return 0; while [ $(( ${#Q_PID[@]} - Q_HEAD )) -ge "$PROBE_MAX" ]; do probe_reap; done; }
probe_started() { Q_PID+=("$1"); Q_RC+=("$2"); } # $1 the probe's pid ($! right after its launch), $2 its RC_* name
# The effective hide list ($HIDE_OPTS) reaches every probe below but unit-geometry; chrome-parity has its own (above).
probe_slot
capped "$PROBE_TIMEOUT" "content-diff $SLUG@$W" node "$DIFF/content-diff.mjs" "$LIVE_URL" "$BUILD_URL" \
  --profile generic --width "$W" --live-cache "$DIR/content-live.json" --main "$MAIN" ${PROBE_OPTS[@]+"${PROBE_OPTS[@]}"} \
  ${HIDE_OPTS[@]+"${HIDE_OPTS[@]}"} > "$CD" 2>&1 &
probe_started $! RC_CD
probe_slot
capped "$PROBE_TIMEOUT" "visual-diff $SLUG@$W" node "$DIFF/visual-diff.mjs" "$LIVE_URL" "$BUILD_URL" \
  --profile generic --width "$W" --main "$MAIN" ${PROBE_OPTS[@]+"${PROBE_OPTS[@]}"} --out "$DIR/vdiff-$LBL" \
  --live-cache "$DIR/visual-live.json" ${HIDE_OPTS[@]+"${HIDE_OPTS[@]}"} > "$VD" 2>&1 &
probe_started $! RC_VD
probe_slot
capped "$PROBE_TIMEOUT" "chrome-parity $SLUG@$W" node "$HERE/chrome-parity.mjs" "$LIVE_URL" "$BUILD_URL" \
  --width "$W" --live-cache "$DIR/chrome-live.json" ${CHROME_OPTS[@]+"${CHROME_OPTS[@]}"} > "$CP" 2>&1 &
probe_started $! RC_CP
# clip-probe on the BUILD side (every regime, no live hit); content-presence live vs build in the published regime;
# unit-geometry when the project declares repeated-unit families (a slug with none prints n/a, exit 0). The live side
# of content-diff, visual-diff and content-presence comes from its cache file in $DIR while fresh (header § --full).
probe_slot
capped "$PROBE_TIMEOUT" "clip-probe $SLUG@$W" node "$DIFF/clip-probe.mjs" "$BUILD_URL" --width "$W" --json "$DIR/clip-$LBL.json" \
  ${HIDE_OPTS[@]+"${HIDE_OPTS[@]}"} > "$CL" 2>&1 &
probe_started $! RC_CL
P_PR=""; P_UG=""
if [ "$RUN_PR" = 1 ]; then
  probe_slot
  capped "$PROBE_TIMEOUT" "content-presence $SLUG@$W" node "$DIFF/content-presence.mjs" "$LIVE_URL" "$BUILD_URL" --width "$W" --json "$DIR/content-presence-$LBL.json" \
    --origin-cache "$DIR/presence-live.json" ${HIDE_OPTS[@]+"${HIDE_OPTS[@]}"} > "$PR" 2>&1 &
  P_PR=$!; probe_started "$P_PR" RC_PR
fi
if [ "$RUN_UG" = 1 ]; then
  probe_slot
  capped "$PROBE_TIMEOUT" "unit-geometry $SLUG@$W" node "$DIFF/unit-geometry.mjs" "$LIVE_URL" "$BUILD_URL" --families "$UNITS_FILE" --slug "$SLUG" --width "$W" --json "$DIR/units-$LBL.json" > "$UG" 2>&1 &
  P_UG=$!; probe_started "$P_UG" RC_UG
fi
while [ "$Q_HEAD" -lt "${#Q_PID[@]}" ]; do probe_reap; done

verdict() { # $1 rc, $2 label, $3 line
  case "$1" in
    0|2) echo "$2: $3" ;;
    124) echo "$2: DEADLINE (exit 124) — re-run, not a verdict" ;;
    3) echo "$2: BLOCKED (exit 3) — bot challenge on the live side, escalate --headed" ;;
    *) echo "$2: ERROR (exit $1) — $(grep -iE 'error' "$4" | head -1 | cut -c1-160)" ;;
  esac
}
FINDINGS=$(grep -E '^Findings:' "$CD" | head -1 | sed -E 's/^Findings: //')
STRUCTURAL=$(printf '%s' "$FINDINGS" | grep -oE '[0-9]+ structural' | grep -oE '^[0-9]+' || echo 0)
verdict "$RC_CD" "content-diff" "${FINDINGS:-no findings line}" "$CD"
FLAGS=$(awk '/red flags \(advisory\)/{f=1;next} f&&/^[[:space:]]*•/{n++} f&&/^Full metrics/{exit} END{print n+0}' "$VD")
verdict "$RC_VD" "visual-diff" "$FLAGS advisory flag(s) — $(awk '/red flags \(advisory\)/{f=1;next} f&&/^[[:space:]]*•/{sub(/^[[:space:]]*• /,""); printf "%s; ", substr($0,1,60)} f&&/^Full metrics/{exit}' "$VD")" "$VD"
CHROME=$(grep -E '^(✗|✓)' "$CP" | tail -1 | cut -c1-120)
verdict "$RC_CP" "chrome-parity" "${CHROME:-no summary line}" "$CP"
CLIPPED=$(grep -E '^Clipped:' "$CL" | head -1 | cut -c1-160)
verdict "$RC_CL" "clip-probe" "${CLIPPED:-no Clipped line}" "$CL"
CLIP_N=$(printf '%s' "$CLIPPED" | grep -oE '^Clipped: [0-9]+' | grep -oE '[0-9]+$' || echo 0)
PRESENCE_N=0
if [ -n "$P_PR" ]; then
  PRESENCE=$(grep -E '^Content:' "$PR" | head -1 | cut -c1-200)
  verdict "$RC_PR" "content-presence" "${PRESENCE:-no Content line} [published regime]" "$PR"
  PRESENCE_N=$(( $(printf '%s' "$PRESENCE" | grep -oE 'MISSING [0-9]+' | grep -oE '[0-9]+' || echo 0) + $(printf '%s' "$PRESENCE" | grep -oE 'HIDDEN [0-9]+' | grep -oE '[0-9]+' || echo 0) ))
fi
if [ -n "$P_UG" ]; then
  UNITS=$(grep -E '^(Units:|unit-geometry: none declared)' "$UG" | head -1 | cut -c1-200)
  verdict "$RC_UG" "unit-geometry" "${UNITS:-no Units line}" "$UG"
fi
echo "evidence: $CD $VD $CP $CL${P_PR:+ $PR}${P_UG:+ $UG} $DIR/vdiff-$LBL/"

# Exit: any deadline → 124 (re-run); else the pixel verdict rules, and a structural
# content 🔴 or a chrome delta fails the round the same way an over-threshold pixel diff does.
for rc in "$RC_CD" "$RC_VD" "$RC_CP" "$RC_CL" "$RC_PR" "$RC_UG" "$PIXEL_RC"; do [ "$rc" = 124 ] && exit 124; done
[ "$PIXEL_RC" != 0 ] && exit $PIXEL_RC
[ "${STRUCTURAL:-0}" -gt 0 ] 2>/dev/null && exit 2
[ "$RC_CP" = 2 ] && exit 2
# clipped text / controls, a MISSING / HIDDEN link or heading, a required unit off: element defects fail the
# round like an over-threshold pixel diff (#125 — a pixel PASS with every card clipped).
[ "${CLIP_N:-0}" -gt 0 ] 2>/dev/null && exit 2
[ "${PRESENCE_N:-0}" -gt 0 ] 2>/dev/null && exit 2
[ "$RC_UG" = 2 ] && exit 2
# A probe that errored gave no verdict, so the round is not a pass: 3 (bot challenge) passes through,
# anything else is the capture/compare error class (1). Only 0 and 2 carry a verdict.
for rc in "$RC_CD" "$RC_VD" "$RC_CP" "$RC_CL" "$RC_PR" "$RC_UG"; do case "$rc" in 0|2) ;; 3) exit 3 ;; *) exit 1 ;; esac; done
exit 0
