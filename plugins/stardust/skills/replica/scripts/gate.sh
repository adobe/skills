#!/bin/bash
# skills/replica/scripts/gate.sh — one pixel-gate round in one command
#
# Stitches both sides (live capture CACHED across iterations — hit
# minimization, source-fidelity-gate.md § Iteration discipline), runs the
# horizontal-overflow assert on the build side, runs pixel-compare, and prints
# the verdict lines that drive the loop (size / height delta / differing % /
# hot bands / overflow). The prototype/build side is re-captured every round;
# the live side only when live.png is absent — delete it explicitly to re-take
# (site changed, capture hardening changed).
#
# Usage:
#   stardust/scripts/replica/gate.sh <slug> <live-url> <build-url> <width> [iter-label]
#       [--marker <string>] [--full] [--main <selector>] [--no-dismiss] [--help]
#
# Horizontal-overflow assert (every round, build side only — no live hit):
#   after the build capture, measure.mjs reads document.documentElement's
#   scrollWidth at <width> on the build URL (overflow-<label>.txt in the
#   evidence dir). A document wider than its viewport by more than
#   GATE_OVERFLOW_TOLERANCE px (default 4 — scrollWidth and clientWidth are
#   integers, so a correct page whose widest box is 360.4 px reads +1; the qa
#   skill's rendered sweep fails above the same 4 px) prints
#   `gate.sh: OVERFLOW at <w> — build scrollWidth <n> > viewport <n> (+<n>px) → FAIL`
#   and the round exits 2 whatever the pixel number says; a clean root, or one
#   inside the tolerance, prints `gate.sh: overflow assert at <w> — … → ok`
#   (the px over and the tolerance named). This is the hard assert no
#   iteration cap waives (source-fidelity-gate.md § Iteration discipline): a
#   recorded hands-off run delivered two pages 373 and 400 px wide at a 360
#   viewport and logged them as residuals. gate-evidence.mjs reads the same
#   line, so a PASS pixel line never earns pixel-gate-<w> over an overflow.
#   The probe follows the capture's exit classes (below); a missing
#   measure.mjs or a probe without a root line is exit 1 (fix the copy).
#
# Capture retry: a capture (live, build, or the overflow probe) that exits 1
#   is retried ONCE before the round declares anything — under parallel
#   Chromium load (three rounds in flight, nine Chromiums with --full) a
#   recorded run saw about 8 of 62 sibling rounds exit 1 from the build
#   capture and read them as verdicts. Two exit-1 attempts end the round with
#   exit 1: "no verdict, re-queue the round" — never a FAIL, never a spent
#   iteration. Only exit 1 is retried; 3 (bot challenge), 4 (identity) and
#   124 (deadline) are final on the first attempt.
#
#   --full   the whole probe set in one round: after the pixel verdict the other
#            probes run IN PARALLEL, each under its own deadline — content-diff
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
#            content-presence-<label>.{txt,json}, units-<label>.{txt,json}. Needs the diff skill's
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
#            Concurrency: a --full round holds up to SIX Chromiums at its peak
#            (the probes in parallel); RUN_BG_SLOTS lowers that on a small machine. Start the
#            rounds all at once and let the slots pace them — no sleep staggering.
#   --main <selector>   content root for the diff probes (default: main)
#   --no-dismiss        do not dismiss consent/marketing overlays on the probes
#
# Example (iteration 2 of the home archetype at 1440):
#   stardust/scripts/replica/gate.sh home "https://<site>/" \
#     "http://localhost:8791/home-proposed.html" 1440 iter2
#
# Evidence lands in stardust/replica/gates/<slug>-<width>/
# (live.png, build.png, diff-<label>.png, overflow-<label>.txt).
#
# Fail-loud contract: a stitch-shot bot challenge (exit 3) or capture error
# aborts the round — a missing/blocked side must never be compared. Exit
# codes: 0 gate PASS, 2 gate FAIL (over threshold, or horizontal overflow on
# the build side), 3 bot challenge, 1 capture/compare error (after the one
# retry — re-queue, not a verdict), 4 build-side identity assertion failed
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
#   GATE_STITCH_TIMEOUT  seconds per stitch-shot and per overflow probe (default 300)
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
DISMISS=--dismiss
shift 4
if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then LBL=$1; shift; fi
while [ $# -gt 0 ]; do
  case "$1" in
    --marker) MARKER=${2:?--marker needs a value}; shift 2 ;;
    --full) FULL=1; shift ;;
    --main) MAIN=${2:?--main needs a selector}; shift 2 ;;
    --no-dismiss) DISMISS=""; shift ;;
    --help|-h) sed -n '2,/^set -u$/p' "$0" | grep -E '^#' | sed -E 's/^# ?//'; exit 0 ;;
    *) echo "gate.sh: unknown argument $1 (see --help)" >&2; exit 125 ;;
  esac
