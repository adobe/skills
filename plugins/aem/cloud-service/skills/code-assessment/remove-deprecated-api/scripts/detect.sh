#!/usr/bin/env bash
# Preflight for the code-assessment `remove-deprecated-api` pattern.
#
# Runs the AEM Analyser Maven Plugin against a project, parses its log for
# `region-deprecated-api` findings, and writes a rules cache TSV. The shared
# Java analyzer (`analyze.sh`) reads that TSV to populate its
# `RemoveDeprecatedApi` detector — no hardcoded lists.
#
# The plugin is invoked by its fully-qualified `groupId:artifactId:version:goal`
# coordinates (project-analyse), so it runs at the resolved version whether or
# not the project declares it. The pom is never modified.
#
# Primary output: rules cache TSV at
#   $AEM_DEPRECATED_API_RULES  (env override)
#   $TMPDIR/aem-code-assessment/deprecated-api-rules.tsv   (default)
#
# Each rule is one line:  <package>\t<hint>\t<for_removal>
# Lines starting with # are comments (plugin version, generation timestamp).
#
# A JSON run-summary (plugin/SDK version, rule count, maven exit) is emitted on
# stdout. The authoritative per-file findings come from the shared analyzer
# (analyze.sh), which reads the same rules cache.
#
# Usage: see usage() below (run with -h).
#
# Requires: bash, curl, Maven (project's ./mvnw or system `mvn`), a JDK.
# Network access to Maven Central is required.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: detect.sh <project-root> [--pin-plugin <version>] [--pin-sdk <version>]
                 [--respect-pom-sdk] [--rules-out <path>] [--goal <goal>]
                 [--log <path>]

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
  --goal <goal>        Lifecycle phase run ahead of the analyser goal, to build
                       the artifacts project-analyse inspects (default: package).
                       Only used when no submodule declares aemanalyser-maven-plugin
                       (root-scoped fallback); ignored when a module is
                       auto-detected, which always runs a plain `install` first.
  --log <path>         Write the Maven log to <path> (default: /tmp/aem-analyser.log).
EOF
  exit 2
}

[ $# -ge 1 ] || usage
PROJECT_ROOT="$1"; shift
PIN_PLUGIN=""
PIN_SDK=""
RESPECT_POM_SDK=0
RULES_OUT="${AEM_DEPRECATED_API_RULES:-${TMPDIR:-/tmp}/aem-code-assessment/deprecated-api-rules.tsv}"
GOAL="package"
LOG_PATH="/tmp/aem-analyser.log"
while [ $# -gt 0 ]; do
  case "$1" in
    --pin-plugin)        PIN_PLUGIN="$2"; shift 2 ;;
    --pin-sdk)           PIN_SDK="$2"; shift 2 ;;
    --respect-pom-sdk)   RESPECT_POM_SDK=1; shift ;;
    --rules-out)         RULES_OUT="$2"; shift 2 ;;
    --goal)              GOAL="$2"; shift 2 ;;
    --log)               LOG_PATH="$2"; shift 2 ;;
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

# ---- 1c. Detect the module the analyser should run against -----------------
#
# project-analyse expects to inspect a built content-package artifact. In the
# common multi-module AEM archetype layout, the reactor root is a plain
# aggregator (packaging=pom, nothing to package) and the plugin is bound
# inside a dedicated content-package module (conventionally "all/"). Forcing
# the goal via CLI coordinates with no module scoping makes Maven execute it
# against every reactor project, root included, before any submodule
# builds — which fails immediately: "Project artifact file not found ...
# Looking for: <root-artifactId>-<version>.zip".
#
# Detect the module that already declares the plugin in its own pom (not
# merely inherited) and scope the analyser run to it. Fall back to the
# reactor root when no module declares it (single-module projects, or
# projects where the plugin genuinely belongs at the root).

ANALYSER_MODULE_REL=""
while IFS= read -r pom; do
  if grep -q '<artifactId>aemanalyser-maven-plugin</artifactId>' "$pom" 2>/dev/null; then
    module_dir="$(dirname "$pom")"
    if [ "$module_dir" != "$PROJECT_ROOT" ]; then
      ANALYSER_MODULE_REL="${module_dir#$PROJECT_ROOT/}"
      break
    fi
  fi
done < <(find "$PROJECT_ROOT" -name pom.xml \
           -not -path '*/target/*' -not -path '*/node_modules/*' -not -path '*/.git/*')

if [ -n "$ANALYSER_MODULE_REL" ]; then
  log "aemanalyser-maven-plugin declared in module '$ANALYSER_MODULE_REL' — scoping analyser run to it (-pl $ANALYSER_MODULE_REL)"
else
  log "no submodule declares aemanalyser-maven-plugin — running at reactor root"
fi

# ---- 2. Run Maven -----------------------------------------------------------

# The analyser is invoked directly by its fully-qualified
# `groupId:artifactId:version:goal` coordinates, so the resolved plugin version
# runs regardless of whether — or at what version — the project declares the
# plugin. The pom is never touched: no patch, no backup, no restore.

MVN_CMD="mvn"
if [ -x "$PROJECT_ROOT/mvnw" ]; then
  MVN_CMD="$PROJECT_ROOT/mvnw"
fi

