#!/usr/bin/env bash
# Unified App Builder project initialization script.
#
# Subcommands:
#   App scaffolding (aio app):
#     init, init-bare, add-action, add-web-assets
#
#   Agentic Console bootstrap (aio console — requires
#   @adobe/aio-cli-plugin-console >= 5.3.0):
#     project-create, workspace-create,
#     api-list, workspace-api-list, workspace-api-add,
#     bootstrap (chains project + workspace + APIs)
#
# All commands print a single-line JSON object with at least
# {"success": true|false, ...}. JSON-output aio commands have their
# raw JSON forwarded under the "data" field; other commands forward
# the captured stdout/stderr under "output".

set -euo pipefail

# --- JSON helpers ---

json_escape() {
  local value=${1-}
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  value=${value//$'\b'/\\b}
  value=${value//$'\f'/\\f}
  printf '%s' "$value"
}

# print_json key1 val1 key2 val2 ...
# Special keys passed through verbatim (no quoting/escaping):
#   success           — boolean literal
#   data, *_raw       — pre-formatted JSON values
print_json() {
  local pairs=("$@")
  local out="{"
  local i=0
  while [[ $i -lt ${#pairs[@]} ]]; do
    local key="${pairs[$i]}"
    local val="${pairs[$((i + 1))]}"
    [[ $i -gt 0 ]] && out+=", "
    case "$key" in
      success|data|*_raw)
        out+="\"$key\": $val"
        ;;
      *)
        out+="\"$key\": \"$(json_escape "$val")\""
        ;;
    esac
    i=$((i + 2))
  done
  out+="}"
  printf '%s\n' "$out"
}

# --- Guards ---

require_aio() {
  if ! command -v aio >/dev/null 2>&1; then
    print_json success false error "aio CLI is not installed or not on PATH."
    exit 2
  fi
}

require_project_root() {
  if [[ ! -f "app.config.yaml" ]]; then
    print_json success false error "app.config.yaml not found. Run this from an App Builder project root."
    exit 1
  fi
}

# Verifies that the installed aio-cli-plugin-console is at least the
# minimum version required for the agentic bootstrap commands. The
# project/workspace create commands shipped in 5.2.0; the API
# discovery and subscription commands shipped in 5.3.0. We pin the
# floor at 5.3.0 so the full bootstrap chain is always available.
require_console_plugin() {
  local min="5.3.0"
  local version
  version="$(aio plugins --core 2>/dev/null \
    | sed -n 's/^.*@adobe\/aio-cli-plugin-console[[:space:]][^0-9]*\([0-9][0-9.]*\).*$/\1/p' \
    | head -n 1 || true)"

  if [[ -z "$version" ]]; then
    print_json success false error \
      "Unable to detect @adobe/aio-cli-plugin-console version. Reinstall the aio CLI: npm install -g @adobe/aio-cli"
    exit 2
  fi

  # Pure-bash semver compare: returns 0 iff $version >= $min.
  local IFS=.
  # shellcheck disable=SC2206
  local cur=($version)
  # shellcheck disable=SC2206
  local req=($min)
  local i
  for i in 0 1 2; do
    local c="${cur[$i]:-0}"
    local r="${req[$i]:-0}"
    if (( c > r )); then return 0; fi
    if (( c < r )); then
      print_json success false error \
        "@adobe/aio-cli-plugin-console $version is too old (need >= $min for agentic project/workspace/API commands). Reinstall: npm install -g @adobe/aio-cli"
      exit 2
    fi
  done
  return 0
}

usage() {
  cat <<'EOF'
Usage: init.sh <command> [options]

App scaffolding (aio app):
  init <template> [path]                  Initialize project from a template
  init-bare [path]                        Initialize a bare/standalone project
  add-action <name>                       Add an action to an existing project
  add-web-assets                          Add web assets to an existing project

Agentic Console bootstrap (aio console, plugin >= 5.3.0):
  project-create <name> [--orgId ID] [--title T] [--description D]
                                          Create a Developer Console project
  workspace-create <projectName> <workspaceName> [--orgId ID] [--title T]
                                          Create a workspace inside a project
  api-list [--orgId ID]                   List API services available to the org
  workspace-api-list <projectName> <workspaceName> [--orgId ID]
                                          List APIs subscribed to a workspace
  workspace-api-add <projectName> <workspaceName> <serviceCodes> [--orgId ID]
                                          [--license-config CODE=PROFILE[,PROFILE...] ...]
                                          Subscribe APIs to a workspace
  bootstrap <projectName> [--workspace W] [--orgId ID]
            [--api CODE[=PROFILE[,PROFILE...]] ...]
                                          Project + workspace + APIs in one shot

All commands output JSON. Exit codes: 0=success, 1=error, 2=tooling missing.
EOF
}

# --- App scaffolding subcommands ---

cmd_init() {
  if [[ $# -lt 1 ]]; then
    print_json success false error "Missing required argument: template"
    exit 1
  fi

  local template="$1"
  local project_path="${2-}"

  require_aio

  local resolved_path
  resolved_path="$(pwd -P)"

  if [[ -n "$project_path" ]]; then
    if ! mkdir -p "$project_path"; then
      print_json success false template "$template" path "$project_path" error "Failed to create directory: $project_path"
      exit 1
    fi
    if ! resolved_path="$(cd "$project_path" && pwd -P)"; then
      print_json success false template "$template" path "$project_path" error "Failed to resolve path: $project_path"
      exit 1
    fi
    local output
    output="$(cd "$project_path" && aio app init -y --no-login --no-install --template="$template" 2>&1)" || {
      print_json success false template "$template" path "$resolved_path" output "$output"
      exit 1
    }
  else
    local output
    output="$(aio app init -y --no-login --no-install --template="$template" 2>&1)" || {
      print_json success false template "$template" path "$resolved_path" output "$output"
      exit 1
    }
  fi

  print_json success true template "$template" path "$resolved_path" output "$output"
}

cmd_init_bare() {
  local project_path="${1-}"

  require_aio

  local resolved_path
  resolved_path="$(pwd -P)"

  if [[ -n "$project_path" ]]; then
    if ! mkdir -p -- "$project_path"; then
      print_json success false path "$project_path" error "Failed to create directory: $project_path"
      exit 1
    fi
    if ! resolved_path="$(cd "$project_path" && pwd -P)"; then
      print_json success false path "$project_path" error "Failed to resolve path: $project_path"
      exit 1
    fi
    local output
    output="$(cd "$project_path" && aio app init -y --no-login --standalone-app --no-install 2>&1)" || {
      print_json success false path "$resolved_path" output "$output"
      exit 1
    }
  else
    local output
    output="$(aio app init -y --no-login --standalone-app --no-install 2>&1)" || {
      print_json success false path "$resolved_path" output "$output"
      exit 1
    }
  fi

  print_json success true path "$resolved_path" output "$output"
}

cmd_add_action() {
  if [[ $# -ne 1 ]]; then
    print_json success false error "Missing required argument: action-name"
    exit 1
  fi

  local action_name="$1"
  require_aio
  require_project_root

  local output
  output="$(aio app add action "$action_name" -y --no-login 2>&1)" || {
    print_json success false actionName "$action_name" output "$output"
    exit 1
  }

  print_json success true actionName "$action_name" output "$output"
}

cmd_add_web_assets() {
  require_aio
  require_project_root

  if [[ ! -f "package.json" ]]; then
    print_json success false error "package.json not found. Run this from an App Builder project root."
    exit 1
  fi

  local output
  output="$(aio app add web-assets -y --no-login 2>&1)" || {
    print_json success false output "$output"
    exit 1
  }

  print_json success true output "$output"
}

# --- Agentic Console bootstrap subcommands ---
#
# These wrap commands shipped in @adobe/aio-cli-plugin-console
# 5.2.0 (project/workspace create) and 5.3.0 (api list /
# workspace api list/add). They are non-interactive: there is no
# fallback prompt to a TTY, so failures surface as JSON errors
# instead of hanging the agent.

# Pulls the optional --orgId from a remaining-arg array. Sets
# PARSED_ORG_ID and rewrites POSITIONAL_ARGS with whatever is left.
parse_org_id() {
  PARSED_ORG_ID=""
  POSITIONAL_ARGS=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --orgId)
        PARSED_ORG_ID="${2-}"
        shift 2
        ;;
      --orgId=*)
        PARSED_ORG_ID="${1#--orgId=}"
        shift
        ;;
      *)
        POSITIONAL_ARGS+=("$1")
        shift
        ;;
    esac
  done
}

cmd_project_create() {
  if [[ $# -lt 1 ]]; then
    print_json success false error "Missing required argument: project-name"
    exit 1
  fi

  require_aio
  require_console_plugin

  local name="$1"; shift
  local title="" description="" org_id=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --orgId)        org_id="${2-}"; shift 2 ;;
      --orgId=*)      org_id="${1#--orgId=}"; shift ;;
      --title)        title="${2-}"; shift 2 ;;
      --title=*)      title="${1#--title=}"; shift ;;
      --description)  description="${2-}"; shift 2 ;;
      --description=*) description="${1#--description=}"; shift ;;
      *)
        print_json success false error "Unknown option for project-create: $1"
        exit 1
        ;;
    esac
  done

  local args=(console project create -n "$name" --json)
  [[ -n "$org_id" ]]      && args+=(-o "$org_id")
  [[ -n "$title" ]]       && args+=(-t "$title")
  [[ -n "$description" ]] && args+=(-d "$description")

  local output
  output="$(aio "${args[@]}" 2>&1)" || {
    print_json success false projectName "$name" output "$output"
    exit 1
  }

  print_json success true projectName "$name" data "$output"
}

