#!/usr/bin/env bash
# Starts the headless Chrome (CDP on 9222) the cdp-connect cases drive. Prints its PID.
set -euo pipefail
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
profile=$(mktemp -d)
"$chrome" --headless=new --remote-debugging-port=9222 --user-data-dir="$profile" --no-first-run about:blank >/dev/null 2>&1 &
echo $!
for _ in $(seq 1 30); do curl -sf http://localhost:9222/json/version >/dev/null && exit 0; sleep 0.5; done
echo "Chrome did not open port 9222" >&2
exit 1
