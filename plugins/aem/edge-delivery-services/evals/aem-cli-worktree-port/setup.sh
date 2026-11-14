#!/usr/bin/env bash
set -euo pipefail
project=$(pwd)
base=$(mktemp -d)
main="$base/mysite"
wt="$base/wt-tmp"

port_for() {
  node -e 'let h=0;for(const c of process.argv[1]){h=((h<<5)-h)+c.charCodeAt(0);h&=h;}console.log(3000+Math.abs(h)%1000)' "$1"
}
port_free() {
  ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}
for _ in $(seq 1 50); do
  branch="stats-block-$(node -e 'console.log(Math.random().toString(36).slice(2, 8))')"
  port=$(port_for "$branch")
  if [ "$port" != 3000 ] && port_free "$port"; then break; fi
  branch=""
done
[ -n "$branch" ] || { echo "no free worktree port" >&2; exit 1; }

overlay=$(mktemp -d)
cp -R ./. "$overlay"
find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +
git clone --quiet https://github.com/adobe/aem-boilerplate.git "$main"
git -C "$main" checkout --quiet 5cea543707db900c92014b0bba93564fe325b9e4
rm -rf "$main/.git"
gitc() { git -c user.name=dev -c user.email=dev@example.com "$@"; }
git -C "$main" init -q -b main
git -C "$main" remote add origin https://github.com/myorg/mysite.git
git -C "$main" add -A
gitc -C "$main" commit -q -m "Initial site"
git -C "$main" worktree add -q -b "$branch" "$wt"
cp -R "$overlay"/. "$wt"
git -C "$wt" add -A
gitc -C "$wt" commit -q -m "Add stats block and test page"
(cd "$wt" && tar cf - .) | tar xf -
rm -rf "$wt" "$overlay"
git worktree repair 2>/dev/null
git -C "$main" worktree prune
