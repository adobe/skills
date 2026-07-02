#!/usr/bin/env bash
# Runs the aem-agentkit-helper unit tests.
# Usage: tests/run-tests.sh   (from the skill root)
set -euo pipefail

cd "$(dirname "$0")/.."

python3 --version >/dev/null 2>&1 || {
  echo "python3 not on PATH; aem-agentkit-helper requires Python 3.10+" >&2
  exit 1
}

# Don't mutate the working tree; only chmod if not already executable.
# This keeps `git status` clean after a test run (SE16 / Q16).
if [ ! -x bin/aem-agentkit-helper ]; then
  chmod +x bin/aem-agentkit-helper
fi

# Sanity-check the --version and --protocol-version flags
HELPER_VERSION=$(python3 bin/aem-agentkit-helper --version)
PROTOCOL_VERSION=$(python3 bin/aem-agentkit-helper --protocol-version)
echo "helper --version:          $HELPER_VERSION"
echo "helper --protocol-version: $PROTOCOL_VERSION"

# Run the unit suite
python3 -m unittest tests.test_helper -v
