#!/bin/bash
# skills/replica/scripts/gate.sh — one pixel-gate round in one command
#
# Gates the build against the page's FROZEN ORIGIN REFERENCE (§ Origin reference: primed, measured
# against itself, frozen once per page × width by reference.mjs — hit minimization,
# source-fidelity-gate.md § Iteration discipline), runs the horizontal-overflow assert on the build
# side, runs pixel-compare ALIGNED (§ Pixel criterion), and prints the verdict lines that drive the
# loop (size / height delta / differing % / aligned % and offset steps / bands / reference /
# overflow). The prototype/build side is re-captured every round; the origin never is, until its
# baseline.png + baseline.json are deleted (site changed, capture hardening changed, a new
# --consent / --dismiss selector, another --locale).
#
# Usage:
#   stardust/scripts/replica/gate.sh <slug> <live-url> <build-url> <width> [iter-label]
#       [--marker <string>] [--full] [--main <selector>] [--consent <sel>] [--dismiss <sel,…>]
#       [--no-dismiss] [--locale <tag>] [--mask <yA:h[@yB],…>] [--live-origin]
#       [--gate-against-baseline] [--help]
#
# Origin reference (the default origin of every round):
#   No usable frozen reference in the evidence dir (`stitch-shot.mjs baseline <dir> --url --width`:
#   baseline.png + baseline.json for this URL and width) → the round freezes one first:
#   `reference.mjs freeze <live-url> <dir> --width <w>` with the round's overlay flags and locale — one
#   PRIMING capture discarded (the session's first visit is not the page's steady state: on 5 of 25
#   recorded pages it differed from every later capture by 4–75 %), two kept captures compared with
#   each other (the NOISE FLOOR; 4 of 25 pages vary 2–16 % on every capture), the rows where the page
#   differs from itself derived as a mask. Its exits: 0 frozen → the round goes on; 2 UNSTABLE (the
#   captures are not one page: nothing frozen) → reference.mjs's one line, then this round ENDS WITHOUT
#   A VERDICT, exit 5, not counted — pin the page's state (--consent / --dismiss, --locale) and re-run,
#   or read <dir>/reference-unstable.json + ref-*.png and, when the variation is the page's own,
#   `reference.mjs freeze <live-url> <dir> --width <w> --force`; 3 bot challenge and 124 deadline as a
#   capture's (below); 1 is retried once like a capture. The freeze runs under GATE_REFERENCE_TIMEOUT
#   (each capture under GATE_STITCH_TIMEOUT).
#   A usable reference is the origin side with no capture: baseline.png copied over live.png (sibling
#   temp + rename), live.json records origin "baseline" + originBaseline { capturedAt, height }; a copy
#   or record that fails ends the round (exit 1). `reference.mjs mask <dir>` — the page's self-varying
#   rows — joins the pixel-compare --mask list (with any --mask of the caller), and one line says what
#   the round was gated against:
#   `gate.sh: reference: frozen <capturedAt>, noise floor 2.31% in 2 region(s) — 708 rows excluded`.
#   It holds the PIXEL target still only: a --full round's probes still navigate the live URL.
#   --live-origin   this round gates against a live capture instead, as every round did before the
#            reference: live.png captured when absent and reused (unprimed, no noise floor, no mask); a
#            live.png whose live.json says origin "baseline" is retaken (one line), one with no
#            live.json is reused when its live.capture.json records fixedLayers, else retaken.
#            GATE_REFERENCE=live in the environment does the same for every round — the opt-out for a
#            project copy mid-run. Without reference.mjs beside this script: one stdout line, the round
#            gates against a live capture (re-copy the replica scripts dir).
#   --gate-against-baseline   accepted, a no-op: the frozen reference is the default (it overrides
#            GATE_REFERENCE=live for the round).
#
#   Settings: a usable reference whose recorded capture settings (baseline.json `flags`: --consent, --dismiss,
#   --no-dismiss, --locale; no --locale = en-US) differ from this round's is deleted and frozen again under this
#   round's flags, one line: `gate.sh: reference: re-frozen — capture settings changed (consent, locale)` — the
#   freeze is never a round (the round that follows counts as any other; an UNSTABLE re-freeze is exit 5, nothing
#   frozen). One frozen without recorded flags (an older reference.mjs or stitch-shot --freeze-baseline) is reused:
#   `gate.sh: reference: reused — settings not recorded`.
#
# Stage (the round's budget, its pixel bound and its probes; written to verdict-<label>.json `stage`):
#   prototype    the build URL is local (http://localhost*, http://127.0.0.1*, file:*) AND its path ends in
#                -proposed.html (stardust/prototypes/<slug>-proposed.html), or GATE_REGIME=prototype
#   local-build  the build URL is local and anything else — a local preview of the delivered build (a dev server,
#                a harness) — or GATE_REGIME=local-build. Its own round budget (rounds.mjs, same cap), the
#                prototype stage's offset bound (8 px) and --full probes (no content-presence); unit-geometry
#                reads the delivered block's selector (its --stage published)
#   published    any other build URL, or GATE_REGIME=published
#
# Pixel criterion (pixel-compare.mjs --offset-max owns the rule; its --help):
#   pixel-compare runs with --align: beside the overlap number (B laid on A from the top-left, so a
#   5 px shift near the top read 13.7 %) it finds the vertical offset steps between the two captures
#   and counts again. The criterion passes when
#       aligned % ≤ threshold (10)   AND   total offset (the sum of |step|) ≤ GATE_OFFSET_MAX_PX
#   GATE_OFFSET_MAX_PX defaults to 8 in the prototype and local-build stages and, in the published one, to the larger
#   of 8 and 1 % of the origin height. Aligned % within the threshold but offsets over the bound → FAIL
#   with `offsets: 3 step(s), 37px total — −5px at y=103, −20px at y=2125, …`, never a percentage: the
#   steps are the fix list, every one in ONE round (at most 6 printed, then `… N more`; all of them in
#   pixel-<label>.json). Alignment not used (aligned.used false: no step found, or not lower) → the
#   unaligned number against the threshold, as before; a round that passed on the unaligned number
#   still passes unless its offsets exceed the bound. The line, after pixel-compare's own:
#   `pixel: aligned 1.23% (unaligned 16.62%) → PASS — offsets: 1 step(s), 5px total — −5px at y=103 (bound 8px)`.
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
# Overlay dismissal: one shared dismissOverlays (live-session.mjs) on both captures, the probes and
#   chrome-parity (flags below); symmetric by construction — the build has nothing to dismiss, so it
#   cannot bias the diff.
#
#   --full   the whole probe set in one round: after the pixel verdict the other
#            probes run IN PARALLEL, each under its own deadline — content-diff
#            (structural 🔴 count), visual-diff (advisory flags), chrome-parity
#            (header/footer deltas, live side cached), clip-probe on the BUILD side
#            (text / controls cut or hidden by an overflow ancestor — no live hit;
#            #125, a fixed-height card clipped every link on a pixel-PASS page),
#            content-presence live vs build in the PUBLISHED stage only (§ Stage), and unit-geometry when stardust/replica/units.json declares a
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
#   --consent <sel>     site-specific consent-accept selector (clicked before the built-in candidates) —
#                       reaches both captures, the diff probes and chrome-parity
#   --dismiss <sel,…>   extra overlay-dismiss selectors (marketing modals with non-standard closers), same reach
#   --no-dismiss        do not dismiss consent/marketing overlays — captures, probes and chrome-parity (exit 125
#                       together with --consent / --dismiss: they contradict)
#   --locale <tag>      pin Accept-Language + locale (e.g. en-GB) — the reference, both captures, the probes
#   --mask <yA:h[@yB],…>  rows excluded from the pixel number (pixel-compare --mask; repeatable) — merged with
#                       the reference's self-varying rows
#   --live-origin | --gate-against-baseline   § Origin reference
#
# Example (iteration 2 of the home archetype at 1440):
#   stardust/scripts/replica/gate.sh home "https://<site>/" \
#     "http://localhost:8791/home-proposed.html" 1440 iter2
#
# Evidence lands in stardust/replica/gates/<slug>-<width>/
# (baseline.png + baseline.json — the frozen reference, with its ref-*.png captures — live.png, live.json,
# build.png, diff-<label>.png + diff-<label>-aligned.png, pixel-<label>.json (pixel-compare's summary: both
# numbers, every offset step, the aligned bands), overflow-<label>.txt, and verdict-<label>.json for every
# round that reached a verdict: { round, width, stage, pixel { rc, diff, json, pct, alignedPct, alignedUsed,
# totalShift, steps (≤ 12), offsetBound, maskedRows, noiseFloor, reason }, reference, probes, structural,
# nothingLost, at } — a round deletes earlier rounds' diff-*.png and vdiff-*/ dirs, their text and JSON stay
# (#156, disk); a capture also leaves its record, live.capture.json / build.capture.json — stitch-shot's).
#
# Fonts (every round, both sides — source-fidelity-gate.md § Hardening rule 14): after the
#   overflow line, one `gate.sh: fonts on the <live|build> capture — …` line per side from the
#   capture record's fontsFailed — the DEAD FACE(S), `every declared face loaded`, or NOT CHECKED
#   (null, or no readable record: an older stitch-shot copy, or a live.png from a round before
#   the check). On a frozen-reference round the live side reads the frozen baseline's check.
#   Information for the loop, never a verdict (gate-all fails its rows on the same records).
#
# Fail-loud contract: a stitch-shot bot challenge (exit 3 — an edge
# interstitial or a 2xx denial page; the capture's one-line reason precedes
# this script's BLOCKED line on stderr) or capture error aborts the round — a
# missing/blocked side must never be compared, and a blocked round has no
# verdict. Exit codes: 0 gate PASS, 2 gate FAIL (the pixel criterion, or horizontal
# overflow on the build side), 3 bot challenge, 1 capture/compare error (after the one
# retry — re-queue, not a verdict), 4 build-side identity assertion failed
# (the URL serves something that isn't this project's page — wrong/stale
# server), 5 origin reference UNSTABLE — nothing frozen, no verdict, not a counted
# round (§ Origin reference), 124 instrument deadline exceeded (not a measurement —
# see below), 125 unknown argument (usage), 6 round refused by the cap.
#
# Round cap (source-fidelity-gate.md § Iteration discipline): before any other work
#   `rounds.mjs check` reads <evidence dir>/rounds.json for this stage (§ Stage); at the cap, or after a recorded
#   decision closed the triple, the round ends with rounds.mjs's one line on stderr (it names
#   the `rounds.mjs decide` command) and exit 6 — no curl, no capture. A round that ends with
#   a verdict (exit 0 or 2) is recorded by `rounds.mjs record`; 1, 3, 4, 5, 124 and 125 never are.
#   A round that failed the overflow assert is recorded with --overflow: its re-run is not refused.
#   STARDUST_ROUND_CAP=0 turns the refusal off (rounds are still recorded) — for a project
#   mid-run when this check arrives. The guard fails closed: without rounds.mjs beside this
#   script, or when its check ends with any code other than 0 or 6, the round does not run
#   (exit 1, before any curl or capture) — re-copy the replica scripts dir, or repair
#   <evidence dir>/rounds.json. Only STARDUST_ROUND_CAP=0 runs a round the guard could not check.
#
# Measure first: a prototype-stage round for a page and width with no source spec
#   (stardust/replica/spec/<slug>-<width>.json) prints one advisory line naming the
#   `source-spec.mjs capture` and `compare` commands; the round still runs.
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
#   GATE_REFERENCE_TIMEOUT  seconds for one reference freeze (default 3 × GATE_STITCH_TIMEOUT + 3 × GATE_COMPARE_TIMEOUT)
#   GATE_OFFSET_MAX_PX   px of total offset the pixel criterion allows (default: 8 prototype and local-build;
#                        published the larger of 8 and 1 % of the origin height)
#   GATE_FONT_SUBST      "<brand>=<substitute>[,…]" for chrome-parity (default: the lines of stardust/replica/font-subst.txt)
#   GATE_CHROME_REGION   "header=<liveSel>|<buildSel>[;footer=…]" when chrome-parity cannot resolve a region (its exit 4)
#   GATE_REGIME          prototype | local-build | published — the stage, whatever the build URL (§ Stage)
#   GATE_REFERENCE       live = every round gates against a live capture (--live-origin); default frozen
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
LOCALE=""
MASK=""
case "${GATE_REFERENCE:-frozen}" in
  frozen) BASELINE=1 ;;
  live) BASELINE=0 ;;
  *) echo "gate.sh: GATE_REFERENCE must be frozen or live (got '${GATE_REFERENCE}')" >&2; exit 125 ;;
