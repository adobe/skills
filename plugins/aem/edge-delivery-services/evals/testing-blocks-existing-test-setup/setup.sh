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
npm pkg set \
  scripts.test='node --test "test/**/*.test.js"' \
  scripts.test:e2e='playwright test' \
  devDependencies.@playwright/test=1.64.1 \
  devDependencies.jsdom=30.1.3
npm install --package-lock-only --ignore-scripts --no-audit --no-fund --silent