cmd_workspace_create() {
  if [[ $# -lt 2 ]]; then
    print_json success false error "Missing required arguments: <project-name> <workspace-name>"
    exit 1
  fi

  require_aio
  require_console_plugin

  local project_name="$1"; shift
  local workspace_name="$1"; shift
  local title="" org_id=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --orgId)    org_id="${2-}"; shift 2 ;;
      --orgId=*)  org_id="${1#--orgId=}"; shift ;;
      --title)    title="${2-}"; shift 2 ;;
      --title=*)  title="${1#--title=}"; shift ;;
      *)
        print_json success false error "Unknown option for workspace-create: $1"
        exit 1
        ;;
    esac
  done

  local args=(console workspace create
              --projectName "$project_name"
              --name "$workspace_name"
              --json)
  [[ -n "$org_id" ]] && args+=(--orgId "$org_id")
  [[ -n "$title" ]]  && args+=(--title "$title")

  local output
  output="$(aio "${args[@]}" 2>&1)" || {
    print_json success false projectName "$project_name" workspaceName "$workspace_name" output "$output"
    exit 1
  }

  print_json success true projectName "$project_name" workspaceName "$workspace_name" data "$output"
}

cmd_api_list() {
  require_aio
  require_console_plugin

  parse_org_id "$@"
  local args=(console api list --json)
  [[ -n "$PARSED_ORG_ID" ]] && args+=(-o "$PARSED_ORG_ID")

  local output
  output="$(aio "${args[@]}" 2>&1)" || {
    print_json success false output "$output"
    exit 1
  }

  print_json success true data "$output"
}

