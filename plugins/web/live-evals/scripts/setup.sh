#!/usr/bin/env bash
# Usage: scripts/setup.sh <skill> [git-ref]
# Builds workspace/<skill>/.claude/skills/{<skill>,<siblings>} from a ref of the skills repo.
# Siblings come from skills/<skill>/skill.yaml (`siblings: [...]`).
# ARM=none (or SKILLS=off) builds an empty workspace; ARM=cli the same plus the web CLI (no skill).
# SKILLS_REPO (default: this repo) must contain the ref; the web CLI bundle comes from the same ref.
# SKILLS_PATH (default plugins/web/skills) is where skills live inside it.
set -euo pipefail
skill=${1:?usage: setup.sh <skill> [git-ref]}
ref=${2:-HEAD}
repo=${SKILLS_REPO:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}
path=${SKILLS_PATH:-plugins/web/skills}
root=$(cd "$(dirname "$0")/.." && pwd)
base=$root/workspace/$skill/.claude/skills
arm=${ARM:-}
[[ -z $arm && ${SKILLS:-on} == off ]] && arm=none
arm=${arm:-skill}
depth=$(awk -F/ '{print NF}' <<<"$path/x")

siblings=$(node -e "
  const {parse}=require('yaml');
  const c=parse(require('fs').readFileSync('$root/skills/$skill/skill.yaml','utf8'));
  console.log((c.siblings||[]).join(' '))")

build_cli() { # build_cli <dir>: web CLI bundle + runtime deps + bin shim from the ref
  local cli_dir=$1 cli=plugins/web/cli/dist/web.mjs
  mkdir -p "$cli_dir/dist" "$cli_dir/bin"
  git -C "$repo" archive "$ref" "$cli" | tar -x --strip-components=4 -C "$cli_dir/dist"
  git -C "$repo" archive "$ref" plugins/web/cli/package.json plugins/web/cli/package-lock.json |
    tar -x --strip-components=3 -C "$cli_dir"
  (cd "$cli_dir" && npm ci --omit=dev --ignore-scripts --silent)
  printf '#!/bin/sh\nexec node "$(dirname "$0")/../dist/web.mjs" "$@"\n' >"$cli_dir/bin/web"
  chmod +x "$cli_dir/bin/web"
}

if [[ $arm != skill ]]; then
  # Comparison arms: an empty workspace outside the repo and a private $HOME with no skills in it.
  # Only what browsers and npm need is linked in, so playwright-cli still finds its browsers.
  base=/tmp/skill-evals-noskill
  [[ $arm == cli ]] && base=/tmp/skill-evals-cli
  rm -rf "${base:?}/$skill"
  mkdir -p "$base/$skill" "$base/home"
  for d in Library .cache .npm; do
    [[ -e $HOME/$d && ! -e $base/home/$d ]] && ln -s "$HOME/$d" "$base/home/$d"
  done
  [[ $arm == cli ]] && build_cli "$base/$skill/.web-cli"
  echo "$skill: $arm arm, workspace in $base"
  exit 0
fi

rm -rf "$root/workspace/$skill"
for s in "$skill" $siblings; do
  mkdir -p "$base/$s"
  git -C "$repo" archive "$ref" "$path/$s" | tar -x --strip-components="$depth" -C "$base/$s"
  if [[ -f $base/$s/package-lock.json ]] && jq -e '(.dependencies // {}) | length > 0' "$base/$s/package.json" >/dev/null; then
    npm ci --prefix "$base/$s" --silent
  fi
done
cli_dir=$root/workspace/$skill/.web-cli
build_cli "$cli_dir"
cli_commit=$(git -C "$repo" log -1 --format=%h "$ref" -- plugins/web/cli)
echo "$skill (+ ${siblings:-no siblings}) @ $(git -C "$repo" rev-parse --short "$ref") -> $base, web CLI @ $cli_commit"
