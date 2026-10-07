#!/usr/bin/env bash
# Headless GitHub Copilot CLI smoke for the stardust plugin.
#
# Checks three things an authenticated Copilot CLI must do for stardust to be
# usable there: list all fifteen stardust skills plus impeccable, load a
# sub-skill by its bare name, and run the master skill's Setup section without
# a missing-file failure. About 1.5 Copilot credits and two minutes per run.
#
# Usage:
#   evals/copilot-smoke/run.sh                 # against the installed stardust plugin
#   evals/copilot-smoke/run.sh --plugin-dir plugins/stardust
#                                              # temporarily installs this checkout in place of
#                                              # the marketplace copy, restores it afterwards
# Env: COPILOT_BIN overrides the CLI (default: `copilot` on PATH, else
#      `npx -y @github/copilot@latest`).
# Requires: impeccable installed in Copilot (`copilot plugin marketplace add
#      pbakaus/impeccable && copilot plugin install impeccable@impeccable`).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR=""
while [ $# -gt 0 ]; do case "$1" in --plugin-dir) PLUGIN_DIR="$(cd "$2" && pwd)"; shift 2;; *) echo "unknown arg $1" >&2; exit 2;; esac; done
if [ -n "${COPILOT_BIN:-}" ]; then COPILOT="$COPILOT_BIN"; elif command -v copilot >/dev/null 2>&1; then COPILOT=copilot; else COPILOT="npx -y @github/copilot@latest"; fi
cp_run() { $COPILOT "$@"; }

WORK="$(mktemp -d)"; OUT="$HERE/results"; mkdir -p "$OUT"; STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; LOG="$OUT/$STAMP.md"
RESTORE_MARKETPLACE=0
cleanup() {
  if [ -n "$PLUGIN_DIR" ]; then
    cp_run plugin uninstall stardust >/dev/null 2>&1 || true
    [ "$RESTORE_MARKETPLACE" = 1 ] && cp_run plugin install stardust@adobe-skills >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

if [ -n "$PLUGIN_DIR" ]; then
  cp_run plugin list 2>/dev/null | command grep -q 'stardust@adobe-skills' && RESTORE_MARKETPLACE=1
  cp_run plugin uninstall stardust >/dev/null 2>&1 || true
  cp_run plugin install "$PLUGIN_DIR" >/dev/null 2>&1 || { echo "plugin install from $PLUGIN_DIR failed" >&2; exit 1; }
fi
cp_run plugin list 2>/dev/null | command grep -q 'impeccable' || { echo "impeccable is not installed in Copilot; see header" >&2; exit 1; }

PASS=0; FAIL=0
check() { if [ "$1" = 0 ]; then PASS=$((PASS+1)); echo "PASS  $2" | tee -a "$LOG"; else FAIL=$((FAIL+1)); echo "FAIL  $2" | tee -a "$LOG"; fi; }
{
  echo "# Copilot smoke $STAMP"; echo; echo "- CLI: $(cp_run --version 2>/dev/null | head -1)"; echo "- plugin: ${PLUGIN_DIR:-installed stardust@adobe-skills}"
  echo "- plugins: $(cp_run plugin list 2>/dev/null | command grep -E 'stardust|impeccable' | tr -s ' \n' ' ')"; echo
} > "$LOG"

# 1. skill listing
cd "$WORK"
R1="$(cp_run -p "Do not run any tools. List the names of every skill available to you, one per line, and nothing else." --allow-all-tools 2>&1)"
echo "## 1. listing" >> "$LOG"; echo '```' >> "$LOG"; echo "$R1" | head -40 >> "$LOG"; echo '```' >> "$LOG"
MISSING=""
for s in stardust extract direct prototype migrate prepare-migration replica reskin audit uplift diff deploy rollout dynamics qa impeccable; do
  echo "$R1" | command grep -qxE "\s*$s\s*" || MISSING="$MISSING $s"
done
[ -z "$MISSING" ]; check $? "listing: all 15 stardust skills and impeccable present${MISSING:+ (missing:$MISSING)}"

# 2. bare-name load
R2="$(cp_run -p "Using your skill tool, load the skill named exactly 'extract'. Do not run shell commands. Finish with one line exactly: SKILL_LOAD extract=ok if it loaded and its description mentions crawling a website, otherwise SKILL_LOAD extract=fail." --allow-all-tools 2>&1)"
echo "## 2. bare-name load" >> "$LOG"; echo '```' >> "$LOG"; echo "$R2" | tail -12 >> "$LOG"; echo '```' >> "$LOG"
echo "$R2" | command grep -q 'SKILL_LOAD extract=ok'; check $? "skill(extract) loads by bare name"

# 3. master skill setup
R3="$(cp_run -p "Use the stardust skill. Perform ONLY its 'Setup' section (the numbered steps before 'Routing') and then stop; do not route, do not extract, do not ask me anything. For each step report the command you ran and its outcome. Finish with one line exactly: STARDUST_SMOKE impeccable=<found|missing> setup_failures=<number of steps that failed because a file, script or command that the skill itself references (in the plugin or in impeccable) did not exist>. Project files that are legitimately absent in a fresh project (PRODUCT.md, DESIGN.md, stardust/state.json, stardust/status.jsonl) are expected and do not count as failures." --allow-all-tools 2>&1)"
echo "## 3. master setup" >> "$LOG"; echo '```' >> "$LOG"; echo "$R3" | tail -40 >> "$LOG"; echo '```' >> "$LOG"
echo "$R3" | command grep -q 'STARDUST_SMOKE impeccable=found'; check $? "setup: impeccable found"
echo "$R3" | command grep -q 'setup_failures=0'; check $? "setup: no missing file or command"
echo "$R3" | command grep -q 'load-context'; [ $? -ne 0 ]; check $? "setup: does not call the removed load-context.mjs"

echo; echo "passed $PASS, failed $FAIL — log: $LOG" | tee -a "$LOG"
[ "$FAIL" = 0 ]
