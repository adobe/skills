#!/usr/bin/env bash
# gate-publish.test stub round runner: honours GATE_DIR_ROOT exactly as gate.sh does (DIR = $GATE_DIR_ROOT/<slug>-<W>),
# writes one PASS record + the two crop-compare records for the label it was handed (the driver's crop pass runs only
# when live.png/build.png exist — a stub has none, so it writes the crop records itself) and records its argv + env
# root — no browser, no network.
SLUG=$1; W=$4; LBL=$5
DIR="${GATE_DIR_ROOT:-stardust/replica/gates}/$SLUG-$W"
mkdir -p "$DIR"
printf '%s\n' "$*" >> "$DIR/calls.txt"
printf '%s' "$GATE_DIR_ROOT" > "$DIR/env-root.txt"
printf '{ "verdict": "PASS", "exit": 0, "label": "%s", "width": %s, "regime": "published-origin", "at": "2026-09-20T00:00:00Z", "pixelPct": 1.2, "pixelPctUnmasked": 3.4, "heightDelta": 2, "pass": true, "ref": { "capturedAt": "2026-09-19T00:00:00Z" } }\n' "$LBL" "$W" > "$DIR/gate-$LBL.json"
printf '{ "matchPct": 99.5, "diffPct": 0.5, "pass": true }\n' > "$DIR/crop-header-$LBL.json"
printf '{ "matchPct": 99.1, "diffPct": 0.9, "pass": true }\n' > "$DIR/crop-footer-$LBL.json"
exit 0
