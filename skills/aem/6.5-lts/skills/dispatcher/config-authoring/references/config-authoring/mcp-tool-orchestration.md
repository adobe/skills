# MCP Tool Orchestration (Core Surface)

Use this map to sequence current Dispatcher MCP tools.

## Tool Purpose Map

- `validate`: syntax/structure validation for dispatcher/httpd/ams/runtime config checks.
- `lint`: security/performance/best-practice analysis.
- `sdk`: file integrity, baseline drift, and SDK-backed validation/runtime checks.
- `trace_request`: request-stage evidence (filter, cache, log context).
- `inspect_cache`: cache object/path evidence.
- `monitor_metrics`: aggregated runtime signals.
- `tail_logs`: direct log evidence.

## Recommended Sequences

### Config Authoring / Refactor

1. Edit config files
2. `validate`
3. `lint`
4. `sdk(action="check-files")`
5. `sdk(action="diff-baseline")` when drift matters
6. runtime tools if behavior requires runtime proof

### Incident / Regression Analysis

1. `trace_request`
2. `tail_logs`
3. `inspect_cache`
4. `monitor_metrics`
5. `validate` + `lint`
6. `sdk` checks if file integrity is suspect

### Release Readiness Review

1. `validate`
2. `lint`
3. `sdk(action="check-files")`
4. `sdk(action="diff-baseline")`
5. Optional: `sdk(action="validate-full")` / `sdk(action="docker-test")` if environment supports it

## Fallback Rules

- If runtime preconditions are missing, continue with static checks and report missing evidence.
- If SDK actions requiring external binaries/runtime fail due environment, run available checks and report limits.
- Never report simulated success for unexecuted checks.

## Tool Usage Notes

- **`lint` with `mode=directory`:** The `target` path is resolved from the MCP server's working directory, not necessarily the editor workspace. If the server returns "Directory not found", the server may not have filesystem access to the given path. Fallback: run `validate` with the relevant config content (e.g. filter snippet and `config_type: filter`), or run lint from an environment where the MCP server can read the dispatcher config directory (e.g. SDK container, CI with correct cwd).
- **`validate`:** Accepts inline config content; use for single-file or snippet validation when directory-based lint is unavailable.

## Precision Invocation Profiles

Use these profiles to improve deterministic output quality without expanding tool scope.

### Filter Edits

1. `validate({"config":"<filter section content>","type":"dispatcher","config_type":"filter"})`
2. `lint({"mode":"config","target":"<filter section content>","analysis_depth":"deep"})`
3. `sdk({"action":"check-files","config_path":"<dispatcher src path>"})` when file-level drift matters

Expected gain:
- catches filter ordering/shadow issues early
- improves confidence for last-match-wins behavior

### Rewrite/Vhost Edits

1. `validate({"config":"<vhost/rewrite block>","type":"httpd","config_type":"vhost"})` for Apache blocks
2. `validate({"config":"<dispatcher.any section>","type":"dispatcher","config_type":"dispatcher.any"})` for dispatcher blocks
3. `lint({"mode":"config","target":"<merged dispatcher content>","analysis_depth":"standard"})`

Expected gain:
- separates Apache syntax issues from Dispatcher syntax issues
- reduces mixed-surface false conclusions

### Cache/Invalidation Edits

1. `validate({"config":"<cache section content>","type":"dispatcher","config_type":"cache"})`
2. `lint({"mode":"config","target":"<cache section content>","analysis_depth":"deep"})`
3. `trace_request({"url":"<cache-hit candidate url>"})` + `inspect_cache({"url":"<cache-hit candidate url>"})`, then repeat for one cache-bypass candidate

Expected gain:
- validates both static correctness and runtime behavior evidence

### AMS Tier Routing/Flush Safety Edits

1. `validate({"config":"<dispatcher.any or farm section>","type":"ams"})`
2. `lint({"mode":"directory","target":"<dispatcher src path>","strict_mode":true})`
3. `sdk({"action":"check-files","config_path":"<dispatcher src path>"})`
4. `trace_request({"url":"<publish url>","config_path":"<dispatcher src path>"})` and (when available) one author-tier URL trace

Expected gain:
- catches AMS-specific tier-routing, variable-usage, and immutable/include issues early
- improves confidence that flush/invalidation changes remain least-privilege
