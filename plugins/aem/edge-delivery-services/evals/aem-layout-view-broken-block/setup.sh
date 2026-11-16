#!/usr/bin/env bash
set -euo pipefail
tmp=$(mktemp -d)
git clone --quiet https://github.com/adobe/aem-boilerplate.git "$tmp"
git -C "$tmp" checkout --quiet 5cea543707db900c92014b0bba93564fe325b9e4
rm -rf "$tmp/.git"
overlay=$(mktemp -d)
cp -R ./. "$overlay"
cp -R "$tmp"/. .
cp -R "$overlay"/. .
rm -rf "$tmp" "$overlay"
node -e "
const fs = require('fs');
let s = fs.readFileSync('scripts/scripts.js', 'utf8');
s = s.replace('    buildWidgetAutoBlocks(main);', '    buildWidgetAutoBlocks(main);\n    buildLifecycleBadge(main);');
s = s.replace('/**\n * Builds all synthetic blocks', 'function buildLifecycleBadge(main) {\n  const section = document.createElement(\'div\');\n  section.append(buildBlock(\'lifecycle-badge\', { elems: [] }));\n  main.prepend(section);\n}\n\n/**\n * Builds all synthetic blocks');
fs.writeFileSync('scripts/scripts.js', s);
"
grep -q buildLifecycleBadge scripts/scripts.js
