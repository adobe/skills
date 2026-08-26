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
#   scripts/replica/gate.sh <slug> <live-url> <build-url> <width> [iter-label]
#
# Example (iteration 2 of the home archetype at 1440):
#   scripts/replica/gate.sh home "https://<site>/" \
#     "http://localhost:8791/home-proposed.html" 1440 iter2
#
# Evidence lands in stardust/replica/gates/<slug>-<width>/
# (live.png, build.png, diff-<label>.png).
#
# Fail-loud contract: a stitch-shot bot challenge (exit 3) or capture error
# aborts the round — a missing/blocked side must never be compared. Exit
# codes: 0 gate PASS, 2 gate FAIL (over threshold), 3 bot challenge,
# 1 capture/compare error.
set -u

SLUG=${1:?usage: gate.sh <slug> <live-url> <build-url> <width> [iter-label]}
LIVE_URL=${2:?missing <live-url>}
BUILD_URL=${3:?missing <build-url>}
W=${4:?missing <width>}
LBL=${5:-iter}

HERE=$(cd "$(dirname "$0")" && pwd)
DIR="stardust/replica/gates/$SLUG-$W"
mkdir -p "$DIR"

# Live side: captured once per breakpoint per full gate run and reused
# (--settle: live JS-heavy pages need the lazyload pass). Never swallow the
# output — exit 3 here means "blocked, escalate --headed", not "skip".
if [ ! -f "$DIR/live.png" ]; then
  node "$HERE/stitch-shot.mjs" "$LIVE_URL" "$DIR/live.png" --width "$W" --settle
  rc=$?
  [ $rc -ne 0 ] && { echo "gate.sh: live capture failed (exit $rc) — not comparing" >&2; exit $rc; }
fi

# Build side: re-captured every iteration.
node "$HERE/stitch-shot.mjs" "$BUILD_URL" "$DIR/build.png" --width "$W"
rc=$?
[ $rc -ne 0 ] && { echo "gate.sh: build capture failed (exit $rc) — not comparing" >&2; exit $rc; }

node "$HERE/pixel-compare.mjs" "$DIR/live.png" "$DIR/build.png" --out "$DIR/diff-$LBL.png"
