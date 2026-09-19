#!/bin/bash
# skills/replica/scripts/gate.sh — one pixel-gate round in one command
#
# Stitches both sides (live capture CACHED across iterations — hit
# minimization, source-fidelity-gate.md § Iteration discipline), runs
# pixel-compare, and prints the verdict lines that drive the loop (size /
# height delta / differing % / hot bands). The prototype/build side is
# re-captured every round; the live side only when live.png is absent, has
# no sidecar, or the freshness probe below finds LIVE DRIFT (delete it
# explicitly when capture hardening changed).
#
# Usage:
#   stardust/scripts/replica/gate.sh <slug> <live-url> <build-url> <width> [iter-label] \
#     [--marker <string>] [--live-from-capture <png>] [--regime prototype|published-origin] \
#     [--refresh] [--variance]
#
#   --refresh   force the live-drift probe on a cached live.png (one anchor.mjs
#     hit) instead of waiting for the reference to age past GATE_REF_MAX_AGE_H.
#   --variance  live self-noise grade, once per gate dir: a SECOND live capture
#     (live-b.png) compared against live.png → variance.json; prints
#     `noise floor N %` and the hot bands as --mask suggestions. Opt-in: it is
#     a second live hit per breakpoint — the doc names the two triggers
#     (published-origin gate; first round of an archetype whose dynamics
#     inventory lists index-backed/personalised rows) and says never on
#     hard-CDN sites. The floor is PRINTED beside the raw number every later
#     round and recorded as noiseFloor{}; it is never subtracted from it and
#     never moves the bar.
#
# Reference freshness (instrument, not prose): a stale reference is not a
# residual (field: a one-day-old reference read 5 % where a fresh one read
# 31 %; a campaign hero rotated three times in four days). When live.png is
# older than GATE_REF_MAX_AGE_H hours (default 24; sidecar capturedAt, else
# mtime, else the last freshness check) or --refresh is given, ONE fresh
# anchor.mjs --json probe (never --cache — a cache hit is zero live hits and
# nothing to compare) is compared against the sidecar docHeight / cached
# anchor-live.json. Over the bounded threshold
#   |Δh| > max(1 % of height, GATE_DRIFT_PX (default 24), recorded self-noise Δh)
#   OR the top-level section count changed
# the round prints `LIVE DRIFT Δh <px> sections <a→b> — recapturing`, deletes
# ALL THREE live caches together (live.png + .json, anchor-live.json,
# chrome-live.json — a recaptured PNG next to a stale chrome/anchor cache is
# the mixed-reference bug one level down), stores the fresh probe as the new
# anchor-live.json (the hit is not wasted) and records liveDrift{} in the
# round record. A probe that hits its deadline (124) or is blocked skips the
# check with a printed reason — never a FAIL, never a recapture. The bounded
# threshold is what keeps one live.png per breakpoint as the round's truth on
# pages whose height varies ±700 px between loads; without it every round
# would recapture. Below the threshold the check is recorded in
# freshness.json so the probe is not repeated every round.
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
# (live.png, build.png, diff-<label>.png, gate-<label>.json; freshness.json
# after a within-threshold drift check; live-b.png + variance.json after
# --variance).
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
# project's page — wrong/stale server), 5 invalid capture (consent dialog
# present, --consent-mode deny impossible — no verdict), 124 instrument
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
set -u

