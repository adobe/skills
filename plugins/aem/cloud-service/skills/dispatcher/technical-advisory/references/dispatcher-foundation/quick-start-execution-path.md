# Quick Start Execution Path (Cloud Dispatcher)

Use this file when the user is new to the dispatcher skills, asks for "start to finish" help, or provides a broad request such as "set up dispatcher for this feature" or "audit and fix the config."

In this skill set, "Dispatcher" means the Adobe Dispatcher Apache HTTP Server module plus its HTTPD/dispatcher configuration, not an AEM OSGi bundle.

## Fast Entry Checklist

1. Normalize the config root to the dispatcher `src` directory.
2. Confirm the target hostnames, paths, methods, and cache/auth expectations.
3. Classify the change as one of:
   - config implementation
   - security review
   - performance tuning
   - incident investigation
   - full lifecycle / mixed work
4. Apply cloud guardrails before proposing changes.
5. Select the matching playbook and exact MCP command chain.
6. If local SDK-backed runtime checks are needed, use `local-sdk-execution.md` to choose live-port, hot-reload, or `test` mode.
7. Return evidence, risk, rollback, and any missing runtime prerequisites.

## Normalize The Repo Layout

Use a dispatcher source root shaped like one of these public layouts:

### Layout A: Standalone Dispatcher Package

```text
<repo>/
  src/
    conf.d/
    conf.dispatcher.d/
```

Use `config_path="<repo>/src"` for `sdk(...)` actions.

### Layout B: Dispatcher Subproject Inside A Larger Repo

```text
<repo>/
  dispatcher/
    src/
      conf.d/
      conf.dispatcher.d/
```

Use `config_path="<repo>/dispatcher/src"` for `sdk(...)` actions.

If the user gives a broader repo root, resolve it to the dispatcher `src` directory before running validation or SDK checks.

## Default Skill Routing

| Request shape | Start here | Then pull in |
|---|---|---|
| New site, new route, rewrite, filter, cache, GraphQL, `/auth_checker`, CORS | `config-authoring` | `technical-advisory`, then `security-hardening` or `performance-tuning` as needed |
| "How should this work?" or "explain this dispatcher behavior" | `technical-advisory` | `config-authoring` if code changes are needed |
| 403, 5xx, redirect loop, cache miss, probe failure | `incident-response` | `config-authoring` for durable fix |
| Security gate, exposure review, release hardening | `security-hardening` | `config-authoring` for remediation |
| Hit ratio, invalidation scope, latency, cache fragmentation | `performance-tuning` | `config-authoring` for change implementation |
| Broad development or audit across multiple concerns | `workflow-orchestrator` | whichever specialist skills the chosen playbook requires |

## Default Command Chain

Use this minimum chain unless the selected playbook says otherwise:

1. Static structure:
   - `validate(...)`
   - `lint(...)`
2. Config integrity:
   - `sdk({"action":"check-files","config_path":"<dispatcher src path>"})`
   - `sdk({"action":"diff-baseline","config_path":"<dispatcher src path>"})` when wrapper/include drift matters
3. Runtime evidence for behavior changes:
   - `trace_request(...)`
   - `inspect_cache(...)` when cache behavior changed
   - `tail_logs(...)` and `monitor_metrics(...)` for incidents or performance analysis

## Minimum Output

Always return:

- normalized dispatcher source root
- selected skill and playbook
- files or file families affected
- executed MCP commands and evidence
- selected test IDs from `test-case-catalog.md`
- rollback trigger and rollback action
- explicit note for any skipped runtime checks
