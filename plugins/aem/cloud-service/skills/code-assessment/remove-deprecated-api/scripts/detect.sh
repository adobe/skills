#!/usr/bin/env bash
# Preflight for the code-assessment `remove-deprecated-api` pattern.
#
# Runs the AEM Analyser Maven Plugin against a project, parses its log for
# `region-deprecated-api` findings, and writes a rules cache TSV. The shared
# Java analyzer (`analyze.sh`) reads that TSV to populate its
# `RemoveDeprecatedApi` detector — no hardcoded lists.
#
# Primary output: rules cache TSV at
#   $AEM_DEPRECATED_API_RULES  (env override)
#   $TMPDIR/aem-code-assessment/deprecated-api-rules.tsv   (default)
#
# Each rule is one line:  <package>\t<hint>\t<for_removal>
# Lines starting with # are comments (plugin version, generation timestamp).
#
# For callers that also want per-file findings (without invoking analyze.sh),
# a JSON summary is emitted on stdout, mirroring the shared analyzer's shape.
#
# Usage:
#   detect.sh <project-root> [--pin-plugin <version>] [--rules-out <path>]
#             [--goal <goal>] [--log <path>] [--keep-log]
#
# Requires: bash, curl, Maven (project's ./mvnw or system `mvn`), a JDK.
# Network access to Maven Central is required.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: detect.sh <project-root> [--pin-plugin <version>] [--pin-sdk <version>]
                 [--respect-pom-sdk] [--rules-out <path>] [--goal <goal>]
                 [--log <path>] [--keep-log]

  <project-root>       Absolute or relative path to the Maven project root.
  --pin-plugin <ver>   Pin aemanalyser-maven-plugin to a specific version
                       (default: latest release on Maven Central).
  --pin-sdk <ver>      Pin the AEM SDK the analyser uses to a specific version
                       (default: latest release on Maven Central; overrides any
                       <sdkVersion> or <useDependencyVersions> in the pom
                       so the freshest deprecation metadata is used, matching
                       Cloud Manager).
  --respect-pom-sdk    Do not override the pom's SDK selection. Leaves any
                       <sdkVersion> / <useDependencyVersions> intact. Use when
                       the customer has intentionally pinned to an older SDK.
  --rules-out <path>   Path for the rules cache TSV (default:
                       $AEM_DEPRECATED_API_RULES or
                       $TMPDIR/aem-code-assessment/deprecated-api-rules.tsv).
  --goal <goal>        Maven goal to invoke (default: verify).
  --log <path>         Write the Maven log to <path> (default: /tmp/aem-analyser.log).
  --keep-log           Do not remove the Maven log at end (for debugging).
EOF
  exit 2
}

[ $# -ge 1 ] || usage
PROJECT_ROOT="$1"; shift
PIN_PLUGIN=""
PIN_SDK=""
RESPECT_POM_SDK=0
RULES_OUT="${AEM_DEPRECATED_API_RULES:-${TMPDIR:-/tmp}/aem-code-assessment/deprecated-api-rules.tsv}"
GOAL="verify"
LOG_PATH="/tmp/aem-analyser.log"
KEEP_LOG=0
while [ $# -gt 0 ]; do
  case "$1" in
    --pin-plugin)        PIN_PLUGIN="$2"; shift 2 ;;
    --pin-sdk)           PIN_SDK="$2"; shift 2 ;;
    --respect-pom-sdk)   RESPECT_POM_SDK=1; shift ;;
    --rules-out)         RULES_OUT="$2"; shift 2 ;;
    --goal)              GOAL="$2"; shift 2 ;;
    --log)               LOG_PATH="$2"; shift 2 ;;
    --keep-log)          KEEP_LOG=1; shift ;;
    -h|--help)           usage ;;
    *)                   echo "unknown arg: $1" >&2; usage ;;
  esac
done

PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd)"
ROOT_POM="$PROJECT_ROOT/pom.xml"
[ -f "$ROOT_POM" ] || { echo "error: no root pom.xml at $ROOT_POM" >&2; exit 3; }

command -v curl >/dev/null 2>&1 || { echo "error: curl not found" >&2; exit 3; }

log() { printf '[detect] %s\n' "$*" >&2; }

# ---- 1. Resolve plugin version ---------------------------------------------

