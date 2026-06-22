#!/usr/bin/env bash
# Dependency-free harness for the code-assessment analyzer (run via analyze.sh). Runs the analyzer against fixtures
# and asserts on the JSON it prints to stdout. Requires only a JDK and bash.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
# Harness lives at plugins/aem/cloud-service/test/code-assessment; the skill it exercises
# is its sibling under skills/code-assessment.
SKILL_ROOT="$(cd "$HERE/../../skills/code-assessment" && pwd)"
ANALYZE="$SKILL_ROOT/scripts/analyze.sh"
FIX="$HERE/fixtures"
PASS=0; FAIL=0

run() { bash "$ANALYZE" "$@" 2>/dev/null; }

assert_contains() { # desc, haystack, needle
  if printf '%s' "$2" | grep -q -- "$3"; then
    echo "  PASS: $1"; PASS=$((PASS+1))
  else
    echo "  FAIL: $1"; echo "    expected substring: $3"; echo "    in: $2"; FAIL=$((FAIL+1))
  fi
}
assert_absent() { # desc, haystack, needle
  if printf '%s' "$2" | grep -q -- "$3"; then
    echo "  FAIL: $1 (unexpected: $3)"; FAIL=$((FAIL+1))
  else
    echo "  PASS: $1"; PASS=$((PASS+1))
  fi
}

echo "[smoke] valid empty/clean output"
OUT="$(run "$FIX/clean")"
assert_contains "emits findings array" "$OUT" '"findings":'
assert_contains "emits warnings array" "$OUT" '"warnings":'
assert_absent  "clean file yields no inject finding" "$OUT" 'inject-in-sling-model'

echo "[inject] @Inject in @Model detection"
OUT="$(run "$FIX/inject")"
assert_contains "HeroModel @Inject field flagged" "$OUT" '"pattern":"inject-in-sling-model"'
assert_contains "HeroModel file present"          "$OUT" 'HeroModel.java'
assert_absent  "CleanModel not flagged"           "$OUT" 'CleanModel.java'
assert_absent  "NotAModel not flagged"            "$OUT" 'NotAModel.java'
assert_absent  "CollisionModel (non-Sling @Model) not flagged" "$OUT" 'CollisionModel.java'

echo "[deps] dependency declarations located"
OUT="$(run "$FIX/deps")"
assert_contains "outdated-dependencies pattern present" "$OUT" '"pattern":"outdated-dependencies"'
assert_contains "mockito-core located"                  "$OUT" 'mockito-core'
assert_contains "aem-sdk-api located"                   "$OUT" 'aem-sdk-api'

echo "[enabled-set] --pattern restricts to one detector"
OUT="$(run "$FIX/mixed" --pattern inject-in-sling-model)"
assert_contains "inject finding present"           "$OUT" '"pattern":"inject-in-sling-model"'
assert_absent  "deps excluded by --pattern filter" "$OUT" 'outdated-dependencies'

OUT="$(run "$FIX/mixed")"
assert_contains "no filter: inject present" "$OUT" 'inject-in-sling-model'
assert_contains "no filter: deps present"   "$OUT" 'outdated-dependencies'

echo "[resilience] broken file warns; siblings still scanned; exit 0"
OUT="$(run "$FIX/broken")"
assert_contains "parse-skip warning recorded" "$OUT" 'parse-skip'
assert_contains "Broken.java named in warning" "$OUT" 'Broken.java'
assert_contains "valid sibling still flagged" "$OUT" 'inject-in-sling-model'
assert_contains "Good.java flagged"           "$OUT" 'Good.java'

echo "[dupdep] duplicate artifactId maps to distinct lines"
OUT="$(run "$FIX/dupdep")"
assert_contains "first mockito dep at line 10"  "$OUT" '"line":10'
assert_contains "second mockito dep at line 15" "$OUT" '"line":15'

echo "[badpom] malformed pom warns, no crash"
OUT="$(run "$FIX/badpom")"
assert_contains "malformed pom parse-skip" "$OUT" 'parse-skip'

echo "[unknown-pattern] bad --pattern warns"
OUT="$(run "$FIX/mixed" --pattern does-not-exist)"
assert_contains "unknown-pattern warning emitted" "$OUT" 'unknown-pattern: does-not-exist'

echo "[scope] versioned deps in dependencies/dependencyManagement; not plugin/version-less/reactor-self-ref"
OUT="$(run "$FIX/scope" --all)"
assert_contains "real-dep (literal version) detected"          "$OUT" 'real-dep'
assert_contains "managed-dep (dependencyManagement) detected"  "$OUT" 'managed-dep'
assert_contains "prop-dep (real \${property}) detected"        "$OUT" 'prop-dep'
assert_absent  "plugin-dep (<plugin>) excluded"                "$OUT" 'plugin-dep'
assert_absent  "inherited-dep (version-less) skipped"          "$OUT" 'inherited-dep'
assert_absent  "reactor-module (\${project.version}) skipped"  "$OUT" 'reactor-module'

