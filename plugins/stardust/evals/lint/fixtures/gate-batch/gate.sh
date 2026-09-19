#!/bin/bash
# Stub gate.sh for gate-batch-fixtures.mjs — same positional contract as the real
# script (slug live build width [label] [--marker m]); the verdict comes from the
# slug: pass → 0 with a record, fail → 2 with a record, slow → sleeps past the
# harness deadline then exits 124 without a record, bot → 3, error → 1.
# Records how many rounds overlap (concurrency proof) in $GATE_STUB_TRACE.
SLUG=$1; W=$4; shift 4
MARKER=""
while [ $# -gt 0 ]; do case "$1" in --marker) MARKER=$2; shift 2 ;; *) shift ;; esac; done
DIR="stardust/replica/gates/$SLUG-$W"; mkdir -p "$DIR"
[ -n "${GATE_STUB_TRACE:-}" ] && echo "start $SLUG $(date +%s%N)" >> "$GATE_STUB_TRACE"
sleep "${GATE_STUB_SLEEP:-0.3}"
case "$SLUG" in
  pass*) printf '{"pixelPct":3.2,"heightDelta":4,"verdict":"PASS","marker":"%s"}\n' "$MARKER" > "$DIR/gate-iter1.json"; echo "iteration 1/3"; echo "regime: prototype  reference: x  record: $DIR/gate-iter1.json"; rc=0 ;;
  fail*) printf '{"pixelPct":18.7,"heightDelta":-31,"verdict":"FAIL"}\n' > "$DIR/gate-iter1.json"; echo "iteration 1/3"; echo "regime: prototype  reference: x  record: $DIR/gate-iter1.json"; rc=2 ;;
  slow*) echo "gate.sh: pixel-compare deadline exceeded (124) — not a measurement" >&2; rc=124 ;;
  bot*) echo "gate.sh: bot challenge on the live side (exit 3)" >&2; rc=3 ;;
  *) echo "gate.sh: capture error" >&2; rc=1 ;;
esac
[ -n "${GATE_STUB_TRACE:-}" ] && echo "end $SLUG $(date +%s%N)" >> "$GATE_STUB_TRACE"
exit $rc
