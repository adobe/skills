#!/usr/bin/env bash
# Runs the repo-modernize test suite against the in-repo fixture (fixtures/wknd-legacy).
# Requires python3 (3.9+) and git. lxml is installed into a local, gitignored venv.
# If Maven and a JDK are on the PATH, the build-verification tests also run; otherwise they skip.
# Extra arguments are passed to `unittest` (e.g. -v, -k convert_osgi).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL="$(cd "$HERE/../../skills/repo-modernize" && pwd)"
VENV="$HERE/.venv"

[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet --disable-pip-version-check -r "$SKILL/requirements.txt"
cd "$SKILL/scripts"
exec "$VENV/bin/python" -m unittest discover -p 'test_*.py' "$@"
