# PreToolUse hook for compatible AI agent clients on Windows: requests approval
# before the ADP connector's destructive tools run, even if allow-listed. Clients differ on
# matcher support (VS Code's Local harness ignores matchers), so this script re-checks
# the tool name itself.
#
# Needs only the Windows PowerShell 5.1 that ships with Windows. requireApproval.sh is
# the macOS/Linux twin; keep both in sync with the tools the server marks
# destructiveHint: true and with the matcher in hooks.json
# (tests/mcp_server/destructiveTools.test.ts enforces both).
$ErrorActionPreference = 'Stop'
# Fail open: any unexpected error lets the tool call proceed instead of blocking it.
trap { exit 0 }

$destructiveTools = @(
  'delete_credential',
  'delete_event_registration',
  'delete_project',
  'delete_subscriber_filter',
  'delete_workspace',
  'unsubscribe_credential_from_service'
)

$ask = '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This permanently deletes or removes Adobe Developer Console resources and cannot be undone. Confirm the exact resource before approving."}}'
$pass = '{"continue":true}'

# The tool name must end with a destructive tool, preceded by a separator so that
# look-alikes such as "undelete_project" do not match.
$toolSuffix = '(?:^|[^A-Za-z0-9])(?:' + ($destructiveTools -join '|') + ')\z'

function Test-DestructiveConnectorTool([string] $Name) {
  $suffixMatch = [regex]::Match($Name, $toolSuffix)
  if (-not $suffixMatch.Success) { return $false }
  # Checking if the tool call came from ADP-connector based on standard tool name formats.
  if ($Name.StartsWith('mcp__', [System.StringComparison]::Ordinal)) {
    $end = $Name.LastIndexOf('__', [System.StringComparison]::Ordinal)
    $server = if ($end -gt 5) { $Name.Substring(5, $end - 5) } else { '' }
    return $server -match 'adp.*connector'
  }
  if ($suffixMatch.Value.StartsWith('-', [System.StringComparison]::Ordinal)) {
    $server = $Name.Substring(0, $Name.Length - $suffixMatch.Value.Length)
    return $server -ieq 'adp-connector'
  }
  return $true
}

# Read stdin as UTF-8 so the client never sees a broken pipe. Every "tool_name" string
# value in the payload is checked, so a stray nested key can only add a prompt, never
# suppress one.
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding($false)))
$payload = $reader.ReadToEnd()

foreach ($match in [regex]::Matches($payload, '"tool_name"\s*:\s*"([^"\\]*)"')) {
  if (Test-DestructiveConnectorTool $match.Groups[1].Value) {
    [Console]::Out.Write($ask)
    exit 0
  }
}

[Console]::Out.Write($pass)
exit 0