esac
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
    --locale) LOCALE=${2:?--locale needs a tag}; shift 2 ;;
    --mask) MASK="${MASK:+$MASK,}${2:?--mask needs yA:h[@yB],…}"; shift 2 ;;
    --gate-against-baseline) BASELINE=1; shift ;;
    --live-origin) BASELINE=0; shift ;;
    --help|-h) sed -n '2,/^set -u$/p' "$0" | grep -E '^#' | sed -E 's/^# ?//'; exit 0 ;;
    *) echo "gate.sh: unknown argument $1 (see --help)" >&2; exit 125 ;;
  esac
done

if [ "$DISMISS" = 0 ] && { [ -n "$CONSENT" ] || [ -n "$DISMISS_EXTRA" ]; }; then
  echo "gate.sh: --no-dismiss contradicts --consent / --dismiss — drop one (see --help)" >&2; exit 125
fi
# Overlay flags per step (header § Overlay dismissal). stitch-shot and chrome-parity take --consent <sel>,
# --dismiss <sel,…> and --no-dismiss; the diff probes take one --dismiss [sel,…] (bare = the built-in candidates only), so the site's
# selectors are joined for them. Arrays expand as ${a[@]+"${a[@]}"}: macOS /bin/bash is 3.2, where an empty array
# under set -u is an unbound variable.
build_opts() {
  STITCH_OPTS=(); PROBE_OPTS=(); CHROME_OPTS=()
  if [ "$DISMISS" = 1 ]; then
    [ -n "$CONSENT" ] && { STITCH_OPTS+=(--consent "$CONSENT"); CHROME_OPTS+=(--consent "$CONSENT"); }
    [ -n "$DISMISS_EXTRA" ] && { STITCH_OPTS+=(--dismiss "$DISMISS_EXTRA"); CHROME_OPTS+=(--dismiss "$DISMISS_EXTRA"); }
    EXTRA="${CONSENT:+$CONSENT,}$DISMISS_EXTRA"; EXTRA=${EXTRA%,}
    if [ -n "$EXTRA" ]; then PROBE_OPTS=(--dismiss "$EXTRA"); else PROBE_OPTS=(--dismiss); fi
  else
    STITCH_OPTS=(--no-dismiss); CHROME_OPTS=(--no-dismiss)
  fi
  # --locale reaches the reference, both captures and every probe (they all take the flag).
  if [ -n "$LOCALE" ]; then STITCH_OPTS+=(--locale "$LOCALE"); PROBE_OPTS+=(--locale "$LOCALE"); CHROME_OPTS+=(--locale "$LOCALE"); fi
}
build_opts
# chrome-parity only: the declared font substitutions (one <brand>=<substitute> per line) and region overrides.
PARITY_OPTS=()
FONT_SUBST=${GATE_FONT_SUBST:-$( [ -f stardust/replica/font-subst.txt ] && grep -vE '^[[:space:]]*(#|$)' stardust/replica/font-subst.txt | paste -sd, - )}
[ -n "$FONT_SUBST" ] && PARITY_OPTS+=(--font-subst "$FONT_SUBST")
if [ -n "${GATE_CHROME_REGION:-}" ]; then IFS=';' read -r -a _regions <<< "$GATE_CHROME_REGION"; for _r in "${_regions[@]}"; do PARITY_OPTS+=(--region "$_r"); done; fi

