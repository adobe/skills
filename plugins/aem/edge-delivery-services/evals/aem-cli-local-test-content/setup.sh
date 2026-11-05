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
git init -q
git remote add origin https://github.com/myorg/mysite.git
git add -A
git -c user.name=dev -c user.email=dev@example.com commit -q -m "Add stats block"
