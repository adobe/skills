#!/usr/bin/env bash
# Starts the fixture site for a scenario, detached, and returns once it answers. Called by a
# scenario's setup.sh, in the work directory of the run.
#
# Usage: bash plugins/stardust/evals/fixture-site/start.sh [--scripts] [--help]
#
#   --scripts   also copy the plugin's scripts into the work directory as the replica skill's
#               Setup step 3 does (skills/<skill>/scripts → stardust/scripts/<skill>/), for a
#               scenario that resumes a run in which that step is done
#
# The site is served from this checkout, never copied into the work directory: an agent that
# could read the site's source files would not have to measure the page. A server that already
# answers as the fixture on the port is reused (the two runs of a comparison come one after the
# other). The server stops by itself after an hour without a request: the eval tooling has no
# teardown step. FIXTURE_PORT changes the port (default 8780); the tasks name 8780.
# Exit codes: 0 serving, 1 the port answers as something else or the server did not come up.
set -euo pipefail
case "${1:-}" in --help|-h) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${FIXTURE_PORT:-8780}"
URL="http://127.0.0.1:${PORT}/__fixture"
is_fixture() { curl -fsS --max-time 2 "$URL" 2>/dev/null | grep -q '"fixture":"stardust-evals-store"'; }

if ! is_fixture; then
  if curl -sS --max-time 2 -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then
    echo "start.sh: port ${PORT} answers, but not as the fixture site: not started" >&2
    exit 1
  fi
  # detached, with no stream of the caller left open: a runner that waits for the setup
  # script's output to close would otherwise wait for the server
  nohup node "$HERE/serve.mjs" --port "$PORT" --idle-exit 3600 >/dev/null 2>&1 </dev/null &
  for _ in $(seq 1 50); do is_fixture && break; sleep 0.2; done
  is_fixture || { echo "start.sh: the fixture site did not come up on port ${PORT}" >&2; exit 1; }
fi
echo "fixture site: http://localhost:${PORT}/"

if [ "${1:-}" = "--scripts" ]; then
  for dir in "$HERE"/../../skills/*/scripts; do
    skill="$(basename "$(dirname "$dir")")"
    mkdir -p "stardust/scripts/$skill"
    cp -R "$dir"/. "stardust/scripts/$skill/"
  done
  echo "scripts: stardust/scripts/<skill>/"
fi