HERE=$(cd "$(dirname "$0")" && pwd)
DIR="stardust/replica/gates/$SLUG-$W"
mkdir -p "$DIR"

STITCH_TIMEOUT=${GATE_STITCH_TIMEOUT:-300}
COMPARE_TIMEOUT=${GATE_COMPARE_TIMEOUT:-120}
PROBE_TIMEOUT=${GATE_PROBE_TIMEOUT:-300}
REF_TIMEOUT=${GATE_REFERENCE_TIMEOUT:-$(( 3 * STITCH_TIMEOUT + 3 * COMPARE_TIMEOUT ))}
OVF_TOL=${GATE_OVERFLOW_TOLERANCE:-4}
case "$OVF_TOL" in ''|*[!0-9]*) echo "gate.sh: GATE_OVERFLOW_TOLERANCE must be a whole number of px (got '$OVF_TOL')" >&2; exit 125 ;; esac
case "${GATE_OFFSET_MAX_PX:-}" in *[!0-9]*) echo "gate.sh: GATE_OFFSET_MAX_PX must be a whole number of px (got '$GATE_OFFSET_MAX_PX')" >&2; exit 125 ;; esac
REAP_MIN=${GATE_REAP_MIN:-15}
# Stage (header § Stage): a local build URL whose path ends in -proposed.html = prototype, any other local build URL =
# local-build, else published; GATE_REGIME overrides. The path is the URL without its query and fragment.
case "${GATE_REGIME:-auto}" in
  prototype|local-build|published) REGIME=$GATE_REGIME ;;
  *) case "$BUILD_URL" in
       http://localhost*|http://127.0.0.1*|file:*) case "${BUILD_URL%%[?#]*}" in *-proposed.html) REGIME=prototype ;; *) REGIME=local-build ;; esac ;;
       *) REGIME=published ;;
     esac ;;
