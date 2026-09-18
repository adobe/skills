#!/bin/bash
# skills/replica/scripts/gate.sh — one pixel-gate round in one command
#
# Stitches both sides (live capture CACHED across iterations — hit
# minimization, source-fidelity-gate.md § Iteration discipline), runs
# pixel-compare, and prints the verdict lines that drive the loop (size /
# height delta / differing % / hot bands). The prototype/build side is
# re-captured every round; the live side only when live.png is absent —
# delete it explicitly to re-take (site changed, capture hardening changed).
#
# Usage:
#   stardust/scripts/replica/gate.sh <slug> <live-url> <build-url> <width> [iter-label]
#       [--marker <string>] [--full] [--main <selector>] [--no-dismiss] [--help]
#
#   --full   the whole Phase 4 probe set in one round: after the pixel verdict the
#            three other probes run IN PARALLEL, each under its own deadline —
#            content-diff (structural 🔴 count), visual-diff (advisory flags),
#            chrome-parity (header/footer deltas, live side cached) — and only
#            their verdict lines are printed. Evidence per probe lands next to the
#            pixel evidence: content-diff-<label>.txt, visual-diff-<label>.txt +
#            vdiff-<label>/, chrome-parity-<label>.txt. Needs the diff skill's
#            scripts at stardust/scripts/diff/ (Setup step 4). The build URL may be
#            a served prototype or the published/preview origin — the published-
#            origin gate is the same command with the preview URL (pass --marker
#            when the slug string does not occur in the served page).
#            Exit with --full: 124 on any deadline; else the pixel verdict, then 2
#            on a structural 🔴 or a chrome delta, 1 when a probe errored (it gave
#            no verdict), 0 only when all four ran and passed.
#   --main <selector>   content root for the diff probes (default: main)
#   --no-dismiss        do not dismiss consent/marketing overlays on the probes
#
# Example (iteration 2 of the home archetype at 1440):
#   stardust/scripts/replica/gate.sh home "https://<site>/" \
#     "http://localhost:8791/home-proposed.html" 1440 iter2
#
# Evidence lands in stardust/replica/gates/<slug>-<width>/
# (live.png, build.png, diff-<label>.png).
#
# Fail-loud contract: a stitch-shot bot challenge (exit 3) or capture error
# aborts the round — a missing/blocked side must never be compared. Exit
# codes: 0 gate PASS, 2 gate FAIL (over threshold), 3 bot challenge,
# 1 capture/compare error, 4 build-side identity assertion failed (the URL
# serves something that isn't this project's page — wrong/stale server),
# 124 instrument deadline exceeded (not a measurement — see below).
#
# Instrument deadlines + stale reap: every node step runs under
# run-capped.mjs (macOS has no `timeout`). Three field migrations (2026-08/09)
# recorded stitch-shot / pixel-compare sitting at 0 % CPU for 10+ minutes;
# the leftover processes from earlier rounds (and from OTHER projects on a
# shared machine — 8 found in one run) held Chromium + memory and slowed every
# later round, and agents responded with ad-hoc `sleep 150; kill` loops that
# burned a fixed 30 min per page. Before a round this script kills this
# user's replica instruments older than GATE_REAP_MIN minutes (a healthy
# capture or compare finishes in seconds to a few minutes). Overrides:
#   GATE_STITCH_TIMEOUT  seconds per stitch-shot          (default 300)
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
REAP_MIN=${GATE_REAP_MIN:-15}
capped() { local t=$1 l=$2; shift 2; node "$HERE/run-capped.mjs" --timeout "$t" --label "$l" -- "$@"; }

# Stale-instrument reap (own user, replica instruments only, by basename so the
# plugin tree and the project copy both match). ps etime is [[dd-]hh:]mm:ss.
if [ "$REAP_MIN" -gt 0 ] 2>/dev/null; then
  ps -U "$(id -un)" -o pid=,etime=,command= 2>/dev/null \
    | grep -E '/(stitch-shot|pixel-compare|chrome-parity|anchor|crop-compare|visual-diff)\.mjs( |$)' \
    | grep -v -E 'run-capped|grep' \
    | while read -r pid etime cmd; do
        mins=$(printf '%s' "$etime" | awk -F'[-:]' '{ n=NF; s=$n; m=(n>=2)?$(n-1):0; h=(n>=3)?$(n-2):0; d=(n>=4)?$(n-3):0; printf "%d", d*1440 + h*60 + m + (s>=30?1:0) }')
        if [ "${mins:-0}" -ge "$REAP_MIN" ]; then
          kill -9 "$pid" 2>/dev/null && echo "gate.sh: reaped stale instrument pid $pid (running $etime): $(printf '%s' "$cmd" | grep -oE '[a-z-]+\.mjs' | head -1)" >&2
        fi
      done
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
    echo "gate.sh: port $PORT listener:" >&2
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || echo "gate.sh: (nothing listening on :$PORT)" >&2
  fi
  echo "gate.sh: kill/replace the stale server, or pass --marker <string> if the slug legitimately doesn't appear in the page." >&2
  exit 4
