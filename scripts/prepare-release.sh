#!/usr/bin/env bash
# prepare-release.sh — called by semantic-release @semantic-release/exec during the prepare step.
# Usage: scripts/prepare-release.sh <skill-dir> <version>
#
# 1. Updates metadata.version in SKILL.md YAML frontmatter (adds metadata block if missing)
# 2. Zips the skill directory into <skill-dir>/<skill-name>.skill

set -euo pipefail

SKILL_DIR="$1"
VERSION="$2"

if [ -z "$SKILL_DIR" ] || [ -z "$VERSION" ]; then
  echo "Usage: $0 <skill-dir> <version>" >&2
  exit 1
fi

SKILL_MD="$SKILL_DIR/SKILL.md"
if [ ! -f "$SKILL_MD" ]; then
  echo "Error: $SKILL_MD not found" >&2
  exit 1
fi

SKILL_NAME=$(basename "$SKILL_DIR")

# --- Step 1: Update metadata.version in SKILL.md frontmatter ---

# Check if we're inside YAML frontmatter (between --- delimiters)
if ! head -1 "$SKILL_MD" | grep -q '^---$'; then
  echo "Error: $SKILL_MD does not start with YAML frontmatter" >&2
  exit 1
fi

# Use awk to update the frontmatter
# Cases:
#   a) metadata block exists with version → update the version line
#   b) metadata block exists without version → add version after metadata:
#   c) no metadata block → add metadata block with version before closing ---
TMP_FILE=$(mktemp)
trap 'rm -f "$TMP_FILE"' EXIT

awk -v version="$VERSION" '
BEGIN { in_frontmatter=0; fm_count=0; has_metadata=0; has_version=0; metadata_indent="" }
/^---$/ {
  fm_count++
  if (fm_count == 1) { in_frontmatter=1; print; next }
  if (fm_count == 2) {
    in_frontmatter=0
    # Case c: no metadata block at all — add one before closing ---
    if (!has_metadata) {
      print "metadata:"
      print "  version: \"" version "\""
    } else if (has_metadata && !has_version) {
      print "  version: \"" version "\""
    }
    print
    next
  }
}
in_frontmatter && /^metadata:/ {
  has_metadata=1
  print
  next
}
in_frontmatter && has_metadata && !has_version && /^[ \t]+version:/ {
  # Case a: update existing version
  has_version=1
  print "  version: \"" version "\""
  next
}
in_frontmatter && has_metadata && !has_version && /^[^ ]/ {
  # We left the metadata block without finding version — insert it
  print "  version: \"" version "\""
  has_version=1
  print
  next
}
{ print }
END {
  # Edge case: metadata: was the last line before ---
  # This is handled by the fm_count==2 block above
}
' "$SKILL_MD" > "$TMP_FILE"

# If metadata existed but version was never written (metadata was last key before ---),
# the fm_count==2 handler doesn't cover the "metadata exists, no version" case when
# metadata: is followed directly by ---. The awk above handles it via the /^[^ ]/ rule
# since --- matches that pattern.

mv "$TMP_FILE" "$SKILL_MD"
trap - EXIT

echo "Updated $SKILL_MD with version $VERSION"

# --- Step 2: Create .skill zip ---

SKILL_ZIP="${SKILL_DIR}/${SKILL_NAME}.skill"
rm -f "$SKILL_ZIP"

# Zip the skill directory contents, excluding the .skill file itself and release artifacts
SKILL_PARENT=$(dirname "$SKILL_DIR")
(cd "$SKILL_PARENT" && zip -r - "$SKILL_NAME" -x "${SKILL_NAME}/*.skill" -x "${SKILL_NAME}/node_modules/*" -x "${SKILL_NAME}/package.json" -x "${SKILL_NAME}/.releaserc.json" -x "${SKILL_NAME}/CHANGELOG.md") > "$SKILL_ZIP"

echo "Created $SKILL_ZIP"

