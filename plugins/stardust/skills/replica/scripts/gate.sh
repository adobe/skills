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
#   stardust/scripts/replica/gate.sh <slug> <live-url> <build-url|auto[/<path>]> <width> [iter-label] \
#     [--marker <string>] [--live-from-capture <png>] [--regime prototype|published-origin] \
#     [--refresh] [--variance] \
#     [--over-cap <source-inconsistent|separate-composition|canon-followup|instrument-invalidated>] \
#     [--invalidate <label> <fix>] [--record]
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
#     never moves the bar. variance.json carries gradedAgainst (the capturedAt
#     of the live.png it was graded on): after a LIVE DRIFT recapture the floor
#     survives (no extra hit) but prints `(graded against the <date>
#     reference)` and the record says stale: true; a later explicit --variance
#     re-grades it against the new reference.
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
# ALL live caches together (live.png + .json, anchor-live.json,
# chrome-live[-<state>].json, chrome-live-states.json — a recaptured PNG next
# to a stale chrome/anchor cache is the mixed-reference bug one level down), stores the fresh probe (taken with
# --landmarks) as the new anchor-live.json — the hit is not wasted: the
# landmark step reads it from cache — and records liveDrift{} in the round
# record. A probe that hits its deadline (124) or is blocked skips the
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
# Evidence lands in stardust/replica/gates/<slug>-<width>/ ($GATE_DIR_ROOT overrides the root)
# (live.png, build.png, diff-<label>.png, review-<label>.png, gate-<label>.json,
# anchor-live.json, anchor-live.skip, landmarks-<label>.json; freshness.json
# after a within-threshold drift check; live-b.png + variance.json after
# --variance).
# review-<label>.png is the round's ONE image to read: the 3 worst bands as
# [live | build] rows with a diff heat bar (pixel-compare --review); open a
# full-resolution band only via crop-compare --out.
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
# aborts the round — a missing/blocked side must never be compared, and ANY
# non-zero live capture removes live.png(.json) so no partial is reused. Exit
# codes: 0 gate PASS, 2 gate FAIL (over threshold), 3 bot challenge,
# 1 capture/compare error (incl. incomparable captures), 4 build-side
# identity assertion failed (the URL serves something that isn't this
# project's page — another project's server: listed, never killed; `auto`
# reads this project's port from stardust/.work/ports.json), 5 invalid capture — no verdict,
# never a FAIL (consent dialog still present after the dismissal window —
# in deny mode nothing to reject, in accept mode nothing matched: pass
# --consent <sel> via the crawl log's consent.method, or GATE_ALLOW_CONSENT=1;
# live settled height < 40 % of the crawl screenshot's after one retry;
# error-boundary page; an overlay still covering > 30 % of the first
# viewport — the partial PNG is removed, nothing is cached), 6 cap reached (3
# counted rounds — decide: residual / register / --over-cap; nothing ran),
# 124 instrument deadline exceeded (not a measurement — see below), 125 bad
# argument / duplicate label, 7 instrument unavailable — a dependency (playwright /
# pngjs / pixelmatch) did not resolve (stitch-shot / pixel-compare preflight exit 2,
# before any capture or compare): no verdict, never a FAIL, not counted, the label is
# not taken; run `node skills/stardust/scripts/preflight-runtime.mjs` and re-run.
#
# Iteration cap (source-fidelity-gate.md § Iteration discipline), mechanical
# and PER REGIME: the count is DERIVED from the round records in the gate dir
# — a record counts when its verdict is PASS or FAIL, it is neither excluded
# nor a live-drift recapture, and its regime is this round's (prototype and
# published-origin rounds share the dir but never each other's cap); no-
# verdict rounds never count. The default label is iter<count+1> (prototype)
# or pub<count+1> (published-origin), next free; an explicit label that
# already exists is refused (exit 125). At 3 counted rounds of the regime the
# script exits 6 BEFORE any capture.
#   --over-cap <source-inconsistent|separate-composition|canon-followup|instrument-invalidated>
#       run one more round; the reason is written to the record as overCap
#       (the ledger's overCap vocabulary). Bars unchanged — never a pass.
#   --invalidate <label> <fix>   mark a record excluded {reason, ts} (the
#       instrument-invalidated exclusion) and print the new count; runs nothing.
#   --record   after the round, upsert progress.json via progress-record.mjs
#       (iterations, result{pixelPct, pixelPctUnmasked, heightDelta, pass},
#       overCap, record path) for the page type whose archetype is <slug>.
# The verdict line (`verdict: FAIL 12.4 % Δh 6px  iteration k/3`) carries the
# cap position and `NO-OP` when the differing-pixel count equals the previous
# counted round's of the same regime (the fix never applied).
#
# Broken-image gate (gate doc § Pass bar item 4): the build sidecar's
# `brokenImages` (img with a box ≥ 10 px that loaded nothing) minus the live
# side's > max(2, 10 % of the build `imgCount`) → verdict FAIL, exit 2,
# `failClass: build-broken-images` + `brokenImages{}` on the record, whatever
# the pixel number. Symmetric (a live side of placeholders never trips it);
# no flag, no residual class — wire the harvested `images[].localPath`
# copies. A no-verdict compare (124 / incomparable) stays no verdict.
#
# Comparable captures (gate doc § Hardening rule 15): both sides are taken by
# stitch-shot with the same width, vh, dpr and CONSENT MODE, and each PNG
# carries its provenance sidecar (<png>.json). A cached live.png WITHOUT a
# sidecar is a pre-sidecar capture of unknown instrument state, and one whose
# sidecar names an OLDER stitch-shot procedure version is a different-procedure
# capture: both are deleted and re-taken (one loud line) rather than compared. The consent mode comes
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
#   STARDUST_BROWSER_SLOTS / _WAIT / _LOCK_DIR   the per-round browser slot (skills/stardust/scripts/browser-lock.mjs;
#                        0 = unlocked); acquire exit 124 = no slot in time → gate.sh exits 124 (no verdict)
#   GATE_ALLOW_CONSENT=1 pass --allow-consent to BOTH captures (a consent
#                        container that survives dismissal is otherwise exit 5)
#   GATE_ANCHOR_TIMEOUT  seconds per anchor.mjs landmark pass  (default 120)
#   GATE_LANDMARKS=0     skip the landmark Δy table (anchor.mjs --landmarks);
#                        also clears anchor-live.skip (see below)
#   GATE_BLOCK           comma list of URL substrings → --block on BOTH captures
#                        (undismissable third-party widgets; the sidecar refuses
#                        an asymmetric pair, so the gate is the only safe place)
#   GATE_TOKEN_ENV       env NAME of the site token of a LOCKED build origin
#                        (deploy lockdown.mjs → SITE_TOKEN_<SLUG>) → --token-env on
#                        both captures; stitch-shot attaches it to .aem.page/.aem.live
#                        hosts only, so the live source side never receives it
#   GATE_DIR_ROOT        root of the evidence dirs (default stardust/replica/gates;
#                        the round lands in $GATE_DIR_ROOT/<slug>-<width>/). Set by
#                        rollout gate-publish.mjs --gates-dir so the driver reads
#                        verdicts from the same dir the round wrote to.
#   GATE_MASKS           path of the inventory-declared masks file
#                        (default stardust/replica/masks.json; schema in
#                        capture-sidecar.mjs). When it exists it is validated
#                        BEFORE the first capture (exit 1 names the entry), reaches
#                        both stitch-shot calls (--masks-json → sidecar masksRects[])
#                        and pixel-compare (rect masks from both sidecars, on the
#                        verdict line and in the record's masks[]). A cached live.png
#                        taken with other mask flags is stale and re-captured.
set -u

