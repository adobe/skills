# Repo Layout Workflows (AMS Dispatcher)

Use this file to map a user request to the actual dispatcher repo layout before editing files or running MCP commands.

Here, "Dispatcher" refers to the Adobe Dispatcher Apache HTTP Server module and its HTTPD/dispatcher configuration files, not an AEM bundle.

## Supported Public Layouts

### Layout A: Standalone Dispatcher Package

```text
<repo>/
  src/
    conf.d/
      available_vhosts/
      enabled_vhosts/
      rewrites/
      variables/
    conf.dispatcher.d/
      available_farms/
      enabled_farms/
      filters/
      cache/
      clientheaders/
      renders/
      virtualhosts/
```

Dispatcher source root:
- `<repo>/src`

### Layout B: Dispatcher Subproject Inside A Larger Repo

```text
<repo>/
  dispatcher/
    src/
      conf.d/
      conf.dispatcher.d/
```

Dispatcher source root:
- `<repo>/dispatcher/src`

## Workflow Maps

### 1) New Site Or New Domain

Primary playbook:
- `config-authoring` -> `config-scenario-playbooks.md` Playbook A or C

Usually touch:
- `<src>/conf.d/available_vhosts/<site>.vhost`
- `<src>/conf.d/enabled_vhosts/<site>.vhost`
- `<src>/conf.d/rewrites/<site>_rewrites.rules`
- `<src>/conf.dispatcher.d/available_farms/<site>_farm.any`
- `<src>/conf.dispatcher.d/enabled_farms/<site>_farm.any`
- `<src>/conf.dispatcher.d/filters/<site>_filters.any`
- `<src>/conf.dispatcher.d/cache/<site>_cache.any`

Runtime proof:
- canonical host redirect
- one allowed content URL
- one denied sensitive URL

### 2) API, Vanity, Or SSL/TLS Change

Primary playbook:
- `config-authoring` -> Playbook B, F, G, or H

Usually touch:
- `<src>/conf.d/available_vhosts/<site>.vhost`
- `<src>/conf.d/rewrites/<site>_rewrites.rules`
- `<src>/conf.dispatcher.d/filters/<site>_filters.any`
- `<src>/conf.dispatcher.d/cache/<site>_cache.any`
- `<src>/conf.dispatcher.d/clientheaders/<site>_clientheaders.any`

Runtime proof:
- feature request trace
- cache proof where applicable
- redirect or header behavior proof where applicable

### 3) Security Hardening Or Release Gate

Primary playbook:
- `security-hardening` -> Playbook 1 or 3

Usually inspect first:
- `<src>/conf.dispatcher.d/filters/*.any`
- `<src>/conf.dispatcher.d/cache/*.any`
- `<src>/conf.dispatcher.d/clientheaders/*.any`
- `<src>/conf.d/available_vhosts/*.vhost`
- `<src>/conf.d/rewrites/*.rules`
- `<src>/conf.d/variables/*.vars`

Change only after evidence shows a gap.

### 4) Cache Or Flush Tuning

Primary playbook:
- `performance-tuning` -> Playbook 1, 2, 4, or 5

Usually touch:
- `<src>/conf.dispatcher.d/cache/*.any`
- `<src>/conf.dispatcher.d/available_farms/*.any`
- `<src>/conf.d/available_vhosts/*.vhost`

Runtime proof:
- cache object state
- hit/miss comparison
- invalidation or flush scope rationale

### 5) Runtime Incident Triage

Primary playbook:
- `incident-response` -> Playbook 1, 2, 3, 4, or 5

Inspect before editing:
- changed vhost, farm, filter, cache, variable, and rewrite files under the dispatcher source root

Runtime proof:
- metrics window
- log evidence
- healthy vs failing request trace

### 6) Full Lifecycle Change

Primary playbook:
- `workflow-orchestrator`

Order:
1. normalize repo layout
2. pick the authoring playbook
3. run security and performance review for the touched surfaces
4. finish with release-gate validation and rollback notes

## File-Family Heuristics

- Host and redirect changes usually start in `conf.d/available_vhosts/` and `conf.d/rewrites/`.
- Tier, backend, and routing behavior usually starts in `conf.dispatcher.d/available_farms/`.
- URL exposure rules usually start in `conf.dispatcher.d/filters/`.
- Cache and flush policy usually start in `conf.dispatcher.d/cache/`.
- Header forwarding usually starts in `conf.dispatcher.d/clientheaders/`.
- Variable-driven environment behavior usually starts in `conf.d/variables/`.

Normalize to these file families before producing a change plan.