resolve_latest_from_metadata() {
  # Args: <maven-central group/artifact base URL>
  local url="$1/maven-metadata.xml"
  local xml
  if ! xml="$(curl -fsS --max-time 30 "$url" 2>/dev/null)"; then
    echo "error: could not fetch $url" >&2; return 1
  fi
  local v
  v="$(printf '%s' "$xml" | sed -n 's:.*<release>\([^<]*\)</release>.*:\1:p' | head -1)"
  [ -n "$v" ] || v="$(printf '%s' "$xml" | sed -n 's:.*<latest>\([^<]*\)</latest>.*:\1:p' | head -1)"
  [ -n "$v" ] || { echo "error: latest version not found in $url" >&2; return 1; }
  printf '%s' "$v"
}

if [ -n "$PIN_PLUGIN" ]; then
  PLUGIN_VERSION="$PIN_PLUGIN"
  log "using pinned plugin version: $PLUGIN_VERSION"
else
  PLUGIN_VERSION="$(resolve_latest_from_metadata https://repo1.maven.org/maven2/com/adobe/aem/aemanalyser-maven-plugin)" \
    || exit 4
  log "latest aemanalyser-maven-plugin: $PLUGIN_VERSION"
fi

# ---- 1b. Resolve the SDK version the analyser will use ---------------------

# By default, force the latest AEM SDK so the analyser sees the current
# deprecation set — matching Cloud Manager's own runs. Explicit pom
# overrides (<sdkVersion>, <useDependencyVersions>true</useDependencyVersions>)
# are logged; passing -DsdkVersion / -DsdkUseDependency on the CLI overrides
# the plugin config unless the caller opted out with --respect-pom-sdk.

SDK_VERSION=""
if [ "$RESPECT_POM_SDK" -eq 1 ]; then
  log "--respect-pom-sdk: leaving pom's <sdkVersion> / <useDependencyVersions> intact"
else
  if [ -n "$PIN_SDK" ]; then
    SDK_VERSION="$PIN_SDK"
    log "using pinned SDK version: $SDK_VERSION"
  else
    SDK_VERSION="$(resolve_latest_from_metadata https://repo1.maven.org/maven2/com/adobe/aem/aem-sdk-api)" \
      || exit 4
    log "latest aem-sdk-api: $SDK_VERSION"
  fi
  # Surface any pom overrides that would otherwise pin an older SDK.
  if grep -q '<sdkVersion>' "$ROOT_POM" 2>/dev/null; then
    POM_PINNED_SDK="$(grep -oE '<sdkVersion>[^<]+</sdkVersion>' "$ROOT_POM" | head -1 | sed 's/<[^>]*>//g')"
    log "note: pom pins <sdkVersion>${POM_PINNED_SDK}</sdkVersion> — overriding to $SDK_VERSION via -DsdkVersion on the CLI"
  fi
  if grep -q '<useDependencyVersions>true</useDependencyVersions>' "$ROOT_POM" 2>/dev/null; then
    log "note: pom sets <useDependencyVersions>true</useDependencyVersions> — overriding to false via -DsdkUseDependency on the CLI"
  fi
fi

# ---- 2. Ensure plugin is wired ---------------------------------------------

has_plugin() {
  grep -q '<artifactId>aemanalyser-maven-plugin</artifactId>' "$ROOT_POM"
}

# Byte-for-byte backup as a mid-edit safety net. The EXIT trap restores the pom
# only when POM_MUST_BE_RESTORED == 1 — which is the case if the perl edit or
# anything else fails partway through. Both the in-place version bump and the
# new-plugin injection are intentionally **persistent**: the analyser is useful
# to keep wired in for CI. After a successful pom edit we flip the flag to 0.
BACKUP_POM="$(mktemp)"
cp "$ROOT_POM" "$BACKUP_POM"
POM_MUST_BE_RESTORED=1

restore_pom() {
  if [ "$POM_MUST_BE_RESTORED" -eq 1 ]; then
    cp "$BACKUP_POM" "$ROOT_POM"
  fi
  rm -f "$BACKUP_POM"
}
trap restore_pom EXIT

