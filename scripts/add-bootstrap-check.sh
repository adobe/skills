#!/usr/bin/env bash
# One-time script to add the AEM Project Bootstrap Check to all AEM skills
# (cloud-service and 6.5-lts) that don't already have it.
# Excludes ensure-agents-md itself.

set -euo pipefail

MARKER="## AEM Project Bootstrap Check"

BOOTSTRAP_BLOCK='## AEM Project Bootstrap Check

> Before running this skill, check if `AGENTS.md` exists at the **workspace root**.
>
> | Status | Action |
> |--------|--------|
> | `AGENTS.md` **exists** | Continue with this skill. |
> | `AGENTS.md` **missing** and `ensure-agents-md` skill is available | Run `ensure-agents-md` first, then return to this skill. |
> | `AGENTS.md` **missing** and `ensure-agents-md` is not installed | Tell the user: *"For optimal project guidance, install the `ensure-agents-md` skill to bootstrap AGENTS.md before using this skill."* Then continue. |'

files=$(find plugins/aem/cloud-service/skills plugins/aem/6.5-lts/skills \
  -name SKILL.md ! -path '*/ensure-agents-md/*' | sort)

added=0
skipped=0

for file in $files; do
  if grep -qF "$MARKER" "$file"; then
    echo "SKIP (already has check): $file"
    skipped=$((skipped + 1))
    continue
  fi

  # Find the line number of the end of frontmatter (second ---)
  frontmatter_end=$(awk '/^---$/{n++; if(n==2){print NR; exit}}' "$file")
  if [ -z "$frontmatter_end" ]; then
    echo "WARN: No frontmatter found in $file, skipping"
    skipped=$((skipped + 1))
    continue
  fi

  # Find the first # heading after frontmatter
  heading_line=$(awk -v start="$frontmatter_end" 'NR > start && /^# /{print NR; exit}' "$file")
  if [ -z "$heading_line" ]; then
    echo "WARN: No heading found after frontmatter in $file, skipping"
    skipped=$((skipped + 1))
    continue
  fi

  # Find the next non-empty line after the heading (the intro text or next section)
  insert_after=$(awk -v start="$heading_line" '
    NR > start && /^[^[:space:]]/ { print NR; exit }
    NR > start && /^$/ { next }
  ' "$file")

  # If no content after heading, insert right after heading
  if [ -z "$insert_after" ]; then
    insert_after=$((heading_line + 1))
  fi

  # Find the line before the next ## section (or end of intro paragraph)
  next_section=$(awk -v start="$heading_line" 'NR > start && /^## /{print NR; exit}' "$file")

  if [ -n "$next_section" ]; then
    # Insert before the first ## section
    insert_before=$next_section
  else
    # No ## section found, insert after heading + 1 blank line
    insert_before=$((heading_line + 2))
  fi

  # Build the new file: everything before insert point, bootstrap block, everything after
  {
    head -n $((insert_before - 1)) "$file"
    echo "$BOOTSTRAP_BLOCK"
    echo ""
    tail -n +"$insert_before" "$file"
  } > "${file}.tmp"

  mv "${file}.tmp" "$file"
  echo "ADDED: $file"
  added=$((added + 1))
done

echo ""
echo "Done. Added: $added, Skipped: $skipped"
