#!/usr/bin/env bash
# Usage: [REPEAT=3] scripts/run.sh <skill> [git-ref] [provider-filter-regex] [case-filter-regex]
# Runs the skill's live suite (REPEAT times per case, default 3) and stores a summary under results/<skill>/.
# The optional case filter limits the run to test descriptions matching the regex.
# Without a filter the baseline model (models.yaml) runs first and the other models only run
# when it meets the skill's floor. With a filter exactly the matching models run.
set -euo pipefail
skill=${1:?usage: run.sh <skill> [git-ref] [provider-filter]}
ref=${2:-HEAD}
filter=${3:-}
cases=${4:-}
cd "$(dirname "$0")/.."
arm=${ARM:-}
[[ -z $arm && ${SKILLS:-on} == off ]] && arm=none
export ARM=${arm:-skill}
scripts/setup.sh "$skill" "$ref"

if ! curl -sf -o /dev/null http://localhost:8765/index.html; then
  node scripts/fixtures-server.mjs &
  server=$!
  trap 'kill $server' EXIT
  sleep 1
fi

# Optional per-skill setup: pre.sh may print the PID of a service to stop when the run ends.
if [[ -x skills/$skill/pre.sh ]]; then
  service=$(skills/"$skill"/pre.sh)
  trap '[[ -n ${server:-} ]] && kill $server; [[ -n $service ]] && kill $service; true' EXIT
fi

mkdir -p output
stamp=$(date +%Y%m%d-%H%M%S)

# eval <label> <filter-regex>: runs the suite for the matching models and stores a summary.
eval_models() {
  local out=output/$skill-$stamp-$1.json
  local args=(-c "skills/$skill/promptfooconfig.mjs" --no-cache --repeat "${REPEAT:-3}" --filter-providers "$2" -o "$out")
  [[ -n $cases ]] && args+=(--filter-pattern "$cases")
  npx promptfoo eval "${args[@]}" || true # failing tests are benchmark data, not a script error
  node scripts/summarize.mjs "$out" "$skill" "$ref"
  last=$out
}

# The comparison arms (ARM=cli, ARM=none; SKILLS=off = none) are a comparison, not a benchmark: it runs only on models marked
# `noskill` in models.yaml, unless a filter says otherwise.
if [[ $ARM != skill && -z $filter ]]; then
  filter=$(node -e "
    const {parse}=require('yaml');
    console.log('^(' + parse(require('fs').readFileSync('models.yaml','utf8')).filter((m)=>m.noskill).map((m)=>m.label).join('|') + ')\$')")
fi

if [[ -n $filter ]]; then
  eval_models custom "$filter"
  exit 0
fi

# promptfoo matches --filter-providers against ids as well as labels, so list labels explicitly.
read -r baseline others < <(node -e "
  const {parse}=require('yaml');
  const models=parse(require('fs').readFileSync('models.yaml','utf8'));
  console.log(models.find((m)=>m.baseline).label, models.filter((m)=>!m.baseline).map((m)=>m.label).join('|'))")
eval_models baseline "^${baseline}\$"
if ! node scripts/gate.mjs "$skill" "$last"; then
  echo "Baseline $baseline is below the floor for $skill: not running other models. Fix the skill or the eval first."
  exit 0
fi
eval_models others "^(${others})\$"