USAGE="usage: gate.sh <slug> <live-url> <build-url> <width> [iter-label] [--marker <string>] [--live-from-capture <png>] [--regime prototype|published-origin] [--refresh] [--variance]"
case "${1:-}" in --help|-h) sed -n '2,/^set -u/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;; esac
SLUG=${1:?$USAGE}
LIVE_URL=${2:?missing <live-url>}
BUILD_URL=${3:?missing <build-url>}
W=${4:?missing <width>}
shift 4
LBL=iter
case "${1:-}" in ''|--*) ;; *) LBL=$1; shift ;; esac
MARKER="$SLUG"
FROM_CAPTURE=""
REGIME_OVERRIDE=""
REFRESH=""
VARIANCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --marker) MARKER=${2:?--marker needs a value}; shift 2 ;;
    --live-from-capture) FROM_CAPTURE=${2:?--live-from-capture needs a <png>}; shift 2 ;;
    --regime) REGIME_OVERRIDE=${2:?--regime needs prototype|published-origin}; shift 2
      case "$REGIME_OVERRIDE" in prototype|published-origin) ;; *) echo "gate.sh: --regime must be prototype or published-origin (got $REGIME_OVERRIDE)" >&2; exit 125 ;; esac ;;
    --refresh) REFRESH=1; shift ;;
    --variance) VARIANCE=1; shift ;;
    *) echo "gate.sh: unknown argument $1 ($USAGE)" >&2; exit 125 ;;
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

# Reference freshness (see header): probe only when the cached reference is
# older than GATE_REF_MAX_AGE_H or --refresh asked; never on an imported
# extract capture (there is no live page it claims to equal).
DRIFT_JSON=""
if [ -f "$DIR/live.png" ] && [ -z "$FORCE" ]; then
  REF_MAX_AGE_H=${GATE_REF_MAX_AGE_H:-24}
  STALE=$(node - "$DIR/live.png" "$REF_MAX_AGE_H" "${REFRESH:-0}" <<'NODE'
const fs = require('fs');
const [live, maxH, refresh] = process.argv.slice(2);
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const side = read(`${live}.json`);
const fresh = read(`${live.replace(/live\.png$/, 'freshness.json')}`);
const capturedAt = side?.capturedAt || fs.statSync(live).mtime.toISOString();
const last = [capturedAt, fresh?.checkedAt].filter(Boolean).map((t) => Date.parse(t)).filter(Number.isFinite);
const ageH = (Date.now() - Math.max(...last)) / 36e5;
process.stdout.write(refresh === '1' || ageH > Number(maxH) ? `stale ${ageH.toFixed(1)}` : `fresh ${ageH.toFixed(1)}`);
NODE
)
  case "$STALE" in
    stale*)
      echo "gate.sh: reference $DIR/live.png is ${STALE#stale } h old${REFRESH:+ (--refresh)} — one fresh anchor probe to check for live drift" >&2
      PROBE="$DIR/.anchor-probe.json"
      capped "$STITCH_TIMEOUT" "anchor probe live $SLUG@$W" node "$HERE/anchor.mjs" "$LIVE_URL" --width "$W" --json --consent-mode "$CONSENT_MODE" > "$PROBE"
      prc=$?
      if [ $prc -ne 0 ]; then
        echo "gate.sh: drift check skipped — anchor probe exit $prc ($([ $prc -eq 124 ] && echo 'deadline, no verdict' || echo 'blocked/error')); comparing against the cached reference as-is" >&2
        rm -f "$PROBE"
      else
        DRIFT_JSON=$(node - "$DIR" "$PROBE" "$LIVE_URL" "$W" "${GATE_DRIFT_PX:-24}" <<'NODE'
const fs = require('fs');
const [dir, probePath, url, width, driftPx] = process.argv.slice(2);
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const probe = read(probePath);
const side = read(`${dir}/live.png.json`);
const cache = read(`${dir}/anchor-live.json`);
const variance = read(`${dir}/variance.json`);
const docBefore = side?.docHeight ?? cache?.data?.doc ?? null;
const sectionsBefore = cache?.data?.sections?.length ?? null;
const docAfter = probe?.doc ?? null;
const sectionsAfter = Array.isArray(probe?.sections) ? probe.sections.length : null;
const out = { checkedAt: new Date().toISOString(), previousCapturedAt: side?.capturedAt || fs.statSync(`${dir}/live.png`).mtime.toISOString(), docBefore, docAfter, sectionsBefore, sectionsAfter, drift: false };
if (docBefore == null || docAfter == null) { out.skipped = 'no reference height (sidecar docHeight / anchor-live.json)'; }
else {
  const noise = Math.abs(Number(variance?.heightDelta) || 0);
  out.thresholdPx = Math.max(Math.round(docBefore / 100), Number(driftPx) || 0, noise);
  out.deltaPx = docAfter - docBefore;
  out.drift = Math.abs(out.deltaPx) > out.thresholdPx || (sectionsBefore != null && sectionsAfter != null && sectionsBefore !== sectionsAfter);
}
if (out.drift) {
  for (const f of ['live.png', 'live.png.json', 'anchor-live.json', 'chrome-live.json', 'freshness.json']) fs.rmSync(`${dir}/${f}`, { force: true });
  fs.writeFileSync(`${dir}/anchor-live.json`, `${JSON.stringify({ key: { url, width: Number(width), main: probe.main || 'main' }, probedAt: out.checkedAt, data: { doc: probe.doc, rootMissing: probe.rootMissing, rootWrapsChrome: probe.rootWrapsChrome, sections: probe.sections, footer: probe.footer } }, null, 2)}\n`);
  console.error(`gate.sh: LIVE DRIFT Δh ${out.deltaPx > 0 ? '+' : ''}${out.deltaPx}px (threshold ${out.thresholdPx}px) sections ${sectionsBefore ?? '?'}→${sectionsAfter ?? '?'} — recapturing live.png; anchor-live.json and chrome-live.json invalidated together (a stale reference is not a residual — this round does not count against the cap)`);
} else {
  fs.writeFileSync(`${dir}/freshness.json`, `${JSON.stringify(out, null, 2)}\n`);
  console.error(out.skipped ? `gate.sh: drift check inconclusive — ${out.skipped}; keeping the reference` : `gate.sh: reference fresh-checked — Δh ${out.deltaPx > 0 ? '+' : ''}${out.deltaPx}px within ${out.thresholdPx}px${sectionsAfter != null ? `, ${sectionsAfter} sections` : ''}; keeping live.png`);
}
fs.rmSync(probePath, { force: true });
process.stdout.write(JSON.stringify(out));
NODE
)
      fi ;;
  esac
