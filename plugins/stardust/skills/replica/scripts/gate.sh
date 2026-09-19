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
#   stardust/scripts/replica/gate.sh <slug> <live-url> <build-url> <width> [iter-label] \
#     [--marker <string>] [--live-from-capture <png>] [--regime prototype|published-origin]
#
#   --live-from-capture <png>  use an EXTRACT capture as the live reference
#     instead of stitching live (bot-walled sites where only the extraction's
#     hand-solved capture exists). The PNG (+ its <png>.json when present) is
#     copied in as live.png; a missing sidecar is synthesized with
#     source: extract-capture, instrument.name extract-capture, width from the
#     PNG header, capturedAt from the file's mtime, dpr 1. The compare is then
#     mixed-instrument by construction: gate.sh passes --force, says so on
#     every round that reuses the imported reference, and the record carries
#     forced — a number to read, not a gate number. Delete live.png to go back
#     to a stitched reference.
#
# Example (iteration 2 of the home archetype at 1440):
#   stardust/scripts/replica/gate.sh home "https://<site>/" \
#     "http://localhost:8791/home-proposed.html" 1440 iter2
#
# Evidence lands in stardust/replica/gates/<slug>-<width>/
# (live.png, build.png, diff-<label>.png, gate-<label>.json).
#
# gate-<label>.json is the round's RECORD — pixel-compare's --json-out
# (pixelPct, pixelPctUnmasked, masks[] with area %, heightDelta, bands) plus
# what only this script knows: regime (prototype when the build URL is a
# local server, published-origin otherwise; --regime overrides the heuristic
# for a prototype served over https/a tunnel), ref { url, width, capturedAt }
# for the live capture the number was measured against, and the verdict.
# The ledger's `result` (source-fidelity-gate.md § Residual logging format)
# is copied from this file, never typed.
#
# Fail-loud contract: a stitch-shot bot challenge (exit 3) or capture error
# aborts the round — a missing/blocked side must never be compared. Exit
# codes: 0 gate PASS, 2 gate FAIL (over threshold), 3 bot challenge,
# 1 capture/compare error (incl. incomparable captures), 4 build-side
# identity assertion failed (the URL serves something that isn't this
# project's page — wrong/stale server), 5 invalid capture — no verdict,
# never a FAIL (consent dialog still present after the dismissal window —
# in deny mode nothing to reject, in accept mode nothing matched: pass
# --consent <sel> via the crawl log's consent.method, or GATE_ALLOW_CONSENT=1;
# live settled height < 40 % of the crawl screenshot's after one retry;
# error-boundary page; an overlay still covering > 30 % of the first
# viewport — the partial PNG is removed, nothing is cached), 124 instrument
# deadline exceeded (not a measurement — see below).
#
# Comparable captures (gate doc § Hardening rule 15): both sides are taken by
# stitch-shot with the same width, vh, dpr and CONSENT MODE, and each PNG
# carries its provenance sidecar (<png>.json). A cached live.png WITHOUT a
# sidecar is a pre-sidecar capture of unknown instrument state: it is deleted
# and re-taken (one loud line) rather than compared. The consent mode comes
# from GATE_CONSENT_MODE, else stardust/replica/progress.json#captureState.consent,
# else accept — and is passed to BOTH captures so the pair stays comparable.
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
#   GATE_ALLOW_CONSENT=1 pass --allow-consent to BOTH captures (a consent
#                        container that survives dismissal is otherwise exit 5)
set -u

SLUG=${1:?usage: gate.sh <slug> <live-url> <build-url> <width> [iter-label] [--marker <string>] [--live-from-capture <png>] [--regime prototype|published-origin]}
LIVE_URL=${2:?missing <live-url>}
BUILD_URL=${3:?missing <build-url>}
W=${4:?missing <width>}
shift 4
LBL=iter
case "${1:-}" in ''|--*) ;; *) LBL=$1; shift ;; esac
MARKER="$SLUG"
FROM_CAPTURE=""
REGIME_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --marker) MARKER=${2:?--marker needs a value}; shift 2 ;;
    --live-from-capture) FROM_CAPTURE=${2:?--live-from-capture needs a <png>}; shift 2 ;;
    --regime) REGIME_OVERRIDE=${2:?--regime needs prototype|published-origin}; shift 2
      case "$REGIME_OVERRIDE" in prototype|published-origin) ;; *) echo "gate.sh: --regime must be prototype or published-origin (got $REGIME_OVERRIDE)" >&2; exit 125 ;; esac ;;
    *) echo "gate.sh: unknown argument $1 (usage: gate.sh <slug> <live-url> <build-url> <width> [iter-label] [--marker <string>] [--live-from-capture <png>] [--regime prototype|published-origin])" >&2; exit 125 ;;
  esac
