#!/usr/bin/env bash
# Compile-cache + run wrapper for the code-assessment analyzer.
# Usage: analyze.sh <workspace-root> [--pattern <slug>] [--files a,b] [--list-patterns]
# Requires a JDK (javac + java). Writes only to a temp cache; nothing to the project tree.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/analyzer"            # source root; package 'analyzer'
MAIN="analyzer.Analyze"

command -v javac >/dev/null 2>&1 || { echo "error: JDK required (javac not found)" >&2; exit 3; }

# hash all analyzer sources; prefer shasum, fall back to sha1sum/cksum
hash_sources() {
  if command -v shasum >/dev/null 2>&1; then
    find "$SRC" -name '*.java' -type f -print0 | sort -z | xargs -0 shasum | shasum | cut -d' ' -f1
  elif command -v sha1sum >/dev/null 2>&1; then
    find "$SRC" -name '*.java' -type f -print0 | sort -z | xargs -0 sha1sum | sha1sum | cut -d' ' -f1
  else
    find "$SRC" -name '*.java' -type f -print0 | sort -z | xargs -0 cksum | cksum | cut -d' ' -f1
  fi
}
KEY="$(hash_sources)"
CACHE="${TMPDIR:-/tmp}/aem-code-assessment/$KEY"

if [ ! -f "$CACHE/.ok" ]; then
  rm -rf "$CACHE"; mkdir -p "$CACHE"
  if find "$SRC" -name '*.java' -print0 | xargs -0 javac -d "$CACHE" 2>"$CACHE/javac.err"; then
    : > "$CACHE/.ok"
  else
    echo "error: analyzer failed to compile" >&2; cat "$CACHE/javac.err" >&2; exit 5
  fi
fi

exec java -cp "$CACHE" "$MAIN" "$@"