done

HERE=$(cd "$(dirname "$0")" && pwd)
DIR="stardust/replica/gates/$SLUG-$W"
mkdir -p "$DIR"

STITCH_TIMEOUT=${GATE_STITCH_TIMEOUT:-300}
COMPARE_TIMEOUT=${GATE_COMPARE_TIMEOUT:-120}
PROBE_TIMEOUT=${GATE_PROBE_TIMEOUT:-300}
OVF_TOL=${GATE_OVERFLOW_TOLERANCE:-4}
case "$OVF_TOL" in ''|*[!0-9]*) echo "gate.sh: GATE_OVERFLOW_TOLERANCE must be a whole number of px (got '$OVF_TOL')" >&2; exit 125 ;; esac
REAP_MIN=${GATE_REAP_MIN:-15}
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

# Live side: captured once per breakpoint per full gate run and reused
# (--settle: live JS-heavy pages need the lazyload pass). Never swallow the
# output — exit 3 here means "blocked, escalate --headed", not "skip".
if [ ! -f "$DIR/live.png" ]; then
  capture_live() { rm -f "$DIR/live.png"; capped "$STITCH_TIMEOUT" "stitch-shot live $SLUG@$W" node "$HERE/stitch-shot.mjs" "$LIVE_URL" "$DIR/live.png" --width "$W" --settle; }
  retry_once "live capture" capture_live
  rc=$?
  [ $rc -ne 0 ] && rm -f "$DIR/live.png"   # never leave a partial live capture to be reused
  [ $rc -ne 0 ] && { echo "gate.sh: live capture failed (exit $rc) — not comparing$([ $rc -eq 1 ] && printf ' (twice: no verdict — re-queue the round)')" >&2; exit $rc; }
fi

# Build side: re-captured every iteration; exit 1 retried once (header § Capture retry).
capture_build() { capped "$STITCH_TIMEOUT" "stitch-shot build $SLUG@$W" node "$HERE/stitch-shot.mjs" "$BUILD_URL" "$DIR/build.png" --width "$W"; }
retry_once "build capture" capture_build
rc=$?
[ $rc -ne 0 ] && { echo "gate.sh: build capture failed (exit $rc) — not comparing$([ $rc -eq 1 ] && printf ' (twice: no verdict — re-queue the round)')" >&2; exit $rc; }

# Horizontal-overflow assert (header § Horizontal-overflow assert): measure.mjs on the BUILD side only —
# no live hit — reads documentElement.scrollWidth at $W; its root line is the evidence. The verdict line
# is printed after pixel-compare's so the loop reads pixels, then the assert.
OVF="$DIR/overflow-$LBL.txt"
[ -f "$HERE/measure.mjs" ] || { echo "gate.sh: $HERE/measure.mjs missing — the overflow assert cannot run; re-copy the replica scripts dir (replica SKILL.md § Setup)" >&2; exit 1; }
probe_overflow() { capped "$STITCH_TIMEOUT" "measure build $SLUG@$W" node "$HERE/measure.mjs" "$BUILD_URL" --selectors html --props display --width "$W" > "$OVF" 2>&1; }
retry_once "overflow probe" probe_overflow
rc=$?
case "$rc" in
  0) ;;
  124) echo "gate.sh: overflow probe hit its deadline (exit 124) — no verdict, re-run the round" >&2; exit 124 ;;
  3) echo "gate.sh: overflow probe blocked (exit 3) on $BUILD_URL — escalate --headed" >&2; exit 3 ;;
  *) echo "gate.sh: overflow probe failed (exit $rc) — no verdict, re-queue the round: $(grep -iE 'measure:' "$OVF" | head -1 | cut -c1-160)" >&2; exit 1 ;;
