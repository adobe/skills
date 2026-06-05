#!/usr/bin/env bash
# Runs the aem-agentkit-helper unit tests.
# Usage: tests/run-tests.sh   (from the skill root)
set -euo pipefail

cd "$(dirname "$0")/.."

python3 --version >/dev/null 2>&1 || {
  echo "python3 not on PATH; aem-agentkit-helper requires Python 3.10+" >&2
  exit 1
}

# Ensure helper is executable
chmod +x bin/aem-agentkit-helper

# Sanity-check the --version flag
HELPER_VERSION=$(python3 bin/aem-agentkit-helper --version)
echo "helper --version: $HELPER_VERSION"

# Run the unit suite
python3 -m unittest tests.test_helper -v
