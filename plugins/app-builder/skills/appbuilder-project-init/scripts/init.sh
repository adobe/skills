#!/usr/bin/env bash
# Unified App Builder project initialization script.
#
# Subcommands:
#   init <template> [path] [--org ID] [--project NAME] [--template-options B64]
#   init-bare [path]
#   add-action <name>
#   add-web-assets
#
# Why a script for these but not for the new `aio console …` agentic
# bootstrap commands?
#   - `aio app init` and `aio app add …` need a non-trivial flag set
#     (-y --no-login --no-install) plus mkdir + cwd management; that
#     glue is easy to forget, so it lives here.
#   - `aio console project|workspace|api` (plugin 5.2.0+/5.3.0+) are
#     already non-interactive and self-contained. The agent calls
#     them directly per references/bootstrap.md so it can react to
#     "already exists", "needs a product profile", etc., on a
#     per-step basis instead of failing a baked-in chain.

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

print_json() {
  local pairs=("$@")
  local out="{"
  local i=0
  while [[ $i -lt ${#pairs[@]} ]]; do
    local key="${pairs[$i]}"
    local val="${pairs[$((i + 1))]}"
    [[ $i -gt 0 ]] && out+=", "
    if [[ "$key" == "success" ]]; then
      out+="\"$key\": $val"
    else
      out+="\"$key\": \"$(json_escape "$val")\""
    fi
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

usage() {
  cat <<'EOF'
Usage: init.sh <command> [options]

Commands:
  init <template> [path]                       Initialize project from a template
       [--org ID] [--project NAME]             Wire to a Console org/project (plugin >= 14.2.0)
       [--template-options B64JSON]            Optional template options (base64-encoded JSON)
       [--no-config-validation]                Skip schema validation during init (plugin >= 14.4.0)
  init-bare [path]                             Initialize a bare/standalone project
  add-action <name>                            Add an action to an existing project
  add-web-assets                               Add web assets to an existing project

For Developer Console bootstrap (project / workspace / API
subscriptions), call `aio console …` directly per the playbook in
references/bootstrap.md. Those commands are already non-interactive
in @adobe/aio-cli-plugin-console >= 5.3.0 and don't need a wrapper.

All commands output JSON. Exit codes: 0=success, 1=error, 2=aio CLI missing.
EOF
}

# --- Subcommands ---

cmd_init() {
  if [[ $# -lt 1 ]]; then
    print_json success false error "Missing required argument: template"
    exit 1
  fi

  local template="$1"; shift
  local project_path=""
  local extra_flags=()

  # First non-flag positional becomes project_path; everything else
  # is a pass-through flag for `aio app init`.
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --org|--project|--template-options)
        extra_flags+=("$1" "${2-}")
        shift 2
        ;;
      --org=*|--project=*|--template-options=*)
        extra_flags+=("$1")
        shift
        ;;
      --no-config-validation|--config-validation)
        extra_flags+=("$1")
        shift
        ;;
      --)
        shift
        while [[ $# -gt 0 ]]; do extra_flags+=("$1"); shift; done
        ;;
      -*)
        print_json success false error "Unknown flag for init: $1"
        exit 1
        ;;
      *)
        if [[ -z "$project_path" ]]; then
          project_path="$1"
          shift
        else
          print_json success false error "Unexpected positional argument: $1"
          exit 1
        fi
        ;;
    esac
  done

  require_aio

  local resolved_path
  resolved_path="$(pwd -P)"

  local base_args=(app init -y --no-login --no-install --template="$template")
  if [[ ${#extra_flags[@]} -gt 0 ]]; then
    base_args+=("${extra_flags[@]}")
  fi

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
    output="$(cd "$project_path" && aio "${base_args[@]}" 2>&1)" || {
      print_json success false template "$template" path "$resolved_path" output "$output"
      exit 1
    }
  else
    local output
    output="$(aio "${base_args[@]}" 2>&1)" || {
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

# --- Main dispatch ---

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

command="$1"
shift

case "$command" in
  init)          cmd_init "$@" ;;
  init-bare)     cmd_init_bare "$@" ;;
  add-action)    cmd_add_action "$@" ;;
  add-web-assets) cmd_add_web_assets "$@" ;;
  -h|--help)     usage; exit 0 ;;
  *)
    print_json success false error "Unknown command: $command. Run with --help for usage."
    exit 1
    ;;
esac