esac
# What the two-stage instruments take: pixel-compare's --offset-max bound (local-build = the prototype's 8 px) and
# unit-geometry's served-side selector (local-build serves the delivered blocks = published).
case "$REGIME" in local-build) OFFSET_STAGE=prototype; UNIT_STAGE=published ;; *) OFFSET_STAGE=$REGIME; UNIT_STAGE=$REGIME ;; esac
# Round cap (header § Round cap): check before anything is reaped, fetched or captured, so a refused round costs
# one node start; record on exit, only for a round that reached a verdict (ROUND_VERDICT) and exits 0 or 2.
ROUND_VERDICT=0
if [ -f "$HERE/rounds.mjs" ]; then
  node "$HERE/rounds.mjs" check "$DIR" --stage "$REGIME" --label "$LBL"; rc=$?
  [ "$rc" -eq 6 ] && exit 6
  if [ "$rc" -ne 0 ]; then
    if [ "${STARDUST_ROUND_CAP:-}" = 0 ]; then echo "gate.sh: rounds.mjs check exited $rc — the round runs unchecked (STARDUST_ROUND_CAP=0)" >&2
    else echo "gate.sh: rounds.mjs check exited $rc — the cap could not be checked, so the round does not run (repair $DIR/rounds.json, or STARDUST_ROUND_CAP=0 to run without the cap)" >&2; exit 1; fi
  fi
  round_record() {
    [ "$ROUND_VERDICT" = 1 ] || return 0
    case "$1" in 0) v=pass ;; 2) v=fail ;; *) return 0 ;; esac
    node "$HERE/rounds.mjs" record "$DIR" --stage "$REGIME" --label "$LBL" --verdict "$v" ${ROUND_OVERFLOW:+--overflow} || echo "gate.sh: rounds.mjs record failed — this round is not in $DIR/rounds.json" >&2
  }
  trap 'round_record $?' EXIT
elif [ "${STARDUST_ROUND_CAP:-}" = 0 ]; then
  echo "gate.sh: $HERE/rounds.mjs missing — the round runs uncounted (STARDUST_ROUND_CAP=0); re-copy the replica scripts dir (replica SKILL.md § Setup)"
else
  echo "gate.sh: $HERE/rounds.mjs missing — the cap cannot be checked, so the round does not run; re-copy the replica scripts dir (replica SKILL.md § Setup), or STARDUST_ROUND_CAP=0 to run without the cap" >&2; exit 1
fi
# Measure first (recreation-procedure.md § Authoring order): a prototype round with no source spec for this page
# and width says so, once per round — advisory, the round runs. The spec is what the prototype is authored from
# and cleared against (`source-spec.mjs compare` exit 0) BEFORE the first gate round.
if [ "$REGIME" = prototype ] && [ -f "$HERE/source-spec.mjs" ] && [ ! -f "stardust/replica/spec/$SLUG-$W.json" ]; then
  echo "gate.sh: no source spec for $SLUG at $W (stardust/replica/spec/$SLUG-$W.json) — measure before gating: node $HERE/source-spec.mjs capture \"$LIVE_URL\" --slug $SLUG --widths $W, author from it, then source-spec.mjs compare <spec> \"$BUILD_URL\" to exit 0 (recreation-procedure.md § Authoring order)"
fi
# Origin reference (header § Origin reference): `stitch-shot.mjs baseline <dir> --url --width` answers with the frozen
# baseline's capturedAt (exit 0) or the one-line reason it is unusable (exit 1) — then one is frozen below, after the
# reap and the identity assertion (a foreign build server costs one curl, not three live captures).
BASE_AT=""; HAVE_BASE=0; ORIGIN=live
if [ "$BASELINE" = 1 ] && [ ! -f "$HERE/reference.mjs" ]; then
  echo "gate.sh: $HERE/reference.mjs missing — this round gates against a live capture (unprimed, no noise floor); re-copy the replica scripts dir (replica SKILL.md § Setup)"
  BASELINE=0
fi
if [ "$BASELINE" = 1 ]; then
  ORIGIN=frozen
  if BASE_AT=$(node "$HERE/stitch-shot.mjs" baseline "$DIR" --url "$LIVE_URL" --width "$W"); then HAVE_BASE=1; fi
fi
# Capture settings (header § Origin reference, Settings): `reference.mjs settings <dir> <this round's flags>` answers
# `same`, `changed: <names>` or `not recorded`. Changed → the reference is frozen again below (REFREEZE names what
# changed); an older reference.mjs without the subcommand answers nothing and the reference is reused as before.
REFREEZE=""
if [ "$HAVE_BASE" = 1 ]; then
  SETTINGS=$(node "$HERE/reference.mjs" settings "$DIR" ${STITCH_OPTS[@]+"${STITCH_OPTS[@]}"} 2>/dev/null | tail -1)
  case "$SETTINGS" in
    "changed: "*) REFREEZE=${SETTINGS#changed: }; HAVE_BASE=0 ;;
    "not recorded") echo "gate.sh: reference: reused — settings not recorded (frozen by an older version: delete $DIR/baseline.json to freeze it under this round's flags)" ;;
  esac
fi
# A reused reference's settings that this round omits are taken from it (reference.mjs settings --inherit, one
# argument per line): the build capture and the probes then see the page the reference was frozen from.
if [ "$HAVE_BASE" = 1 ]; then
  INHERITED=""
  while IFS= read -r a; do
    case "$a" in
      --consent) IFS= read -r CONSENT; INHERITED="$INHERITED --consent $CONSENT" ;;
      --dismiss) IFS= read -r DISMISS_EXTRA; INHERITED="$INHERITED --dismiss $DISMISS_EXTRA" ;;
      --no-dismiss) DISMISS=0; INHERITED="$INHERITED --no-dismiss" ;;
      --locale) IFS= read -r LOCALE; INHERITED="$INHERITED --locale $LOCALE" ;;
    esac
  done < <(node "$HERE/reference.mjs" settings "$DIR" ${STITCH_OPTS[@]+"${STITCH_OPTS[@]}"} --inherit 2>/dev/null)
  if [ -n "$INHERITED" ]; then build_opts; echo "gate.sh: reference: settings this round omits are the frozen reference's —$INHERITED (the build capture and the probes run under them)"; fi
