#!/usr/bin/env bash
# The fixture site on localhost, and the plugin scripts as Setup step 3 leaves them.
set -euo pipefail
exec bash "$(cd "$(dirname "$0")" && pwd)/../fixture-site/start.sh" --scripts