fi

if [ ! -f "$DIR/live.png" ]; then
  capped "$STITCH_TIMEOUT" "stitch-shot live $SLUG@$W" node "$HERE/stitch-shot.mjs" "$LIVE_URL" "$DIR/live.png" --width "$W" --settle --consent-mode "$CONSENT_MODE"
  rc=$?
  [ $rc -eq 124 ] && rm -f "$DIR/live.png" "$DIR/live.png.json"   # never leave a partial live capture to be reused
  [ $rc -ne 0 ] && { echo "gate.sh: live capture failed (exit $rc) — not comparing" >&2; exit $rc; }
fi

# --variance: live self-noise grade, once per gate dir (second live hit —
# opt-in, see header). Compared with the same instrument settings as the
# reference; its number is a floor to READ, never a bar to move.
if [ -n "$VARIANCE" ] && [ -z "$FORCE" ] && [ ! -f "$DIR/variance.json" ]; then
  capped "$STITCH_TIMEOUT" "stitch-shot live-b $SLUG@$W" node "$HERE/stitch-shot.mjs" "$LIVE_URL" "$DIR/live-b.png" --width "$W" --settle --consent-mode "$CONSENT_MODE"
  vrc=$?
  if [ $vrc -ne 0 ]; then
    rm -f "$DIR/live-b.png" "$DIR/live-b.png.json"
    echo "gate.sh: variance capture failed (exit $vrc) — no noise floor recorded this round" >&2
  else
    node "$HERE/pixel-compare.mjs" "$DIR/live.png" "$DIR/live-b.png" --out "$DIR/variance-diff.png" --timeout "$COMPARE_TIMEOUT" --json-out "$DIR/variance.json" > /dev/null
    vrc=$?
    if [ $vrc -eq 124 ] || [ ! -f "$DIR/variance.json" ]; then rm -f "$DIR/variance.json"; echo "gate.sh: variance compare gave no verdict (exit $vrc) — no noise floor recorded" >&2; fi
  fi