fi
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
# A capture that did not exit 0 ends the round without a verdict. 3 is the blocked class — a bot challenge or a 2xx
# denial page (stitch-shot's reason line precedes this one): never a pixel number, escalate --headed. $1 side, $2 rc.
capture_failed() {
  if [ "$2" -eq 3 ]; then
    echo "gate.sh: $1 capture BLOCKED (exit 3) — a bot challenge or 2xx denial page, not the page: no verdict for this round; escalate --headed" >&2
  else
    echo "gate.sh: $1 capture failed (exit $2) — not comparing$([ "$2" -eq 1 ] && printf ' (twice: no verdict — re-queue the round)')" >&2
  fi
  exit "$2"
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
# (--settle: live JS-heavy pages need the lazyload pass; STITCH_OPTS: the
# round's overlay dismissal, header § Overlay dismissal). Never swallow the
# output — exit 3 here means "blocked, escalate --headed", not "skip".
# The frozen reference (the default) is the origin side instead — frozen first when the dir has no usable one
# (reference.mjs freeze: its one line on stdout, its captures' output on stderr; exit 2 = unstable → exit 5, no
# verdict), then baseline.png copied over live.png (sibling temp + rename, so a crash never leaves a torn origin) and
# live.json written by `stitch-shot.mjs record` (origin "baseline", originBaseline { capturedAt, height }), so a later
# round can tell the frozen copy from a live capture; no live shot is taken (a --full round's probes still navigate
# the live URL). The previous round's records — live.json and the capture record live.capture.json — go first, and a
# copy or record that fails removes live.png and ends the round (exit 1, one line): baseline bytes never sit under a
# missing or stale record.
# --live-origin / GATE_REFERENCE=live: a live.png whose live.json says origin "baseline" was a frozen round's copy —
# retaken with one line, its records removed with it; a live.png with no live.json is a live capture — reused only
# when live.capture.json records fixedLayers, else retaken (below).
if [ "$BASELINE" = 1 ] && [ "$HAVE_BASE" = 0 ]; then
  if [ -n "$REFREEZE" ]; then
    # the reference of other settings goes first, with what was derived from it: an unstable or failed re-freeze
    # leaves none, never the old one to gate against
    rm -f "$DIR/baseline.png" "$DIR/baseline.json" "$DIR/chrome-live.json"
  else
    echo "gate.sh: no usable frozen reference for $SLUG@$W (${BASE_AT:-none}) — freezing one: a priming capture, then two kept (reference.mjs freeze)"
  fi
  REF_LINE="$DIR/reference-freeze.txt"
  freeze_ref() { capped "$REF_TIMEOUT" "reference freeze $SLUG@$W" node "$HERE/reference.mjs" freeze "$LIVE_URL" "$DIR" --width "$W" --timeout "$STITCH_TIMEOUT" ${STITCH_OPTS[@]+"${STITCH_OPTS[@]}"} > "$REF_LINE"; }
  retry_once "reference freeze" freeze_ref
  rc=$?
  WHY=$(grep -E '^reference:' "$REF_LINE" 2>/dev/null | tail -1)
  case "$rc" in
    0) [ -n "$REFREEZE" ] && echo "gate.sh: reference: re-frozen — capture settings changed ($REFREEZE)"
       echo "gate.sh: ${WHY:-reference: frozen}" ;;
    2) echo "gate.sh: ${WHY:-reference: UNSTABLE; not frozen}" >&2
       FLAGS="${STITCH_OPTS[*]-}" # the round's overlay and locale flags: the forced freeze must capture the same page
       echo "gate.sh: REFERENCE UNSTABLE (exit 5) — the live page is not one page from capture to capture, so no build could meet it: NO VERDICT, the round is not counted. Pin the page's state and re-run — overlay flags (--consent <sel> / --dismiss <sel,…>), --locale <tag> — or read $DIR/reference-unstable.json (+ ref-*.png) and, when the variation is the page's own, freeze it anyway: node $HERE/reference.mjs freeze \"$LIVE_URL\" $DIR --width $W${FLAGS:+ $FLAGS} --force" >&2
       exit 5 ;;
    3) [ -n "$WHY" ] && echo "gate.sh: $WHY" >&2; capture_failed reference 3 ;;
    124) echo "gate.sh: reference freeze hit its deadline (exit 124) — no verdict, re-run the round${WHY:+: $WHY}" >&2; exit 124 ;;
    *) [ -n "$WHY" ] && echo "gate.sh: $WHY" >&2; capture_failed reference "$rc" ;;
  esac
  if ! BASE_AT=$(node "$HERE/stitch-shot.mjs" baseline "$DIR" --url "$LIVE_URL" --width "$W"); then
    echo "gate.sh: reference.mjs freeze exited 0 but $DIR holds no usable baseline (${BASE_AT:-none}) — not comparing; re-run the round" >&2; exit 1
  fi
fi
if [ "$BASELINE" = 1 ]; then
  rm -f "$DIR/live.json" "$DIR/live.capture.json"
  if ! { cp -f "$DIR/baseline.png" "$DIR/live.png.$$.tmp" && mv -f "$DIR/live.png.$$.tmp" "$DIR/live.png"; }; then
    rm -f "$DIR/live.png.$$.tmp" "$DIR/live.png"
    echo "gate.sh: could not copy $DIR/baseline.png over live.png — not comparing (re-run the round)" >&2; exit 1
  fi
  if ! node "$HERE/stitch-shot.mjs" record "$DIR/live.json" --origin baseline --baseline "$DIR/baseline.json" --url "$LIVE_URL" --width "$W"; then
    rm -f "$DIR/live.png"
    echo "gate.sh: could not write $DIR/live.json for the frozen origin — not comparing (a later round would read the copy as a live shot); re-run the round" >&2; exit 1
  fi