done

HERE=$(cd "$(dirname "$0")" && pwd)
DIR="stardust/replica/gates/$SLUG-$W"
mkdir -p "$DIR"

STITCH_TIMEOUT=${GATE_STITCH_TIMEOUT:-300}
CONSENT_MODE=${GATE_CONSENT_MODE:-}
[ -z "$CONSENT_MODE" ] && CONSENT_MODE=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("stardust/replica/progress.json","utf8"));process.stdout.write(j.captureState&&j.captureState.consent||"")}catch{}' 2>/dev/null)
CONSENT_MODE=${CONSENT_MODE:-accept}
COMPARE_TIMEOUT=${GATE_COMPARE_TIMEOUT:-120}
STITCH_COMMON=""
[ "${GATE_ALLOW_CONSENT:-0}" = "1" ] && STITCH_COMMON="--allow-consent"
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
FORCE=""
if [ -n "$FROM_CAPTURE" ]; then
  [ -f "$FROM_CAPTURE" ] || { echo "gate.sh: --live-from-capture $FROM_CAPTURE not found" >&2; exit 1; }
  cp "$FROM_CAPTURE" "$DIR/live.png"
  node - "$FROM_CAPTURE" "$DIR/live.png" "$LIVE_URL" "$CONSENT_MODE" <<'NODE'
const fs = require('fs');
const [src, dst, url, mode] = process.argv.slice(2);
let side = null; try { side = JSON.parse(fs.readFileSync(`${src}.json`, 'utf8')); } catch { /* synthesize */ }
if (!side) {
  const buf = fs.readFileSync(src);
  const width = buf.readUInt32BE(16); const height = buf.readUInt32BE(20); // PNG IHDR
  side = { url, width, vh: null, dpr: 1, capturedAt: fs.statSync(src).mtime.toISOString(), instrument: { name: 'extract-capture', version: null, options: {} },
    consent: { mode, via: 'unknown' }, dismissed: [], fontsFailed: [], docHeight: height, chunks: null, technique: 'extract-capture', synthesized: true };
}
side.source = 'extract-capture'; side.importedFrom = src;
fs.writeFileSync(`${dst}.json`, `${JSON.stringify(side, null, 2)}\n`);
console.log(`gate.sh: live reference imported from ${src} (source: extract-capture${side.synthesized ? ', sidecar synthesized from the PNG header + mtime' : ''}) — MIXED INSTRUMENT vs the stitch-shot build side: comparing with --force once; this number carries forced and is not a gate number.`);
NODE
  FORCE="--force"
elif [ -f "$DIR/live.png.json" ] && node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(j.source==="extract-capture"?0:1)' "$DIR/live.png.json" 2>/dev/null; then
  echo "gate.sh: live.png is an IMPORTED extract capture (source: extract-capture) — mixed instrument vs the stitch-shot build side: comparing with --force; this number carries forced and is not a gate number. Delete $DIR/live.png to stitch a live reference instead." >&2
  FORCE="--force"
fi
if [ -f "$DIR/live.png" ] && [ ! -f "$DIR/live.png.json" ]; then
  echo "gate.sh: $DIR/live.png has no provenance sidecar (pre-sidecar capture, instrument state unknown) — treating it as stale and re-capturing" >&2
  rm -f "$DIR/live.png"
