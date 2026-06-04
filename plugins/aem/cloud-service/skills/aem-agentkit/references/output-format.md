# Communication contract — output format

> **Beta Skill:** Outputs must be reviewed before applying to production.

The skill writes to the user at exactly three points: a one-line
preamble before any writes, a deterministic summary after all writes,
and a one-line workspace-relative diagnostic on any error.
[`SKILL.md`](../SKILL.md) § "Communication contract" summarizes the
points and links here for the exact templates.

## 1. Preamble (one line)

```
Bootstrapping agentic workflow context for this AEM as a Cloud Service repository. No source files will be modified.
```

When `_disable_agentkit` is detected, the preamble is replaced by:

```
aem-agentkit: skipped (opt-out signal `_disable_agentkit` present at <workspace-relative-path>). No writes performed.
```

The skill then exits 0 with no writes.

## 2. Summary block

Printed verbatim after every successful run. Counts are filled in from
the deterministic discovery (sorted POSIX paths, tiebreaker on path then
line then sanitized value).

```
aem-agentkit: complete
  Universal layer:
    Per-module AGENTS.md: <N> across [<modules>]
    Indexes: components.json (N), osgi-services.json (N)
    Derived: conventions.md (N rules, T TODOs), avoid.md (N entries),
             glossary.md (N terms), test-patterns.md (N rules)
    Static refs: aem-api-namespaces.md, README.md
  Tool-specific layer (detected: <tool list>):
    Claude:   <count> agents, <count> commands, mcp.json (existing|new-placeholder|absent)
    Cursor:   <count> rules, mcp.json (existing|new-placeholder|absent)
    Copilot:  <count> instructions
    Continue: <count> rules
    Cline:    .clinerules (existing|new|absent)
    Windsurf: .windsurfrules (existing|new|absent)
    Augment:  augment.md (existing|new|absent)
  TODO markers: <T> items pending human review
  MCP placeholders to replace: <N> (in <files>) — agent will not connect until set
  Refresh:   /regen-context
  Drift:     /agents-md-check
```

### 2.1 Conditional rows

- The `MCP placeholders to replace` row is emitted whenever `.mcp.json`
  or `.cursor/mcp.json` was written from the placeholder template and
  still contains one or more `_TODO_*` server-name keys (see
  [`mcp-wiring.md`](./mcp-wiring.md)).
- A tool-specific row is omitted when no signal for that tool was
  detected; the `Tool-specific layer (detected: <tool list>)` line then
  carries `none`.

## 3. Error diagnostic

Single line. Always workspace-relative path (no absolute paths, no
`~/`). Always names the failing check.

```
aem-agentkit: failed (<workspace-relative-path>): <check name>: <one-line reason>
```

The skill leaves no partial files (each individual file write is
atomic; earlier successful writes from prior steps remain on disk and
resume idempotently on the next invocation).

## 4. After the summary

The skill yields back so the user's original request proceeds with the
new context loaded.