else
  if [ -f "$DIR/live.png" ] && [ -f "$DIR/live.json" ] && grep -qE '"origin": *"baseline"' "$DIR/live.json"; then
    echo "gate.sh: live.png is the frozen origin reference's copy; this round gates against the live origin (--live-origin / GATE_REFERENCE=live) — retaking it" >&2
    rm -f "$DIR/live.png" "$DIR/live.json" "$DIR/live.capture.json"
  fi
  # A live capture from before fixed layers were captured once (its live.capture.json has no fixedLayers) would be
  # compared with a build captured the new way — asymmetric: retake it.
  if [ -f "$DIR/live.png" ] && ! grep -q '"fixedLayers"' "$DIR/live.capture.json" 2>/dev/null; then
    echo "gate.sh: $DIR/live.png predates the fixed-layer capture (no fixedLayers in live.capture.json) — retaking it so both sides capture alike"
    rm -f "$DIR/live.png" "$DIR/live.json" "$DIR/live.capture.json"
  fi
  if [ ! -f "$DIR/live.png" ]; then
    capture_live() { rm -f "$DIR/live.png"; capped "$STITCH_TIMEOUT" "stitch-shot live $SLUG@$W" node "$HERE/stitch-shot.mjs" "$LIVE_URL" "$DIR/live.png" --width "$W" --settle ${STITCH_OPTS[@]+"${STITCH_OPTS[@]}"}; }
    retry_once "live capture" capture_live
    rc=$?
    [ $rc -ne 0 ] && rm -f "$DIR/live.png"   # never leave a partial live capture to be reused
    [ $rc -ne 0 ] && capture_failed live "$rc"
  fi
fi

# Build side: re-captured every iteration; exit 1 retried once (header § Capture retry); the same --settle pass and
# overlay flags as the live side — a symmetric instrument, as gate-all's (the build has nothing to dismiss, so those
# flags are no-ops there; an unsettled build against a settled origin measured 6 points apart on one deployed page).
capture_build() { capped "$STITCH_TIMEOUT" "stitch-shot build $SLUG@$W" node "$HERE/stitch-shot.mjs" "$BUILD_URL" "$DIR/build.png" --width "$W" --settle ${STITCH_OPTS[@]+"${STITCH_OPTS[@]}"}; }
retry_once "build capture" capture_build
rc=$?
[ $rc -ne 0 ] && capture_failed build "$rc"

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

# Disk (#156): only this round's diff image and vdiff dir stay; earlier rounds keep their text and JSON evidence.
find "$DIR" -maxdepth 1 -name 'diff-*.png' ! -name "diff-$LBL.png" -delete
find "$DIR" -mindepth 1 -maxdepth 1 -type d -name 'vdiff-*' ! -name "vdiff-$LBL" -exec rm -r {} +

# pixel-compare supervises its own deadline (--timeout); exit 124 = no verdict. --offset-max is the pixel criterion
# (header § Pixel criterion — pixel-compare owns the rule and prints the `pixel:` line): the regime's default bound,
# or GATE_OFFSET_MAX_PX. Masks: the caller's, then the reference's self-varying rows (reference.mjs mask).
REF_MASK=""
[ "$ORIGIN" = frozen ] && REF_MASK=$(node "$HERE/reference.mjs" mask "$DIR" 2>/dev/null | tail -1)
ALL_MASK="${MASK}${MASK:+${REF_MASK:+,}}${REF_MASK}"
MASK_OPTS=(); [ -n "$ALL_MASK" ] && MASK_OPTS=(--mask "$ALL_MASK")
PXJ="$DIR/pixel-$LBL.json"; rm -f "$PXJ" "$DIR/verdict-$LBL.json"
node "$HERE/pixel-compare.mjs" "$DIR/live.png" "$DIR/build.png" --out "$DIR/diff-$LBL.png" --timeout "$COMPARE_TIMEOUT" \
  --offset-max "${GATE_OFFSET_MAX_PX:-$OFFSET_STAGE}" --json-out "$PXJ" ${MASK_OPTS[@]+"${MASK_OPTS[@]}"}
PIXEL_RC=$?
# What the round was gated against, in one line: the frozen reference with its noise floor and the rows it excludes,
# or the live capture of an opted-out round.
if [ "$ORIGIN" = frozen ]; then
  node -e 'const b = (() => { try { return JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); } catch { return {}; } })();
    const v = Array.isArray(b.variable) ? b.variable : []; const rows = v.reduce((n, r) => n + (Number(r.h) || 0), 0);
    const floor = typeof b.noiseFloor === "number" ? `noise floor ${b.noiseFloor.toFixed(2)}%${v.length ? ` in ${v.length} region(s)` : ", no self-varying region"} — ${rows} rows excluded` : "noise floor not measured (frozen without priming — reference.mjs freeze --force measures it) — 0 rows excluded";
    console.log(`gate.sh: reference: frozen ${b.capturedAt || process.argv[2]}, ${floor}${b.stable === false ? ` [FORCED over an unstable page: ${b.reason}]` : ""}`);' "$DIR/baseline.json" "$BASE_AT"
else
  echo "gate.sh: reference: a live capture (--live-origin / GATE_REFERENCE=live, or no reference.mjs) — not primed, no noise floor measured, no rows excluded"
fi
# The overflow assert rules a PASS: a build wider than its viewport by more than the tolerance is a FAIL
# (exit 2) whatever the pixel number says; a round with no pixel verdict (124 / 1 / 3 / 4) keeps that code —
# the line is still printed. Within the tolerance (integer rounding of a subpixel width) the line says so.
if [ -n "$OVER" ] && [ "$OVER" -gt "$OVF_TOL" ]; then
  echo "gate.sh: OVERFLOW at $W — build scrollWidth $SW > viewport $VP (+${OVER}px) → FAIL (hard assert: no iteration cap waives horizontal overflow; evidence $OVF)"
  [ "$PIXEL_RC" = 0 ] && PIXEL_RC=2
  ROUND_OVERFLOW=1