fi
# Short-capture guard for the LIVE side: when the extract crawl's screenshot
# of this page exists, its height (PNG IHDR, no deps) is the expectation —
# a valid capture at any width is never < 40 % of it (a 360 page reflows
# taller, not shorter). stitch-shot retries once, then exits 5. The build
# side is not guarded this way: an in-progress prototype may legitimately be
# short, and the height-delta bar already fails it honestly.
EXPECT=""
[ -f "stardust/current/assets/screenshots/$SLUG.png" ] && EXPECT=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(20)))' "stardust/current/assets/screenshots/$SLUG.png" 2>/dev/null)
EXPECT_ARGS=""
[ -n "$EXPECT" ] && [ "$EXPECT" -gt 0 ] 2>/dev/null && EXPECT_ARGS="--expect-height $EXPECT"
if [ ! -f "$DIR/live.png" ]; then
  # shellcheck disable=SC2086
  capped "$STITCH_TIMEOUT" "stitch-shot live $SLUG@$W" node "$HERE/stitch-shot.mjs" "$LIVE_URL" "$DIR/live.png" --width "$W" --settle --consent-mode "$CONSENT_MODE" $EXPECT_ARGS $STITCH_COMMON
  rc=$?
  [ $rc -eq 124 ] && rm -f "$DIR/live.png" "$DIR/live.png.json"   # never leave a partial live capture to be reused
  [ $rc -eq 5 ] && { rm -f "$DIR/live.png" "$DIR/live.png.json"; echo "gate.sh: live capture INVALID (exit 5: short capture / overlay / error page / consent not deniable) — not a verdict, never a FAIL; nothing cached" >&2; exit 5; }
  [ $rc -ne 0 ] && { echo "gate.sh: live capture failed (exit $rc) — not comparing" >&2; exit $rc; }
fi

# Build side: re-captured every iteration.
# shellcheck disable=SC2086
capped "$STITCH_TIMEOUT" "stitch-shot build $SLUG@$W" node "$HERE/stitch-shot.mjs" "$BUILD_URL" "$DIR/build.png" --width "$W" --consent-mode "$CONSENT_MODE" $STITCH_COMMON
rc=$?
[ $rc -eq 5 ] && { rm -f "$DIR/build.png" "$DIR/build.png.json"; echo "gate.sh: build capture INVALID (exit 5: overlay / error page / consent not deniable) — not a verdict, never a FAIL" >&2; exit 5; }
[ $rc -ne 0 ] && { echo "gate.sh: build capture failed (exit $rc) — not comparing" >&2; exit $rc; }

# pixel-compare supervises its own deadline (--timeout); exit 124 = no verdict.
# shellcheck disable=SC2086
node "$HERE/pixel-compare.mjs" "$DIR/live.png" "$DIR/build.png" --out "$DIR/diff-$LBL.png" --timeout "$COMPARE_TIMEOUT" --json-out "$DIR/gate-$LBL.json" $FORCE
rc=$?

# Round record: regime + reference + verdict are EMITTED here (see header) so
# the ledger copies them. capturedAt comes from the live capture's own
# provenance sidecar when it has one, else from live.png's mtime. Regime:
# local-server heuristic, --regime overrides (https://localhost, tunnels).
case "$BUILD_URL" in
  http://localhost*|http://127.*|http://\[::1\]*|http://0.0.0.0*|file:*) REGIME=prototype ;;
  *) REGIME=published-origin ;;
esac
REGIME=${REGIME_OVERRIDE:-$REGIME}
if [ -f "$DIR/gate-$LBL.json" ]; then
  node - "$DIR/gate-$LBL.json" "$DIR/live.png" "$SLUG" "$LBL" "$W" "$LIVE_URL" "$BUILD_URL" "$REGIME" "$rc" <<'NODE'
const fs = require('fs');
const [rec, live, slug, label, width, liveUrl, buildUrl, regime, rcStr] = process.argv.slice(2);
const rc = Number(rcStr);
const j = JSON.parse(fs.readFileSync(rec, 'utf8'));
let side = null; try { side = JSON.parse(fs.readFileSync(`${live}.json`, 'utf8')); } catch { /* no sidecar: mtime */ }
const capturedAt = side?.capturedAt || fs.statSync(live).mtime.toISOString();
const out = { slug, label, width: Number(width), regime,
  ref: { url: liveUrl, width: Number(width), capturedAt, ...(side ? { sidecar: `${live}.json`, instrument: side.instrument && side.instrument.name, technique: side.technique, consent: side.consent } : { source: 'mtime' }) },
  build: { url: buildUrl }, verdict: rc === 0 ? 'PASS' : rc === 2 ? 'FAIL' : 'no-verdict', exit: rc, ...j };
fs.writeFileSync(rec, `${JSON.stringify(out, null, 2)}\n`);
console.log(`regime: ${regime}  reference: ${liveUrl} @${width} captured ${capturedAt}${side ? ` via ${side.technique || side.instrument?.name || 'unknown'}${side.source && side.source !== 'stitch-shot' ? ` (source: ${side.source})` : ''}` : ' (live.png mtime)'}${j.forced ? '  FORCED (incomparable captures — not a gate number)' : ''}  record: ${rec}`);
NODE
fi
exit $rc