fi
if [ -f "$DIR/variance.json" ]; then
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const hot = (j.bands || []).filter((b) => b.pct >= 0.5).sort((a, b) => b.pct - a.pct).slice(0, 5);
console.log(`noise floor ${j.pixelPct} % (live vs itself, Δh ${j.heightDelta}px)${hot.length ? ` — hot bands ${hot.map((b) => `y ${b.y0}–${b.y1} ${b.pct}%`).join(", ")}; mask suggestions: ${hot.map((b) => `--mask ${b.y0}:${b.y1 - b.y0}`).join(" ")}` : ""} — a floor to read beside the raw number, never subtracted from it`);
' "$DIR/variance.json"
fi

# Build side: re-captured every iteration.
capped "$STITCH_TIMEOUT" "stitch-shot build $SLUG@$W" node "$HERE/stitch-shot.mjs" "$BUILD_URL" "$DIR/build.png" --width "$W" --consent-mode "$CONSENT_MODE"
rc=$?
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
  GATE_DRIFT_JSON="$DRIFT_JSON" node - "$DIR/gate-$LBL.json" "$DIR/live.png" "$SLUG" "$LBL" "$W" "$LIVE_URL" "$BUILD_URL" "$REGIME" "$rc" <<'NODE'
const fs = require('fs');
const [rec, live, slug, label, width, liveUrl, buildUrl, regime, rcStr] = process.argv.slice(2);
const rc = Number(rcStr);
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const j = JSON.parse(fs.readFileSync(rec, 'utf8'));
const side = read(`${live}.json`); // no sidecar: mtime
const capturedAt = side?.capturedAt || fs.statSync(live).mtime.toISOString();
const dir = rec.replace(/\/[^/]+$/, '');
let drift = null; try { drift = process.env.GATE_DRIFT_JSON ? JSON.parse(process.env.GATE_DRIFT_JSON) : null; } catch { drift = null; }
const variance = read(`${dir}/variance.json`);
const out = { slug, label, width: Number(width), regime, at: new Date().toISOString(),
  ref: { url: liveUrl, width: Number(width), capturedAt, ...(side ? { sidecar: `${live}.json`, instrument: side.instrument && side.instrument.name, technique: side.technique, consent: side.consent } : { source: 'mtime' }) },
  build: { url: buildUrl }, verdict: rc === 0 ? 'PASS' : rc === 2 ? 'FAIL' : 'no-verdict', exit: rc, ...j };
// Live drift is an EVENT on the record (not a progress.json residual): the
// recapture round does not count against the cap, same rule as skip-link-focus.
if (drift?.drift) out.liveDrift = { previousCapturedAt: drift.previousCapturedAt, docBefore: drift.docBefore, docAfter: drift.docAfter, sectionsBefore: drift.sectionsBefore, sectionsAfter: drift.sectionsAfter, thresholdPx: drift.thresholdPx, recaptured: true };
else if (drift && !drift.skipped) out.freshness = { checkedAt: drift.checkedAt, deltaPx: drift.deltaPx, thresholdPx: drift.thresholdPx };
// Noise floor: read beside the number, never subtracted (thresholds unchanged).
if (variance) out.noiseFloor = { pixelPct: variance.pixelPct, heightDelta: variance.heightDelta, source: `${dir}/variance.json` };
fs.writeFileSync(rec, `${JSON.stringify(out, null, 2)}\n`);
console.log(`regime: ${regime}  reference: ${liveUrl} @${width} captured ${capturedAt}${side ? ` via ${side.technique || side.instrument?.name || 'unknown'}${side.source && side.source !== 'stitch-shot' ? ` (source: ${side.source})` : ''}` : ' (live.png mtime)'}${j.forced ? '  FORCED (incomparable captures — not a gate number)' : ''}${out.liveDrift ? `  LIVE DRIFT (Δh ${out.liveDrift.docAfter - out.liveDrift.docBefore}px — reference recaptured, round not counted)` : ''}${out.noiseFloor ? `  noise floor ${out.noiseFloor.pixelPct} % (raw ${j.pixelPct} % is the gated number)` : ''}  record: ${rec}`);
NODE
fi
exit $rc
