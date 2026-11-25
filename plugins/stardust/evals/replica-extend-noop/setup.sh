#!/usr/bin/env bash
# The delivered project of ../replica-extend/fixture/ (one page delivered, the ledger closed with handoff end),
# copied into the work directory and committed as one commit, as a delivered project is; then the fixture site on
# localhost and the plugin scripts as Setup step 3 leaves them — the site answers, so a run that wrongly crawls it
# leaves its trace in the work directory.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f stardust/state.json ]; then cp -R "$HERE/../replica-extend/fixture/." .; fi
if [ ! -d .git ]; then
  git init -q
  git add -A
  git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "delivered replica run (fixture)"
fi
exec bash "$HERE/../fixture-site/start.sh" --scripts
