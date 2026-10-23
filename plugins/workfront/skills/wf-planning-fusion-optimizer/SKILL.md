---
name: wf-planning-fusion-optimizer
description: >-
  Review an exported Adobe Workfront Planning + Fusion scenario blueprint (.json) for
  performance, speed, resource use, and API call volume, and produce a prioritized
  optimization self-review. Use this whenever someone shares a Fusion scenario that
  uses Workfront Planning (Maestro) and wants it faster, cheaper, or more reliable:
  slow runs, long execution time, scenario timeouts, high operations consumption, too
  many API calls, or rate-limit / 429 errors, especially when it works in test but
  breaks under load or at scale. Trigger for phrases like "make my Fusion scenario
  faster", "why is this Planning scenario so slow", "reduce operations or API calls",
  "our replication or sync scenario times out", or "review this blueprint". It is
  specific to the Workfront Planning connector: if a scenario does not use Planning, it
  says so and does not apply. Read-only; it does not modify the blueprint.
metadata:
  category: solution-architecture
license: Apache-2.0
---

# Workfront Planning + Fusion scenario optimizer

## What this does

Takes one or more exported Fusion scenario blueprints (`.json`) that use the Workfront
Planning (Maestro) connector and produces a prioritized, read-only review of what is
hurting the scenario's performance: run time, operations consumed, and API call volume
(which is what drives rate-limit 429s). It reports; it never modifies the blueprint,
and it does not need live workspace access.

The goal is broader than rate limits. Every module execution in Fusion is an
operation, operations cost run time and quota, and loop nesting multiplies them. So the
same structural fixes usually improve speed, cost, and rate-limit headroom at once.
Rate-limit 429s are one symptom of the same underlying inefficiency.

## Scope: Workfront Planning only

This reviewer understands the Workfront Planning connector (`workfront-maestro`
modules). It is not a general Fusion optimizer. If a blueprint has no Planning modules
(for example a Salesforce-to-Slack scenario), the analyzer detects that and returns a
clear "not applicable" result listing the connectors it did find, rather than pretending
to review it. Do not force it onto non-Planning scenarios; tell the user it is
Planning-specific and, if they want, offer general Fusion advice separately without
this skill.

## When to use it

Use it whenever a Workfront Planning Fusion scenario is the subject and the concern is
speed, run time, timeouts, operations/quota, cost, reliability, or API limits, even if
the person does not say "optimize" or "429". Replication, sync, and migration
scenarios benefit most because they walk hierarchies and fan out calls, but it applies
to any Planning scenario.

## How to run it

1. Get the exported blueprint file(s) (Fusion scenario blueprint export, `.json`).
   Multiple can be reviewed together.
2. Run:

   ```
   python scripts/analyze_blueprint.py <blueprint.json> [<blueprint2.json> ...]
   ```

   With an optional per-request call export (CSV with Resource, Method, Status Code,
   and optionally Duration columns) for measured context:

   ```
   python scripts/analyze_blueprint.py <blueprint.json> --callmix <calls.csv>
   ```

   Add `--json` for a machine-readable result.
3. Present the Markdown report as the deliverable, findings in the order returned
   (highest impact first). Do not invent numbers the script did not produce.

## How to explain the findings

Anchor everything in one model: **call volume and operations are module count times how
often each module runs, and iteration depth is the multiplier.** A GET is cheap at the
top of a scenario and expensive several loops deep. Frame each finding in terms of what
it improves: calls, operations, run time, reliability, or throughput. The report labels
each finding with its "Improves:" dimension for this reason.

State one thing early: **there is no bulk-read endpoint.** Search and single GET are the
only ways to read; bulk exists for writes only. So raising a limit or batching writes
does not fix a read-heavy scenario, only reading fewer and wider does. Lead with the
read findings (F1, F2, F3) for that reason.

Finding codes, their rationale, and recommended fixes are in `references/findings.md`.
Read it when you need the full explanation for a code; each finding already carries a
one-line recommendation in the report.

## Optional: enrich with a connected Workfront Planning MCP

The static analyzer is the base and needs no connection. But if a Workfront Planning MCP
is connected in the session (most customers running Planning have one), use it to make
the recommendations instance-specific instead of generic. It turns opaque ids in the
blueprint (`Rt69e105...`, `F6a2010...`) into real record-type and field names, and, more
importantly, confirms on the live schema that each read-collapse finding is actually
feasible: that the child record type has a filterable reference to its parent, and that
the fields a per-record GET fetches are already carried as lookups the search returns.
That is the check that otherwise needs a pasted sample.

Run `python scripts/analyze_blueprint.py <blueprint.json> --ids` to list the record-type
and field ids the blueprint references, then resolve them through the Planning MCP. The
full workflow, and one important caveat (the MCP verifies the schema and feasibility, not
the Fusion connector's output nesting), are in `references/mcp-enrichment.md`. Read it
when a Planning MCP is available. This step is strictly read-only, and if no MCP is
connected, skip it: the static report stands on its own.

## What to be careful about

- This is a heuristic structural review of the export, not a live measurement. Say so.
- Reference and record-type ids differ per workspace instance; concrete fixes must be
  resolved against the customer's live schema.
- Recommend measuring a representative run before and after, and validating in a sandbox
  before promoting.
- Do not promise a percentage improvement. Point to where the cost is and let a real
  before/after measurement produce the number.
- Sleep-based throttling (P1) must be removed in sequence, after the read path is cut,
  or bursts can get worse. Explain the ordering rather than just saying "remove it".
- With `--callmix`, shares are usually sampled: treat them as proportions.
