#!/bin/sh
# PreToolUse hook for compatible AI agent clients on macOS/Linux (and Git Bash on
# Windows): requests approval before the Adobe for Developers connector's destructive
# tools run, even if the user has an allow rule. Clients differ on matcher support (some harnesses
# ignore matchers), so this script re-checks the tool name itself.
#
# Needs only a POSIX shell, grep and sed, which ship with every macOS and Linux install.
# requireApproval.ps1 is the Windows PowerShell twin; keep both in sync with the tools
# the server marks destructiveHint: true and with the matcher in hooks.json
# (tests/mcp_server/destructiveTools.test.ts enforces both).

# Byte-wise matching: tool_input can hold text that is not valid in the user's locale.
LC_ALL=C
export LC_ALL

DESTRUCTIVE_TOOLS="delete_credential delete_event_registration delete_project delete_subscriber_filter delete_workspace unsubscribe_credential_from_service"

ASK='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This permanently deletes or removes Adobe Developer Console resources and cannot be undone. Confirm the exact resource before approving."}}'
PASS='{"continue":true}'

# The tool name must end with a destructive tool, preceded by a separator so that
# look-alikes such as "undelete_project" do not match.
is_destructive_connector_tool() {
  name=$1
  for tool in $DESTRUCTIVE_TOOLS; do
    case $name in
      "$tool" | *[!A-Za-z0-9]"$tool")
        # Checking if the tool call came from the Adobe for Developers connector based
        # on standard tool name formats.
        case $name in
          mcp__*)
            server=${name#mcp__}
            server=${server%__*}
            case $server in
              *[Aa][Dd][Oo][Bb][Ee]*[Dd][Ee][Vv][Ee][Ll][Oo][Pp][Ee][Rr][Ss]*[Cc][Oo][Nn][Nn][Ee][Cc][Tt][Oo][Rr]*) return 0 ;;
              *) return 1 ;;
            esac
            ;;
          *-"$tool")
            server=${name%"-$tool"}
            case $server in
              [Aa][Dd][Oo][Bb][Ee]-[Ff][Oo][Rr]-[Dd][Ee][Vv][Ee][Ll][Oo][Pp][Ee][Rr][Ss]-[Cc][Oo][Nn][Nn][Ee][Cc][Tt][Oo][Rr]) return 0 ;;
              *) return 1 ;;
            esac
            ;;
          *) return 0 ;;
        esac
        ;;
    esac
  done
  return 1
}

# Read all of stdin first so the client never sees a broken pipe. Newlines are flattened
# because grep works line by line and JSON may put a key and its value on different lines.
# Every "tool_name" string value in the payload is checked, so a stray nested key can only
# add a prompt, never suppress one.
names=$(cat | tr '\r\n' '  ' | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"\\]*"' | sed -e 's/^"tool_name"[[:space:]]*:[[:space:]]*"//' -e 's/"$//')

while IFS= read -r name; do
  if is_destructive_connector_tool "$name"; then
    printf '%s' "$ASK"
    exit 0
  fi
done <<EOF
$names
EOF

printf '%s' "$PASS"
