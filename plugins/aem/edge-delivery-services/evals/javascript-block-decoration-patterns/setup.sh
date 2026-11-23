#!/usr/bin/env bash
set -euo pipefail
tmp=$(mktemp -d)
git clone --quiet https://github.com/adobe/aem-boilerplate.git "$tmp"
git -C "$tmp" checkout --quiet 5cea543707db900c92014b0bba93564fe325b9e4
rm -rf "$tmp/.git"
cp -R "$tmp"/. .
rm -rf "$tmp"