elif [ -n "$OVER" ]; then
  echo "gate.sh: overflow assert at $W — build scrollWidth $SW vs viewport $VP (+${OVER}px, within the ${OVF_TOL}px rounding tolerance) → ok"
else
  echo "gate.sh: overflow assert at $W — build scrollWidth $SW = viewport → ok"
fi

# Fonts (header § Fonts): one line per side from the capture record, after the overflow line — the dead faces, every
# face loaded, or NOT CHECKED (fontsFailed null, or no readable record). The live side of a frozen-reference
# round has no capture record (live.png is the frozen copy): its line reads baseline.json. Information, never a verdict.
fonts_line() { # $1 side, $2 record, $3 the frozen baseline's record (live side only)
  node -e 'const [side, rec, base] = process.argv.slice(1); const read = (f) => { try { return JSON.parse(require("fs").readFileSync(f, "utf8")); } catch { return null; } };
    let j = read(rec); let from = "";
    if (!(j && typeof j === "object" && "fontsFailed" in j) && base) { const b = read(base); if (b && Array.isArray(b.fontsFailed)) { j = b; from = " (the frozen baseline\x27s check)"; } }
    const hint = side === "live" ? " — delete live.png to re-take it with the check" : " — re-copy stitch-shot.mjs (replica SKILL.md § Setup)";
    if (!j || typeof j !== "object" || !("fontsFailed" in j)) console.log(`gate.sh: fonts on the ${side} capture — NOT CHECKED (no readable capture record at ${rec}${hint})`);
    else if (!Array.isArray(j.fontsFailed)) console.log(`gate.sh: fonts on the ${side} capture — NOT CHECKED (${String(j.fontCheck || "the check could not run").replace(/^failed: /, "")}) — no face is known to have loaded`);
    else if (j.fontsFailed.length) console.log(`gate.sh: fonts on the ${side} capture — DEAD FACE(S) ${j.fontsFailed.join(", ")}: the capture renders fallback type for them (a file that failed to fetch, or a local() source this browser cannot resolve — recreation-procedure.md § Fonts policy)${from}`);
    else console.log(`gate.sh: fonts on the ${side} capture — every declared face loaded${from}`);' "$1" "$2" "$3"
}
case "$PIXEL_RC" in 0|2) ROUND_VERDICT=1 ;; esac
# The round's record (header § Evidence): the pixel numbers of THIS round — both percentages, the offsets, the masked
# rows, the reference's noise floor — and, under --full, which evidence file each probe's verdict read, its exit code
# and the two tiers, so a ledger entry points at this round's files, never at an older -iterN file beside them.
# Written for every round that reached a pixel verdict (0 or 2); a --full round writes it again with its probes.
write_verdict() { # $@: probe triples (name rc evidence-file; an empty file = the probe did not run)
  [ "$ROUND_VERDICT" = 1 ] || return 0
  G_PENDING="${VERDICT_PENDING:-}" G_PIXEL_RC="$PIXEL_RC" G_DIFF="$DIR/diff-$LBL.png" G_PXJ="$PXJ" G_BASE="$DIR/baseline.json" G_ORIGIN="$ORIGIN" G_STAGE="$REGIME" G_STRUCTURAL="${STRUCTURAL:-0}" G_LOST="${LOST:-0}" \
  node -e 'const [out, round, width, ...a] = process.argv.slice(1); const fs = require("fs"); const e = process.env; const n = (k) => Number(e[k] || 0);
    const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
    const probes = {}; for (let i = 0; i + 2 < a.length; i += 3) if (a[i + 2]) probes[a[i]] = { rc: Number(a[i + 1]), evidence: a[i + 2] };
    const j = read(e.G_PXJ) || {}; const al = j.aligned && j.aligned.used ? j.aligned : null; const b = e.G_ORIGIN === "frozen" ? read(e.G_BASE) || {} : null;
    const pixel = { rc: n("G_PIXEL_RC"), diff: e.G_DIFF, json: read(e.G_PXJ) ? e.G_PXJ : null, pct: j.pct ?? null, alignedPct: al ? al.pct : j.pct ?? null, alignedUsed: !!al, totalShift: al ? al.totalShift : 0,
      steps: al ? al.steps.slice(0, 12) : [], offsetBound: j.offsets ? j.offsets.bound : null, maskedRows: j.maskedRows ?? 0, noiseFloor: b && typeof b.noiseFloor === "number" ? b.noiseFloor : null, reason: j.reason ?? null };
    const reference = b ? { origin: "frozen", capturedAt: b.capturedAt ?? null, primed: b.primed === true, stable: b.stable !== false, maskArg: b.maskArg || "" } : { origin: "live" };
    fs.writeFileSync(out, JSON.stringify({ round, width: Number(width), stage: e.G_STAGE, pixel, reference, probes, ...(e.G_PENDING ? { pending: "probes" } : {}), structural: n("G_STRUCTURAL"), nothingLost: n("G_LOST"), at: new Date().toISOString() }, null, 2) + "\n");' \
    "$DIR/verdict-$LBL.json" "$LBL" "$W" "$@" 2>/dev/null || true
}
# Under --full the probes have not run yet: the record says so (pending), and nothing reads it as a verdict —
# a round killed in the probe phase leaves no pass on disk. The write after the probes drops the mark.
[ "$FULL" = 1 ] && VERDICT_PENDING=1
write_verdict
VERDICT_PENDING=
fonts_line live "$DIR/live.capture.json" "$([ "$ORIGIN" = frozen ] && echo "$DIR/baseline.json")"
fonts_line build "$DIR/build.capture.json" ""
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
UNITS_FILE="stardust/replica/units.json"
capped "$PROBE_TIMEOUT" "content-diff $SLUG@$W" node "$DIFF/content-diff.mjs" "$LIVE_URL" "$BUILD_URL" \
  --profile generic --width "$W" --main "$MAIN" ${PROBE_OPTS[@]+"${PROBE_OPTS[@]}"} > "$CD" 2>&1 &