fi

# Live side: captured once per breakpoint per full gate run and reused
# (--settle: live JS-heavy pages need the lazyload pass). Never swallow the
# output — exit 3 here means "blocked, escalate --headed", not "skip".
if [ ! -f "$DIR/live.png" ]; then
  capped "$STITCH_TIMEOUT" "stitch-shot live $SLUG@$W" node "$HERE/stitch-shot.mjs" "$LIVE_URL" "$DIR/live.png" --width "$W" --settle
  rc=$?
  [ $rc -eq 124 ] && rm -f "$DIR/live.png"   # never leave a partial live capture to be reused
  [ $rc -ne 0 ] && { echo "gate.sh: live capture failed (exit $rc) — not comparing" >&2; exit $rc; }
fi

# Build side: re-captured every iteration.
capped "$STITCH_TIMEOUT" "stitch-shot build $SLUG@$W" node "$HERE/stitch-shot.mjs" "$BUILD_URL" "$DIR/build.png" --width "$W"
rc=$?
[ $rc -ne 0 ] && { echo "gate.sh: build capture failed (exit $rc) — not comparing" >&2; exit $rc; }

# pixel-compare supervises its own deadline (--timeout); exit 124 = no verdict.
node "$HERE/pixel-compare.mjs" "$DIR/live.png" "$DIR/build.png" --out "$DIR/diff-$LBL.png" --timeout "$COMPARE_TIMEOUT"
PIXEL_RC=$?
[ "$FULL" = 1 ] || exit $PIXEL_RC

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
capped "$PROBE_TIMEOUT" "content-diff $SLUG@$W" node "$DIFF/content-diff.mjs" "$LIVE_URL" "$BUILD_URL" \
  --profile generic --width "$W" --main "$MAIN" $DISMISS > "$CD" 2>&1 &
P_CD=$!
capped "$PROBE_TIMEOUT" "visual-diff $SLUG@$W" node "$DIFF/visual-diff.mjs" "$LIVE_URL" "$BUILD_URL" \
  --profile generic --width "$W" --main "$MAIN" $DISMISS --out "$DIR/vdiff-$LBL" > "$VD" 2>&1 &
P_VD=$!
capped "$PROBE_TIMEOUT" "chrome-parity $SLUG@$W" node "$HERE/chrome-parity.mjs" "$LIVE_URL" "$BUILD_URL" \
  --width "$W" --live-cache "$DIR/chrome-live.json" > "$CP" 2>&1 &
P_CP=$!
wait $P_CD; RC_CD=$?
wait $P_VD; RC_VD=$?
wait $P_CP; RC_CP=$?

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
echo "evidence: $CD $VD $CP $DIR/vdiff-$LBL/"

# Exit: any deadline → 124 (re-run); else the pixel verdict rules, and a structural
# content 🔴 or a chrome delta fails the round the same way an over-threshold pixel diff does.
for rc in "$RC_CD" "$RC_VD" "$RC_CP" "$PIXEL_RC"; do [ "$rc" = 124 ] && exit 124; done
[ "$PIXEL_RC" != 0 ] && exit $PIXEL_RC
[ "${STRUCTURAL:-0}" -gt 0 ] 2>/dev/null && exit 2
[ "$RC_CP" = 2 ] && exit 2
# A probe that errored gave no verdict, so the round is not a pass: 3 (bot challenge) passes through,
# anything else is the capture/compare error class (1). Only 0 and 2 carry a verdict.
for rc in "$RC_CD" "$RC_VD" "$RC_CP"; do case "$rc" in 0|2) ;; 3) exit 3 ;; *) exit 1 ;; esac; done
exit 0