echo "[wiring] each registered detector has an expert skill + ready/analyzer catalog row"
PATTERNS_MD="$SKILL_ROOT/references/patterns.md"
for slug in $(bash "$ANALYZE" --list-patterns); do
  if [ -f "$SKILL_ROOT/$slug/SKILL.md" ]; then
    echo "  PASS: $slug has expert skill dir"; PASS=$((PASS+1))
  else
    echo "  FAIL: $slug missing $SKILL_ROOT/$slug/SKILL.md"; FAIL=$((FAIL+1))
  fi
  if grep -E "$slug" "$PATTERNS_MD" | grep -qE 'ready.*analyzer'; then
    echo "  PASS: $slug is ready+analyzer in catalog"; PASS=$((PASS+1))
  else
    echo "  FAIL: $slug not a ready+analyzer row in patterns.md"; FAIL=$((FAIL+1))
  fi
done

echo "[wildcard] wildcard import resolved correctly"
OUT="$(run "$FIX/wildcard")"
assert_contains "Sling @Model via wildcard flagged" "$OUT" 'WildcardSling.java'
assert_absent  "non-Sling @Model via wildcard not flagged" "$OUT" 'WildcardAcme.java'

echo "[xxe] doctype-bearing pom is rejected with a warning, no crash"
OUT="$(run "$FIX/xxe")"
assert_contains "doctype pom parse-skip" "$OUT" 'parse-skip'
assert_absent  "no dependency extracted from doctype pom" "$OUT" 'safe-dep'

echo "[revision] CI-friendly reactor versions skipped"
OUT="$(run "$FIX/revision" --all)"
assert_contains "real dep detected"               "$OUT" 'real-revision-dep'
assert_absent  "\${revision} dep skipped"          "$OUT" 'internal-module'

echo "[jakarta] jakarta.inject.Inject in @Model flagged"
OUT="$(run "$FIX/jakarta")"
assert_contains "JakartaModel flagged" "$OUT" 'JakartaModel.java'
assert_contains "inject pattern present" "$OUT" '"pattern":"inject-in-sling-model"'

echo "[files-containment] --files outside workspace root is warned + skipped"
OUT="$(run "$FIX/clean" --files "../inject/HeroModel.java")"
assert_contains "outside-root path warned" "$OUT" 'outside-workspace'
assert_absent  "outside-root file not scanned" "$OUT" '"pattern":"inject-in-sling-model"'

echo "[multiline] unresolved line still emits finding + warning"
OUT="$(run "$FIX/multiline" --all)"
assert_contains "split dep still located"   "$OUT" 'split-artifact'
assert_contains "line-unresolved warning"   "$OUT" 'line-unresolved'

echo "[unknown-exit] unknown --pattern exits non-zero"
bash "$ANALYZE" "$FIX/mixed" --pattern does-not-exist >/dev/null 2>&1; rc=$?
if [ "$rc" -ne 0 ]; then echo "  PASS: unknown --pattern non-zero exit ($rc)"; PASS=$((PASS+1));
else echo "  FAIL: unknown --pattern exited 0"; FAIL=$((FAIL+1)); fi

echo "[dump] analyzer also writes <root>/.autofix/analyzer-output.json"
run "$FIX/inject" >/dev/null 2>&1
if [ -f "$FIX/inject/.autofix/analyzer-output.json" ] && grep -q 'inject-in-sling-model' "$FIX/inject/.autofix/analyzer-output.json"; then
  echo "  PASS: dump file written with findings"; PASS=$((PASS+1))
else
  echo "  FAIL: dump file missing or empty"; FAIL=$((FAIL+1))
fi
if [ -f "$FIX/inject/.autofix/.gitignore" ] && grep -q '\*' "$FIX/inject/.autofix/.gitignore"; then
  echo "  PASS: self-ignore (.autofix/.gitignore) written"; PASS=$((PASS+1))
else
  echo "  FAIL: .autofix/.gitignore missing"; FAIL=$((FAIL+1))
fi

# the analyzer writes <root>/.autofix when run; clean the copies left in fixtures by this run
find "$FIX" -type d -name .autofix -prune -exec rm -rf {} + 2>/dev/null || true

echo "[allowlist] only allowlisted deps by default; --all shows everything"
OUT="$(run "$FIX/allowlist")"
assert_contains "allowlisted mockito flagged"              "$OUT" 'mockito-core'
assert_absent  "non-allowlisted dep skipped by default"   "$OUT" 'random-lib'
OUT="$(run "$FIX/allowlist" --all)"
assert_contains "--all surfaces non-allowlisted dep"       "$OUT" 'random-lib'

echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