P_CD=$!
capped "$PROBE_TIMEOUT" "visual-diff $SLUG@$W" node "$DIFF/visual-diff.mjs" "$LIVE_URL" "$BUILD_URL" \
  --profile generic --width "$W" --main "$MAIN" ${PROBE_OPTS[@]+"${PROBE_OPTS[@]}"} --out "$DIR/vdiff-$LBL" > "$VD" 2>&1 &
P_VD=$!
capped "$PROBE_TIMEOUT" "chrome-parity $SLUG@$W" node "$HERE/chrome-parity.mjs" "$LIVE_URL" "$BUILD_URL" \
  --width "$W" --live-cache "$DIR/chrome-live.json" ${CHROME_OPTS[@]+"${CHROME_OPTS[@]}"} ${PARITY_OPTS[@]+"${PARITY_OPTS[@]}"} > "$CP" 2>&1 &
P_CP=$!
# clip-probe on the BUILD side (every regime, no live hit); content-presence live vs build in the published regime;
# unit-geometry when the project declares repeated-unit families (a slug with none prints n/a, exit 0).
capped "$PROBE_TIMEOUT" "clip-probe $SLUG@$W" node "$DIFF/clip-probe.mjs" "$BUILD_URL" --width "$W" --json "$DIR/clip-$LBL.json" ${CHROME_OPTS[@]+"${CHROME_OPTS[@]}"} > "$CL" 2>&1 &
P_CL=$!
P_PR=""; P_UG=""
if [ "$REGIME" = published ]; then
  capped "$PROBE_TIMEOUT" "content-presence $SLUG@$W" node "$DIFF/content-presence.mjs" "$LIVE_URL" "$BUILD_URL" --width "$W" --json "$DIR/content-presence-$LBL.json" ${CHROME_OPTS[@]+"${CHROME_OPTS[@]}"} > "$PR" 2>&1 &
  P_PR=$!
fi
if [ -f "$UNITS_FILE" ] && [ -f "$DIFF/unit-geometry.mjs" ]; then
  capped "$PROBE_TIMEOUT" "unit-geometry $SLUG@$W" node "$DIFF/unit-geometry.mjs" "$LIVE_URL" "$BUILD_URL" --families "$UNITS_FILE" --stage "$UNIT_STAGE" --slug "$SLUG" --width "$W" --json "$DIR/units-$LBL.json" ${CHROME_OPTS[@]+"${CHROME_OPTS[@]}"} > "$UG" 2>&1 &
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
    4) case "$2" in
         chrome-parity) echo "$2: NO VERDICT (exit 4) — $3 (GATE_CHROME_REGION names it)" ;;
         *) echo "$2: ERROR (exit 4) — $(grep -iE 'error|HTTP [45][0-9][0-9]' "$4" | head -1 | cut -c1-160)" ;;
       esac ;;
    3) echo "$2: BLOCKED (exit 3) — bot challenge or 2xx denial page on the live side, escalate --headed" ;;
    *) echo "$2: ERROR (exit $1) — $(grep -iE 'error' "$4" | head -1 | cut -c1-160)" ;;
  esac
}
FINDINGS=$(grep -E '^Findings:' "$CD" | head -1 | sed -E 's/^Findings: //')
STRUCTURAL=$(printf '%s' "$FINDINGS" | grep -oE '[0-9]+ structural' | grep -oE '^[0-9]+' || echo 0)
# Two tiers (source-fidelity-gate.md § Pass bar item 1): looks-same = structural 🔴; nothing-lost = invisible losses.
TIERS=$(grep -E '^Tiers:' "$CD" | head -1)
LOST=$(printf '%s' "$TIERS" | grep -oE 'nothing-lost 🟡 [0-9]+' | grep -oE '[0-9]+$' || echo 0)
verdict "$RC_CD" "content-diff" "${FINDINGS:-no findings line}${TIERS:+ — ${TIERS#Tiers: }}" "$CD"
FLAGS=$(awk '/red flags \(advisory\)/{f=1;next} f&&/^[[:space:]]*•/{n++} f&&/^Full metrics/{exit} END{print n+0}' "$VD")
verdict "$RC_VD" "visual-diff" "$FLAGS advisory flag(s) — $(awk '/red flags \(advisory\)/{f=1;next} f&&/^[[:space:]]*•/{sub(/^[[:space:]]*• /,""); printf "%s; ", substr($0,1,60)} f&&/^Full metrics/{exit}' "$VD")" "$VD"
CHROME=$(grep -E '^(✗|✓|⚠)' "$CP" | tail -1 | cut -c1-200)
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
write_verdict content-diff "$RC_CD" "$CD" visual-diff "$RC_VD" "$VD" chrome-parity "$RC_CP" "$CP" clip-probe "$RC_CL" "$CL" \
  content-presence "$RC_PR" "${P_PR:+$PR}" unit-geometry "$RC_UG" "${P_UG:+$UG}"


# Exit: any deadline → 124 (re-run); else the pixel verdict rules, and a structural content 🔴, a
# nothing-lost 🟡 or a chrome delta fails the round the same way an over-threshold pixel diff does.
for rc in "$RC_CD" "$RC_VD" "$RC_CP" "$RC_CL" "$RC_PR" "$RC_UG" "$PIXEL_RC"; do [ "$rc" = 124 ] && exit 124; done
[ "$PIXEL_RC" != 0 ] && exit $PIXEL_RC
[ "${STRUCTURAL:-0}" -gt 0 ] 2>/dev/null && exit 2
# nothing-lost: an invisible loss (an aria-label, sr-only text, a heading flattened) fails the round like a visible one
[ "${LOST:-0}" -gt 0 ] 2>/dev/null && exit 2
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