USAGE="usage: gate.sh <slug> <live-url> <build-url> <width> [iter-label] [--marker <string>] [--live-from-capture <png>] [--regime prototype|published-origin] [--refresh] [--variance] [--over-cap <reason>] [--invalidate <label> <fix>] [--record]"
OVER_CAP_REASONS="source-inconsistent separate-composition canon-followup instrument-invalidated"
case "${1:-}" in --help|-h) sed -n '2,/^set -u/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;; esac
SLUG=${1:?$USAGE}
LIVE_URL=${2:?missing <live-url>}
BUILD_URL=${3:?missing <build-url>}
W=${4:?missing <width>}
# <build-url> = auto[/<path>]: this project's prototype server from
# stardust/.work/ports.json (port.mjs proto; serve.mjs writes it) — the URL is
# never typed, so it can never name another project's port. Default path
# <slug>-proposed.html. Without ports.json `auto` exits 125 — pass the URL.
case "$BUILD_URL" in
  auto|auto/*)
    _P=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("stardust/.work/ports.json","utf8"));process.stdout.write(String(j.proto&&j.proto.port||""))}catch{}' 2>/dev/null)
    [ -z "$_P" ] && { echo "gate.sh: <build-url> auto needs stardust/.work/ports.json#proto — start the server with serve.mjs <dir> --role proto (or pass the URL)" >&2; exit 125; }
    _PATH=${BUILD_URL#auto}; _PATH=${_PATH#/}
    BUILD_URL="http://127.0.0.1:$_P/${_PATH:-$SLUG-proposed.html}"
    echo "gate.sh: build URL from ports.json → $BUILD_URL" ;;
esac
shift 4
LBL=""
case "${1:-}" in ''|--*) ;; *) LBL=$1; shift ;; esac
MARKER="$SLUG"
FROM_CAPTURE=""
REGIME_OVERRIDE=""
REFRESH=""
VARIANCE=""
OVER_CAP=""
INVALIDATE_LBL=""
INVALIDATE_FIX=""
RECORD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --marker) MARKER=${2:?--marker needs a value}; shift 2 ;;
    --live-from-capture) FROM_CAPTURE=${2:?--live-from-capture needs a <png>}; shift 2 ;;
    --regime) REGIME_OVERRIDE=${2:?--regime needs prototype|published-origin}; shift 2
      case "$REGIME_OVERRIDE" in prototype|published-origin) ;; *) echo "gate.sh: --regime must be prototype or published-origin (got $REGIME_OVERRIDE)" >&2; exit 125 ;; esac ;;
    --refresh) REFRESH=1; shift ;;
    --variance) VARIANCE=1; shift ;;
    --over-cap) OVER_CAP=${2:?--over-cap needs a reason: $OVER_CAP_REASONS}; shift 2
      case " $OVER_CAP_REASONS " in *" $OVER_CAP "*) ;; *) echo "gate.sh: --over-cap must be one of: $OVER_CAP_REASONS (got $OVER_CAP) — the regime labels of source-fidelity-gate.md § Iteration discipline" >&2; exit 125 ;; esac ;;
    --invalidate) INVALIDATE_LBL=${2:?--invalidate needs <label> <instrument-fix>}; INVALIDATE_FIX=${3:?--invalidate needs the instrument fix that names why <label> measured a defect}; shift 3 ;;
    --record) RECORD=1; shift ;;
    *) echo "gate.sh: unknown argument $1 ($USAGE)" >&2; exit 125 ;;
  esac
done

HERE=$(cd "$(dirname "$0")" && pwd)
DIR="${GATE_DIR_ROOT:-stardust/replica/gates}/$SLUG-$W"
mkdir -p "$DIR"

# Regime — decided BEFORE the count: the prototype gate and the published-
# origin gate share gates/<slug>-<width>/ but each has its own 3-round cap
# (gate doc § The published-origin gate: "same iteration discipline"), so the
# records of one regime never count against the other. Local-server
# heuristic, --regime overrides (https://localhost, tunnels).
case "$BUILD_URL" in
  http://localhost*|http://127.*|http://\[::1\]*|http://0.0.0.0*|file:*) REGIME=prototype ;;
  *) REGIME=published-origin ;;
esac
REGIME=${REGIME_OVERRIDE:-$REGIME}
case "$REGIME" in published-origin) LBL_PREFIX=pub ;; *) LBL_PREFIX=iter ;; esac

# Iteration count — DERIVED from the round records, never kept in a counter
# file: a round counts when its record has verdict PASS or FAIL, is neither
# excluded (--invalidate) nor a live-drift recapture round, and belongs to
# the SAME regime (a record without `regime` is a prototype round). No-verdict
# rounds (exit 124/3/5) never count. Prints "<count> <excluded> <labels…>" —
# the labels are every record in the dir regardless of regime (label
# uniqueness is per dir).
count_rounds() {
  node -e '
const fs = require("fs"); const [dir, regime] = process.argv.slice(1);
const recs = fs.readdirSync(dir).filter((f) => /^gate-.*\.json$/.test(f)).map((f) => { try { return { f, j: JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")) }; } catch { return null; } }).filter(Boolean);
const counted = recs.filter(({ j }) => ["PASS", "FAIL"].includes(j.verdict) && !j.excluded && !j.liveDrift && (j.regime || "prototype") === regime);
const excluded = recs.filter(({ j }) => j.excluded && (j.regime || "prototype") === regime).length;
process.stdout.write(`${counted.length} ${excluded} ${recs.map(({ f }) => f.replace(/^gate-|\.json$/g, "")).join(" ")}`);
' "$DIR" "$1"
}
set -- $(count_rounds "$REGIME")
COUNT=${1:-0}; EXCLUDED=${2:-0}; shift 2 2>/dev/null; EXISTING=" $* "

# --invalidate <label> <fix>: the instrument-invalidated exclusion of the gate
# doc as a record field — nothing is captured or compared. The count printed
# is the invalidated record's own regime.
if [ -n "$INVALIDATE_LBL" ]; then
  [ -f "$DIR/gate-$INVALIDATE_LBL.json" ] || { echo "gate.sh: --invalidate: no record $DIR/gate-$INVALIDATE_LBL.json (rounds on disk:$EXISTING)" >&2; exit 1; }
  INV_REGIME=$(node -e '
const fs = require("fs"); const [p, fix] = process.argv.slice(1);
const j = JSON.parse(fs.readFileSync(p, "utf8")); j.excluded = { reason: fix, ts: new Date().toISOString() };
fs.writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`); process.stdout.write(j.regime || "prototype");
' "$DIR/gate-$INVALIDATE_LBL.json" "$INVALIDATE_FIX" 2>/dev/null) || { echo "gate.sh: --invalidate: $DIR/gate-$INVALIDATE_LBL.json is not readable JSON — nothing marked excluded, the count is unchanged" >&2; exit 1; }
  set -- $(count_rounds "$INV_REGIME")
  echo "gate.sh: round $INVALIDATE_LBL excluded from the cap (instrument-invalidated: $INVALIDATE_FIX) — counted $INV_REGIME rounds now ${1:-0}/3 (excluded: ${2:-0}). Name the same fix in the ledger."
  exit 0
fi

# Default label iter<k> (prototype) / pub<k> (published-origin): the next free
# number from count+1, so records never collide (a shared default label
# overwrote every round and the count read 1). An explicit label that already
# exists is refused — re-marking is --invalidate.
if [ -z "$LBL" ]; then
  n=$((COUNT + 1)); while case "$EXISTING" in *" $LBL_PREFIX$n "*) true ;; *) false ;; esac; do n=$((n + 1)); done; LBL="$LBL_PREFIX$n"
elif case "$EXISTING" in *" $LBL "*) true ;; *) false ;; esac; then
  echo "gate.sh: a round labelled $LBL already exists in $DIR — pick a new label (default: $LBL_PREFIX$((COUNT + 1))) or --invalidate $LBL <fix> to exclude it" >&2; exit 125
fi

# Hard cap 3 per regime (source-fidelity-gate.md § Iteration discipline) —
# fires BEFORE any capture so the stop costs nothing and the live cache is
# untouched. Exit 6 = "cap reached — decide": never a FAIL, never a measurement.
if [ "$COUNT" -ge 3 ] && [ -z "$OVER_CAP" ]; then
  echo "gate.sh: cap reached: $COUNT/3 counted $REGIME rounds in $DIR (excluded: $EXCLUDED; rounds on disk:$EXISTING) — no round run." >&2
  echo "gate.sh: decide: log a named residual (source-fidelity-gate.md § Residual logging format, § Residual classes) or open a register entry (preserve-direction.md § 3); to run another round: --over-cap <${OVER_CAP_REASONS// /|}> (written to the record as overCap); a round that measured an instrument defect: --invalidate <label> <fix>." >&2
  exit 6
fi
[ -n "$OVER_CAP" ] && echo "gate.sh: over-cap round $LBL (reason $OVER_CAP — counted rounds so far $COUNT/3); bars unchanged, the reason lands in the record as overCap"

STITCH_TIMEOUT=${GATE_STITCH_TIMEOUT:-300}
CONSENT_MODE=${GATE_CONSENT_MODE:-}
[ -z "$CONSENT_MODE" ] && CONSENT_MODE=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("stardust/replica/progress.json","utf8"));process.stdout.write(j.captureState&&j.captureState.consent||"")}catch{}' 2>/dev/null)
CONSENT_MODE=${CONSENT_MODE:-accept}
COMPARE_TIMEOUT=${GATE_COMPARE_TIMEOUT:-120}
STITCH_COMMON=""
[ "${GATE_ALLOW_CONSENT:-0}" = "1" ] && STITCH_COMMON="--allow-consent"
[ -n "${GATE_BLOCK:-}" ] && STITCH_COMMON="$STITCH_COMMON --block $GATE_BLOCK"
[ -n "${GATE_TOKEN_ENV:-}" ] && STITCH_COMMON="$STITCH_COMMON --token-env $GATE_TOKEN_ENV"
# Masks (see header GATE_MASKS): validate first, then the same file on both captures and the compare.
MASKS_JSON=${GATE_MASKS:-stardust/replica/masks.json}
MASK_FLAGS='{"maskSel":[],"maskIframes":false,"maskImages":false}'
MASK_ARG=""
if [ -f "$MASKS_JSON" ]; then
  MASK_FLAGS=$(node "$HERE/pixel-compare.mjs" --masks-json "$MASKS_JSON" --check) || { echo "gate.sh: $MASKS_JSON rejected — every entry needs class + source (schema: capture-sidecar.mjs --help); nothing captured, no verdict" >&2; exit 1; }
  MASK_ARG="--masks-json $MASKS_JSON"
  STITCH_COMMON="$STITCH_COMMON $MASK_ARG"
  echo "gate.sh: masks from $MASKS_JSON → $MASK_FLAGS on both captures; pixel-compare applies them from both sidecars (every mask on the verdict line and in the record)"
fi
REAP_MIN=${GATE_REAP_MIN:-15}
# Browser slot (../../stardust/reference/fan-out.md § Machine budget): one per gate round, taken below before
# the first capture; the module resolves from the project copy layout (stardust/scripts/stardust/), the plugin
# tree, then $STARDUST_SKILLS_DIR/stardust/scripts (stamped by the master setup); absent → the round runs
# UNLOCKED and says so once (the census reads the line) — never silently.
LOCK="$HERE/../stardust/browser-lock.mjs"; [ -f "$LOCK" ] || LOCK="$HERE/../../stardust/scripts/browser-lock.mjs"
[ -f "$LOCK" ] || { [ -n "${STARDUST_SKILLS_DIR:-}" ] && LOCK="$STARDUST_SKILLS_DIR/stardust/scripts/browser-lock.mjs"; }
[ -f "$LOCK" ] || { LOCK=""; [ "${STARDUST_BROWSER_SLOTS:-2}" != "0" ] && echo "gate.sh: WARN no browser-lock.mjs beside the scripts (looked in $HERE/../stardust/, $HERE/../../stardust/scripts/, \$STARDUST_SKILLS_DIR/stardust/scripts/) — this round takes NO machine-wide browser slot (fan-out.md § Machine budget); copy skills/stardust/scripts/browser-lock.mjs to stardust/scripts/stardust/ or export STARDUST_SKILLS_DIR" >&2; }
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
  [ -n "$LOCK" ] && node "$LOCK" reap --min "$REAP_MIN" >&2   # parentless chromium older than REAP_MIN (browser-lock)
fi

# Take this round's browser slot (pid = this shell; released on EXIT). 124 = no slot within the wait: no verdict,
# never a FAIL — re-run. Children (stitch-shot, anchor, chrome-parity via live-session launchTier) inherit
# STARDUST_BROWSER_SLOTS=0 so the round holds exactly one slot.
if [ -n "$LOCK" ] && [ "${STARDUST_BROWSER_SLOTS:-2}" != "0" ]; then
  node "$LOCK" acquire --script gate.sh --project "$PWD" || exit $?
  trap 'node "$LOCK" release >/dev/null 2>&1' EXIT
  export STARDUST_BROWSER_SLOTS=0
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
# Own-server bookkeeping first (never by age — a healthy prototype server runs
# for hours): a pidfile whose pid is dead is an ORPHAN and is removed; a
# listener on the build port whose cwd is outside this project is LISTED,
# never killed (three field runs killed other projects' servers — the
# allocator moves instead: port.mjs proto → next slot).
if [ -f stardust/.work/proto.pid ]; then
  node -e 'const fs=require("fs");const p="stardust/.work/proto.pid";try{const j=JSON.parse(fs.readFileSync(p,"utf8"));try{process.kill(j.pid,0)}catch(e){if(e.code!=="EPERM"){fs.rmSync(p,{force:true});console.error(`gate.sh: proto pidfile pid ${j.pid} is gone — orphan pidfile removed (serve.mjs restarts on the same slot)`)}}}catch{}' 2>&1 >&2
fi
PAGE=$(curl -fsSL --max-time 10 "$BUILD_URL" 2>/dev/null) || PAGE=""
if ! printf '%s' "$PAGE" | grep -qiF -- "$MARKER"; then
  echo "gate.sh: IDENTITY ASSERTION FAILED — $BUILD_URL does not serve a page containing \"$MARKER\" (or did not respond)." >&2
  echo "gate.sh: the server on that port is likely another project's (stale http.server?) — not comparing." >&2
  PORT=$(printf '%s' "$BUILD_URL" | sed -nE 's|^[a-z]+://[^:/]+:([0-9]+).*|\1|p')
  if [ -n "$PORT" ]; then
    echo "gate.sh: port $PORT listener (pid, command, cwd — a cwd outside this project is another project's: listed, never killed):" >&2
    node "$HERE/port.mjs" list 2>/dev/null | grep -F ":$PORT " >&2 || lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || echo "gate.sh: (nothing listening on :$PORT)" >&2
  fi
  echo "gate.sh: this project's server: node $HERE/serve.mjs <prototypes-dir> --role proto (port.mjs proto picks a free slot; port.mjs stop proto ends only ours); or pass --marker <string> if the slug legitimately doesn't appear in the page." >&2
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
  rm -f "$DIR/live.png" "$DIR/anchor-live.skip"
fi
# A cached reference taken by an OLDER stitch-shot procedure (instrument.version
# in its sidecar ≠ this script's) is stale too: v3 hides pinned chrome on
# chunks 2+, so a v2 live.png against a v3 build.png would be an asymmetric
# pair the sidecar cannot refuse (comparability is keyed on name, not version).
# Never applies to an imported extract capture (source: extract-capture).
# The current procedure version is READ from the instrument's INSTRUMENT
# declaration by a whitespace/quote-tolerant parse — a reformat must not turn
# this check off silently: when the version cannot be read the round says so
# (WARN — not on a --force round, where the check does not apply), and the
# build capture's own sidecar is cross-checked below as the safety net.
STITCH_VER=$(node -e '
const src = require("fs").readFileSync(process.argv[1], "utf8");
const m = src.match(/INSTRUMENT\s*=\s*\{[\s\S]{0,300}?\bversion\s*:\s*["\x27]?(\d+)["\x27]?/);
process.stdout.write(m ? m[1] : "");
' "$HERE/stitch-shot.mjs" 2>/dev/null)
[ -z "$STITCH_VER" ] && [ -z "$FORCE" ] && echo "gate.sh: WARN cannot read stitch-shot's procedure version (INSTRUMENT.version in $HERE/stitch-shot.mjs) — the stale-procedure check runs from the build sidecar only this round" >&2
if [ -f "$DIR/live.png.json" ] && [ -n "$STITCH_VER" ] && [ -z "$FORCE" ]; then
  OLD_VER=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.source==="extract-capture"?String(process.argv[2]):String(j.instrument&&j.instrument.version||""))' "$DIR/live.png.json" "$STITCH_VER" 2>/dev/null)
  if [ "$OLD_VER" != "$STITCH_VER" ]; then
    echo "gate.sh: $DIR/live.png was captured by an older stitch-shot procedure (instrument.version ${OLD_VER:-unknown}, current $STITCH_VER — the capture procedure changed) — treating it as stale and re-capturing so both sides use the same procedure" >&2
    rm -f "$DIR/live.png" "$DIR/live.png.json" "$DIR/anchor-live.json" "$DIR/anchor-live.skip"
  fi
fi
# A cached reference taken with OTHER mask flags (masks.json added, edited or
# removed since) carries masksRects[] the build side will not match: stale too.
if [ -f "$DIR/live.png.json" ] && [ -z "$FORCE" ]; then
  MASK_STALE=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(j.source==="extract-capture")process.exit(0);const o=(j.instrument&&j.instrument.options)||{};const norm=(x)=>JSON.stringify({maskSel:[...(x.maskSel||[])].sort(),maskIframes:!!x.maskIframes,maskImages:!!x.maskImages});const cur=norm(JSON.parse(process.argv[2]));const old=norm(o);process.stdout.write(old===cur?"":old)' "$DIR/live.png.json" "$MASK_FLAGS" 2>/dev/null)
  if [ -n "$MASK_STALE" ]; then
    echo "gate.sh: $DIR/live.png was captured with other mask flags ($MASK_STALE; current $MASK_FLAGS — masks.json changed) — treating it as stale and re-capturing so both sidecars carry the same masksRects" >&2
    rm -f "$DIR/live.png" "$DIR/live.png.json" "$DIR/anchor-live.json" "$DIR/anchor-live.skip"
  fi
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
      # shellcheck disable=SC2086
      capped "$STITCH_TIMEOUT" "anchor probe live $SLUG@$W" node "$HERE/anchor.mjs" "$LIVE_URL" --width "$W" --json --landmarks --consent-mode "$CONSENT_MODE" ${GATE_BLOCK:+--block $GATE_BLOCK} > "$PROBE"
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
  for (const f of ['live.png', 'live.png.json', 'anchor-live.json', 'chrome-live.json', 'chrome-live-states.json', 'freshness.json']) fs.rmSync(`${dir}/${f}`, { force: true });
  for (const f of fs.readdirSync(dir).filter((n) => /^chrome-live-.*\.json$/.test(n))) fs.rmSync(`${dir}/${f}`, { force: true }); // state-keyed chrome-parity caches (--open/--scroll)
  fs.writeFileSync(`${dir}/anchor-live.json`, `${JSON.stringify({ key: { url, width: Number(width), main: probe.main || 'main' }, probedAt: out.checkedAt, data: { doc: probe.doc, rootMissing: probe.rootMissing, rootWrapsChrome: probe.rootWrapsChrome, sections: probe.sections, footer: probe.footer, ...(probe.landmarks ? { landmarks: probe.landmarks } : {}) } }, null, 2)}\n`);
  console.error(`gate.sh: LIVE DRIFT Δh ${out.deltaPx > 0 ? '+' : ''}${out.deltaPx}px (threshold ${out.thresholdPx}px) sections ${sectionsBefore ?? '?'}→${sectionsAfter ?? '?'} — recapturing live.png; anchor-live.json and the chrome-live caches invalidated together (a stale reference is not a residual — this round does not count against the cap)`);
} else {
  // an inconclusive check verified nothing: no checkedAt stamp, so the next round probes again once a reference height exists
  if (!out.skipped) fs.writeFileSync(`${dir}/freshness.json`, `${JSON.stringify(out, null, 2)}\n`);
  console.error(out.skipped ? `gate.sh: drift check inconclusive — ${out.skipped}; keeping the reference` : `gate.sh: reference fresh-checked — Δh ${out.deltaPx > 0 ? '+' : ''}${out.deltaPx}px within ${out.thresholdPx}px${sectionsAfter != null ? `, ${sectionsAfter} sections` : ''}; keeping live.png`);
}
fs.rmSync(probePath, { force: true });
process.stdout.write(JSON.stringify(out));
NODE
)
      fi ;;
  esac
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
capture_live() {
  rm -f "$DIR/anchor-live.skip"   # a fresh live reference gets one fresh landmark probe (anchor-live.json is keyed on URL+width: still valid)
  # shellcheck disable=SC2086
  capped "$STITCH_TIMEOUT" "stitch-shot live $SLUG@$W" node "$HERE/stitch-shot.mjs" "$LIVE_URL" "$DIR/live.png" --width "$W" --settle --consent-mode "$CONSENT_MODE" $EXPECT_ARGS $STITCH_COMMON
  rc=$?
  # ANY non-zero rc (124 deadline, 5 invalid, 3 challenge, 1 error, …) removes
  # the PNG + sidecar: a partial live capture must never be reused as the
  # reference on the next round (the cache check above is "live.png exists").
  [ $rc -ne 0 ] && rm -f "$DIR/live.png" "$DIR/live.png.json"
  [ $rc -eq 2 ] && { echo "gate.sh: live capture gave no verdict — instrument unavailable (stitch-shot preflight exit 2: a dependency did not resolve; run node skills/stardust/scripts/preflight-runtime.mjs) — never a FAIL, not counted; nothing captured" >&2; exit 7; }
  [ $rc -eq 5 ] && { echo "gate.sh: live capture INVALID (exit 5: short capture / overlay / error page / consent not deniable) — not a verdict, never a FAIL; nothing cached" >&2; exit 5; }
  [ $rc -ne 0 ] && { echo "gate.sh: live capture failed (exit $rc) — not comparing; nothing cached" >&2; exit $rc; }
}
[ -f "$DIR/live.png" ] || capture_live

# --variance: live self-noise grade, once per gate dir (second live hit —
# opt-in, see header). Compared with the same instrument settings as the
# reference; its number is a floor to READ, never a bar to move.
# A floor graded against a reference that LIVE DRIFT has since recaptured is
# stale: it is kept (no extra hit) and flagged; an explicit --variance re-grades.
VAR_STALE=$(node -e '
const fs = require("fs"); const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const v = read(`${process.argv[1]}/variance.json`); const side = read(`${process.argv[1]}/live.png.json`);
process.stdout.write(v && v.gradedAgainst && side && side.capturedAt && v.gradedAgainst !== side.capturedAt ? v.gradedAgainst : "");
' "$DIR" 2>/dev/null)
if [ -n "$VARIANCE" ] && [ -z "$FORCE" ] && { [ ! -f "$DIR/variance.json" ] || [ -n "$VAR_STALE" ]; }; then
  [ -n "$VAR_STALE" ] && echo "gate.sh: noise floor was graded against the $VAR_STALE reference (recaptured since) — re-grading" >&2
  # same flags as live.png (--expect-height, --block, --allow-consent, masks): a
  # sidecar that differs in `blocked`/masksRects is refused by pixel-compare.
  # shellcheck disable=SC2086
  capped "$STITCH_TIMEOUT" "stitch-shot live-b $SLUG@$W" node "$HERE/stitch-shot.mjs" "$LIVE_URL" "$DIR/live-b.png" --width "$W" --settle --consent-mode "$CONSENT_MODE" $EXPECT_ARGS $STITCH_COMMON
  vrc=$?
  if [ $vrc -ne 0 ]; then
    rm -f "$DIR/live-b.png" "$DIR/live-b.png.json"
    echo "gate.sh: variance capture failed (exit $vrc) — no noise floor recorded this round" >&2
  else
    node "$HERE/pixel-compare.mjs" "$DIR/live.png" "$DIR/live-b.png" --out "$DIR/variance-diff.png" --timeout "$COMPARE_TIMEOUT" --json-out "$DIR/variance.json" > /dev/null
    vrc=$?
    if [ $vrc -eq 124 ] || [ ! -f "$DIR/variance.json" ]; then rm -f "$DIR/variance.json"; echo "gate.sh: variance compare gave no verdict (exit $vrc) — no noise floor recorded" >&2
    else
      # stamp the reference the floor was graded against (sidecar capturedAt, else live.png mtime)
      node -e '
const fs = require("fs"); const [vp, live] = process.argv.slice(1); const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const v = JSON.parse(fs.readFileSync(vp, "utf8")); v.gradedAgainst = (read(`${live}.json`) || {}).capturedAt || fs.statSync(live).mtime.toISOString(); v.gradedAt = new Date().toISOString();
fs.writeFileSync(vp, `${JSON.stringify(v, null, 2)}\n`);
' "$DIR/variance.json" "$DIR/live.png"
      VAR_STALE=""
    fi
  fi
fi
if [ -f "$DIR/variance.json" ]; then
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const stale = process.argv[2];
const hot = (j.bands || []).filter((b) => b.pct >= 0.5).sort((a, b) => b.pct - a.pct).slice(0, 5);
console.log(`noise floor ${j.pixelPct} % (live vs itself, Δh ${j.heightDelta}px)${hot.length ? ` — hot bands ${hot.map((b) => `y ${b.y0}–${b.y1} ${b.pct}%`).join(", ")}; mask suggestions: ${hot.map((b) => `--mask ${b.y0}:${b.y1 - b.y0}`).join(" ")}` : ""} — a floor to read beside the raw number, never subtracted from it${stale ? ` (graded against the ${stale} reference — recaptured since; --variance re-grades)` : ""}`);
' "$DIR/variance.json" "$VAR_STALE"
fi

# Build side: re-captured every iteration.
# shellcheck disable=SC2086
[ -n "$LOCK" ] && node "$LOCK" refresh >/dev/null 2>&1   # a long live capture must not let the slot expire (TTL)
capped "$STITCH_TIMEOUT" "stitch-shot build $SLUG@$W" node "$HERE/stitch-shot.mjs" "$BUILD_URL" "$DIR/build.png" --width "$W" --consent-mode "$CONSENT_MODE" $STITCH_COMMON
rc=$?
[ $rc -eq 2 ] && { rm -f "$DIR/build.png" "$DIR/build.png.json"; echo "gate.sh: build capture gave no verdict — instrument unavailable (stitch-shot preflight exit 2: a dependency did not resolve; run node skills/stardust/scripts/preflight-runtime.mjs) — never a FAIL, not counted" >&2; exit 7; }
[ $rc -eq 5 ] && { rm -f "$DIR/build.png" "$DIR/build.png.json"; echo "gate.sh: build capture INVALID (exit 5: overlay / error page / consent not deniable) — not a verdict, never a FAIL" >&2; exit 5; }
[ $rc -ne 0 ] && { echo "gate.sh: build capture failed (exit $rc) — not comparing" >&2; exit $rc; }

# Broken-image gate (header): read both sidecars once; pre-field sidecars (no
# brokenImages key on the build side) skip it. Applied to the record below.
BROKEN_JSON=$(node -e '
const fs = require("fs"); const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const [l, b] = process.argv.slice(1).map(read);
if (!b || !Number.isFinite(b.brokenImages)) process.exit(0);
const live = l && Number.isFinite(l.brokenImages) ? l.brokenImages : 0;
const imgCount = Number.isFinite(b.imgCount) ? b.imgCount : 0;
const threshold = Math.max(2, Math.ceil(imgCount * 0.1));
const delta = b.brokenImages - live;
process.stdout.write(JSON.stringify({ live, build: b.brokenImages, imgCount, threshold, delta, fail: delta > threshold, srcs: (b.brokenSrcs || []).slice(0, 20) }));
' "$DIR/live.png.json" "$DIR/build.png.json" 2>/dev/null)
BROKEN_FAIL=0
case "$BROKEN_JSON" in *'"fail":true'*) BROKEN_FAIL=1; echo "gate.sh: build side loads fewer images than live — $BROKEN_JSON — FAIL (failClass build-broken-images): wire the harvested images[].localPath copies (recreation-procedure.md § Asset harvest)" >&2 ;; esac

# Same-procedure safety net (format-independent): the build sidecar was
# written by the instrument THIS round, so its instrument.version is the
# current procedure whatever the source text looks like. A cached live
# reference whose sidecar names another version is re-taken once, here —
# never compared. Skipped for an imported extract capture (--force pair).
if [ -z "$FORCE" ] && [ -f "$DIR/live.png.json" ] && [ -f "$DIR/build.png.json" ]; then
  VER_PAIR=$(node -e '
const fs = require("fs"); const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const [l, b] = process.argv.slice(1).map(read);
const v = (s) => String((s && s.instrument && s.instrument.version) ?? "");
process.stdout.write(l && b && l.source !== "extract-capture" && v(l) !== v(b) ? `${v(l) || "unknown"} ${v(b) || "unknown"}` : "");
' "$DIR/live.png.json" "$DIR/build.png.json" 2>/dev/null)
  if [ -n "$VER_PAIR" ]; then
    echo "gate.sh: $DIR/live.png was captured by stitch-shot procedure ${VER_PAIR% *}, the build by ${VER_PAIR#* } — different-procedure pair; re-taking the live reference once so both sides use the same procedure" >&2
    rm -f "$DIR/live.png" "$DIR/live.png.json" "$DIR/anchor-live.json" "$DIR/anchor-live.skip" "$DIR/chrome-live.json" "$DIR"/chrome-live-*.json "$DIR/freshness.json"
    capture_live
  fi
fi

# Landmark Δy table — the round's FIRST diagnostic (gate doc § Reading the
# band breakdown): anchor.mjs --landmarks on the live side (cached in
# anchor-live.json — one live probe per breakpoint per full gate run, the
# sanctioned A4/A115 cache) and on the build side (free), paired by text; the
# `first non-zero Δ` line names the section to fix before any band is read.
# Never changes the round's exit code; GATE_LANDMARKS=0 skips it (and clears
# the skip marker); an imported live reference (--live-from-capture,
# bot-walled) skips the live probe — no extra live hits there. A live probe
# that fails (challenge one tier below what stitch-shot cleared, deadline 124)
# writes nothing to the cache, so without a marker EVERY later round would
# spend one more live hit on it: anchor-live.skip (rc + timestamp) records the
# failure once and the live pass is skipped while it exists — it goes with
# live.png (stale/re-capture branches above). Record: landmarks-<label>.json →
# gate-<label>.json.
ANCHOR_TIMEOUT=${GATE_ANCHOR_TIMEOUT:-120}
ANCHOR_COMMON="--consent-mode $CONSENT_MODE"
[ -n "${GATE_BLOCK:-}" ] && ANCHOR_COMMON="$ANCHOR_COMMON --block $GATE_BLOCK"
rm -f "$DIR/landmarks-$LBL.json"
[ "${GATE_LANDMARKS:-1}" = "0" ] && rm -f "$DIR/anchor-live.skip"
if [ "${GATE_LANDMARKS:-1}" != "0" ]; then
  if [ -n "$FORCE" ]; then
    echo "gate.sh: landmark table skipped — imported live reference (no live hits); run anchor.mjs --landmarks by hand against a stitched reference" >&2
  elif [ -f "$DIR/anchor-live.skip" ]; then
    echo "gate.sh: landmark table skipped — the live landmark probe failed earlier for this reference ($(cat "$DIR/anchor-live.skip")); no further live hits for it — delete $DIR/anchor-live.skip (or live.png) to re-probe" >&2
  else
    # shellcheck disable=SC2086
    capped "$ANCHOR_TIMEOUT" "anchor live $SLUG@$W" node "$HERE/anchor.mjs" "$LIVE_URL" --width "$W" --landmarks --cache "$DIR/anchor-live.json" $ANCHOR_COMMON >/dev/null
    arc=$?
    if [ $arc -ne 0 ]; then
      printf 'exit %s at %s\n' "$arc" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DIR/anchor-live.skip"
      echo "gate.sh: landmark table unavailable (live anchor exit $arc) — pixel round continues; the live probe is not retried on later rounds (anchor-live.skip written; delete it or live.png to re-probe)" >&2
    else
      # shellcheck disable=SC2086
      capped "$ANCHOR_TIMEOUT" "anchor build $SLUG@$W" node "$HERE/anchor.mjs" "$BUILD_URL" --width "$W" --landmarks --against "$DIR/anchor-live.json" --json-out "$DIR/landmarks-$LBL.json" $ANCHOR_COMMON
      arc=$?
      [ $arc -ne 0 ] && echo "gate.sh: landmark table unavailable (build anchor exit $arc) — pixel round continues" >&2
    fi
  fi
fi

# pixel-compare supervises its own deadline (--timeout); exit 124 = no verdict.
# shellcheck disable=SC2086
node "$HERE/pixel-compare.mjs" "$DIR/live.png" "$DIR/build.png" --out "$DIR/diff-$LBL.png" --review "$DIR/review-$LBL.png" --timeout "$COMPARE_TIMEOUT" --json-out "$DIR/gate-$LBL.json" $FORCE $MASK_ARG
rc=$?
# Preflight exit 2 (pngjs / pixelmatch unresolved) shares the code with a FAIL verdict but
# writes no --json-out: without a record it is no verdict — instrument unavailable, never a
# counted FAIL (the label stays free; the cached live reference is kept).
if [ $rc -eq 2 ] && [ ! -f "$DIR/gate-$LBL.json" ]; then echo "gate.sh: pixel-compare gave no verdict — instrument unavailable (preflight exit 2, no record written: a dependency did not resolve; run node skills/stardust/scripts/preflight-runtime.mjs) — never a FAIL, round not counted, label $LBL not taken" >&2; exit 7; fi
# A compare that produced no summary (deadline, incomparable pair) still
# leaves a no-verdict record: the attempt is on the audit trail, its label is
# taken, and it never counts against the cap.
[ -f "$DIR/gate-$LBL.json" ] || printf '{}\n' > "$DIR/gate-$LBL.json"

# Round record: regime + reference + verdict are EMITTED here (see header) so
# the ledger copies them. capturedAt comes from the live capture's own
# provenance sidecar when it has one, else from live.png's mtime. The regime
# was decided before the count (top of the script).
if [ -f "$DIR/gate-$LBL.json" ]; then
  GATE_DRIFT_JSON="$DRIFT_JSON" GATE_COUNT="$COUNT" GATE_OVER_CAP="$OVER_CAP" GATE_BROKEN_JSON="$BROKEN_JSON" node - "$DIR/gate-$LBL.json" "$DIR/live.png" "$SLUG" "$LBL" "$W" "$LIVE_URL" "$BUILD_URL" "$REGIME" "$rc" "$DIR/landmarks-$LBL.json" <<'NODE'
const fs = require('fs');
const [rec, live, slug, label, width, liveUrl, buildUrl, regime, rcStr, lmFile] = process.argv.slice(2);
// broken-image gate (header): a definitive compare (0 / 2) with the build side over the bar is FAIL; a no-verdict compare stays no verdict
let broken = null; try { broken = process.env.GATE_BROKEN_JSON ? JSON.parse(process.env.GATE_BROKEN_JSON) : null; } catch { broken = null; }
const rcRaw = Number(rcStr);
const rc = broken && broken.fail && [0, 2].includes(rcRaw) ? 2 : rcRaw;
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const j = JSON.parse(fs.readFileSync(rec, 'utf8'));
// landmark table (anchor.mjs --landmarks --against): rows, unpaired, firstDelta — absent when skipped/unavailable
let landmarks = null; try { const lm = JSON.parse(fs.readFileSync(lmFile, 'utf8')); if (lm.pair) landmarks = { rows: lm.pair.rows, unpaired: lm.pair.unpaired, firstDelta: lm.pair.firstDelta, clean: lm.pair.clean }; } catch { /* no table this round */ }
const side = read(`${live}.json`); // no sidecar: mtime
const capturedAt = side?.capturedAt || fs.statSync(live).mtime.toISOString();
const dir = rec.replace(/\/[^/]+$/, '');
let drift = null; try { drift = process.env.GATE_DRIFT_JSON ? JSON.parse(process.env.GATE_DRIFT_JSON) : null; } catch { drift = null; }
const variance = read(`${dir}/variance.json`);
// previous counted round of the SAME regime (NO-OP compares like with like)
const prev = fs.readdirSync(dir).filter((f) => /^gate-.*\.json$/.test(f) && f !== rec.replace(/^.*\//, '')).map((f) => read(`${dir}/${f}`)).filter((r) => r && ['PASS', 'FAIL'].includes(r.verdict) && !r.excluded && !r.liveDrift && (r.regime || 'prototype') === regime).sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))).pop() || null;
const counts = ['PASS', 'FAIL'].includes(rc === 0 ? 'PASS' : rc === 2 ? 'FAIL' : 'no-verdict') && !drift?.drift;
const out = { slug, label, width: Number(width), regime, at: new Date().toISOString(),
  ...(counts ? { iteration: Number(process.env.GATE_COUNT || 0) + 1 } : { counted: false }),
  ...(process.env.GATE_OVER_CAP ? { overCap: process.env.GATE_OVER_CAP } : {}),
  ref: { url: liveUrl, width: Number(width), capturedAt, ...(side ? { sidecar: `${live}.json`, instrument: side.instrument && side.instrument.name, technique: side.technique, consent: side.consent } : { source: 'mtime' }) },
  build: { url: buildUrl }, verdict: rc === 0 ? 'PASS' : rc === 2 ? 'FAIL' : 'no-verdict', exit: rc, ...(landmarks ? { landmarks } : {}), ...j,
  ...(broken ? { brokenImages: { live: broken.live, build: broken.build, imgCount: broken.imgCount, threshold: broken.threshold, srcs: broken.srcs } } : {}),
  // failClass overrides pixel-compare's `pass` (spread above): a FAIL record never carries pass: true — the ledger copy reads `pass`
  ...(broken && broken.fail && rc === 2 ? { failClass: 'build-broken-images', pass: false } : {}) };
// Live drift is an EVENT on the record (not a progress.json residual): the
// recapture round does not count against the cap, same rule as skip-link-focus.
if (drift?.drift) out.liveDrift = { previousCapturedAt: drift.previousCapturedAt, docBefore: drift.docBefore, docAfter: drift.docAfter, sectionsBefore: drift.sectionsBefore, sectionsAfter: drift.sectionsAfter, thresholdPx: drift.thresholdPx, recaptured: true };
else if (drift && !drift.skipped) out.freshness = { checkedAt: drift.checkedAt, deltaPx: drift.deltaPx, thresholdPx: drift.thresholdPx };
// Noise floor: read beside the number, never subtracted (thresholds unchanged).
if (variance) out.noiseFloor = { pixelPct: variance.pixelPct, heightDelta: variance.heightDelta, source: `${dir}/variance.json`, ...(variance.gradedAgainst ? { gradedAgainst: variance.gradedAgainst, ...(variance.gradedAgainst !== capturedAt ? { stale: true } : {}) } : {}) };
// no-op: the differing-pixel count did not move vs the previous counted round
// — the fix never applied (gate doc § Iteration discipline); the round still counts.
if (counts && prev && Number.isFinite(j.differingPixels) && prev.differingPixels === j.differingPixels) out.noOp = { vs: prev.label, differingPixels: j.differingPixels };
fs.writeFileSync(rec, `${JSON.stringify(out, null, 2)}\n`);
// The VERDICT LINE: verdict + the two gated numbers + the cap position on one
// line (gate doc § Iteration discipline) — the line the loop reads.
const iterPart = counts ? `iteration ${out.iteration}/3${out.overCap ? ` (over-cap: ${out.overCap})` : ''}${out.noOp ? `  NO-OP — differing pixels unchanged vs ${out.noOp.vs} (${out.noOp.differingPixels}): the fix never applied` : ''}` : 'not counted (no verdict or live-drift recapture)';
console.log(`verdict: ${out.verdict}${Number.isFinite(j.pixelPct) ? ` ${j.pixelPct} % Δh ${j.heightDelta}px` : ''}${out.failClass ? `  failClass: ${out.failClass} (build ${broken.build} − live ${broken.live} broken image(s) > ${broken.threshold} of ${broken.imgCount})` : ''}  ${iterPart}`);
console.log(`regime: ${regime}  reference: ${liveUrl} @${width} captured ${capturedAt}${side ? ` via ${side.technique || side.instrument?.name || 'unknown'}${side.source && side.source !== 'stitch-shot' ? ` (source: ${side.source})` : ''}` : ' (live.png mtime)'}${j.forced ? '  FORCED (incomparable captures — not a gate number)' : ''}${out.liveDrift ? `  LIVE DRIFT (Δh ${out.liveDrift.docAfter - out.liveDrift.docBefore}px — reference recaptured, round not counted)` : ''}${out.noiseFloor ? `  noise floor ${out.noiseFloor.pixelPct} % (raw ${j.pixelPct} % is the gated number${out.noiseFloor.stale ? `; floor graded against the ${out.noiseFloor.gradedAgainst} reference` : ''})` : ''}  record: ${rec}`);
NODE
  # --record: upsert this breakpoint's block in stardust/replica/progress.json
  # (iterations + result copied from the records — never typed). Never fails
  # the round: the number stands whether or not the ledger took it.
  [ -n "$RECORD" ] && node "$HERE/progress-record.mjs" "$DIR/gate-$LBL.json"
fi
# broken-image gate: a definitive compare (0 / 2) becomes FAIL; 124 / incomparable stay no verdict
if [ "$BROKEN_FAIL" = "1" ] && { [ $rc -eq 0 ] || [ $rc -eq 2 ]; }; then rc=2; fi
exit $rc
