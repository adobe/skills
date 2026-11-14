#!/usr/bin/env bash
set -euo pipefail
cat > xwalk.json <<'JSON'
{
  "public": {
    "xwalk": {
      "multi-field": {
        "enabled": false
      }
    }
  }
}
JSON
