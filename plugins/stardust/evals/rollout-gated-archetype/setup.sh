#!/usr/bin/env bash
# The plugin scripts as the master skill's Setup leaves them: skills/<skill>/scripts → stardust/scripts/<skill>/.
# No server: the scenario is local, the source site of the fixture is not reachable on purpose.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
for dir in "$HERE"/../../skills/*/scripts; do
  skill="$(basename "$(dirname "$dir")")"
  mkdir -p "stardust/scripts/$skill"
  cp -R "$dir"/. "stardust/scripts/$skill/"
done
echo "scripts: stardust/scripts/<skill>/"
