# Core-7 Tools Reference

This document defines the shared MCP tool contract used by the dispatcher skills.

## Overview

The `core-7-tools` contract is the baseline tool set for dispatcher work across both AEMaaCS and AMS variants.

The contract exists to keep dispatcher skills:

- deterministic
- auditable
- variant-aware
- constrained to a stable, reviewable execution surface

## Tool Catalog

### `validate`

Purpose:

- syntax and structure validation for dispatcher and HTTPD config fragments

Use when:

- authoring or reviewing `.any`, vhost, rewrite, cache, or filter changes
- checking config before runtime verification

Common patterns:

- dispatcher section validation
- HTTPD/vhost block validation
- variant-specific validation modes such as `ams` or `cloud`

### `lint`

Purpose:

- best-practice analysis across security, performance, ordering, and maintainability concerns

Use when:

- filter order matters
- release gates or security gates are required
- config quality matters beyond raw syntax validity

Common patterns:

- `lint(strict)` for release or security gates
- `lint(deep)` for filter, cache, and ordering-heavy changes

### `sdk`

Purpose:

- file-level integrity checks, baseline drift analysis, and SDK-backed validation helpers

Use when:

- include topology matters
- immutable/default drift matters
- local project or validator-backed evidence is needed

Common patterns:

- `sdk(check-files)`
- `sdk(diff-baseline)`
- optional deeper validation helpers when the environment supports them

### `trace_request`

Purpose:

- trace effective routing and decision flow for a representative request

Use when:

- debugging 403, 5xx, redirect loops, host routing, or rewrite behavior
- proving expected allow or deny outcomes

Common patterns:

- failing URL versus healthy URL comparison
- canonical redirect checks
- host and method-sensitive routing checks

### `inspect_cache`

Purpose:

- inspect cacheability, cache state, and metadata for representative URLs

Use when:

- tuning cache rules
- debugging cache misses, stale content, or invalidation scope
- checking auth-sensitive cache behavior

### `monitor_metrics`

Purpose:

- capture operational signals such as status-code mix, latency shifts, or hit-ratio changes

Use when:

- triaging incidents
- comparing before/after tuning evidence
- quantifying impact windows

### `tail_logs`

Purpose:

- collect concrete runtime evidence from dispatcher or HTTPD logs

Use when:

- an incident needs real examples instead of only static reasoning
- cache or redirect behavior needs corroboration
- a request trace needs supporting log evidence

## Contract Rules

All dispatcher skills that declare `mcp-tool-contract: core-7-tools` should follow these rules:

1. Prefer the smallest sufficient command chain.
2. Do not claim a tool was run unless evidence exists.
3. Distinguish observation from inference.
4. Use static checks first unless the task is runtime-first by nature.
5. Keep variant assumptions explicit (`ams` vs `cloud`).
6. Report skipped checks and why they were skipped.

## Selection Guidance

Use this progression unless a specialist playbook says otherwise:

1. `validate`
2. `lint`
3. `sdk`
4. `trace_request`
5. `inspect_cache`
6. `tail_logs`
7. `monitor_metrics`

Not every task needs all seven tools. The contract defines the allowed baseline, not a mandatory full run.

## Failure And Troubleshooting Patterns

When a tool fails or cannot be used:

- `validate` failure:
  - report the exact failing block and error text
  - do not continue as if the config is structurally sound
- `lint` failure or warning set:
  - separate hard blockers from advisory findings
  - keep ordering and security warnings explicit
- `sdk(check-files)` failure:
  - treat include topology, immutable-file drift, or missing-file issues as high-signal structural problems
- `trace_request` unavailable:
  - fall back to static rule analysis and state the confidence limit clearly
- `inspect_cache` unavailable:
  - use static cache reasoning plus any available log or metric signals
- `tail_logs` unavailable:
  - avoid claiming runtime confirmation
- `monitor_metrics` unavailable:
  - avoid quantifying impact improvements or regressions

## Variant Notes

- The tool contract is shared across variants.
- The meaning of success differs by variant because guardrails differ.
- Always pair the tool outputs with the relevant variant guardrails and verification matrix.