cmd_workspace_api_list() {
  if [[ $# -lt 2 ]]; then
    print_json success false error "Missing required arguments: <project-name> <workspace-name>"
    exit 1
  fi

  require_aio
  require_console_plugin

  local project_name="$1"; shift
  local workspace_name="$1"; shift

  parse_org_id "$@"
  if [[ ${#POSITIONAL_ARGS[@]} -gt 0 ]]; then
    print_json success false error "Unknown extra arguments: ${POSITIONAL_ARGS[*]}"
    exit 1
  fi

  local args=(console workspace api list
              --projectName "$project_name"
              --workspaceName "$workspace_name"
              --json)
  [[ -n "$PARSED_ORG_ID" ]] && args+=(--orgId "$PARSED_ORG_ID")

  local output
  output="$(aio "${args[@]}" 2>&1)" || {
    print_json success false projectName "$project_name" workspaceName "$workspace_name" output "$output"
    exit 1
  }

  print_json success true projectName "$project_name" workspaceName "$workspace_name" data "$output"
}

cmd_workspace_api_add() {
  if [[ $# -lt 3 ]]; then
    cat >&2 <<'EOF'
workspace-api-add expects:
  <project-name> <workspace-name> <serviceCodes>
    [--orgId ID]
    [--license-config CODE=PROFILE[,PROFILE...] ...]
EOF
    print_json success false error "Missing required arguments: <project-name> <workspace-name> <serviceCodes>"
    exit 1
  fi

  require_aio
  require_console_plugin

  local project_name="$1"; shift
  local workspace_name="$1"; shift
  local service_codes="$1"; shift

  local org_id=""
  local license_configs=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --orgId)            org_id="${2-}"; shift 2 ;;
      --orgId=*)          org_id="${1#--orgId=}"; shift ;;
      --license-config)   license_configs+=("${2-}"); shift 2 ;;
      --license-config=*) license_configs+=("${1#--license-config=}"); shift ;;
      *)
        print_json success false error "Unknown option for workspace-api-add: $1"
        exit 1
        ;;
    esac
  done

  local args=(console workspace api add
              --projectName "$project_name"
              --workspaceName "$workspace_name"
              --service-code "$service_codes"
              --json)
  [[ -n "$org_id" ]] && args+=(--orgId "$org_id")
  local lc
  for lc in "${license_configs[@]}"; do
    args+=(--license-config "$lc")
  done

  local output
  output="$(aio "${args[@]}" 2>&1)" || {
    print_json success false \
      projectName "$project_name" \
      workspaceName "$workspace_name" \
      serviceCodes "$service_codes" \
      output "$output"
    exit 1
  }

  print_json success true \
    projectName "$project_name" \
    workspaceName "$workspace_name" \
    serviceCodes "$service_codes" \
    data "$output"
}

# bootstrap chains the new console commands so an agent can stand up
# a complete Developer Console "shell" for an app in one step,
# without any interactive prompts.
#
# Behaviour:
#   1. Create the project (idempotency is the caller's job: this will
#      fail loudly if the project already exists).
#   2. Create the workspace (default name "Stage" — the conventional
#      first non-Production workspace).
#   3. For each --api flag, subscribe the workspace to that service
#      code, optionally with a product profile via CODE=PROFILE syntax.
#
# Any step that fails short-circuits the chain and reports the failed
# step so the agent knows where to resume.
cmd_bootstrap() {
  if [[ $# -lt 1 ]]; then
    print_json success false error "Missing required argument: project-name"
    exit 1
  fi

  require_aio
  require_console_plugin

  local project_name="$1"; shift
  local workspace_name="Stage"
  local org_id=""
  local apis=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --workspace)    workspace_name="${2-}"; shift 2 ;;
      --workspace=*)  workspace_name="${1#--workspace=}"; shift ;;
      --orgId)        org_id="${2-}"; shift 2 ;;
      --orgId=*)      org_id="${1#--orgId=}"; shift ;;
      --api)          apis+=("${2-}"); shift 2 ;;
      --api=*)        apis+=("${1#--api=}"); shift ;;
      *)
        print_json success false error "Unknown option for bootstrap: $1"
        exit 1
        ;;
    esac
  done

  # Step 1: project create.
  local project_args=(console project create -n "$project_name" --json)
  [[ -n "$org_id" ]] && project_args+=(-o "$org_id")
  local project_out
  project_out="$(aio "${project_args[@]}" 2>&1)" || {
    print_json success false step "project-create" projectName "$project_name" output "$project_out"
    exit 1
  }

  # Step 2: workspace create.
  local workspace_args=(console workspace create
                        --projectName "$project_name"
                        --name "$workspace_name"
                        --json)
  [[ -n "$org_id" ]] && workspace_args+=(--orgId "$org_id")
  local workspace_out
  workspace_out="$(aio "${workspace_args[@]}" 2>&1)" || {
    print_json success false step "workspace-create" \
      projectName "$project_name" workspaceName "$workspace_name" output "$workspace_out"
    exit 1
  }

  # Step 3: subscribe APIs (optional). We invoke workspace api add
  # once per --api flag so each can carry its own product profile.
  local subscribed=()
  local api_entry code profile lc_args=()
  for api_entry in "${apis[@]}"; do
    code="${api_entry%%=*}"
    profile=""
    if [[ "$api_entry" == *"="* ]]; then
      profile="${api_entry#*=}"
    fi

    local api_args=(console workspace api add
                    --projectName "$project_name"
                    --workspaceName "$workspace_name"
                    --service-code "$code"
                    --json)
    [[ -n "$org_id" ]] && api_args+=(--orgId "$org_id")
    if [[ -n "$profile" ]]; then
      api_args+=(--license-config "$code=$profile")
    fi

    local api_out
    api_out="$(aio "${api_args[@]}" 2>&1)" || {
      print_json success false step "workspace-api-add" \
        projectName "$project_name" workspaceName "$workspace_name" \
        serviceCode "$code" output "$api_out"
      exit 1
    }
    subscribed+=("$code")
  done

  # Final summary. We deliberately re-emit the captured project and
  # workspace JSON under data fields so callers can pull IDs without
  # re-querying the console.
  local subscribed_csv=""
  if [[ ${#subscribed[@]} -gt 0 ]]; then
    local IFS=,
    subscribed_csv="${subscribed[*]}"
  fi

  print_json success true \
    projectName "$project_name" \
    workspaceName "$workspace_name" \
    subscribedApis "$subscribed_csv" \
    project_raw "$project_out" \
    workspace_raw "$workspace_out"
}

# --- Main dispatch ---

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

command="$1"
shift

case "$command" in
  init)               cmd_init "$@" ;;
  init-bare)          cmd_init_bare "$@" ;;
  add-action)         cmd_add_action "$@" ;;
  add-web-assets)     cmd_add_web_assets "$@" ;;
  project-create)     cmd_project_create "$@" ;;
  workspace-create)   cmd_workspace_create "$@" ;;
  api-list)           cmd_api_list "$@" ;;
  workspace-api-list) cmd_workspace_api_list "$@" ;;
  workspace-api-add)  cmd_workspace_api_add "$@" ;;
  bootstrap)          cmd_bootstrap "$@" ;;
  -h|--help)          usage; exit 0 ;;
  *)
    print_json success false error "Unknown command: $command. Run with --help for usage."
    exit 1
    ;;
esac