if has_plugin; then
  log "plugin already declared — upgrading <version> to $PLUGIN_VERSION in $ROOT_POM (persisted)"
  perl -0777 -i -pe "
    s{
      (<plugin>[^<]*(?:<(?!/plugin>)[^<]*)*<artifactId>aemanalyser-maven-plugin</artifactId>[^<]*(?:<(?!/plugin>)[^<]*)*<version>)
      [^<]+
      (</version>)
    }
    {\${1}${PLUGIN_VERSION}\${2}}xs;
  " "$ROOT_POM"
else
  log "plugin not declared — adding aemanalyser-maven-plugin $PLUGIN_VERSION to $ROOT_POM (persisted)"
  if grep -q '<build>' "$ROOT_POM" && grep -q '</plugins>' "$ROOT_POM"; then
    perl -0777 -i -pe "
      s{</plugins>}
       {  <!-- code-assessment: added by remove-deprecated-api preflight -->\n        <plugin>\n          <groupId>com.adobe.aem</groupId>\n          <artifactId>aemanalyser-maven-plugin</artifactId>\n          <version>${PLUGIN_VERSION}</version>\n          <extensions>true</extensions>\n        </plugin>\n      </plugins>}m;
    " "$ROOT_POM"
  else
    log "warning: could not locate <build><plugins> in $ROOT_POM — attempting <build> injection"
    perl -0777 -i -pe "
      s{</project>}
       {  <build>\n    <plugins>\n      <!-- code-assessment: added by remove-deprecated-api preflight -->\n      <plugin>\n        <groupId>com.adobe.aem</groupId>\n        <artifactId>aemanalyser-maven-plugin</artifactId>\n        <version>${PLUGIN_VERSION}</version>\n        <extensions>true</extensions>\n      </plugin>\n    </plugins>\n  </build>\n</project>}m;
    " "$ROOT_POM"
  fi
fi
# Pom edit complete on both branches — the change persists on exit. The trap
# still cleans up the backup file, but no longer overwrites the pom.
POM_MUST_BE_RESTORED=0

# ---- 3. Run Maven -----------------------------------------------------------

MVN_CMD="mvn"
if [ -x "$PROJECT_ROOT/mvnw" ]; then
  MVN_CMD="$PROJECT_ROOT/mvnw"
fi

# Build the mvn argv. Only pass -DsdkVersion / -DsdkUseDependency when we've
# actually resolved (or been given) an SDK version — otherwise leave the
# plugin's own resolution alone (--respect-pom-sdk path).
MVN_ARGS=("$GOAL"
  -DskipTests
  -Dcheckstyle.skip=true
  -Dvault.skipValidation=true
  -Dsling.install.skip=true
  -Dexec.skip=true
  -Djacoco.skip=true
)
if [ -n "$SDK_VERSION" ]; then
  MVN_ARGS+=("-DsdkVersion=$SDK_VERSION" "-DsdkUseDependency=false")
fi

log "running: $MVN_CMD ${MVN_ARGS[*]} (log: $LOG_PATH)"
set +e
( cd "$PROJECT_ROOT" && "$MVN_CMD" "${MVN_ARGS[@]}" ) > "$LOG_PATH" 2>&1
MVN_EXIT=$?
set -e
log "maven exit code: $MVN_EXIT"

# ---- 4. Parse the log into deprecation entries ------------------------------

# Extract deprecated-package hits from the region-deprecated-api task. Two
# shapes are recognised:
#
#   Usage of deprecated package found : <pkg> : <hint> Deprecated since <since> For removal : <YYYY-MM-DD>
#   Usage of deprecated library found : <lib>, package(s) : <start>pkg1, pkg2<end> : <hint> ...
#
# Emit one line per (package, hint, for_removal), tab-separated.

TMP_HINTS="$(mktemp)"
awk -F '\t' '
  function extractRemoval(s,   pos, m) {
    if (match(s, /For removal *: *[0-9-]+/)) {
      m = substr(s, RSTART, RLENGTH)
      sub(/^For removal *: */, "", m)
      return m
    }
    return ""
  }
  function stripTrailers(s) {
    sub(/ Deprecated since .*$/, "", s)
    sub(/ For removal *:.*$/, "", s)
    return s
  }
  /Usage of deprecated package found *:/ {
    line = $0
    sub(/^.*Usage of deprecated package found *: */, "", line)
    pkg = line
    sub(/ *:.*$/, "", pkg)
    rest = line
    sub(/^[^:]+: */, "", rest)
    hint = stripTrailers(rest)
    forRemoval = extractRemoval(rest)
    print pkg "\t" hint "\t" forRemoval
  }
  /Usage of deprecated library found *:/ {
    line = $0
    sub(/^.*Usage of deprecated library found *: */, "", line)
    if (match(line, /<start>[^<]+<end>/)) {
      pkgs = substr(line, RSTART + 7, RLENGTH - 7 - 5)
      after = substr(line, RSTART + RLENGTH)
      sub(/^ *: */, "", after)
      hint = stripTrailers(after)
      forRemoval = extractRemoval(after)
      n = split(pkgs, arr, /, */)
      for (i = 1; i <= n; i++) print arr[i] "\t" hint "\t" forRemoval
    }
  }
