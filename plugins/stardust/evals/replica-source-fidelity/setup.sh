#!/usr/bin/env bash
# The fixture site on localhost: the target of the run. The project starts empty.
set -euo pipefail
exec bash "$(cd "$(dirname "$0")" && pwd)/../fixture-site/start.sh"