SKIP_ARGS=(
  -DskipTests
  -Dcheckstyle.skip=true
  -Dvault.skipValidation=true
  -Dsling.install.skip=true
  -Dexec.skip=true
  -Djacoco.skip=true
)
SDK_ARGS=()
if [ -n "$SDK_VERSION" ]; then
  SDK_ARGS=("-DsdkVersion=$SDK_VERSION" "-DsdkUseDependency=false")
fi

: > "$LOG_PATH"
set +e
if [ -n "$ANALYSER_MODULE_REL" ]; then
  # Two-step invocation, required once a module is scoped: a plain lifecycle
  # build first (with -am, so upstream modules — including the root
  # aggregator — get only the ordinary phase, never the forced analyser
  # goal), then the analyser goal alone, reactor-restricted to just the
  # target module so it never touches the root. Splitting these avoids the
  # single-command form, where Maven runs every CLI-listed task (phase *and*
  # goal) against every project in the resolved reactor.
  log "step 1/2 — build module + deps: $MVN_CMD install -pl $ANALYSER_MODULE_REL -am ${SKIP_ARGS[*]}"
  ( cd "$PROJECT_ROOT" && "$MVN_CMD" install -pl "$ANALYSER_MODULE_REL" -am "${SKIP_ARGS[@]}" ) >> "$LOG_PATH" 2>&1
  BUILD_EXIT=$?
  if [ "$BUILD_EXIT" -ne 0 ]; then
    MVN_EXIT=$BUILD_EXIT
    log "maven exit code: $MVN_EXIT (failed at step 1/2 — module build)"
  else
    log "step 2/2 — analyser goal: $MVN_CMD com.adobe.aem:aemanalyser-maven-plugin:${PLUGIN_VERSION}:project-analyse -pl $ANALYSER_MODULE_REL ${SDK_ARGS[*]}"
    ( cd "$PROJECT_ROOT" && "$MVN_CMD" "com.adobe.aem:aemanalyser-maven-plugin:${PLUGIN_VERSION}:project-analyse" \
        -pl "$ANALYSER_MODULE_REL" "${SDK_ARGS[@]}" ) >> "$LOG_PATH" 2>&1
    MVN_EXIT=$?
    log "maven exit code: $MVN_EXIT"
  fi
else
  # No module scoping needed/possible — original single-command form: a
  # lifecycle phase to produce the artifacts, then the analyser goal by full
  # GAV, both against the whole (unscoped) reactor.
  MVN_ARGS=("$GOAL"
    "com.adobe.aem:aemanalyser-maven-plugin:${PLUGIN_VERSION}:project-analyse"
    "${SKIP_ARGS[@]}"
    "${SDK_ARGS[@]}"
  )
  log "running: $MVN_CMD ${MVN_ARGS[*]} (log: $LOG_PATH)"
  ( cd "$PROJECT_ROOT" && "$MVN_CMD" "${MVN_ARGS[@]}" ) >> "$LOG_PATH" 2>&1
  MVN_EXIT=$?
  log "maven exit code: $MVN_EXIT"
fi
set -e

# ---- 3. Parse the log into deprecation entries ------------------------------

# Extract deprecated-package hits from the region-deprecated-api task. Three
# shapes are recognised:
#
#   Usage of deprecated package found : <pkg> : <hint> Deprecated since <since> For removal : <YYYY-MM-DD>
#   Usage of deprecated library found : <lib>, package(s) : <start>pkg1, pkg2<end> : <hint> ...
#   Usage of deprecated library found : <lib>, package(s) : pkg1, pkg2 : <hint> ...
#
# The third shape (no <start>/<end> markers) is what current plugin releases
# actually emit for "library found" lines — without this fallback branch the
# awk block below silently parses zero rules from an otherwise-successful run.
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
    } else if (match(line, /package\(s\) *: *[^:]+:/)) {
      pkgs = substr(line, RSTART, RLENGTH)
      sub(/^package\(s\) *: */, "", pkgs)
      sub(/ *:$/, "", pkgs)
      after = substr(line, RSTART + RLENGTH)
      sub(/^ */, "", after)
      hint = stripTrailers(after)
      forRemoval = extractRemoval(after)
      n = split(pkgs, arr, /, */)
      for (i = 1; i <= n; i++) print arr[i] "\t" hint "\t" forRemoval
    }
  }
' "$LOG_PATH" | sort -u > "$TMP_HINTS"

RULE_COUNT="$(wc -l < "$TMP_HINTS" | tr -d ' ')"
log "unique deprecated packages parsed from log: $RULE_COUNT"

# ---- 4. Write the rules cache TSV ------------------------------------------

mkdir -p "$(dirname "$RULES_OUT")"
{
  printf '# aemanalyser-maven-plugin: %s\n' "$PLUGIN_VERSION"
  printf '# generated: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf '# source: %s\n' "$LOG_PATH"
  cat "$TMP_HINTS"
} > "$RULES_OUT"
log "rules cache written: $RULES_OUT ($RULE_COUNT rules)"

# ---- 5. Emit JSON run-summary ----------------------------------------------

emit_json_str() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '"%s"' "$s"
}

{
  printf '{"warnings":['
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

rm -f "$TMP_HINTS"

exit 0