esac
OVER=$(grep -oE 'OVERFLOW \+[0-9]+px' "$OVF" | head -1 | grep -oE '[0-9]+')
SW=$(grep -oE 'scrollWidth +[0-9]+' "$OVF" | head -1 | grep -oE '[0-9]+$')
VP=$(grep -oE 'viewport +[0-9]+' "$OVF" | head -1 | grep -oE '[0-9]+$')
[ -z "$SW" ] && { echo "gate.sh: overflow probe printed no root line ($OVF) — re-copy measure.mjs from the plugin; the assert needs its root line" >&2; exit 1; }

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

# --full: the other three Phase 4 probes, in parallel, each under a deadline. One
# recorded round that ran them one after another took 15 minutes; in parallel the
# round costs the slowest probe. Their full reports go to evidence files; stdout
# carries one verdict line each so the loop reads verdicts, not reports.
DIFF="$HERE/../diff"
if [ ! -f "$DIFF/content-diff.mjs" ] || [ ! -f "$DIFF/visual-diff.mjs" ]; then
  echo "gate.sh: --full needs the diff skill's scripts at $DIFF (Setup step 4) — pixel verdict above stands" >&2
  exit $PIXEL_RC
fi
CD="$DIR/content-diff-$LBL.txt"; VD="$DIR/visual-diff-$LBL.txt"; CP="$DIR/chrome-parity-$LBL.txt"
CL="$DIR/clip-$LBL.txt"; PR="$DIR/content-presence-$LBL.txt"; UG="$DIR/units-$LBL.txt"
# Regime (gate-evidence.mjs regimeOf semantics): localhost / 127.0.0.1 / file: build URL = prototype, else published.
case "${GATE_REGIME:-auto}" in
  prototype|published) REGIME=$GATE_REGIME ;;
  *) case "$BUILD_URL" in http://localhost*|http://127.0.0.1*|file:*) REGIME=prototype ;; *) REGIME=published ;; esac ;;
esac
UNITS_FILE="stardust/replica/units.json"
capped "$PROBE_TIMEOUT" "content-diff $SLUG@$W" node "$DIFF/content-diff.mjs" "$LIVE_URL" "$BUILD_URL" \
  --profile generic --width "$W" --main "$MAIN" $DISMISS > "$CD" 2>&1 &
P_CD=$!
capped "$PROBE_TIMEOUT" "visual-diff $SLUG@$W" node "$DIFF/visual-diff.mjs" "$LIVE_URL" "$BUILD_URL" \
  --profile generic --width "$W" --main "$MAIN" $DISMISS --out "$DIR/vdiff-$LBL" > "$VD" 2>&1 &
P_VD=$!
capped "$PROBE_TIMEOUT" "chrome-parity $SLUG@$W" node "$HERE/chrome-parity.mjs" "$LIVE_URL" "$BUILD_URL" \
  --width "$W" --live-cache "$DIR/chrome-live.json" > "$CP" 2>&1 &
P_CP=$!
# clip-probe on the BUILD side (every regime, no live hit); content-presence live vs build in the published regime;
# unit-geometry when the project declares repeated-unit families (a slug with none prints n/a, exit 0).
capped "$PROBE_TIMEOUT" "clip-probe $SLUG@$W" node "$DIFF/clip-probe.mjs" "$BUILD_URL" --width "$W" --json "$DIR/clip-$LBL.json" > "$CL" 2>&1 &
P_CL=$!
P_PR=""; P_UG=""
if [ "$REGIME" = published ]; then
  capped "$PROBE_TIMEOUT" "content-presence $SLUG@$W" node "$DIFF/content-presence.mjs" "$LIVE_URL" "$BUILD_URL" --width "$W" --json "$DIR/content-presence-$LBL.json" > "$PR" 2>&1 &
  P_PR=$!
fi
if [ -f "$UNITS_FILE" ] && [ -f "$DIFF/unit-geometry.mjs" ]; then
  capped "$PROBE_TIMEOUT" "unit-geometry $SLUG@$W" node "$DIFF/unit-geometry.mjs" "$LIVE_URL" "$BUILD_URL" --families "$UNITS_FILE" --slug "$SLUG" --width "$W" --json "$DIR/units-$LBL.json" > "$UG" 2>&1 &
  P_UG=$!
fi
wait $P_CD; RC_CD=$?
wait $P_VD; RC_VD=$?
wait $P_CP; RC_CP=$?
wait $P_CL; RC_CL=$?
RC_PR=0; [ -n "$P_PR" ] && { wait $P_PR; RC_PR=$?; }
RC_UG=0; [ -n "$P_UG" ] && { wait $P_UG; RC_UG=$?; }

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