' "$LOG_PATH" | sort -u > "$TMP_HINTS"

RULE_COUNT="$(wc -l < "$TMP_HINTS" | tr -d ' ')"
log "unique deprecated packages parsed from log: $RULE_COUNT"

# ---- 5. Write the rules cache TSV ------------------------------------------

mkdir -p "$(dirname "$RULES_OUT")"
{
  printf '# aemanalyser-maven-plugin: %s\n' "$PLUGIN_VERSION"
  printf '# generated: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf '# source: %s\n' "$LOG_PATH"
  cat "$TMP_HINTS"
} > "$RULES_OUT"
log "rules cache written: $RULES_OUT ($RULE_COUNT rules)"

# ---- 6. Correlate to source (JSON summary for direct callers) --------------

TMP_FINDINGS="$(mktemp)"
: > "$TMP_FINDINGS"

emit_json_str() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '"%s"' "$s"
}

emit_finding() {
  local file="$1" line="$2" snippet="$3" pkg="$4" hint="$5" removal="$6"
  {
    printf '{"pattern":"remove-deprecated-api","file":'
    emit_json_str "$file"
    printf ',"line":%s,"snippet":' "$line"
    emit_json_str "$snippet"
    printf ',"package":'
    emit_json_str "$pkg"
    printf ',"hint":'
    emit_json_str "$hint"
    printf ',"for_removal":'
    emit_json_str "$removal"
    printf '}'
  } >> "$TMP_FINDINGS"
  printf '\n' >> "$TMP_FINDINGS"
}

while IFS=$'\t' read -r PKG HINT REMOVAL; do
  [ -n "$PKG" ] || continue
  while IFS=: read -r F L SNIP; do
    [ -n "$F" ] || continue
    REL="${F#$PROJECT_ROOT/}"
    emit_finding "$REL" "$L" "$SNIP" "$PKG" "$HINT" "$REMOVAL"
  done < <(
    grep -rn --include='*.java' \
      --exclude-dir=target --exclude-dir=.git \
      --exclude-dir=node_modules --exclude-dir=generated-sources \
      -E "^[[:space:]]*import[[:space:]]+(static[[:space:]]+)?${PKG}[.;]" \
      "$PROJECT_ROOT" 2>/dev/null || true
  )
done < "$TMP_HINTS"

# ---- 7. Emit JSON summary --------------------------------------------------

{
  printf '{"findings":['
  first=1
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    if [ $first -eq 1 ]; then first=0; else printf ','; fi
    printf '%s' "$line"
  done < "$TMP_FINDINGS"
  printf '],"warnings":['
  if [ "$MVN_EXIT" -ne 0 ]; then
    emit_json_str "mvn-exit-nonzero: $MVN_EXIT — see $LOG_PATH"
  fi
  printf '],"meta":{"plugin_version":'
  emit_json_str "$PLUGIN_VERSION"
  printf ',"sdk_version":'
  emit_json_str "${SDK_VERSION:-(pom-managed)}"
  printf ',"maven_log":'
  emit_json_str "$LOG_PATH"
  printf ',"maven_exit":%s' "$MVN_EXIT"
  printf ',"rules_cache":'
  emit_json_str "$RULES_OUT"
  printf ',"rule_count":%s}}\n' "$RULE_COUNT"
}

rm -f "$TMP_HINTS" "$TMP_FINDINGS"
if [ "$KEEP_LOG" -eq 0 ]; then :; fi

# EXIT trap restores pom.xml only if POM_MUST_BE_RESTORED == 1 (mid-edit
# failure). Successful upgrade + injection both persist.
exit 0
