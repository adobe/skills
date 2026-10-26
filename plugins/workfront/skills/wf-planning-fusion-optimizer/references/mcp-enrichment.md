# Enriching the review with a connected Workfront Planning MCP

The static analyzer works from the blueprint alone and never needs a connection. But if
the user has a Workfront Planning MCP connected (most customers running Planning do),
you can turn the generic recommendations into instance-specific ones by reading their
live workspace schema. This step is read-only: list and read record types, fields, and
connections, and optionally run a search. Never create, update, or delete anything.

Do this only when a Planning MCP is actually available in the session. If it is not,
skip this entirely and present the static report, which is complete on its own.

## Why it helps

The blueprint is full of opaque ids (for example `Rt69e105...` record types and
`F6a2010...` fields). On their own they mean nothing to the reader. With the live schema
you can:

1. Name the ids, so findings read "the parent reference field on the child record type"
   with its real field name instead of "F6a2010...".
2. Confirm each read-collapse finding (F2, F3) is actually feasible on this instance:
   that the child record type has a filterable reference to its parent, and that the
   fields the per-record GETs read are already carried as lookups on the record the
   search returns. This is the check that otherwise needs a pasted sample.
3. Add real limit and tier context (record-type ceilings, connected-record caps) so the
   sizing advice is concrete.

## Workflow

1. Get the ids the blueprint references:

   ```
   python scripts/analyze_blueprint.py <blueprint.json> --ids
   ```

   This returns the workspace, record-type, and field ids found in the blueprint.

2. For each record type in the finding paths (the ones behind F1, F2, F3), use the
   Planning MCP to read its definition and its fields. You are looking for:
   - the human name of each record type and field id, to relabel the findings;
   - the reference fields that link child to parent (for F2: does the child record type
     have a reference field pointing to the parent that you can filter on with
     `hasAnyOf`);
   - the lookup fields on the child that already carry parent/connected data (for F3:
     the fields the follow-up GET currently fetches, so you can confirm the search
     already returns them and the GET can be deleted).

3. Rewrite the affected findings in the report to name the real fields and state the
   concrete fix, for example: "Search `<Child>` filtered by `<Connected Parent field
   name>` hasAnyOf the parent ids, project `<lookup field names>`; these already carry
   what `<get module>` re-fetches, so that GET can be removed."

4. Pull the record-type limits and the workspace tier if available, and use them to size
   the bulk-write and search-paging advice.

## Important caveat: schema, not connector output shape

The MCP tells you the schema: record-type and field ids, names, reference topology,
lookup coverage, limits, tier. It does not tell you how the Fusion connector nests
fields in a module's output bundle, because that is a Fusion connector behavior, not an
API fact. That distinction only matters if someone is auto-rewriting the blueprint (they
would need to see a real module output to map `{{module.output.field}}` correctly). For
this review-and-report skill it does not matter: schema access is enough to confirm the
recommendations are correct and to name everything. Do not claim the MCP has verified
the rewired field paths; it has verified the schema and feasibility, which is the right
scope here.

## Staying in scope

- Read-only always. No writes, no schema changes, no record creation.
- Only read the record types and fields the blueprint actually references (from `--ids`),
  not the entire workspace, to keep it fast and relevant.
- If the MCP and the blueprint disagree (an id in the blueprint no longer exists in the
  workspace), report that as a finding in its own right: the scenario references a record
  type or field that is gone, which is a latent failure.
