# ACCS REST API Dependency Declaration

## Context

Every app must be compatible with Adobe Commerce as a Cloud Service (ACCS). `ACCS-REST-API` is the App Builder product dependency declared in `deploy.yaml` that must be present for the app to be provisioned against ACCS.

Note: `deploy.yaml.apis` entries support an `optional` flag. It's fine either way — some apps mark `ACCS-REST-API` as optional, most don't, and neither should be flagged as an issue. Don't proactively recommend adding `optional: true`.

## Findings

| Condition | Severity |
|---|---|
| `ACCS-REST-API` is missing from `deploy.yaml` | `MUST` |
