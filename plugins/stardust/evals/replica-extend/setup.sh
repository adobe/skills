#!/usr/bin/env bash
# A delivered project is a git repository (its checkpoint commits): the fixture becomes one commit. Then the
# fixture site on localhost, and the plugin scripts as Setup step 3 leaves them.
set -euo pipefail
if [ ! -d .git ]; then
  git init -q
  git add -A
  git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "delivered replica run (fixture)"
fi
exec bash "$(cd "$(dirname "$0")" && pwd)/../fixture-site/start.sh" --scripts
