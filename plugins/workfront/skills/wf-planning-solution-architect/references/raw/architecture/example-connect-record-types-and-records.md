# Example of connecting record types and records

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/example-connect-record-types-and-records
Last update: May 8, 2026

This article walks two examples that reinforce the concepts captured in connect-record-types.md and connect-record-types-overview.md.

## Example 1: WFP-to-WFP (Campaign ↔ Product)
- Create connection field "Product information" on Campaign with Product target
- Cardinality options: many-to-many, one-to-many, many-to-one, one-to-one
- Add lookup field: Budget from Product → "Budget (from Product information)" on Campaign
- Aggregator SUM totals budgets; None gives comma-separated.
- Linked field gets relationship icon prefix.
- Connecting back from Product side: a "Campaign" linked field auto-appears if corresponding-field setting enabled.

## Example 2: WFP-to-Workfront Project (Campaign ↔ Project)
- "Project information" connection field, filter by Workfront custom forms ("Link only objects that match this criteria")
- Add lookup field "Planned Revenue" → "Planned Revenue (from Project information)" on Campaign
- Lookup field is read-only.
- Click project name in connected field → opens project in Workfront (needs View on project).

## Key reinforced points
- Lookup field permission warning: anyone with View on the workspace sees the linked field data, regardless of Workfront permissions.
- Aggregator behavior: with no aggregator, multiple values comma-separated.
- Edit lookup fields after creation via column header → "Edit lookup fields".
